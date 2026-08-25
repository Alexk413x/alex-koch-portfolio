/* isu.js — ISU
 *
 * Straight into the mouth of a trailer, and one pallet in it. The lines run in from the opening and are gone
 * before they reach the load — the library everything else is built on, doing one unload.
 */

import { DEEP, LINE, LIT, group, path, pt, rect } from './kit.js';
import { isuIn } from './parts.js';

export default function draw(g) {
  path(g, "M84 153H216V309H84Z", pt('body'));
  rect(g, 90, 159, 120, 130, pt('mid', { fill: DEEP }));
  const g0 = group(g, pt({ fill: null, stroke: LINE, strokeOp: 0.7, w: 1.3, mask: isuIn() }));
  path(g0, "M90 159L150 224M210 159L150 224M90 289L150 224M210 289L150 224");
  path(g0, "M90 189L150 224M210 189L150 224M90 259L150 224M210 259L150 224", pt({ strokeOp: 0.35 }));
  const g1 = group(g, pt({ fill: LINE, stroke: LINE, fillOp: 0.35, strokeOp: 0.7, w: 1.3 }));
  rect(g1, 96, 293, 32, 12, null, { rx: 2 });
  rect(g1, 172, 293, 32, 12, null, { rx: 2 });
  const g2 = group(g, pt('body'));
  path(g2, "M112 309H122V325H178V309H188V325H216V336H84V325H112Z");
  const g3 = group(g, pt({ fill: LIT, stroke: LIT, fillOp: 0.16, w: 1.6 }));
  rect(g3, 132, 206, 38, 30, null, { rx: 1 });
  rect(g3, 116, 236, 34, 32, null, { rx: 1 });
  rect(g3, 152, 236, 34, 32, null, { rx: 1 });
  const g4 = group(g, pt('hair', { strokeOp: 0.45 }));
  path(g4, "M151 206v30M133 236v32M169 236v32M132 215h38M116 245h34M152 245h34");
  rect(g, 122, 250, 16, 11, pt('lit'));
  const g5 = group(g, pt({ fill: LINE, stroke: LINE, fillOp: 0.3, strokeOp: 0.8, w: 1.3 }));
  rect(g5, 112, 268, 76, 5);
  rect(g5, 114, 273, 12, 8);
  rect(g5, 144, 273, 12, 8);
  rect(g5, 174, 273, 12, 8);
  rect(g5, 112, 281, 76, 4);
}
