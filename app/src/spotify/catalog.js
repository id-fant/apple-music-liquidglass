// Spotify Web API helpers — every function returns data already shaped to
// match what player.js and views.js consume.
//
// Shape conventions:
//   Track    { id, n, title, album, plays, duration, cover, artwork, audio }
//   Album    { id, name, artist, year, type, artwork }
//   Artist   { id, name, artwork, followers, genres }
//   Playlist { id, name, artwork, owner, trackCount }

import { spotifyFetch, spotifyRequest } from './api.js';
import { nextFeaturedArtist } from '../featured-artists.js';

const MARKET = 'from_token'; // resolves to the connected account's market

function msToDuration(ms) {
  const total = Math.round((ms || 0) / 1000);
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}

function biggestImage(images) {
  return images?.[0]?.url || null;
}

// Pick a mid-sized image so we don't ship a 640px square into a 40px tile.
function mediumImage(images) {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= 200) || sorted[sorted.length - 1]).url;
}

// ── Shape helpers ───────────────────────────────────────────────────────────

function shapeTrack(s, i = 0) {
  return {
    id: s.id,
    n: i + 1,
    title: s.name,
    artist: s.artists?.[0]?.name || '',
    artistId: s.artists?.[0]?.id || '',
    album: s.album?.name || '',
    plays: s.popularity ? `${s.popularity}/100` : '',
    duration: msToDuration(s.duration_ms),
    cover: i % 6,
    artwork: mediumImage(s.album?.images),
    bgColor: null,
    // 30s preview MP3. Spotify removed previews from many tracks in late
    // 2024, so this can be null — engine falls back to a simulated timeline.
    audio: s.preview_url || '',
  };
}

function shapeAlbum(a) {
  return {
    id: a.id,
    name: a.name,
    artist: a.artists?.[0]?.name || '',
    artistId: a.artists?.[0]?.id || '',
    year: a.release_date?.slice(0, 4) || '',
    type: a.album_type || 'album',
    artwork: mediumImage(a.images),
  };
}

function shapeArtist(a) {
  return {
    id: a.id,
    name: a.name,
    artwork: mediumImage(a.images),
    followers: a.followers?.total || 0,
    genres: (a.genres || []).slice(0, 2).join(' · '),
  };
}

function shapePlaylist(p) {
  return {
    id: p.id,
    name: p.name,
    artwork: mediumImage(p.images),
    owner: p.owner?.display_name || '',
    trackCount: p.tracks?.total || 0,
    description: p.description || '',
  };
}

// ── User profile ────────────────────────────────────────────────────────────

export async function fetchUserProfile() {
  const me = await spotifyFetch('/v1/me');
  return {
    id: me.id,
    displayName: me.display_name || me.id,
    email: me.email || '',
    image: biggestImage(me.images),
    product: me.product || 'free',
    country: me.country || '',
  };
}

// ── Search ──────────────────────────────────────────────────────────────────

export async function searchArtists(query, limit = 8) {
  if (!query?.trim()) return [];
  const res = await spotifyFetch('/v1/search', {
    q: query,
    type: 'artist',
    limit,
  });
  return (res.artists?.items || []).map(shapeArtist);
}

// ── Top artists / tracks (last 4 weeks by default) ─────────────────────────

export async function fetchUserTopArtists(limit = 10, time_range = 'short_term') {
  const res = await spotifyFetch('/v1/me/top/artists', { limit, time_range });
  return (res.items || []).map(shapeArtist);
}

export async function fetchUserTopTracks(limit = 20, time_range = 'short_term') {
  const res = await spotifyFetch('/v1/me/top/tracks', { limit, time_range });
  return (res.items || []).map(shapeTrack);
}

// ── Artist detail ──────────────────────────────────────────────────────────

export async function getArtistFull(artistId) {
  // Separate fetches for albums and singles so we get a meaningful sample
  // of each (one shared call with limit:12 would skew to whichever's more
  // recent). Spotify's album_type already distinguishes them.
  const [artist, top, albums, singles] = await Promise.all([
    spotifyFetch(`/v1/artists/${artistId}`),
    spotifyFetch(`/v1/artists/${artistId}/top-tracks`, { market: MARKET }),
    spotifyFetch(`/v1/artists/${artistId}/albums`, {
      include_groups: 'album',
      limit: 12,
      market: MARKET,
    }),
    spotifyFetch(`/v1/artists/${artistId}/albums`, {
      include_groups: 'single',
      limit: 12,
      market: MARKET,
    }),
  ]);

  return {
    artist: shapeArtist(artist),
    bgColor: null,
    tracks: (top.tracks || []).map(shapeTrack),
    albums: (albums.items || []).map(shapeAlbum),
    singles: (singles.items || []).map(shapeAlbum),
  };
}

export async function findArtistByName(query) {
  const list = await searchArtists(query, 1);
  if (!list.length) throw new Error(`No artist found for "${query}"`);
  return getArtistFull(list[0].id);
}

// ── Album detail ───────────────────────────────────────────────────────────

export async function getAlbumFull(albumId) {
  const album = await spotifyFetch(`/v1/albums/${albumId}`, { market: MARKET });
  // Album track items don't carry their own album object — graft the parent
  // album in so artwork resolves.
  const tracks = (album.tracks?.items || []).map((t, i) =>
    shapeTrack({ ...t, album }, i),
  );
  return { album: shapeAlbum(album), tracks };
}

// ── Playlist ───────────────────────────────────────────────────────────────

export async function fetchUserPlaylists(limit = 30) {
  const res = await spotifyFetch('/v1/me/playlists', { limit });
  return (res.items || []).map(shapePlaylist);
}

export async function getPlaylistFull(playlistId) {
  const pl = await spotifyFetch(`/v1/playlists/${playlistId}`, { market: MARKET });
  const tracks = (pl.tracks?.items || [])
    .filter((item) => item.track && !item.is_local) // skip local + null
    .map((item, i) => shapeTrack(item.track, i));
  return { playlist: shapePlaylist(pl), tracks };
}

// ── Library ────────────────────────────────────────────────────────────────

export async function fetchSavedTracks(limit = 30) {
  const res = await spotifyFetch('/v1/me/tracks', { limit, market: MARKET });
  return (res.items || []).map((item, i) => shapeTrack(item.track, i));
}

export async function fetchSavedAlbums(limit = 30) {
  const res = await spotifyFetch('/v1/me/albums', { limit, market: MARKET });
  return (res.items || []).map((item) => shapeAlbum(item.album));
}

export async function fetchFollowedArtists(limit = 30) {
  const res = await spotifyFetch('/v1/me/following', { type: 'artist', limit });
  return (res.artists?.items || []).map(shapeArtist);
}

// ── Library save/unsave/check (heart-icon sync) ────────────────────────────
//
// Spotify's "Liked Songs" — these mutate the user's library and require the
// `user-library-modify` scope. The check endpoint returns a parallel array
// of booleans for whichever ids we pass.

export async function saveTracks(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  if (!list.length) return;
  // Max 50 ids per call per Spotify spec.
  for (let i = 0; i < list.length; i += 50) {
    await spotifyRequest('PUT', '/v1/me/tracks', {
      params: { ids: list.slice(i, i + 50).join(',') },
    });
  }
}

export async function removeSavedTracks(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  if (!list.length) return;
  for (let i = 0; i < list.length; i += 50) {
    await spotifyRequest('DELETE', '/v1/me/tracks', {
      params: { ids: list.slice(i, i + 50).join(',') },
    });
  }
}

// Returns an object keyed by id → boolean. Batches into 50s.
export async function checkSavedTracks(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  const out = {};
  if (!list.length) return out;
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const result = await spotifyFetch('/v1/me/tracks/contains', {
      ids: batch.join(','),
    });
    batch.forEach((id, idx) => { out[id] = !!result[idx]; });
  }
  return out;
}

// ── Playback (transport / queue / state) ───────────────────────────────────
//
// Use the user's connected device — the Web Playback SDK registers our
// browser as a Spotify Connect device, and these helpers control whichever
// device is currently active. Passing `deviceId` targets a specific one
// (e.g. our SDK's device) instead of the user's last-used.

export async function transferPlayback(deviceId, play = true) {
  await spotifyRequest('PUT', '/v1/me/player', {
    body: { device_ids: [deviceId], play },
  });
}

export async function playTracks({ uris, contextUri, offset, positionMs, deviceId } = {}) {
  const body = {};
  if (uris) body.uris = uris;
  if (contextUri) body.context_uri = contextUri;
  if (offset != null) body.offset = typeof offset === 'number' ? { position: offset } : offset;
  if (positionMs != null) body.position_ms = positionMs;
  const params = deviceId ? { device_id: deviceId } : null;
  await spotifyRequest('PUT', '/v1/me/player/play', { params, body });
}

export async function pausePlayback(deviceId) {
  const params = deviceId ? { device_id: deviceId } : null;
  await spotifyRequest('PUT', '/v1/me/player/pause', { params });
}

export async function nextTrack(deviceId) {
  const params = deviceId ? { device_id: deviceId } : null;
  await spotifyRequest('POST', '/v1/me/player/next', { params });
}

export async function previousTrack(deviceId) {
  const params = deviceId ? { device_id: deviceId } : null;
  await spotifyRequest('POST', '/v1/me/player/previous', { params });
}

export async function seekTo(positionMs, deviceId) {
  const params = { position_ms: Math.max(0, Math.round(positionMs)) };
  if (deviceId) params.device_id = deviceId;
  await spotifyRequest('PUT', '/v1/me/player/seek', { params });
}

export async function setVolume(volumePercent, deviceId) {
  const params = { volume_percent: Math.max(0, Math.min(100, Math.round(volumePercent))) };
  if (deviceId) params.device_id = deviceId;
  await spotifyRequest('PUT', '/v1/me/player/volume', { params });
}

export async function addToQueue(trackUri, deviceId) {
  const params = { uri: trackUri };
  if (deviceId) params.device_id = deviceId;
  await spotifyRequest('POST', '/v1/me/player/queue', { params });
}

export async function fetchPlaybackState() {
  // Returns null when no active device — caller treats as "nothing playing".
  return spotifyFetch('/v1/me/player', { market: MARKET });
}

export async function fetchQueue() {
  // Returns { currently_playing, queue: [tracks] }. Shape the queue items
  // through the existing shapeTrack so the UI consumes the familiar form.
  const res = await spotifyFetch('/v1/me/player/queue');
  return {
    currentlyPlaying: res?.currently_playing ? shapeTrack(res.currently_playing) : null,
    queue: (res?.queue || []).map((t, i) => shapeTrack(t, i)),
  };
}

// ── Browse ─────────────────────────────────────────────────────────────────

export async function fetchNewReleases(limit = 24) {
  const res = await spotifyFetch('/v1/browse/new-releases', { limit });
  return (res.albums?.items || []).map(shapeAlbum);
}

// ── Unified-interface aliases (mirrors src/itunes/catalog.js) ──────────────

// User's top artist for the For You banner. Cached so revisits don't
// re-hit /v1/me/top/artists. We deliberately do NOT rotate — the showcased
// artist is Spotify's pick for this user and should stay consistent.
let topArtistCache = null;

async function getTopArtist() {
  if (topArtistCache) return topArtistCache;
  const short = await fetchUserTopArtists(1, 'short_term');
  if (short.length) { topArtistCache = short[0]; return topArtistCache; }
  const medium = await fetchUserTopArtists(1, 'medium_term');
  if (medium.length) { topArtistCache = medium[0]; return topArtistCache; }
  return null;
}

export async function fetchPrimaryArtist() {
  const top = await getTopArtist();
  if (!top) {
    // No listening history — fall back to the static rotation so the page
    // still has something to show.
    return findArtistByName(nextFeaturedArtist());
  }
  return getArtistFull(top.id);
}

// Radio view source. Spotify deprecated /v1/recommendations for new apps,
// so we use the user's own short-term top tracks instead.
export async function fetchTopTracks(limit = 20) {
  return fetchUserTopTracks(limit, 'short_term');
}
