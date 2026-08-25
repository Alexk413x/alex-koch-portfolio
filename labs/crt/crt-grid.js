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

/* A DISPLACEMENT MAP FOR THE THINGS THAT CANNOT BE PLOTTED.
 *
 * Everything else here generates geometry already bent, which is exact and sharp. Two layers cannot take that route:
 * the light fixture and its rail are a nested assembly of divs, gradients and 3D transforms, not shapes with
 * outlines -- there is no path to plot. The only mechanism that bends a whole subtree is resampling it.
 *
 * THIS IS THE LENS, DELIBERATELY AND NARROWLY. It was deleted for good reasons: it softened every line, carried the
 * map's 8-bit quantization, and imposed a raster ceiling. None of those objections apply HERE, because the only thing
 * pointed at it is a blurred reflection -- soft, low-contrast, already diffused by MATTE. A resampler is the wrong
 * tool for a scanline and the right one for a highlight.
 *
 * Encodes the same radialMap displacement as an image: red carries dx, green dy, both around a 0.5 midpoint, scaled
 * by `span` px. Returns a data URL, or '' for a flat face -- no filter needed, so the caller can skip the work.
 */
/* RESOLUTION, IN BOTH AXES OF THE WORD -- and both were costing visible blocks.
 *
 * SPATIAL. The map was a fixed 128x128 stretched by preserveAspectRatio="none" onto the glass box (1527x1069 at the sizes
 * this lab runs), so one texel covered ~12x8 output pixels and every pixel in that block was displaced by an identical
 * amount. That is a staircase, not a curve. It is now sampled at the box's OWN aspect ratio -- `size` is the long edge,
 * the short edge follows -- so texels stay square in output space instead of being stretched 1.4x more horizontally than
 * vertically, and the caller can ask for enough of them.
 *
 * AMPLITUDE. The channels are 8-bit and `span` is both the encoding range AND the feDisplacementMap scale, so one channel
 * step is span/127 px of movement. The caller passed a quarter of the glass (267px), while the real bend is a small
 * fraction of that -- most of the range was never reached and what remained moved in ~2.1px jumps. The span is now MEASURED:
 * one pass finds the true maximum |dx|,|dy|, and the encoding is fitted to it, so the full 0-255 is used no matter how
 * gentle the face is. At a 40px bend that is a 0.31px step instead of 2.1px.
 *
 * Returns { url, span } -- the caller must set feDisplacementMap's scale from the RETURNED span, not from its own guess,
 * or the picture is displaced by the wrong multiple. Empty url for a flat face; no filter needed, so the caller can skip.
 */
export function displacementMap(w, H, F, size, span) {
  if (!F) return { url: '', span: 0 };
  /* Sampled at the box's aspect so a texel is square where it lands. Rounded to even numbers because an odd count puts a
   * sample exactly on the center line, where the displacement is identically zero -- harmless, but it wastes the one row
   * and column that carry the most curvature on either side of them. */
  var L = Math.max(32, size || 128);
  var NX = Math.max(32, 2 * Math.round((w >= H ? L : L * (w / H)) / 2));
  var NY = Math.max(32, 2 * Math.round((w >= H ? L * (H / w) : L) / 2));
  var cv = document.createElement('canvas'); cv.width = NX; cv.height = NY;
  var cx = cv.getContext('2d'); if (!cx) return { url: '', span: 0 };
  var img = cx.createImageData(NX, NY), d = img.data, map = radialMap(w, H, F);
  /* PASS ONE: the displacement field, kept, and its extent. Storing it costs NX*NY*2 floats and saves calling radialMap
   * a second time -- the map is the expensive part here, not the arithmetic around it. */
  var fx = new Float32Array(NX * NY), fy = new Float32Array(NX * NY), mx = 0;
  for (var j = 0; j < NY; j++) {
    for (var i = 0; i < NX; i++) {
      // Pixel center in picture-local px, centerd on the box, then asked where the projection sends it.
      var x = ((i + 0.5) / NX - 0.5) * w, y = ((j + 0.5) / NY - 0.5) * H;
      var q = map(x, y);
      /* NEGATED, BECAUSE feDisplacementMap SAMPLES BACKWARDS. radialMap answers "where does this point GO" -- the forward
       * displacement every other layer here plots with. feDisplacementMap asks the opposite question: for the pixel it is
       * about to write at (x,y), which source pixel should it FETCH? That is P(x + scale*(Rc-0.5), y + scale*(Gc-0.5)),
       * an inverse lookup, so encoding the forward vector bent the reflected fixture the wrong way -- outward where the
       * glass pushes in, and inward where it bulges. It curved, so it looked deliberate; it just curved opposite to the
       * surface every plotted layer agrees on.
       *
       * The inverse of a small displacement is its negation, which is exact enough here: the map is sampled at 128px over
       * a face whose displacement is a fraction of the box, so the second-order error is far below the 8-bit quantization
       * the channels already carry.
       */
      var dx = -((q[0] / 100 * w - w / 2) - x), dy = -((q[1] / 100 * H - H / 2) - y);
      var p = j * NX + i;
      fx[p] = dx; fy[p] = dy;
      if (Math.abs(dx) > mx) mx = Math.abs(dx);
      if (Math.abs(dy) > mx) mx = Math.abs(dy);
    }
  }
  /* The fitted range, with the caller's value as a CEILING rather than the value itself: a caller that knows the filter
   * region cannot afford a larger scale still gets to cap it. Floored at 1px so a nearly-flat face cannot divide by zero
   * and blow the encoding up into noise. */
  var R = Math.max(1, span ? Math.min(mx, span) : mx);
  /* PASS TWO: encode against the measured range.
   *
   * dx GOES IN BLUE AND dy IN RED, which looks arbitrary and is not. Chrome's feDisplacementMap
   * couples the axes when it is wired the obvious way round: with xChannelSelector="R"
   * yChannelSelector="G", a map whose horizontal channel is exactly 128 everywhere -- an explicit
   * instruction to move nothing sideways -- still slides content sideways in proportion to the
   * VERTICAL displacement, which shears the fixture over. Reproduced with none of this project's
   * code in the page, at three different map resolutions, and measured across every channel pairing:
   * R/G shears 21px across a 700px box, B/R shears 0.00px, and the vertical bend is identical under
   * both. So the field is unchanged and only its storage moves.
   *
   * GREEN IS LEFT NEUTRAL RATHER THAN ZEROED. It carries nothing now, but 128 is this encoding's
   * "no displacement", so a filter that ever reads green by mistake gets a still picture instead of
   * the map's whole range as a hard yank. Blue used to be the 0 here for the same reason in reverse.
   *
   * THIS PAIRS WITH clReflDisp / clReflDispFix in the lab's <defs>. Change one without the other and
   * the reflection is driven by whichever channel happens to be neutral: no warp at all, or a warp
   * on the wrong axis. */
  for (var q2 = 0, k = 0; q2 < NX * NY; q2++, k += 4) {
    d[k] = Math.max(0, Math.min(255, Math.round(128 + (fy[q2] / R) * 127)));       // y <- RED
    d[k + 1] = 128;                                                               // unused, neutral
    d[k + 2] = Math.max(0, Math.min(255, Math.round(128 + (fx[q2] / R) * 127)));   // x <- BLUE
    d[k + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  /* The scale the caller must use. 127, not 128: the encoding maps R to channel 255, and feDisplacementMap reads
   * (c/255 - 0.5), so a full-scale texel displaces by scale*(127/255). Handing back R*255/127 makes that come out at
   * exactly R px, which is what the field says it should be. */
  return { url: cv.toDataURL('image/png'), span: R * 255 / 127 };
}

/* radialMap, exposed for callers that plot ONE point at a time.
 *
 * Everything else here plots a whole shape and keeps the map private. The terminal cannot: it places one glyph per cell,
 * so it needs the mapping itself rather than a path built from it. Exposed rather than reimplemented, because a second
 * copy of this function is a second surface -- the exact drift the note above warns about.
 */
export function mapPoint(w, H, x, y, F) {
  return radialMap(w, H, F)(x, y);
}

/* A ROUNDED RECTANGLE, PLOTTED THROUGH THE SAME MAP. The phosphor glow was the last full-bleed layer whose shape was
 * built in flat CSS -- absolutely positioned divs with a border-radius -- so on a domed face it sat square while
 * everything under it bowed. Sampled per edge and mapped point by point, it bends like the rest.
 *
 * Input is picture-local px with a top-left origin, which is what getBoundingClientRect gives the caller; output is the
 * shared 0-100 viewBox the other plotted layers use, so one <svg> can hold any of them.
 */
export function curvedRectPath(w, H, rect, radius, faceF, samples) {
  const map = radialMap(w, H, faceF);
  const S = Math.max(1, samples || (faceF ? 6 : 1));
  const rr = Math.max(0, Math.min(radius || 0, Math.min(rect.w, rect.h) / 2));
  const x0 = rect.x - w / 2, y0 = rect.y - H / 2, x1 = x0 + rect.w, y1 = y0 + rect.h;
  const pts = [];
  const push = (x, y) => pts.push(map(x, y));
  // Corners as quarter arcs, edges as straight runs -- both sampled, because a straight run in flat space is not
  // straight once mapped and two endpoints would cut the bow off.
  const arc = (cx, cy, a0, a1) => {
    const n = Math.max(2, Math.round(S * 1.5));
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  };
  const edge = (ax, ay, bx, by) => { for (let i = 1; i <= S; i++) push(ax + (bx - ax) * (i / S), ay + (by - ay) * (i / S)); };
  arc(x0 + rr, y0 + rr, Math.PI, Math.PI * 1.5);
  edge(x0 + rr, y0, x1 - rr, y0);
  arc(x1 - rr, y0 + rr, Math.PI * 1.5, Math.PI * 2);
  edge(x1, y0 + rr, x1, y1 - rr);
  arc(x1 - rr, y1 - rr, 0, Math.PI * 0.5);
  edge(x1 - rr, y1, x0 + rr, y1);
  arc(x0 + rr, y1 - rr, Math.PI * 0.5, Math.PI);
  edge(x0, y1 - rr, x0, y0 + rr);
  if (!pts.length) return '';
  let d = '';
  for (let i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + fixed(pts[i][0], 1e3) + ',' + fixed(pts[i][1], 1e3);
  return d + 'Z';
}

/* SCANLINES and the aperture GRILLE, plotted rather than resampled — one path of `count` lines.
 *
 * A repeating-linear-gradient is a flat texture: it cannot follow the curved surface, and it has no idea where the
 * projection put the rim. Phosphor lines are ON the surface, so they are generated bent through the same F the grid and
 * the rings ride.
 *
 * TAKES A COUNT, NOT A PITCH, and this is the whole point of the signature. It used to take a pitch and walk outward
 * from the center in both directions in multiples of it, which meant the number of lines you got was whatever fell
 * inside the box — the caller asked for a 2.5px pitch and could not say how many lines that was without measuring. The
 * SCANLINES control is labeled in LINES, so lines is what it must be able to promise. Here N in is N out:
 *
 *   line k sits at the CENTER of the k-th of N equal bands,  c = -span/2 + (k + 0.5) * span/N
 *
 * Band centers rather than multiples of a pitch from the middle. Both are mirror-symmetric, but centers give exactly N
 * for every N (an even N straddles the axis, an odd N puts a line on it) where stepping from the center always gives an
 * odd count and overshoots the request by one.
 *
 * N = 0 RETURNS AN EMPTY PATH, and that is contract, not an edge case. It used to clamp to a minimum of 1, so asking
 * for no lines drew one straight through the center of the tube. That was invisible in this instrument only because the
 * DC gates the axis before calling -- a guard in a different file, which a second caller would not inherit. A primitive
 * that promises "N in is N out" has to keep the promise at 0 too.
 *
 * Sampled more coarsely than the grid (24 points against 48): a scanline spans one row of a smooth field, so its
 * curvature per line is slight, and there are hundreds of them — the path string is the cost here.
 */
export function curvedScanPath(w, H, count, faceF, samples, axis) {
  const map = radialMap(w, H, faceF);
  const S = Math.max(2, samples || (faceF ? 24 : 2));
  const N = Math.max(0, Math.round(count));
  const hw = w / 2, hh = H / 2;
  const fmt = (q) => fixed(q[0], 1e3) + ',' + fixed(q[1], 1e3);
  // 'v' walks COLUMNS instead of rows — the aperture grille is this same construction rotated a quarter turn.
  const vertical = axis === 'v';
  const span = vertical ? w : H;         // the axis the lines are spaced ALONG
  const p = span / N;
  let d = '';
  for (let n = 0; n < N; n++) {
    const c = -span / 2 + (n + 0.5) * p;
    d += 'M';
    for (let j = 0; j < S; j++) {
      const t = j / (S - 1);
      d += (j ? 'L' : '') + fmt(vertical ? map(c, -hh + t * H) : map(-hw + t * w, c));
    }
  }
  return d;
}

/* An ellipse, walked through the same map. The room's reflection on the glass is an ellipse of light, and on a domed
 * face it is not an ellipse any more -- it stretches where the surface turns away. A CSS radial-gradient cannot do that
 * at any cost, which is why the sheen was the last flat thing on the glass.
 *
 * Center and radii in picture-local px from the box center; output in the shared 0-100 viewBox.
 *
 * `n` is a SUPERELLIPSE exponent, default 2 -- which is exactly an ellipse, so every existing caller is unchanged.
 * Above 2 the shape squares off (4 is a soft-cornered rectangle, 8 nearly a rectangle with filleted corners), below 2 it
 * pinches toward a diamond. A rectangular lamp throws a rectangular pool of light, and an ellipse was the wrong
 * primitive for it -- the same category of error as a flat oval on a domed face, one level up.
 */
export function curvedEllipsePath(w, H, cx, cy, rx, ry, faceF, samples, n) {
  const map = radialMap(w, H, faceF);
  const S = Math.max(8, samples || (faceF ? 48 : 24));
  const p = (n == null ? 2 : n);
  // 2/p is the exponent on |cos| / |sin|. At p = 2 it is 1 and the two calls collapse to plain cos / sin, so the
  // superellipse branch costs nothing in the common case beyond a compare.
  const e = 2 / p;
  const sup = (t) => (t < 0 ? -1 : 1) * Math.pow(Math.abs(t), e);
  let d = 'M';
  for (let i = 0; i < S; i++) {
    const a = (i / S) * Math.PI * 2;
    const q = p === 2
      ? map(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
      : map(cx + sup(Math.cos(a)) * rx, cy + sup(Math.sin(a)) * ry);
    d += (i ? 'L' : '') + fixed(q[0], 1e3) + ',' + fixed(q[1], 1e3);
  }
  return d + 'Z';
}

/* ONE line at an arbitrary position, which is what a moving beam is.
 *
 * curvedScanPath above plots N lines on a fixed lattice -- right for a raster, useless for a sweep, whose whole job is
 * to be somewhere between the lattice positions. Same construction, same map, one line, position given as 0..1 across
 * the axis it travels along. A sweep bar on a domed face has to bow exactly as the scanline it is passing over does,
 * and a CSS gradient in a div cannot: that was the last straight thing left in the picture.
 */
export function curvedSweepPath(w, H, pos, faceF, samples, axis) {
  const map = radialMap(w, H, faceF);
  const S = Math.max(2, samples || (faceF ? 28 : 2));
  const hw = w / 2, hh = H / 2;
  const vertical = axis === 'v';
  const t0 = Math.max(0, Math.min(1, pos == null ? 0.5 : pos));
  const c = vertical ? (-hw + t0 * w) : (-hh + t0 * H);
  let d = 'M';
  for (let j = 0; j < S; j++) {
    const t = j / (S - 1);
    const q = vertical ? map(c, -hh + t * H) : map(-hw + t * w, c);
    d += (j ? 'L' : '') + fixed(q[0], 1e3) + ',' + fixed(q[1], 1e3);
  }
  return d;
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
