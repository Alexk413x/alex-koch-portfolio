/* fv.js — FieldView
 *
 * Three bays by three storeys on four columns. The second-floor beam skips the left bay and neither left
 * column carries on above it, so the whole left side falls away. Two bays are cross-braced and two take a
 * single diagonal, the top one landing on the side of a column because there is no beam up there to frame
 * into. The same frame again on the tablet held up in front of it, and the screen is the only lit thing on
 * the cover.
 */

import { LINE, LIT, circle, group, path, pt, rect, use } from './kit.js';
import { fvFrame } from './parts.js';

export default function draw(g) {
  use(g, fvFrame(), pt('body'));
  path(g, "M101 268H199L210 279V339L199 350H101L90 339V279Z", pt('knock'));
  path(g, "M101 268H199L210 279V339L199 350H101L90 339V279Z", pt('body'));
  const g0 = group(g, pt({ stroke: LINE, w: 3.4 }));
  path(g0, "M101 268L90 279M199 268L210 279M90 339L101 350M210 339L199 350");
  const g1 = group(g, pt('tint'));
  rect(g1, 91, 288, 5, 12);
  rect(g1, 91, 304, 5, 12);
  rect(g1, 91, 320, 5, 12);
  rect(g1, 204, 288, 5, 12);
  rect(g1, 204, 304, 5, 12);
  rect(g1, 204, 320, 5, 12);
  rect(g, 98, 276, 104, 66, pt('mid'));
  rect(g, 102, 280, 96, 58, pt('panel'));
  use(g, fvFrame(), pt({ fillOp: 1, w: 3, fill: LIT, stroke: LIT }), { transform: "translate(150 309) scale(.28) translate(-150 -212.5)" });
  const g2 = group(g, pt('hair', { strokeOp: 0.7, w: 2.2 }));
  path(g2, "M114 291V283H124M176 283H186V291M114 327V335H124M176 335H186V327");
  circle(g, 150, 344, 2.6, pt('lit'));
}
