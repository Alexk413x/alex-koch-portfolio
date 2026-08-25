/* tab.js — TabbedOut
 *
 * A rounded counter-top terminal on a trapezoid foot — hospitality kit, not a field device — and the screen
 * split three ways: options to press on the left, the tab building in the middle, and the receipt printed on
 * the right. The receipt is the only solid thing on the cover, because it is the part the customer leaves
 * with.
 */

import { LIT, group, path, pt, rect } from './kit.js';

export default function draw(g) {
  rect(g, 40, 143, 220, 140, pt('body'), { rx: 16 });
  rect(g, 48, 151, 204, 124, pt('mid'), { rx: 9 });
  rect(g, 52, 155, 196, 116, pt('panel'), { rx: 6 });
  path(g, "M116 283H184L216.4 326.2Q220 331 214 331H86Q80 331 83.6 326.2Z", pt('body', { join: "round" }));
  const g0 = group(g, pt('lit'));
  rect(g0, 58, 161, 16, 5, null, { rx: 2.5 });
  const g1 = group(g, pt('lit', { fillOp: 0.3 }));
  rect(g1, 79, 161, 16, 5, null, { rx: 2.5 });
  rect(g1, 100, 161, 16, 5, null, { rx: 2.5 });
  const g2 = group(g, pt('hair', { strokeOp: 0.45, w: 1.2 }));
  rect(g2, 58.6, 171.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g2, 100.6, 171.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g2, 58.6, 193.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g2, 100.6, 193.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g2, 58.6, 215.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g2, 79.6, 215.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g2, 100.6, 215.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g2, 58.6, 237.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g2, 79.6, 237.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g2, 100.6, 237.6, 16.8, 16.8, null, { rx: 3.4 });
  rect(g, 79, 193, 18, 18, pt('lit'), { rx: 4 });
  rect(g, 79, 171, 18, 18, pt({ fill: LIT, stroke: LIT, fillOp: 0.2, strokeOp: 0.45, w: 1.2 }), { rx: 4 });
  const g3 = group(g, pt('lit'));
  rect(g3, 124, 168, 8, 8, null, { rx: 2 });
  rect(g3, 124, 182, 8, 8, null, { rx: 2 });
  rect(g3, 124, 196, 8, 8, null, { rx: 2 });
  const g4 = group(g, pt('hair', { strokeOp: 0.5, w: 1.2 }));
  rect(g4, 124.6, 210.6, 6.8, 6.8, null, { rx: 1.8 });
  rect(g4, 124.6, 224.6, 6.8, 6.8, null, { rx: 1.8 });
  const g5 = group(g, pt('lit', { fillOp: 0.8 }));
  rect(g5, 136, 169.5, 34, 5, null, { rx: 2.5 });
  rect(g5, 136, 183.5, 28, 5, null, { rx: 2.5 });
  rect(g5, 136, 197.5, 38, 5, null, { rx: 2.5 });
  const g6 = group(g, pt('lit', { fillOp: 0.45 }));
  rect(g6, 136, 211.5, 24, 5, null, { rx: 2.5 });
  rect(g6, 136, 225.5, 31, 5, null, { rx: 2.5 });
  path(g, "M124 240H176", pt({ stroke: LIT, strokeOp: 0.3 }));
  const g7 = group(g, pt('lit'));
  rect(g7, 124, 246, 8, 6, null, { rx: 2 });
  rect(g7, 136, 246, 40, 6, null, { rx: 3 });
  path(g, "M182 164H242V244L234.5 249L227 244L219.5 249L212 244L204.5 249L197 244L189.5 249L182 244Z", pt('lit'));
  const g8 = group(g, pt('knock'));
  rect(g8, 202, 170, 20, 5);
  rect(g8, 188, 180, 48, 1.5);
  rect(g8, 188, 187, 24, 3.5);
  rect(g8, 226, 187, 10, 3.5);
  rect(g8, 188, 196, 24, 3.5);
  rect(g8, 226, 196, 10, 3.5);
  rect(g8, 188, 205, 24, 3.5);
  rect(g8, 226, 205, 10, 3.5);
  rect(g8, 188, 214, 24, 3.5);
  rect(g8, 226, 214, 10, 3.5);
  rect(g8, 188, 225, 48, 1.5);
  rect(g8, 188, 231, 16, 5);
  rect(g8, 222, 231, 14, 5);
}
