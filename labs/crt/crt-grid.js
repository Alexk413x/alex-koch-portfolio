/* crt-grid.js — the calibration grid, PLOTTED rather than resampled.
 *
 * The lines are generated, so they can be generated bent. Each one is walked through the same projection F the guide
 * rings ride, so a grid line lands exactly on its ring BY CONSTRUCTION.
 *
 * Drawing the grid flat and pushing it through a displacement filter resamples the very lines the warp is judged by:
 * it softens them and carries the filter's quantization into the ruler. An SVG path in a stretched viewBox has no
 * pixel grid to be misaligned against, and because F and the box radius are both even functions of the angle, the
 * result is mirror-exact in both axes with no mirroring code at all.
 *
 * Pure: no DOM, no canvas, no component state.
 */
// The shared coordinate formatter. It lives in crt-geometry beside the ring ladder -- the other emitter of path
// strings -- because two copies of "how a coordinate is written" is two ways for two layers to disagree by a rounding.
import { fixed } from './crt-geometry.js';

/* THE BOX RADIUS along a ray — the distance from center to the edge of the RECTANGLE at that angle — is written
 * INLINE in radialMap and nowhere else.
 *
 * The source raster IS the box, so everything is measured in box fractions: normalizing the destination by the guide
 * radius while scaling the source by the box radius is what paints concentric rings through the middle.
 *
 * As a function of an ANGLE its only caller had just computed that angle from a point, then took |cos th| and
 * |sin th| back apart to recover the ratios it started from. This is the innermost loop in the instrument, so it
 * lives there in terms of the point. From an angle alone it is hw/|cos th| and hh/|sin th|.
 */

/* WHY HORIZONTAL LINES DO NOT BOW UNDER THE RADIAL MAP, and why no constant in this file will make them.
 *
 * u = r / boxRadius(theta), so u = 1 everywhere on the rectangle's PERIMETER: the level sets of u are concentric
 * RECTANGLES. radialMap scales each point along its own ray, and a radial scale sends concentric rectangles to
 * concentric rectangles — so straight edges stay straight BY CONSTRUCTION. This map cannot barrel-distort.
 *
 * FOUR ATTEMPTS TO FIX IT FROM HERE FAILED, all the same way, and they are recorded so a fifth is not attempted.
 * Blending the normalizer toward the inscribed circle does change the level sets and does bend lines — but circular
 * level sets on a box wider than it is tall put the CORNERS past u = 1, where the profile sags them hardest, so
 * every gain in side bow arrives with corner damage. Weighting that blend by angle only moves the damage around,
 * because side bow and corner shape are consequences of ONE level-set family. Undercutting the circle target makes
 * it worse everywhere at once.
 *
 * The bow is therefore added as its own term — see radialMap — rather than extracted from the radial one. If the
 * level sets themselves ever need to change, that is a decision about what surface this is and belongs in the
 * projection, not in a tuning constant here.
 */

/* The same radial map the grid and the rings use, as a reusable point mapper. A point at box-fraction u along its
 * ray lands at F(u) times the box radius, so the scale is F(u)/u. Sharing one mapper is why a scanline, a grid line
 * and a ring cannot end up describing three slightly different surfaces.
 *
 * F TAKES THE RAY AS WELL AS THE RADIUS — F(u, theta). The angle is already computed here for the box radius, so
 * passing it costs nothing, and a projection that reads it reaches every plotted layer through this one call. A
 * one-argument F simply ignores it.
 */
function radialMap(w, H, F) {
  const hw = w / 2, hh = H / 2;
  /* THE BOW TERM. The radial scale cannot produce it — see the note at the top of this file — so it is added
   * separately rather than extracted from the radial one.
   *
   * A point's vertical distance from the center line is reduced in proportion to how far out it sits horizontally:
   * the ends of a horizontal line are pulled toward the center while its middle stays put, which is the arc a domed
   * faceplate shows. (x/hw)² makes it zero on the vertical center line and strongest at the sides, and the y factor
   * makes it zero on the horizontal center line and strongest at the top and bottom edges.
   *
   * SCALED BY THE PROFILE'S OWN SAG, so it is not a second independent surface: 1 - F(1) is zero for a flat face and
   * grows with FACE. HORIZONTAL EXTENT IS UNTOUCHED — only y moves — so the corners keep the width they had.
   */
  const sag = F ? Math.max(0, 1 - F(1, 0)) : 0;
  const bow = sag * 0.55;
  return (x, y) => {
    const r = Math.hypot(x, y);
    if (r < 1e-9) return [50, 50];
    let k = 1;
    if (F) {
      const th = Math.atan2(y, x);
      /* THE BOX RADIUS OFF THE POINT, not off the angle. This was boxRadius(hw, hh, th), which recovered |cos th| and
       * |sin th| from an angle computed FROM x and y one line earlier -- and |cos th| is |x|/r, |sin th| is |y|/r, both
       * already in hand. Two transcendental calls per plotted point to re-derive two ratios we started from, on the
       * innermost loop every curved layer walks (~25k points per rebuild). Same formula, same numbers to float rounding. */
      const ax = Math.abs(x), ay = Math.abs(y);
      const rb = Math.min(ax > 1e-9 ? hw * r / ax : Infinity, ay > 1e-9 ? hh * r / ay : Infinity);
      const u = Math.min(1, r / rb);
      k = u > 1e-9 ? F(u, th) / u : 1;
    }
    const nx = hw > 1e-9 ? x / hw : 0;
    return [50 + (x * k) / w * 100, 50 + (y * k * (1 - bow * nx * nx)) / H * 100];
  };
}

/* Grid lines as SVG path strings in a 0-100 viewBox, ready to drop beside the rings.
 *
 *   w, H     the glass box in px (only its aspect matters — the viewBox is stretched onto it)
 *   N        divisions across the full span (40; one cell is 1/40 of the width)
 *   faceF    the projection, or null for a flat face
 *   samples  points per line. Straight lines need only 2 when flat; a bent line needs enough to read as a curve.
 *
 * Returns { lines: [d, ...], dots: [[x, y], ...] } — the cell centers, carried through the same map. The caller draws
 * the dots as ZERO-LENGTH SEGMENTS with a round line cap ("Mx,yh0"), not as arcs: a two-arc circle costs ~61 characters
 * per dot and 1600 of them was 97,600 characters of path data re-parsed on every FACE step, which measurably cost frames
 * during a drag. The cap form is ~18 characters and renders the same dot.
 */
export function curvedGridPaths(w, H, N, faceF, samples) {
  const hw = w / 2, hh = H / 2;
  const F = faceF;
  const S = Math.max(2, samples || (F ? 48 : 2));
  // radialMap, NOT a local copy of it. This function carried its own identical mapper, which is the one thing this module
  // exists not to do: when the projection gained its theta term the copy would have kept reading F as F(u) and the grid --
  // the instrument the warp is judged BY -- would have measured a different surface from the scanlines it measures.
  const map = radialMap(w, H, F);
  const fmt = (p) => fixed(p[0], 1e4) + ',' + fixed(p[1], 1e4);

  const lines = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // Vertical line at this x, walked down y.
    const x = -hw + t * w;
    let d = 'M';
    for (let j = 0; j < S; j++) d += (j ? 'L' : '') + fmt(map(x, -hh + (j / (S - 1)) * H));
    lines.push(d);
    // Horizontal line at this y, walked across x.
    const y = -hh + t * H;
    d = 'M';
    for (let j = 0; j < S; j++) d += (j ? 'L' : '') + fmt(map(-hw + (j / (S - 1)) * w, y));
    lines.push(d);
  }

  // Cell centers, through the same map. Coordinates only — the caller decides how to mark them.
  const dots = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      dots.push(map(-hw + ((i + 0.5) / N) * w, -hh + ((j + 0.5) / N) * H));
    }
  }
  return { lines: lines, dots: dots };
}
