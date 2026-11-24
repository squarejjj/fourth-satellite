// Every check the site runs on its own maths. The same list runs in the browser (tests.html)
// and from the command line (`node tests/run.js`).
// "Expected" values marked [research] come from the team's research notes (Python runs or
// published sources); the rest are properties the maths must have.

import { C, R_EARTH, F_L1 } from '../js/core/constants.js';
import { norm, sub } from '../js/core/linalg.js';
import { gaussianSource, mulberry32 } from '../js/core/rng.js';
import { makeSky, ecefToEnu } from '../js/core/geo.js';
import { measure } from '../js/core/world.js';
import { solveFix, solutionCurve3D } from '../js/core/receiver.js';
import { bancroft } from '../js/core/bancroft.js';
import { dopFromSky } from '../js/core/dop.js';
import * as iono from '../js/core/iono.js';
import { clockRates, breakEvenRadius, eccentricAnomaly, eccentricityTerm } from '../js/core/relativity.js';

const near = (got, expected, tol) => Math.abs(got - expected) <= tol;
const fmt = (x, d = 3) => (typeof x === 'number' ? x.toFixed(d) : String(x));
const F1 = (x) => x.toFixed(1);

// A fixed test sky: receiver at 37.5°N 127°E (Seoul, as in the research notes), one satellite high
// and three low and spread out, receiver clock 0.5 ms fast (about 150 km of range).
const SPREAD4 = [
  { id: 'A', az: 0, el: 80 }, { id: 'B', az: 90, el: 15 }, { id: 'C', az: 210, el: 15 }, { id: 'D', az: 330, el: 15 },
];
const EIGHT = [
  { id: 1, az: 10, el: 72 }, { id: 2, az: 60, el: 25 }, { id: 3, az: 115, el: 48 }, { id: 4, az: 170, el: 18 },
  { id: 5, az: 215, el: 55 }, { id: 6, az: 260, el: 12 }, { id: 7, az: 300, el: 35 }, { id: 8, az: 345, el: 20 },
];

export const checks = [
  {
    group: 'The receiver',
    name: 'The story’s numbers: 1 ms of clock error is 299.79 km of distance; 38 µs a day is 11.4 km',
    run() {
      const a = C * 1e-3 / 1000, b = C * 38e-6 / 1000;
      return { pass: near(a, 299.79, 0.005) && near(b, 11.4, 0.05), got: `${a.toFixed(2)} km, ${b.toFixed(1)} km`, expected: '299.79 km, 11.4 km' };
    },
  },
  // ───────────────────────── The receiver ─────────────────────────
  {
    group: 'The receiver',
    name: '3-D: 4 satellites, clock 0.5 ms wrong, start at Earth’s centre → exact position and clock',
    run() {
      const sky = makeSky({ lat: 37.5, lon: 127 }, SPREAD4);
      const fix = solveFix(measure({ truePos: sky.user, clockError: 0.5e-3, sats: sky.sats }));
      const err = norm(sub(fix.pos, sky.user));
      return { pass: fix.ok && err < 1e-3 && near(fix.clock, C * 0.5e-3, 1e-3), got: `error ${err.toExponential(1)} m, clock ${fmt(fix.clock / 1000)} km`, expected: 'error < 1 mm, clock 149.896 km' };
    },
  },
  {
    group: 'The receiver',
    name: 'Convergence is quadratic: error(k+1) ÷ error(k)² stays about 1/(2 × range) [research: ~2 × 10⁻⁸ per m]',
    run() {
      const sky = makeSky({ lat: 37.5, lon: 127 }, SPREAD4);
      const fix = solveFix(measure({ truePos: sky.user, clockError: 0.5e-3, sats: sky.sats }));
      const e = fix.iterations.map((it) => norm(sub(it.pos, sky.user)));
      const ratios = [];
      for (let k = 1; k + 1 < e.length; k++) if (e[k + 1] > 1e-6) ratios.push(e[k + 1] / (e[k] * e[k]));
      const ok = ratios.length >= 2 && ratios.every((r) => r > 5e-9 && r < 1e-7);
      return { pass: ok, got: `errors ${e.slice(1, 5).map((x) => x.toPrecision(3)).join(' → ')} m; ratios ${ratios.map((r) => r.toExponential(2)).join(', ')}`, expected: 'every ratio between 5 × 10⁻⁹ and 10⁻⁷' };
    },
  },
  {
    group: 'The receiver',
    name: 'Converges from Earth’s centre on 500 random skies (4–8 satellites, random place and clock)',
    run() {
      const rand = mulberry32(2026);
      let ok = 0, worst = 0, maxIt = 0;
      for (let t = 0; t < 500; t++) {
        const n = 4 + Math.floor(rand() * 5);
        const sats = Array.from({ length: n }, (_, i) => ({ id: i, az: rand() * 360, el: 5 + rand() * 85 }));
        const sky = makeSky({ lat: -70 + rand() * 140, lon: rand() * 360 - 180 }, sats);
        const fix = solveFix(measure({ truePos: sky.user, clockError: (rand() - 0.5) * 2e-3, sats: sky.sats }));
        const err = norm(sub(fix.pos, sky.user));
        if (fix.ok && err < 1e-2) ok++;
        worst = Math.max(worst, err);
        maxIt = Math.max(maxIt, fix.iterations.length - 1);
      }
      return { pass: ok === 500, got: `${ok}/500 (worst error ${worst.toExponential(1)} m, most iterations ${maxIt})`, expected: '500/500 within 1 cm' };
    },
  },
  {
    group: 'The receiver',
    name: 'One satellite too few: 3 satellites cannot give 4 unknowns (x, y, z, clock)',
    run() {
      const sky = makeSky({ lat: 37.5, lon: 127 }, SPREAD4.slice(0, 3));
      const fix = solveFix(measure({ truePos: sky.user, clockError: 1e-4, sats: sky.sats }));
      return { pass: !fix.ok && fix.reason === 'too-few' && fix.nUnknowns === 4, got: `${fix.reason}, ${fix.have} of ${fix.nUnknowns}`, expected: 'too-few, 3 of 4' };
    },
  },
  {
    group: 'The receiver',
    name: 'Flat slice: trusting a clock that is 0.3 ms fast puts the fix tens of km off; solving for it does not',
    run() {
      const P = [0, R_EARTH];
      const ang = [115, 70, 95].map((d) => (d * Math.PI) / 180);
      const sats = ang.map((a, i) => ({ id: i, pos: [26560000 * Math.cos(a), 26560000 * Math.sin(a)] }));
      const meas = measure({ truePos: P, clockError: 0.3e-3, sats });
      const trust = solveFix(meas.slice(0, 2), { solveClock: false });
      const solved = solveFix(meas);
      const eT = norm(sub(trust.pos, P)), eS = norm(sub(solved.pos, P));
      return { pass: eT > 50e3 && eS < 1e-3, got: `trusting: ${fmt(eT / 1000, 1)} km, solving: ${eS.toExponential(1)} m`, expected: 'trusting > 50 km, solving < 1 mm' };
    },
  },
  {
    group: 'The receiver',
    name: 'A delay shared by every satellite is absorbed by the clock unknown, not the position',
    run() {
      const sky = makeSky({ lat: 37.5, lon: 127 }, EIGHT);
      const extra = Object.fromEntries(EIGHT.map((s) => [s.id, 100]));
      const a = solveFix(measure({ truePos: sky.user, clockError: 0, sats: sky.sats }));
      const b = solveFix(measure({ truePos: sky.user, clockError: 0, sats: sky.sats, extra }));
      const dp = norm(sub(a.pos, b.pos));
      return { pass: dp < 1e-3 && near(b.clock - a.clock, 100, 1e-3), got: `position moved ${dp.toExponential(1)} m, clock +${fmt(b.clock - a.clock)} m`, expected: 'position unchanged, clock +100 m' };
    },
  },
  {
    group: 'The receiver',
    name: 'Worked example: 21,000,000 m takes 70.048460 ms; an extra 100 ns adds 29.98 m [research]',
    run() {
      const t = 21000000 / C, extra = C * 100e-9;
      return { pass: near(t * 1000, 70.04846, 5e-7) && near(extra, 29.98, 0.005), got: `${(t * 1000).toFixed(6)} ms, ${extra.toFixed(2)} m`, expected: '70.048460 ms, 29.98 m' };
    },
  },
  {
    group: 'The receiver',
    name: 'Three satellites in 3-D: the curve of places that fit passes through you at the true clock error, and only there',
    run() {
      const sky = makeSky({ lat: 37.5, lon: 127 }, SPREAD4.slice(0, 3));
      const bias = C * 4e-4;
      const meas = measure({ truePos: sky.user, clockError: 4e-4, sats: sky.sats });
      const curve = solutionCurve3D(meas[0], meas[1], meas[2], bias - 2e5, bias + 2e5, 400);
      const atTruth = curve.reduce((a, q) => (Math.abs(q.bias - bias) < Math.abs(a.bias - bias) ? q : a));
      const far = curve.reduce((a, q) => (Math.abs(q.bias - bias) > Math.abs(a.bias - bias) ? q : a));
      const e0 = norm(sub(atTruth.p, sky.user)), e1 = norm(sub(far.p, sky.user));
      return { pass: curve.length > 300 && e0 < 1e-3 && e1 > 50e3, got: `${curve.length} points; ${e0.toExponential(1)} m from you at the true clock, ${F1(e1 / 1000)} km away 200 km of clock off`, expected: 'passes within 1 mm; > 50 km away elsewhere' };
    },
  },
  // ───────────────────────── Bancroft ─────────────────────────
  {
    group: 'Closed-form solution (Bancroft)',
    name: 'The true root: radius 6,371.0 km, clock 149.896 km, Λ ≈ 2.028 × 10¹³ [research]',
    run() {
      const sky = makeSky({ lat: 37.5, lon: 127 }, SPREAD4);
      const bc = bancroft(measure({ truePos: sky.user, clockError: 0.5e-3, sats: sky.sats }));
      const r = bc.roots[0];
      return {
        pass: bc.ok && near(norm(r.pos) / 1000, 6371.0, 0.05) && near(r.bias / 1000, 149.896, 0.001) && near(r.lambda / 1e13, 2.028, 0.001),
        got: `radius ${fmt(norm(r.pos) / 1000, 1)} km, clock ${fmt(r.bias / 1000)} km, Λ ${r.lambda.toExponential(3)}`,
        expected: '6371.0 km, 149.896 km, 2.028e+13',
      };
    },
  },
  {
    group: 'Closed-form solution (Bancroft)',
    name: 'The second root fails the original (unsquared) equations',
    run() {
      const sky = makeSky({ lat: 37.5, lon: 127 }, SPREAD4);
      const bc = bancroft(measure({ truePos: sky.user, clockError: 0.5e-3, sats: sky.sats }));
      const ghost = bc.roots[1];
      return { pass: bc.ok && ghost.maxResidual > 1000, got: `misses by ${fmt(ghost.maxResidual / 1000, 0)} km`, expected: 'misses by more than 1 km' };
    },
  },
  {
    group: 'Closed-form solution (Bancroft)',
    name: 'Agrees with Gauss–Newton: 8 satellites, 5 m noise [research: 3.17 m vs 3.18 m]',
    run() {
      const sky = makeSky({ lat: 37.5, lon: 127 }, EIGHT);
      const g = gaussianSource(11);
      const extra = Object.fromEntries(EIGHT.map((s) => [s.id, 5 * g()]));
      const meas = measure({ truePos: sky.user, clockError: 2e-4, sats: sky.sats, extra });
      const gn = solveFix(meas), bc = bancroft(meas);
      const d = norm(sub(gn.pos, bc.roots[0].pos));
      return { pass: d < 1, got: `answers differ by ${fmt(d, 3)} m (errors ${fmt(norm(sub(gn.pos, sky.user)), 2)} m and ${fmt(norm(sub(bc.roots[0].pos, sky.user)), 2)} m)`, expected: 'differ by under 1 m' };
    },
  },
  {
    group: 'Closed-form solution (Bancroft)',
    name: 'Flat slice, three beacons in a line: the second root is a real mirror twin that fits too',
    run() {
      // beacons on the line y = 10 km (a line through the origin would make B singular)
      const beacons = [[-30000, 10000], [5000, 10000], [42000, 10000]];
      const truth = [3000, 28000];
      const meas = measure({ truePos: truth, clockError: 2e-6, sats: beacons.map((pos, i) => ({ id: i, pos })) });
      const bc = bancroft(meas);
      const fits = bc.ok && bc.roots.every((r) => r.maxResidual < 1e-3);
      const mirror = bc.ok && bc.roots.some((r) => near(r.pos[1], -8000, 1e-3));
      return { pass: fits && mirror, got: bc.ok ? bc.roots.map((r) => `(${fmt(r.pos[0], 1)}, ${fmt(r.pos[1], 1)}) misses ${r.maxResidual.toExponential(1)} m`).join('; ') : bc.reason, expected: 'both fit; the twin at y = −8,000' };
    },
  },
  // ───────────────────────── Geometry ─────────────────────────
  {
    group: 'Satellite geometry (DOP)',
    name: 'DOP predicts the scatter: 2,000 noisy fixes from the real solver vs √Q × σ',
    run() {
      const sky = makeSky({ lat: 37.5, lon: 127 }, EIGHT);
      const dop = dopFromSky(EIGHT);
      const g = gaussianSource(5);
      const sigma = 5, N = 2000;
      let se = 0, sn = 0, su = 0;
      for (let t = 0; t < N; t++) {
        const extra = Object.fromEntries(EIGHT.map((s) => [s.id, sigma * g()]));
        const fix = solveFix(measure({ truePos: sky.user, clockError: 0, sats: sky.sats, extra }));
        const [e, n, u] = ecefToEnu(sub(fix.pos, sky.user), sky.basis);
        se += e * e; sn += n * n; su += u * u;
      }
      const got = [se, sn, su].map((s) => Math.sqrt(s / N));
      const want = [dop.east, dop.north, dop.up].map((d) => d * sigma);
      const ok = got.every((v, i) => Math.abs(v / want[i] - 1) < 0.06);
      return { pass: ok, got: `east/north/up ${got.map((v) => fmt(v, 2)).join(' / ')} m`, expected: `${want.map((v) => fmt(v, 2)).join(' / ')} m (±6%)` };
    },
  },
  {
    group: 'Satellite geometry (DOP)',
    name: 'Knowing the exact time shrinks height error most; height and clock are tangled',
    run() {
      const a = dopFromSky(EIGHT), b = dopFromSky(EIGHT, { clockKnown: true });
      return { pass: b.vdop < a.vdop * 0.75 && b.hdop <= a.hdop + 1e-12 && a.corrUpClock > 0.7, got: `VDOP ${fmt(a.vdop, 2)} → ${fmt(b.vdop, 2)}, HDOP ${fmt(a.hdop, 2)} → ${fmt(b.hdop, 2)}, height–clock correlation ${fmt(a.corrUpClock, 2)}`, expected: 'VDOP falls by over 25%, correlation > 0.7' };
    },
  },
  {
    group: 'Satellite geometry (DOP)',
    name: 'With satellites below as well as above, the height–clock tangle disappears [research]',
    run() {
      const all = [...EIGHT, ...EIGHT.map((s) => ({ ...s, id: s.id + 100, az: (s.az + 180) % 360, el: -s.el }))];
      const d = dopFromSky(all);
      return { pass: Math.abs(d.corrUpClock) < 0.05, got: `correlation ${fmt(d.corrUpClock, 3)}`, expected: 'about 0' };
    },
  },
  {
    group: 'Ionosphere',
    name: 'L1/L5: γ = 1.79327, weights 2.2606 and −1.2606, noise × 2.588, 0.1624 m per TECU [research]',
    run() {
      const w = iono.IF_WEIGHTS;
      const ok = near(iono.GAMMA_L1_L5, 1.79327, 5e-6) && near(w[0], 2.2606, 5e-5) && near(w[1], -1.2606, 5e-5) && near(iono.IF_NOISE_FACTOR, 2.588, 5e-4) && near(iono.metresPerTecu(F_L1), 0.1624, 5e-5);
      return { pass: ok, got: `${fmt(iono.GAMMA_L1_L5, 5)}, ${fmt(w[0], 4)}, ${fmt(w[1], 4)}, ${fmt(iono.IF_NOISE_FACTOR, 3)}, ${fmt(iono.metresPerTecu(F_L1), 4)}`, expected: '1.79327, 2.2606, −1.2606, 2.588, 0.1624' };
    },
  },
  {
    group: 'Ionosphere',
    name: 'Klobuchar (sample coefficients, 37.5°N 127°E): zenith 4.255 m at 14:00, 1.500 m at 02:00; 7.76 m at 30°; 13.99 m at 5°; 4.54 m at 5° by night [research]',
    run() {
      const k = (h, el) => iono.klobuchar({ latDeg: 37.5, lonDeg: 127, azDeg: 180, elDeg: el, gpsSeconds: iono.gpsSecondsForLocalTime(h, 127) }).metres;
      const v = [k(14, 90), k(2, 90), k(14, 30), k(14, 5), k(2, 5)];
      const want = [4.255, 1.5, 7.76, 13.99, 4.54];
      const ok = v.every((x, i) => near(x, want[i], i < 2 ? 0.0005 : 0.005));
      return { pass: ok, got: v.map((x, i) => fmt(x, i < 2 ? 3 : 2)).join(', '), expected: want.join(', ') };
    },
  },
  {
    group: 'Ionosphere',
    name: 'The ionosphere-free combination removes the delay exactly (no noise)',
    run() {
      const rho = 22000000, I = 6.2;
      const r1 = rho + I, r5 = rho + iono.GAMMA_L1_L5 * I;
      return { pass: near(iono.ionoFree(r1, r5), rho, 1e-6) && near(iono.ionoFromPair(r1, r5), I, 1e-6), got: `range ${fmt(iono.ionoFree(r1, r5) - rho, 6)} m off, delay ${fmt(iono.ionoFromPair(r1, r5), 4)} m`, expected: '0 m off, delay 6.2 m' };
    },
  },
  {
    group: 'Clocks in orbit',
    name: 'GPS orbit (r = 26,560 km): 3,874 m/s; −7.21, +45.72, +38.50 µs per day [research]',
    run() {
      const r = clockRates(26560000);
      const v = [r.motion, r.gravity, r.net].map((x) => x * 1e6);
      return { pass: near(r.v, 3874, 1) && near(v[0], -7.21, 0.005) && near(v[1], 45.72, 0.005) && near(v[2], 38.5, 0.005), got: `${fmt(r.v, 0)} m/s; ${v.map((x) => fmt(x, 2)).join(', ')}`, expected: '3874 m/s; −7.21, 45.72, 38.50' };
    },
  },
  {
    group: 'Clocks in orbit',
    name: 'Effects cancel at r = 1.5 R; elliptical term peaks at 22.9 ns (6.86 m) for e = 0.01 [research]',
    run() {
      const be = clockRates(breakEvenRadius());
      const peak = Math.abs(eccentricityTerm(26560000, 0.01, Math.PI / 2));
      return { pass: Math.abs(be.net) < 1e-15 && near(peak * 1e9, 22.9, 0.05) && near(peak * C, 6.86, 0.01), got: `net at 1.5 R: ${be.net.toExponential(1)} s; ${fmt(peak * 1e9, 2)} ns = ${fmt(peak * C, 2)} m`, expected: '0; 22.9 ns = 6.86 m' };
    },
  },
  {
    group: 'Clocks in orbit',
    name: 'Kepler’s equation M = E − e sin E solved to 10⁻¹² for e up to 0.7',
    run() {
      let worst = 0;
      for (const e of [0, 0.01, 0.1, 0.4, 0.7]) for (let M = 0; M < 2 * Math.PI; M += 0.1) {
        const E = eccentricAnomaly(M, e);
        worst = Math.max(worst, Math.abs(E - e * Math.sin(E) - M));
      }
      return { pass: worst < 1e-12, got: worst.toExponential(1), expected: '< 1e-12' };
    },
  },];

export function runAll() {
  return checks.map((c) => {
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    let res;
    try {
      res = c.run();
    } catch (err) {
      res = { pass: false, got: `threw ${err && err.message}`, expected: '' };
    }
    const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    return { ...c, ...res, ms };
  });
}
