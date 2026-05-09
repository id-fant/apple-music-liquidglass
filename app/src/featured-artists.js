// Default "featured artist" rotation. Each call returns the next name in
// the list and remembers the choice in localStorage so the next page load
// picks the other one.

const FEATURED = ['Kanye West', 'Michael Jackson'];
const KEY = 'lumen.lastFeaturedArtist';

export function nextFeaturedArtist() {
  let last;
  try { last = localStorage.getItem(KEY); } catch { last = null; }
  const idx = FEATURED.indexOf(last);
  // If unset (-1) or unrecognised, start at index 0; otherwise advance.
  const next = FEATURED[(idx + 1) % FEATURED.length];
  try { localStorage.setItem(KEY, next); } catch {}
  return next;
}
