// Thin fetch wrappers for two Apple APIs that don't require any auth and
// support CORS, so they can be called directly from the browser:
//
//   1. iTunes Search API   — search/lookup for artists/albums/songs.
//                            https://itunes.apple.com/search, /lookup
//
//   2. Apple Marketing Tools "most-played" charts — daily-updated top
//      songs/albums charts (used to populate Browse and Radio).
//                            https://rss.applemarketingtools.com/api/v2

// In dev we hit Apple's APIs directly — both happen to allow CORS from
// localhost. In production we proxy through Vercel rewrites (see
// vercel.json) because:
//   - rss.marketingtools.apple.com sends no CORS header at all
//   - itunes.apple.com caches a stale CORS header (often pinned to a dev
//     origin like 127.0.0.1:5173) and refuses other origins
// Routing same-origin sidesteps both problems. Vite replaces
// import.meta.env.PROD at build time, so this branch costs nothing at
// runtime.
const SEARCH_BASE = import.meta.env.PROD
  ? `${window.location.origin}/api/itunes`
  : 'https://itunes.apple.com';
const CHART_BASE = import.meta.env.PROD
  ? `${window.location.origin}/api/applecharts`
  : 'https://rss.marketingtools.apple.com/api/v2';

export async function itunesSearch(path, params) {
  const url = new URL(SEARCH_BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes ${res.status} ${path}`);
  return res.json();
}

// `kind` is 'songs' or 'albums', `limit` 1–100.
export async function chartsRequest(kind, limit = 20, country = 'us') {
  const url = `${CHART_BASE}/${country}/music/most-played/${limit}/${kind}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Apple charts ${res.status}`);
  const data = await res.json();
  return data.feed?.results || [];
}
