// Physical constants used everywhere on the site.
// Where a value comes from the GPS specification (IS-GPS-200) we use that value,
// because a real receiver has to use exactly what the satellites assume.

export const C = 299792458;               // speed of light in m/s (exact by definition of the metre)
export const MU = 3.986005e14;            // Earth's gravitational parameter, m^3/s^2 (IS-GPS-200 value)
export const OMEGA_E = 7.2921151467e-5;   // Earth's rotation rate, rad/s (IS-GPS-200 value)
export const R_EARTH = 6371000;           // mean Earth radius in m (we model a spherical Earth)
export const R_GPS = 26560000;            // radius of a GPS orbit from Earth's centre, m (about 20,190 km up)
export const DAY = 86400;                 // seconds in a day

// Carrier frequencies (IS-GPS-200 / IS-GPS-705)
export const F_L1 = 1575.42e6;
export const F_L2 = 1227.60e6;
export const F_L5 = 1176.45e6;

// Code chipping rates: L1 C/A sends 1,023,000 chips per second, L5 ten times as many.
export const CHIP_RATE_CA = 1.023e6;
export const CHIP_RATE_L5 = 10.23e6;
export const CA_CODE_LENGTH = 1023;       // chips in one repeat of the C/A code (one repeat = 1 ms)

// Handy conversions for labels: how far light goes in one unit of time.
export const M_PER_MS = C / 1000;         // ≈ 299.79 km per millisecond
export const M_PER_US = C / 1e6;          // ≈ 299.79 m per microsecond
export const M_PER_NS = C / 1e9;          // ≈ 0.2998 m (30 cm) per nanosecond
