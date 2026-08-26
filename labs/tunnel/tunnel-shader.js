/* The tunnel as a SOLVED surface rather than a marched volume. Pure source, no GL calls.
 *
 * THE WALL IS A CYLINDER AND A RAY IS A LINE, so where they meet has a closed form. That is the whole idea: one
 * quadratic per shell instead of a loop of samples down every ray. The lab next door marches 28 steps through a
 * 3D density field to answer the same question and costs 46 ms per megapixel doing it; this costs about 6.
 *
 * THERE IS NO INTEGRAL BEING ESTIMATED, SO THERE IS NO GRAIN. A march estimates each ray from a handful of point
 * samples of a field finer than its own step, so where those samples land decides the answer and neighbouring
 * pixels disagree — that disagreement IS the grain, and dithering only decides whether it looks like noise or
 * like rings. Here the answer is exact, so the term does not exist and cannot be traded against the frame rate.
 *
 * SHELLS ARE WHAT BUYS DEPTH BACK. One surface has nothing in front of anything else. Several cylinders at
 * several radii are met at several depths by the same ray, so compositing them front-to-back gives real occlusion
 * AND real parallax — the inner shell is met nearer, so it sweeps the screen faster for the same travel.
 *
 * FRONT TO BACK MEANS INNER FIRST: a ray leaving the eye crosses the small radius before the large one. The host
 * sorts them, because a shell whose RADIUS is dragged past its neighbour would otherwise composite in the wrong
 * order and occlude something in front of it.
 *
 * EVERY SHELL CAN CARRY EVERY EFFECT. There is no such thing as "the cloud shell" — a shell is a surface at a
 * radius, and NEBULA, PLASMA and STREAKS are amounts on it, any mix, any shell. Tying one effect to one shell was
 * the first shape this had and it made the interesting combinations unreachable.
 */

/* SIX SHELLS, ALWAYS PRESENT, EACH SWITCHED AT ITS OWN HEADER. There was a count slider and it was the wrong
 * control: "how many shells" is not a thing anyone wants to set, and it made shell four unreachable without
 * first passing through three. A shell that is off is one `continue` per pixel, so the ones nobody lit cost
 * nothing worth a control to avoid.
 *
 * Packed into vec4s because the kit uploads vec4 arrays and a uniform per shell per field would be scores. */
export const MAXL = 6;

export const UNIFORMS = [
  'uRes', 'uTime', 'uFov', 'uFar',
  'uBend', 'uBendFlow', 'uBendDir',
  'uMass', 'uEndR',
  'uDisc', 'uDiscTilt', 'uDiscLean', 'uDiscOut', 'uDiscH', 'uDiscSpin', 'uDiscA', 'uDiscB', 'uDoppler',
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
uniform float uDisc, uDiscTilt, uDiscLean, uDiscOut, uDiscH, uDiscSpin, uDoppler;
uniform float uFog, uExposure;
uniform vec3  uDiscA, uDiscB;

// geom: radius, amount, speed, stretch. mix: cloud, bolts, streaks, rings.
// shade: cloud fill, cloud edge, cloud detail, spin. extra: lanes, ON, bolt fill, bolt edge.
uniform vec4 uGeom[${MAXL}];
uniform vec4 uMix[${MAXL}];
uniform vec4 uShade[${MAXL}];
uniform vec4 uExtra[${MAXL}];
/* RINGS ARE A PER-SHELL EFFECT, so their spacing and flow are per-shell too. They were one global pair shared by
 * every shell -- the same shape as the FLOW and WIND masters that were removed: a rate that belongs to a surface,
 * set somewhere that is not that surface. Rings on the near shell should be able to run at a different pitch from
 * the far one; that IS the depth the shells exist to give. All four other vec4s are full, hence a fifth. */
uniform vec4 uRingP[${MAXL}];

/* TWO COLORS PER EFFECT, PER SHELL. One flat tint per shell made every effect on it the same color, which is the
 * same flattening as one effect per shell -- a shell is a place, and what is drawn there does not have to agree
 * about its color. Each effect blends A to B across ITS OWN gradient: the cloud across its density, the bolts
 * across their strength, the streaks per lane so no two lanes match.
 *
 * A MARCH COULD NOT DO THIS SAFELY. Integrating a hundred samples of a fast-varying ramp averages it to grey,
 * which is why the marched lab drives its ramp from something deliberately slow. One sample has nothing to
 * average, so the gradient can follow the fastest thing in the layer. */
uniform vec4 uCloudA[${MAXL}], uCloudB[${MAXL}];
uniform vec4 uBoltA[${MAXL}], uBoltB[${MAXL}];
uniform vec4 uStrkA[${MAXL}], uStrkB[${MAXL}];

#define TAU 6.28318530718
// The radius the arch is measured against. A bend of 1 carries the far end one of these off the axis.
#define TUBE_R 1.0
// How far the far end may swing, in tube radii, before it starts leaving its own tube.
#define MAX_SWING 6.5

float h31(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

/* Value noise read on the CYLINDER'S SURFACE — the angle enters as its cosine and sine, so the field wraps with
 * no seam to hide. A tunnel unrolled into a flat strip has a cut down it, and that cut is always visible. */
float n3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x),
                 mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x),
                 mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}

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

/* THE TUNNEL IS A FIXED CURVE IN SPACE AND THE CAMERA TRAVELS ALONG IT.
 *
 * WHAT THIS REPLACES, AND WHY IT WAS WRONG. The bend used to be an arch anchored at the eye, growing as the
 * square of the distance and rotating in place. That displaces the far field and leaves the near field alone --
 * which is exactly what a LENS does, and it read as one. Nothing ever travelled: no bend ever arrived, passed,
 * or went behind you. It was a tube being deformed around a stationary viewer.
 *
 * A path fixes that. The curve is fixed in the world; BEND FLOW moves the CAMERA along it. So the corners come
 * out of the distance, straighten as you reach them, and sweep past -- which is what travelling down a bent
 * tunnel is, and what the home page's lab card gets by flying its rings along a centerline.
 *
 * TWO TERMS ARE SUBTRACTED and both are load-bearing. Subtracting the path's value AT THE CAMERA puts the eye on
 * the axis, so the tube never swings sideways around the viewer. Subtracting the TANGENT times the distance
 * points the view down the tube, so the tunnel ahead is always centred and it is the CURVATURE you see rather
 * than a tube sliding off to one side. Without the second term the tunnel leans permanently and the far end sits
 * off the frame; with it, what remains is the bend itself.
 *
 * LENGTH is how far apart the corners are, in world units, so it means the same thing at any DEPTH.
 */
/* THE AMPLITUDE IS SET FROM THE FAR END'S SWING, NOT FROM THE SINE'S HEIGHT.
 *
 * Subtracting the tangent is a FIRST-ORDER rotation into the camera's frame, and it is only valid while the
 * path's slope is small. Written with the sine's own amplitude it is not: the -k*z*cos term grows linearly with
 * distance, so at BEND 2.4 over DEPTH 26 the axis ended up THIRTEEN world units sideways -- six times the widest
 * shell. The tube's far end left the frame and closed its wall across the view, which is the black wall with the
 * hole sitting off to one side of it.
 *
 * Dividing by k*uFar cancels exactly that term. What is left is a slope of uBend/uFar whatever the wavelength,
 * so BEND means "how far the far end swings, in tube radii" and it means the same thing at every BEND LENGTH and
 * every DEPTH -- and the first-order rotation stays inside its own assumption.
 */
/* ONE BEND ACROSS THE DISTANCE. The axis leaves the camera straight and swings a single arch by DEPTH.
 *
 * A QUADRATIC IS WHY THIS IS STABLE -- zero AND flat at z = 0, so the eye sits on the axis looking straight down
 * the tube for free: no frame to rotate into, no tangent to subtract, nothing that can run away with distance.
 * A quarter sine moves the swing into the near half, where the tube is large on screen; the swing at DEPTH is
 * the same either way, it just arrives earlier.
 *
 * THE SWING SATURATES. BEND is in TUBE_R units and the lit shells are 0.5 to 1.35 wide, so at BEND 10 the mouth
 * sat seven times its own radius off axis: the wall closed across it and the hole showed beside it rather than
 * through it, two overlapping discs instead of one throat. tanh keeps the whole slider usable, linear where
 * BEND already behaved and easing into a ceiling above it.
 *
 * THE DIRECTION AND THE SWING ARE THE SAME FOR EVERY PIXEL, so they are worked out once at the top of main
 * rather than inside bendAt. They were recomputed on every call -- a tanh and two trig calls each -- and the
 * scan calls this up to a hundred times a pixel. Nothing about them varies across the frame or along a ray. */
/* A CEILING THAT DOES NOT CREASE. min() against a limit is two different curves meeting at a corner, and the
 * corner shows: the fold ran along the true deflection out to one radius and then went dead flat, which reads
 * as the arc curving and then stopping for no reason anyone could point at.
 *
 * tanh approaches the same ceiling without ever reaching it, so there is no radius where the behaviour changes.
 * The approach to the limit IS the compression -- the arc keeps bending and its bands crowd together toward the
 * top, which is what the far side of a disc does as it wraps over the shadow. */
float softCap(float x, float lim){ return lim * tanh(x / max(lim, 1e-6)); }

vec2 gBendDir;
float gSwing;

void setupBend(){
  float a = uBendDir + uTime * uBendFlow * 0.12;
  gBendDir = vec2(cos(a), sin(a));
  gSwing = MAX_SWING * tanh(uBend / MAX_SWING) * TUBE_R;
}
vec2 bendAt(float z){
  float f = clamp(z / max(uFar, 1.0), 0.0, 1.0);
  return gBendDir * (gSwing * sin(f * 1.5707963));
}
vec2 bendD(float z){
  float f = clamp(z / max(uFar, 1.0), 0.0, 1.0);
  return gBendDir * (gSwing * 1.5707963 * cos(f * 1.5707963) / max(uFar, 1.0));
}

/* THE HOLE HAS ONE NUMBER AND EVERY OTHER RADIUS IS A FIXED MULTIPLE OF IT.
 *
 *   horizon         1.000 Rs   nothing leaves
 *   photon sphere   1.500 Rs   where light orbits -- a COORDINATE radius, not what the eye sees
 *   shadow edge     2.598 Rs   3*sqrt(3)/2 Rs, the CRITICAL IMPACT PARAMETER, and this is the apparent one
 *   inner orbit     3.000 Rs   the ISCO; nothing orbits inside it, so no disc starts closer
 *
 * NONE OF THEM IS A SLIDER, and there is no second control for how hard the hole bends light, because gravity
 * has no second number. LENS was one: it scaled the deflection's profile while the shadow stayed on MASS, so
 * the warp and the thing it warped around were free to disagree about the same hole. */
#define B_CRIT 2.59807621
#define R_ISCO 3.0

/* THE PATH IN CLOSED FORM, WHICH IS WHAT THE TUNNEL IS BENT BY.
 *
 * A ray passing a mass turns by 2Rs/b in total, and it does not turn all at once. The rate along the ray is
 *   dtheta/ds = Rs*b / (s^2 + b^2)^(3/2)
 * with s measured from the ray's closest approach. Integrating once gives how far it has turned by s, and
 * twice gives how far sideways it has actually moved:
 *
 *   theta(s) = (Rs/b) * (1 + s / sqrt(s^2 + b^2))     0 long before, Rs/b at closest approach, 2Rs/b long after
 *   delta(s) = (Rs/b) * (s + sqrt(s^2 + b^2))         0 long before, exactly Rs at closest approach
 *
 * THIS IS NOT AN APPROXIMATION OF THE INTEGRATOR IN main(). It is the same equation solved on paper in the
 * regime where it can be, and the two agree wherever they overlap -- which is why the handover into the
 * integrator below reads theta and delta straight off these two lines rather than restarting from the eye.
 *
 * IT IS ALSO WHY THE TUNNEL USED TO LOOK DRAGGED RATHER THAN LENSED. The old bend was one screen-space pull
 * applied to every shell at every depth, so wall two units in front of the camera moved as far as the far
 * mouth -- and wall two units away is nowhere near the hole and must not move at all.
 *
 * THE TUNNEL CANNOT FOLD THROUGH ITSELF, AND NO CLAMP SAYS SO. For every s <= 0 the bracket (s + sqrt(s^2+b^2))
 * lies in (0, b], so delta lies in (0, Rs] whatever b is -- and the whole tunnel is at or before closest
 * approach by construction, because the hole is at its far end. The largest sideways pull anywhere in the tube
 * is exactly one Schwarzschild radius. */
vec3  gHoleO;
vec3  gHdir;
float gB, gT0, gRs, gD0;

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
vec3 rayAt(vec3 rd, float t){ return rd * t - gHdir * lensShift(t); }

/* THE NULL GEODESIC ITSELF. In Schwarzschild geometry a photon obeys d2u/dphi2 + u = 3M u^2 with u = 1/r, and
 * as an acceleration on a Cartesian path that is
 *
 *   d2x/dlambda2 = -(3/2) * Rs * h^2 * x / r^5,    h = |x cross v|, conserved along the ray.
 *
 * One line. The speed |v| is not conserved by it and does not need to be -- it is a coordinate rate, and only
 * the SHAPE of the path is read. */
vec3 holeAccel(vec3 x, float h2, float rs){
  float r2 = max(dot(x, x), 1e-12);
  float r5 = r2 * r2 * sqrt(r2);
  return x * (-1.5 * rs * h2 / max(r5, 1e-20));
}

/* WHERE THE RAY MEETS THE TUBE. |rd.xy * t - offset(t)| = R is a quadratic in t for a FIXED offset, and the
 * offset depends on the t being solved for -- so it is solved by repeating: guess the depth, read the offset
 * there, re-solve, repeat.
 *
 * FIVE PASSES, NOT TWO. Two is plenty while the tube is nearly straight and nowhere near enough once the offset
 * approaches the radius: the iteration had not settled, so the surface came out in the wrong place and the tube's
 * apparent centre drifted away from where its axis actually is. That is what put the black hole and the tunnel's
 * vanishing point in two different places on screen. Each pass is a handful of arithmetic and no texture reads.
 *
 * THE RADIUS IS FORESHORTENED BY THE TUBE'S OWN SLOPE, which is what makes this a curve rather than a shear. A
 * section cut across the view is an ELLIPSE stretched by 1/cos of the angle the tube leans at; asking for a
 * circle of the plain radius there draws a tube that is too wide wherever it turns.
 */
/* Signed gap from the ray at t to this shell's wall: negative inside the tube, positive outside.
 * Split out because the scan below needs it at many t and the crossing is where it changes sign. */
float wallGap(vec3 rd, float t, float R, vec2 b0){
  /* THE RAY IS NOT STRAIGHT, and this one line is how the hole reaches the tunnel. rayAt carries the closed
     form above, so a sample near the eye sits exactly where an unbent ray would and one at the far mouth is
     pulled a Schwarzschild radius toward the axis -- which puts the mouth's IMAGE further out, magnified, and
     wrapped around the shadow. */
  vec3 Pw = rayAt(rd, t);
  float z = Pw.z;
  vec2 bo = bendAt(z) - b0;
  vec2 sl = bendD(z);
  float k = sqrt(1.0 + dot(sl, sl));

  /* THE SHELLS TAPER ONTO ONE SHARED END RADIUS, and that is what stops there being three tunnels.
   *
   * A shell of constant radius subtends R * fov / DEPTH at the far end -- a DIFFERENT angle for every radius --
   * so the three lit shells drew three concentric mouths at DEPTH, 11, 19 and 29 pixels across, stacked at the
   * middle of the frame. That reads as several tubes overlaid rather than one tunnel with depth in it.
   *
   * Tapering to one end radius gives them a single mouth. The taper is a smoothstep rather than a square so the
   * shells hold their own radii through the near half -- where a shell's size is the thing you actually see --
   * and are most of the way closed by three quarters out, while the tube is still lit.
   *
   * THE END RADIUS COMES FROM THE HOST, which is the only place that can see all six radii at once. Taking
   * min(uEndR, R * 0.9) here instead was a bug: every shell's radius is under the hole's size, so the min always
   * chose the shell's own radius and each one tapered to a different end again. */
  float taper = clamp(z / max(uFar, 1.0), 0.0, 1.0);
  float Rc = mix(R, uEndR, smoothstep(0.0, 1.0, taper));

  /* THE SECTION IS AN ELLIPSE, AND ONLY ALONG THE LEAN. A swept tube's sections are round when cut
   * perpendicular to its own tangent; seen from a camera that cuts across the VIEW instead, such a section is
   * stretched by 1/cos of the lean along the direction the tube leans, and untouched at right angles to it.
   * Stretching in every direction -- which one scalar radius does -- makes the tube FAT wherever it turns
   * instead of tilting it, and a fat tube sliding across as it recedes is a warp rather than a curve. */
  vec2 v = Pw.xy - bo;
  float vl = length(v);
  vec2 dir = vl > 1e-5 ? v / vl : vec2(1.0, 0.0);
  vec2 lean = dot(sl, sl) > 1e-10 ? normalize(sl) : vec2(1.0, 0.0);
  float Rz = Rc * mix(1.0, k, abs(dot(dir, lean)));
  return vl - Rz;
}

/* WHERE THE RAY MEETS THE SHELL, FOUND BY WALKING THE TUBE RATHER THAN SOLVING FOR IT.
 *
 * A straight tube is a quadratic and this was one. A BENT tube is not: the axis offset depends on z, z depends
 * on the hit, and the hit depends on the offset. That was closed by iterating the quadratic, and the iteration
 * is what broke. Its first guess, R/sqrt(A), is unbounded -- A is |rd.xy|^2 and goes to zero down the axis, so
 * near the middle of the frame the search STARTED around twenty-two thousand units out, far past the end of the
 * tube, and five steps never came back. At BEND 6 with one shell lit and the fade off, almost nothing rendered:
 * every shell returned a hit past DEPTH, every shell was skipped, and the frame went black. Every "the tunnel
 * and the hole are not aligned" symptom was downstream of that.
 *
 * A scan cannot diverge. The gap changes sign exactly once between the eye and the wall, so N samples bracket
 * the crossing and one interpolation lands on it. It is bounded by the tube's own length by construction, so
 * BEND is a real control across its whole range instead of up to wherever the iteration happened to hold.
 *
 * STEPS ARE PACKED TOWARD THE EYE. Perspective compresses distance, so a step near the camera covers far more
 * of the screen than the same step at DEPTH; even spacing spends its samples where they are least visible.
 *
 * NO CROSSING MEANS THE RAY LEFT THROUGH THE OPEN END, which is the mouth of the tunnel. graze 0 reports it,
 * and the caller already treats that as nothing drawn.
 */
float solveShell(vec3 rd, float R, vec2 b0, out vec2 rel, out float zz, out float graze){
  float tMax = uFar / max(rd.z, 1e-4);
  float tA = 0.0, dA = -1.0, hitT = -1.0;
  graze = 0.0;

  for (int i = 1; i <= 14; i++){
    float f = float(i) / 14.0;
    float tB = tMax * f * f;
    float dB = wallGap(rd, tB, R, b0);
    if (dB >= 0.0 && dA < 0.0){
      /* THE BRACKET IS REFINED, and without this the tunnel had dark rings in it.
       *
       * Interpolating once across a scan step lands near the wall but its ERROR is largest mid-step and smallest
       * at the ends, so the error has the period of the scan -- and a scan stepped in t draws that period on
       * screen as circles around the vanishing point. Three false-position steps drive the error far below what
       * the shading can show, for three more gap evaluations. */
      for (int k = 0; k < 3; k++){
        float tM = mix(tA, tB, dA / (dA - dB));
        float dM = wallGap(rd, tM, R, b0);
        if (dM < 0.0){ tA = tM; dA = dM; } else { tB = tM; dB = dM; }
      }
      hitT = mix(tA, tB, dA / (dA - dB));

      /* HOW SQUARELY THE RAY MET THE SURFACE, taken from the refined bracket rather than from two more probes
       * either side of the hit. Three false-position steps leave tA and tB straddling the root closely, so their
       * secant IS the slope there. Measuring it across the raw SCAN step was the thing that drew dark rings --
       * that made it a per-step constant which jumped between steps; this does not, because the bracket has
       * converged onto the crossing.
       *
       * The gap rises at |rd.xy| for a ray leaving straight through the wall and at nothing at all for one
       * leaving along the silhouette, so the ratio of the two is the squareness. */
      graze = clamp(((dB - dA) / max(tB - tA, 1e-6)) / max(length(rd.xy), 1e-4), 0.0, 1.0);
      break;
    }
    tA = tB; dA = dB;
  }

  if (hitT < 0.0){ rel = vec2(0.0); zz = uFar; return -1.0; }
  vec3 P = rayAt(rd, hitT);
  rel = P.xy - (bendAt(P.z) - b0);
  zz = P.z;
  return hitT;
}

/* STREAKS ARE A FUNCTION OF THE ANGLE, and that is the thing this technique gives away almost free. A streak is a
 * lane running down the tube, so which lane a pixel is in is its angle, and how far along the lane's head has got
 * is its depth. The marched build solves the same look with two hundred capsules, angular buckets and a
 * three-candidate search per shell; here it is a floor() and a hash.
 *
 * IT BELONGS TO ITS SHELL, LIKE EVERY OTHER EFFECT. It takes the shell's own SPEED and COLOR and its own lane
 * count, so streaks on the near shell tear past while streaks on the far one drift -- which is depth, and is the
 * whole reason the shells exist. They were briefly a global COUNT, SPEED and COLOR shared by every shell, which
 * made them the one effect that was not a property of the surface it was drawn on.
 */
float streakAt(float ang, float z, float count, float speed, out float lr){
  /* THE LANE INDEX WRAPS, AND WITHOUT THAT THERE IS A SEAM DOWN THE TUBE.
   *
   * atan returns (-PI, PI], so at the branch cut slot jumps by exactly count -- and the lane index used to be a
   * bare floor(), so the hash on one side of the cut was h31(lane) and on the other h31(lane + count). Different
   * colour, different head, different lane, meeting along one line running the length of the tunnel: it read as
   * two tubes butted together and running side by side.
   *
   * mod() closes it, but only if count is a whole number of lanes -- a fractional count cannot tile a circle,
   * and the seam comes back as a partial lane. So the count is rounded here rather than trusted from a slider. */
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
  /* THE LENS. uFov is the ray's z, so SMALL IS WIDE — the host sends it from an angle in degrees, which is the
   * number a person means. A narrow angle keeps the wall away from the frame edge and the whole thing reads as
   * weather out in front; opened up, the wall sweeps the periphery and the picture closes around the viewer. */
  // The curve's value at the eye, so the axis passes through the viewer and the offset grows with depth instead
  // of sliding the whole tube sideways. It is what lets BEND go past a token lean.
  vec2 b0 = bendAt(0.0);

  /* THE HOLE SITS AT THE FAR END OF THE TUNNEL, so it follows the bend: the tunnel's axis at DEPTH is where
   * it is, and it rides round with BEND FLOW rather than sitting still while the tube swings away from it.
   *
   * IT IS AN OBJECT AT A DEPTH, not a sprite on the glass, and everything about it follows from that. Push
   * DEPTH out and it recedes and shrinks the way anything else at that distance would; nothing about it is
   * measured in screen units, which is what a fixed screen radius got wrong.
   *
   * THE RAY LEAVING THE EYE IS STRAIGHT. It was pre-warped here -- uv shifted toward the hole before a single
   * shell was solved -- which is why the whole frame dragged. What bends it now is rayAt, evaluated at the
   * depth of each sample, so the bend a surface gets is the bend its own light actually took. */
  vec3 rd = normalize(vec3(uv, uFov));
  vec3 holeO = vec3(bendAt(uFar) - b0, uFar);

  /* ONE SOLAR MASS IS 0.2 WORLD UNITS OF SCHWARZSCHILD RADIUS, and this line is the only place that says so.
   * The panel reads MASS in solar masses because that is the unit a hole's mass is quoted in; the scale from
   * there to the tunnel's own units is arbitrary and is a scene decision, not physics. 0.5 was tried and a
   * single solar mass already filled a third of the frame -- the visible dark disc is 2.598 Rs across before
   * the lens widens it further, so a radius that looks modest on paper is large by the time it is drawn. */
  float rs = uMass * 0.2;
  setupHole(rd, holeO, rs);

  vec3 col = vec3(0.0);
  float trans = 1.0;

  for (int s = 0; s < ${MAXL}; s++){
    if (uExtra[s].y < 0.5) continue;

    vec4 g = uGeom[s], m = uMix[s], sh = uShade[s];
    vec2 rel; float z, graze;
    float t = solveShell(rd, max(g.x, 0.02), b0, rel, z, graze);
    // Fades out with distance rather than being cut off at one. Nothing past the fade is worth reading a field for.
    /* THE FADE KEEPS A FLOOR, and that floor is what makes the tunnel and the hole agree.
   *
   * It used to reach 0 at DEPTH, which blacks out the last stretch of tube -- and the last stretch is the only
   * one where an arch has swung anywhere. So the tube appeared to converge back near the frame centre, where it
   * has not bent yet, while the hole drew at the true far end: two vanishing points, and the whole reason they
   * looked unaligned. Dim but present, and the convergence is visible where the hole actually is. */
  float depth = mix(1.0, 0.16 + 0.84 * (1.0 - smoothstep(2.0, uFar, t)), uFog);
    /* THE TUBE STOPS AT DEPTH, and that is what welds its end to the hole.
       Nothing rejected hits past uFar, so a near-axis ray struck the wall extrapolated well beyond the tube's
       end -- out where the arch keeps swinging and the taper is already clamped. The middle of the frame was
       filled by tube that does not exist, and the opening you read as the throat was that fill running out
       rather than the tube ending. Cut at DEPTH, the opening IS the tube's end, centred on the axis at DEPTH,
       which is exactly where the hole draws. */
    if (t <= 0.0 || z > uFar || depth <= 0.002) continue;
    float ang = atan(rel.y, rel.x) + sh.w * uTime;

    /* THE TUNNEL'S OWN COORDINATES: where round the tube, and how far along it. WIND scales the distance the
     * pattern is read at, which is what tightens or unwinds the whorl at the vanishing point — see below. */
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

    /* PLASMA — where two independent fields BOTH cross zero, which is a LINE rather than a surface. One field's
     * mid-level is a surface and reads as froth; the crossing of two is a filament. */
    if (m.y > 0.001){
      vec3 q = tc * 1.6 + vec3(19.3, 7.1, 3.7);
      float f1 = n3(q) - 0.5, f2 = n3(q * 1.31 + vec3(5.2, 1.7, 9.1)) - 0.5;
      /* PLASMA FILL IS HOW THICK, PLASMA EDGE IS HOW HARD -- the same two questions the nebula answers, asked of
       * its own surface. The field is the distance to where both noise fields cross zero, scaled so 1 is on the
       * line and 0 is as far from it as the field goes; thresholding that is exactly what FILL does to the
       * nebula's fbm, and the smoothstep's width is exactly what EDGE does to it. Same shape, same meaning, one
       * pair per effect. */
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

  /* ================================ THE HOLE, INTEGRATED ================================
   *
   * EVERY FEATURE OF A BLACK HOLE FALLS OUT OF ONE LOOP, and not one of them is drawn:
   *
   *   THE SHADOW is the set of rays that reach r < Rs. Its edge lands at 2.598 Rs on its own -- that number
   *     appears nowhere inside the loop, which is the test that the loop is right.
   *   THE PHOTON RING is rays that wound most of a turn near 1.5 Rs and came back out. They cross the disc
   *     several times on the way, so the light piles into a thin circle at the shadow's edge without anything
   *     placing a circle there.
   *   THE SECOND IMAGE -- the disc's far side arcing over the top of the shadow AND under the bottom at the
   *     same time -- is simply the ray's second crossing of the disc. There is no front pass, no back pass and
   *     no blend between them, because a curved ray is ONE ray.
   *   THE MOUTH'S EINSTEIN RING is the tunnel wall, wrapped by the closed form above. Same law, same Rs.
   *
   * WHAT THIS REPLACES was a screen-space pinch whose deflection was softened to zero at the centre. It could
   * not diverge, so it could not wind, so not one of the features above could occur -- and each had to be added
   * by hand: a capture smoothstep for the shadow, a rim width for the ring, a squeeze gain for the fold, a
   * two-pass split with a handover blend for the second image, a wrap gain and a cap to keep that image on the
   * rim. All of it is gone. A LENS control is gone with it: there is no second number in gravity.
   *
   * IT IS BOUNDED, AND THAT IS WHY THIS LAB CAN AFFORD IT. The march runs only for rays whose impact parameter
   * is inside rInt -- far enough out that the closed form is exact and the disc is out of reach -- and it hands
   * over at that boundary rather than starting at the eye. At the shipped MASS that is a few per cent of the
   * frame. Turn MASS up and the hole is most of the picture, and paying for most of the picture is fair.
   */
  vec3 discLit = vec3(0.0);
  if (uMass > 1e-4 && uDisc > 0.001){
    /* THE INNER EDGE IS THE ISCO AND IT IS NOT A CONTROL. Nothing orbits inside it, so a disc always starts
       there and never anywhere else. As two independent numbers they could disagree, and every way they could
       was wrong: a gap of empty space between hole and disc, or a disc drawn over the shadow. */
    float discIn  = rs * R_ISCO;
    /* REACH IS AN OUTRIGHT RADIUS in the same world units as everything else, so it stays put when MASS moves.
       The guard says the only thing that must be true: the outer edge is never inside the inner one. */
    float discOut = max(uDiscOut, discIn * 1.05);
    /* HEIGHT IS AN HONEST CONTROL NOW, AND IT WAS NOT BEFORE. It used to size a sampling window and then cancel
       straight out of the brightness, so the slider moved nothing and was removed for saying so. The disc is
       integrated as a VOLUME along the same march that bends the light, so a deeper slab really does hold more
       gas and really is brighter where the ray runs further through it.

       IT ARRIVES IN SCHWARZSCHILD RADII, which is a length and not a ratio. It used to be a FRACTION OF THE
       INNER EDGE shown as a percentage, and a percentage of something the panel never names is not a reading of
       anything -- 14% of what? Rs is the one length every other radius in this picture is quoted against, so the
       slab is measured in it too, and the slab still scales with MASS because Rs does. */
    float hMax = max(uDiscH, 0.01) * rs;

    /* A PLANE HAS TWO ANGLES AND ONLY TWO. Its orientation is its normal, and a direction on a sphere takes
       two numbers -- so TILT and LEAN reach every orientation there is. The third rotation a solid would have
       does nothing at all to a plane; what people mean by it is the PATTERN turning, which is DISC SPIN.
       TILT 0 is flat: the normal points at the eye, so you look down on the disc. */
    float ct = cos(uDiscTilt), st = sin(uDiscTilt);
    float cl = cos(uDiscLean), sl = sin(uDiscLean);
    vec3 nrm = normalize(vec3(st * sl, st * cl, ct));
    /* THE IN-PLANE AXES NEED A REFERENCE THE NORMAL IS NOT PARALLEL TO. Crossing with z alone returns a zero
       vector the moment the disc is exactly face-on, and normalize(0) is a NaN that blackens every pixel the
       disc touches at one end of the TILT slider. */
    vec3 ref = abs(nrm.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 u1 = normalize(cross(nrm, ref));
    vec3 u2 = cross(nrm, u1);

    // Where the closed form stops being enough: outside the disc's reach AND well outside the winding zone.
    float rInt  = max(discOut, rs * B_CRIT * 4.0) * 1.15;
    // And where there is nothing left ahead worth stepping through, which is nearer than where it started.
    float rExit = max(discOut, rs * B_CRIT * 2.5);

    if (gB < rInt){
      /* HAND OVER FROM THE CLOSED FORM AT THAT BOUNDARY rather than integrating the empty tunnel. Position is
         delta(s) and direction is theta(s), read straight off the two lines the tunnel uses, so the march
         starts on the path the tunnel already drew and there is no seam where they meet. */
      float tS = max(gT0 - rInt, 0.0);
      float sS = tS - gT0;
      vec3 x = rayAt(rd, tS) - gHoleO;
      vec3 v = normalize(rd - gHdir * ((rs / gB) * (1.0 + sS / sqrt(sS * sS + gB * gB))));
      vec3 Lv = cross(x, v);
      float h2 = dot(Lv, Lv);
      vec3 acc = holeAccel(x, h2, rs);
      float turn = uTime * uDiscSpin;

      /* HOW FAR ROUND THE HOLE THE RAY HAS COME, and it is the only bookkeeping the march needs. h is
         conserved and dphi = h dlambda / r^2, so carrying it costs one multiply and one divide a step. */
      float phi = 0.0;
      float hMom = sqrt(h2);

      /* VELOCITY-VERLET, NOT EULER. It is symplectic, so a ray winding near the photon sphere holds its orbit
         instead of spiralling out of it as the step count runs down -- which is the difference between a photon
         ring and a smear.

         THE STEP FOLLOWS r, AND NOTHING ELSE. Coarse out where the path is nearly straight, fine in where it is
         turning hardest, so the budget is spent where the curvature is. Its own floor is what makes it safe: the
         loop stops at 1.02 Rs, where 0.17*(r - 0.45 Rs) is still about a tenth of Rs, so the step cannot
         collapse and the march cannot stall however small the hole is.

         IT WAS ALSO CAPPED BY THE SLAB'S THICKNESS, AND THAT CAP WAS A BUG. The cap was hMax*0.75, hMax scales
         with MASS, and the distance to cross does not -- so the steps needed to get through the disc went as
         1/MASS and passed the budget at MASS 1: 165 steps asked of 144, and 825 by MASS 0.2. Past that point the
         march ran out before it reached the hole, so the shadow and the disc simply stopped being drawn, and
         every pixel in the lensed region burned the full budget doing it. Both halves of "it breaks below a
         certain MASS and it will not hold 60" were that one line.
         Nothing needs it. The overlap below is EXACT for a straight segment at any step length, and where the
         path is curved enough for straightness to matter -- near the photon sphere -- 0.17*(r - 0.45 Rs) is
         already about 0.18 Rs against a slab 0.42 Rs thick, so the step is smaller than the slab there anyway. */
      for (int i = 0; i < 144; i++){
        float r = length(x);
        if (r < rs * 1.02) break;                  // fell in. Whatever it gathered on the way still counts.
        /* OUT AND CLIMBING, PAST EVERYTHING THERE IS TO MEET. The test used to be against rInt, which is the
           radius the march STARTS at -- so every escaping ray was carried a long way past the disc's outer edge
           before anything stopped it. What matters is the disc's own reach and the few Rs where the bend is
           still worth integrating. */
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

        /* THE DISC IS A SLAB AND THE STEP IS A SEGMENT, so what a step collects is the LENGTH of the overlap
         * between them. This is the volume integral the old build wanted and could not afford: the march is
         * already running for the lensing, so sampling the gas along it costs a clamp.
         *
         * NOTHING IS CAPPED, and the last hard ceiling in this shader goes with that. The old path length was
         * 2h/|cos| and ran to infinity exactly edge-on, so it had to be saturated -- and the saturation drew
         * its own straight-edged outline through the disc. A segment simply has a length, and a ray cannot stay
         * inside the slab forever because it either falls in or leaves. Edge-on, many consecutive steps land
         * inside and the disc reads as a bright bar clean across the middle of the shadow. Face-on, one step
         * crosses it and it reads as a ring. */
        /* MEASURED AT THE CROSSING, NOT AT THE MIDDLE OF THE STEP. The slab's thickness and the radial cull
           both want to know WHERE the ray meets the plane, and the midpoint of the segment only answers that
           while steps are short. Since the step no longer follows the slab it can be most of a world unit long
           in the outer disc, and a midpoint there sits far enough from the crossing to cull real hits at both
           edges of the annulus. d is linear along the segment, so the crossing is one divide. */
        float dv = d1 - d0;
        float uc = abs(dv) > 1e-7 ? clamp(-d0 / dv, 0.0, 1.0) : 0.5;
        float rm = length(mix(x0, x, uc));
        if (rm < discIn * 0.9 || rm > discOut * 1.1) continue;
        /* THE DISC BULGES IN THE MIDDLE, thickest at the inner edge and thinning outward -- a lens rather than
           a sheet of card. The inner region of a real disc is the puffy one: hottest, radiating hardest, and
           held up against gravity by its own pressure, while the outer disc settles flat. */
        float hh = hMax * mix(1.0, 0.12, smoothstep(discIn, discOut, rm));

        float uA = 0.0, uB = 0.0;
        if (abs(dv) > 1e-7){
          float p = (-hh - d0) / dv, q = (hh - d0) / dv;
          uA = clamp(min(p, q), 0.0, 1.0);
          uB = clamp(max(p, q), 0.0, 1.0);
        } else if (abs(d0) < hh){ uB = 1.0; }
        float frac = uB - uA;
        if (frac <= 0.0) continue;

        /* LIGHT THAT WOUND FURTHER IS DAMPED, AND IT HAS TO BE DAMPED BY AN ANGLE RATHER THAN BY A COUNT.
         *
         * Each successive image of the disc is squeezed into an angular width about e^(-2pi) -- a five-hundredth
         * -- of the one before. The first is the disc itself; the second is the arc that climbs over the top of
         * the shadow and hangs under the bottom, and it is wide enough to draw. The third already lands inside a
         * pixel, so what a pixel reports about it is not its brightness but WHICH SIDE of it that pixel fell on.
         *
         * COUNTING THE CROSSINGS AND CAPPING THE COUNT DOES NOT FIX THAT, and trying it is what proved the
         * point. The count is an INTEGER function of the impact parameter: it steps as b crosses each image, and
         * that step lands on screen as a DOTTED CIRCLE at the shadow's edge, one dot per pixel that fell the far
         * side of the jump. Exactly the grain a march produces, arriving through the one part of this shader
         * that is a march -- and capping the count only moves which jump draws it.
         *
         * phi is CONTINUOUS in b. It rises smoothly and diverges logarithmically at the capture radius, so
         * damping by it FADES the unresolvable images out rather than switching them off, and neighbouring
         * pixels agree about what they see.
         *
         * THE CURVE IS FLAT THEN STEEP, which is what lets it keep the second image and lose the third. A
         * gentle falloff has to be strong enough at 2pi to hide the third image, and anything that strong at 2pi
         * has already halved the second one at pi. A fourth power inside an exponential is nearly 1 out to most
         * of a half turn and nearly 0 by a full one. */
        float q = phi * 0.238;   // a half turn is a little under 1, a full turn a little under 1.5
        q *= q;
        float passAtt = exp(-q * q);

        vec3 hp = mix(x0, x, 0.5 * (uA + uB));
        float rr = length(hp);
        if (rr <= discIn || rr >= discOut) continue;

        /* WHAT A DISC ACTUALLY RADIATES, which is neither uniform nor simply brightest at the inside.
         *
         * Novikov-Thorne: the flux from a steadily accreting disc goes as r^-3 * (1 - sqrt(r_isco/r)). It is
         * ZERO at the inner edge -- material there is already falling rather than orbiting, so it radiates
         * nothing -- rises to a peak about a third of the way out, and falls away hard. THAT ZERO is why every
         * real picture of a black hole has a clean dark gap between the shadow and the first light, and the old
         * build drew that gap by hand with a smoothstep. 17.7 is 1/peak, so the profile arrives normalised. */
        float ix  = discIn / rr;
        float ix3 = ix * ix * ix;
        float band = (rr - discIn) / max(discOut - discIn, 1e-3);
        float emis = (ix3 - ix3 * sqrt(ix)) * 17.7 * smoothstep(1.0, 0.88, band);

        /* KEPLERIAN, NOT RIGID, and it is the difference between a disc and a painted ring. Angular rate goes
           as r^-3/2, so the inner edge laps the outer one many times over. It also drifts inward, because
           material in a disc is being consumed rather than parked. */
        float kep = pow(max(ix, 0.03), 1.5);
        float pa  = atan(dot(hp, u2), dot(hp, u1)) + turn * kep * 0.5;
        emis *= 0.55 + 0.9 * fbm(vec3(cos(pa), sin(pa), 0.0) * 3.0
                               + vec3(0.0, 0.0, rr * 1.6 + turn * 0.12), 3);

        /* ONE g-FACTOR, TWO EFFECTS, AND THAT IS WHY THERE IS NO REDSHIFT SLIDER.
         *
         * What reaches the eye is the emitted brightness times g^3, where g is the ratio of received to
         * emitted frequency -- and g is the ORBITAL Doppler factor times the GRAVITATIONAL one, sqrt(1 - Rs/r).
         * They are two halves of one number: DOPPLER only scales how far the orbital half is pushed, and the
         * gravitational half is a fact about where the light was emitted, so it is not a control at all.
         *
         * BETA COMES FROM THE ORBIT, NOT A SLIDER: circular orbital speed is sqrt(Rs/2r), so the inner edge
         * runs near half light speed and the outer one crawls -- the same r^-1/2 the pattern turns at, so the
         * beaming and the turning cannot disagree about how fast the gas is going. Cubed, a beta of about a
         * third already makes the approaching limb several times the receding one, and the receding side
         * genuinely goes dark rather than merely dimmer.
         *
         * SPIN CARRIES THE DIRECTION, so stopping it stops the beaming. A disc going nowhere with one limb
         * still lit was the giveaway that beta and its sign were coming from different places.
         *
         * THE SAME g SLIDES THE COLOUR toward the cool end, because a redshift is a redshift. One number,
         * two effects, and no second control to disagree with the first. */
        vec3  vel  = normalize(cross(nrm, hp)) * clamp(uDiscSpin / 0.4, -1.0, 1.0);
        float beta = clamp(sqrt(rs / max(2.0 * rr, 1e-4)), 0.0, 0.85);
        float gam  = inversesqrt(max(1.0 - beta * beta, 1e-4));
        float gdop = 1.0 / max(gam * (1.0 - beta * dot(vel, -normalize(v))), 1e-3);
        float ggrv = sqrt(max(1.0 - rs / rr, 0.0));
        float g    = gdop * ggrv;
        float boost = pow(max(gdop, 1e-3), 3.0 * uDoppler) * ggrv * ggrv * ggrv;

        vec3 tint = mix(uDiscA, uDiscB, clamp(band + (1.0 - clamp(g, 0.0, 1.0)) * 0.7, 0.0, 1.0));
        /* THE PATH IS MEASURED AGAINST A FIXED FRACTION OF THE INNER EDGE, not against the slab's own height.
           Dividing by the height would cancel it straight out and DISC HEIGHT would move nothing, which is the
           exact fault that got the earlier version of the slider deleted. */
        discLit += tint * (emis * boost * passAtt * uDisc * 1.6
                           * length(x - x0) * frac / max(discIn * 0.22, 1e-4));
      }
    }
  }

  /* THE HOLE IS SEEN THROUGH WHATEVER TUNNEL IS IN THE WAY, and that is the whole compositing rule.
   *
   * trans is exactly the fraction of this pixel that still saw past the shells, and the hole and its disc sit
   * at DEPTH or beyond, so trans is what they arrive through. Bend the tube far enough that the wall closes
   * across the far end and the hole goes behind it, which is what a tunnel that bends away should do.
   *
   * THERE IS NO SHADOW MASK ANY MORE, and its absence is the point. The old build multiplied the tunnel by a
   * dark disc, which was wrong twice over: the tunnel lies entirely IN FRONT of the hole, so the hole cannot
   * occlude it, and a ray that reaches the shadow at all got there by leaving through the tunnel's MOUTH
   * without meeting a wall on the way. The shadow is where the geodesic fell in and gathered nothing. It is an
   * absence, not a stencil, and drawing it as a stencil is what bit a black disc out of wall in front of it. */
  col += discLit * trans;

  // The screen radius, for the lens effects that belong to the FRAME rather than to the tunnel.
  float r = length(uv);
  /* CHROMA AND VIGNETTE ARE FIXED AT THE STRENGTH THEY SHIPPED AT. They were sliders that nothing ever moved
   * off 1.0, and a control that only has one useful value is a number two places can disagree about. Inlined,
   * so the picture is unchanged and there is one description of it. */
  float ca = 0.18 * r;
  col.r *= 1.0 + ca;
  col.b *= 1.0 - 0.6 * ca;
  col *= smoothstep(1.45, 0.1, r);
  col *= uExposure;
  col = col / (col + 1.0);
  fragColor = vec4(pow(col, vec3(0.85)), 1.0);
}`;
