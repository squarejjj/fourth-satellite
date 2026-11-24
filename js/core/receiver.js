// THE RECEIVER
// ------------
// This file is the mechanism the whole site is about: how a GPS receiver turns timing
// measurements into a position AND a time.
//
// It only ever sees what a real receiver sees. For each satellite it hears:
//   sat — where that satellite was when it sent the signal (worked out from the orbit data
//         the satellite broadcasts; here the simulator hands it over directly)
//   pr  — the pseudorange: speed of light × (arrival time on the receiver's own clock − send time).
//         It is a distance measured with a wrong clock, so it is wrong by c × (clock error).
//   sys — which satellite system's time the send time is in (GPS, Galileo, …)
// It never sees the true position or the true clock error. Those live in world.js, and nothing
// in this file imports it (tests/run.js checks that).
//
// The method is Gauss–Newton least squares, the standard receiver method:
//   1. guess a position and clock (the default guess is the centre of the Earth with clock 0),
//   2. predict every pseudorange from the guess,
//   3. replace each curved range equation by its straight tangent at the guess,
//   4. solve the resulting small linear system for a correction, apply it, repeat.
// The clock is simply one more unknown: a column of ones in the matrix G.
//
// One safety net: if a full correction would make the fit worse, we take half of it, then a
// quarter, and so on ("damped" Gauss–Newton). From the Earth's centre with satellites bunched in
// one part of the sky, the undamped method can overshoot and run away; with good geometry the
// full step is always accepted and the error shrinks roughly as its square each time.

import { leastSquares, sub, norm } from './linalg.js';

/**
 * @param {Array<{id:any, sat:number[], pr:number, sys?:string}>} measurements
 * @param {object} [opts]
 * @param {boolean} [opts.solveClock=true]  false = trust the receiver clock (clock fixed at fixedClock)
 * @param {number}  [opts.fixedClock=0]     clock bias in metres to assume when solveClock is false
 * @param {number[]} [opts.start]            initial position guess (default: Earth's centre)
 * @param {number[]} [opts.weights]          optional weight per measurement (1/σ²)
 * @param {number}  [opts.maxIter=30]
 * @param {number}  [opts.tol=1e-4]          stop when the correction is smaller than this many metres
 * @returns {object} { ok, reason, pos, clock, clocks, systems, iterations, residuals, Q, G, nUnknowns }
 */
export function solveFix(measurements, opts = {}) {
  const { solveClock = true, fixedClock = 0, weights = null, maxIter = 30, tol = 1e-4 } = opts;
  const n = measurements.length;
  if (n === 0) return { ok: false, reason: 'too-few', nUnknowns: 0, have: 0, iterations: [] };
  const dims = measurements[0].sat.length;

  // One clock unknown per satellite system heard (each system keeps its own time).
  const systems = solveClock ? [...new Set(measurements.map((m) => m.sys ?? 'GPS'))] : [];
  const nUnknowns = dims + systems.length;
  if (n < nUnknowns) {
    return { ok: false, reason: 'too-few', nUnknowns, have: n, systems, dims, iterations: [] };
  }

  let pos = opts.start ? [...opts.start] : new Array(dims).fill(0);
  let clocks = systems.map(() => 0);
  const iterations = [{ pos: [...pos], clocks: [...clocks], step: null }];
  let last = null;

  let converged = false;
  for (let k = 0; k < maxIter; k++) {
    const { G, y } = linearise(measurements, pos, clocks, systems, fixedClock);
    const sol = leastSquares(G, y, weights);
    if (!sol) return { ok: false, reason: 'geometry', nUnknowns, have: n, systems, dims, iterations };
    last = sol;
    const full = norm(sol.x);
    if (!Number.isFinite(full)) return { ok: false, reason: 'diverged', nUnknowns, have: n, systems, dims, iterations };
    if (full < tol) {
      // The correction is tiny: take it and stop.
      pos = pos.map((p, j) => p + sol.x[j]);
      clocks = clocks.map((c, j) => c + sol.x[dims + j]);
      iterations.push({ pos: [...pos], clocks: [...clocks], step: full, full, factor: 1 });
      converged = true;
      break;
    }
    const before = misfit(measurements, pos, clocks, systems, fixedClock, weights);
    let factor = 1, improved = false, nextPos, nextClocks;
    for (let halvings = 0; halvings < 40; halvings++) {
      nextPos = pos.map((p, j) => p + factor * sol.x[j]);
      nextClocks = clocks.map((c, j) => c + factor * sol.x[dims + j]);
      if (misfit(measurements, nextPos, nextClocks, systems, fixedClock, weights) < before) { improved = true; break; }
      factor /= 2;
    }
    if (!improved) {
      // No step, however small, fits better: we are at the bottom of the misfit to within
      // rounding. (Happens when the measurements disagree, so the best fit is not exact.)
      converged = full < 1;
      break;
    }
    pos = nextPos;
    clocks = nextClocks;
    iterations.push({ pos: [...pos], clocks: [...clocks], step: factor * full, full, factor });
  }
  if (!converged) converged = iterations[iterations.length - 1].full < Math.max(tol, 1e-3);

  // Residuals: measured minus predicted from the final answer. Small residuals mean the
  // measurements agree with each other. (They can agree and still be wrong together!)
  const { G } = linearise(measurements, pos, clocks, systems, fixedClock);
  const residuals = measurements.map((m) => {
    const clk = systems.length ? clocks[systems.indexOf(m.sys ?? 'GPS')] : fixedClock;
    return { id: m.id, r: m.pr - (norm(sub(m.sat, pos)) + clk) };
  });
  const clockOut = systems.length ? clocks[0] : fixedClock;
  return {
    ok: converged,
    reason: converged ? null : 'diverged',
    pos,
    clock: clockOut,
    clocks: Object.fromEntries(systems.map((s, j) => [s, clocks[j]])),
    systems,
    dims,
    nUnknowns,
    have: n,
    iterations,
    residuals,
    G,
    Q: last ? last.Q : null,
  };
}

// Sum of squared differences between measured and predicted pseudoranges (how badly a guess fits).
function misfit(measurements, pos, clocks, systems, fixedClock, weights) {
  let s = 0;
  measurements.forEach((m, i) => {
    const clk = systems.length ? clocks[systems.indexOf(m.sys ?? 'GPS')] : fixedClock;
    const r = m.pr - (norm(sub(m.sat, pos)) + clk);
    s += (weights ? weights[i] : 1) * r * r;
  });
  return s;
}

// Build the straight-line (tangent) version of the range equations at the current guess.
// Row i of G is the unit vector from satellite i to the guess, then a 1 in the column of
// the clock of satellite i's system. y holds measured − predicted pseudoranges.
function linearise(measurements, pos, clocks, systems, fixedClock) {
  const G = [], y = [];
  for (const m of measurements) {
    const diff = sub(pos, m.sat);
    const range = norm(diff);
    const s = systems.indexOf(m.sys ?? 'GPS');
    const clk = systems.length ? clocks[s] : fixedClock;
    const row = diff.map((d) => d / range);
    for (let j = 0; j < systems.length; j++) row.push(j === s ? 1 : 0);
    G.push(row);
    y.push(m.pr - (range + clk));
  }
  return { G, y };
}

// Residual-based consistency check (the idea behind RAIM, receiver autonomous integrity
// monitoring). With more satellites than unknowns the measurements must agree; if the
// root-mean-square residual is far above the expected noise, something is wrong.
// Returns the fix, the test statistic, and (if asked) the fix after dropping the worst satellite.
export function consistencyCheck(measurements, { sigma = 3, threshold = 3, opts = {} } = {}) {
  const fix = solveFix(measurements, opts);
  if (!fix.ok) return { fix, testable: false };
  const redundancy = fix.have - fix.nUnknowns;
  if (redundancy < 1) return { fix, testable: false, redundancy };
  const sse = fix.residuals.reduce((s, r) => s + r.r * r.r, 0);
  const rms = Math.sqrt(sse / redundancy);
  const flagged = rms > threshold * sigma;
  let worst = null;
  if (flagged) {
    worst = fix.residuals.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a)).id;
  }
  return { fix, testable: true, redundancy, rms, flagged, worst };
}

// For a flat (2-D) slice with exactly one satellite too few to solve for the clock:
// every clock guess gives a different crossing point of the circles. This returns those
// points, which trace out the curve of all positions that fit the measurements.
// Only the two measurements are used, never the truth.
export function solutionCurve2D(m1, m2, biasFrom, biasTo, steps = 240, preferNear = [0, 0]) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const b = biasFrom + ((biasTo - biasFrom) * i) / steps;
    const hits = circleIntersections(m1.sat, m1.pr - b, m2.sat, m2.pr - b);
    if (!hits) continue;
    // keep the crossing on the same side as `preferNear` (the Earth), not the one out in space
    const pick = norm(sub(hits[0], preferNear)) < norm(sub(hits[1], preferNear)) ? hits[0] : hits[1];
    pts.push({ bias: b, p: pick });
  }
  return pts;
}

// Where two circles cross (null if they don't).
export function circleIntersections(c1, r1, c2, r2) {
  if (r1 <= 0 || r2 <= 0) return null;
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1[0] + (a * dx) / d, my = c1[1] + (a * dy) / d;
  return [
    [mx + (h * dy) / d, my - (h * dx) / d],
    [mx - (h * dy) / d, my + (h * dx) / d],
  ];
}

// ── Three dimensions ──
// Where three spheres meet: 0 or 2 points (trilateration). Used to draw, for exactly three
// satellites, the curve of every position that fits them, one point per guess of the clock.
export function sphereIntersections(p1, r1, p2, r2, p3, r3) {
  const d21 = sub(p2, p1), d31 = sub(p3, p1);
  const d = norm(d21);
  if (d === 0) return null;
  const ex = d21.map((v) => v / d);
  const i = ex[0] * d31[0] + ex[1] * d31[1] + ex[2] * d31[2];
  const t = d31.map((v, k) => v - i * ex[k]);
  const tn = norm(t);
  if (tn === 0) return null;
  const ey = t.map((v) => v / tn);
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  const j = ey[0] * d31[0] + ey[1] * d31[1] + ey[2] * d31[2];
  const x = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const y = (r1 * r1 - r3 * r3 + i * i + j * j) / (2 * j) - (i / j) * x;
  const z2 = r1 * r1 - x * x - y * y;
  if (z2 < 0) return null;
  const z = Math.sqrt(z2);
  const base = p1.map((v, k) => v + x * ex[k] + y * ey[k]);
  return [base.map((v, k) => v + z * ez[k]), base.map((v, k) => v - z * ez[k])];
}

// With exactly three satellites in 3-D (one too few to solve for the clock), every clock guess
// gives a different place where the three spheres meet. Uses only the three measurements.
export function solutionCurve3D(m1, m2, m3, biasFrom, biasTo, steps = 240, preferNear = [0, 0, 0]) {
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const b = biasFrom + ((biasTo - biasFrom) * k) / steps;
    const hits = sphereIntersections(m1.sat, m1.pr - b, m2.sat, m2.pr - b, m3.sat, m3.pr - b);
    if (!hits) continue;
    const pick = norm(sub(hits[0], preferNear)) < norm(sub(hits[1], preferNear)) ? hits[0] : hits[1];
    pts.push({ bias: b, p: pick });
  }
  return pts;
}
