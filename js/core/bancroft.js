// Bancroft's closed-form solution (S. Bancroft, IEEE Trans. AES-21(1), 1985).
// ---------------------------------------------------------------------------
// Gauss–Newton walks towards the answer from a guess. Bancroft jumps straight to it:
// squaring each range equation removes the square root, and a "Lorentz" inner product
// (which subtracts the clock term) turns everything into one quadratic.
//
// For satellite j, write s_j = [position; pseudorange] and the unknown p = [position; clock bias b].
// Squaring (PR − b)² = |r_j − r|² and regrouping gives, for every satellite,
//     ½⟨s_j, s_j⟩ − ⟨s_j, p⟩ + Λ = 0,      with Λ = ½⟨p, p⟩ and ⟨a, b⟩ = a₁b₁ + … − a_last·b_last.
// Λ is the same for every satellite, so for a fixed Λ the equations are linear:
//     M p = v + Λ u,   u = B⁺·1,  v = B⁺·a   (B has rows s_jᵀ, a_j = ½⟨s_j, s_j⟩, M flips the last sign).
// Putting p back into Λ = ½⟨p, p⟩ gives the quadratic  ⟨u,u⟩Λ² + 2(⟨u,v⟩ − 1)Λ + ⟨v,v⟩ = 0.
// A quadratic has two roots, so there are always two candidate answers. Squaring also accepts
// "negative ranges", so usually one candidate is an artefact; we expose both and let the
// caller check each against the original (unsquared) equations.
// Works in 2-D (3 unknowns) and 3-D (4 unknowns).

import { transpose, matMul, matVec, inverse, sub, norm } from './linalg.js';

const lorentz = (a, b) => {
  const k = a.length - 1;
  let s = -a[k] * b[k];
  for (let i = 0; i < k; i++) s += a[i] * b[i];
  return s;
};

export function bancroft(measurements) {
  const dims = measurements[0].sat.length;
  const nU = dims + 1;
  if (measurements.length < nU) return { ok: false, reason: 'too-few', roots: [] };
  const B = measurements.map((m) => [...m.sat, m.pr]);
  const a = B.map((row) => 0.5 * lorentz(row, row));
  const ones = B.map(() => 1);

  // B⁺ = B⁻¹ for exactly enough satellites, the least-squares pseudo-inverse otherwise.
  let Bplus;
  if (B.length === nU) {
    Bplus = inverse(B);
  } else {
    const Bt = transpose(B);
    const N = inverse(matMul(Bt, B));
    Bplus = N ? matMul(N, Bt) : null;
  }
  if (!Bplus) return { ok: false, reason: 'geometry', roots: [] };

  const u = matVec(Bplus, ones);
  const v = matVec(Bplus, a);
  const E = lorentz(u, u);
  const F = lorentz(u, v) - 1;
  const G = lorentz(v, v);
  const disc = F * F - E * G;
  if (disc < 0) return { ok: false, reason: 'no-real-root', roots: [], E, F, G };

  const lambdas = Math.abs(E) < 1e-300 ? [-G / (2 * F)] : [(-F + Math.sqrt(disc)) / E, (-F - Math.sqrt(disc)) / E];
  const roots = lambdas.map((lambda) => {
    const w = v.map((vi, i) => vi + lambda * u[i]);
    const pos = w.slice(0, dims);
    const bias = -w[dims]; // M flips the sign of the last component
    // Check the candidate against the ORIGINAL equations: PR = |r_sat − r| + b.
    const maxResidual = Math.max(...measurements.map((m) => Math.abs(m.pr - (norm(sub(m.sat, pos)) + bias))));
    return { lambda, pos, bias, maxResidual };
  });
  roots.sort((p, q) => p.maxResidual - q.maxResidual);
  return { ok: true, roots, E, F, G, disc };
}
