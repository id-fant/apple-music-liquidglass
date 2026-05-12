// Applies tweak values to the live page: CSS custom properties drive the
// glass material; the blob backgrounds are direct DOM updates because
// they're not parameterised by CSS variables.

export const PALETTES = {
  aurora:   ['#6ee7ff', '#ff7eb6', '#b388ff', '#7cb8ff', '#ffb6f1'],
  sunset:   ['#ff6b6b', '#ffa94d', '#ffd166', '#ff7eb6', '#b388ff'],
  forest:   ['#2dd4bf', '#7cf2a5', '#52b788', '#1f5f3a', '#0d4f3c'],
  midnight: ['#4a6fff', '#7c5cff', '#3b3b8c', '#1a1f3c', '#5a1d8c'],
  cream:    ['#ffd166', '#ffe29a', '#ffba6b', '#ff9aa2', '#ffc4d6'],
};

// Locked values that are NOT user-tweakable. Any prior tint/accent in
// localStorage from older Tweaks-panel versions is overridden by these —
// the panel no longer exposes either control.
const FIXED_TINT = 0;
const FIXED_ACCENT = '#ff5d8f';

export const DEFAULTS = {
  palette: 'aurora',
  blur: 30,
  saturate: 1.7,
  stroke: 0.16,
};

export function applyTweaks(t) {
  const root = document.documentElement;
  root.style.setProperty('--glass-blur', t.blur + 'px');
  root.style.setProperty('--glass-saturate', t.saturate);
  // Tint and accent are locked — ignore whatever might be in `t`.
  root.style.setProperty('--glass-tint', `rgba(255,255,255,${FIXED_TINT})`);
  root.style.setProperty('--glass-stroke-soft', `rgba(255,255,255,${t.stroke})`);
  root.style.setProperty('--accent', FIXED_ACCENT);

  const colors = PALETTES[t.palette] || PALETTES.aurora;
  document.querySelectorAll('.blob').forEach((b, i) => {
    const c = colors[i % colors.length];
    b.style.background = `radial-gradient(circle, ${c} 0%, transparent 70%)`;
  });
}

const STORAGE_KEY = 'lumen.tweaks';

export function loadStoredTweaks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveStoredTweaks(t) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    // localStorage unavailable (private mode, disabled) — fail silently.
  }
}
