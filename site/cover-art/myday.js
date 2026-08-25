/* myday.js — myDay
 *
 * Dead centre, dead upright. The carton is a single face whose bottom edge is the only hard line on it;
 * everything above falls away in an arc, so what you get is the surface being read and nothing else. The
 * beam leaves the scan window, the label lights, the tick comes back — that is the whole loop, a hundred
 * thousand times a day.
 */

import { LINE, LIT, group, path, pt, rect } from './kit.js';
import { boxFade } from './parts.js';

export default function draw(g) {
  const g0 = group(g, pt({ mask: boxFade() }));
  path(g0, "M4 122H296V200H4Z", pt('body'));
  const g1 = group(g0, pt({ stroke: LINE, strokeOp: 0.35 }));
  path(g1, "M78 122V200M222 122V200M4 148H296");
  path(g, "M134 220H166L182 190H118Z", pt('lit', { fillOp: 0.09 }));
  const g2 = group(g, pt({ stroke: LIT, strokeOp: 0.3, w: 1.2 }));
  path(g2, "M134 220L118 190M166 220L182 190");
  rect(g, 118, 166, 64, 32, pt('lit'));
  const g3 = group(g, pt('knock'));
  rect(g3, 124, 172, 3, 20);
  rect(g3, 130, 172, 4, 20);
  rect(g3, 137, 172, 2, 20);
  rect(g3, 142, 172, 4, 20);
  rect(g3, 148, 172, 3, 20);
  rect(g3, 154, 172, 5, 20);
  rect(g3, 162, 172, 2, 20);
  rect(g3, 167, 172, 4, 20);
  rect(g3, 174, 172, 3, 20);
  rect(g, 124, 197, 52, 2.5, pt('knock', { fillOp: 0.45 }));
  path(g, "M112 182H188", pt({ stroke: LIT, w: 2, cap: "round" }));
  path(g, "M122 220H178L190 232V340L178 352H122L110 340V232Z", pt('shell'));
  path(g, "M125 226H175L185 235V337L175 346H125L115 337V235Z", pt('hair', { stroke: LINE, strokeOp: 0.3 }));
  rect(g, 134, 228, 32, 7, pt('mid', { w: 1.2 }), { rx: 1 });
  const g4 = group(g, pt('tint'));
  rect(g4, 105, 256, 5, 24, null, { rx: 1 });
  rect(g4, 190, 256, 5, 24, null, { rx: 1 });
  rect(g, 119, 242, 62, 92, pt('far'), { rx: 2 });
  const g5 = group(g, pt('knock', { fill: LINE }));
  rect(g5, 126, 248, 40, 3.5, pt({ fillOp: 0.4 }));
  rect(g5, 126, 256, 46, 3, pt({ fillOp: 0.28 }));
  rect(g5, 126, 300, 42, 3, pt({ fillOp: 0.28 }));
  rect(g5, 126, 308, 34, 3, pt({ fillOp: 0.28 }));
  rect(g5, 126, 316, 38, 3, pt({ fillOp: 0.28 }));
  rect(g, 123, 268, 54, 22, pt({ fill: LIT, stroke: LIT, fillOp: 0.14, w: 1.6 }), { rx: 2 });
  path(g, "M130 279l4.5 4.5 8.5 -9.5", pt('litLine', { w: 1.9 }));
  rect(g, 148, 277, 22, 4.5, pt('lit'));
}
