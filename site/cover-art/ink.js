/* ink.js — Ink Usage Dashboard
 *
 * The dashboard and nothing around it: three figures across the top, usage by unit in the middle with the
 * worst one lit, and along the bottom the line that is the whole point — the time the job took, falling away
 * to the right.
 *
 * The five panels are OUTLINE ONLY. A tinted card behind each one made the cover read as a screenshot of a
 * dashboard rather than as the dashboard; with the ground gone the charts sit on the box's own face, which is
 * what every other cover in the set does with its subject.
 */

import { LIT, circle, group, path, pt, rect } from './kit.js';

export default function draw(g) {
  rect(g, 34, 146, 72, 40, pt('edge'));
  rect(g, 42, 154, 28, 4, pt('lit', { fillOp: 0.4 }), { rx: 2 });
  rect(g, 42, 164, 34, 10, pt('lit'), { rx: 2 });
  path(g, "M80 174L86 168L92 172L98 162", pt('trace'));
  rect(g, 114, 146, 72, 40, pt('edge'));
  rect(g, 122, 154, 28, 4, pt('lit', { fillOp: 0.4 }), { rx: 2 });
  rect(g, 122, 164, 34, 10, pt('lit', { fillOp: 0.75 }), { rx: 2 });
  path(g, "M160 174L166 168L172 172L178 162", pt('trace'));
  rect(g, 194, 146, 72, 40, pt('edge'));
  rect(g, 202, 154, 28, 4, pt('lit', { fillOp: 0.4 }), { rx: 2 });
  rect(g, 202, 164, 34, 10, pt('lit', { fillOp: 0.75 }), { rx: 2 });
  path(g, "M240 174L246 168L252 172L258 162", pt('trace'));
  rect(g, 34, 196, 232, 76, pt('edge'));
  const g0 = group(g, pt({ stroke: LIT, strokeOp: 0.15 }));
  path(g0, "M44 222H256M44 242H256");
  const g1 = group(g, pt('lit'));
  rect(g1, 46, 236, 16, 26, pt({ fillOp: 0.5 }));
  rect(g1, 70, 220, 16, 42, pt({ fillOp: 0.5 }));
  rect(g1, 94, 228, 16, 34, pt({ fillOp: 0.5 }));
  rect(g1, 118, 210, 16, 52, pt({ fillOp: 0.5 }));
  rect(g1, 142, 218, 16, 44, pt({ fillOp: 0.5 }));
  rect(g1, 166, 204, 16, 58);
  rect(g1, 190, 224, 16, 38, pt({ fillOp: 0.5 }));
  rect(g1, 214, 212, 16, 50, pt({ fillOp: 0.5 }));
  rect(g1, 238, 232, 16, 30, pt({ fillOp: 0.5 }));
  path(g, "M44 262H256", pt({ stroke: LIT, strokeOp: 0.4 }));
  rect(g, 34, 282, 232, 46, pt('edge'));
  path(g, "M44 288 L71 293 L98 291 L125 298 L152 306 L179 311 L206 315 L233 317 L256 318 L256 320 L44 320Z", pt('glow'));
  path(g, "M44 288 L71 293 L98 291 L125 298 L152 306 L179 311 L206 315 L233 317 L256 318", pt('litLine'));
  path(g, "M44 320H256", pt({ stroke: LIT, strokeOp: 0.35 }));
  circle(g, 256, 318, 3, pt('lit'));
}
