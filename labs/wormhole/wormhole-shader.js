/* A solved surface, not a marched volume: the wall is a cylinder, a ray is a line, and where they meet has a
 * closed form -- one quadratic per shell instead of a march. Measured: the lab next door's 28-step volume march
 * costs 46 ms/MP for this same look; this costs about 6.
 *
 * No integral is being estimated, so there is no grain: a march's grain comes from where its point samples land
 * relative to a field finer than the step, and an exact answer has no samples to disagree.
 *
 * Several cylinders at several radii, composited front-to-back (host-sorted inner first, so a ray always meets
 * the small radius before the large one), give real occlusion and parallax that one surface can't. Any effect
 * (NEBULA, PLASMA, STREAKS, RINGS) can run on any shell -- there is no "the cloud shell".
 */

// Six shells, always present (a count slider made shell four unreachable without passing through three); an off
// shell costs one continue per pixel. Packed into vec4s because the kit uploads vec4 arrays, not per-field uniforms.
export const MAXL = 6;

export const UNIFORMS = [
  'uRes', 'uTime', 'uFov', 'uFar',
  'uBend', 'uBendFlow', 'uBendDir',
  'uMass', 'uEndR',
  'uDisc', 'uDiscTilt', 'uDiscLean', 'uDiscOut', 'uDiscH', 'uDiscSpin', 'uDiscFlow',
  'uDiscA', 'uDiscB', 'uDoppler',
  'uFog', 'uExposure',
  'uGeom', 'uMix', 'uShade', 'uExtra', 'uRingP',
  'uCloudA', 'uCloudB', 'uBoltA', 'uBoltB', 'uStrkA', 'uStrkB',
];

export const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime, uFov, uFar;
uniform float uBend, uBendFlow, uBendDir;
uniform float uMass, uEndR;
uniform float uDisc, uDiscTilt, uDiscLean, uDiscOut, uDiscH, uDiscSpin, uDiscFlow, uDoppler;
uniform float uFog, uExposure;
uniform vec3  uDiscA, uDiscB;

// geom: radius, amount, speed, stretch. mix: cloud, bolts, streaks, rings.
// shade: cloud fill, cloud edge, cloud detail, spin. extra: lanes, ON, bolt fill, bolt edge.
uniform vec4 uGeom[${MAXL}];
uniform vec4 uMix[${MAXL}];
uniform vec4 uShade[${MAXL}];
uniform vec4 uExtra[${MAXL}];
// Per-shell (not a shared global pair) so each shell's ring pitch and flow can differ -- that mismatch is the
// depth cue the shells exist to give.
uniform vec4 uRingP[${MAXL}];

// Two colors per effect per shell: each effect blends its own A-to-B across its own gradient (cloud by density,
// bolts by strength, streaks per lane), so effects sharing a shell don't have to share a color. A march can't do
// this safely -- integrating many samples of a fast-varying ramp averages it to grey.
uniform vec4 uCloudA[${MAXL}], uCloudB[${MAXL}];
uniform vec4 uBoltA[${MAXL}], uBoltB[${MAXL}];
uniform vec4 uStrkA[${MAXL}], uStrkB[${MAXL}];

#define TAU 6.28318530718
// The radius the arch is measured against. A bend of 1 carries the far end one of these off the axis.
#define TUBE_R 1.0
// How far the far end may swing, in tube radii, before it starts leaving its own tube.
#define MAX_SWING 6.5

// Cheap 3D hash, used as the noise lattice's per-corner value.
float h31(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Value noise sampled via cos/sin of the tunnel angle rather than the angle itself, so the field wraps with no seam.
float n3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x),
                 mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x),
                 mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}

// Fractal sum of n3 across up to 5 octaves, count set per shell/effect.
float fbm(vec3 p, int oct){
  float v = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; i++){
    if (i >= oct) break;
    v += a * n3(p);
    n += a;
    p = p * 2.03 + vec3(1.7);
    a *= 0.5;
  }
  return v / max(n, 1e-4);
}

/* The tunnel's axis is a fixed curve in world space, and BEND FLOW moves the camera along it -- an arch anchored
 * to the eye instead reads as a lens (nothing travels toward, past, or behind the viewer).
 *
 * bendAt uses sin(f*90deg), zero and flat at z=0, so the eye starts exactly on the axis with no frame to rotate
 * into and nothing that can run away with distance.
 *
 * The amplitude is normalized by k*uFar rather than taken from the sine's own height: subtracting the tangent is
 * a first-order approximation of the camera's frame, valid only while the path's slope stays small, and without
 * the /uFar term the axis drifted 13 world units off-center at BEND 2.4 / DEPTH 26 -- six times the widest shell
 * -- closing the wall across the far mouth.
 *
 * The swing is tanh-saturated rather than clamped with min(): a min() creases visibly where the curve goes flat,
 * while tanh approaches its ceiling with no such corner, reading as the far side of a disc wrapping over rather
 * than an arc that stops for no visible reason.
 *
 * gBendDir and gSwing are computed once per frame here rather than per call in bendAt/bendD, since the scan below
 * calls into them up to a hundred times per pixel and neither value varies across the frame.
 */
vec2 gBendDir;
float gSwing;
// d(gap)/dt from the last wallGap call; a global rather than an out-param since most callers never read it.
float gSlope;

// Caches this frame's bend direction and saturated swing amplitude for bendAt/bendD/wallGap.
void setupBend(){
  float a = uBendDir + uTime * uBendFlow * 0.12;
  gBendDir = vec2(cos(a), sin(a));
  gSwing = MAX_SWING * tanh(uBend / MAX_SWING) * TUBE_R;
}
// Sideways offset of the tunnel's axis at depth z.
vec2 bendAt(float z){
  float f = clamp(z / max(uFar, 1.0), 0.0, 1.0);
  return gBendDir * (gSwing * sin(f * 1.5707963));
}
// d(bendAt)/dz, the axis's slope at depth z.
vec2 bendD(float z){
  float f = clamp(z / max(uFar, 1.0), 0.0, 1.0);
  return gBendDir * (gSwing * 1.5707963 * cos(f * 1.5707963) / max(uFar, 1.0));
}

// Every other radius is a fixed multiple of Rs, not an independent control -- gravity has one number:
// horizon 1.0 Rs, photon sphere 1.5 Rs, shadow edge (B_CRIT) 2.598 Rs = 3*sqrt(3)/2 Rs, ISCO (R_ISCO) 3.0 Rs.
#define B_CRIT 2.59807621
#define R_ISCO 3.0

/* Closed-form deflection of a ray passing a mass at impact parameter b: it turns by 2Rs/b in total, and
 * integrating its turn rate once and twice (s measured from closest approach) gives how far it has turned and
 * moved sideways by s:
 *   theta(s) = (Rs/b)(1 + s/sqrt(s^2+b^2))      delta(s) = (Rs/b)(s + sqrt(s^2+b^2))
 * This is not an approximation of the march in main() -- it's the same physics solved on paper where it can be,
 * so the march hands off by reading theta/delta straight off these two lines rather than restarting from the eye.
 *
 * This has to be evaluated per-sample rather than as one screen-space pull applied to every depth: a single pull
 * would move wall two world units from the camera as far as it moves the far mouth, and wall that near the
 * camera is nowhere near the hole.
 *
 * The tunnel can't fold through itself, with no clamp needed to guarantee it: for every s <= 0 the bracket
 * (s + sqrt(s^2+b^2)) lies in (0, b], so delta lies in (0, Rs] regardless of b -- the largest sideways pull
 * anywhere in the tube is exactly one Schwarzschild radius.
 */
vec3  gHoleO;
vec3  gHdir;
float gB, gT0, gRs, gD0;

// Caches the closest-approach geometry (impact parameter, direction, offset at t=0) for a ray passing the hole.
void setupHole(vec3 rd, vec3 O, float rs){
  gHoleO = O; gRs = rs;
  gT0 = dot(O, rd);
  vec3 w = rd * gT0 - O;
  gB = max(length(w), 1e-5);
  gHdir = w / gB;
  gD0 = (rs / gB) * (-gT0 + sqrt(gT0 * gT0 + gB * gB));
}
// How far the ray has been pulled toward the hole by the time it has run t. Zero at the eye, by subtraction.
float lensShift(float t){
  float s = t - gT0;
  return (gRs / gB) * (s + sqrt(s * s + gB * gB)) - gD0;
}
// The ray's actual (bent) position at parameter t.
vec3 rayAt(vec3 rd, float t){ return rd * t - gHdir * lensShift(t); }

// Photon geodesic acceleration in Schwarzschild geometry: d2x/dlambda2 = -1.5*Rs*h^2*x/r^5, h = |x cross v|
// conserved along the ray. |v| itself isn't conserved and doesn't need to be -- only the path's shape is read.
vec3 holeAccel(vec3 x, float h2, float rs){
  float r2 = max(dot(x, x), 1e-12);
  float r5 = r2 * r2 * sqrt(r2);
  return x * (-1.5 * rs * h2 / max(r5, 1e-20));
}

/* Signed gap from the ray at t to this shell's wall (negative inside the tube, positive outside). The wall's
 * axis offset depends on z, and z depends on the hit being solved for, so this can't be solved as one quadratic
 * -- see solveShell for how the crossing is found by scanning (iterating this directly diverged, see there).
 */
float wallGap(vec3 rd, float t, float R){
  // rayAt carries the closed-form bend, so this one line is how the hole reaches the tunnel: a sample near the
  // eye sits where an unbent ray would, and one at the far mouth is pulled toward the axis by up to one Rs.
  vec3 Pw = rayAt(rd, t);

  // f, and sin/cos of it, are shared by the axis offset, its slope, and the taper below -- this runs ~17x per
  // shell per pixel, so what's computed once here is computed once everywhere, not three times.
  float f = clamp(Pw.z / max(uFar, 1.0), 0.0, 1.0);
  float a = f * 1.5707963;
  float off = gSwing * sin(a);
  float S   = gSwing * 1.5707963 * cos(a) / max(uFar, 1.0);

  // Every shell tapers onto the same uEndR (read from the host, the only place that sees all six radii at once)
  // so their mouths coincide instead of drawing separate concentric mouths at 11/19/29px. Using
  // min(uEndR, R*0.9) here instead was a bug: every shell's own radius is under the hole's size, so the min
  // always picked the shell's radius and each one tapered to a different end again. mix() being monotone in R
  // also means a wider shell's surface is never nearer the axis than a narrower one's -- solveShell relies on that.
  float Rc = mix(R, uEndR, f * f * (3.0 - 2.0 * f));

  // A view-aligned section of the tube is an ellipse, stretched by 1/cos(lean) along the lean direction only --
  // stretching a single scalar radius in every direction instead makes the tube fat wherever it turns, which
  // reads as a warp rather than a curve. gBendDir already gives the lean direction without normalizing: the
  // slope is gBendDir times a scalar, so only the dot's absolute value is ever needed and the scalar's sign can't matter.
  vec2 v = Pw.xy - gBendDir * off;
  float vl = length(v);
  float lean = vl > 1e-5 ? abs(dot(v, gBendDir)) / vl : 0.0;
  float ell = mix(1.0, sqrt(1.0 + S * S), lean);

  // The gap's rate of change (what graze is made from) is differentiated here rather than differenced later:
  // differencing it after the root refinement below is what produced visible concentric rings, since the
  // difference is float error left over from cancelling two nearly-equal numbers, with the scan's own period.
  float sarc = t - gT0;
  float th = (gRs / gB) * (1.0 + sarc * inversesqrt(sarc * sarc + gB * gB));
  vec3  dP = rd - gHdir * th;
  vec2  dv = dP.xy - gBendDir * (S * dP.z);
  vec2  dir = vl > 1e-5 ? v / vl : vec2(1.0, 0.0);
  float dRc = (uEndR - R) * (6.0 * f * (1.0 - f)) * (dP.z / max(uFar, 1.0));
  gSlope = dot(dir, dv) - dRc * ell;

  return vl - Rc * ell;
}

/* Finds where the ray crosses this shell's wall by scanning rather than solving one quadratic directly: the
 * wall's axis offset depends on z and z depends on the hit, so a direct iterative solve can diverge -- its
 * first guess (R/sqrt(A)) blows up near screen center where A -> 0, which was starting the search tens of
 * thousands of units past the tunnel's end and returning no hit at all (BEND 6, one shell lit: the frame went
 * black, downstream of every "tunnel and hole misaligned" symptom).
 *
 * A scan can't diverge: the gap changes sign exactly once between the eye and the wall, so N samples bracket
 * the crossing and one interpolation lands on it, bounded by the tube's own length. Steps are packed toward the
 * eye since perspective compresses distance, so a near step covers far more screen than a far one of equal
 * length.
 *
 * The scan starts at tStart (the previous, inner shell's hit) rather than the eye: rescanning from the eye per
 * shell measured 2.0-2.7 ms per shell of GPU time against an 11 ms frame (~60%), versus 1.3 ms for the nebula,
 * 0.8 for plasma, 0.6 for the hole. Safe because the host sorts shells inner-first and Rc is monotone in R (see
 * wallGap), so a ray can never reach an outer shell's wall before an inner one's -- the skipped stretch holds no
 * crossing to find. tStart is nudged back slightly so the first sample is strictly inside this shell even when
 * two shells share a radius and their crossings coincide.
 */
float solveShell(vec3 rd, float R, float tStart, out vec2 rel, out float zz, out float graze){
  float tMax = uFar / max(rd.z, 1e-4);
  graze = 0.0;
  float t0 = min(tStart * 0.995, tMax);
  float tA = t0;
  float dA = wallGap(rd, t0, R), hitT = -1.0;
  float span = tMax - t0;
  if (span <= 0.0){ rel = vec2(0.0); zz = uFar; return -1.0; }

  for (int i = 1; i <= 14; i++){
    float f = float(i) / 14.0;
    float tB = t0 + span * f * f;
    float dB = wallGap(rd, tB, R);
    if (dB >= 0.0 && dA < 0.0){
      // Bracket is refined by 3 Illinois false-position steps, not plain regula falsi: a single interpolation's
      // error has the scan's own period and drew dark rings around the vanishing point. Plain regula falsi keeps
      // one endpoint when the gap is convex over the bracket (it is, since the wall curves away from the ray) and
      // converges only linearly; Illinois halves the retained endpoint's value when it repeats, converging
      // superlinearly for one extra multiply and no extra gap evaluation.
      float side = 0.0;
      for (int k = 0; k < 3; k++){
        float tM = mix(tA, tB, dA / (dA - dB));
        float dM = wallGap(rd, tM, R);
        if (dM < 0.0){
          tA = tM; dA = dM;
          if (side < 0.0) dB *= 0.5;
          side = -1.0;
        } else {
          tB = tM; dB = dM;
          if (side > 0.0) dA *= 0.5;
          side = 1.0;
        }
      }
      hitT = mix(tA, tB, dA / (dA - dB));

      // Squareness of the hit: the gap opens at |rd.xy| for a ray straight through the wall and at ~0 along the
      // silhouette, so their ratio fades the shell at a grazing angle instead of ending in a hard edge.
      wallGap(rd, hitT, R);
      graze = clamp(gSlope / max(length(rd.xy), 1e-4), 0.0, 1.0);
      break;
    }
    tA = tB; dA = dB;
  }

  if (hitT < 0.0){ rel = vec2(0.0); zz = uFar; return -1.0; }
  vec3 P = rayAt(rd, hitT);
  rel = P.xy - bendAt(P.z);
  zz = P.z;
  return hitT;
}

// A streak is a lane down the tube, so its angle picks the lane and its depth picks how far the head has
// travelled -- one floor() and a hash, where the marched build needs capsules and a per-shell candidate search.
// Takes its own count/speed/color so streaks inherit their own shell's depth, like every other effect.
float streakAt(float ang, float z, float count, float speed, out float lr){
  // Lane count is rounded to a whole number and wrapped with mod(): atan's (-PI,PI] branch cut jumps by exactly
  // count, and a bare floor() there hashes the two sides differently, drawing a seam down the tube. A
  // fractional count can't tile the circle either, so it can't be trusted straight from the panel.
  float lanes = max(floor(count + 0.5), 4.0);
  float slot = (ang + TAU) / TAU * lanes;
  float lane = mod(floor(slot), lanes);
  lr = h31(vec3(lane, 3.7, 1.9));
  float head = fract(lr * 7.3 - uTime * speed * (0.06 + lr * 0.11));
  float along = fract(z * 0.045 - head);
  float across = fract(slot) - 0.5;
  return step(0.55, lr) * exp(-along * 16.0) * exp(-across * across * 70.0);
}

void main(){
  setupBend();
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  // uFov is the ray's z, so small is wide -- the host sends it as an angle in degrees, the unit a person means.
  vec3 rd = normalize(vec3(uv, uFov));
  // The hole is an object at DEPTH, following the bend like anything else there, not a sprite sized in screen
  // units. Each sample's ray is bent by rayAt at its own depth, rather than uv being pre-warped toward the hole.
  vec3 holeO = vec3(bendAt(uFar), uFar);

  // 1 solar mass = 0.2 world units of Schwarzschild radius, a scene-scale choice (not physics) made here only:
  // the panel reads MASS in solar masses, and 0.5 already filled a third of the frame at MASS 1.
  float rs = uMass * 0.2;
  setupHole(rd, holeO, rs);

  vec3 col = vec3(0.0);
  float trans = 1.0;
  // Where the last shell's wall was met. The next one cannot be nearer -- see solveShell.
  float tPrev = 0.0;

  for (int s = 0; s < ${MAXL}; s++){
    if (uExtra[s].y < 0.5) continue;

    vec4 g = uGeom[s], m = uMix[s], sh = uShade[s];
    vec2 rel; float z, graze;
    float t = solveShell(rd, max(g.x, 0.02), tPrev, rel, z, graze);
    // Advance on ANY hit, including one past DEPTH: the next shell's is further still either way.
    if (t > 0.0) tPrev = t;
    // Fades with distance rather than a hard cutoff, but keeps a floor at DEPTH rather than reaching 0: hitting
    // 0 would black out the last stretch of tube (the only part where the arch has actually swung), pulling the
    // apparent vanishing point back to frame center while the hole draws at the true far end.
  float depth = mix(1.0, 0.16 + 0.84 * (1.0 - smoothstep(2.0, uFar, t)), uFog);
    // Rejects hits past uFar: without this a near-axis ray struck the wall extrapolated beyond the tube's real
    // end (where the taper is already clamped), and the throat read as that extrapolated fill running out
    // rather than as the tube's actual end -- which is what welds the tube's end to the hole at DEPTH.
    if (t <= 0.0 || z > uFar || depth <= 0.002) continue;
    float ang = atan(rel.y, rel.x) + sh.w * uTime;

    // The tunnel's own coordinates: angle round the tube, distance along it (scaled by WIND via g.w).
    vec3 tc = vec3(cos(ang), sin(ang), 0.0) * 1.9
            + vec3(0.0, 0.0, z * g.w + uTime * g.z * g.w);

    float d = 0.0;
    vec3 emit = vec3(0.0);

    // NEBULA — the wall's own texture. FILL slides the threshold, EDGE decides how hard it arrives.
    if (m.x > 0.001){
      float v = fbm(tc, int(sh.z));
      float c = smoothstep(sh.x, sh.x + max(sh.y, 0.02), v);
      d += m.x * c;
      emit += mix(uCloudA[s].rgb, uCloudB[s].rgb, c) * m.x * c;
    }

    // PLASMA — the filament is where two independent noise fields BOTH cross zero (a line), not one field's
    // mid-level (a surface, which reads as froth). FILL/EDGE threshold and soften the distance-to-crossing the
    // same way NEBULA thresholds fbm.
    if (m.y > 0.001){
      vec3 q = tc * 1.6 + vec3(19.3, 7.1, 3.7);
      // RIPPLE drifts one field against the other rather than warping the result, so the crossing line itself
      // snakes/pinches/reconnects as it moves -- a warped, sliding pattern can't do that. SPEED (via tc) moves
      // it along the tube; that's a different motion, so at RIPPLE 0 it's rigid however fast it flows.
      float f1 = n3(q) - 0.5;
      float f2 = n3(q * 1.31 + vec3(5.2, 1.7, 9.1) + vec3(0.0, 0.0, uTime * uRingP[s].z)) - 0.5;
      float r = sqrt(f1 * f1 + f2 * f2) * 1.414;
      float v = 1.0 - min(r, 1.0);
      float bf = uExtra[s].z;
      float bo = smoothstep(bf, bf + max(uExtra[s].w, 0.01), v);
      d += m.y * bo;
      emit += mix(uBoltA[s].rgb, uBoltB[s].rgb, bo) * m.y * bo;
    }

    // STREAKS — lanes down the tube, at this shell's own radius, speed and color, so they inherit its depth.
    if (m.z > 0.001){
      float lr;
      float st = streakAt(ang, z, max(uExtra[s].x, 4.0), g.z, lr) * 2.0;
      d += m.z * st;
      emit += mix(uStrkA[s].rgb, uStrkB[s].rgb, lr) * m.z * st;
    }

    // RINGS — bands across the tube. Read from the shell's own hit depth, so they foreshorten for free.
    if (m.w > 0.001){
      float r0 = 0.5 + 0.5 * cos((z + uTime * uRingP[s].y) * uRingP[s].x);
      r0 *= r0; r0 *= r0;
      float k = 1.0 + m.w * 2.2 * r0;
      d *= k; emit *= k;
    }

    d *= g.y; emit *= g.y;

    // Fade out at the silhouette, so a cone has a soft rim instead of a drawn circle.
    depth *= smoothstep(0.0, 0.55, graze);
    float a = clamp(d * depth, 0.0, 1.0);

    col += trans * emit * depth * 1.15;
    trans *= 1.0 - a * 0.85;
  }

  /* Every feature of a real black hole falls out of this one bent-ray march, not from being drawn separately:
   * the shadow's edge lands at 2.598 Rs (B_CRIT) on its own -- that number appears nowhere in the loop below;
   * the photon ring is rays that wind near 1.5 Rs before escaping; the disc's second image (arcing over the
   * shadow's top and under its bottom at once) is simply the same curved ray crossing the disc twice; the
   * mouth's Einstein ring reuses the same closed form as the tunnel wall. A screen-space pinch can't diverge or
   * wind, so none of this falls out of it -- each feature would need its own hand-added fix, which is also why
   * there's no second LENS control here: gravity takes one number.
   *
   * The march only runs where the impact parameter is inside rInt, handing off from the closed form above
   * rather than starting at the eye, so at the shipped MASS it's a few percent of the frame; MASS up makes the
   * hole most of the picture, and paying for most of the picture is fair.
   */
  vec3 discLit = vec3(0.0);
  if (uMass > 1e-4 && uDisc > 0.001){
    // The inner edge is the ISCO, not an independent control: nothing orbits inside it, so a disc always
    // starts there (an independent number could disagree and either leave a gap or draw over the shadow).
    float discIn  = rs * R_ISCO;
    // An outright radius, so it stays put as MASS moves; guarded only against ending up inside discIn.
    float discOut = max(uDiscOut, discIn * 1.05);
    // Integrated as a volume along the same march, so a deeper slab really does hold more gas. Measured in
    // Schwarzschild radii (a length), not as a percentage of discIn -- the panel never names what a percentage
    // would be of, while Rs is the one length every other radius here is already quoted against.
    float hMax = max(uDiscH, 0.01) * rs;

    // A plane's orientation is fully specified by TILT and LEAN (its normal); the third rotation a solid body
    // would have does nothing to a plane and is DISC SPIN's job instead. TILT 0 looks straight down on the disc.
    float ct = cos(uDiscTilt), st = sin(uDiscTilt);
    float cl = cos(uDiscLean), sl = sin(uDiscLean);
    vec3 nrm = normalize(vec3(st * sl, st * cl, ct));
    // cross() with a reference parallel to nrm returns zero, and normalize(0) is a NaN that would blacken every
    // disc pixel at face-on TILT -- so the reference switches away from z there.
    vec3 ref = abs(nrm.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 u1 = normalize(cross(nrm, ref));
    vec3 u2 = cross(nrm, u1);

    // Where the closed form stops being enough: outside the disc's reach AND well outside the winding zone.
    float rInt  = max(discOut, rs * B_CRIT * 4.0) * 1.15;
    // And where there is nothing left ahead worth stepping through, which is nearer than where it started.
    float rExit = max(discOut, rs * B_CRIT * 2.5);

    if (gB < rInt){
      // Hands off from the closed form at rInt rather than integrating the empty tunnel: position is delta(s)
      // and direction is theta(s), read straight off the same two lines the tunnel uses, so there's no seam.
      float tS = max(gT0 - rInt, 0.0);
      float sS = tS - gT0;
      vec3 x = rayAt(rd, tS) - gHoleO;
      vec3 v = normalize(rd - gHdir * ((rs / gB) * (1.0 + sS / sqrt(sS * sS + gB * gB))));
      vec3 Lv = cross(x, v);
      float h2 = dot(Lv, Lv);
      vec3 acc = holeAccel(x, h2, rs);
      float turn = uTime * uDiscSpin;

      // Angle traveled round the hole so far; h is conserved and dphi = h*dlambda/r^2.
      float phi = 0.0;
      float hMom = sqrt(h2);

      /* Velocity-Verlet, not Euler: symplectic, so a ray winding near the photon sphere holds its orbit instead
       * of spiraling out as the step count runs down -- the difference between a photon ring and a smear.
       *
       * The step size follows r alone (0.17*(r-0.45*rs)): coarse where the path is nearly straight, fine where
       * it's turning hardest, with a floor near the 1.02 Rs exit that keeps it from collapsing to zero.
       *
       * It must NOT be capped by the disc slab's thickness (hMax*0.75) -- that was a bug: hMax scales with MASS
       * but the crossing distance doesn't, so steps-to-cross-disc scaled as 1/MASS and blew the 144-step budget
       * at MASS 1 (165 needed) and MASS 0.2 (825 needed), silently dropping the shadow and disc below that MASS.
       * The overlap length computed below is exact for a straight segment at any step length, so no cap is
       * needed.
       */
      for (int i = 0; i < 144; i++){
        float r = length(x);
        if (r < rs * 1.02) break;                  // fell in; whatever was gathered so far still counts
        // Escaping and past the disc's reach (rExit, nearer than the march's own start at rInt) -- nothing
        // left worth integrating.
        if (dot(x, v) > 0.0 && r > rExit) break;
        float dt = clamp(0.17 * (r - 0.45 * rs), 1e-5, 0.25 * rInt);

        vec3 x0 = x;
        v += acc * (0.5 * dt);
        x += v * dt;
        acc = holeAccel(x, h2, rs);
        v += acc * (0.5 * dt);
        phi += hMom * dt / max(dot(x, x), 1e-9);
        if (phi > 8.0) break;    // a turn and a quarter; past it nothing found survives the damping below.

        float d0 = dot(x0, nrm), d1 = dot(x, nrm);
        if (d0 * d1 > 0.0 && min(abs(d0), abs(d1)) > hMax) continue;

        // The disc is a slab and the step a segment, so what a step collects is their overlap's length --
        // unlike a 2h/|cos| path length, which diverges edge-on and needs a saturation cap that draws its own
        // straight edge through the disc. A segment simply has a finite length either way.
        //
        // Measured at the crossing (not the segment's midpoint): steps can run most of a world unit long in the
        // outer disc, where a midpoint would sit too far from the plane crossing to catch real hits at the
        // annulus edges. d is linear along the segment, so the crossing is one divide.
        float dv = d1 - d0;
        float uc = abs(dv) > 1e-7 ? clamp(-d0 / dv, 0.0, 1.0) : 0.5;
        float rm = length(mix(x0, x, uc));
        if (rm < discIn * 0.9 || rm > discOut * 1.1) continue;
        // The disc bulges thickest at the inner edge and thins outward, like a real disc's puffy, pressure-held
        // inner region settling flat further out.
        float hh = hMax * mix(1.0, 0.12, smoothstep(discIn, discOut, rm));

        float uA = 0.0, uB = 0.0;
        if (abs(dv) > 1e-7){
          float p = (-hh - d0) / dv, q = (hh - d0) / dv;
          uA = clamp(min(p, q), 0.0, 1.0);
          uB = clamp(max(p, q), 0.0, 1.0);
        } else if (abs(d0) < hh){ uB = 1.0; }
        float frac = uB - uA;
        if (frac <= 0.0) continue;

        /* Damped by the winding angle phi, not by counting disc crossings: crossing count is an integer function
         * of impact parameter, and stepping it draws a dotted circle at the shadow's edge -- exactly the grain a
         * march produces, and capping the count only moves which jump draws it. phi is continuous and rises
         * smoothly, so damping by it fades unresolved images (each squeezed to ~e^-2pi of the one before, so the
         * third already lands sub-pixel) out smoothly instead. The quartic-inside-exponential curve stays near 1
         * through the second image (~pi) and drops to ~0 by a full turn (~2pi), keeping the second while losing
         * the third.
         */
        float q = phi * 0.238;   // a half turn is a little under 1, a full turn a little under 1.5
        q *= q;
        float passAtt = exp(-q * q);

        vec3 hp = mix(x0, x, 0.5 * (uA + uB));
        float rr = length(hp);
        if (rr <= discIn || rr >= discOut) continue;

        // Novikov-Thorne disc flux ~ r^-3 * (1 - sqrt(discIn/r)): zero at the inner edge (infalling matter
        // doesn't radiate, which is the real dark gap between shadow and first light), peaking about a third of
        // the way out. 17.7 = 1/peak, normalizing the profile to 1.
        float ix  = discIn / rr;
        float ix3 = ix * ix * ix;
        float band = (rr - discIn) / max(discOut - discIn, 1e-3);
        float emis = (ix3 - ix3 * sqrt(ix)) * 17.7 * smoothstep(1.0, 0.88, band);

        // Keplerian, not rigid: angular rate ~ r^-3/2, so the inner edge laps the outer one many times over.
        float kep = pow(max(ix, 0.03), 1.5);

        // Differential (non-rigid) twist is tanh-saturated at 8 rad (about 1.25 turns edge-to-edge) rather than
        // left to grow with time: unsaturated, the winding spiral's constant-phase curves drift outward
        // regardless of SPIN's sign, so the disc always read as flowing outward and DISC FLOW had no visible
        // effect. Rigid rotation (the un-saturated part) has no such artifact and is untouched.
        float twist = turn * 0.5;
        float shear = 8.0 * tanh((kep - 1.0) * twist / 8.0);
        float pa  = atan(dot(hp, u2), dot(hp, u1)) + twist + shear;

        // Radial drift is its own control, not derived from SPIN: reading it as turn*0.12 borrowed spin's sign
        // too, so reversing SPIN made the disc appear to accrete outward, which real accretion never does.
        // Negative FLOW pulls material inward (matches (C + uTime*FLOW*0.12)/1.6 for a fixed noise coord C, so
        // the panel value rises exactly when the radius does); the shipped disc runs FLOW at -2.
        emis *= 0.55 + 0.9 * fbm(vec3(cos(pa), sin(pa), 0.0) * 3.0
                               + vec3(0.0, 0.0, rr * 1.6 - uTime * uDiscFlow * 0.12), 3);

        /* g = orbital Doppler factor * gravitational factor sqrt(1-Rs/r); received brightness is emitted*g^3,
         * and the same g also sets the color shift, so there's no separate REDSHIFT control. beta is the
         * orbit's own speed (sqrt(Rs/2r), not a slider) so beaming and pattern rotation can't disagree about how
         * fast the gas moves -- a disc with SPIN at 0 still lighting one limb would mean they'd come from
         * different places.
         */
        vec3  vel  = normalize(cross(nrm, hp)) * clamp(uDiscSpin / 0.4, -1.0, 1.0);
        float beta = clamp(sqrt(rs / max(2.0 * rr, 1e-4)), 0.0, 0.85);
        float gam  = inversesqrt(max(1.0 - beta * beta, 1e-4));
        float gdop = 1.0 / max(gam * (1.0 - beta * dot(vel, -normalize(v))), 1e-3);
        float ggrv = sqrt(max(1.0 - rs / rr, 0.0));
        float g    = gdop * ggrv;
        float boost = pow(max(gdop, 1e-3), 3.0 * uDoppler) * ggrv * ggrv * ggrv;

        vec3 tint = mix(uDiscA, uDiscB, clamp(band + (1.0 - clamp(g, 0.0, 1.0)) * 0.7, 0.0, 1.0));
        // Normalized against a fixed fraction of discIn, not against hMax: dividing by the slab's own height
        // would cancel it out, making DISC HEIGHT move nothing (the bug that got an earlier slider deleted).
        discLit += tint * (emis * boost * passAtt * uDisc * 1.6
                           * length(x - x0) * frac / max(discIn * 0.22, 1e-4));
      }
    }
  }

  // trans is the fraction of this pixel that saw past every shell, and the hole/disc sit at DEPTH or beyond, so
  // it's exactly what they composite through -- closing the tunnel wall correctly hides the hole behind it.
  // There's no shadow mask: the tunnel is entirely in front of the hole so can't be occluded by it, and the
  // shadow is an absence (the geodesic fell in and gathered nothing), not a disc to stencil out of the wall.
  col += discLit * trans;

  // The screen radius, for the lens effects that belong to the frame rather than the tunnel.
  float r = length(uv);
  // Chroma and vignette strength were sliders nothing ever moved off 1.0; inlined so there's one description.
  float ca = 0.18 * r;
  col.r *= 1.0 + ca;
  col.b *= 1.0 - 0.6 * ca;
  col *= smoothstep(1.45, 0.1, r);
  col *= uExposure;
  col = col / (col + 1.0);
  fragColor = vec4(pow(col, vec3(0.85)), 1.0);
}`;
