import './styles.css';
import { TRACKS as STATIC_TRACKS, ARTIST as STATIC_ARTIST } from './tracks.js';
import {
  isConfigured,
  isAuthenticated,
  handleCallback,
  startAuth,
  logout,
} from './spotify/auth.js';
import * as spotifyCatalog from './spotify/catalog.js';
import * as itunesCatalog from './itunes/catalog.js';
import { createAudioEngine } from './audio-engine.js';
import { createSpotifyEngine } from './spotify/playback.js';
import { initPlayer, staticArtistView } from './player.js';
import { createViews } from './views.js';
import { mountTweaks } from './tweaks/mount.jsx';

// Spotify's development-mode error messages when the app owner doesn't have
// Premium. Spotify has rotated this wording at least twice — match both
// known variants (and any future "premium…required" text) by lowercased
// substring so we can auto-fall-back to iTunes with the right messaging.
const PREMIUM_BLOCK_PATTERNS = [
  'blocked from accessing the web api',
  'premium subscription required',
];
function isPremiumBlock(msg) {
  const lc = String(msg || '').toLowerCase();
  return PREMIUM_BLOCK_PATTERNS.some((p) => lc.includes(p));
}

async function pickCatalog() {
  if (!isAuthenticated()) return { catalog: itunesCatalog, source: 'itunes', authBlocked: null };

  // Probe Spotify with a cheap call (profile) — if Premium gating, scope
  // mismatch, or anything else trips, we fall back to iTunes for the
  // general catalog but record WHY so the library views can explain it.
  try {
    await spotifyCatalog.fetchUserProfile();
    return { catalog: spotifyCatalog, source: 'spotify', authBlocked: null };
  } catch (err) {
    const msg = String(err?.message || '');
    if (isPremiumBlock(msg)) {
      console.warn('[Spotify] Premium required for Web API in dev mode — using iTunes fallback.');
      // Keep the tokens. The user is still authenticated; the Web API just
      // won't talk to them. Logging them out here was misleading — they'd
      // see the "Connect Spotify" prompt right after connecting, with no
      // hint that Premium is the actual requirement.
      return { catalog: itunesCatalog, source: 'itunes', authBlocked: 'premium' };
    }
    console.warn('[Spotify] API probe failed; using iTunes fallback:', err);
    return { catalog: itunesCatalog, source: 'itunes', authBlocked: 'error' };
  }
}

async function boot() {
  await handleCallback();

  const audioEl = document.getElementById('audio');
  // Start with the local-audio engine so the first paint has SOMETHING to
  // hand to player.js — we swap in the Spotify engine after we know the
  // user is in Spotify mode (Premium accepted). Swap-out is handled by
  // player.setAudioEngine() below.
  let engine = createAudioEngine(audioEl);

  // The static artist view paints first frame instantly; the live data
  // takes over as soon as the catalog returns.
  const fallbackView = staticArtistView({
    artist: { name: STATIC_ARTIST, artwork: null, bgColor: null, genres: '' },
    tracks: STATIC_TRACKS,
  });

  const player = initPlayer({ audio: engine, view: fallbackView });

  const { catalog, source, authBlocked } = await pickCatalog();
  const nav = createNavigator();
  const views = createViews(catalog, nav.navigate, { authBlocked, source });

  // Spotify Premium path: replace the local <audio>-based engine with the
  // Web Playback SDK so full songs (not 30s previews) play through the
  // browser as a Spotify Connect device. If the SDK init fails for any
  // reason (no Premium, network, blocked), we stay on the local engine
  // and the user still gets the preview-based experience.
  if (source === 'spotify') {
    createSpotifyEngine()
      .then((spotifyEngine) => {
        player.setAudioEngine(spotifyEngine);
        console.info('[Spotify] Web Playback SDK ready — full songs enabled.');
      })
      .catch((err) => {
        console.warn('[Spotify] Web Playback SDK init failed:', err.message);
      });
    // Tell the player to sync likes against the user's Spotify library
    // (replaces the localStorage-only behaviour for iTunes mode).
    player.setLibrarySync({
      save: (id) => catalog.saveTracks([id]),
      remove: (id) => catalog.removeSavedTracks([id]),
      check: (ids) => catalog.checkSavedTracks(ids),
    });
    // Add-to-queue API hookup. Queue panel UI is a follow-up build.
    player.setQueueAdder((id) => catalog.addToQueue(`spotify:track:${id}`));
  }

  // Wire fullscreen artist-line → artist discography navigation. Done here
  // (not at initPlayer) because views + nav don't exist that early.
  player.setArtistNavigator((id) => nav.navigate(() => views.artist(id, player)));

  setupSignInButton();
  setupTweaksButton();
  setupNavButtons(nav);
  setupSearchBar(player, catalog, views, nav);
  setupSidebarNavigation(player, views, nav);
  setupBottomTabbar(player, views, nav);
  setupViewportTracking();

  // Boot view — works on either catalog.
  nav.navigate(() => views.byView['for-you'](player));

  // Spotify-only side fetches (profile + playlists). Skip in iTunes mode.
  if (source === 'spotify') {
    spotifyCatalog
      .fetchUserProfile()
      .then(hydrateUserProfile)
      .catch((err) => console.warn('Profile fetch failed:', err));
    spotifyCatalog
      .fetchUserPlaylists(30)
      .then((playlists) => renderUserPlaylists(playlists, player, views, nav))
      .catch((err) => console.warn('Playlists fetch failed:', err));
  } else if (authBlocked) {
    // User connected Spotify but the Web API rejects them (Premium-only in
    // dev mode, or transient error). We can't fetch /v1/me to get their
    // real name/photo, so replace the demo "Elena" placeholder with an
    // honest "Spotify (Premium required)" status instead of leaving the
    // stub identity in place.
    hydrateBlockedProfile(authBlocked);
    renderBlockedPlaylists(authBlocked);
  }

  mountTweaks(document.getElementById('tweaks-root'));
}

// ── Title bar buttons ─────────────────────────────────────────────────────

function setupSignInButton() {
  const btn = document.getElementById('signInBtn');
  if (!isConfigured()) return;
  btn.style.display = '';
  if (isAuthenticated()) {
    btn.title = 'Disconnect Spotify';
    btn.addEventListener('click', () => {
      logout();
      location.reload();
    });
  } else {
    btn.title = 'Connect Spotify';
    btn.addEventListener('click', () => {
      startAuth().catch((err) => console.error('Auth start failed:', err));
    });
  }
}

function setupTweaksButton() {
  document.getElementById('tweaksBtn').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('tweaks:toggle'));
  });
}

// Detects the real visible viewport width (window.innerWidth — excludes the
// scrollbar in browsers where 100vw includes it) and publishes it as the
// CSS custom property --device-w on :root. Re-runs on every resize and
// orientation change so layout-dependent caps (e.g. the playing-row title
// max-width in styles.css) always match the actual device dimensions.
// rAF-throttled so a fast drag of the browser window doesn't fire thousands
// of style recalcs.
function setupViewportTracking() {
  let pending = false;
  const sync = () => {
    pending = false;
    document.documentElement.style.setProperty('--device-w', `${window.innerWidth}px`);
    document.documentElement.style.setProperty('--device-h', `${window.innerHeight}px`);
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(sync);
  };
  sync();
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
}

// ── Navigation history (browser-style back/forward) ───────────────────────

function createNavigator() {
  // Each entry is a "thunk" — a zero-arg function that re-runs a view load.
  // History is the past, future is what was undone with back() (so we can
  // redo it with forward()).
  const history = [];
  const future = [];
  let current = null;

  const update = () => {
    document.getElementById('navBack').disabled = history.length === 0;
    document.getElementById('navForward').disabled = future.length === 0;
  };

  const navigate = (thunk) => {
    if (current) history.push(current);
    current = thunk;
    future.length = 0; // any new navigation invalidates the redo stack
    update();
    // Optimistic outgoing animation — fires before the (often network-bound)
    // loader resolves. Without this, clicking an album reads as "nothing
    // happened" until the request returns. See setView() for the handoff to
    // .view-entering.
    flashLeaving();
    Promise.resolve(thunk()).catch((err) => handleLoaderError('navigate', err));
  };

  const flashLeaving = () => {
    const main = document.querySelector('.main');
    if (!main) return;
    main.classList.remove('view-leaving');
    void main.offsetWidth;
    main.classList.add('view-leaving');
  };

  // Whenever a loader fails (network error, etc), strip the leaving class
  // so the user isn't staring at a dimmed/blurred page with no recovery.
  const handleLoaderError = (label, err) => {
    console.error(`View load failed during ${label}:`, err);
    document.querySelector('.main')?.classList.remove('view-leaving');
  };

  const back = () => {
    if (!history.length) return;
    if (current) future.push(current);
    current = history.pop();
    update();
    flashLeaving();
    Promise.resolve(current()).catch((err) => handleLoaderError('back', err));
  };

  const forward = () => {
    if (!future.length) return;
    if (current) history.push(current);
    current = future.pop();
    update();
    flashLeaving();
    Promise.resolve(current()).catch((err) => handleLoaderError('forward', err));
  };

  return { navigate, back, forward, update };
}

function setupNavButtons(nav) {
  document.getElementById('navBack').addEventListener('click', nav.back);
  document.getElementById('navForward').addEventListener('click', nav.forward);
  nav.update();
}

// ── User profile in title bar ─────────────────────────────────────────────

// Title-bar fallback for when the user IS authenticated to Spotify but the
// Web API won't talk to them (Premium-only in dev mode, scope mismatch,
// transient error). We have no profile data to show, but we shouldn't lie
// by leaving the "Elena" demo placeholder either.
function hydrateBlockedProfile(reason) {
  const av = document.getElementById('userAv');
  const nm = document.getElementById('userNm');
  const pill = document.getElementById('userPill');
  if (pill) pill.title = reason === 'premium'
    ? 'Spotify connected — Premium required for Web API in development mode'
    : 'Spotify connected — Web API not reachable';
  if (nm) nm.textContent = reason === 'premium' ? 'Premium required' : 'API offline';
  if (av) {
    // Spotify green disc with a generic glyph; clear any prior bg image.
    av.style.background = '#1ed760';
    av.style.color = '#0a1018';
    av.textContent = '♪';
  }
}

function hydrateUserProfile(profile) {
  const av = document.getElementById('userAv');
  const nm = document.getElementById('userNm');
  nm.textContent = profile.displayName || 'You';
  if (profile.image) {
    av.style.background = `url('${profile.image}') center / cover`;
    av.textContent = '';
  } else {
    const initials = (profile.displayName || 'You')
      .split(' ')
      .map((s) => s[0] || '')
      .slice(0, 2)
      .join('')
      .toUpperCase();
    av.textContent = initials || 'U';
  }
}

// ── Sidebar: user playlists ───────────────────────────────────────────────

// Replaces the stub demo playlists in the sidebar with a "blocked" notice
// when the user is connected to Spotify but the Web API won't talk to them
// (Premium gating in dev mode, or any other probe failure).
function renderBlockedPlaylists(reason) {
  const section = document.getElementById('playlistSection');
  if (!section) return;
  const header = section.querySelector('h6');
  section.innerHTML = '';
  if (header) section.appendChild(header);

  const note = document.createElement('div');
  note.className = 'side-item';
  note.style.color = 'var(--fg-mute)';
  note.style.cursor = 'default';
  note.style.flexDirection = 'column';
  note.style.alignItems = 'flex-start';
  note.style.gap = '4px';
  note.style.lineHeight = '1.3';
  note.innerHTML = reason === 'premium'
    ? '<div style="font-size:12px;font-weight:600;color:var(--fg-dim)">Spotify Premium required</div>'
      + '<div style="font-size:11px">Free accounts can\'t use the Web API in development mode.</div>'
    : '<div style="font-size:12px;font-weight:600;color:var(--fg-dim)">Spotify unavailable</div>'
      + '<div style="font-size:11px">Couldn\'t reach the Web API. Try again later.</div>';
  section.appendChild(note);
}

function renderUserPlaylists(playlists, player, views, nav) {
  const section = document.getElementById('playlistSection');
  if (!section) return;
  const header = section.querySelector('h6');
  section.innerHTML = '';
  if (header) section.appendChild(header);

  if (!playlists.length) {
    const empty = document.createElement('div');
    empty.className = 'side-item';
    empty.style.color = 'var(--fg-mute)';
    empty.textContent = 'No playlists yet';
    section.appendChild(empty);
    return;
  }

  for (const p of playlists) {
    const item = document.createElement('div');
    item.className = 'side-item';
    item.dataset.playlistId = p.id;
    const cover = document.createElement('span');
    cover.className = 'pl-cv';
    if (p.artwork) {
      cover.style.backgroundImage = `url('${p.artwork}')`;
    } else {
      cover.style.background = gradientFor(p.name);
    }
    item.appendChild(cover);
    item.appendChild(document.createTextNode(p.name));
    item.title = `${p.name} — ${p.trackCount} tracks${p.owner ? ` · ${p.owner}` : ''}`;
    item.addEventListener('click', () => {
      selectSidebarItem(item);
      closeMobileDrawer();
      nav.navigate(() => views.playlist(p.id, player));
    });
    section.appendChild(item);
  }
}

// ── Sidebar nav ───────────────────────────────────────────────────────────

function setupSidebarNavigation(player, views, nav) {
  document.querySelectorAll('[data-view]').forEach((el) => {
    el.addEventListener('click', () => {
      const viewName = el.dataset.view;
      const loader = views.byView[viewName];
      selectSidebarItem(el);
      closeMobileDrawer();
      if (loader) nav.navigate(() => loader(player));
    });
  });
}

function selectSidebarItem(target) {
  document.querySelectorAll('.side-item').forEach((x) => x.classList.remove('on'));
  target.classList.add('on');
  // Mirror to the bottom tabbar so the active tab stays in sync when the
  // user navigates from the drawer instead of the tabbar itself.
  const view = target.dataset.view;
  if (view) {
    document.querySelectorAll('.tabbar button[data-view]').forEach((b) => {
      b.classList.toggle('on', b.dataset.view === view);
    });
  }
}

// Bottom tabbar — proxies clicks through the same nav.navigate path the
// sidebar uses so view changes feel identical from either entry point.
// Visual feedback is instant: the .on class flips before the (often
// network-bound) loader resolves.
function setupBottomTabbar(player, views, nav) {
  const tabs = document.querySelectorAll('.tabbar button');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('on'));
      btn.classList.add('on');

      // Search tab: focus the global search input. On phones the input is
      // in the titlebar, so it's already visible — just grab focus.
      if (btn.dataset.action === 'search') {
        const input = document.getElementById('searchInput');
        input?.focus();
        input?.select?.();
        return;
      }

      const viewName = btn.dataset.view;
      const loader = views.byView[viewName];
      if (!loader) return;
      // Also light up the matching sidebar item so the drawer reflects
      // the current view if the user opens it next.
      const sideItem = document.querySelector(`.side-item[data-view="${viewName}"]`);
      if (sideItem) {
        document.querySelectorAll('.side-item').forEach((x) => x.classList.remove('on'));
        sideItem.classList.add('on');
      }
      nav.navigate(() => loader(player));
    });
  });
}

function closeMobileDrawer() {
  document.getElementById('side')?.classList.remove('open');
  document.getElementById('scrim')?.classList.remove('show');
}

// ── Search bar ────────────────────────────────────────────────────────────

function setupSearchBar(player, catalog, views, nav) {
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');

  let timer = null;
  let lastQuery = '';

  const close = () => results.classList.remove('open');
  const showEmpty = (text) => {
    results.innerHTML = `<div class="empty">${escapeHtml(text)}</div>`;
    results.classList.add('open');
  };
  const renderResults = (artists) => {
    if (!artists.length) return showEmpty('No artists found');
    results.innerHTML = artists
      .map(
        (a) => `
          <div class="item" data-artist-id="${a.id}">
            <div class="av" style="${a.artwork ? `background-image:url('${a.artwork}')` : ''}"></div>
            <div class="info">
              <div class="nm">${escapeHtml(a.name)}</div>
              <div class="meta">${a.followers ? a.followers.toLocaleString() + ' followers' : ''}${a.genres ? (a.followers ? ' · ' : '') + escapeHtml(a.genres) : ''}</div>
            </div>
          </div>
        `,
      )
      .join('');
    results.classList.add('open');
  };

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (!q) return close();
    timer = setTimeout(async () => {
      lastQuery = q;
      try {
        const artists = await catalog.searchArtists(q, 8);
        if (q !== lastQuery) return; // out-of-order response
        renderResults(artists);
      } catch (err) {
        console.error('Search failed:', err);
        showEmpty('Search failed — see console');
      }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#globalSearch')) close();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      close();
      input.blur();
    }
  });

  results.addEventListener('click', (e) => {
    const item = e.target.closest('[data-artist-id]');
    if (!item) return;
    close();
    input.value = '';
    nav.navigate(() => views.artist(item.dataset.artistId, player));
  });
}

// ── Misc ──────────────────────────────────────────────────────────────────

const PLAYLIST_GRADIENTS = [
  'linear-gradient(135deg,#ff5d8f,#ffb088)',
  'linear-gradient(135deg,#6ee7ff,#3b6cff)',
  'linear-gradient(135deg,#7cf2a5,#0d4f3c)',
  'linear-gradient(135deg,#ffd166,#ef476f)',
  'linear-gradient(135deg,#b388ff,#5a1d8c)',
  'linear-gradient(135deg,#a0e7ff,#1a3b6b)',
];

function gradientFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return PLAYLIST_GRADIENTS[Math.abs(h) % PLAYLIST_GRADIENTS.length];
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

boot();
