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

  // Likes are keyed by track id (so they survive view changes and reloads),
  // backed by localStorage. The Set holds whatever string ids the catalogs
  // return — iTunes trackId or Spotify track id — both stable per song.
  const LIKES_KEY = 'lumen.likes';
  function loadLikes() {
    try {
      const raw = localStorage.getItem(LIKES_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }
  function persistLikes() {
    try { localStorage.setItem(LIKES_KEY, JSON.stringify([...state.liked])); } catch {}
  }

  const state = {
    playing: false,
    currentTrack: null,   // the actual track object playing — persists across view changes
    queue: [],            // track list captured when playback started; next/prev advance through it
    progress: 0,
    liked: loadLikes(),
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
    singlesRailSectionTitle: $('singlesRailSectionTitle'),
    singlesRailSectionH3: $('singlesRailSectionH3'),
    singlesRail: $('singlesRail'),
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
    // Fullscreen now-playing
    nowFull: $('nowFull'),
    nfBg: $('nfBg'),
    nfCover: $('nfCover'),
    nfTitle: $('nfTitle'),
    nfArtist: $('nfArtist'),
    nfCur: $('nfCur'),
    nfRem: $('nfRem'),
    nfBar: $('nfBar'),
    nfFill: $('nfFill'),
    nfPlayIcon: $('nfPlayIcon'),
    nfLike: $('nfLike'),
  };

  // Audio duration is captured from the audio engine's time events so the
  // fullscreen player can compute remaining time without re-querying the
  // DOM <audio> element on every progress tick.
  let lastDuration = 0;

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

    // Make the hero itself clickable when the view provides an onClick
    // (used for the auto-rotating Featured Artist on For You — clicking
    // the showcased artist locks onto their catalogue and stops the cycle).
    if (h.onClick) {
      els.hero.setAttribute('data-clickable', '');
    } else {
      els.hero.removeAttribute('data-clickable');
    }

    // Variant class — drives the artist-page-specific CSS treatment
    // (taller hero, larger title) so a dedicated artist view reads as a
    // different page than the For You landing.
    els.hero.classList.toggle('hero-artist', h.variant === 'artist');
    els.hero.classList.toggle('hero-featured', h.variant === 'featured');
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
      const liked = !!t.id && state.liked.has(t.id);
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

  // Render one rail's worth of cards into a given container. Used for both
  // the primary albums rail (view.rail) and the optional Singles rail
  // (view.secondaryRail). The DOM IDs are passed in so the renderer doesn't
  // need to know which rail it's filling.
  function renderRailInto(railData, titleEl, h3El, railEl) {
    if (!railData || !railData.items?.length) {
      if (titleEl) titleEl.style.display = 'none';
      if (railEl) railEl.style.display = 'none';
      return;
    }
    titleEl.style.display = '';
    railEl.style.display = '';
    h3El.textContent = railData.title || '';
    railEl.classList.toggle('artists', railData.variant === 'artist');

    railEl.innerHTML = '';
    railData.items.forEach((item, i) => {
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
      card.classList.add('card-in');
      card.style.animationDelay = i * 30 + 'ms';
      railEl.appendChild(card);
    });
  }

  function renderRailSection() {
    // Primary rail. Honor the legacy "leave the static demo cards visible
    // when no view has loaded yet" behaviour by only hiding when the rail
    // is explicitly empty or another rendered section exists.
    const r = view.rail;
    if (!r || !r.items?.length) {
      if (r && !r.items?.length) {
        els.railSectionTitle.style.display = 'none';
        els.rail.style.display = 'none';
      } else if (!r && view.tracks) {
        els.railSectionTitle.style.display = 'none';
        els.rail.style.display = 'none';
      }
    } else {
      renderRailInto(r, els.railSectionTitle, els.railSectionH3, els.rail);
    }

    // Secondary rail (Singles). Always hide when null/empty — no legacy
    // demo content to preserve here.
    renderRailInto(
      view.secondaryRail,
      els.singlesRailSectionTitle,
      els.singlesRailSectionH3,
      els.singlesRail,
    );
  }

  // Track which track we last rendered into the transport so we only fire
  // the cross-fade when the song actually changes (not on every tick or
  // play-state toggle).
  let lastRenderedTrackKey = null;

  function renderNowPlaying() {
    const t = state.currentTrack;
    if (!t) {
      els.nowTitle.textContent = '—';
      els.nowArtist.textContent = '';
      lastRenderedTrackKey = null;
      return;
    }
    const key = t.id ?? `${t.title}|${t.album}`;
    const trackChanged = key !== lastRenderedTrackKey;
    lastRenderedTrackKey = key;
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
    const liked = !!t.id && state.liked.has(t.id);
    els.nowLike.classList.toggle('on', liked);
    els.nowLike.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
    els.totTime.textContent = t.duration;

    // Replay the meta cross-fade only on actual song changes — keeps the
    // transport calm during play/pause toggles or progress ticks.
    if (trackChanged) {
      const targets = [els.nowCover, els.miniCover, els.nowTitle, els.nowArtist, els.miniTitle, els.miniArtist];
      for (const el of targets) {
        el.classList.remove('meta-in');
        void el.offsetWidth;
        el.classList.add('meta-in');
      }
    }
    renderFullMeta();
  }

  function renderPlayIcon() {
    const path = state.playing
      ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'
      : '<path d="M6 4l14 8-14 8z"/>';
    els.playIcon.innerHTML = path;
    els.miniPlayIcon.innerHTML = path;
    els.nfPlayIcon.innerHTML = path;
    // .is-paused drives the cover-shrink in CSS — when the user pauses,
    // the centred album cover scales down ~14% (Apple Music gesture).
    els.nowFull.classList.toggle('is-paused', !state.playing);
  }

  function renderProgress() {
    const pct = (state.progress * 100).toFixed(2) + '%';
    els.fill.style.width = pct;
    els.knob.style.left = pct;
    els.miniFill.style.width = pct;
    els.nfFill.style.width = pct;
  }

  function renderFullMeta() {
    const t = state.currentTrack;
    if (!t) {
      els.nfTitle.textContent = '—';
      els.nfArtist.textContent = '';
      els.nfCover.style.background = '';
      els.nfBg.style.background = '';
      return;
    }
    els.nfTitle.textContent = t.title || '—';
    els.nfArtist.textContent = els.nowArtist.textContent;
    // Cover: real artwork if present, else the gradient placeholder. The
    // backdrop uses the same image (heavily blurred via CSS) for the
    // refractive album-art glow behind the centred cover.
    if (t.artwork) {
      els.nfCover.style.background = `url('${t.artwork}') center / cover`;
      els.nfBg.style.background = `url('${t.artwork}') center / cover`;
    } else {
      els.nfCover.style.background = coverBg(t);
      els.nfBg.style.background = coverBg(t);
    }
    const liked = !!t.id && state.liked.has(t.id);
    els.nfLike.classList.toggle('on', liked);
    els.nfLike.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');
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
    renderSegState();
  }

  // Segmented tab control (Overview / Songs / Discography). The active tab
  // lives on `.main[data-tab=...]`; CSS hides the off-tab sections. Buttons
  // are disabled when their corresponding section has no content, so the
  // user can't click into an empty page.
  function renderSegState() {
    const seg = document.getElementById('seg');
    const mainEl = document.querySelector('.main');
    if (!seg || !mainEl) return;
    const hasTracks = !!view.tracks?.items?.length;
    const hasRail   = !!(view.rail?.items?.length || view.secondaryRail?.items?.length);
    const enabled = {
      overview: hasTracks || hasRail,
      songs: hasTracks,
      discography: hasRail,
    };
    // Default tab = overview when entering a view; if overview has no
    // content but one of the other tabs does, fall through to that one.
    let active = mainEl.dataset.tab || 'overview';
    if (!enabled[active]) {
      active = enabled.overview ? 'overview' : enabled.songs ? 'songs' : enabled.discography ? 'discography' : 'overview';
    }
    mainEl.dataset.tab = active;
    seg.querySelectorAll('button').forEach((btn) => {
      const tab = btn.dataset.tab;
      btn.classList.toggle('on', tab === active);
      btn.disabled = !enabled[tab];
    });
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

  function toggleLikeByTrackId(id) {
    if (!id) return false;
    if (state.liked.has(id)) state.liked.delete(id);
    else state.liked.add(id);
    persistLikes();
    return true;
  }

  function toggleLike(idx) {
    const t = tracks[idx];
    if (!toggleLikeByTrackId(t?.id)) return;
    renderTrackSection();
    renderNowPlaying();
    // Pop the heart that was just toggled. renderTrackSection rebuilds the
    // row, so we add the class to the freshly-rendered element afterwards.
    const heart = els.trackList.querySelector(`[data-act="like"][data-idx="${idx}"]`);
    if (heart) {
      heart.classList.remove('heart-pop');
      void heart.offsetWidth;
      heart.classList.add('heart-pop');
    }
    if (state.currentTrack?.id === t.id) {
      els.nowLike.classList.remove('heart-pop');
      void els.nowLike.offsetWidth;
      els.nowLike.classList.add('heart-pop');
    }
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

  // Seg tab clicks
  document.getElementById('seg')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn || btn.disabled) return;
    const mainEl = document.querySelector('.main');
    if (mainEl) {
      mainEl.dataset.tab = btn.dataset.tab;
      // Replay the view-enter animation on every tab click — the CSS show/
      // hide is instant on its own and reads as "nothing happened" without
      // motion. Same forced-reflow trick used elsewhere to restart the
      // keyframes from frame zero.
      mainEl.classList.remove('view-leaving');
      mainEl.classList.remove('view-entering');
      void mainEl.offsetWidth;
      mainEl.classList.add('view-entering');
    }
    renderSegState();
  });

  els.rail.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card || !view.rail?.onItemClick) return;
    const idx = Number(card.dataset.idx);
    const item = view.rail.items[idx];
    if (item) view.rail.onItemClick(item);
  });

  els.singlesRail?.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card || !view.secondaryRail?.onItemClick) return;
    const idx = Number(card.dataset.idx);
    const item = view.secondaryRail.items[idx];
    if (item) view.secondaryRail.onItemClick(item);
  });

  els.play.addEventListener('click', togglePlay);
  $('miniPlay').addEventListener('click', togglePlay);
  $('next').addEventListener('click', next);
  $('prev').addEventListener('click', prev);
  $('miniNext').addEventListener('click', next);
  $('miniPrev').addEventListener('click', prev);

  // Keyboard shortcuts. Skip when the user is typing in a text field so
  // search input still gets normal arrow/space behaviour.
  function adjustVolume(delta) {
    state.volume = Math.max(0, Math.min(1, state.volume + delta));
    audio.setVolume(state.volume);
    renderVolume();
  }
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.matches?.('input, textarea, select') || t.isContentEditable)) return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowRight':
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        next();
        break;
      case 'ArrowLeft':
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        prev();
        break;
      case 'ArrowUp':
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        adjustVolume(0.05);
        break;
      case 'ArrowDown':
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        adjustVolume(-0.05);
        break;
      case 'l': case 'L':
        if (state.currentTrack?.id) {
          els.nowLike.click();
        }
        break;
      case 'm': case 'M':
        e.preventDefault();
        if (state.volume > 0) {
          state._mutedVolume = state.volume;
          state.volume = 0;
        } else {
          state.volume = state._mutedVolume ?? 0.6;
        }
        audio.setVolume(state.volume);
        renderVolume();
        break;
      case '/':
        e.preventDefault();
        document.getElementById('searchInput')?.focus();
        break;
    }
  });

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

  // Hero card click → view.hero.onClick (set when the page wants the whole
  // banner to be a link; e.g. For You's auto-rotating artist). Buttons
  // inside the hero stop propagation via their own handlers' actions, but
  // we also explicitly skip clicks that originate on a button so Play /
  // Following don't double-trigger this navigation.
  els.hero.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    view.hero?.onClick?.();
  });

  els.nowLike.addEventListener('click', () => {
    const id = state.currentTrack?.id;
    if (!toggleLikeByTrackId(id)) return;
    renderTrackSection();
    renderNowPlaying();
    els.nowLike.classList.remove('heart-pop');
    void els.nowLike.offsetWidth;
    els.nowLike.classList.add('heart-pop');
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

  // ── Fullscreen now-playing ────────────────────────────────────────────────
  // Tap the transport's now-playing area (desktop) or the minibar (mobile)
  // to expand into the Apple-Music-style fullscreen player. Like icon and
  // mini transport buttons opt out so they don't double-trigger.
  function openFullPlayer() {
    if (!state.currentTrack) return;
    renderFullMeta();
    renderProgress();
    renderPlayIcon();
    els.nowFull.classList.add('open');
    // inert + aria-hidden=false: subtree is now both visible to AT and
    // focusable. Setting inert first (before aria-hidden) avoids a frame
    // where the player is announced but focus is still blocked.
    els.nowFull.removeAttribute('inert');
    els.nowFull.setAttribute('aria-hidden', 'false');
  }
  function closeFullPlayer() {
    // Move focus out before hiding — aria-hidden on an ancestor of the
    // focused element is an ARIA spec violation (and Chrome logs a
    // warning). Blur then mark inert so nothing inside can be re-focused.
    if (els.nowFull.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    els.nowFull.classList.remove('open');
    els.nowFull.setAttribute('inert', '');
    els.nowFull.setAttribute('aria-hidden', 'true');
  }
  document.querySelector('.transport .now')?.addEventListener('click', (e) => {
    if (e.target.closest('.like')) return;
    openFullPlayer();
  });
  document.querySelector('.minibar')?.addEventListener('click', (e) => {
    if (e.target.closest('.actions')) return;
    openFullPlayer();
  });
  $('nfClose').addEventListener('click', closeFullPlayer);
  $('nfPlay').addEventListener('click', togglePlay);
  $('nfPrev').addEventListener('click', prev);
  $('nfNext').addEventListener('click', next);
  els.nfLike.addEventListener('click', () => {
    const id = state.currentTrack?.id;
    if (!toggleLikeByTrackId(id)) return;
    renderTrackSection();
    renderNowPlaying();
    els.nfLike.classList.remove('heart-pop');
    void els.nfLike.offsetWidth;
    els.nfLike.classList.add('heart-pop');
  });

  // Fullscreen scrub bar — uses the same drag pattern as the desktop bar.
  let nfDragging = false;
  const nfSeek = (e) => {
    const rect = els.nfBar.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    state.progress = progress;
    audio.seek(progress);
    // Optimistic time update so the labels don't lag the next 'time' tick.
    if (lastDuration > 0) {
      els.nfCur.textContent = formatTime(progress * lastDuration);
      els.nfRem.textContent = formatTime(Math.max(0, lastDuration - progress * lastDuration));
    }
    renderProgress();
  };
  els.nfBar.addEventListener('pointerdown', (e) => {
    nfDragging = true;
    els.nfBar.setPointerCapture(e.pointerId);
    nfSeek(e);
  });
  els.nfBar.addEventListener('pointermove', (e) => { if (nfDragging) nfSeek(e); });
  els.nfBar.addEventListener('pointerup', (e) => {
    nfDragging = false;
    els.nfBar.releasePointerCapture(e.pointerId);
  });

  // Escape closes the fullscreen player. Hooked here rather than inside the
  // global keyboard switch so it runs even when nowFull is the active layer.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.nowFull.classList.contains('open')) {
      e.preventDefault();
      closeFullPlayer();
    }
  });

  // ── Audio engine subscriptions ────────────────────────────────────────────

  audio.on('time', (current, duration) => {
    state.progress = duration > 0 ? current / duration : 0;
    lastDuration = duration;
    els.curTime.textContent = formatTime(current);
    els.totTime.textContent = formatTime(duration);
    // Fullscreen times: elapsed on the left, remaining (no negative — keeps
    // parity with the transport's elapsed/total pair so a glance maps).
    els.nfCur.textContent = formatTime(current);
    els.nfRem.textContent = formatTime(Math.max(0, duration - current));
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
      // Likes are keyed by track id and persisted, so they survive
      // navigation; no per-view reset needed.
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
      // Replay the view-enter animation. Toggling the class with a forced
      // reflow between remove/add restarts the keyframes from frame zero,
      // even if the previous run hadn't finished — important when the user
      // taps tabs in quick succession. Also clear any leaving-animation
      // class so the entering keyframe isn't fighting the leaving one.
      const mainEl = document.querySelector('.main');
      if (mainEl) {
        // Reset the seg tab to overview on every navigation — renderAll
        // already ran, but the tab might have been left on Songs from the
        // previous view. Done before renderAll so renderSegState picks up
        // the reset.
        mainEl.dataset.tab = 'overview';
        renderSegState();
        mainEl.classList.remove('view-leaving');
        mainEl.classList.remove('view-entering');
        void mainEl.offsetWidth;
        mainEl.classList.add('view-entering');
      }
      // Scroll back to top so users see the new hero, not the previous bottom.
      mainEl?.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // Same data update as setView, but with a hero-only slide animation
    // instead of a full pane transition. Used by the For You auto-rotation
    // so the artists feel like they're alternating in a carousel instead
    // of the whole page re-entering. Falls back to setView() on the very
    // first call (no prior hero to slide off).
    rotateView(newView) {
      if (!view?.hero || !els.hero) {
        this.setView(newView);
        return;
      }
      // Phase 1: slide current hero off to the left.
      els.hero.classList.remove('hero-slide-in');
      els.hero.classList.remove('hero-slide-out');
      void els.hero.offsetWidth;
      els.hero.classList.add('hero-slide-out');

      // Phase 2 (after slide-out): swap state + DOM, then slide the new
      // hero in from the right. Using setTimeout keyed to the slide-out
      // duration; animationend would be more accurate but adds listener
      // bookkeeping for a 200ms wait.
      setTimeout(() => {
        view = newView;
        tracks = view.tracks?.items || [];
        if (!state.playing && tracks.length) {
          state.currentTrack = tracks[0];
          state.queue = tracks;
          state.progress = 0;
          audio.load(tracks[0]);
        }
        renderAll();
        const mainEl = document.querySelector('.main');
        if (mainEl) {
          mainEl.dataset.tab = 'overview';
          renderSegState();
        }
        els.hero.classList.remove('hero-slide-out');
        void els.hero.offsetWidth;
        els.hero.classList.add('hero-slide-in');
      }, 200);
    },
  };
}
