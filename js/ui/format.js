// Number formatting for labels. Uses a real minus sign and thin grouping.
const MINUS = '−';

export function num(x, digits = 0) {
  if (!Number.isFinite(x)) return '—';
  const s = Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (x < 0 && Number(s.replace(/,/g, '')) !== 0 ? MINUS : '') + s;
}
export const signed = (x, digits = 0) => (x > 0 && Number(Math.abs(x).toFixed(digits)) !== 0 ? '+' : '') + num(x, digits);

// A distance in the most readable unit.
export function dist(m, { sign = false } = {}) {
  if (!Number.isFinite(m)) return '—';
  const f = sign ? signed : num;
  const a = Math.abs(m);
  if (a >= 100000) return `${f(m / 1000, 0)} km`;
  if (a >= 10000) return `${f(m / 1000, 1)} km`;
  if (a >= 1000) return `${f(m / 1000, 2)} km`;
  if (a >= 10) return `${f(m, 1)} m`;
  if (a >= 0.01) return `${f(m, 2)} m`;
  if (a >= 1e-3) return `${f(m * 1000, 1)} mm`;
  if (a === 0) return '0 m';
  return 'under 1 mm';
}

// A time in the most readable unit.
export function time(s, { sign = false, digits } = {}) {
  if (!Number.isFinite(s)) return '—';
  const f = sign ? signed : num;
  const a = Math.abs(s);
  if (a >= 1) return `${f(s, digits ?? 3)} s`;
  if (a >= 1e-3) return `${f(s * 1e3, digits ?? 3)} ms`;
  if (a >= 1e-6) return `${f(s * 1e6, digits ?? 2)} µs`;
  if (a === 0) return '0 s';
  return `${f(s * 1e9, digits ?? 1)} ns`;
}

export const pct = (x, digits = 0) => `${num(x * 100, digits)}%`;
