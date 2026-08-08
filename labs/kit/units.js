/* units.js — how a number reads in the panel. One definition per unit, shared by every lab, so two rows
 * describing the same kind of quantity cannot end up in different units.
 *
 * A formatter is `(v) => string` and nothing else: none may read state or touch the DOM.
 */

const round = (v, d) => (d ? v.toFixed(d) : String(Math.round(v)));

export const as = {
  raw:    (digits = 0, suffix = '') => (v) => round(v, digits) + suffix,
  pct:    (digits = 0) => (v) => round(v * 100, digits) + '%',        // stored 0..1
  pct100: (digits = 0) => (v) => round(v, digits) + '%',              // already 0..100
  px:     (digits = 0) => (v) => round(v, digits) + 'px',
  mult:   (digits = 2) => (v) => v.toFixed(digits) + '×',
  hz:     (digits = 0) => (v) => round(v, digits) + ' Hz',
  sec:    (digits = 1) => (v) => v.toFixed(digits) + ' s',
  deg:    (digits = 0) => (v) => round(v, digits) + '°',              // stored in degrees
  rad:    (digits = 0) => (v) => round(v * 180 / Math.PI, digits) + '°',
  rpm:    (digits = 0) => (v) => round(v / (2 * Math.PI) * 60, digits) + ' RPM',
  // For sliders whose quantity has no physical unit, where "58%" answers "how far up is this" and "1.74" does not.
  ofRange: (max) => (v) => Math.round(v / max * 100) + '%',
  // Stored in one unit, read in another: a 0..1.5 fraction shown as "125 m", a bow coefficient shown as an angle.
  scaled: (mul, digits = 0, suffix = '') => (v) => round(v * mul, digits) + suffix,

  // Names the bottom of a range, so a glow of zero reads as disabled rather than as a slider stuck at 0px.
  off:  (inner, at = 0) => (v) => (v <= at ? 'OFF' : inner(v)),
  // Names both ends: SQUARE at 0, ROUND at max, the inner formatter between. A label on a value beats a separate
  // toggle beside the slider, which is two widgets for one decision and can disagree with itself.
  ends: (inner, lo, hi, max) => (v) => (v <= 0 ? lo : v >= max ? hi : inner(v)),
};
