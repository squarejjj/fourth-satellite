// A constant-velocity Kalman filter in two dimensions.
// State x = [east, north, v_east, v_north]. Each step has two halves:
//   predict:  x⁻ = F x,          P⁻ = F P Fᵀ + Q      (uncertainty grows)
//   correct:  K = P⁻Hᵀ(H P⁻ Hᵀ + R)⁻¹,  x = x⁻ + K (z − H x⁻),  P = (I − K H) P⁻   (it shrinks)
// q is the standard deviation of the unexpected acceleration (m/s²): small q trusts the motion
// model (smooth but slow to react), big q trusts each fix (quick but jumpy).
// r is the standard deviation of each GPS fix (m).
// Q uses the usual "discrete white-noise acceleration" model.

import { matMul, transpose, inverse } from './linalg.js';

const I4 = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const madd = (A, B) => A.map((row, i) => row.map((v, j) => v + B[i][j]));
const msub = (A, B) => A.map((row, i) => row.map((v, j) => v - B[i][j]));

export function makeFilter({ dt = 1, q = 0.5, r = 5, x0 = [0, 0, 0, 0], p0 = 100 } = {}) {
  const F = [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]];
  const a = dt ** 4 / 4, b = dt ** 3 / 2, c = dt ** 2;
  const Q = [[a, 0, b, 0], [0, a, 0, b], [b, 0, c, 0], [0, b, 0, c]].map((row) => row.map((v) => v * q * q));
  const H = [[1, 0, 0, 0], [0, 1, 0, 0]];
  const R = [[r * r, 0], [0, r * r]];
  let x = [...x0];
  let P = I4().map((row) => row.map((v) => v * p0));
  let K = null;

  return {
    get x() { return x; },
    get P() { return P; },
    get K() { return K; },
    predict() {
      x = [x[0] + dt * x[2], x[1] + dt * x[3], x[2], x[3]];
      P = madd(matMul(matMul(F, P), transpose(F)), Q);
    },
    correct(z) {
      const S = madd(matMul(matMul(H, P), transpose(H)), R);
      K = matMul(matMul(P, transpose(H)), inverse(S));
      const innov = [z[0] - x[0], z[1] - x[1]];
      x = x.map((v, i) => v + K[i][0] * innov[0] + K[i][1] * innov[1]);
      P = matMul(msub(I4(), matMul(K, H)), P);
    },
  };
}

// The gain the filter settles to on a long run of fixes (position-on-position entry of K).
export function steadyGain({ q, r, dt = 1, steps = 400 }) {
  const f = makeFilter({ q, r, dt });
  for (let i = 0; i < steps; i++) {
    f.predict();
    f.correct([0, 0]);
  }
  return f.K[0][0];
}
