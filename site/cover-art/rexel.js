/* rexel.js — Rexel USA
 *
 * Nine drawers of bolts and screws, every one labelled, and a phone held up in front of them reading the
 * middle one on the top row. The scanned drawer is the same drawing as the other eight with the light turned
 * up on its barcode, and the answer is already on the glass.
 */

import { LINE, LIT, group, path, pt, rect, use } from './kit.js';
import { rxDrawer } from './parts.js';

/* The cabinet, as a grid rather than as nine placements. The scanned drawer is the same drawing lit, so it is
   named by its cell and not by a tenth copy of the call — move a column and the scan cone is the only other
   thing that has to follow. */
const COLS = [44, 116, 188];
const ROWS = [148, 201, 254];
const SCANNED = { col: 1, row: 0 };
const DRAWER = pt('tint', { fillOp: 0.7, stroke: LINE });
const DRAWER_LIT = pt('lit', { fillOp: 1, stroke: LIT });

export default function draw(g) {
  ROWS.forEach((y, row) => COLS.forEach((x, col) => {
    use(g, rxDrawer(), col === SCANNED.col && row === SCANNED.row ? DRAWER_LIT : DRAWER, { x, y });
  }));
  path(g, "M150 212L128 172H172Z", pt('lit', { fillOp: 0.16 }));
  rect(g, 118, 214, 64, 128, pt('knock'), { rx: 9 });
  rect(g, 118, 214, 64, 128, pt('body'), { rx: 9 });
  rect(g, 142, 218, 16, 2.5, pt('tint'), { rx: 1.25 });
  rect(g, 138, 334, 24, 3, pt('tint'), { rx: 1.5 });
  rect(g, 124, 226, 52, 104, pt('panel'), { rx: 3 });
  rect(g, 128, 230, 44, 24, pt('far', { stroke: LIT, w: 0.9 }));
  const g0 = group(g, pt('lit'));
  rect(g0, 131, 234, 1.8, 16);
  rect(g0, 134.5, 234, 3, 16);
  rect(g0, 139, 234, 1.8, 16);
  rect(g0, 142.5, 234, 3.5, 16);
  rect(g0, 147.5, 234, 1.8, 16);
  rect(g0, 151, 234, 2.2, 16);
  rect(g0, 155, 234, 1.8, 16);
  rect(g0, 158.5, 234, 3.5, 16);
  rect(g0, 164, 234, 1.8, 16);
  rect(g, 128, 260, 40, 6.5, pt('lit', { fillOp: 0.85 }), { rx: 3.25 });
  rect(g, 128, 270, 26, 4.5, pt('soft'), { rx: 2.25 });
  path(g, "M128 280H172", pt({ stroke: LIT, strokeOp: 0.25 }));
  const g1 = group(g, pt('lit', { fillOp: 0.45 }));
  rect(g1, 128, 285, 18, 4, null, { rx: 2 });
  rect(g1, 128, 294, 22, 4, null, { rx: 2 });
  rect(g1, 128, 303, 16, 4, null, { rx: 2 });
  const g2 = group(g, pt('lit', { fillOp: 0.75 }));
  rect(g2, 158, 285, 14, 4, null, { rx: 2 });
  rect(g2, 160, 294, 12, 4, null, { rx: 2 });
  rect(g2, 156, 303, 16, 4, null, { rx: 2 });
  rect(g, 128, 313, 28, 8, pt('lit'), { rx: 2 });
}
