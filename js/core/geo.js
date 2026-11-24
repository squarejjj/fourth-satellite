// Coordinates. We use a spherical Earth throughout (the real system uses the WGS84 ellipsoid;
// that changes heights by tens of metres but not the ideas shown on this site).
//   ECEF — Earth-centred, Earth-fixed x, y, z in metres
//   ENU  — local east, north, up at the receiver, in metres

import { R_EARTH, R_GPS } from './constants.js';
import { add, scale, dot } from './linalg.js';

const RAD = Math.PI / 180;

export function llaToEcef(latDeg, lonDeg, h = 0) {
  const lat = latDeg * RAD, lon = lonDeg * RAD, r = R_EARTH + h;
  return [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)];
}

// Unit vectors pointing east, north and up at a place on the sphere.
export function enuBasis(latDeg, lonDeg) {
  const lat = latDeg * RAD, lon = lonDeg * RAD;
  return {
    e: [-Math.sin(lon), Math.cos(lon), 0],
    n: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
    u: [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)],
  };
}

export const ecefToEnu = (d, B) => [dot(d, B.e), dot(d, B.n), dot(d, B.u)];
export const enuToEcef = (v, B) => add(add(scale(B.e, v[0]), scale(B.n, v[1])), scale(B.u, v[2]));

// Direction to a satellite at azimuth az (degrees clockwise from north) and elevation el,
// as east/north/up components of a unit vector.
export function azElToEnu(azDeg, elDeg) {
  const az = azDeg * RAD, el = elDeg * RAD;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
}

// Place a satellite on a sphere of radius `orbit` so that, from `userEcef`, it appears at the
// given azimuth and elevation. Solves |user + d·u| = orbit for the distance d along the
// line of sight u.
export function satelliteAt(userEcef, basis, azDeg, elDeg, orbit = R_GPS) {
  const u = enuToEcef(azElToEnu(azDeg, elDeg), basis);
  const pu = dot(userEcef, u);
  const d = -pu + Math.sqrt(pu * pu - dot(userEcef, userEcef) + orbit * orbit);
  return add(userEcef, scale(u, d));
}

// A whole sky: the receiver at (lat, lon) and satellites given by azimuth/elevation.
export function makeSky({ lat = 37.5, lon = 127, h = 0 } = {}, sats = [], orbit = R_GPS) {
  const user = llaToEcef(lat, lon, h);
  const basis = enuBasis(lat, lon);
  return {
    user,
    basis,
    sats: sats.map((s) => ({ ...s, pos: satelliteAt(user, basis, s.az, s.el, orbit) })),
  };
}
