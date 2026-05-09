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
import { initPlayer, staticArtistView } from './player.js';
import { createViews } from './views.js';
import { mountTweaks } from './tweaks/mount.jsx';

// Spotify's development-mode error message when the developer doesn't have
// Premium. We sniff for it so we can auto-fall-back to iTunes instead of
// leaving the user stuck on a broken authenticated state.
const PREMIUM_BLOCK = 'blocked from accessing the Web API';

async function pickCatalog() {
  if (!isAuthenticated()) return { catalog: itunesCatalog, source: 'itunes' };

  // Probe Spotify with a cheap call (profile) — if Premium gating, scope
  // mismatch, or anything else trips, we fall back to iTunes.
  try {
    await spotifyCatalog.fetchUserProfile();
    return { catalog: spotifyCatalog, source: 'spotify' };
  } catch (err) {
    const msg = String(err?.message || '');
    if (msg.includes(PREMIUM_BLOCK)) {
      console.warn('[Spotify] Premium required for Web API in dev mode — using iTunes fallback.');
      // Clear the stale token so the title-bar button shows "Connect" again.
      logout();
    } else {
      console.warn('[Spotify] API probe failed; using iTunes fallback:', err);
    }
    return { catalog: itunesCatalog, source: 'itunes' };
  }
}

async function boot() {
  await handleCallback();

  const audioEl = document.getElementById('audio');
  const engine = createAudioEngine(audioEl);

  // The static artist view paints first frame instantly; the live data
  // takes over as soon as the catalog returns.
  const fallbackView = staticArtistView({
    artist: { name: STATIC_ARTIST, artwork: null, bgColor: null, genres: '' },
    tracks: STATIC_TRACKS,
  });

  const player = initPlayer({ audio: engine, view: fallbackView });

  const { catalog, source } = await pickCatalog();
  const nav = createNavigator();
  const views = createViews(catalog, nav.navigate);

  setupSignInButton();
  setupTweaksButton();
  setupNavButtons(nav);
  setupSearchBar(player, catalog, views, nav);
  setupSidebarNavigation(player, views, nav);

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
    Promise.resolve(thunk()).catch((err) =>
      console.error('View load failed during navigate:', err),
    );
  };

  const back = () => {
    if (!history.length) return;
    if (current) future.push(current);
    current = history.pop();
    update();
    Promise.resolve(current()).catch((err) =>
      console.error('View load failed during back:', err),
    );
  };

  const forward = () => {
    if (!future.length) return;
    if (current) history.push(current);
    current = future.pop();
    update();
    Promise.resolve(current()).catch((err) =>
      console.error('View load failed during forward:', err),
    );
  };

  return { navigate, back, forward, update };
}

function setupNavButtons(nav) {
  document.getElementById('navBack').addEventListener('click', nav.back);
  document.getElementById('navForward').addEventListener('click', nav.forward);
  nav.update();
}

// ── User profile in title bar ─────────────────────────────────────────────

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
