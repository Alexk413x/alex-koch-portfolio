/* The face projection: the fold test, the amplitude ceiling it sets, and the projection itself.
 * Pure math — no DOM, no component state; callers plot every curved layer through faceF, generated
 * bent, so nothing here resamples despite the filter language in the comments below.
 *
 * Sag is one amplitude in normalized radius, not sag(lat) per ray — per-ray sag gives the corner
 * nearly twice the sides' sag, so it folds first and eats the whole budget. The rim is unpinned
 * (F(1) < 1) and the corners are cut, not warped by design — see CLAUDE.md for both.
 */

const QUAD = Math.PI / 2;

// True if the profile's induced ring spacing folds or drops below output-pixel resolution.
// pow must be the same exponent the projection actually uses, or this certifies a depth it can't carry.
export function fieldFolds(A, fadeSpan, sign, NS, pow) {
  const N = NS || 512, thr = (1 / N) * 0.5; // 0.5 no longer bounds a resampler (that build is gone); it's a calibration constant faceAmax's bisection depends on.
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

// Largest dimensionless sag amplitude the current band (fadeSpan) can carry before fieldFolds trips.
// A wider band admits more amplitude than a narrow one, which is why CURVE AREA reads as a softness control.
export function faceAmax(fadeSpan, sign, pow) {
  const ck = fadeSpan.toFixed(5) + '|' + sign + '|' + (pow == null ? 2 : pow);
  if (amaxCache.key === ck) return amaxCache.val;
  let lo = 0, hi = 4;
  for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; if (fieldFolds(m, fadeSpan, sign, 512, pow)) hi = m; else lo = m; }
  amaxCache.key = ck; amaxCache.val = lo;
  return lo;
}

// The projection as a function of normalized radius, F(u) = u / (1 + sign*A*shape(u)). The picture, grid
// and ring ladder all go through this one function, so the outermost grid line and the picture's edge agree
// by construction. Past u = 1, F continues at the rim's own slope, staying finite and monotone.
export function faceProfile(deg, fadeSpan, pow, amp) {
  const th = Math.abs(deg) * Math.PI / 180;
  if (th < 0.004) return null;
  const sg = deg < 0 ? -1 : 1;
  const p = Math.max(1, pow == null ? 2 : pow); // p < 1 gives infinite slope at the band edge -- a visible crease ring, not a softer curve.
  // Concave (sg < 0) has no ceiling from the fold test above, which only ever checks the convex branch;
  // A_IN_MAX caps the rim magnification before the denominator collapses toward zero.
  const A_IN_MAX = 0.375;
  const k = amp == null ? 1 : Math.max(0, amp); // amp scales past the fold-bounded amplitude deliberately -- callers can ask for more than fieldFolds would certify.
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

// Returns the projection as a plain function of u, or null when the angle is too small to warp anything.
export function faceF(deg, fadeSpan, pow, amp) {
  const p = faceProfile(deg, fadeSpan, pow, amp);
  return p ? p.at : null;
}

// Same projection normalized against the glass outline instead of the box: G(u,th) = rho(th) * F(u/rho(th)),
// re-expressed in box fractions. Fixes the "pyramid" -- measuring u against the box radius makes the sag's
// level sets rectangles, not a dome -- and holds the axes untouched (rho = 1) with u = rho mapping to itself.
export function faceShaped(deg, fadeSpan, shape, pow, amp) {
  const f = faceF(deg, fadeSpan, pow, amp);
  if (!f) return null;
  const rhoAt = shape && shape.rho, bowAt = shape && shape.bow;
  // The flats get their own bow term because rho can't give them one -- rho is exactly 1 on the axes by
  // normalization. Weighted by the outline's own (1 - q^2)^2 (1 on axes, 0 at the diagonal) so it can't fight rho.
  const BOW_K = 0.33;
  const bow = Math.max(0, Math.min(0.15, (shape && shape.bend) || 0)) * BOW_K;
  if (!rhoAt) return f;
  const g = (u, th) => {
    const t = th == null ? 0 : th;
    const rho = Math.max(0.05, Math.min(1, rhoAt(t)));
    const r = rho * f(u / rho);
    return (bow > 0 && bowAt) ? r * (1 + bow * bowAt(t) * u * u) : r;
  };
  g.pin = f(1); // the un-bowed axis value -- dividing by the bowed g(1,0) would cancel the bow exactly where it's strongest.
  return g;
}
