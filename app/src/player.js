// Vanilla player. Owns playback state and renders the page from a `view`
// object passed via setView() — the same renderer drives the artist page,
// playlist page, library views, etc.
//
// view = {
//   page:    { crumb, title },
//   hero:    { label, title, subtitle, artwork, bgColor, showPortrait,
//              primaryAction:  { label, onClick } | null,
//              secondaryAction:{ label, onClick } | null },
//   tracks:  { title, items: Track[] } | null,
//   rail:    { title, items: RailItem[], variant: 'album'|'artist',
//              onItemClick: (item) => void } | null,
// }

import { COVERS } from './tracks.js';

const $ = (id) => document.getElementById(id);
const HARDCODED_HERO_BG =
  'radial-gradient(120% 120% at 90% 0%, rgba(255,255,255,.18), transparent 40%), ' +
  'linear-gradient(120deg, #2a0a3a 0%, #ff5d8f 50%, #ffb088 100%)';

function formatTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return Math.floor(s / 60) + ':' + String(Math.floor(s) % 60).padStart(2, '0');
}

function coverBg(track) {
  if (track?.artwork) return `url('${track.artwork}') center / cover`;
  return COVERS[track?.cover ?? 0];
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Build a view from the legacy { tracks, artist } shape so the existing
// static fallback (no Spotify) keeps working with one call.
export function staticArtistView({ artist, tracks }) {
  return {
    page: { crumb: 'For You', title: 'Today' },
    hero: {
      label: 'Featured Artist',
      title: artist.name,
      subtitle: artist.genres || '',
      artwork: artist.artwork || null,
      bgColor: artist.bgColor || null,
      showPortrait: true,
      primaryAction: { label: 'Play' },
      secondaryAction: { label: 'Following' },
    },
    tracks: { title: 'Popular this month', items: tracks },
    // Leave rail null so the hardcoded demo cards in HTML stay visible
    // for the static fallback only.
    rail: null,
  };
}

export function initPlayer({ audio, view: initialView }) {
  let view = initialView;
  let tracks = view.tracks?.items || [];

  const state = {
    playing: false,
    currentTrack: null,   // the actual track object playing — persists across view changes
    queue: [],            // track list captured when playback started; next/prev advance through it
    progress: 0,
    liked: new Set(),
    shuffle: false,
    repeat: false,
    volume: 0.6,
  };

  // Index of the currently-playing track within the *current view's* list,
  // for highlighting. -1 if the playing track isn't visible here.
  function visibleIdx() {
    const cur = state.currentTrack;
    if (!cur) return -1;
    return tracks.findIndex((t) => t === cur || (t.id != null && t.id === cur.id));
  }

  const els = {
    pageCrumb: $('pageCrumb'),
    pageTitle: $('pageTitle'),
    hero: $('hero'),
    heroLabel: $('heroLabel'),
    heroLabelText: $('heroLabelText'),
    heroTitle: $('heroTitle'),
    heroStat: $('heroStat'),
    heroPortrait: $('heroPortrait'),
    heroPlay: $('heroPlay'),
    heroSecondary: $('heroSecondary'),
    trackSectionTitle: $('trackSectionTitle'),
    trackSectionH3: $('trackSectionH3'),
    trackList: $('trackList'),
    railSectionTitle: $('railSectionTitle'),
    railSectionH3: $('railSectionH3'),
    rail: $('rail'),
    nowTitle: $('nowTitle'),
    nowArtist: $('nowArtist'),
    nowCover: $('nowCover'),
    nowLike: $('nowLike'),
    miniCover: $('miniCover'),
    miniTitle: $('miniTitle'),
    miniArtist: $('miniArtist'),
    miniFill: $('miniFill'),
    play: $('play'),
    playIcon: $('playIcon'),
    miniPlayIcon: $('miniPlayIcon'),
    bar: $('bar'),
    fill: $('fill'),
    knob: $('knob'),
    curTime: $('curTime'),
    totTime: $('totTime'),
    vbar: $('vbar'),
    vfill: $('vfill'),
  };

  // ── Render ────────────────────────────────────────────────────────────────

  function renderPage() {
    if (view.page?.crumb) els.pageCrumb.textContent = view.page.crumb;
    if (view.page?.title) els.pageTitle.textContent = view.page.title;
  }

  function renderHero() {
    const h = view.hero;
    if (!h) return;
    els.heroLabelText.textContent = h.label || '';
    els.heroLabel.style.display = h.label ? '' : 'none';
    els.heroTitle.textContent = h.title || '';
    els.heroStat.textContent = h.subtitle || '';
    els.heroStat.style.display = h.subtitle ? '' : 'none';

    // Portrait: real photo or the original placeholder pattern.
    if (h.showPortrait === false) {
      els.heroPortrait.style.display = 'none';
      els.hero.classList.add('hero-compact');
    } else {
      els.heroPortrait.style.display = '';
      els.hero.classList.remove('hero-compact');
      if (h.artwork) {
        els.heroPortrait.style.background = `url('${h.artwork}') center / cover`;
        els.heroPortrait.textContent = '';
      } else {
        // restore placeholder look
        els.heroPortrait.style.background = '';
        els.heroPortrait.textContent = 'ARTIST PORTRAIT · drop image';
      }
    }

    // Hero background gradient — derive from bgColor if Spotify gave us one,
    // else fall back to the original warm sunset.
    if (h.bgColor) {
      els.hero.style.background =
        `radial-gradient(120% 120% at 90% 0%, rgba(255,255,255,.18), transparent 40%), ` +
        `linear-gradient(120deg, #${h.bgColor} 0%, rgba(0,0,0,0.55) 100%)`;
    } else if (h.artwork) {
      // Tinted overlay over the artwork for legibility
      els.hero.style.background =
        `linear-gradient(120deg, rgba(20,15,30,0.55), rgba(20,15,30,0.15)), ` +
        `url('${h.artwork}') center / cover`;
    } else {
      els.hero.style.background = HARDCODED_HERO_BG;
    }

    // Action buttons
    const p = h.primaryAction;
    els.heroPlay.style.display = p ? '' : 'none';
    if (p) {
      els.heroPlay.lastChild.textContent = ' ' + (p.label || 'Play');
    }
    const s = h.secondaryAction;
    els.heroSecondary.style.display = s ? '' : 'none';
    if (s) els.heroSecondary.textContent = s.label || '';
  }

  function renderTrackSection() {
    const ts = view.tracks;
    if (!ts || !ts.items?.length) {
      els.trackSectionTitle.style.display = 'none';
      els.trackList.style.display = 'none';
      return;
    }
    els.trackSectionTitle.style.display = '';
    els.trackList.style.display = '';
    els.trackSectionH3.textContent = ts.title || 'Tracks';

    els.trackList.innerHTML = '';
    const curIdx = visibleIdx();
    tracks.forEach((t, i) => {
      const isCurrent = i === curIdx;
      const playingHere = isCurrent && state.playing;
      const liked = state.liked.has(i);
      const row = document.createElement('div');
      row.className = 'row' + (isCurrent ? ' playing' : '');
      row.dataset.idx = String(i);
      row.innerHTML = `
        <div class="num">${playingHere ? '<span class="eq"><i></i><i></i><i></i><i></i></span>' : t.n}</div>
        <div class="cv${t.artwork ? ' has-art' : ''}" style="background:${coverBg(t)}"></div>
        <div class="ti">${escapeHtml(t.title)}<div class="sub">${escapeHtml(t.album || '')}</div></div>
        <div class="plays">${escapeHtml(t.plays || '')}</div>
        <div class="heart${liked ? ' on' : ''}" data-act="like" data-idx="${i}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>
        </div>
        <div class="dur">${escapeHtml(t.duration)}</div>
        <div class="more-c"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></div>
      `;
      els.trackList.appendChild(row);
    });
  }

  function renderRailSection() {
    const r = view.rail;
    if (!r || !r.items?.length) {
      // null = leave the hardcoded demo cards alone (static fallback only)
      // empty = explicitly hide
      if (r && !r.items?.length) {
        els.railSectionTitle.style.display = 'none';
        els.rail.style.display = 'none';
      } else if (!r && view.tracks) {
        // Authed views without a rail (playlists, library track lists) hide
        // the section so the demo cards don't bleed through.
        els.railSectionTitle.style.display = 'none';
        els.rail.style.display = 'none';
      }
      return;
    }
    els.railSectionTitle.style.display = '';
    els.rail.style.display = '';
    els.railSectionH3.textContent = r.title || '';
    els.rail.classList.toggle('artists', r.variant === 'artist');

    els.rail.innerHTML = '';
    r.items.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.idx = String(i);
      const subtitle = item.subtitle ?? (item.year ? `${item.year} · ${item.type || 'Album'}` : '');
      const hasArt = !!item.artwork;
      card.innerHTML = `
        <div class="art${hasArt ? ' has-art' : ''}" ${hasArt ? `style="background:url('${item.artwork}') center / cover"` : ''}>
          ${hasArt ? '' : `<div class="label">${escapeHtml(item.name || '')}</div><div class="glow"></div>`}
        </div>
        <div class="meta">
          <div class="nm">${escapeHtml(item.name || '')}</div>
          <div class="ar">${escapeHtml(subtitle)}</div>
        </div>
      `;
      // Stagger entrance: each card animates in 30ms after the previous.
      card.style.animation = 'cardIn .35s ease-out both';
      card.style.animationDelay = i * 30 + 'ms';
      els.rail.appendChild(card);
    });
  }

  function renderNowPlaying() {
    const t = state.currentTrack;
    if (!t) {
      els.nowTitle.textContent = '—';
      els.nowArtist.textContent = '';
      return;
    }
    els.nowTitle.textContent = t.title;
    // Prefer the track's own artist (set when loaded from view A) over the
    // current view's hero title, so the transport keeps showing the right
    // artist after the user navigates away.
    const artistLine = t.artist || (visibleIdx() >= 0 ? view.hero?.title : '') || '';
    els.nowArtist.textContent = artistLine ? `${artistLine} · ${t.album || ''}` : t.album || '';
    els.nowCover.style.background = coverBg(t);
    els.nowCover.classList.toggle('has-art', !!t.artwork);
    els.miniCover.style.background = coverBg(t);
    els.miniCover.classList.toggle('has-art', !!t.artwork);
    els.miniTitle.textContent = t.title;
    els.miniArtist.textContent = els.nowArtist.textContent;
    const idx = visibleIdx();
    const liked = idx >= 0 && state.liked.has(idx);
    els.nowLike.classList.toggle('on', liked);
    els.nowLike.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
    els.totTime.textContent = t.duration;
  }

  function renderPlayIcon() {
    const path = state.playing
      ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'
      : '<path d="M6 4l14 8-14 8z"/>';
    els.playIcon.innerHTML = path;
    els.miniPlayIcon.innerHTML = path;
  }

  function renderProgress() {
    const pct = (state.progress * 100).toFixed(2) + '%';
    els.fill.style.width = pct;
    els.knob.style.left = pct;
    els.miniFill.style.width = pct;
  }

  function renderVolume() {
    els.vfill.style.width = state.volume * 100 + '%';
  }

  function renderAll() {
    renderPage();
    renderHero();
    renderTrackSection();
    renderRailSection();
    renderNowPlaying();
    renderPlayIcon();
    renderProgress();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function loadTrack(idx, { autoplay = false } = {}) {
    // Capture this view's tracks as the active queue (snapshot the reference
    // so navigating elsewhere doesn't redirect next/prev to the new view).
    state.queue = tracks;
    state.currentTrack = tracks[idx];
    // Stamp the track with the current artist context so the transport can
    // keep showing it after the user navigates away.
    if (state.currentTrack && !state.currentTrack.artist && view.hero?.title) {
      state.currentTrack.artist = view.hero.title;
    }
    state.progress = 0;
    audio.load(state.currentTrack);
    renderNowPlaying();
    renderTrackSection();
    renderProgress();
    if (autoplay) play();
  }

  function play() {
    if (!tracks.length) return;
    state.playing = true;
    audio.play();
    renderPlayIcon();
    renderTrackSection();
  }

  function pause() {
    state.playing = false;
    audio.pause();
    renderPlayIcon();
    renderTrackSection();
  }

  function togglePlay() {
    state.playing ? pause() : play();
  }

  // Advance through the active queue (the track list captured when playback
  // last started), not the current view's list. That way switching tabs
  // doesn't change what next/prev mean.
  function advance(delta) {
    const q = state.queue;
    if (!q.length) return;
    const cur = state.currentTrack;
    const here = cur ? q.findIndex((t) => t === cur || (t.id != null && t.id === cur.id)) : -1;
    let idx;
    if (state.shuffle && delta > 0) {
      idx = Math.floor(Math.random() * q.length);
    } else {
      idx = ((here < 0 ? 0 : here + delta) + q.length) % q.length;
    }
    state.currentTrack = q[idx];
    state.progress = 0;
    audio.load(state.currentTrack);
    renderNowPlaying();
    renderTrackSection();
    renderProgress();
    if (state.playing) play();
  }

  function next() { advance(1); }
  function prev() { advance(-1); }

  function toggleLike(idx) {
    state.liked.has(idx) ? state.liked.delete(idx) : state.liked.add(idx);
    renderTrackSection();
    renderNowPlaying();
  }

  // ── Wire-up ───────────────────────────────────────────────────────────────

  els.trackList.addEventListener('click', (e) => {
    const heart = e.target.closest('[data-act="like"]');
    if (heart) {
      e.stopPropagation();
      toggleLike(Number(heart.dataset.idx));
      return;
    }
    const row = e.target.closest('.row');
    if (!row) return;
    const idx = Number(row.dataset.idx);
    // Toggle only if the clicked row is the *currently playing* track in
    // this view. Otherwise start playback from this view's queue.
    if (idx === visibleIdx() && state.queue === tracks) {
      togglePlay();
    } else {
      loadTrack(idx, { autoplay: true });
    }
  });

  els.rail.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card || !view.rail?.onItemClick) return;
    const idx = Number(card.dataset.idx);
    const item = view.rail.items[idx];
    if (item) view.rail.onItemClick(item);
  });

  els.play.addEventListener('click', togglePlay);
  $('miniPlay').addEventListener('click', togglePlay);
  $('next').addEventListener('click', next);
  $('prev').addEventListener('click', prev);
  $('miniNext').addEventListener('click', next);
  $('miniPrev').addEventListener('click', prev);

  els.heroPlay.addEventListener('click', () => {
    const action = view.hero?.primaryAction;
    if (action?.onClick) {
      action.onClick();
    } else if (tracks.length) {
      loadTrack(0, { autoplay: true });
    }
  });

  els.heroSecondary.addEventListener('click', () => {
    view.hero?.secondaryAction?.onClick?.();
  });

  els.nowLike.addEventListener('click', () => {
    const idx = visibleIdx();
    if (idx >= 0) toggleLike(idx);
  });

  $('shuffle').addEventListener('click', (e) => {
    state.shuffle = !state.shuffle;
    e.currentTarget.classList.toggle('on', state.shuffle);
  });
  $('repeat').addEventListener('click', (e) => {
    state.repeat = !state.repeat;
    e.currentTarget.classList.toggle('on', state.repeat);
  });

  // Scrub bar
  let dragging = false;
  const seekFromEvent = (e) => {
    const rect = els.bar.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    state.progress = progress;
    audio.seek(progress);
    renderProgress();
  };
  els.bar.addEventListener('pointerdown', (e) => {
    dragging = true;
    els.bar.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  });
  els.bar.addEventListener('pointermove', (e) => {
    if (dragging) seekFromEvent(e);
  });
  els.bar.addEventListener('pointerup', (e) => {
    dragging = false;
    els.bar.releasePointerCapture(e.pointerId);
  });

  // Volume bar
  els.vbar.addEventListener('click', (e) => {
    const rect = els.vbar.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    state.volume = v;
    audio.setVolume(v);
    renderVolume();
  });

  // Mobile drawer
  const side = $('side');
  const scrim = $('scrim');
  const menuBtn = $('menuBtn');
  const closeDrawer = () => { side.classList.remove('open'); scrim.classList.remove('show'); };
  menuBtn.addEventListener('click', () => { side.classList.add('open'); scrim.classList.add('show'); });
  scrim.addEventListener('click', closeDrawer);

  // Mobile tab bar (visual only)
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tabbar button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    });
  });

  // ── Audio engine subscriptions ────────────────────────────────────────────

  audio.on('time', (current, duration) => {
    state.progress = duration > 0 ? current / duration : 0;
    els.curTime.textContent = formatTime(current);
    els.totTime.textContent = formatTime(duration);
    renderProgress();
  });

  audio.on('end', () => {
    if (state.repeat) {
      state.progress = 0;
      audio.seek(0);
      audio.play();
    } else {
      next();
    }
  });

  // ── Initial render ────────────────────────────────────────────────────────

  audio.setVolume(state.volume);
  if (tracks.length) {
    state.currentTrack = tracks[0];
    state.queue = tracks;
    audio.load(tracks[0]);
  }
  renderAll();
  renderVolume();

  // ── Controller ────────────────────────────────────────────────────────────

  return {
    setView(newView) {
      view = newView;
      tracks = view.tracks?.items || [];
      // `liked` keys by index into the current view's list, so it's only
      // meaningful within one view. Reset on navigation.
      state.liked = new Set();
      // Critical: don't disturb playback when switching views. Only prep the
      // transport with this view's first track if nothing is currently
      // playing, so the user doesn't see a blank now-playing on initial nav
      // before they've started anything.
      if (!state.playing && tracks.length) {
        state.currentTrack = tracks[0];
        state.queue = tracks;
        state.progress = 0;
        audio.load(tracks[0]);
      }
      renderAll();
      // Scroll back to top so users see the new hero, not the previous bottom.
      document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };
}
