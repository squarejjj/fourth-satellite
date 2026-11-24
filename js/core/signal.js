// How a receiver times a signal.
// Every GPS satellite sends the same frequency but its own 1,023-chip code, repeated every
// millisecond (CDMA). The receiver generates its own copy of the code and slides it in time
// until it lines up with what arrives. The shift that gives the best match is the delay.
//
// The C/A codes are Gold codes made by two 10-stage shift registers (IS-GPS-200, 3.3.2.3):
//   G1 = 1 + x³ + x¹⁰,  G2 = 1 + x² + x³ + x⁶ + x⁸ + x⁹ + x¹⁰,
// and each satellite (PRN) takes its G2 output from a different pair of stages.

export const G2_TAPS = {
  1: [2, 6], 2: [3, 7], 3: [4, 8], 4: [5, 9], 5: [1, 9], 6: [2, 10], 7: [1, 8], 8: [2, 9],
  9: [3, 10], 10: [2, 3], 11: [3, 4], 12: [5, 6], 13: [6, 7], 14: [7, 8], 15: [8, 9], 16: [9, 10],
  17: [1, 4], 18: [2, 5], 19: [3, 6], 20: [4, 7], 21: [5, 8], 22: [6, 9], 23: [1, 3], 24: [4, 6],
  25: [5, 7], 26: [6, 8], 27: [7, 9], 28: [8, 10], 29: [1, 6], 30: [2, 7], 31: [3, 8], 32: [4, 9],
};

// The 1,023 chips of one PRN's C/A code, as 0/1.
export function caCode(prn) {
  const [ta, tb] = G2_TAPS[prn];
  const g1 = new Array(10).fill(1), g2 = new Array(10).fill(1);
  const out = new Uint8Array(1023);
  for (let i = 0; i < 1023; i++) {
    out[i] = g1[9] ^ g2[ta - 1] ^ g2[tb - 1];
    const f1 = g1[2] ^ g1[9];
    const f2 = g2[1] ^ g2[2] ^ g2[5] ^ g2[7] ^ g2[8] ^ g2[9];
    g1.pop(); g1.unshift(f1);
    g2.pop(); g2.unshift(f2);
  }
  return out;
}

// First 10 chips written in octal, as IS-GPS-200 Table 3-Ia lists them (a check on the generator).
export function firstChipsOctal(code) {
  let v = 0;
  for (let i = 0; i < 10; i++) v = v * 2 + code[i];
  return v.toString(8);
}

// ±1 samples of a code, `spc` samples per chip.
export function codeSamples(code, spc = 1) {
  const s = new Float32Array(code.length * spc);
  for (let i = 0; i < s.length; i++) s[i] = code[Math.floor(i / spc)] ? -1 : 1;
  return s;
}

// Circular correlation of a received buffer with the replica at one shift, normalised so a
// perfect, noise-free match scores 1.
export function correlateAt(rx, replica, shift) {
  const n = replica.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += rx[(i + shift) % n] * replica[i];
  return s / n;
}

// Correlation at every shift (what a receiver searches through when it first looks for a satellite).
export function correlateAll(rx, replica) {
  const n = replica.length;
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = correlateAt(rx, replica, k);
  return out;
}
