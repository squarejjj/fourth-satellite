// Small dense linear algebra for the receiver's equations.
// Matrices are arrays of rows. The biggest matrix the site ever builds is about 10 × 10,
// so we keep everything plain and readable rather than fast.

export const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
export const norm = (a) => Math.sqrt(dot(a, a));
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const scale = (a, k) => a.map((x) => x * k);
export const dist = (a, b) => norm(sub(a, b));

export function transpose(A) {
  return A[0].map((_, j) => A.map((row) => row[j]));
}

export function matMul(A, B) {
  const n = A.length, k = B.length, m = B[0].length;
  const out = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      const a = A[i][p];
      if (a === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += a * B[p][j];
    }
  }
  return out;
}

export const matVec = (A, v) => A.map((row) => dot(row, v));

// Inverse by Gauss–Jordan elimination with partial pivoting.
// Returns null when the matrix is singular to working precision. For the receiver that
// means the satellites cannot pin down every unknown (for example, they all sit in a line).
export function inverse(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  let biggest = 0;
  for (const row of A) for (const v of row) biggest = Math.max(biggest, Math.abs(v));
  if (biggest === 0) return null;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12 * biggest) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((row) => row.slice(n));
}

// Weighted least squares: the x that minimises the sum of w_i (y_i − (G x)_i)^2.
//   x = (Gᵀ W G)⁻¹ Gᵀ W y,   and Q = (Gᵀ W G)⁻¹ is returned too (it gives the DOP).
// With as many rows as unknowns this is just the exact solution of G x = y.
export function leastSquares(G, y, w = null) {
  const Gt = transpose(G);
  const GtW = w ? Gt.map((row) => row.map((g, i) => g * w[i])) : Gt;
  const Q = inverse(matMul(GtW, G));
  if (!Q) return null;
  return { x: matVec(Q, matVec(GtW, y)), Q };
}

// Eigen-decomposition of a symmetric 2 × 2 matrix [[a, b], [b, d]]: used to draw error ellipses.
export function eig2(a, b, d) {
  const tr = a + d, det = a * d - b * b;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const angle = Math.abs(b) < 1e-15 ? (a >= d ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b);
  return { l1, l2, angle }; // l1 ≥ l2; angle is the direction of the l1 axis
}
