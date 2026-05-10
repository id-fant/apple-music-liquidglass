// Default "featured artist" rotation. Each call returns the next name in
// the list. Position is held in memory across calls within a session (so
// an auto-cycler can repeatedly call this and rotate through the list)
// and persisted to localStorage so the next page load continues where the
// last one left off.

export const FEATURED_ARTISTS = ['Kanye West', 'Michael Jackson'];
const KEY = 'lumen.lastFeaturedArtist';

let memoryIdx = -1;

export function nextFeaturedArtist() {
  if (memoryIdx < 0) {
    let last;
    try { last = localStorage.getItem(KEY); } catch { last = null; }
    memoryIdx = FEATURED_ARTISTS.indexOf(last);
  }
  memoryIdx = (memoryIdx + 1) % FEATURED_ARTISTS.length;
  const name = FEATURED_ARTISTS[memoryIdx];
  try { localStorage.setItem(KEY, name); } catch {}
  return name;
}
