// How an echo bends the code measurement (multipath), with an idealised tracking loop.
//
// The receiver finds the code's timing by correlating with its own copy (see signal.js).
// For a perfect code, the correlation against the copy's offset τ (in chips) is a triangle:
// R(τ) = 1 − |τ| for |τ| < 1, else 0.
// A reflection arrives δ chips later with relative amplitude a and carrier phase θ, so the
// receiver sees  R(τ) + a·cos θ · R(τ − δ).
// An early–late tracker compares the correlation half a spacing early and half a spacing late,
// D(τ) = Rc(τ − d/2) − Rc(τ + d/2), and settles where D = 0. The offset of that point from 0
// is the code error caused by the echo.
// This is the idealised model from the team's research notes: one reflection, coherent
// tracking, infinite bandwidth. Real receivers and real cities are messier.

export const triangle = (t) => (Math.abs(t) < 1 ? 1 - Math.abs(t) : 0);

export function composite(tau, delayChips, amp, phase) {
  return triangle(tau) + amp * Math.cos(phase) * triangle(tau - delayChips);
}

export function discriminator(tau, delayChips, amp, phase, spacing) {
  return composite(tau - spacing / 2, delayChips, amp, phase) - composite(tau + spacing / 2, delayChips, amp, phase);
}

// Where the early–late loop settles (chips). We look for the zero of D with positive slope
// (a stable lock point) nearest to the direct signal's true timing (τ = 0).
export function trackingError(delayChips, amp, phase, spacing) {
  const step = 0.0005;
  let best = null;
  let prev = discriminator(-1.5, delayChips, amp, phase, spacing);
  for (let t = -1.5 + step; t <= 1.5 + 1e-12; t += step) {
    const cur = discriminator(t, delayChips, amp, phase, spacing);
    if (prev < 0 && cur >= 0) {
      const z = t - step + (step * -prev) / (cur - prev);
      if (best === null || Math.abs(z) < Math.abs(best)) best = z;
    }
    prev = cur;
  }
  return best ?? 0;
}

// The "multipath error envelope": code error (metres) against the echo's extra path (metres).
// The echo's carrier phase decides the sign: in phase (constructive) pulls the measurement late,
// out of phase (destructive) pulls it early. The envelope is bounded by those two cases.
export function envelope({ chipMetres, spacing, amp = 0.5, maxExtra = 500, points = 200 }) {
  const out = [];
  for (let i = 0; i <= points; i++) {
    const extra = (maxExtra * i) / points;
    const d = extra / chipMetres;
    const destructive = trackingError(d, amp, Math.PI, spacing) * chipMetres;
    const constructive = trackingError(d, amp, 0, spacing) * chipMetres;
    out.push({ extra, destructive, constructive, worst: Math.max(Math.abs(destructive), Math.abs(constructive)) });
  }
  return out;
}

// Worst-case size of the code error (metres) for one extra path length.
export function worstError({ extra, chipMetres, spacing, amp = 0.5 }) {
  const d = extra / chipMetres;
  return Math.max(
    Math.abs(trackingError(d, amp, Math.PI, spacing)),
    Math.abs(trackingError(d, amp, 0, spacing)),
  ) * chipMetres;
}
