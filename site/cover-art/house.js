/* house.js — Housekeeping
 *
 * A house and a sun on the top half of the phone — one outline and one lit door, nothing else — the list for
 * it on the bottom half, three done and one to go. The whole job in one place is the tagline and also the
 * layout.
 */

import { LIT, circle, group, path, pt, rect } from './kit.js';

export default function draw(g) {
  const g0 = group(g, pt('tint', { fillOp: 0.45 }));
  rect(g0, 93.5, 178, 2.5, 14, null, { rx: 1.2 });
  rect(g0, 93.5, 196, 2.5, 14, null, { rx: 1.2 });
  rect(g0, 204, 182, 2.5, 20, null, { rx: 1.2 });
  rect(g, 96, 130, 108, 214, pt('body'), { rx: 14 });
  rect(g, 140, 140, 20, 3, pt('tint'), { rx: 1.5 });
  rect(g, 133, 333, 34, 3.5, pt('tint'), { rx: 1.75 });
  rect(g, 103, 150, 94, 176, pt('panel'), { rx: 5 });
  circle(g, 175, 172, 7.5, pt('lit'));
  const g1 = group(g, pt({ stroke: LIT, strokeOp: 0.6, w: 1.6, cap: "round" }));
  path(g1, "M185 172H189M182.07 164.93L184.9 162.1M175 162V158M167.93 164.93L165.1 162.1M165 172H161M167.93 179.07L165.1 181.9M175 182V186M182.07 179.07L184.9 181.9");
  path(g, "M113 230V196L145 174L177 196V230Z", pt({ fill: LIT, stroke: LIT, fillOp: 0.2, strokeOp: 0.8, w: 1.7, join: "round" }));
  rect(g, 137, 208, 16, 22, pt('lit'));
  path(g, "M111 236H189", pt({ stroke: LIT, strokeOp: 0.25 }));
  const g2 = group(g, pt('lit'));
  rect(g2, 111, 248, 11, 11, null, { rx: 2 });
  rect(g2, 111, 267, 11, 11, null, { rx: 2 });
  rect(g2, 111, 286, 11, 11, null, { rx: 2 });
  const g3 = group(g, pt('cut'));
  path(g3, "M113.4 253.5L115.8 255.9L119.6 251.7M113.4 272.5L115.8 274.9L119.6 270.7M113.4 291.5L115.8 293.9L119.6 289.7");
  rect(g, 111.7, 305.7, 9.6, 9.6, pt('hair', { strokeOp: 0.7, w: 1.3 }), { rx: 1.8 });
  const g4 = group(g, pt('lit', { fillOp: 0.8 }));
  rect(g4, 128, 250.5, 52, 6, null, { rx: 3 });
  rect(g4, 128, 269.5, 40, 6, null, { rx: 3 });
  rect(g4, 128, 288.5, 47, 6, null, { rx: 3 });
  rect(g, 128, 307.5, 34, 6, pt('lit', { fillOp: 0.32 }), { rx: 3 });
}
