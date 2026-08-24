/* qaai.js — QAAI
 *
 * The browser in front, iOS and Android tucked behind either shoulder — and the same agent glyph on all
 * three screens, drawn once and placed three times.
 *
 * THE TWO SIDE GLYPHS RUN UNDER THE BROWSER. At 1.15 they reached its edge and stopped there, which reads as
 * three things in a row rather than two behind one — an overlap has to be big enough to be read as an overlap.
 * At 1.5 each clears the browser's edge by about six units and still keeps three of margin inside its own
 * screen, which is what caps the size: 1.6 would touch the glass.
 *
 * The browser's own glyph is 2.4, and it has to stay the biggest of the three or the object in FRONT is not the
 * one carrying the subject. Its ceiling is the window's height, not its width: the content area below the
 * chrome bar is 96 deep and the glyph is about 29 tall per unit of scale.
 */

import { LINE, circle, group, path, pt, rect, use } from './kit.js';
import { brain } from './parts.js';

export default function draw(g) {
  /* The iPhone's glass runs to a 5px bezel all round and the sensor bar is an ISLAND ON IT, not a slot in the
     bezel above it — which is the whole difference between this phone and the one it was drawn as. Screen
     before bar, because the bar sits on the screen. The Android on the right already worked this way: its
     camera is a punch-hole inside its own glass. */
  rect(g, 34, 175, 64, 124, pt('shell'), { rx: 11 });
  rect(g, 39, 180, 54, 110, pt('mid', { strokeOp: 0.45 }), { rx: 5 });
  rect(g, 53, 184, 26, 6, pt('hair', { stroke: LINE, strokeOp: 0.4 }), { rx: 3 });
  path(g, "M53 295h26", pt({ stroke: LINE, strokeOp: 0.45, w: 1.6, cap: "round" }));
  use(g, brain(), null, { transform: "translate(66 235) scale(1.5)" });
  rect(g, 202, 175, 64, 124, pt('shell'), { rx: 6 });
  circle(g, 234, 190, 3, pt('hair', { stroke: LINE, strokeOp: 0.4 }));
  rect(g, 206, 181, 56, 110, pt('mid', { strokeOp: 0.45 }), { rx: 4 });
  use(g, brain(), null, { transform: "translate(234 236) scale(1.5)" });
  rect(g, 84, 181, 132, 112, pt('knock'), { rx: 4 });
  rect(g, 84, 181, 132, 112, pt('edge'), { rx: 4 });
  path(g, "M84 197h132", pt({ stroke: LINE, strokeOp: 0.55, w: 1.1 }));
  const g0 = group(g, pt('tint', { fillOp: 0.55 }));
  circle(g0, 93, 189, 2);
  circle(g0, 100, 189, 2);
  circle(g0, 107, 189, 2);
  rect(g, 116, 185, 94, 8, pt('hair', { stroke: LINE, strokeOp: 0.45 }), { rx: 4 });
  use(g, brain(), null, { transform: "translate(150 245) scale(2.4)" });
}
