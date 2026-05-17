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

// ── In-memory cache + request deduplication ────────────────────────────────
//
// The same iTunes URLs get hit repeatedly: navigating into an artist and
// back, re-rendering For You, the same artist showing up on multiple
// charts, etc. Each call cost 200-800ms on cold connections. We cache the
// parsed JSON keyed by full URL with a generous TTL, and dedupe concurrent
// requests for the same URL into a single Promise so rapid-fire navigation
// doesn't fan out into duplicate network calls.
//
// TTLs are tuned per-feed: search/lookup data is stable enough to keep
// for 15 minutes; the daily charts only refresh once a day so we cache
// them for an hour.

const cache = new Map();      // url → { data, expiresAt }
const inFlight = new Map();   // url → Promise (deduped)

const TTL_SEARCH_MS = 15 * 60 * 1000;
const TTL_CHARTS_MS = 60 * 60 * 1000;

// Soft cap so memory doesn't drift forever if the user explores hundreds
// of artists. Oldest entries evicted first (Map iteration is insertion
// order, so the first entries we delete are the longest-stale).
const MAX_ENTRIES = 200;
function evictIfFull() {
  if (cache.size <= MAX_ENTRIES) return;
  const toEvict = cache.size - MAX_ENTRIES;
  let i = 0;
  for (const k of cache.keys()) {
    if (i++ >= toEvict) break;
    cache.delete(k);
  }
}

async function cachedJSON(url, ttlMs, label) {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expiresAt > now) return hit.data;

  // Dedup: if a request for the same URL is already in flight, await its
  // result instead of starting a second one. Critical when the same URL
  // gets hit from two places near-simultaneously (e.g. setView + a side
  // fetch race on initial load).
  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${label} ${res.status}`);
      const data = await res.json();
      cache.set(url, { data, expiresAt: Date.now() + ttlMs });
      evictIfFull();
      return data;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, promise);
  return promise;
}

export async function itunesSearch(path, params) {
  const url = new URL(SEARCH_BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  return cachedJSON(url.toString(), TTL_SEARCH_MS, `iTunes ${path}`);
}

// `kind` is 'songs' or 'albums', `limit` 1–100.
export async function chartsRequest(kind, limit = 20, country = 'us') {
  const url = `${CHART_BASE}/${country}/music/most-played/${limit}/${kind}.json`;
  const data = await cachedJSON(url, TTL_CHARTS_MS, 'Apple charts');
  return data.feed?.results || [];
}
