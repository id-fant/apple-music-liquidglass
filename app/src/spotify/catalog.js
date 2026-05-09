// Spotify Web API helpers — every function returns data already shaped to
// match what player.js and views.js consume.
//
// Shape conventions:
//   Track    { id, n, title, album, plays, duration, cover, artwork, audio }
//   Album    { id, name, artist, year, type, artwork }
//   Artist   { id, name, artwork, followers, genres }
//   Playlist { id, name, artwork, owner, trackCount }

import { spotifyFetch } from './api.js';
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
  const [artist, top, albums] = await Promise.all([
    spotifyFetch(`/v1/artists/${artistId}`),
    spotifyFetch(`/v1/artists/${artistId}/top-tracks`, { market: MARKET }),
    spotifyFetch(`/v1/artists/${artistId}/albums`, {
      include_groups: 'album,single',
      limit: 12,
      market: MARKET,
    }),
  ]);

  return {
    artist: shapeArtist(artist),
    bgColor: null,
    tracks: (top.tracks || []).map(shapeTrack),
    albums: (albums.items || []).map(shapeAlbum),
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

// ── Browse ─────────────────────────────────────────────────────────────────

export async function fetchNewReleases(limit = 24) {
  const res = await spotifyFetch('/v1/browse/new-releases', { limit });
  return (res.albums?.items || []).map(shapeAlbum);
}

// ── Unified-interface aliases (mirrors src/itunes/catalog.js) ──────────────

// Boot view: user's #1 top artist (last 4 weeks). Falls back to medium-term
// then to a popular default if the user has no listening history yet.
export async function fetchPrimaryArtist() {
  const tops = await fetchUserTopArtists(1, 'short_term');
  if (tops.length) return getArtistFull(tops[0].id);
  const longer = await fetchUserTopArtists(1, 'medium_term');
  if (longer.length) return getArtistFull(longer[0].id);
  return findArtistByName(nextFeaturedArtist());
}

// Radio view source. Spotify deprecated /v1/recommendations for new apps,
// so we use the user's own short-term top tracks instead.
export async function fetchTopTracks(limit = 20) {
  return fetchUserTopTracks(limit, 'short_term');
}
