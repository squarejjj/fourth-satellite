// The ionosphere: a layer of charged gas 50–1000 km up that delays the GPS code.
// The delay is 40.3·TEC/f² metres (TEC = electrons per m² along the path), so it depends on
// frequency. Two ways to deal with it:
//   1. single-frequency receivers estimate it with the Klobuchar model, from 8 numbers the
//      satellites broadcast (Navipedia, "Klobuchar Ionospheric Model");
//   2. dual-frequency receivers measure it by comparing two frequencies.

import { C, F_L1, F_L5 } from './constants.js';

// Sample coefficients. These are illustrative values of the kind found in a navigation file
// header, used by the team's research notes; they are NOT today's broadcast values.
export const SAMPLE_ALPHA = [0.1118e-7, -0.7451e-8, -0.5961e-7, 0.1192e-6];
export const SAMPLE_BETA = [0.1167e6, -0.2294e6, -0.1311e6, 0.1049e7];

/**
 * Klobuchar ionospheric delay on L1, following the steps on Navipedia.
 * Angles in the model are in semicircles (1 semicircle = 180°).
 * @returns {{seconds:number, metres:number, slant:number, localTime:number, night:boolean}}
 */
export function klobuchar({ latDeg, lonDeg, azDeg, elDeg, gpsSeconds, alpha = SAMPLE_ALPHA, beta = SAMPLE_BETA }) {
  const E = elDeg / 180;                               // elevation, semicircles
  const A = (azDeg * Math.PI) / 180;                   // azimuth, radians
  const phiU = latDeg / 180, lamU = lonDeg / 180;      // receiver, semicircles
  const psi = 0.0137 / (E + 0.11) - 0.022;             // Earth-centred angle to the pierce point
  let phiI = phiU + psi * Math.cos(A);                 // latitude of the ionospheric pierce point
  phiI = Math.max(-0.416, Math.min(0.416, phiI));
  const lamI = lamU + (psi * Math.sin(A)) / Math.cos(phiI * Math.PI);
  const phiM = phiI + 0.064 * Math.cos((lamI - 1.617) * Math.PI); // geomagnetic latitude
  let t = (43200 * lamI + gpsSeconds) % 86400;                    // local time at the pierce point
  if (t < 0) t += 86400;
  let amp = alpha[0] + alpha[1] * phiM + alpha[2] * phiM ** 2 + alpha[3] * phiM ** 3;
  if (amp < 0) amp = 0;
  let per = beta[0] + beta[1] * phiM + beta[2] * phiM ** 2 + beta[3] * phiM ** 3;
  if (per < 72000) per = 72000;
  const X = (2 * Math.PI * (t - 50400)) / per;         // phase: 0 at 14:00 local time
  const F = 1 + 16 * (0.53 - E) ** 3;                  // slant factor: longer path at low elevation
  const night = Math.abs(X) >= 1.57;
  const seconds = night ? F * 5e-9 : F * (5e-9 + amp * (1 - (X * X) / 2 + X ** 4 / 24));
  return { seconds, metres: seconds * C, slant: F, localTime: t, night, phiM };
}

// GPS seconds-of-day that put the pierce point at a given local time (hours) for a longitude.
export const gpsSecondsForLocalTime = (hours, lonDeg) => {
  let s = hours * 3600 - 43200 * (lonDeg / 180);
  s %= 86400;
  return s < 0 ? s + 86400 : s;
};

// Frequency scaling: the delay goes as 1/f².
export const GAMMA_L1_L5 = (F_L1 / F_L5) ** 2;          // ≈ 1.79327
export const metresPerTecu = (f) => (40.3 * 1e16) / (f * f);

// The ionosphere-free combination of L1 and L5 code measurements:
//   R_IF = (γ R1 − R5) / (γ − 1) ≈ 2.2606 R1 − 1.2606 R5.
// Because R1 = ρ + I and R5 = ρ + γI, the I terms cancel. The price: noise is amplified.
export const IF_WEIGHTS = [GAMMA_L1_L5 / (GAMMA_L1_L5 - 1), -1 / (GAMMA_L1_L5 - 1)];
export const IF_NOISE_FACTOR = Math.hypot(IF_WEIGHTS[0], IF_WEIGHTS[1]); // ≈ 2.588
export const ionoFree = (r1, r5) => IF_WEIGHTS[0] * r1 + IF_WEIGHTS[1] * r5;
// The delay itself can be read off the difference: I (on L1) = (R5 − R1) / (γ − 1).
export const ionoFromPair = (r1, r5) => (r5 - r1) / (GAMMA_L1_L5 - 1);
