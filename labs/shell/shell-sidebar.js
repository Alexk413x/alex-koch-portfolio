/* THE CATALOG: one of every control kit/panel.js can build, and one of every formatter units.js offers.
 *
 * This is the file to read before writing a lab's own sidebar, and the file to copy from. Everything below is
 * annotated with WHY a control is the kind it is, because choosing the wrong widget is the commonest mistake in a
 * panel and none of them is a syntax error.
 *
 *   A ROW'S KIND IS ITS SHAPE. panel.js reads it off the spec, so nothing here says which widget it wants:
 *     ['k', 'LABEL', lo, hi, step]     slider
 *     ['k', 'LABEL', 0, 1, 1]          toggle      (0..1 step 1 is one bit, not a range)
 *     ['k', 'LABEL', ['A','B','C']]    one-of-N
 *     ['k', 'LABEL', '#']              color swatch
 *
 *   ANY ROW may carry a trailing options object:
 *     { when: ['otherKey', [1, 2]] }   present only while that key holds one of those values
 *     { wide: true }                   no label, full panel width, double height -- for glyph choices that have
 *                                      to read as silhouettes (Reactor's core SHAPE) rather than as words
 *
 *   A SECTION is [name, rows] or [name, rows, masterKey].
 */
import { as } from '../kit/units.js';

export const SHAPES = ['SQUARE', 'CIRCLE', 'OCTAGON', 'BAR'];

export const SECTIONS = [
  /* RENDER FIRST, the convention every lab here follows: it sets the resolution everything else is drawn at, so it
   * governs every section rather than belonging to one -- and it is the control you reach for when the frame rate
   * is wrong, which is not a reason to scroll to the bottom. */
  ['RENDER', [['renderScale', 'RENDER SCALE', 0.35, 1, 0.01]]],

  ['SUBJECT', [
    /* ONE-OF-N, not four toggles and not a 0..3 slider. As toggles nothing enforces that exactly one is lit and two
     * can read as active at once; as a slider "OCTAGON" becomes a numeric position between two others, which is a
     * lie about a set that has no order. */
    ['shape', 'SHAPE', SHAPES],
    ['size', 'SIZE', 0.05, 0.95, 0.005],
    ['aspect', 'ASPECT', 0.2, 3, 0.01],
    ['rot', 'ROTATE', -180, 180, 1],
    ['radius', 'CORNER', 0, 1, 0.01],
    ['weight', 'LINE', 0.5, 8, 0.5],
  ]],

  ['INK', [
    // A COLOR HAS NO MEANINGFUL MIN, MAX OR STEP, and a hex string in a numeric readout is not a control -- which
    // is why '#' sits where the range would.
    ['ink', 'COLOR', '#'],
    ['hue', 'HUE SHIFT', -3.1416, 3.1416, 0.01],
    ['glow', 'GLOW', 0, 80, 1],
    ['opacity', 'OPACITY', 0, 1, 0.01],
  ]],

  /* A SECTION MASTER IS NOT A FOLD, and this section exists to show the difference. The master switches the debug
   * overlay OFF -- it changes the picture. Folding just hides these rows while everything carries on exactly as it
   * was. Both can apply at once, so the rows show only when open AND enabled. Conflating them would mean you could
   * not tidy the panel without changing what you are looking at. */
  ['DEBUG', [
    ['outline', 'BOUNDS', 0, 1, 1],
    ['cross', 'CROSSHAIR', 0, 1, 1],
  ], 'debugOn'],
];

/* THE FORMATTERS, and this table is half the point of the file: every style units.js offers, on a real slider, so
 * you can see what each reads like before choosing one.
 *
 * A ROW WITH NO ENTRY still works -- panel.js falls back to a rounded number -- so a formatter is a decision about
 * legibility, not a requirement. ASPECT below is deliberately left on the fallback to show what that looks like.
 */
export const FMT = {
  renderScale: as.pct(),                                   // 0..1 -> "62%"
  size:        as.pct(),                                   // a fraction of the half-height
  rot:         as.deg(),                                   // already degrees -> "-45°"
  hue:         as.rad(),                                   // stored in RADIANS, read in degrees
  weight:      as.mult(1),                                 // "2.5×"
  opacity:     as.pct(),
  // NAMED ENDS: 0 is not "0%", it is SQUARE, and 1 is ROUND. The ends of this range mean something the middle does not.
  radius:      as.ends(as.pct(), 'SQUARE', 'ROUND', 1),
  // OFF AT THE BOTTOM: a glow of zero reads as disabled rather than as a broken slider sitting at 0px.
  glow:        as.off(as.px()),
  // aspect: left out on purpose — see the note above.
};
