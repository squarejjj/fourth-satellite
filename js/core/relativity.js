// Clocks in orbit. Two effects of relativity change how fast a satellite clock ticks compared
// with one on the ground (simplified: spherical, non-rotating Earth, circular orbit):
//   motion  (special relativity):  −v² / (2c²)              → the moving clock runs slow
//   gravity (general relativity):  (μ/c²)(1/R − 1/r)         → the higher clock runs fast
// For a circular orbit the speed follows from the radius: v = √(μ/r).
// (Ashby 2003, "Relativity in the Global Positioning System", sections 4–5.)

import { C, MU, R_EARTH, DAY } from './constants.js';

export function clockRates(r, R = R_EARTH) {
  const v = Math.sqrt(MU / r);
  const motion = (-(v * v) / (2 * C * C)) * DAY;              // seconds gained per day (negative = lost)
  const gravity = (MU / (C * C)) * (1 / R - 1 / r) * DAY;
  return { v, motion, gravity, net: motion + gravity };
}

// Radius at which the two effects cancel: v²/2 = μ(1/R − 1/r) with v² = μ/r  →  r = 1.5 R.
export const breakEvenRadius = (R = R_EARTH) => 1.5 * R;

// Kepler's equation M = E − e sin E, solved for E by Newton's method.
export function eccentricAnomaly(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

// Satellite position in its orbital plane (perigee along +x) at mean anomaly M.
export function orbitPosition(a, e, M) {
  const E = eccentricAnomaly(M, e);
  const x = a * (Math.cos(E) - e);
  const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const r = a * (1 - e * Math.cos(E));
  const speed = Math.sqrt(MU * (2 / r - 1 / a)); // vis-viva equation
  return { E, x, y, r, speed };
}

// The periodic relativistic clock term for an eccentric orbit (IS-GPS-200, 20.3.3.3.3.1):
// Δt_r = F·e·√a·sin E with F = −2√μ / c². It is zero for a circular orbit.
export const eccentricityTerm = (a, e, E) => ((-2 * Math.sqrt(MU)) / (C * C)) * e * Math.sqrt(a) * Math.sin(E);
export const orbitalPeriod = (a) => 2 * Math.PI * Math.sqrt((a * a * a) / MU);
