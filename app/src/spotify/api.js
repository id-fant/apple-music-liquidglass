// Thin fetch wrapper for the Spotify Web API. Adds the Bearer auth header
// transparently, refreshing the access token first if it has expired.

import { refreshIfNeeded } from './auth.js';

const BASE = 'https://api.spotify.com';

// Default GET-with-params signature (preserves existing call sites).
export async function spotifyFetch(path, params) {
  return spotifyRequest('GET', path, { params });
}

// Generic method-aware request. Used by save/unsave/queue/playback endpoints
// that need PUT / POST / DELETE. Many of these return 204 No Content — we
// return null in that case so callers can `await` without parsing.
export async function spotifyRequest(method, path, { params, body } = {}) {
  const token = await refreshIfNeeded();
  if (!token) throw new Error('Not authenticated with Spotify');

  const url = new URL(BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }

  const headers = { Authorization: `Bearer ${token}` };
  let serialisedBody;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    serialisedBody = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: serialisedBody });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Spotify API ${res.status} ${method} ${path}: ${errText}`);
  }

  // 204 No Content — common for save/unsave/queue/transport calls.
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
