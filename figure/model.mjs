// The balance's model. Every number the figure shows comes from here.
export const MAX_TILT = 0.2;                  // rad, about 11°: the beam's end stops
export const RAD_PER_POINT = 0.07;            // one vol point of put−call difference tilts the beam 4°
export const WEIGHT_STEP = 2.5;               // one weight disc per 2.5 vol points
export const MAX_WEIGHTS = 8;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Beam tilt in radians. Positive = the call end (+x) rises = calls are the cheaper wing. */
export const tiltOf = (putIV, callIV) => clamp((putIV - callIV) * RAD_PER_POINT, -MAX_TILT, MAX_TILT);
/** Weight discs for a wing's 25Δ implied vol. */
export const weightsOf = (iv) => clamp(Math.round((iv || 0) / WEIGHT_STEP), 0, MAX_WEIGHTS);
/** Dial needle angle (radians, 0 = up, clockwise) for a 0–100 percentile over a 270° sweep. */
export const needleOf = (pct) => (-0.75 + 1.5 * clamp(pct == null ? 0 : pct, 0, 100) / 100) * Math.PI;
