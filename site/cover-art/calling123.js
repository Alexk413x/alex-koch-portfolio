/* calling123.js — 123 Calling
 *
 * A child’s tablet with tiger ears, and on it 一 二 三 — one, two, three, drawn as the strokes they are. The
 * app taught English; this is the language the child brought to it. Two lessons done, one to go.
 */

import { LINE, LIT, circle, ellipse, group, pt, rect } from './kit.js';

export default function draw(g) {
  const g0 = group(g, pt('body'));
  circle(g0, 100, 168, 26);
  circle(g0, 200, 168, 26);
  const g1 = group(g, pt({ fill: LIT, stroke: LIT, fillOp: 0.35, strokeOp: 0.6, w: 1.3 }));
  circle(g1, 100, 160, 13);
  circle(g1, 200, 160, 13);
  rect(g, 60, 162, 180, 170, pt('knock'), { rx: 24 });
  rect(g, 60, 162, 180, 170, pt('body'), { rx: 24 });
  const g2 = group(g, pt('tint', { fillOp: 0.45 }));
  rect(g2, 63, 202, 8, 5, null, { rx: 2.5 });
  rect(g2, 63, 227, 8, 5, null, { rx: 2.5 });
  rect(g2, 63, 252, 8, 5, null, { rx: 2.5 });
  rect(g2, 229, 202, 8, 5, null, { rx: 2.5 });
  rect(g2, 229, 227, 8, 5, null, { rx: 2.5 });
  rect(g2, 229, 252, 8, 5, null, { rx: 2.5 });
  rect(g, 74, 178, 152, 124, pt('panel'), { rx: 12 });
  rect(g, 110, 188, 80, 8, pt('lit', { fillOp: 0.45 }), { rx: 4 });
  const g3 = group(g, pt('lit'));
  rect(g3, 84, 237, 36, 6, null, { rx: 3 });
  rect(g3, 137, 228, 26, 6, null, { rx: 3 });
  rect(g3, 132, 246, 36, 6, null, { rx: 3 });
  rect(g3, 184, 222, 28, 6, null, { rx: 3 });
  rect(g3, 188, 237, 20, 6, null, { rx: 3 });
  rect(g3, 180, 252, 36, 6, null, { rx: 3 });
  const g4 = group(g, pt('lit'));
  circle(g4, 138, 290, 3.5);
  circle(g4, 150, 290, 3.5);
  circle(g, 162, 290, 3.5, pt('lit', { fillOp: 0.3 }));
  circle(g, 150, 317, 12, pt({ fill: LINE, stroke: LINE, fillOp: 0.2, strokeOp: 0.6, w: 1.3 }));
  const g5 = group(g, pt('lit'));
  ellipse(g5, 150, 320, 5, 4);
  circle(g5, 145, 313, 1.8);
  circle(g5, 148.5, 311.5, 1.8);
  circle(g5, 151.5, 311.5, 1.8);
  circle(g5, 155, 313, 1.8);
}
