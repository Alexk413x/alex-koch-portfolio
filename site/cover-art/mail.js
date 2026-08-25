/* mail.js — Yahoo! Mail
 *
 * An inbox, not an abstraction. Five messages, and the focus ring is the whole story — everything else on
 * the glass steps back a quarter so the one that has focus is unmistakable.
 */

import { LINE, LIT, circle, group, path, pt, rect } from './kit.js';

export default function draw(g) {
  rect(g, 96, 145, 108, 184, pt('knock'), { rx: 13 });
  rect(g, 96, 145, 108, 184, pt('shell'), { rx: 13 });
  rect(g, 134, 151, 32, 6, pt('knock', { fillOp: 0.41 }), { rx: 3 });
  rect(g, 103, 165, 94, 152, pt('far'), { rx: 5 });
  const g0 = group(g, null);
  rect(g0, 110, 170, 18, 13, pt('mid', { strokeOp: 0.56 }), { rx: 1.2 });
  path(g0, "M110 171.5l9 7.15l9 -7.15", pt('mid', { strokeOp: 0.56, join: "round" }));
  rect(g0, 136, 173, 34, 5, pt('tint', { fillOp: 0.41 }));
  path(g0, "M103 187h94", pt({ stroke: LINE, strokeOp: 0.26 }));
  const g1 = group(g, null);
  rect(g1, 110, 196, 13, 9, pt('far'), { rx: 1.2 });
  path(g1, "M110 197.5l6.5 4.95l6.5 -4.95", pt('far', { join: "round" }));
  rect(g1, 130, 195, 38, 4, pt('tint', { fillOp: 0.41 }));
  rect(g1, 130, 203, 54, 3.5, pt('tint', { fillOp: 0.22 }));
  circle(g1, 189, 200, 2.2, pt('tint', { fillOp: 0.52 }));
  path(g1, "M107 215h86", pt({ stroke: LINE, strokeOp: 0.17 }));
  const g2 = group(g, null);
  rect(g2, 110, 220, 13, 9, pt('far'), { rx: 1.2 });
  path(g2, "M110 221.5l6.5 4.95l6.5 -4.95", pt('far', { join: "round" }));
  rect(g2, 130, 219, 30, 4, pt('tint', { fillOp: 0.41 }));
  rect(g2, 130, 227, 46, 3.5, pt('tint', { fillOp: 0.22 }));
  path(g2, "M107 239h86", pt({ stroke: LINE, strokeOp: 0.17 }));
  const g3 = group(g, null);
  rect(g3, 110, 268, 13, 9, pt('far'), { rx: 1.2 });
  path(g3, "M110 269.5l6.5 4.95l6.5 -4.95", pt('far', { join: "round" }));
  rect(g3, 130, 267, 34, 4, pt('tint', { fillOp: 0.41 }));
  rect(g3, 130, 275, 50, 3.5, pt('tint', { fillOp: 0.22 }));
  circle(g3, 189, 272, 2.2, pt('tint', { fillOp: 0.52 }));
  path(g3, "M107 287h86", pt({ stroke: LINE, strokeOp: 0.17 }));
  const g4 = group(g, null);
  rect(g4, 110, 292, 13, 9, pt('far'), { rx: 1.2 });
  path(g4, "M110 293.5l6.5 4.95l6.5 -4.95", pt('far', { join: "round" }));
  rect(g4, 130, 291, 28, 4, pt('tint', { fillOp: 0.41 }));
  rect(g4, 130, 299, 44, 3.5, pt('tint', { fillOp: 0.22 }));
  path(g4, "M107 311h86", pt({ stroke: LINE, strokeOp: 0.17 }));
  rect(g, 105, 237, 90, 28, pt('lit', { fillOp: 0.14 }), { rx: 3 });
  const g5 = group(g, null);
  rect(g5, 110, 244, 13, 9, pt('mid', { stroke: LIT, strokeOp: 1 }), { rx: 1.2 });
  path(g5, "M110 245.5l6.5 4.95l6.5 -4.95", pt({ fill: null, stroke: LIT, strokeOp: 1, w: 1.1, join: "round" }));
  rect(g5, 130, 243, 42, 4, pt('lit'));
  rect(g5, 130, 251, 58, 3.5, pt('lit', { fillOp: 0.52 }));
  rect(g, 105, 237, 90, 28, pt('edge', { stroke: LIT, w: 2.4 }), { rx: 3 });
}
