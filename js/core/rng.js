// A seeded random number generator, so every "random" experiment on the site can be repeated
// exactly, and so two set-ups can be compared using the very same noise.
// mulberry32: a tiny, well-known 32-bit generator (public domain, by Tommy Ettinger).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal numbers from uniform ones (Box–Muller transform).
export function gaussianSource(seed) {
  const rand = mulberry32(seed);
  let spare = null;
  return function gauss() {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}
