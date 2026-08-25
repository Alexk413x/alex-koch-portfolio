/* team.js — Team
 *
 * The tablet is the whole cover, and the screen is the app: requests down the left, two answered and three
 * still open, and the photo they are raised against on the right. Same site as no. 10, same drawing of it,
 * different job.
 */

import { LINE, LIT, circle, group, path, pt, rect, use } from './kit.js';
import { fvFrame } from './parts.js';

export default function draw(g) {
  path(g, "M59 157H241L254 170V304L241 317H59L46 304V170Z", pt('body'));
  const g0 = group(g, pt({ stroke: LINE, w: 3.4 }));
  path(g0, "M59 157L46 170M241 157L254 170M46 304L59 317M254 304L241 317");
  const g1 = group(g, pt('tint'));
  rect(g1, 47, 200, 5, 18);
  rect(g1, 47, 226, 5, 18);
  rect(g1, 47, 252, 5, 18);
  rect(g1, 248, 200, 5, 18);
  rect(g1, 248, 226, 5, 18);
  rect(g1, 248, 252, 5, 18);
  rect(g, 54, 165, 192, 144, pt('mid'));
  rect(g, 58, 169, 184, 136, pt('panel'));
  path(g, "M147 181V293", pt({ stroke: LIT, strokeOp: 0.25 }));
  const g2 = group(g, pt('lit'));
  rect(g2, 66, 194, 10, 10);
  rect(g2, 66, 213, 10, 10);
  const g3 = group(g, pt('cut', { w: 1.9 }));
  path(g3, "M68.3 199L70.5 201.2L74 197.3M68.3 218L70.5 220.2L74 216.3");
  const g4 = group(g, pt('hair', { strokeOp: 0.7, w: 1.3 }));
  rect(g4, 66.7, 232.7, 8.6, 8.6);
  rect(g4, 66.7, 251.7, 8.6, 8.6);
  rect(g4, 66.7, 270.7, 8.6, 8.6);
  const g5 = group(g, pt('lit', { fillOp: 0.8 }));
  rect(g5, 81, 196, 55, 6);
  rect(g5, 81, 215, 44, 6);
  const g6 = group(g, pt('lit', { fillOp: 0.32 }));
  rect(g6, 81, 234, 58, 6);
  rect(g6, 81, 253, 38, 6);
  rect(g6, 81, 272, 50, 6);
  rect(g, 152, 204, 82, 66, pt('hair', { strokeOp: 0.4, w: 1 }));
  use(g, fvFrame(), pt({ fillOp: 1, w: 3.2, fill: LIT, stroke: LIT }), { transform: "translate(193 237) scale(.33) translate(-150 -212.5)" });
  circle(g, 150, 311, 2.8, pt('lit'));
}
