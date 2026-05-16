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

export function initPlayer({ audio: initialAudio, view: initialView }) {
  let view = initialView;
  let tracks = view.tracks?.items || [];
  // Wired by main.js after the views/navigator exist; called when the user
  // clicks the artist line in the fullscreen player to jump to that artist's
  // discography. Stays null until registered (no-ops then).
  let artistNavigator = null;

  // Mutable audio engine reference — main.js can swap from the local
  // <audio>-based engine to the Spotify Web Playback SDK engine once
  // Premium is confirmed. Use a closure-mutable binding (not const) so
  // every transport handler reads the current engine.
  let audio = initialAudio;

  // Optional Spotify-library sync (set by main.js in Spotify mode). Each
  // entry is async; we fire-and-forget so the heart icon stays snappy.
  let librarySync = null;        // { save(id), remove(id), check(ids[]) }
  let queueAdder = null;         // (trackId) → Promise

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
    nfBlobs: $('nfBlobs'),
    nfShuffle: $('nfShuffle'),
    nfRepeat: $('nfRepeat'),
  };

  // Audio duration is captured from the audio engine's time events so the
  // fullscreen player can compute remaining time without re-querying the
  // DOM <audio> element on every progress tick.
  let lastDuration = 0;

  // ── Render ────────────────────────────────────────────────────────────────

  // Apple Music-style horizontal marquee for fluid-width title/artist
  // labels. Wraps the text in a child <span.marquee-text> so the parent's
  // existing nowrap+overflow:hidden frames it; measures after layout and
  // toggles .is-marquee with --marquee-distance / --marquee-duration only
  // when the text actually overflows. Container width is whatever the
  // parent layout gives it (responsive). A shared ResizeObserver
  // re-measures on every parent-width change (resize, orientation,
  // "See all" toggle) so the marquee never gets stuck on a stale
  // measurement.
  const marqueeMap = new WeakMap(); // el → text (for re-measurement)
  const marqueeRO = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const text = marqueeMap.get(entry.target);
      if (text != null) measureMarquee(entry.target, text);
    }
  });

  function measureMarquee(el, value) {
    const span = el.firstElementChild;
    if (!span || !span.classList.contains('marquee-text')) return;
    // Reset before re-measuring so a previously-overflowing element that
    // now fits stops scrolling (and vice versa).
    el.classList.remove('is-marquee');
    el.style.removeProperty('--marquee-distance');
    el.style.removeProperty('--marquee-duration');
    const overflow = span.scrollWidth - el.clientWidth;
    if (overflow > 4) {
      const travel = overflow + 16; // +16 trailing breathing room
      const SPEED_PX_PER_S = 40;
      const scrollSecs = travel / SPEED_PX_PER_S;
      const cycleSecs = (scrollSecs * 2) + 4; // +4s of held pauses each end
      el.style.setProperty('--marquee-distance', `-${travel}px`);
      el.style.setProperty('--marquee-duration', `${cycleSecs.toFixed(2)}s`);
      el.classList.add('is-marquee');
    }
  }

  function setMarqueeText(el, text) {
    if (!el) return;
    const value = text || '';
    const existing = el.firstElementChild;
    // Reuse the span if the text hasn't changed — avoids tearing down the
    // animation on every re-render (track ticks, like toggles, etc.).
    if (existing && existing.classList.contains('marquee-text') && existing.textContent === value) {
      marqueeMap.set(el, value);
      return;
    }
    el.textContent = '';
    el.classList.remove('is-marquee');
    el.style.removeProperty('--marquee-distance');
    el.style.removeProperty('--marquee-duration');
    marqueeMap.delete(el);
    try { marqueeRO.unobserve(el); } catch {}
    if (!value) return;
    const span = document.createElement('span');
    span.className = 'marquee-text';
    span.textContent = value;
    el.appendChild(span);
    marqueeMap.set(el, value);
    // Double-rAF so layout has definitely settled (some browsers settle
    // grid/flex sizes on the second frame after content insertion).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        measureMarquee(el, value);
        // Subscribe to future size changes so marquee picks up resize,
        // orientation change, drawer open/close, "See all" toggle, etc.
        marqueeRO.observe(el);
      });
    });
  }

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
    // Subtitle: optional artistLink rendered as a clickable span before the
    // plain-text remainder. Used by album views so the artist name above
    // the Play button navigates to that artist's discography.
    els.heroStat.textContent = '';
    if (h.artistLink && h.artistLink.name) {
      const link = document.createElement('span');
      link.className = 'hero-artist-link';
      link.textContent = h.artistLink.name;
      link.tabIndex = 0;
      link.setAttribute('role', 'link');
      const fire = (e) => { e.stopPropagation(); h.artistLink.onClick?.(); };
      link.addEventListener('click', fire);
      link.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(e); }
      });
      els.heroStat.appendChild(link);
      if (h.subtitle) els.heroStat.appendChild(document.createTextNode(' · ' + h.subtitle));
    } else if (h.subtitle) {
      els.heroStat.textContent = h.subtitle;
    }
    els.heroStat.style.display = h.subtitle || h.artistLink ? '' : 'none';

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
        <div class="ti"><div class="ti-title">${escapeHtml(t.title)}</div><div class="sub">${escapeHtml(t.album || '')}</div></div>
        <div class="plays">${escapeHtml(t.plays || '')}</div>
        <div class="heart${liked ? ' on' : ''}" data-act="like" data-idx="${i}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>
        </div>
        <div class="dur">${escapeHtml(t.duration)}</div>
        <div class="more-c" data-act="more" data-idx="${i}" role="button" aria-label="Track options"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></div>
      `;
      els.trackList.appendChild(row);
    });

    // Marquee EVERY row's title + album so no name ever shows "…".
    // Names that fit sit static; names that overflow scroll horizontally.
    // Trade-off: in a long album the screen has multiple titles drifting
    // simultaneously — accepted because the alternative (ellipsis) was
    // hiding the full track name from the user.
    const rowEls = els.trackList.querySelectorAll('.row');
    rowEls.forEach((row, i) => {
      const t = tracks[i];
      if (!t) return;
      setMarqueeText(row.querySelector('.ti-title'), t.title || '');
      setMarqueeText(row.querySelector('.sub'), t.album || '');
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
      setMarqueeText(els.nowTitle, '—');
      setMarqueeText(els.nowArtist, '');
      setMarqueeText(els.miniTitle, '—');
      setMarqueeText(els.miniArtist, '');
      lastRenderedTrackKey = null;
      return;
    }
    const key = t.id ?? `${t.title}|${t.album}`;
    const trackChanged = key !== lastRenderedTrackKey;
    lastRenderedTrackKey = key;
    setMarqueeText(els.nowTitle, t.title);
    // Prefer the track's own artist (set when loaded from view A) over the
    // current view's hero title, so the transport keeps showing the right
    // artist after the user navigates away.
    const artistLine = t.artist || (visibleIdx() >= 0 ? view.hero?.title : '') || '';
    const artistAlbumLine = artistLine ? `${artistLine} · ${t.album || ''}` : t.album || '';
    setMarqueeText(els.nowArtist, artistAlbumLine);
    els.nowCover.style.background = coverBg(t);
    els.nowCover.classList.toggle('has-art', !!t.artwork);
    els.miniCover.style.background = coverBg(t);
    els.miniCover.classList.toggle('has-art', !!t.artwork);
    setMarqueeText(els.miniTitle, t.title);
    setMarqueeText(els.miniArtist, artistAlbumLine);
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
    renderFullMeta(trackChanged);
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

  function renderFullMeta(trackChanged = false) {
    const t = state.currentTrack;
    if (!t) {
      setMarqueeText(els.nfTitle, '—');
      setMarqueeText(els.nfArtist, '');
      els.nfCover.style.background = '';
      els.nfBg.style.background = '';
      return;
    }
    setMarqueeText(els.nfTitle, t.title || '—');
    // Mirror the now-bar's already-composed "artist · album" line. The
    // marquee setter handles the inner span; reading textContent here
    // returns the visible text regardless of the marquee wrapper.
    setMarqueeText(els.nfArtist, els.nowArtist.textContent);
    // Toggle clickable state — only navigate-able when we know the artist id.
    if (t.artistId && artistNavigator) {
      els.nfArtist.setAttribute('data-clickable', '');
      els.nfArtist.setAttribute('role', 'link');
      els.nfArtist.setAttribute('tabindex', '0');
    } else {
      els.nfArtist.removeAttribute('data-clickable');
      els.nfArtist.removeAttribute('role');
      els.nfArtist.removeAttribute('tabindex');
    }
    // Cover: real artwork if present, else the gradient placeholder. The
    // backdrop uses the same image (heavily blurred via CSS) for the
    // refractive album-art glow behind the centred cover.
    if (t.artwork) {
      els.nfCover.style.background = `url('${t.artwork}') center / cover`;
      els.nfBg.style.background = `url('${t.artwork}') center / cover`;
      sampleAlbumPalette(t.artwork);
    } else {
      els.nfCover.style.background = coverBg(t);
      els.nfBg.style.background = coverBg(t);
      applyFallbackPalette();
    }
    const liked = !!t.id && state.liked.has(t.id);
    els.nfLike.classList.toggle('on', liked);
    els.nfLike.querySelector('svg').setAttribute('fill', liked ? 'currentColor' : 'none');

    // Zoom-in overshoot when a new track loads. Forced reflow between
    // remove + add restarts the keyframe even if the previous one
    // hadn't finished (rapid next/prev presses).
    if (trackChanged) {
      els.nfCover.classList.remove('nf-cover-in');
      void els.nfCover.offsetWidth;
      els.nfCover.classList.add('nf-cover-in');
    }
  }

  // Sample 4 dominant-ish colours from the album cover by drawing it into
  // a tiny canvas and bucketing pixels into a 4×4 grid (top-left,
  // top-right, bottom-left, bottom-right). The four samples get written
  // to CSS variables (--nf-c1..c4) on .nf-blobs and drive the floating
  // blob gradient. Results are cached by URL so revisiting a cover
  // doesn't re-decode the image.
  const paletteCache = new Map();
  let lastPaletteUrl = null;
  function sampleAlbumPalette(url) {
    if (lastPaletteUrl === url) return;
    lastPaletteUrl = url;
    const cached = paletteCache.get(url);
    if (cached) { applyPalette(cached); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 16;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const palette = [
          avgRegion(data, size, 0, 0, size/2, size/2),       // TL
          avgRegion(data, size, size/2, 0, size, size/2),     // TR
          avgRegion(data, size, 0, size/2, size/2, size),     // BL
          avgRegion(data, size, size/2, size/2, size, size),  // BR
        ];
        paletteCache.set(url, palette);
        if (lastPaletteUrl === url) applyPalette(palette);
      } catch {
        // Canvas tainted (CORS not honoured by the host) — keep current
        // blobs rather than blanking the fullscreen.
        applyFallbackPalette();
      }
    };
    img.onerror = () => applyFallbackPalette();
    img.src = url;
  }
  function avgRegion(data, size, x0, y0, x1, y1) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4;
        r += data[i]; g += data[i+1]; b += data[i+2]; n++;
      }
    }
    return `rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`;
  }
  function applyPalette(p) {
    els.nfBlobs.style.setProperty('--nf-c1', p[0]);
    els.nfBlobs.style.setProperty('--nf-c2', p[1]);
    els.nfBlobs.style.setProperty('--nf-c3', p[2]);
    els.nfBlobs.style.setProperty('--nf-c4', p[3]);
  }
  function applyFallbackPalette() {
    applyPalette(['#ff5d8f', '#6ee7ff', '#b388ff', '#ffb088']);
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
    const wasLiked = state.liked.has(id);
    if (wasLiked) state.liked.delete(id);
    else state.liked.add(id);
    persistLikes();
    // Mirror to Spotify library when sync is wired. Fire-and-forget so the
    // heart icon flips instantly; if the API call fails, we log and roll
    // back the local state so the icon stays truthful.
    if (librarySync) {
      const op = wasLiked ? librarySync.remove(id) : librarySync.save(id);
      Promise.resolve(op).catch((err) => {
        console.warn('[Spotify] library sync failed:', err.message);
        if (wasLiked) state.liked.add(id);
        else state.liked.delete(id);
        persistLikes();
        renderTrackSection();
        renderNowPlaying();
      });
    }
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

  // ── Track-row context menu (3-dots) ───────────────────────────────────────
  //
  // Single shared popover, lazily created and re-used across rows. Anchored
  // to the clicked .more-c via fixed positioning + getBoundingClientRect.
  // Items: Add to Queue (Spotify-only), Go to Artist, Like / Unlike,
  // Copy Link, Open in Spotify (Spotify-only). Click outside or Esc closes.

  let rowMenuEl = null;
  let rowMenuClose = null;

  function ensureRowMenu() {
    if (rowMenuEl) return rowMenuEl;
    rowMenuEl = document.createElement('div');
    rowMenuEl.className = 'row-menu';
    rowMenuEl.setAttribute('role', 'menu');
    document.body.appendChild(rowMenuEl);
    return rowMenuEl;
  }

  function closeRowMenu() {
    if (!rowMenuEl) return;
    rowMenuEl.classList.remove('open');
    if (rowMenuClose) {
      document.removeEventListener('mousedown', rowMenuClose, true);
      document.removeEventListener('keydown', rowMenuCloseKey, true);
      window.removeEventListener('scroll', rowMenuClose, true);
      window.removeEventListener('resize', rowMenuClose, true);
      rowMenuClose = null;
    }
  }
  function rowMenuCloseKey(e) {
    if (e.key === 'Escape') closeRowMenu();
  }

  function openRowMenu(idx, anchorEl) {
    const t = tracks[idx];
    if (!t) return;
    // If the menu is already open on this row, toggle closed.
    if (rowMenuEl?.classList.contains('open') && rowMenuEl.dataset.idx === String(idx)) {
      closeRowMenu();
      return;
    }
    closeRowMenu();
    const menu = ensureRowMenu();
    menu.dataset.idx = String(idx);

    const liked = !!t.id && state.liked.has(t.id);
    const items = [];
    if (queueAdder && t.id) {
      items.push({
        label: 'Add to Queue',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h13M3 12h13M3 18h9M19 14v6M16 17h6"/></svg>',
        onClick: () => {
          Promise.resolve(queueAdder(t.id))
            .then(() => console.info(`[Queue] Added "${t.title}"`))
            .catch((err) => console.warn('[Queue] add failed:', err.message));
        },
      });
    }
    if (artistNavigator && t.artistId) {
      items.push({
        label: 'Go to Artist',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>',
        onClick: () => artistNavigator(t.artistId),
      });
    }
    items.push({
      label: liked ? 'Unlike' : 'Like',
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>`,
      onClick: () => toggleLike(idx),
    });
    items.push({
      label: 'Copy Link',
      icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
      onClick: () => {
        const link = t.id ? `https://open.spotify.com/track/${t.id}` : t.title;
        navigator.clipboard?.writeText(link).catch(() => {});
      },
    });
    if (t.id && queueAdder) {
      items.push({
        label: 'Open in Spotify',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
        onClick: () => window.open(`https://open.spotify.com/track/${t.id}`, '_blank', 'noopener'),
      });
    }

    menu.innerHTML = items.map((it, i) => `
      <button class="row-menu-item" data-i="${i}" role="menuitem">
        <span class="row-menu-ic">${it.icon}</span>
        <span>${it.label}</span>
      </button>
    `).join('');

    menu.querySelectorAll('.row-menu-item').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        items[i].onClick();
        closeRowMenu();
      });
    });

    // Position: open below the anchor, right-aligned to it. If the menu
    // would overflow the viewport bottom, flip above.
    menu.classList.add('open');  // un-hide so width/height measure correctly
    const rect = anchorEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 6;
    let top = rect.bottom + margin;
    if (top + menuRect.height > window.innerHeight - 8) {
      top = rect.top - menuRect.height - margin;
    }
    let left = rect.right - menuRect.width;  // right-align to anchor
    if (left < 8) left = 8;
    if (left + menuRect.width > window.innerWidth - 8) {
      left = window.innerWidth - menuRect.width - 8;
    }
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    // Click-outside / Esc / scroll closes.
    rowMenuClose = (e) => {
      if (e && e.type === 'mousedown' && menu.contains(e.target)) return;
      closeRowMenu();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', rowMenuClose, true);
      document.addEventListener('keydown', rowMenuCloseKey, true);
      window.addEventListener('scroll', rowMenuClose, true);
      window.addEventListener('resize', rowMenuClose, true);
    }, 0);
  }

  // ── "See all" toggles — flip a rail from horizontal scroll to a
  // wrapping grid (and back). Each `.more[data-target=...]` controls the
  // rail with the matching id (rail / singlesRail). Toggles a `.grid-mode`
  // class on the rail; CSS swaps the layout.
  document.querySelectorAll('.section-title .more[data-target]').forEach((btn) => {
    const toggle = () => {
      const rail = document.getElementById(btn.dataset.target);
      if (!rail) return;
      const isGrid = rail.classList.toggle('grid-mode');
      btn.textContent = isGrid ? 'Show less' : 'See all';
    };
    btn.addEventListener('click', toggle);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  // ── Wire-up ───────────────────────────────────────────────────────────────

  els.trackList.addEventListener('click', (e) => {
    const heart = e.target.closest('[data-act="like"]');
    if (heart) {
      e.stopPropagation();
      toggleLike(Number(heart.dataset.idx));
      return;
    }
    const more = e.target.closest('[data-act="more"]');
    if (more) {
      e.stopPropagation();
      openRowMenu(Number(more.dataset.idx), more);
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

  // Shuffle + repeat live on BOTH the desktop transport and the fullscreen
  // player. The sync helpers mirror state to both buttons so toggling
  // from either entry point lights up both.
  function syncShuffle() {
    $('shuffle').classList.toggle('on', state.shuffle);
    els.nfShuffle.classList.toggle('on', state.shuffle);
  }
  function syncRepeat() {
    $('repeat').classList.toggle('on', state.repeat);
    els.nfRepeat.classList.toggle('on', state.repeat);
  }
  function toggleShuffle() { state.shuffle = !state.shuffle; syncShuffle(); }
  function toggleRepeat()  { state.repeat  = !state.repeat;  syncRepeat();  }
  $('shuffle').addEventListener('click', toggleShuffle);
  $('repeat').addEventListener('click', toggleRepeat);
  els.nfShuffle.addEventListener('click', toggleShuffle);
  els.nfRepeat.addEventListener('click', toggleRepeat);

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

  // Mobile tab bar is wired in main.js (setupBottomTabbar) so it can
  // route through the same nav.navigate path the sidebar uses.

  // ── Fullscreen now-playing ────────────────────────────────────────────────
  // Tap the transport's now-playing area (desktop) or the minibar (mobile)
  // to expand into the Apple-Music-style fullscreen player. Like icon and
  // mini transport buttons opt out so they don't double-trigger.
  function openFullPlayer() {
    if (!state.currentTrack) return;
    renderFullMeta();
    renderProgress();
    renderPlayIcon();
    // Sync mode toggles in case the user touched them on the desktop
    // transport before opening fullscreen.
    els.nfShuffle.classList.toggle('on', state.shuffle);
    els.nfRepeat.classList.toggle('on', state.repeat);
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
  // Artist line → close fullscreen, then jump to the artist's discography.
  // The handler no-ops when no artistId or no navigator is registered.
  const fireNfArtist = () => {
    const id = state.currentTrack?.artistId;
    if (!id || !artistNavigator) return;
    closeFullPlayer();
    artistNavigator(id);
  };
  els.nfArtist.addEventListener('click', fireNfArtist);
  els.nfArtist.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fireNfArtist(); }
  });
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
    if (e.key === 'Escape') {
      const moreSheet = $('moreSheet');
      if (moreSheet?.classList.contains('open')) {
        e.preventDefault();
        closeMoreSheet();
        return;
      }
      if (els.nowFull.classList.contains('open')) {
        e.preventDefault();
        closeFullPlayer();
      }
    }
  });

  // ── More-options bottom sheet ────────────────────────────────────────────
  // Tapping "..." in the fullscreen player opens a sheet with secondary
  // actions (Lyrics, Queue, Devices, Share). Each item currently just
  // logs and closes — wire actual handlers when those features land.
  const moreSheet = $('moreSheet');
  const msScrim = $('msScrim');
  function openMoreSheet() {
    moreSheet.classList.add('open');
    moreSheet.removeAttribute('inert');
    moreSheet.setAttribute('aria-hidden', 'false');
  }
  function closeMoreSheet() {
    if (moreSheet.contains(document.activeElement)) document.activeElement.blur();
    moreSheet.classList.remove('open');
    moreSheet.setAttribute('inert', '');
    moreSheet.setAttribute('aria-hidden', 'true');
  }
  $('nfMore').addEventListener('click', openMoreSheet);
  msScrim.addEventListener('click', closeMoreSheet);
  moreSheet.querySelectorAll('.ms-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Placeholder — the underlying Lyrics / Queue / Devices / Share
      // features aren't wired yet. Log so the user can confirm the
      // sheet is firing, and close the sheet for now.
      console.log('More action:', btn.dataset.action);
      closeMoreSheet();
    });
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
    setArtistNavigator(fn) {
      artistNavigator = fn;
      // Re-render fullscreen meta so the clickable affordances pick up
      // immediately if the player was already populated before this was wired.
      renderFullMeta();
    },
    // Swap the audio engine after init (e.g. local <audio> → Spotify Web
    // Playback SDK once Premium is confirmed). Re-subscribes time/end
    // listeners and re-loads the currently-loaded track so playback can
    // resume on the new engine if the user hits play.
    setAudioEngine(newEngine) {
      if (!newEngine) return;
      audio = newEngine;
      audio.on('time', (current, duration) => {
        state.progress = duration > 0 ? current / duration : 0;
        lastDuration = duration;
        els.curTime.textContent = formatTime(current);
        els.totTime.textContent = formatTime(duration);
        els.nfCur.textContent = formatTime(current);
        els.nfRem.textContent = formatTime(Math.max(0, duration - current));
        renderProgress();
      });
      audio.on('end', () => {
        if (state.repeat) { state.progress = 0; audio.seek(0); audio.play(); }
        else next();
      });
      audio.setVolume(state.volume);
      if (state.currentTrack) audio.load(state.currentTrack);
    },
    // Wire the heart icon to mirror the user's Spotify library. Each call
    // is fire-and-forget; rollback on failure handled in toggleLikeByTrackId.
    setLibrarySync(sync) {
      librarySync = sync;
      // Hydrate liked state for already-rendered tracks so the icons
      // reflect the user's real library on first paint.
      if (sync?.check && tracks.length) {
        const ids = tracks.map((t) => t.id).filter(Boolean);
        sync.check(ids).then((map) => {
          let changed = false;
          for (const [id, isSaved] of Object.entries(map)) {
            if (isSaved && !state.liked.has(id)) { state.liked.add(id); changed = true; }
          }
          if (changed) {
            persistLikes();
            renderTrackSection();
            renderNowPlaying();
          }
        }).catch((err) => console.warn('[Spotify] initial library check failed:', err.message));
      }
    },
    // Wire add-to-queue. Queue panel UI is a follow-up — this just enables
    // the Web API call. Hook into the More-sheet "Playing Next" or a
    // future right-click affordance.
    setQueueAdder(fn) {
      queueAdder = fn;
    },
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
