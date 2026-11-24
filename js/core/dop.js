// Dilution of precision (DOP): how satellite geometry multiplies range errors into position errors.
// With independent range errors of size σ, the covariance of (east, north, up, clock) is σ²·Q,
// where Q = (GᵀG)⁻¹ and each row of G is [−e_E, −e_N, −e_U, 1] for the unit vector e to a
// satellite (Navipedia, "Positioning Error"). Q depends on geometry only.
//
// clockKnown = true removes the clock column ("I know the exact time").
// systems lists the satellite systems; each extra system adds its own clock column.

import { azElToEnu } from './geo.js';
import { transpose, matMul, inverse } from './linalg.js';

export function geometryMatrix(sats, { clockKnown = false } = {}) {
  const systems = clockKnown ? [] : [...new Set(sats.map((s) => s.sys ?? 'GPS'))];
  const G = sats.map((s) => {
    const e = azElToEnu(s.az, s.el);
    const row = [-e[0], -e[1], -e[2]];
    systems.forEach((sys) => row.push((s.sys ?? 'GPS') === sys ? 1 : 0));
    return row;
  });
  return { G, systems };
}

export function dopFromSky(sats, opts = {}) {
  const { G, systems } = geometryMatrix(sats, opts);
  const nU = 3 + systems.length;
  if (sats.length < nU) return { ok: false, reason: 'too-few', nUnknowns: nU, have: sats.length };
  const Q = inverse(matMul(transpose(G), G));
  if (!Q) return { ok: false, reason: 'geometry', nUnknowns: nU, have: sats.length };
  const qe = Q[0][0], qn = Q[1][1], qu = Q[2][2];
  const qt = systems.length ? Q[3][3] : 0;
  const out = {
    ok: true,
    Q,
    nUnknowns: nU,
    have: sats.length,
    east: Math.sqrt(qe),
    north: Math.sqrt(qn),
    up: Math.sqrt(qu),
    hdop: Math.sqrt(qe + qn),
    vdop: Math.sqrt(qu),
    pdop: Math.sqrt(qe + qn + qu),
    tdop: systems.length ? Math.sqrt(qt) : 0,
    gdop: Math.sqrt(Q.reduce((s, row, i) => s + row[i], 0)),
    // how strongly an error in height goes together with an error in the clock (−1 … 1)
    corrUpClock: systems.length ? Q[2][3] / Math.sqrt(qu * qt) : 0,
    // horizontal covariance block, for drawing the error ellipse
    covEN: [[Q[0][0], Q[0][1]], [Q[1][0], Q[1][1]]],
  };
  return out;
}
