/* parts.js — the drawings more than one cover needs, and the gradients and masks they paint with.
 *
 * REGISTERED ONCE IN THE DOCUMENT, PLACED MANY TIMES. The rack builds and destroys covers as it turns, so a
 * defs block per cover would be seventeen copies of the same six gradients. Everything here is idempotent:
 * calling for a part that already exists returns its id and draws nothing.
 *
 * A shared part carries NO color of its own on the shapes that vary. Fill, stroke, their opacities and the
 * stroke width all inherit from the <use>, which is why one drawing of FieldView's steel frame can be the
 * building on no. 10, the photograph of it on no. 11's screen, and a thumbnail on either.
 */

import { rect, path, circle, group, node, share, shareGradient, pt, LIT, DEEP } from './kit.js';

/* ---- gradients and masks ---- */

/* A lamp: full at the fitting, gone by the floor. Three covers point one at something. */
export function lampC() {
  return shareGradient('ca-lampC', 'linear', { x1: 0, y1: 0, x2: 0, y2: 1 },
    [[0, LIT, 0.42], [1, LIT, 0]]);
}

/* A beam seen along its length rather than across it, so it is brightest near the far end. */
export function beam() {
  return shareGradient('ca-beam', 'linear', { x1: 0, y1: 0, x2: 0, y2: 1 },
    [[0, LIT, 0.16], [0.45, LIT, 0.3], [0.86, LIT, 0.52], [1, LIT, 0.14]]);
}

/* A pool of light on a surface. */
export function pool() {
  return shareGradient('ca-pool', 'radial', { cx: 0.5, cy: 0.5, r: 0.5 },
    [[0, LIT, 0.45], [1, LIT, 0]]);
}

/* Two masks that fade a drawing out rather than cropping it. `boxFade` keeps the middle of the shelf and lets
   the ends go; `isuIn` does the opposite, dropping the middle of the trailer so the load is not drawn on. */
function fadeMask(id, gradId, gradAttrs, stops, box) {
  shareGradient(gradId, 'radial', Object.assign({ gradientUnits: 'userSpaceOnUse' }, gradAttrs), stops);
  return share(id, 'mask', {}, (m) => {
    m.appendChild(node('rect', {
      x: box[0], y: box[1], width: box[2], height: box[3], fill: 'url(#' + gradId + ')'
    }));
  });
}

export const boxFade = () => fadeMask('ca-boxFade', 'ca-fadeG',
  { cx: 150, cy: 200, r: 104 }, [[0, 'on'], [0.56, 'on'], [1, 'off']], [0, 116, 300, 86]);

export const isuIn = () => fadeMask('ca-isuIn', 'ca-isuFade',
  { cx: 150, cy: 239, r: 92 }, [[0, 'off'], [0.44, 'off'], [1, 'on']], [90, 159, 120, 130]);

/* ---- the agent glyph ----
 *
 * Drawn at the origin so a cover places it with a transform. It is always amber; nothing about it varies.
 */
export function brain() {
  return share('ca-brain', 'g', {}, (g) => {
    path(g, 'M0 -12C5 -14 11 -11 12 -6C16 -4 16 3 12 6C12 11 6 13 0 11C-6 13 -12 11 -12 6C-16 3 -16 -4 -12 -6C-11 -11 -5 -14 0 -12Z',
      pt('glow', { fillOp: 0.12, stroke: LIT, w: 1.5, join: 'round' }));
    const wires = group(g, pt('trace', { strokeOp: null, w: 1.2, cap: 'round', join: 'round' }));
    ['M0 -11V10', 'M0 -7H-6V-2', 'M0 2H-8', 'M0 7H-4', 'M0 -3H4V-9', 'M0 5H7V1', 'M0 9H5']
      .forEach((d) => path(wires, d));
    const nodes = group(g, pt('lit'));
    [[0, -11, 1.7], [-6, -2, 1.6], [-8, 2, 1.4], [-4, 7, 1.4], [4, -9, 1.5], [7, 1, 1.6], [5, 9, 1.3]]
      .forEach(([cx, cy, r]) => circle(nodes, cx, cy, r));
  });
}

/* ---- FieldView's steel frame ----
 *
 * Three bays by three stories on four columns, x = 40, 109, 177, 246 (14 wide) and y = 187, 238, 289 (12 deep).
 * The 187 beam skips the left bay and both left columns start at 187, so the left side falls away above the
 * first floor: the frame is still going up.
 *
 * NOTHING OVERLAPS ANYTHING. Beams are cut per bay and frame into the column faces instead of running through
 * them, so a beam edge and a column edge coincide at a joint rather than crossing. Each X is ONE path whose
 * four interior vertices are the real line intersections, so no edge inside it is drawn twice. Brace ends are
 * square cuts whose edge passes exactly through the joint corner, and the knockout is painted before the
 * members so a buried end never shows through the member covering it.
 *
 * Move a column or a level and every number in this function has to be recomputed.
 */
const FV_MEMBERS = [
  [40, 187, 14, 114], [109, 187, 14, 114], [177, 124, 14, 177], [246, 124, 14, 177],
  [123, 187, 54, 12], [191, 187, 55, 12],
  [54, 238, 55, 12], [123, 238, 54, 12], [191, 238, 55, 12],
  [54, 289, 55, 12], [123, 289, 54, 12], [191, 289, 55, 12]
];

const FV_BRACES = [
  // X, left bay, bottom story
  'M52.26 252.45L55.74 247.55L81.5 265.82L107.26 247.55L110.74 252.45L86.7 269.5L110.74 286.55L107.26 291.45L81.5 273.18L55.74 291.45L52.26 286.55L76.31 269.5Z',
  // X, center bay, middle story
  'M121.24 201.43L124.76 196.57L150 214.8L175.24 196.57L178.76 201.43L155.12 218.5L178.76 235.57L175.24 240.43L150 222.2L124.76 240.43L121.24 235.57L144.88 218.5Z',
  // the top-floor brace, which has no beam to frame into and so dies inside the x = 177 column
  'M248.04 184.8L186.44 127.68L182.36 132.08L243.96 189.2Z',
  // single diagonal, right bay, middle story
  'M192.74 240.45L247.74 201.45L244.26 196.55L189.26 235.55Z'
];

export function fvFrame() {
  return share('ca-fvFrame', 'g', { 'stroke-linejoin': 'miter' }, (g) => {
    FV_BRACES.forEach((d) => path(g, d));
    const cut = group(g, pt('knock', { fillOp: 1, stroke: null }));
    FV_MEMBERS.forEach(([x, y, w, h]) => rect(cut, x, y, w, h));
    FV_MEMBERS.forEach(([x, y, w, h]) => rect(g, x, y, w, h));
  });
}

/* ---- Rexel's parts drawer ----
 *
 * 68 x 46, placed nine times. Body and handle are fixed; the label border and the barcode carry no color, so
 * the one drawer being scanned is the same drawing lit rather than a second copy of it.
 */
const RX_BARS = [[15, 2], [18.5, 3], [23, 2], [26.5, 4], [32, 2], [35.5, 2.8], [39.5, 2], [43, 4], [48.5, 2], [52, 2.5]];

export function rxDrawer() {
  return share('ca-rxDrawer', 'g', {}, (g) => {
    rect(g, 0, 0, 68, 46, pt('body', { strokeOp: 0.55, w: 1.1 }));
    rect(g, 12, 8, 44, 14, pt({ fill: DEEP, fillOp: 1, strokeOp: 0.5, w: 0.9 }));
    const bars = group(g, pt({ stroke: null }));
    RX_BARS.forEach(([x, w]) => rect(bars, x, 10.5, w, 9));
    rect(g, 24, 33, 20, 5, pt('tint', { stroke: null }), { rx: 2.5 });
  });
}
