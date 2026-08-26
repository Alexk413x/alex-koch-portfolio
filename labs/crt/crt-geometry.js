/* crt-geometry.js — the guide outline, its radius lookup, and the ring ladder.
 *
 * Pure math: no DOM, no component state. The DC measures the glass and hands the numbers in.
 *
 * THE ONE IDEA: there is one surface, described once. Every serious bug in this instrument has been two descriptions of
 * the same geometry drifting apart. If you add a term to the projection it belongs in crt-projection.js and nowhere
 * else; if you add a term to the outline it belongs in guideOutline() and nowhere else.
 */

const QUAD = Math.PI / 2;

/* ROUND A COORDINATE TO A FIXED NUMBER OF DECIMALS — and let the number print itself.
 *
 * Every path here is built by concatenating coordinates, and toFixed is the slowest way to do it AND the most
 * verbose: toFixed(3) formats 50 as "50.000", so much of a large path string is trailing zeros no parser needs.
 * Math.round(v * m) / m lands on the same double, and V8 prints a double as the SHORTEST decimal that round-trips
 * to it, so the digits that survive are exactly the ones carrying information.
 *
 * The callers keep whatever decimal count they had, so this is a change of formatter and not of fidelity. m is the
 * multiplier, passed as a literal so nobody pays for a Math.pow per coordinate.
 */
export function fixed(v, m) { return Math.round(v * m) / m; }

/* The guide outline: ONE superellipse, |x/hw|^n + |y/hh|^n = 1. One exponent describes the corner AND the edge,
 * because they are the same curve read at different angles — so there is no tangent to match and no
 * fillet-versus-bow competition to referee.
 *
 * sq = SQUIRCLE, MAPPED IN THE THING YOU SEE. A superellipse's diagonal reach is exactly 2^(-1/n) of the box corner,
 * so inverting that puts the slider on a straight line from square to circle. Linear-in-n spends most of its travel
 * on shapes that all look square, and is not even monotonic.
 *
 * bend = BEND. It bulges the STRAIGHT RUNS outward and leaves the corners rounded. wAx = (1 - q²)², where q is the
 * position ALONG the run, so it peaks on the axes and vanishes at the diagonal with a DOUBLE root. The double root
 * is load-bearing: q comes from min(sx, sy), which kinks where the nearer edge switches, and only a term vanishing
 * to second order there hides that kink. BEND MUST NOT BE INVERTED to bow the runs inward — that exposes it.
 *
 * Returns { pts, w, H, hw, hh, rQ, rhoQ, rhoMin }: the closed outline in centerd px, the box it was measured in, the
 * radius function, and THE SHAPE RATIO.
 *
 * rhoQ(ang) = rQ(ang) / boxRadius(ang): how far inside the raster's own box the glass sits on that ray. It is 1 on
 * both axes for every setting and dips to rhoMin at the box's diagonal, which makes it the one number that says
 * "this ray is a corner" without anybody having to define corner-ness. Returned from HERE rather than derived by a
 * caller, because a second computation of it is a second outline.
 */
export function guideOutline(w, H, sq, bend) {
  const hw = w / 2, hh = H / 2;
  const sqe = Math.min(100, Math.max(0, sq || 0));
  const rTgt = 1 - (1 - Math.SQRT1_2) * (sqe / 100);
  // A TRUE RECTANGLE AT 0, not a very high exponent: no finite n gives a 90deg vertex (n = 200 still measures 0.9965 of
  // the box corner, a visibly nipped one), so the square is the plain box formula, evaluated exactly.
  const isSq = sqe <= 0;
  const nExp = isSq ? 0 : -1 / (Math.log(rTgt) / Math.LN2);
  /* THE CEILING IS 100, AND WHAT IT BUYS IS A DIFFERENT SHAPE RATHER THAN MORE OF THIS ONE. The term holds the edge
   * midpoints and pulls the CORNERS in, and past roughly 50 the outline stops being a barrelled rectangle and
   * becomes a rounded diamond with its points at the edge midpoints — not a CRT, but a legitimate thing to draw.
   *
   * BACKWARDS COMPATIBLE: the parameter is unchanged in meaning, so every stored setting still measures the same.
   *
   * NOT MIRRORED IN crt-projection. faceShaped's bow clamps separately and deliberately — that is the WARP's bow, a
   * different quantity from the OUTLINE's, and raising one is not a reason to raise the other. Past the projection's
   * cap the two diverge on purpose: the glass takes a shape the picture does not follow. */
  const bendE = Math.max(0, Math.min(100, bend || 0)) / 100;
  const NS = 900, sA = new Float64Array(NS + 1), sR = new Float64Array(NS + 1), sRho = new Float64Array(NS + 1), sW = new Float64Array(NS + 1);
  let rhoMin = 1;
  // The corner vertex sits at the box's own diagonal angle, which is not generally one of the uniform samples -- so
  // interpolation cut across it and a "square" measured 0.9991 of its corner, a real ~1px chamfer. Nudging the nearest
  // sample onto that angle puts the vertex exactly on a sample point, where every shape here has its sharpest feature.
  const angC = Math.atan2(hh, hw), iC = Math.round(angC / (QUAD / NS));
  for (let i = 0; i <= NS; i++) {
    const ang = i === iC ? angC : QUAD * i / NS;
    const ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
    // Factored through the LARGER term: den = M*(1 + (m/M)^n)^(1/n). Powering the raw ratios underflowed to zero at
    // large n -- (1/780)^200 is 1e-578 -- so SQUARE returned an infinite radius. This form is exact for any exponent.
    const A = ca / hw, B = sa / hh, M = Math.max(A, B), m = Math.min(A, B);
    const den = isSq ? M : (M <= 0 ? 1e-12 : M * Math.pow(1 + Math.pow(m / M, nExp), 1 / nExp));
    const r0 = 1 / Math.max(1e-12, den);
    // The superellipse's own normalized coordinates give the honest position along the run: min(sx, sy) is 0 on either
    // axis and peaks at the diagonal, so scaling it by its diagonal value is a clean 0-to-1 run midpoint-to-corner.
    const sx = r0 * ca / hw, sy = r0 * sa / hh;
    const tDiag = isSq ? 1 : Math.pow(2, -1 / nExp);
    const q = Math.min(1, Math.min(sx, sy) / Math.max(1e-9, tDiag));
    const q2 = 1 - q * q, wAx = q2 * q2;
    let rSE = r0;
    // NORMALIZED BY (1 + bendE) so the bow cannot leave the glass. Added raw, the midpoint pushed past hw and needed a
    // cap to catch it -- and a cap is a flat spot with a kink at each end. Dividing the whole profile by its own peak
    // lands the bowed midpoint exactly on the glass edge and takes the corner in behind it: same shape, nothing clipped.
    rSE *= (1 + bendE * wAx) / (1 + bendE);
    const rBox = Math.min(hw / Math.max(1e-9, ca), hh / Math.max(1e-9, sa));
    if (rSE > rBox) rSE = rBox;
    sA[i] = ang; sR[i] = rSE;
    sRho[i] = rSE / Math.max(1e-9, rBox);
    sW[i] = wAx;
    if (sRho[i] < rhoMin) rhoMin = sRho[i];
  }
  const ip = (tab, ang) => {
    if (ang <= 0) return tab[0];
    if (ang >= QUAD) return tab[NS];
    const u = ang / (QUAD / NS), lo = Math.min(NS - 1, Math.floor(u));
    return tab[lo] + (tab[lo + 1] - tab[lo]) * (u - lo);
  };
  // One closed loop: the first quadrant mirrored into the other three, so the four corners are the same numbers by
  // construction and cannot disagree. y DOWN, as everywhere else here.
  const pts = [];
  const emit = (i, sx, sy) => pts.push([sx * sR[i] * Math.cos(sA[i]), sy * sR[i] * Math.sin(sA[i])]);
  for (let i = NS; i >= 0; i--) emit(i, 1, -1);
  for (let i = 0; i <= NS; i++) emit(i, 1, 1);
  for (let i = NS; i >= 0; i--) emit(i, -1, 1);
  for (let i = 0; i <= NS; i++) emit(i, -1, -1);
  return { pts: pts, w: w, H: H, hw: hw, hh: hh, rQ: (ang) => ip(sR, ang), rhoQ: (ang) => ip(sRho, ang), wQ: (ang) => ip(sW, ang), rhoMin: rhoMin };
}

/* FOLD A RAY INTO THE FIRST QUADRANT: the angle in [0, pi/2] with the same |sin| and |cos|. The outline is symmetric
 * in both axes by construction, so every lookup below is a first-quadrant lookup and every caller arrives with a
 * signed angle.
 *
 * ARITHMETIC, NOT TRIGONOMETRY, and this is a measured hot path. atan2(|sin t|, |cos t|) is three transcendental
 * calls to answer a question about the QUADRANT, and it sits two deep in the innermost loop of the whole instrument:
 * faceShaped asks for the shape ratio AND the axis weight at every plotted point, so each point pays for six.
 *
 * The two agree to within a rounding error many orders below one step of the table it indexes.
 */
export function foldQuad(theta) {
  const a = Math.abs(theta) % Math.PI;
  return a > QUAD ? Math.PI - a : a;
}

// The shape ratio along any ray, folded the same way. 1 on the axes, rhoMin at the diagonal. This is what the projection
// normalizes its radius against, so the sag's contours are the OUTLINE's shape instead of the raster's box.
export function shapeRatio(prof, theta) {
  if (!prof || !prof.rhoQ) return 1;
  return prof.rhoQ(foldQuad(theta));
}

/* THE AXIS WEIGHT along any ray: wAx = (1 - q^2)^2, the same factor BEND bows the outline's straight runs by -- 1 on the
 * axes, 0 at the diagonal, with a DOUBLE root there.
 *
 * It is the exact complement of the shape ratio, and both come from one pass over one outline rather than one of them being
 * reconstructed by a caller: rho says how much a ray belongs to a CORNER, wAx says how much it belongs to a FLAT RUN, so
 * they cannot disagree about which is which. The projection uses rho to normalize the radius and wAx to bow the flats.
 */
export function axisWeight(prof, theta) {
  if (!prof || !prof.wQ) return 0;
  return prof.wQ(foldQuad(theta));
}

/* The ring ladder: the picture's own iso-contours, one ring per grid cell, riding the same projection the picture does
 * -- so ring i and grid line i coincide on every ray, and a corner that lags or races shows up as the two disagreeing.
 *
 * Ring 0 is the PICTURE's edge (F(1) < 1 -- the rim is unpinned), not the glass edge. The dashed outline is the glass.
 *
 * EVERY RING IS A SCALED RECTANGLE, because that is what the picture is -- and it must stay one however round the glass
 * gets. Rings shaped like the squircle disagreed with the square lattice they measure in all four corners; easing them from
 * square to squircle fixed the shapes but required the map to carry the same transport -- measured 26.7 source px per output
 * px on the diagonal against the ~1 the filter can carry. So the corners are CUT by the clip, not warped, and the rings
 * describe the raster. The gap between a square band and a round rim is not an error in the map: it is the part of the
 * picture that gets thrown away, which is why the heat layer takes the same clip the picture does.
 *
 * fF is the projection (u, theta) -> F, or null for a flat face. stepK is the pitch: one grid cell on the half-extent.
 * Returns an array of { d } ring paths, newest outward-in, with a .bands array of { d, heat, ri } annuli.
 */
export function ringLadder(prof, n, stepK, fF, rays) {
  const pts = prof.pts, hwG = prof.hw, hhG = prof.hh, out = [];
  const nR = Math.max(0, n || 0);
  /* ONE SCALE PER RAY, and it has to be. The projection carries a THETA term now -- crt-projection scales the sag
   * amplitude by the face's own shape ratio, so a corner and an edge midpoint no longer land at the same depth -- and the
   * per-ring scalar this used to build is exactly the collapse the old note warned about: one column of a table that has
   * stopped being constant. Each ring is walked point by point through fF(u, theta).
   *
   * FORCED MONOTONE, PER POINT: never let a ring pass the one outside it ON ITS OWN RAY. KG is the minimum scale
   * separation kept between neighbors; prevK holds the outer ring's value at each sampled index, so the guard is a
   * per-ray promise rather than an average one. What it costs is a ring stopping short of where the projection wanted it;
   * what it buys is that the overlay never draws two rings through each other, which is the one thing it exists to
   * disprove.
   */
  const KG = stepK * 0.15;
  // Full-density sampling is gated on ANGULAR PROXIMITY TO THE DIAGONAL -- a two-degree window -- not on corner-ness.
  // Corner-ness was the obvious flag and the wrong one: it scored 85% of the outline, which put 2480 points and 33KB in
  // every ring path (672KB per render) for a spike that happens within a degree or two of the diagonal.
  const aDiagPt = Math.atan2(hhG, hwG), DIAG_W = 2 * Math.PI / 180;
  const nearDiag = new Uint8Array(pts.length);
  for (let j = 0; j < pts.length; j++) {
    const p0 = pts[j], ax = Math.abs(p0[0]), ay = Math.abs(p0[1]);
    if (ax > 1e-9 || ay > 1e-9) nearDiag[j] = Math.abs(Math.atan2(ay, ax) - aDiagPt) < DIAG_W ? 1 : 0;
  }
  /* ~180 points per ring at the default. The outline is ~3600 points and twenty rings at a fine fixed stride is a
   * quarter-megabyte of path string per render.
   *
   * `rays` IS A FIDELITY DIAL, and it exists so a value in MOTION can be cheap. This is the most expensive thing in a
   * rebuild -- twenty rings times this many sampled rays, each one an fF call and two coordinates -- and it is rebuilt
   * on every frame of a SQUIRCLE, BEND or FACE drag, which is exactly when nobody can read a band edge. The DC halves
   * it while a geometry control is moving and restores it on settle; the tier is in the caller's memo key, so a coarse
   * ladder can never be mistaken for the settled one. Corners are unaffected either way -- the diagonal window below
   * keeps every point it has regardless of the stride.
   */
  const st = Math.max(1, Math.round(pts.length / Math.max(24, rays || 260)));
  /* THE SAMPLE SET, AND EVERY RAY-DEPENDENT QUANTITY ON IT, BUILT ONCE. Which indices are visited, where each one's
   * rectangle point is, and what angle it sits at are all properties of the OUTLINE -- none of them changes from ring to
   * ring -- and computing them inside the ring loop cost twenty hypots, atan2s, a cos and a sin per point (15.6ms per
   * rebuild, on the drag path of every shape control). Hoisted, the loop below is one fF call and one string per point.
   */
  const vj = [];
  for (let j = 0; j < pts.length; j += (nearDiag[j] ? 1 : st)) vj.push(j);
  const V = vj.length;
  const vx = new Float64Array(V), vy = new Float64Array(V), vth = new Float64Array(V), vrho = new Float64Array(V);
  for (let m = 0; m < V; m++) {
    const q0 = pts[vj[m]], r = Math.hypot(q0[0], q0[1]);
    if (r > 1e-6) {
      // The rectangle radius on this ray: the ring is the raster's own box, scaled.
      const cs = Math.abs(q0[0]) / r, sn = Math.abs(q0[1]) / r, ang = Math.atan2(sn, cs);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const rb = Math.min(ca > 1e-9 ? hwG / ca : Infinity, sa > 1e-9 ? hhG / sa : Infinity);
      vx[m] = q0[0] / r * rb; vy[m] = q0[1] / r * rb; vth[m] = Math.atan2(q0[1], q0[0]);
      // The aperture on this ray, as a box fraction: a ring point past it is outside the glass and is cut, so the heat
      // measurement must not read it.
      vrho[m] = prof.rhoQ ? prof.rhoQ(ang) : 1;
    } else { vx[m] = q0[0]; vy[m] = q0[1]; vth[m] = 0; vrho[m] = 1; }
  }
  const kUsed = [];                           // the ON-AXIS scale each drawn ring landed at, center ring included
  const sx = 100 / prof.w, sy = 100 / prof.H;
  /* ONE COLOR PER BAND, and this is a LEGIBILITY decision made against a more accurate alternative -- worth knowing before
   * anyone reaches for the accurate one again.
   *
   * With a theta term in the projection a band's compression genuinely varies along it: the corner of a rounded face is the
   * steepest part and squeezes hardest, the flats barely squeeze. So each band was cut into ~46 sectors, each carrying its
   * own local gap, bucketed into eight levels. It was strictly the truer map and it read worse: the whole range in play is
   * heat 0.06..0.19 against a ramp whose full scale is 0.5 (the fold limit), so the corner/flat difference quantized into two
   * neighboring blues and the clean concentric bands turned into a faintly mottled ring for no gain in what you could see.
   *
   * So the band keeps one value and that value is the WORST VISIBLE RAY -- a minimum, not a sample. A single number has to
   * pick one story and "the hardest this band is squeezed anywhere you can see it" is the useful one for deciding whether a
   * line survives. What it does not tell you is WHERE on the band that happened; the outline and the grid do.
   */
  const gapMin = [];                          // per band: the SMALLEST gap to the next ring over every VISIBLE sampled ray
  let prevK = new Float64Array(V).fill(Infinity), cur = new Float64Array(V), lastK = null, lastMin = Infinity;
  for (let i = 0; i < nR; i++) {
    const k = 1 - stepK * i;
    if (k <= 0.02) break;                     // the last nominal ring is k = 0 — appended as the center below
    let d = '';
    let gMin = Infinity, cMin = Infinity, gMinAll = Infinity, cMinAll = Infinity;
    for (let m = 0; m < V; m++) {
      let kv = k;
      // THE NOMINAL STEP is what gets projected -- ring i sits at 1 - stepK*i, and fF already carries the band fade.
      // Projecting an already-projected radius put the rings at twice the sag, 7.4px outside the grid line they name.
      if (fF) {
        kv = fF(k, vth[m]);
        if (kv > prevK[m] - KG) kv = prevK[m] - KG;
        if (!(kv > 0)) kv = 0;
      }
      cur[m] = kv;
      /* THE MEASUREMENT ONLY READS RAYS THAT ARE VISIBLE. The rings are scaled copies of the raster's box, so their corner
       * regions run PAST the glass on a rounded outline -- that part of every band is cut by the face clip and never seen.
       * Reading it made the worst-case gap a report about thrown-away picture, and since the corner is exactly where the
       * scaling is most extreme it dominated the minimum: the map turned hot while everything you can actually look at was
       * carrying the picture fine. Whole-ring values are kept as the fallback for a band with no visible ray at all.
       */
      const seen = kv <= vrho[m] + 1e-6;
      if (lastK) {
        const gp = lastK[m] - kv;
        if (gp < gMinAll) gMinAll = gp;
        if (seen && gp < gMin) gMin = gp;
      }
      if (kv < cMinAll) cMinAll = kv;
      if (seen && kv < cMin) cMin = kv;
      // Concatenated, not pushed and joined: an array of ~500 short strings per ring, twenty times per rebuild, is
      // 10k allocations to build one string V8 will happily grow in place.
      d += (m ? 'L' : 'M') + fixed(50 + vx[m] * sx * kv, 1e3) + ',' + fixed(50 + vy[m] * sy * kv, 1e3);
    }
    out.push({ d: d + 'Z' });
    kUsed.push(fF ? fF(k, 0) : k);
    if (i > 0) gapMin.push(isFinite(gMin) ? gMin : (isFinite(gMinAll) ? gMinAll : stepK));
    lastMin = isFinite(cMin) ? cMin : cMinAll;
    // Two buffers, swapped: the monotone guard reads the ring outside this one and the gap reads it too, so "previous"
    // and "last" are the same array -- and allocating a fresh one per ring was 20 x 3604 doubles per rebuild.
    lastK = cur; prevK = cur; cur = new Float64Array(V);
  }
  /* THE CENTER IS A RING TOO, even though it is a point.
   *
   * A band is the annulus between two consecutive rings, so the innermost drawn ring had nothing to pair with and the disc
   * inside it — the four cells at the middle of the grid — carried no heat at all, while visibly being warped. The loop
   * above stops before k = 0 because a zero-scale ring is a degenerate point, which is true and was taken as a reason to
   * omit it rather than to append it. As the INNER subpath of the last band, a degenerate point is exactly right: the
   * evenodd hole it cuts has zero area, so the band fills the whole center.
   *
   * Its heat is real, not a filler value: the gap from the innermost ring to the center against the nominal step is the
   * same compression measure every other band uses, and near the middle it is genuinely small — which is the honest
   * answer, rather than a hole that reads as "not measured".
   */
  if (out.length && (kUsed[kUsed.length - 1] > 1e-6)) {
    out.push({ d: 'M50,50Z' });
    kUsed.push(0);
    gapMin.push(isFinite(lastMin) ? lastMin : stepK);
  }
  /* HEAT BANDS instead of outlines. A stroke tells you where a depth landed; it does not tell you how hard the picture is
   * being squeezed to get there, which is the thing being tuned. Each band is the annulus between two consecutive rings
   * (two subpaths, evenodd, so the inner one cuts the hole), and its heat is the local compression: the projected gap over
   * the nominal gap. 1.0 means the band carries the picture unchanged; that ratio is exactly what decides whether a
   * one-pixel line survives the resample.
   *
   * ri is the band's own ring index. It is redundant while a band is one entry -- it equals the array index -- and it is
   * carried anyway because the caller gates the map on it, so the gate keeps working if the bands are ever split again.
   */
  const bands = [];
  for (let i = 0; i + 1 < out.length; i++) {
    const gap = gapMin[i] == null ? (kUsed[i] - kUsed[i + 1]) : gapMin[i];
    const comp = Math.max(0, Math.min(1, gap / Math.max(1e-9, stepK)));
    bands.push({ d: out[i].d + ' ' + out[i + 1].d, ri: i, heat: Math.max(0, Math.min(1, 1 - comp)) });
  }
  // The bands stop at ring 0 -- the picture's edge. The sliver out to the glass outline is deliberately left clear:
  // there is no picture there to report compression for.
  out.bands = bands;
  return out;
}
