/* crt-projection.js — the face projection: the fold test, the amplitude ceiling it sets, and the projection itself.
 *
 * Pure math: no DOM, no component state. Callers plot through faceF; nothing here rasterises anything.
 *
 * Settled decisions — please don't relitigate:
 *  - SAG IS ONE AMPLITUDE IN NORMALISED RADIUS, not sag(lat) per ray. Per-ray sag gave the corner 1.8x the sides' sag,
 *    so it folded first and ate the whole budget. This was the root of every fold complaint. faceShaped is NOT a
 *    relitigation of this: the amplitude is still one number: what it changes is what the radius is measured AGAINST.
 *  - THE RIM IS UNPINNED: F(1) < 1, so the picture's edge pulls inside the glass by the sag. Pinning it to the glass can
 *    only be done by magnifying the whole interior -- that was the "middle is being stretched" bug. The gap is real.
 *  - THE CORNERS ARE CUT, NOT WARPED. Making the raster follow the squircle means transporting pixels laterally into the
 *    rounded corner: measured 26.7 source px per output px on the diagonal against ~1 the filter can carry. If the
 *    picture must end on the squircle, that is the CLIP, not the field.
 */

const QUAD = Math.PI / 2;

/* The fold test. The profile is sag ~ uB^p -- an aspheric faceplate, which is how one is actually specified -- and for any
 * p >= 1 its derivative is monotone, so the induced ring SPACING cannot reverse by construction. That property has to come
 * from the shape, not from a test rejecting bad shapes: an earlier smoothstep taper had a mid-band derivative peak, the
 * test correctly refused it, and the bisection then drove the cap to 0.2 degrees at every position.
 *
 * THE EXPONENT IS AN INPUT because FALLOFF sets it, and it must be the SAME number the projection uses: the test is what
 * bounds the amplitude, so testing uB^2 while drawing uB^4 would certify a depth the drawn profile cannot carry.
 *
 * So what is left to test is local MINIFICATION: each step must keep at least half its source span, i.e. 2x local
 * compression, sampled at output-pixel granularity.
 *
 * So what is left to test is local MINIFICATION: each step must keep at least half its source span, i.e. 2x local
 * compression, sampled at output-pixel granularity.
 *
 * BE HONEST ABOUT WHAT THIS IS NOW. That 2x came from feDisplacementMap -- it was the point at which a one-pixel line
 * stopped surviving resampling. There is no resampler any more; the lens is deleted and every curved layer is plotted.
 * So this no longer bounds anything physical. What it still does is set the AMPLITUDE SCALE: faceAmax bisects against
 * this threshold and faceF multiplies by the result, so this constant is what decides how deep FACE 90 actually bends.
 *
 * It is kept because it produces a curve range that looks right and every stored setting is calibrated against it --
 * not because 2x still means anything. If the depth range ever needs to change, change it HERE and knowingly, rather
 * than reading this as a renderability limit it no longer is.
 */
export function fieldFolds(A, fadeSpan, sign, NS, pow) {
  const N = NS || 512, thr = (1 / N) * 0.5;
  const u0 = Math.max(0, 1 - fadeSpan);
  const p = pow == null ? 2 : pow;
  let prev = -1;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const uB = u <= u0 ? 0 : (u - u0) / Math.max(1e-9, 1 - u0);
    const den = 1 + sign * A * (p === 2 ? uB * uB : Math.pow(uB, p));
    if (den <= 1e-6) return true;                       // eye inside the surface: no projection exists
    const F = u / den;
    if (!isFinite(F)) return true;
    if (i > 0 && F - prev < thr) return true;
    prev = F;
  }
  return false;
}

const amaxCache = { key: null, val: 0 };

/* Largest dimensionless sag amplitude whose field the filter can still resample, for the CURRENT band.
 *
 * THIS IS WHY CURVE AREA IS A SOFTNESS CONTROL: the same depth spread over a wider band is a gentler gradient, so a wide
 * band admits a much larger amplitude and a narrow one admits very little.
 *
 * The ceiling belongs to the AMPLITUDE, not to the angle. Clamping the ANGLE was the only way to bound the field while
 * the sag was per-ray -- the corner folded 1.8x sooner than the sides, so the whole slider was cut down to whatever the
 * corner could survive, and the readout quietly showed a number nobody had asked for. With the profile normalised,
 * -90..90 is always available and always renderable.
 */
export function faceAmax(fadeSpan, sign, pow) {
  const ck = fadeSpan.toFixed(5) + '|' + sign + '|' + (pow == null ? 2 : pow);
  if (amaxCache.key === ck) return amaxCache.val;
  let lo = 0, hi = 4;
  for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; if (fieldFolds(m, fadeSpan, sign, 512, pow)) hi = m; else lo = m; }
  amaxCache.key = ck; amaxCache.val = lo;
  return lo;
}

/* The projection as a plain function of normalised radius: u is the fraction of the way out to the rim ON THAT RAY, F(u)
 * is where the eye sees it. The picture, the grid and the ring ladder all go through this one function, which is what
 * makes the outermost grid line and the edge of the picture the same number by construction.
 *
 *     F(u) = u / (1 + sign * A * shape(u))
 *     A = faceAmax * (1 - cos th)                 dimensionless; (1 - cos th) is 0 at flat, 1 at a hemisphere, so FACE
 *                                                 keeps its angle semantics while the ceiling is carried by A_MAX
 *     shape(u) = uB^p,  uB = (u - u0)/(1 - u0),  u0 = 1 - fadeSpan,  p = FALLOFF
 *
 * p IS HOW QUICKLY THE BEND ARRIVES, and it is a different question from where it lives. CURVE AREA sets the BAND (u0);
 * within that band p decides the ramp: at 1 the surface starts bending the instant it enters the band and the depth accrues
 * evenly, at 2 (the shipped shape) it eases in, and by 4-5 almost nothing happens until the last few percent and then it
 * turns hard. Same total depth at the rim either way -- A is pinned there -- so this only moves WHEN the picture gives it up.
 * Both ends are renderable because faceAmax bisects against the same exponent.
 *
 * BELOW 1 IS NOT OFFERED. uB^p with p < 1 has infinite slope where the band opens, which is a visible crease ring at the
 * band boundary rather than a softer curve -- the opposite of what a lower number reads as.
 *
 * ZERO INSIDE THE INNERMOST GUIDE, not merely small: u^p tapers but never reaches 0, so the picture kept a residual bend
 * all the way to the centre. The band remap makes the interior EXACTLY flat -- the warp lives where the rings are and
 * nowhere else -- and the rim is pinned to nothing.
 *
 * PAST u = 1 IT CONTINUES AT THE RIM'S SLOPE, because uB clamps at 1: F stays monotone and finite for any u, which is what
 * lets faceShaped ask for F(u/rho) with u/rho above 1 (a raster corner outside the glass) without folding.
 *
 * faceProfile returns the profile itself -- { A, sg, u0, at(u) } -- for callers that want the amplitude; faceF is the
 * function, and returns null when there is nothing to warp.
 */
export function faceProfile(deg, fadeSpan, pow, amp) {
  const th = Math.abs(deg) * Math.PI / 180;
  if (th < 0.004) return null;
  const sg = deg < 0 ? -1 : 1;
  const p = Math.max(1, pow == null ? 2 : pow);
  /* THE CONCAVE SIDE NEEDS ITS OWN CEILING. faceAmax bounds the amplitude by a fold test that only ever considered the
   * CONVEX branch, where the denominator 1 + A*uB^2 grows and F stays finite however large A gets. Flip the sign and the
   * same A drives 1 - A*uB^2 toward zero: at IN 90 the denominator crossed it and the plotted paths ran to +-5e7 user
   * units -- a 70KB path per layer, rebuilt every render, describing a shape a hundred million units across. It was
   * invisible while --picfrac existed only because picfrac clamped ITS use of F(1) to [0.05, 1]; the paths themselves
   * were never clamped, and they are all that is left now.
   *
   * A_IN_MAX caps the rim magnification at 1/(1 - 0.375) = 1.6x, which is a deep concave face and a finite one. The
   * denominator floor underneath it is belt and braces: no input can make this divide by something near zero.
   */
  /* DEPTH: AN EXPLICIT MULTIPLIER ON TOP OF THE FOLD-BOUNDED AMPLITUDE.
   *
   * faceAmax bisects against fieldFolds, and that test's 2x threshold is what decides how deep FACE 90 actually
   * bends. fieldFolds' own note is candid that the threshold no longer bounds anything physical -- it came from
   * feDisplacementMap, and the lens is deleted -- so it is now a calibration constant, not a limit. Raising the
   * constant itself would silently move every stored setting; multiplying AFTER it says "I know this is past the
   * renderability test, do it anyway" at one call site instead.
   *
   * DEFAULTS TO 1 AND IS OPTIONAL, so every existing caller -- the whole DOM lab -- is bit-identical.
   *
   * The concave side keeps a hard ceiling whatever amp asks for. F = u/(1 - A*uB^p): as A approaches 1 the
   * denominator approaches zero and the plotted paths run away, which this file has already been bitten by (paths
   * at +-5e7 user units at IN 90). 0.49 keeps the denominator at or above 0.51, comfortably clear of the 0.5
   * floor in at(), so the floor never engages and the shape stays smooth rather than flattening into the clamp. */
  const A_IN_MAX = 0.375;
  const k = amp == null ? 1 : Math.max(0, amp);
  let A = faceAmax(fadeSpan, sg, p) * (1 - Math.cos(th)) * k;
  if (sg < 0) A = Math.min(A, Math.max(A_IN_MAX, Math.min(0.49, A_IN_MAX * k)));
  const u0 = Math.max(0, 1 - fadeSpan);
  return {
    A: A, sg: sg, u0: u0, p: p,
    at: (u) => {
      if (u <= 0) return u;
      const uc = Math.min(1, u);
      const uB = uc <= u0 ? 0 : (uc - u0) / Math.max(1e-9, 1 - u0);
      return u / Math.max(0.5, 1 + sg * A * (p === 2 ? uB * uB : Math.pow(uB, p)));
    },
  };
}

export function faceF(deg, fadeSpan, pow, amp) {
  const p = faceProfile(deg, fadeSpan, pow, amp);
  return p ? p.at : null;
}

/* THE SAME PROJECTION, NORMALISED AGAINST THE GLASS INSTEAD OF THE BOX. Returns (u, theta) -> F, in box fractions.
 *
 * THIS IS THE FIX FOR THE PYRAMID. The radial map measures a point as u = r / boxRadius(theta), so the sag's level sets --
 * the contours of equal depth -- are RECTANGLES. A dome whose iso-contours are rectangles is not a dome, it is a tent: it
 * has creases running out to the four corners, and that crease is the pyramid look. Nothing about the sag profile causes
 * it and no amount of tuning FACE removes it; it is the normaliser.
 *
 * So the normaliser becomes the GLASS. rho(theta) is the outline's shape ratio -- the aperture's radius over the box's
 * radius on that ray -- and
 *
 *     G(u, theta) = rho * F(u / rho)
 *
 * is the same profile measured out to the glass rather than out to the box, re-expressed in box fractions so every caller
 * is unchanged. Level sets of G are the OUTLINE's shape, scaled: squircles when SQUIRCLE is up, bowed on the axes when
 * BEND is up. The crease is gone because there is no longer a corner in the field to crease along.
 *
 * Three properties worth holding onto:
 *
 *   - THE AXES ARE UNTOUCHED. rho is exactly 1 on both, so G = F there and every stored setting still measures the same.
 *     (BEND's own bow, below, is the one thing that does move them -- by a few percent, on purpose.)
 *   - THE APERTURE IS A FIXED SET. At u = rho -- a point sitting on the glass rim on that ray -- G = rho * F(1) = rho, so
 *     the rim maps to itself on every ray, not just the axes.
 *   - THE CORNERS SLIP OUT, on purpose. Past the rim F continues at the rim's own slope (faceF clamps its shape term at
 *     uB = 1), so the raster's corner lands near the box corner, outside the glass, and is cut by the face clip. Forcing
 *     it onto the outline instead would mean transporting pixels laterally into the rounded corner -- the 26.7-source-px
 *     per-output-px transport this file already refuses. Letting it overshoot and be cut is the honest version.
 */
export function faceShaped(deg, fadeSpan, shape, pow, amp) {
  const f = faceF(deg, fadeSpan, pow, amp);
  if (!f) return null;
  const rhoAt = shape && shape.rho, bowAt = shape && shape.bow;
  /* THE FLAT RUNS GET THEIR OWN BOW, and it needs its own term because rho cannot give them one. The outline normalises its
   * bulge by its own peak, which is what keeps the bow inside the glass -- so on the axes rho is exactly 1 at BEND 0 and at
   * BEND 15 alike, and everything BEND did to the field was tuck the DIAGONAL in harder. The corners got all of it and the
   * flats got none, which is backwards from what BEND looks like on the outline.
   *
   * So the flats are pushed out directly, weighted by wAx -- the same (1 - q^2)^2 the outline bows by, 1 on the axes and 0 at
   * the diagonal with a double root, so it is the exact complement of rho and cannot fight it. Scaled by u^2 so the middle
   * stays where it is and the push grows outward, and by BOW_K so BEND's whole range is a few percent: the flats pull
   * slightly out past the rim and get trimmed, while the corners stay the extreme end. Deliberately NOT as strong as the
   * corner term -- at BEND 15 this is 5% on the axes against rho's ~20% at the diagonal.
   */
  const BOW_K = 0.33;
  const bow = Math.max(0, Math.min(0.15, (shape && shape.bend) || 0)) * BOW_K;
  if (!rhoAt) return f;
  const g = (u, th) => {
    const t = th == null ? 0 : th;
    const rho = Math.max(0.05, Math.min(1, rhoAt(t)));
    const r = rho * f(u / rho);
    return (bow > 0 && bowAt) ? r * (1 + bow * bowAt(t) * u * u) : r;
  };
  /* THE PIN IS THE UN-BOWED AXIS VALUE, published so the caller cannot pin on the bowed one. Dividing by g(1, 0) would
   * normalise the bow away exactly where it is strongest -- the axes -- and leave it showing up as everything ELSE
   * shrinking, which is the opposite of the intended effect and would look like a bug in rho.
   */
  g.pin = f(1);
  return g;
}

/* The displacement field used to live here -- ~4.4KB that built, for every output pixel, how far along its own ray
 * it should fetch from, so an feDisplacementMap could resample the tube through it.
 *
 * REMOVED WITH THE LENS. Nothing resamples any more: every curved layer is plotted through faceF above and is generated
 * bent. The field also had a real unsolved defect at deletion time -- it saturated, clamping the rim to one constant
 * pull instead of varying by ray -- but that is not why it went. It went because a resampled curve was the wrong
 * mechanism for an instrument whose content is all generated geometry.
 *
 * fieldFolds and faceAmax above are NOT lens code, despite the filter language in their comments: faceF uses faceAmax
 * as its amplitude scale, so they set how deep FACE goes for every plotted layer. See the note on fieldFolds.
 */
