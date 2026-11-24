// Read the colour tokens from CSS so canvases follow light/dark mode.
const NAMES = ['bg', 'surface', 'surface-2', 'surface-3', 'ink', 'ink-2', 'muted', 'line', 'line-strong', 'accent',
  'accent-ink', 'accent-soft', 'true', 'good', 'good-soft', 'warn', 'warn-soft', 'bad', 'bad-soft', 'space', 'space-2',
  'space-ink', 'earth-1', 'earth-2', 'ground', 'ground-line', 'sky', 'grid', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

let cache = null;
export function palette() {
  if (cache) return cache;
  const cs = getComputedStyle(document.documentElement);
  cache = {};
  for (const n of NAMES) cache[n.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = cs.getPropertyValue(`--${n}`).trim();
  cache.sat = [cache.s1, cache.s2, cache.s3, cache.s4, cache.s5, cache.s6, cache.s7, cache.s8];
  cache.dark = cs.getPropertyValue('color-scheme').trim() === 'dark';
  return cache;
}

const listeners = new Set();
export function onThemeChange(fn) { listeners.add(fn); }
export function themeChanged() {
  cache = null;
  listeners.forEach((fn) => fn());
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);

// Colour with alpha from a #rrggbb token.
export function alpha(hex, a) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
