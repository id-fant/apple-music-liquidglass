// Thin fetch wrapper for the Spotify Web API. Adds the Bearer auth header
// transparently, refreshing the access token first if it has expired.

import { refreshIfNeeded } from './auth.js';

const BASE = 'https://api.spotify.com';

export async function spotifyFetch(path, params) {
  const token = await refreshIfNeeded();
  if (!token) throw new Error('Not authenticated with Spotify');

  const url = new URL(BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify API ${res.status} ${path}: ${body}`);
  }

  return res.json();
}
