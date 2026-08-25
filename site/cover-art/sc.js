/* sc.js — Store Companion
 *
 * A rugged handheld, not a phone — chamfered body, overmould, scan window, side triggers. A short question
 * in, a long answer back — and the answer carries the agent mark, because the thing that mattered was that a
 * person did not have to go and read the document themselves.
 */

import { LINE, LIT, glyph, group, path, pt, rect, use } from './kit.js';
import { brain } from './parts.js';

export default function draw(g) {
  path(g, "M104 139H196L210 153V321L196 335H104L90 321V153Z", pt('shell'));
  path(g, "M107 146H193L203 156V318L193 328H107L97 318V156Z", pt('hair', { stroke: LINE, strokeOp: 0.3 }));
  const g0 = group(g, pt('tint'));
  rect(g0, 86, 211, 5, 26, null, { rx: 1 });
  rect(g0, 209, 211, 5, 26, null, { rx: 1 });
  rect(g, 134, 149, 32, 8, pt('mid', { w: 1.2 }), { rx: 1 });
  path(g, "M140 153h20", pt({ stroke: LINE, strokeOp: 0.4 }));
  rect(g, 100, 165, 100, 142, pt('far'), { rx: 2 });
  rect(g, 152, 173, 40, 22, pt('edge', { strokeOp: 0.6, w: 1.3 }), { rx: 6 });
  glyph(g, 172, 190, "?", 15, pt('knock', { fill: LINE }));
  rect(g, 106, 207, 88, 72, pt('lit', { fillOp: 0.12 }), { rx: 7 });
  use(g, brain(), null, { transform: "translate(150 228) scale(.9)" });
  const g1 = group(g, pt('lit'));
  rect(g1, 116, 249, 68, 4);
  rect(g1, 116, 258, 54, 4);
  rect(g1, 116, 267, 62, 4);
  rect(g, 106, 207, 88, 72, pt('edge', { stroke: LIT, w: 1.8 }), { rx: 7 });
  rect(g, 106, 285, 88, 14, pt('far'), { rx: 7 });
  path(g, "M178 288l6 4 -6 4z", pt('tint'));
}
