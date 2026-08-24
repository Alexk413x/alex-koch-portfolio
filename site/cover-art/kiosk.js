/* kiosk.js — Asian Art Museum
 *
 * A framed print on one plinth and a vessel on the other, each under its own spot, and the kiosk between them
 * with no light on it at all. Installed beside the art: the art gets the lamps, the kiosk makes its own light.
 */

import { LIT, circle, group, path, pt, rect } from './kit.js';
import { lampC } from './parts.js';

export default function draw(g) {
  path(g, "M47 160L24 320H94L71 160Z", pt({ fillRef: lampC() }));
  path(g, "M229 160L206 320H276L253 160Z", pt({ fillRef: lampC() }));
  rect(g, 57, 140, 4, 8, pt('body'));
  path(g, "M51 148H67 L71 160H47 Z", pt('body'));
  rect(g, 48, 157, 22, 2.5, pt('lit'));
  rect(g, 239, 140, 4, 8, pt('body'));
  path(g, "M233 148H249 L253 160H229 Z", pt('body'));
  rect(g, 230, 157, 22, 2.5, pt('lit'));
  /* THE PLINTHS ARE OUTLINE ONLY, so each spot carries on through the box under the piece it is lighting
     instead of stopping dead on a filled slab. They had a knockout under them for the opposite reason — to
     stop the beam — and both went together, because a transparent plinth over an opaque cut is just the cut. */
  const g0 = group(g, pt('edge'));
  rect(g0, 37, 284, 44, 50);
  rect(g0, 219, 284, 44, 50);
  rect(g, 40, 221, 38, 63, pt('knock'));
  rect(g, 40, 221, 38, 63, pt('body'));
  rect(g, 45, 226, 28, 53, pt('mid'));
  circle(g, 59, 244, 8.5, pt('lit', { fillOp: 0.8 }));
  rect(g, 46, 266, 26, 7, pt('lit', { fillOp: 0.45 }));
  const g2 = group(g, null, { transform: "translate(91 -22)" });
  path(g2, "M136 306 q-6-30 6-42 q-8-14 8-20 q16 6 8 20 q12 12 6 42 z", pt('lit'));
  path(g2, "M142 306 q-4-26 4-36 q8 10 4 36 z", pt('mid'));
  const g3 = group(g, pt('knock'));
  rect(g3, 112, 208, 76, 88, null, { rx: 6 });
  rect(g3, 144, 296, 12, 30);
  rect(g3, 122, 326, 56, 8, null, { rx: 3 });
  const g4 = group(g, pt('body'));
  rect(g4, 112, 208, 76, 88, null, { rx: 6 });
  rect(g4, 144, 296, 12, 30);
  rect(g4, 122, 326, 56, 8, null, { rx: 3 });
  rect(g, 118, 214, 64, 76, pt('panel'), { rx: 3 });
  rect(g, 124, 220, 24, 24, pt('lit'));
  rect(g, 154, 222, 22, 5, pt('lit', { fillOp: 0.85 }), { rx: 2.5 });
  rect(g, 154, 231, 16, 4, pt('soft'), { rx: 2 });
  const g5 = group(g, pt('lit', { fillOp: 0.4 }));
  rect(g5, 124, 252, 52, 4, null, { rx: 2 });
  rect(g5, 124, 260, 44, 4, null, { rx: 2 });
  rect(g5, 124, 268, 48, 4, null, { rx: 2 });
  rect(g5, 124, 276, 30, 4, null, { rx: 2 });
}
