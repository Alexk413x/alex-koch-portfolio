/* crt-geometry.js — the guide outline, its radius lookup, and the ring ladder.
 * Pure math: no DOM, no component state. The DC measures the glass and hands the numbers in.
 * A projection term belongs in crt-projection.js; an outline term belongs in guideOutline() — one surface,
 * described once.
 */

const QUAD = Math.PI / 2;

// Rounds v to 1/m via multiply-round-divide, not toFixed: toFixed(3) prints 50 as "50.000", padding every path
// string with zeros no parser needs, where V8 prints the same double in its shortest round-tripping form.
export function fixed(v, m) { return Math.round(v * m) / m; }

/* The guide outline: one superellipse |x/hw|^n + |y/hh|^n = 1 — one exponent shapes both corner and edge, so
   there
 * is no tangent to match between a fillet and a bow. sq maps through the diagonal reach 2^(-1/n) so its slider
 * runs
 * linearly from square to circle (linear-in-n spends most of its travel on shapes that all look square).
 * Returns { pts, w, H, hw, hh, rQ, rhoQ, rhoMin }: the closed outline in centered px, its box, the radius
 * function,
 * and rhoQ(ang) = rQ(ang)/boxRadius(ang) — 1 on both axes, dipping to rhoMin at the diagonal — computed here
 * rather
 * than by a caller so there is only one outline to compute it from.
 */
export function guideOutline(w, H, sq, bend) {
  const hw = w / 2, hh = H / 2;
  const sqe = Math.min(100, Math.max(0, sq || 0));
  const rTgt = 1 - (1 - Math.SQRT1_2) * (sqe / 100);
  // n=0 is an exact rectangle, not a very high exponent: no finite n gives a 90deg vertex (n=200 still measures
  // 0.9965 of the box corner, a visibly nipped one).
  const isSq = sqe <= 0;
  const nExp = isSq ? 0 : -1 / (Math.log(rTgt) / Math.LN2);
  // Ceiling is 100: past roughly 50 the outline stops being a barrelled rectangle and becomes a rounded diamond
  // with its points at the edge midpoints — not a CRT, but a legitimate shape. Not mirrored in crt-projection:
  // faceShaped's bow clamp is the picture's warp, a different quantity from the glass's outline.
  const bendE = Math.max(0, Math.min(100, bend || 0)) / 100;
  const NS = 900, sA = new Float64Array(NS + 1), sR = new Float64Array(NS + 1), sRho = new Float64Array(NS + 1), sW = new Float64Array(NS + 1);
  let rhoMin = 1;
  // The corner vertex sits at the box's diagonal angle, not generally one of the uniform samples — interpolating
  // across it measured a "square" at 0.9991 of its corner, a real ~1px chamfer. Nudge the nearest sample onto it.
  const angC = Math.atan2(hh, hw), iC = Math.round(angC / (QUAD / NS));
  for (let i = 0; i <= NS; i++) {
    const ang = i === iC ? angC : QUAD * i / NS;
    const ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
    // Factored through the larger term: den = M*(1 + (m/M)^n)^(1/n). Powering the raw ratios underflows to zero at
    // large n — (1/780)^200 is 1e-578 — which returned an infinite radius; this form is exact for any exponent.
    const A = ca / hw, B = sa / hh, M = Math.max(A, B), m = Math.min(A, B);
    const den = isSq ? M : (M <= 0 ? 1e-12 : M * Math.pow(1 + Math.pow(m / M, nExp), 1 / nExp));
    const r0 = 1 / Math.max(1e-12, den);
    // min(sx, sy) is 0 on either axis and peaks at the diagonal; scaling by its diagonal value gives a clean 0-to-1
    // run position from midpoint to corner.
    const sx = r0 * ca / hw, sy = r0 * sa / hh;
    const tDiag = isSq ? 1 : Math.pow(2, -1 / nExp);
    const q = Math.min(1, Math.min(sx, sy) / Math.max(1e-9, tDiag));
    // wAx's double root at q=1 (the diagonal) is load-bearing: q kinks there where the nearer edge switches, and
    // only a term vanishing to second order hides it. Do not invert wAx to bow the runs inward — that exposes the kink.
    const q2 = 1 - q * q, wAx = q2 * q2;
    let rSE = r0;
    // Normalized by (1 + bendE) so the bow cannot push the midpoint past hw: dividing the profile by its own peak
    // lands the bowed midpoint on the glass edge with nothing clipped, instead of a capped flat spot with a kink.
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
  // One closed loop: the first quadrant mirrored into the other three, so the four corners share the same numbers
  // by construction. y is down, as everywhere else here.
  const pts = [];
  const emit = (i, sx, sy) => pts.push([sx * sR[i] * Math.cos(sA[i]), sy * sR[i] * Math.sin(sA[i])]);
  for (let i = NS; i >= 0; i--) emit(i, 1, -1);
  for (let i = 0; i <= NS; i++) emit(i, 1, 1);
  for (let i = NS; i >= 0; i--) emit(i, -1, 1);
  for (let i = 0; i <= NS; i++) emit(i, -1, -1);
  return { pts: pts, w: w, H: H, hw: hw, hh: hh, rQ: (ang) => ip(sR, ang), rhoQ: (ang) => ip(sRho, ang), wQ: (ang) => ip(sW, ang), rhoMin: rhoMin };
}

/* Folds a signed ray angle into the first quadrant, since the outline is symmetric in both axes and every lookup
 * below is a first-quadrant lookup. Arithmetic, not atan2(|sin t|, |cos t|): this sits two deep in faceShaped's
 * innermost loop, which asks for both the shape ratio and the axis weight at every plotted point.
 */
export function foldQuad(theta) {
  const a = Math.abs(theta) % Math.PI;
  return a > QUAD ? Math.PI - a : a;
}

// The shape ratio along any ray, folded the same way: 1 on the axes, rhoMin at the diagonal. crt-projection
// normalizes its sag radius against this so the contours follow the outline's shape, not the raster's box.
export function shapeRatio(prof, theta) {
  if (!prof || !prof.rhoQ) return 1;
  return prof.rhoQ(foldQuad(theta));
}

/* The axis weight along any ray — wAx = (1 - q^2)^2, the same factor bend bows the straight runs by — 1 on the
 * axes, 0 at the diagonal. It is the exact complement of shapeRatio, from the same outline pass, so rho (how much
 * a ray is a corner) and wAx (how much it's a flat run) cannot disagree about which is which.
 */
export function axisWeight(prof, theta) {
  if (!prof || !prof.wQ) return 0;
  return prof.wQ(foldQuad(theta));
}

/* The ring ladder: the picture's own iso-contours, one ring per grid cell, riding the same projection the picture
 * does — so ring i and grid line i coincide on every ray, and a corner that lags or races shows the two
 * disagreeing.
 * Ring 0 is the picture's edge (F(1) < 1, the rim is unpinned), not the glass edge.
 * Every ring is a scaled rectangle, not shaped like the squircle: squircle-shaped rings measured 26.7 source px
 * per
 * output px on the diagonal against the ~1 the filter can carry, so the corners are cut by the clip instead — the
 * heat layer takes the same clip the picture does.
 * fF is the projection (u, theta) -> F, or null for a flat face. stepK is the pitch: one grid cell on the
 * half-extent.
 * Returns an array of { d } ring paths, newest outward-in, with a .bands array of { d, heat, ri } annuli.
 */
export function ringLadder(prof, n, stepK, fF, rays) {
  const pts = prof.pts, hwG = prof.hw, hhG = prof.hh, out = [];
  const nR = Math.max(0, n || 0);
  // One scale per ray, not per ring: crt-projection scales the sag amplitude by the face's own shape ratio, so a
  // corner and an edge midpoint land at different depths, and each ring is walked point by point through fF(u, theta).
  // KG forces each ring to stay at least this far inside the one outside it on every ray (via prevK below), so the
  // overlay never draws two rings through each other — at the cost of a ring stopping short of where fF wanted it.
  const KG = stepK * 0.15;
  // Full-density sampling is gated on angular proximity to the diagonal (a two-degree window), not on corner-ness:
  // corner-ness scored 85% of the outline, putting 2480 points and 33KB in every ring path (672KB per render) for a
  // spike that only happens within a degree or two of the diagonal.
  const aDiagPt = Math.atan2(hhG, hwG), DIAG_W = 2 * Math.PI / 180;
  const nearDiag = new Uint8Array(pts.length);
  for (let j = 0; j < pts.length; j++) {
    const p0 = pts[j], ax = Math.abs(p0[0]), ay = Math.abs(p0[1]);
    if (ax > 1e-9 || ay > 1e-9) nearDiag[j] = Math.abs(Math.atan2(ay, ax) - aDiagPt) < DIAG_W ? 1 : 0;
  }
  // ~180 points per ring at the default; the outline is ~3600 points, and twenty rings at a fine fixed stride is a
  // quarter-megabyte of path string per render. `rays` is a fidelity dial the DC halves while a geometry control is
  // dragging and restores on settle (the tier lives in the caller's memo key); the diagonal window above keeps every
  // point there regardless of stride.
  const st = Math.max(1, Math.round(pts.length / Math.max(24, rays || 260)));
  // Which indices are visited, and each one's rectangle point and angle, are properties of the outline alone —
  // computing them inside the ring loop cost 15.6ms per rebuild (twenty hypots/atan2s/cos/sin per point) on the
  // drag path of every shape control. Hoisted here, the loop below is one fF call and one string per point.
  const vj = [];
  for (let j = 0; j < pts.length; j += (nearDiag[j] ? 1 : st)) vj.push(j);
  const V = vj.length;
  const vx = new Float64Array(V), vy = new Float64Array(V), vth = new Float64Array(V), vrho = new Float64Array(V);
  for (let m = 0; m < V; m++) {
    const q0 = pts[vj[m]], r = Math.hypot(q0[0], q0[1]);
    if (r > 1e-6) {
      const cs = Math.abs(q0[0]) / r, sn = Math.abs(q0[1]) / r, ang = Math.atan2(sn, cs);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const rb = Math.min(ca > 1e-9 ? hwG / ca : Infinity, sa > 1e-9 ? hhG / sa : Infinity);
      vx[m] = q0[0] / r * rb; vy[m] = q0[1] / r * rb; vth[m] = Math.atan2(q0[1], q0[0]);
      // A ring point past this box fraction is outside the glass and clipped, so the heat measurement must skip it.
      vrho[m] = prof.rhoQ ? prof.rhoQ(ang) : 1;
    } else { vx[m] = q0[0]; vy[m] = q0[1]; vth[m] = 0; vrho[m] = 1; }
  }
  const kUsed = [];                           // the ON-AXIS scale each drawn ring landed at, center ring included
  const sx = 100 / prof.w, sy = 100 / prof.H;
  // One color per band, tried and rejected against per-sector color: cutting each band into ~46 sectors with their
  // own local gap was the truer map but read worse — the live heat range (0.06-0.19 of a 0.5 full scale) quantized
  // the corner/flat difference into two neighboring blues, turning clean bands into a mottled ring. A band instead
  // keeps the worst visible ray, the useful number for "does a line survive here anywhere."
  const gapMin = [];                          // per band: the SMALLEST gap to the next ring over every VISIBLE sampled ray
  let prevK = new Float64Array(V).fill(Infinity), cur = new Float64Array(V), lastK = null, lastMin = Infinity;
  for (let i = 0; i < nR; i++) {
    const k = 1 - stepK * i;
    if (k <= 0.02) break;                     // the last nominal ring is k = 0 — appended as the center below
    let d = '';
    let gMin = Infinity, cMin = Infinity, gMinAll = Infinity, cMinAll = Infinity;
    for (let m = 0; m < V; m++) {
      let kv = k;
      // The nominal step (ring i at 1 - stepK*i) is what gets projected, not an already-projected radius — doing
      // the latter doubled the sag, putting rings 7.4px outside the grid line they name.
      if (fF) {
        kv = fF(k, vth[m]);
        if (kv > prevK[m] - KG) kv = prevK[m] - KG;
        if (!(kv > 0)) kv = 0;
      }
      cur[m] = kv;
      // Only visible rays feed the measurement: a rounded outline's corners run the ring past the glass clip, and
      // that thrown-away region is exactly where scaling is most extreme, so reading it dominated the minimum with
      // picture that was never seen. Whole-ring values are the fallback when a band has no visible ray at all.
      const seen = kv <= vrho[m] + 1e-6;
      if (lastK) {
        const gp = lastK[m] - kv;
        if (gp < gMinAll) gMinAll = gp;
        if (seen && gp < gMin) gMin = gp;
      }
      if (kv < cMinAll) cMinAll = kv;
      if (seen && kv < cMin) cMin = kv;
      // Concatenated, not pushed and joined: an array of ~500 strings per ring is 10k allocations V8 avoids here.
      d += (m ? 'L' : 'M') + fixed(50 + vx[m] * sx * kv, 1e3) + ',' + fixed(50 + vy[m] * sy * kv, 1e3);
    }
    out.push({ d: d + 'Z' });
    kUsed.push(fF ? fF(k, 0) : k);
    if (i > 0) gapMin.push(isFinite(gMin) ? gMin : (isFinite(gMinAll) ? gMinAll : stepK));
    lastMin = isFinite(cMin) ? cMin : cMinAll;
    // "previous" (the monotone guard) and "last" (the gap) are the same array — allocating separate ones per ring
    // was 20 x 3604 doubles per rebuild.
    lastK = cur; prevK = cur; cur = new Float64Array(V);
  }
  // The center is a ring too, appended as a degenerate point: without it the innermost band had nothing to pair
  // with and the disc at the grid's middle carried no heat despite visibly warping. As the inner subpath of the
  // last band, a zero-area point fills the whole center, and its heat is the same compression measure every other
  // band uses — genuinely small near the middle, not a filler value.
  if (out.length && (kUsed[kUsed.length - 1] > 1e-6)) {
    out.push({ d: 'M50,50Z' });
    kUsed.push(0);
    gapMin.push(isFinite(lastMin) ? lastMin : stepK);
  }
  // Heat bands instead of outlines: a stroke shows where a depth landed, not how hard the picture is squeezed to
  // get there. Each band's heat is the local compression, projected gap over nominal gap (1.0 = unchanged). ri
  // equals the array index today but is carried since the caller gates on it, for if bands are ever split again.
  const bands = [];
  for (let i = 0; i + 1 < out.length; i++) {
    const gap = gapMin[i] == null ? (kUsed[i] - kUsed[i + 1]) : gapMin[i];
    const comp = Math.max(0, Math.min(1, gap / Math.max(1e-9, stepK)));
    bands.push({ d: out[i].d + ' ' + out[i + 1].d, ri: i, heat: Math.max(0, Math.min(1, 1 - comp)) });
  }
  // Bands stop at ring 0, the picture's edge; the sliver out to the glass outline is left clear, deliberately —
  // there is no picture there to report compression for.
  out.bands = bands;
  return out;
}
