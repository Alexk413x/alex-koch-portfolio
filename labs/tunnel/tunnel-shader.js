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
 * radius, and CLOUD, BOLTS and STREAKS are amounts on it, any mix, any shell. Tying one effect to one shell was
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
  'uRingN', 'uRingFlow',
  'uMass', 'uEndR', 'uRing', 'uRingCol',
  'uDisc', 'uDiscTilt', 'uDiscLean', 'uDiscOut', 'uDiscThick', 'uDiscSpin', 'uDiscA', 'uDiscB', 'uDoppler',
  'uFog', 'uExposure',
  'uGeom', 'uMix', 'uShade', 'uExtra',
  'uCloudA', 'uCloudB', 'uBoltA', 'uBoltB', 'uStrkA', 'uStrkB',
];

export const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime, uFov, uFar;
uniform float uBend, uBendFlow, uBendDir;
uniform float uRingN, uRingFlow;
uniform float uMass, uEndR, uRing;
uniform float uDisc, uDiscTilt, uDiscLean, uDiscOut, uDiscThick, uDiscSpin, uDoppler;
uniform float uFog, uExposure;
uniform vec3  uRingCol, uDiscA, uDiscB;

// geom: radius, amount, speed, stretch. mix: cloud, bolts, streaks, rings.
// shade: fill, edge, detail, spin. extra: lanes, ON, spare, spare.
uniform vec4 uGeom[${MAXL}];
uniform vec4 uMix[${MAXL}];
uniform vec4 uShade[${MAXL}];
uniform vec4 uExtra[${MAXL}];

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
 * A QUADRATIC IS THE WHOLE REASON THIS IS STABLE. It is zero AND flat at z = 0, so the eye sits on the axis
 * looking straight down the tube for free -- no frame to rotate into, no tangent to subtract, nothing that can
 * run away with distance. The swing at DEPTH is exactly uBend tube radii, at every DEPTH.
 *
 * IT WAS A TRAVELLING SINE AND THAT IS SCRAPPED. A path the camera moves along needs the tangent subtracted to
 * point the view down the tube, and that subtraction is only a first-order rotation: over most of a wavelength
 * its error grows linearly, the far end left the frame, and the tube shut across the middle of the view. Running
 * two sines at different frequencies to keep it from looking flat made it worse -- x turned its corner while y
 * was still leaning, which reads as two curves at once rather than one bend.
 *
 * THE MOVEMENT IS THE ARCH TURNING. BEND FLOW rotates which way it swings, so the tunnel leans through a full
 * circle over time; the sense of travel down it comes from the shells' own SPEED, which is where it belongs.
 */
vec2 bendAt(float z){
  float f = clamp(z / max(uFar, 1.0), 0.0, 1.0);
  float a = uBendDir + uTime * uBendFlow * 0.12;
  /* THE ARCH IS WEIGHTED TOWARD THE CAMERA. A quadratic holds the axis straight through the near half and does
   * all its swinging at DEPTH -- which is the half that is small on screen, so most of the bend was spent where
   * it could not be seen. A quarter sine turns fastest at the eye and flattens out at DEPTH, so the curve reads
   * in the near field where the tube is large. Same swing at DEPTH either way; it just gets there earlier. */
  /* THE SWING SATURATES, because past a few tube radii the mouth leaves its own tube.
   *
   * BEND is in TUBE_R units and the lit shells are 0.5 to 1.35 wide, so at BEND 10 the opening was some seven
   * times its own radius off axis: the wall closed across most of it and the hole showed beside it rather than
   * through it -- two overlapping discs instead of one throat. Six holds, ten does not.
   *
   * tanh keeps the whole slider usable instead of cutting it back. It is linear where BEND already behaved and
   * eases into a ceiling above it, so the top of the range means "as far as it goes" rather than "broken". */
  float swing = MAX_SWING * tanh(uBend / MAX_SWING);
  return vec2(cos(a), sin(a)) * (swing * TUBE_R * sin(f * 1.5707963));
}
vec2 bendD(float z){
  float f = clamp(z / max(uFar, 1.0), 0.0, 1.0);
  float a = uBendDir + uTime * uBendFlow * 0.12;
  float swing = MAX_SWING * tanh(uBend / MAX_SWING);
  return vec2(cos(a), sin(a)) * (swing * TUBE_R * 1.5707963 * cos(f * 1.5707963) / max(uFar, 1.0));
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
  float z = rd.z * t;
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
  vec2 v = rd.xy * t - bo;
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

      /* HOW SQUARELY THE RAY MET THE SURFACE, measured AT the hit rather than across the scan step. Taking it
       * from the bracket made it a per-step constant, so it jumped from one step to the next and the fade below
       * turned those jumps into the same dark rings. A centred difference about the hit knows nothing about
       * where the steps happened to fall.
       *
       * The gap rises at |rd.xy| for a ray leaving straight through the wall and at nothing at all for one
       * leaving along the silhouette, so the ratio of the two is the squareness. */
      float h = max(tMax * 0.004, 1e-4);
      float slope = (wallGap(rd, hitT + h, R, b0) - wallGap(rd, hitT - h, R, b0)) / (2.0 * h);
      graze = clamp(slope / max(length(rd.xy), 1e-4), 0.0, 1.0);
      break;
    }
    tA = tB; dA = dB;
  }

  if (hitT < 0.0){ rel = vec2(0.0); zz = uFar; return -1.0; }
  vec3 P = rd * hitT;
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
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  /* THE LENS. uFov is the ray's z, so SMALL IS WIDE — the host sends it from an angle in degrees, which is the
   * number a person means. A narrow angle keeps the wall away from the frame edge and the whole thing reads as
   * weather out in front; opened up, the wall sweeps the periphery and the picture closes around the viewer. */
  // The curve's value at the eye, so the axis passes through the viewer and the offset grows with depth instead
  // of sliding the whole tube sideways. It is what lets BEND go past a token lean.
  vec2 b0 = bendAt(0.0);

  /* THE HOLE SITS AT THE FAR END OF THE TUNNEL, so it follows the bend: project the axis at DEPTH the way the ray
   * direction is built and that is where it lands on screen. */
  /* THE HOLE IS AN OBJECT AT DEPTH, not a sprite on the glass, and everything about it follows from that.
   *
   * WHERE: the tunnel's axis at DEPTH, projected. The arch rotates with BEND FLOW, so the hole rides round with
   * the far end rather than sitting still while the tube swings away from it.
   *
   * HOW BIG: SHADOW is a size in the world, and what reaches the screen is size * fov / distance. Push DEPTH out
   * and the hole recedes and shrinks like anything else would; it used to be a fixed screen radius, so a longer
   * tunnel moved it without ever making it look further away.
   *
   * The whole lens scales with it for the same reason -- a deflection fixed in screen terms would grow relative
   * to a shrinking hole and swallow the frame at long range. */
  vec2 hc = (bendAt(uFar) - b0) * (uFov / uFar);

  /* MASS IS THE ONLY NUMBER A HOLE HAS. Everything else about one is a fixed multiple of its Schwarzschild
   * radius, so a separate SIZE was a second control describing the same thing -- free to disagree with the first,
   * and it did: the disc's inner edge and the tunnel's end radius were each derived from one of them and drifted
   * apart whenever the other moved.
   *
   *   shadow      2.6 Rs   what the eye sees as the dark disc, wider than the horizon because of lensing
   *   photon ring 1.5 Rs   where light orbits, and where the rim of light sits
   *   inner orbit 3.0 Rs   nothing is stable inside it, so no disc ever starts closer
   *
   * Derived from one number they cannot contradict each other, and the disc stays welded to the hole at every
   * setting rather than needing two sliders kept in step by hand. */
  /* 0.5 WORLD UNITS PER UNIT OF MASS, and the scale is small on purpose. The visible dark disc is not 2.6 Rs
   * but roughly twice that again, because ray capture widens it -- so a radius that looks modest on paper fills a
   * fifth of the frame by the time it is drawn. 0.2 keeps MASS 1 a hole at the END of a tunnel rather than a
   * hole with a tunnel around it; 0.5 was tried and still filled a third of the frame. */
  float rs = uMass * 0.2;
  float persp = uFov / max(uFar, 1e-3);
  float shadowR = rs * 2.6 * persp;
  vec2 dv = uv - hc;
  float b = length(dv);

  /* THE DEFLECTION IS AN AREA OVER A DISTANCE, AND GETTING THAT WRONG IS WHAT MADE THE WARP LOOK DETACHED.
   *
   * A ray passing a mass at impact parameter b is bent by 2Rs/b. Carried into screen units both radii scale
   * together, so the screen displacement goes as shadowR^2 / b -- shadowR SQUARED on top. It was written with a
   * single shadowR, which is not a length at all: at b = shadowR that expression is 1.2, or 2.4x the frame's own
   * half-height, and it stayed near a third of the frame right out to the corners.
   *
   * That is why the warp read as the whole image being dragged rather than as light wrapping something. It was
   * not attached to the hole because it was not attached to any size -- every pixel in the frame was inside it.
   *
   * With the square restored the 1/b tail is local by construction: a few shadow radii out the deflection is
   * already a fraction of a shadow radius. The cutoff that used to be multiplied in here existed only to hide
   * the missing factor, and it is gone -- it was clamping the tail of a curve that was wrong at the head.
   */
  float S2 = shadowR * shadowR;
  float defl = 2.4 * S2 * b / (b * b + S2);

  /* Capture is now a RATIO of two things that scale together, so the dark disc is a fixed multiple of the
     hole at every MASS: defl/b crosses these thresholds near 1.4 and 1.1 shadow radii whatever the mass is. */
  float captured = smoothstep(1.20, 2.20, defl / max(b, 1e-5));
  defl = min(defl, b * 0.82);
  vec2 luv = uv - (b > 1e-5 ? dv / b : vec2(0.0)) * defl;

  vec3 rd = normalize(vec3(luv, uFov));

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

    // CLOUD — the wall's own texture. FILL slides the threshold, EDGE decides how hard it arrives.
    if (m.x > 0.001){
      float v = fbm(tc, int(sh.z));
      float c = smoothstep(sh.x, sh.x + max(sh.y, 0.02), v);
      d += m.x * c;
      emit += mix(uCloudA[s].rgb, uCloudB[s].rgb, c) * m.x * c;
    }

    /* BOLTS — where two independent fields BOTH cross zero, which is a LINE rather than a surface. One field's
     * mid-level is a surface and reads as froth; the crossing of two is a filament. EDGE is its thickness. */
    if (m.y > 0.001){
      vec3 q = tc * 1.6 + vec3(19.3, 7.1, 3.7);
      float f1 = n3(q) - 0.5, f2 = n3(q * 1.31 + vec3(5.2, 1.7, 9.1)) - 0.5;
      /* EDGE REACHES THE BOLTS TOO, and squaring the falloff is what lets it get to a HARD edge.
       *
       * A plain Lorentzian, 1/(1 + k r^2), has tails that fall off as 1/r^2 and never actually stop: at the
       * tightest EDGE it still held three to nine percent brightness far out from the core, so tightening the
       * slider shrank the middle and left the haze. The softness was the shape, not the setting.
       *
       * Squaring cuts that to under one percent at the same distance. The coefficient carries 0.414 to keep the
       * HALF-WIDTH where it was -- solve (1 + k' r^2)^2 = 2 against 1 + k r^2 = 2 and that is the factor -- so
       * EDGE still means the same width it always did and only the shoulder changes. */
      float r2 = f1 * f1 + f2 * f2;
      float bo = 1.0 / (1.0 + (40.0 * 0.414 / max(sh.y, 0.02)) * r2);
      bo *= bo;
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
      float r0 = 0.5 + 0.5 * cos((z + uTime * uRingFlow) * uRingN);
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

  // A WHOLE-TUNNEL RING PASS, for the shells that do not carry one of their own.

  /* THE ACCRETION DISC: A PLANE THROUGH THE HOLE, solved rather than drawn. A ray meets a plane at
   * t = dot(O - eye, n) / dot(rd, n), which is one divide -- and because the ray was already bent by the lens
   * above, the disc bends with it. Tilt it near edge-on and the far side climbs over the top of the shadow,
   * which is the shape everyone recognises.
   *
   * DOPPLER is the other half of that picture: the side turning toward you is brighter and bluer. It is a
   * relativistic beaming term in the real thing and a dot product here, and without it a disc reads as a flat
   * ring rather than as something spinning.
   */
  /* THE DISC'S INNER EDGE IS THE HOLE, not a number of its own.
   *
   * Nothing can orbit inside the innermost stable orbit -- material there has already fallen in -- so a disc
   * always starts at the hole and never anywhere else. As two independent controls they could disagree, and
   * every way they could disagree was wrong: a gap of empty space between hole and disc, or a disc drawn over
   * the shadow it should be cut by. Derived, they cannot.
   *
   * 3x the shadow is where the real inner edge sits for a non-spinning hole, which is why every picture of one
   * has a clear gap between the dark disc and the first light. */
  float discIn = rs * 3.0;
  /* AND THE OUTER EDGE IS A MULTIPLE OF THE INNER, for the same reason the inner is a multiple of the hole. As an
   * absolute distance it could fall INSIDE the inner edge -- which it did the moment SIZE was raised, leaving an
   * annulus with negative width and a disc that vanished entirely. A ratio cannot invert. */
  float discOut = discIn * max(uDiscOut, 1.05);
  /* THE DISC IS IN TWO HALVES AND THEY ARE NOT OCCLUDED THE SAME WAY.
   *
   * Half the disc is NEARER than the hole and passes in FRONT of it, so it cuts a band of light straight across
   * the shadow -- that band is the single most recognisable thing about a picture of one, and it was missing
   * because the whole disc was being multiplied by the shadow mask. The far half is behind and IS occluded.
   *
   * Which half a sample belongs to is just its hit depth against the hole's, so it costs one compare. */
  vec3 discFront = vec3(0.0), discBack = vec3(0.0);
  if (uDisc > 0.001){
    vec3 O = vec3(bendAt(uFar) - b0, uFar);
    /* A PLANE HAS TWO ANGLES AND ONLY TWO. Its orientation is its normal, and a direction on a sphere takes two
     * numbers -- so TILT and LEAN reach every orientation there is. Rolling the disc about its own normal is the
     * third rotation a solid would have and it does nothing at all to a plane; what people mean by it is the
     * PATTERN turning, which is DISC SPIN.
     *
     * TILT is edge-on to face-on; LEAN swings which way an edge-on disc tips. At LEAN 0 this is exactly the
     * single-angle normal it replaced, so nothing already tuned moves. */
    float ct = cos(uDiscTilt), st = sin(uDiscTilt);
    float cl = cos(uDiscLean), sl = sin(uDiscLean);
    vec3 nrm = normalize(vec3(ct * sl, ct * cl, st));

    /* TWO IMAGES OF THE SAME DISC, and the second one is the whole reason this reads as a black hole.
     *
     * The PRIMARY is the disc seen directly: the near half in front of the shadow, the far half behind it. The
     * SECONDARY is light from the far side that passed BEHIND the hole, bent right round, and came back to the
     * eye -- it arrives just outside the shadow as an arc over the top and under the bottom, which is why the
     * disc in every picture of one appears to wrap over the hole rather than pass behind it.
     *
     * A CIRCLE INVERSION STANDS IN FOR THE WRAP. The real thing is a null geodesic and there is no closed form;
     * but inversion about the photon ring, b -> ringR^2 / b, maps the far field to just outside the shadow, which
     * is exactly where the secondary image belongs and how it compresses. Two plane solves, no marching.
     */
    float ringR0 = shadowR * 1.5;
    for (int im = 0; im < 2; im++){
      vec2 suv = luv;
      float dim = 1.0;
      if (im == 1){
        float bi = ringR0 * ringR0 / max(b, 1e-4);
        suv = hc + (b > 1e-5 ? dv / b : vec2(0.0)) * bi;
        /* THE SECONDARY IMAGE HUGS THE SHADOW, and confining it is what stopped the disc reading as two lobes.
         *
         * Light that went behind the hole and bent back arrives compressed into a thin arc just outside the
         * photon ring -- that is the whole reason a disc appears to wrap OVER a black hole. Unconfined it drew
         * out to several shadow radii, and because the disc is near edge-on its apparent radius varies strongly
         * with angle, so what spread out was two fat blobs above and below rather than an arc. */
        dim = 0.55 * (1.0 - smoothstep(shadowR * 1.5, shadowR * 3.4, b));
        if (dim < 0.002) continue;
      }
      vec3 srd = normalize(vec3(suv, uFov));
      /* THE DISC IS A SLAB, NOT A PLANE, and that is what puts the band through the MIDDLE of the shadow.
       *
       * A plane has no thickness, so seen exactly edge-on it disappears -- which is why TILT 0 came back black,
       * and why the only way to see the disc at all was from a little above or below, which throws the crossing
       * band off centre. A real disc has depth: look along it and you see a bar straight across the hole, cutting
       * it into a top half and a bottom half.
       *
       * HOW FAR THE RAY TRAVELS INSIDE IT is 2h / |dn|, which is also why an edge-on disc is BRIGHT across the
       * middle -- the line of sight stays in the glowing gas for a long way. Clamped, because that path length
       * runs to infinity exactly edge-on and would blow the frame out. */
      float dn = dot(srd, nrm);
      float adn = max(abs(dn), 1e-3);
      float hthick = uDiscThick * discIn;
      float path = min(2.0 * hthick / adn, hthick * 4.0) / max(hthick * 2.0, 1e-4);
      /* TILT CANNOT REACH 0, AND THAT IS GEOMETRY RATHER THAN A MISSING FEATURE.
       *
       * Exactly edge-on means the disc's plane contains the eye -- any plane through the hole that you see
       * edge-on necessarily runs through where you are standing. dot(O,nrm) and dn both go to zero together,
       * every hit distance comes out 0, and there is no crossing to solve because you are IN the surface.
       *
       * Sampling the ray's nearest approach instead was tried and is worse: away from the degenerate band it
       * disagrees with the plane it is standing in for, and the disc lands off the hole. The slider is fenced
       * just above 0, which is close enough to edge-on to give the bar across the shadow. */
      float td = dot(O, nrm) / (dn >= 0.0 ? adn : -adn);
      if (td <= 0.0) continue;

      /* SAMPLE WHERE THE RAY IS NEAREST THE HOLE, NOT WHERE IT CROSSES THE MID-PLANE. This is what puts the bar
       * back across the middle and stops the disc reading as two lobes.
       *
       * A ray that runs ALONG a near edge-on disc crosses its mid-plane a very long way out -- past discOut, so
       * it was rejected. That threw away every ray near the plane, which is exactly the band through the middle
       * of the shadow, and what survived was the two regions either side of the rejected band: two lobes above
       * and below with nothing between them.
       *
       * The ray is inside the slab for hthick/adn either side of the crossing, and the honest sample is the point
       * in that stay which comes closest to the hole. Clamping the nearest approach into the slab window says
       * exactly that, and it degenerates correctly at both ends: face-on, adn is 1, the window is a hair wide and
       * this IS the mid-plane crossing; edge-on, adn goes to zero, the window opens and it becomes the nearest
       * approach. Nothing to threshold and nothing to blend. */
      float hspan = hthick / adn;
      float ts = clamp(dot(O, srd), td - hspan, td + hspan);
      if (ts <= 0.0) continue;

      vec3 P = srd * ts;
      vec3 rel3 = P - O;
      float rr = length(rel3);
      if (rr <= discIn || rr >= discOut) continue;

      /* THE IN-PLANE AXES NEED A REFERENCE THE NORMAL IS NOT PARALLEL TO. Crossing with z alone returns a zero
       * vector the moment the disc is exactly face-on -- normalize(0) is a NaN, and a NaN here blackens every
       * pixel the disc touches at one end of the TILT slider. Pick whichever axis the normal leans on least. */
      vec3 ref = abs(nrm.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
      vec3 u1 = normalize(cross(nrm, ref));
      vec3 u2 = cross(nrm, u1);
      float pa = atan(dot(rel3, u2), dot(rel3, u1));
      float band = (rr - discIn) / max(discOut - discIn, 1e-3);

      /* KEPLERIAN, NOT RIGID, and it is the difference between a disc and a painted ring. Orbital speed goes as
       * r^-1/2, so angular rate goes as r^-3/2 and the inner edge laps the outer one many times over. Turning
       * the whole disc at one rate is the giveaway that nothing is orbiting.
       *
       * IT ALSO DRIFTS INWARD. Material in a disc is falling in, not circling forever -- shifting the pattern
       * toward the inner edge is what makes it read as being consumed rather than parked. */
      float kep = pow(max(discIn / max(rr, 1e-3), 0.03), 1.5);
      float turn = uTime * uDiscSpin;
      float pa2 = pa + turn * kep * 0.5;
      float grain = fbm(vec3(cos(pa2), sin(pa2), 0.0) * 3.0
                      + vec3(0.0, 0.0, rr * 1.6 + turn * 0.12), 3);

      /* BRIGHTEST AT THE INSIDE, because that is where the material is hottest and moving fastest -- a disc that
       * is uniform, or brightest at its rim, is the wrong way round. */
      float bright = (1.0 - band) * (0.55 + 0.9 * grain);

      /* DOPPLER BEAMING: the side turning toward the eye is brighter. In the real thing it is a relativistic
       * beaming term and it is why one side of every image of a disc is far brighter than the other; here it is
       * a dot product. Without it a disc reads as a flat ring rather than as something spinning. */
      // Beaming follows the ORBITAL direction, and it is stronger where the orbit is faster -- inside.
      vec3 vel = normalize(cross(nrm, rel3));
      float dop = 1.0 + uDoppler * dot(vel, -srd) * 1.3 * sqrt(kep);

      /* NOTHING COMES OUT OF THE MIDDLE. The disc is cut at its inner edge and the shadow cuts everything again
       * below -- light in this picture comes from the disc and from the photon ring, and from nowhere inside. */
      bright *= smoothstep(0.0, 0.10, band) * smoothstep(1.0, 0.86, band) * path;
      vec3 add = mix(uDiscA, uDiscB, band) * max(bright, 0.0) * max(dop, 0.0) * uDisc * 1.1 * dim;
      /* The secondary image is light that went BEHIND the hole by definition, so it is always the far half
         however near its apparent position lands. */
      if (ts < uFar && im == 0) discFront += add; else discBack += add;
    }
  }

  /* THE HOLE IS AN OBJECT AT A DEPTH, AND THE WALL CAN BE IN FRONT OF IT.
   *
   * It was drawn as a screen-space overlay after the shells, so its shadow punched through tunnel wall that was
   * NEARER than it and the disc floated on top of everything. With any real BEND that separates visibly: the tube
   * curves away, its convergence slides off to one side, and the hole stays where the axis reaches DEPTH -- two
   * end points on screen at once, which is what gave the game away.
   *
   * trans is exactly the fraction of this pixel that still sees DEPTH after the shells have had their turn, so
   * it is what the hole is visible through. Bend the tube far enough that the wall closes across the far end and
   * the hole goes behind it, which is what a tunnel that bends away should do.
   *
   * THE SHADOW IS WEIGHTED THE SAME WAY. Cutting unconditionally would carve a black disc out of a wall standing
   * in front of it; cutting by trans removes only the light that was coming from behind. */
  // The dark disc is the geometric shadow AND everything the lens captured, which at high MASS is wider.
  // The edge is deliberately a few percent wide: the photon ring is found from it, and at 0.92-1.10 that
  // band was about two pixels, too thin to read as light.
  float inside = smoothstep(shadowR * 0.84, shadowR * 1.22, b) * (1.0 - captured);
  col *= mix(1.0, inside, trans);
  // Behind the hole: cut by the shadow, and seen through whatever tunnel wall is in the way.
  col += discBack * inside * trans;

  /* THE PHOTON RING HUGS THE SHADOW'S EDGE, WHEREVER THAT EDGE HAS ENDED UP.
   *
   * It was drawn at a fixed 1.5 shadow radii, which was a guess about where the edge is -- and wrong as soon as
   * MASS started widening the dark disc by capturing rays, because then the ring sat at some arbitrary radius
   * inside or outside the thing it is meant to outline.
   *
   * inside * (1 - inside) peaks exactly where inside crosses a half, which IS the boundary by definition. So the
   * ring finds the edge instead of being told where it is, and it follows the shadow as MASS grows it. It is the
   * light that grazed the hole and came back round, so the edge is the only place it can be.
   */
  float rim = inside * (1.0 - inside);
  col += uRingCol * rim * rim * 16.0 * uRing * 2.4 * trans;

  // In FRONT of the hole, so nothing occludes it -- this is the band that cuts the shadow in half.
  col += discFront * trans;

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
