/* pick.js — Pickup
 *
 * The back of an SUV in the bay and nothing else — spoiler, wrapped tail lights, valance, twin tips. The
 * plate is the only lit thing, because the plate is what the associate matches the order against.
 */

import { DEEP, LINE, group, path, pt, rect } from './kit.js';

export default function draw(g) {
  path(g, "M66 258V318Q66 330 76 330H84Q94 330 94 318V258Z", pt('shell', { strokeOp: 0.75, w: 1.5 }));
  path(g, "M206 258V318Q206 330 216 330H224Q234 330 234 318V258Z", pt('shell', { strokeOp: 0.75, w: 1.5 }));
  const g0 = group(g, pt('knock'));
  path(g0, "M78 179H222L232 264H68Z");
  path(g0, "M68 264H232L236 300H64Z");
  const g1 = group(g, pt('body', { strokeOp: 0.7, w: 1.2 }));
  path(g1, "M72.7 224H64V230H72Z");
  path(g1, "M227.3 224H236V230H228Z");
  const g2 = group(g, pt('shell', { w: 1.4 }));
  path(g2, "M64 214H52A4 4 0 0 0 48 218V236A4 4 0 0 0 52 240H64Z");
  path(g2, "M236 214H248A4 4 0 0 1 252 218V236A4 4 0 0 1 248 240H236Z");
  path(g, "M82 170H218L222 179H78Z", pt('body'));
  path(g, "M78 179H222L232 264H68Z", pt('body'));
  path(g, "M90 188H210L215 227H85Z", pt('mid', { fill: DEEP }));
  path(g, "M85 238H215", pt({ stroke: LINE, strokeOp: 0.35 }));
  const g3 = group(g, pt({ fill: LINE, stroke: LINE, fillOp: 0.4, strokeOp: 0.75, w: 1.3 }));
  path(g3, "M70.6 242H104V250H86V264H68Z");
  path(g3, "M229.4 242H196V250H214V264H232Z");
  path(g, "M68 264H232L236 300H64Z", pt('tint', { fillOp: 0.25 }));
  path(g, "M96 300H64L68 264H232L236 300H204", pt('edge'));
  const g4 = group(g, pt({ stroke: LINE, strokeOp: 0.35 }));
  path(g4, "M96 264V300M204 264V300M68 280H232");
  const g5 = group(g, pt({ fill: LINE, stroke: LINE, fillOp: 0.45, strokeOp: 0.6, w: 1.1 }));
  rect(g5, 74, 284, 14, 8, null, { rx: 1.5 });
  rect(g5, 212, 284, 14, 8, null, { rx: 1.5 });
  path(g, "M94 300H206L200 316H100Z", pt('shell', { strokeOp: 0.5, w: 1.1 }));
  const g6 = group(g, pt('mid', { fill: LINE, fillOp: 0.3 }));
  rect(g6, 108, 304, 20, 7, null, { rx: 2 });
  rect(g6, 172, 304, 20, 7, null, { rx: 2 });
  rect(g, 122, 268, 56, 24, pt('body'), { rx: 2 });
  rect(g, 128, 274, 44, 12, pt('lit'));
}
