// Spotify Authorization Code with PKCE flow — the browser-safe variant of
// OAuth that doesn't require a client secret. Tokens are stored in
// localStorage and refreshed transparently when expired.
//
// Flow at a glance:
//   1. User clicks "Connect" → startAuth()
//      generates a random `code_verifier`, stores it in sessionStorage,
//      sends the user to accounts.spotify.com with the SHA-256 challenge.
//   2. Spotify redirects back to our origin with `?code=...`.
//   3. handleCallback() exchanges the code + verifier for an access token
//      (and a refresh token), stores them, strips the query string.
//   4. refreshIfNeeded() swaps a stale access token for a fresh one using
//      the refresh token, automatically.

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;

// Trailing slash is significant — Spotify matches redirect URIs literally.
// The same value must be registered in the Spotify dashboard.
const REDIRECT_URI = window.location.origin + '/';

// `streaming` is for the Web Playback SDK (full songs, Premium-only).
// `user-library-modify` enables save/unsave tracks (heart icon syncs).
// `user-modify-playback-state` enables transport control + queue adds.
// `user-read-playback-state` is required for current playback / queue reads.
const SCOPES = [
  'user-read-private',
  'user-read-email',
  'streaming',
  'user-top-read',
  'user-library-read',
  'user-library-modify',
  'user-follow-read',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
];

const KEYS = {
  access: 'spotify.access_token',
  refresh: 'spotify.refresh_token',
  expiresAt: 'spotify.expires_at',
  verifier: 'spotify.code_verifier',
};

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const AUTH_URL = 'https://accounts.spotify.com/authorize';

// ── PKCE helpers ────────────────────────────────────────────────────────────

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function sha256(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// ── Public API ──────────────────────────────────────────────────────────────

export function isConfigured() {
  return !!CLIENT_ID;
}

export function isAuthenticated() {
  const expiresAt = Number(localStorage.getItem(KEYS.expiresAt) || 0);
  return Date.now() < expiresAt && !!localStorage.getItem(KEYS.access);
}

export async function startAuth() {
  if (!CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set');

  const verifier = randomString(64);
  const challenge = base64url(await sha256(verifier));
  sessionStorage.setItem(KEYS.verifier, verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES.join(' '),
  });

  window.location.href = `${AUTH_URL}?${params}`;
}

// Call once at boot. If the URL has `?code=...` we're returning from Spotify;
// exchange the code for tokens and clean the URL. Otherwise no-op.
export async function handleCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    console.warn('Spotify auth error:', error);
    cleanUrl();
    return false;
  }
  if (!code) return false;

  const verifier = sessionStorage.getItem(KEYS.verifier);
  if (!verifier) {
    console.warn('Missing PKCE verifier; restart the auth flow.');
    cleanUrl();
    return false;
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    console.error('Spotify token exchange failed:', await res.text());
    cleanUrl();
    return false;
  }

  storeTokens(await res.json());
  sessionStorage.removeItem(KEYS.verifier);
  cleanUrl();
  return true;
}

// Returns a valid access token, refreshing transparently if expired. Returns
// null when the user has no refresh token (i.e. never connected).
export async function refreshIfNeeded() {
  if (isAuthenticated()) return localStorage.getItem(KEYS.access);

  const refreshToken = localStorage.getItem(KEYS.refresh);
  if (!refreshToken || !CLIENT_ID) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    // Refresh tokens can be revoked from Spotify's side — clear local state
    // so the next `isAuthenticated()` call returns false and the UI prompts
    // for a fresh sign-in.
    logout();
    return null;
  }

  const data = await res.json();
  storeTokens(data);
  return data.access_token;
}

export function logout() {
  localStorage.removeItem(KEYS.access);
  localStorage.removeItem(KEYS.refresh);
  localStorage.removeItem(KEYS.expiresAt);
}

// ── Internals ───────────────────────────────────────────────────────────────

function storeTokens({ access_token, refresh_token, expires_in }) {
  localStorage.setItem(KEYS.access, access_token);
  // Spotify only includes refresh_token on the initial exchange; subsequent
  // refresh responses sometimes omit it (the existing one stays valid).
  if (refresh_token) localStorage.setItem(KEYS.refresh, refresh_token);
  localStorage.setItem(
    KEYS.expiresAt,
    String(Date.now() + (expires_in - 30) * 1000), // 30s safety buffer
  );
}

function cleanUrl() {
  history.replaceState({}, '', window.location.pathname);
}
