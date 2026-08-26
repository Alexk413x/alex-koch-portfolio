/* self.js — Self Pickup
 *
 * Twenty-five bays, nobody behind it. The rack is symmetric; what is in it is not — no two parcels the same
 * size, three bays already collected. One fixture, and you can see it: the ray comes off the lamp and lands
 * on the center bay.
 */

import { DEEP, LINE, LIT, STRONG, ellipse, group, path, pt, rect } from './kit.js';
import { beam, pool } from './parts.js';

/* THE WALL, AS A TABLE. Twenty-five bays, twenty-two of them holding a parcel, and every parcel is the same
   four shapes: the box, a lighter lid across its top, a seam down its center and — on five of them — a label
   in the bottom-right corner. Written out it was sixty-six lines carrying twenty-two hand-typed opacities,
   which is a ramp typed out, and a ramp typed out is a ramp that drifts.
   x, y, w, h, the box's own weight, then the lid's depth and weight. Two more numbers means a label. */
const PARCELS = [
  [45, 179, 34, 20, 0.18, 6, 0.3],
  [96, 181, 24, 18, 0.15, 5, 0.27, 9, 5],
  [136, 181, 28, 18, 0.16, 5, 0.28],
  [177, 183, 34, 16, 0.2, 5, 0.32],
  [223, 179, 30, 20, 0.14, 6, 0.26],
  [44, 207, 26, 20, 0.16, 6, 0.28],
  [89, 213, 34, 14, 0.19, 4, 0.31],
  [133, 207, 34, 20, 0.17, 6, 0.29, 9, 5],
  [221, 207, 34, 20, 0.13, 6, 0.25, 9, 5],
  [45, 235, 34, 20, 0.2, 6, 0.32],
  [98, 235, 20, 20, 0.15, 6, 0.27],
  [177, 235, 34, 20, 0.17, 6, 0.29],
  [222, 239, 22, 16, 0.14, 5, 0.26],
  [45, 269, 30, 14, 0.15, 4, 0.27, 9, 5],
  [89, 263, 34, 20, 0.18, 6, 0.3],
  [138, 267, 24, 16, 0.15, 5, 0.27],
  [182, 263, 26, 20, 0.16, 6, 0.28],
  [221, 265, 34, 18, 0.19, 5, 0.31],
  [45, 293, 34, 18, 0.17, 5, 0.29],
  [133, 293, 34, 18, 0.16, 5, 0.28],
  [177, 291, 34, 20, 0.14, 6, 0.26],
  [220, 291, 28, 20, 0.18, 6, 0.3, 9, 5]
];

/* Local to this cover on purpose: a wall of stock is not part of the shared vocabulary, and putting it in
   kit.js would be one cover's idea standing where every cover has to read it. */
const PARCEL = { fill: LIT, stroke: LIT, strokeOp: 0.42, w: 1.1 };
const TAG_INSET = 4;

export default function draw(g) {
  path(g, "M130 158L170 158L164 163L136 163Z", pt('knock', { fill: LINE }));
  path(g, "M40 175L260 175L260 315L40 315Z", pt('edge'));
  const g0 = group(g, pt('mid'));
  path(g0, "M40 203h220M40 231h220M40 259h220M40 287h220M84 175v140M128 175v140M172 175v140M216 175v140");
  const g1 = group(g, null);
  PARCELS.forEach(([x, y, w, h, op, lidH, lidOp, tagW, tagH]) => {
    rect(g1, x, y, w, h, pt(PARCEL, { fillOp: op }));
    rect(g1, x, y, w, lidH, pt('lit', { fillOp: lidOp }));
    path(g1, 'M' + (x + w / 2) + ' ' + y + 'v' + h, pt({ stroke: LIT, strokeOp: 0.32 }));
    if (tagW) rect(g1, x + w - tagW - TAG_INSET, y + h - tagH - TAG_INSET, tagW, tagH, pt('soft'));
  });
  path(g, "M137 164L163 164L176 261L124 261Z", pt({ fillRef: beam() }));
  ellipse(g, 150, 245, 40, 26, pt({ fillRef: pool() }));
  rect(g, 133, 235, 34, 20, pt('lit'));
  rect(g, 133, 235, 34, 6, pt('knock', { fill: STRONG, fillOp: 0.22 }));
  path(g, "M150 235v20", pt({ stroke: DEEP, strokeOp: 0.5, w: 1.2 }));
}
