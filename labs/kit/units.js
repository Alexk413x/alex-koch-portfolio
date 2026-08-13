/* units.js — how a number reads in the panel, and how a typed one reads back. One definition per unit, shared by
 * every lab, so two rows describing the same kind of quantity cannot end up in different units.
 *
 * A formatter is `(v) => string` and nothing else: none may read state or touch the DOM.
 *
 * IT ALSO CARRIES `parse`, THE SAME CONVERSION BACKWARDS, so a row can be typed into in the unit it displays —
 * "42" into a row reading 42% means 0.42, not 42. The inverse is attached IN THE SAME FACTORY as the forward
 * direction on purpose: an inverse written anywhere else is a second description of one mapping, and the pair
 * drifts the moment either is edited. A formatter without `parse` is simply not typeable.
 */

const round = (v, d) => (d ? v.toFixed(d) : String(Math.round(v)));
const to = (fmt, parse) => { fmt.parse = parse; return fmt; };

/* Strips the unit off whatever was typed, so "42", "42%" and "42 °/s" all read as 42. Deliberately does NOT
 * accept exponent notation: 'e' occurs inside the suffixes ("13 steps"), and a control panel has no use for it. */
const num = (s) => parseFloat(String(s).replace(/[^0-9.+-]/g, ''));

export const as = {
  raw:    (digits = 0, suffix = '') => to((v) => round(v, digits) + suffix, num),
  pct:    (digits = 0) => to((v) => round(v * 100, digits) + '%', (s) => num(s) / 100),   // stored 0..1
  pct100: (digits = 0) => to((v) => round(v, digits) + '%', num),                         // already 0..100
  px:     (digits = 0) => to((v) => round(v, digits) + 'px', num),
  mult:   (digits = 2) => to((v) => v.toFixed(digits) + '×', num),
  hz:     (digits = 0) => to((v) => round(v, digits) + ' Hz', num),
  sec:    (digits = 1) => to((v) => v.toFixed(digits) + ' s', num),
  deg:    (digits = 0) => to((v) => round(v, digits) + '°', num),                         // stored in degrees
  rad:    (digits = 0) => to((v) => round(v * 180 / Math.PI, digits) + '°',
                             (s) => num(s) * Math.PI / 180),
  // For sliders whose quantity has no physical unit, where "58%" answers "how far up is this" and "1.74" does not.
  ofRange: (max) => to((v) => Math.round(v / max * 100) + '%', (s) => num(s) / 100 * max),
  // Stored in one unit, read in another: a 0..1.5 fraction shown as "125 m", a bow coefficient shown as an angle.
  scaled: (mul, digits = 0, suffix = '') => to((v) => round(v * mul, digits) + suffix, (s) => num(s) / mul),

  /* THE TWO WRAPPERS INHERIT THE INNER PARSE, which is what keeps a named end typeable: a row reading OFF or
   * WHITE still accepts a number in the inner unit. Typing the word back is not supported and does not need to
   * be — the slider's own end is one drag away, and a failed parse leaves the value untouched. */

  // Names the bottom of a range, so a glow of zero reads as disabled rather than as a slider stuck at 0px.
  off:  (inner, at = 0) => to((v) => (v <= at ? 'OFF' : inner(v)), inner.parse),
  // Names both ends: SQUARE at 0, ROUND at max, the inner formatter between. A label on a value beats a separate
  // toggle beside the slider, which is two widgets for one decision and can disagree with itself.
  ends: (inner, lo, hi, max) => to((v) => (v <= 0 ? lo : v >= max ? hi : inner(v)), inner.parse),
};
