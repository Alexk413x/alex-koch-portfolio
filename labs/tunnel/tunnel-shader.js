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
  'uRes', 'uTime', 'uFov', 'uFar', 'uWind', 'uFlow',
  'uBend', 'uBendFlow', 'uBendDir',
  'uRingAmt', 'uRingN', 'uRingFlow',
  'uMass', 'uShadow', 'uEndR', 'uRing', 'uRingCol',
  'uDisc', 'uDiscTilt', 'uDiscLean', 'uDiscIn', 'uDiscOut', 'uDiscSpin', 'uDiscA', 'uDiscB', 'uDoppler',
  'uFog', 'uExposure', 'uVignette', 'uChroma',
  'uGeom', 'uMix', 'uShade', 'uExtra',
  'uCloudA', 'uCloudB', 'uBoltA', 'uBoltB', 'uStrkA', 'uStrkB',
];

export const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime, uFov, uFar, uWind, uFlow;
uniform float uBend, uBendFlow, uBendDir;
uniform float uRingAmt, uRingN, uRingFlow;
uniform float uMass, uShadow, uEndR, uRing;
uniform float uDisc, uDiscTilt, uDiscLean, uDiscIn, uDiscOut, uDiscSpin, uDoppler;
uniform float uFog, uExposure, uVignette, uChroma;
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

/* ONE ARCH THROUGH THE TUNNEL, AND ITS DIRECTION TURNS.
 *
 * It was a sine, and a sine is the wrong shape: every half cycle swings the axis back the other way, and each
 * swing gives the eye another place the tube appears to end. Several apparent vanishing points at once is what
 * reads as "multiple lenses" -- not lensing at all, just a tube that changes its mind repeatedly.
 *
 * An arch changes its mind once. The offset grows with the SQUARE of the distance, which is what constant
 * curvature gives, and it is zero at the eye -- so the mouth the viewer sits in stays put and the far end is what
 * swings away. One curve, one end.
 *
 * BEND FLOW ROTATES THE ARCH rather than sliding it. Sliding a fixed shape past the camera is what the sine was
 * doing; turning it sweeps the far end around the throat while the mouth does not move at all, which is exactly
 * what the home page's lab card does with its slow rotateZ. DIRECTION is where the arch points when time is zero.
 */
vec2 arch(float z, out vec2 slope){
  float f = z / max(uFar, 1.0);
  float a = uBendDir + uTime * uBendFlow * uFlow * 0.12;
  vec2 dir = vec2(cos(a), sin(a));

  /* THE ARCH CARRIES THE FAR END OFF THE AXIS, AND THE HOLE RIDES WITH IT.
   *
   * The offset is NOT eased toward a limit. It was, and that was wrong: easing it capped the far end at about two
   * units, which is a twentieth of the frame, so the hole sat in the middle however hard BEND was pushed. The
   * whole point of bending is that the far end goes somewhere.
   *
   * IT IS MEASURED IN TUBE RADII: BEND 1 carries the far end one radius off the axis, 3 carries it three. Past
   * about one radius the wall starts closing across the view -- which is correct and is what a bent pipe does,
   * you cannot see down one -- and the hole is occluded by it rather than hidden by a clamp. Both things happen
   * at once: it moves out, and it goes behind the wall.
   */
  float amp = uBend * TUBE_R * 2.0;
  slope = dir * amp * 2.0 * f / max(uFar, 1.0);
  return dir * amp * f * f;
}

vec2 bendAt(float z){ vec2 sl; return arch(z, sl); }
vec2 bendD(float z){ vec2 sl; arch(z, sl); return sl; }

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
float solveShell(vec3 rd, float R, vec2 b0, out vec2 rel, out float zz, out float graze){
  float A = dot(rd.xy, rd.xy);
  float t = R / max(sqrt(A), 1e-4);
  float Rc = R;
  graze = 1.0;
  for (int i = 0; i < 5; i++){
    float z = rd.z * t;
    vec2 bo = bendAt(z) - b0;
    vec2 sl = bendD(z);
    float k = sqrt(1.0 + dot(sl, sl));

    /* THE SHELLS CONVERGE ON ONE POINT, and this is what stops there being six tunnels.
     *
     * A shell of constant radius subtends R * fov / DEPTH at the far end -- a DIFFERENT angle for every radius --
     * so six shells drew six circles out there, six apparent vanishing points stacked in a line, each one looking
     * like another warp. Real convergence only happens at infinity and DEPTH is finite.
     *
     * So the tube TAPERS: full radius at the eye, closing to one shared end radius at DEPTH. Every shell then
     * meets at the same place and there is one throat. The taper is squared, so the shells hold their own radii
     * through the near half where they pass the camera -- which is where a shell's size is the thing you actually
     * see -- and only draw together in the far half where they would otherwise disagree.
     *
     * THE END RADIUS IS THE HOLE'S when there is one, so the tunnel arrives exactly at it rather than near it. */
    float taper = clamp(z / max(uFar, 1.0), 0.0, 1.0);
    /* A SHELL ONLY EVER NARROWS. The end radius is the hole's, and the hole can be set larger than a shell --
     * mixing toward it then makes that shell FLARE OUTWARD toward the far end, so the tube gets wider as it
     * recedes and the near shells swallow the far ones. Clamping the target below the shell's own radius keeps
     * every taper a taper. */
    /* ONE END RADIUS FOR EVERY SHELL, and it is the host that works it out -- see uEndR there. Taking
     * min(uEndR, R * 0.9) HERE instead was the bug: every shell's radius is under the hole's size, so the min
     * always chose that shell's own radius and each one tapered to a different end. Three different ends cannot
     * line up with each other or with the hole, which is what put the shells out of alignment with it. */
    Rc = mix(R, uEndR, taper * taper);

    /* THE SECTION IS AN ELLIPSE, AND ONLY ALONG THE LEAN. This is the difference between a tube that SWEEPS and
     * one that merely slides sideways.
     *
     * A swept tube's sections are round when cut perpendicular to its own tangent. Seen from a camera that cuts
     * across the VIEW instead, such a section is foreshortened: stretched by 1/cos of the lean along the
     * direction the tube is leaning, and untouched at right angles to it. Stretching it in every direction --
     * which is what a single scalar radius does -- makes the tube FAT wherever it turns instead of tilting it,
     * and a fat tube that slides across as it recedes is exactly the warp rather than a curve.
     *
     * It is the same construction the home page's lab card uses for its rings: each is translated onto the path
     * AND rotated to face along it. Placing without rotating is what this was doing. */
    vec2 v = rd.xy * t - bo;
    float vl = length(v);
    vec2 dir = vl > 1e-5 ? v / vl : vec2(1.0, 0.0);
    vec2 lean = dot(sl, sl) > 1e-10 ? normalize(sl) : vec2(1.0, 0.0);
    float Rz = Rc * mix(1.0, k, abs(dot(dir, lean)));

    float B = -2.0 * dot(rd.xy, bo), C = dot(bo, bo) - Rz * Rz;
    float disc = B * B - 4.0 * A * C;
    if (disc <= 0.0) { graze = 0.0; break; }
    /* HOW SQUARELY THE RAY MET THE SURFACE. The discriminant of this quadratic goes to zero where the ray is
     * TANGENT to the shell -- the silhouette. Since the shells taper they are cones, and a cone has a hard rim
     * where it turns away; six shells drew six hard circles that swung about with the bend. Reported so the
     * caller can fade each shell out as it turns edge-on, which is what a wall of gas would do anyway. */
    graze = sqrt(disc) / max(2.0 * A * Rc, 1e-5);
    t = (-B + sqrt(disc)) / (2.0 * A);
  }
  /* THE HIT IS NOT CLAMPED. min(t, DEPTH) does not shorten the tube, it PINS the surface flat at that depth --
   * every ray that ran past the cutoff froze at the same place, and the far end became one hard disc of frozen,
   * warped coordinates with all of the bend's effect collected in it. The tube simply continues and DEPTH fades
   * it out instead: same cutoff, no cut edge. */
  vec3 P = rd * t;
  rel = P.xy - (bendAt(P.z) - b0);
  zz = P.z;
  return t;
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
  float slot = (ang + TAU) / TAU * count;
  float lane = floor(slot);
  lr = h31(vec3(lane, 3.7, 1.9));
  float head = fract(lr * 7.3 - uTime * speed * uFlow * (0.06 + lr * 0.11));
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
  float persp = uFov / max(uFar, 1e-3);
  float shadowR = uShadow * persp;
  vec2 dv = uv - hc;
  float b = length(dv);

  /* GRAVITATIONAL LENSING, AND IT IS ONE LINE BECAUSE NOTHING IS MARCHED. Light passing a mass at impact
   * parameter b is deflected by roughly 2Rs/b -- it falls off as 1/b, which is all that is needed for the look.
   * Pulling the SAMPLING POINT toward the hole is the same thing seen from the other end: the image behind is
   * dragged inward and wraps around the shadow.
   *
   * IT IS APPLIED TO uv BEFORE THE RAY EXISTS, so every shell, every streak and the disc below are all warped by
   * it together rather than each needing to know. A marched build would have to bend the ray at every step. */
  /* THE DEFLECTION IS ZERO AT THE CENTRE, PEAKS AT THE PHOTON RING, AND FALLS OFF BEYOND.
   *
   * It used to be k/max(b, r/2), and that max() is the bug you can see on screen: inside half a radius every
   * pixel got the SAME push, so the whole middle of the frame was displaced bodily instead of converging. The
   * shadow is drawn at the hole's true position while the warp around it sat offset by that constant, and as the
   * arch rotated the two swung apart. The warp did not follow the hole.
   *
   * It was backwards physically too. Light aimed straight at the centre is not deflected sideways -- it falls
   * straight in. What bends hardest is light that GRAZES, at about the photon ring. b / (b^2 + r^2) is zero at
   * the centre, peaks at b = r, and decays as 1/b outside, which is the real 2Rs/b at range.
   *
   * Zero at the centre is also what keeps the shadow and the throat together: the point the hole sits on maps to
   * itself, so nothing can slide out from under it. */
  /* THE LENS IS LOCAL. Deflection falls off as 1/b, which is right, but 1/b still shifts the frame edge by a
   * fifth of the picture at high MASS -- so the whole image was being dragged rather than the region near the
   * hole being wrapped, which reads as the light bending instead of the tube. The extra term cuts it off a few
   * shadow radii out and leaves the tunnel beyond alone. */
  float reach = 1.0 / (1.0 + pow(b / (shadowR * 5.0), 2.0));
  float defl = uMass * 2.6 * shadowR * b / (b * b + shadowR * shadowR) * reach;

  /* A RAY BENT BY MORE THAN ITS OWN IMPACT PARAMETER HAS NOT BEEN DEFLECTED -- IT HAS BEEN CAPTURED.
   *
   * Nothing stopped the deflection exceeding b, so at high MASS the sample point was thrown clean past the centre
   * and out the far side: the image folded through itself and light appeared to bend in directions nothing
   * physical would send it. That is the strange core in the middle at the extreme end of the slider.
   *
   * Those rays are exactly the ones that fall in. So they are not sampled at all -- they are shadow. The captured
   * region grows with MASS, which is right: a heavier hole swallows a wider cone, and the dark disc you see is
   * bigger than the hole itself for that reason. The rest are held short of the centre so the deflection can
   * never fold the image back through itself.
   */
  float captured = smoothstep(0.80, 1.05, defl / max(b, 1e-5));
  defl = min(defl, b * 0.82);
  vec2 luv = uv - (b > 1e-5 ? dv / b : vec2(0.0)) * defl;

  vec3 rd = normalize(vec3(luv, uFov));

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float tRef = uFar;

  for (int s = 0; s < ${MAXL}; s++){
    if (uExtra[s].y < 0.5) continue;

    vec4 g = uGeom[s], m = uMix[s], sh = uShade[s];
    vec2 rel; float z, graze;
    float t = solveShell(rd, max(g.x, 0.02), b0, rel, z, graze);
    // Fades out with distance rather than being cut off at one. Nothing past the fade is worth reading a field for.
    float depth = mix(1.0, 1.0 - smoothstep(2.0, uFar, t), uFog);
    if (t <= 0.0 || depth <= 0.002) continue;
    float ang = atan(rel.y, rel.x) + sh.w * uTime * uFlow;
    if (s == 0) tRef = min(t, uFar);

    /* THE TUNNEL'S OWN COORDINATES: where round the tube, and how far along it. WIND scales the distance the
     * pattern is read at, which is what tightens or unwinds the whorl at the vanishing point — see below. */
    vec3 tc = vec3(cos(ang), sin(ang), 0.0) * 1.9
            + vec3(0.0, 0.0, z * g.w * uWind + uTime * g.z * uFlow * g.w);

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
      float bo = 1.0 / (1.0 + (40.0 / max(sh.y, 0.02)) * (f1 * f1 + f2 * f2));
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
      float r0 = 0.5 + 0.5 * cos((z + uTime * uRingFlow * uFlow) * uRingN);
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
  if (uRingAmt > 0.001){
    float r0 = 0.5 + 0.5 * cos((rd.z * tRef + uTime * uRingFlow * uFlow) * uRingN);
    r0 *= r0; r0 *= r0;
    col *= 1.0 + uRingAmt * 2.2 * r0;
  }

  /* THE ACCRETION DISC: A PLANE THROUGH THE HOLE, solved rather than drawn. A ray meets a plane at
   * t = dot(O - eye, n) / dot(rd, n), which is one divide -- and because the ray was already bent by the lens
   * above, the disc bends with it. Tilt it near edge-on and the far side climbs over the top of the shadow,
   * which is the shape everyone recognises.
   *
   * DOPPLER is the other half of that picture: the side turning toward you is brighter and bluer. It is a
   * relativistic beaming term in the real thing and a dot product here, and without it a disc reads as a flat
   * ring rather than as something spinning.
   */
  vec3 discCol = vec3(0.0);
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
        dim = 0.55;
      }
      vec3 srd = normalize(vec3(suv, uFov));
      float dn = dot(srd, nrm);
      if (abs(dn) < 1e-3) continue;
      float td = dot(O, nrm) / dn;
      if (td <= 0.0) continue;

      vec3 P = srd * td;
      vec3 rel3 = P - O;
      float rr = length(rel3);
      if (rr <= uDiscIn || rr >= uDiscOut) continue;

      /* THE IN-PLANE AXES NEED A REFERENCE THE NORMAL IS NOT PARALLEL TO. Crossing with z alone returns a zero
       * vector the moment the disc is exactly face-on -- normalize(0) is a NaN, and a NaN here blackens every
       * pixel the disc touches at one end of the TILT slider. Pick whichever axis the normal leans on least. */
      vec3 ref = abs(nrm.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
      vec3 u1 = normalize(cross(nrm, ref));
      vec3 u2 = cross(nrm, u1);
      float pa = atan(dot(rel3, u2), dot(rel3, u1));
      float band = (rr - uDiscIn) / max(uDiscOut - uDiscIn, 1e-3);

      /* KEPLERIAN, NOT RIGID, and it is the difference between a disc and a painted ring. Orbital speed goes as
       * r^-1/2, so angular rate goes as r^-3/2 and the inner edge laps the outer one many times over. Turning
       * the whole disc at one rate is the giveaway that nothing is orbiting.
       *
       * IT ALSO DRIFTS INWARD. Material in a disc is falling in, not circling forever -- shifting the pattern
       * toward the inner edge is what makes it read as being consumed rather than parked. */
      float kep = pow(max(uDiscIn / max(rr, 1e-3), 0.03), 1.5);
      float turn = uTime * uDiscSpin * uFlow;
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
      bright *= smoothstep(0.0, 0.10, band) * smoothstep(1.0, 0.86, band);
      discCol += mix(uDiscA, uDiscB, band) * max(bright, 0.0) * max(dop, 0.0) * uDisc * 2.2 * dim;
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
  float inside = smoothstep(shadowR * 0.92, shadowR * 1.10, b) * (1.0 - captured);
  col *= mix(1.0, inside, trans);
  col += discCol * inside * trans;

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

  // The screen radius, for the lens effects that belong to the FRAME rather than to the tunnel.
  float r = length(uv);
  float ca = uChroma * 0.18 * r;
  col.r *= 1.0 + ca;
  col.b *= 1.0 - 0.6 * ca;
  col *= mix(1.0, smoothstep(1.45, 0.1, r), uVignette);
  col *= uExposure;
  col = col / (col + 1.0);
  fragColor = vec4(pow(col, vec3(0.85)), 1.0);
}`;
