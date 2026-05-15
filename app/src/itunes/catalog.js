// iTunes-backed catalog. Same shape as src/spotify/catalog.js so the rest
// of the app doesn't need to know which source it's reading from.
//
// What's available without auth:
//   ✓ search artists                ✓ artist + top tracks + albums
//   ✓ album with all its tracks     ✓ "trending" (today's top chart artist)
//   ✓ top tracks (Radio)            ✓ new releases (Browse)
//
// Not available (no concept of a "logged-in user" on iTunes):
//   ✗ user profile                  ✗ saved tracks/albums
//   ✗ followed artists              ✗ user playlists / playlist-by-id
//
// The view loaders check for the missing functions and show a friendly
// "Connect Spotify" empty state when an iTunes-only session asks for them.

import { itunesSearch, chartsRequest } from './api.js';
import { nextFeaturedArtist } from '../featured-artists.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function durFromMs(ms) {
  const total = Math.round((ms || 0) / 1000);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

// iTunes artwork URLs end with a size token (e.g. `/100x100bb.jpg`). Replace
// it with the size we actually want — the CDN serves any reasonable size.
function bigArtwork(url, size = 400) {
  if (!url) return null;
  return url.replace(/\d+x\d+bb/, `${size}x${size}bb`);
}

function shapeTrack(s, i = 0) {
  return {
    id: String(s.trackId || s.id || ''),
    n: i + 1,
    title: s.trackName || s.name || '',
    artist: s.artistName || '',
    artistId: String(s.artistId || ''),
    album: s.collectionName || '',
    plays: '',
    duration: durFromMs(s.trackTimeMillis),
    cover: i % 6,
    artwork: bigArtwork(s.artworkUrl100, 200),
    bgColor: null,
    audio: s.previewUrl || '',
  };
}

function shapeAlbum(c) {
  // iTunes appends " - Single" / " - EP" to the release name. Detect the
  // suffix to set a meaningful `type`, and strip it so the visible name is
  // clean (the type drives section placement separately).
  const rawName = c.collectionName || c.name || '';
  const isSingle = / - Single$/i.test(rawName);
  const isEP = / - EP$/i.test(rawName);
  const name = rawName.replace(/ - (Single|EP)$/i, '');
  return {
    id: String(c.collectionId || c.id || ''),
    name,
    artist: c.artistName || '',
    artistId: String(c.artistId || ''),
    year: c.releaseDate?.slice(0, 4) || '',
    type: isSingle ? 'single' : isEP ? 'ep' : 'album',
    artwork: bigArtwork(c.artworkUrl100, 400),
  };
}

function shapeArtist(a, fallbackImage = null) {
  // iTunes artist objects don't carry artwork. Callers fetch one of the
  // artist's albums and pass the album cover here so the hero has a portrait.
  return {
    id: String(a.artistId || a.id || ''),
    name: a.artistName || a.name || '',
    artwork: fallbackImage,
    followers: 0,
    genres: a.primaryGenreName || (Array.isArray(a.genres) ? a.genres[0]?.name || '' : '') || '',
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function searchArtists(query, limit = 8) {
  if (!query?.trim()) return [];
  const res = await itunesSearch('/search', {
    term: query,
    entity: 'musicArtist',
    limit,
  });
  return (res.results || []).map((a) => shapeArtist(a));
}

export async function getArtistFull(artistId) {
  // Two parallel lookups — songs entity returns the artist + top tracks,
  // album entity returns the artist + their releases (we ask for more so
  // there's room for albums AND singles after splitting).
  const [songsRes, albumsRes] = await Promise.all([
    itunesSearch('/lookup', { id: artistId, entity: 'song', limit: 11 }),
    itunesSearch('/lookup', { id: artistId, entity: 'album', limit: 26 }),
  ]);

  const artistObj = songsRes.results?.find((r) => r.wrapperType === 'artist') || {};
  const songs = (songsRes.results || []).filter((r) => r.kind === 'song');
  const releases = (albumsRes.results || [])
    .filter((r) => r.wrapperType === 'collection' || r.collectionType === 'Album')
    .map(shapeAlbum);

  const albums = releases.filter((r) => r.type !== 'single');
  const singles = releases.filter((r) => r.type === 'single');

  // Artist photo stand-in: their first release's cover.
  const fallback = releases[0]?.artwork || null;

  return {
    artist: shapeArtist(artistObj, fallback),
    bgColor: null,
    tracks: songs.slice(0, 10).map((s, i) => shapeTrack(s, i)),
    albums: albums.slice(0, 12),
    singles: singles.slice(0, 12),
  };
}

export async function findArtistByName(query) {
  const list = await searchArtists(query, 1);
  if (!list.length) throw new Error(`No artist found for "${query}"`);
  return getArtistFull(list[0].id);
}

export async function getAlbumFull(albumId) {
  const res = await itunesSearch('/lookup', {
    id: albumId,
    entity: 'song',
    limit: 100,
  });
  const albumObj = res.results?.find((r) => r.wrapperType === 'collection') || {};
  const songs = (res.results || []).filter((r) => r.kind === 'song');

  const tracks = songs.map((s, i) =>
    shapeTrack(
      {
        ...s,
        // Songs in an album lookup may omit artwork; graft from the album.
        collectionName: albumObj.collectionName,
        artworkUrl100: s.artworkUrl100 || albumObj.artworkUrl100,
      },
      i,
    ),
  );

  return { album: shapeAlbum(albumObj), tracks };
}

// "For You" boot view: rotate through the artists Apple is currently
// featuring on the iTunes most-played-songs chart. Cached on the first
// call; each successive call advances by one so the 14s auto-rotation
// cycles through whoever's at the top of the chart this week.
let chartArtistsCache = null;
let chartArtistsIdx = 0;

async function getChartFeaturedArtists() {
  if (chartArtistsCache) return chartArtistsCache;
  try {
    const items = await chartsRequest('songs', 25);
    const seen = new Set();
    const names = [];
    for (const item of items) {
      const name = item.artistName;
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
        if (names.length >= 5) break;
      }
    }
    chartArtistsCache = names;
  } catch {
    chartArtistsCache = [];
  }
  return chartArtistsCache;
}

export async function fetchPrimaryArtist() {
  const names = await getChartFeaturedArtists();
  if (!names.length) {
    // Chart unreachable — fall back to the static rotation.
    return findArtistByName(nextFeaturedArtist());
  }
  const name = names[chartArtistsIdx % names.length];
  chartArtistsIdx++;
  return findArtistByName(name);
}

// Radio view: top songs chart, hydrated with preview URLs via one batch
// `/lookup` call (chart payloads don't include preview URLs themselves).
export async function fetchTopTracks(limit = 20) {
  const items = await chartsRequest('songs', limit);
  const ids = items.map((i) => i.id).filter(Boolean).join(',');
  if (!ids) return [];
  const res = await itunesSearch('/lookup', { id: ids });
  const byId = new Map();
  for (const r of res.results || []) {
    if (r.kind === 'song') byId.set(String(r.trackId), r);
  }
  return items.map((item, i) => {
    const detail = byId.get(item.id);
    if (detail) return shapeTrack(detail, i);
    // Lookup didn't return this one (rare). Return what we have so the row
    // still renders; the engine simulates the timeline with no preview URL.
    return {
      id: item.id,
      n: i + 1,
      title: item.name,
      album: '',
      plays: '',
      duration: '0:30',
      cover: i % 6,
      artwork: bigArtwork(item.artworkUrl100, 200),
      bgColor: null,
      audio: '',
    };
  });
}

// Browse view: top albums chart.
export async function fetchNewReleases(limit = 24) {
  const items = await chartsRequest('albums', limit);
  return items.map((c) => ({
    id: String(c.id),
    name: c.name,
    artist: c.artistName,
    year: c.releaseDate?.slice(0, 4) || '',
    type: 'Album',
    artwork: bigArtwork(c.artworkUrl100, 400),
  }));
}
