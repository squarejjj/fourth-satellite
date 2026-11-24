// The error budget: typical size (1σ, metres) of each error in one satellite's range.
// Independent errors combine as the root of the sum of squares (RSS), and the position error
// is roughly DOP × that total ("UERE", user equivalent range error).
// Values: National Research Council (1995), "The Global Positioning System: A Shared National
// Asset", Table 3-1 (selective availability on) and Table 3-3 (off). These are textbook
// typical values from 1995, not what a modern phone gets.

export const BUDGET_1995 = [
  { key: 'sa', label: 'Selective availability (deliberate, ended 2000)', sigma: 24.0 },
  { key: 'iono', label: 'Ionosphere', sigma: 7.0 },
  { key: 'clockEph', label: 'Satellite clock and orbit', sigma: 3.6 },
  { key: 'noise', label: 'Receiver noise', sigma: 1.5 },
  { key: 'multipath', label: 'Multipath (open sky)', sigma: 1.2 },
  { key: 'tropo', label: 'Troposphere', sigma: 0.7 },
];

export const rss = (values) => Math.sqrt(values.reduce((s, v) => s + v * v, 0));

// Each error's share of the total variance (its square over the sum of squares).
export function varianceShares(values) {
  const total = values.reduce((s, v) => s + v * v, 0);
  return values.map((v) => (total ? (v * v) / total : 0));
}

// "2 drms": twice the root-mean-square horizontal error, about a 95% radius.
// The 1995 report computes it as 2 × UERE × HDOP.
export const twoDrms = (uere, hdop) => 2 * uere * hdop;
