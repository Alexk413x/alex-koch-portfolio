/* The wormhole as a volumetric march through a 3D field. Pure source, no GL calls.
 *
 * THE FIELD IS SAMPLED AT THE REAL 3D POINT, which is what makes it a volume. Collapsing the sample position to
 * its angle — the trick a single-sample tunnel shader uses — gives every step down a ray the same lateral
 * coordinate, and the march then smears radially instead of building structure. The tunnel comes from the
 * radial DENSITY PROFILE instead: clear along the axis, filling toward the wall.
 *
 * THE THREE LAYERS ARE MIXED BY DEPTH, NOT STACKED. Every step asks each enabled layer for a density and an
 * emission and composites front-to-back, so a cloud can sit in front of a bolt which sits in front of another
 * cloud. Compositing three finished images could not do that — one would always be on top.
 *
 * EVERY LAYER OWNS ITS OWN FLOW: speed, twist, spin and coverage. Nothing about the motion is shared, and THE
 * CAMERA DOES NOT MOVE AT ALL — each layer slides its own field along z instead. Moving the camera is the obvious
 * way to fly down a tunnel and it forces one speed on everything; sliding the fields is the same motion and it is
 * the only version in which three layers can travel at three rates.
 *
 * Each layer returns `vec2(density, gradient)`; the gradient is what its colour ramp reads, and each defines it
 * differently so the three do not read as one field tinted three ways.
 */
import { NOISE, PALETTE, TUNNEL } from './wormhole-glsl.js';

export const UNIFORMS = [
  'uRes', 'uTime', 'uSteps',
  'uGlow', 'uChroma', 'uVignette', 'uExposure', 'uThroatTint', 'uThroatRays',
  'uCoreCol', 'uCoreAuto', 'uCoreSpin', 'uCorePulse', 'uCorePulseRate', 'uCoreFade', 'uCoreFadeRate',
  'uNebOn', 'uNebCol', 'uNebColB', 'uNebMode', 'uNebHue',
  'uNebDensity', 'uNebFill', 'uNebFluff', 'uNebStreak', 'uNebVar', 'uNebScale', 'uNebOct',
  'uNebSpeed', 'uNebTwist', 'uNebSpin', 'uNebCov',
  'uLsOn', 'uLsCol', 'uLsColB', 'uLsMode', 'uLsHue',
  'uLsDensity', 'uLsCount', 'uLsLen', 'uLsThick', 'uLsVar', 'uLsRadial', 'uLsShells',
  'uLsSpeed', 'uLsTwist', 'uLsSpin', 'uLsCov',
  'uPlOn', 'uPlCol', 'uPlColB', 'uPlMode', 'uPlHue',
  'uPlDensity', 'uPlCrackle', 'uPlCrawl', 'uPlFlash', 'uPlStrike', 'uPlLight',
  'uPlSpeed', 'uPlTwist', 'uPlSpin', 'uPlCov',
];

export const FRAG = `
precision highp float;

uniform vec2 uRes;
uniform float uTime, uSteps;
uniform float uGlow, uChroma, uVignette, uExposure, uThroatTint, uThroatRays;
uniform float uCoreAuto, uCoreSpin, uCorePulse, uCorePulseRate, uCoreFade, uCoreFadeRate;
uniform vec3  uCoreCol;

uniform float uNebOn, uNebMode, uNebHue, uNebDensity, uNebFill, uNebFluff, uNebStreak, uNebVar, uNebScale, uNebOct;
uniform float uNebSpeed, uNebTwist, uNebSpin, uNebCov;
uniform vec3  uNebCol, uNebColB;

uniform float uLsOn, uLsMode, uLsHue, uLsDensity, uLsCount, uLsLen, uLsThick, uLsVar, uLsRadial, uLsShells;
uniform float uLsSpeed, uLsTwist, uLsSpin, uLsCov;
uniform vec3  uLsCol, uLsColB;

uniform float uPlOn, uPlMode, uPlHue, uPlDensity, uPlCrackle, uPlCrawl, uPlFlash, uPlStrike, uPlLight;
uniform float uPlSpeed, uPlTwist, uPlSpin, uPlCov;
uniform vec3  uPlCol, uPlColB;

#define TUBE 1.25
#define FAR 13.0

${NOISE}
${PALETTE}
${TUNNEL}

/* NEBULA — volumetric cloud in the tube's wall.
 *
 * FLUFF is the fbm gain: low leaves the largest octave dominant and it reads as soft billows, high keeps the fine
 * detail and it reads as torn and wispy. STREAK compresses the field's depth axis so billows draw out into lanes
 * along the direction of travel. FILL slides the density threshold — high leaves only the peaks, which is mist;
 * low floods it into thick cover.
 */
vec2 nebula(vec3 p, float sec){
  vec2 xy = spin(p.xy, uNebSpin * sec + uNebTwist * p.z * 0.05);
  float z = p.z + sec * uNebSpeed * 0.55;

  vec3 q = vec3(xy, z * uNebStreak) * (uNebScale * 0.34);
  float w = fbm(q, int(uNebOct), uNebFluff);

  /* VARIANCE AND THE COLOUR BAND ARE TRIGONOMETRIC, NOT NOISE, and that is the single biggest saving in the
   * shader. Both want a term that changes SLOWLY over the tunnel; a noise sample costs eight hashes to deliver
   * that, and three incommensurate sines deliver it for a few multiplies. Two of the nebula's five samples per
   * step were being spent on values that never needed to be random, only unrepeating. */
  float band = sin(z * 0.21) * sin(xy.x * 0.47 + 1.7) * sin(xy.y * 0.39 - 0.6);
  float var = mix(1.0, 1.0 + 0.85 * band, uNebVar);
  float v = w * var;

  float lo = mix(0.80, 0.30, clamp(uNebFill, 0.0, 1.0));
  float dens = smoothstep(lo, lo + 0.26, v);

  // Colour holds over a stretch of tunnel rather than cycling per sample, which is what stops the ramp averaging
  // itself to grey across the march.
  float g = 0.5 + 0.5 * sin(z * 0.11 + band * 1.6);
  return vec2(dens * uNebDensity, g);
}

/* LIGHTSPEED — SOLVED, NOT MARCHED.
 *
 * A streak is a CAPSULE: a segment running parallel to the tunnel axis with a radius, so its ends are round by
 * construction rather than faded by a window function.
 *
 * THE MARCH COULD NOT DRAW THIS, and that is why the layer was rebuilt rather than tuned. A marched ray either
 * lands on a thin line or misses it, so the kernel has to be widened to the sampling rate and then dimmed to
 * conserve energy — measured at 18x too wide and 0.3% of intended brightness at the far end, and still 9x too
 * wide at maximum QUALITY. Distance to a shape has no such floor: the width here is the width asked for, at any
 * step count and any resolution.
 *
 * WHY IT CLOSES: the camera sits ON the axis and the capsules run parallel to it, so a ray's xy direction never
 * changes — in cross-section it sweeps ONE radial line out from the centre. Only streaks near that angle can ever
 * be hit, so bucketing by angle turns "which of two hundred streaks does this pixel see" into three candidates
 * per shell. No traversal, no marching, no step count.
 */

// Ray-to-capsule distance for a segment parallel to z, and the depth it happens at. Exact: the closest approach
// to the infinite line solves directly, and falling outside the segment's span reduces to a ray-to-endpoint
// projection — which is what rounds the caps.
float capsuleDist(vec3 rd, vec2 c, float z1, float z2, out float tHit){
  float tA = dot(rd.xy, c) / max(dot(rd.xy, rd.xy), 1e-6);
  float zA = rd.z * tA;
  float t = tA;
  if (zA < z1)      t = dot(rd, vec3(c, z1));
  else if (zA > z2) t = dot(rd, vec3(c, z2));
  t = max(t, 0.0);
  vec3 P = rd * t;
  tHit = t;
  return length(P - vec3(c, clamp(P.z, z1, z2)));
}

/* Returns the layer's emission in rgb, and through hitT the depth of its nearest contributor — which is what lets
 * a solved layer still be occluded by a marched one. */
vec3 lightspeed(vec3 rd, float sec, out float hitT){
  hitT = FAR;
  vec3 acc = vec3(0.0);

  float slots = max(8.0, floor(uLsCount));
  float aScreen = atan(rd.y, rd.x);
  float k = max(length(rd.xy), 1e-5);

  float inner = (1.0 - clamp(uLsCov, 0.0, 1.0)) * TUBE;
  float shells = max(1.0, floor(uLsShells));
  float halfLen = max(uLsLen, 0.02) * (FAR * 0.5);
  float span = FAR + 2.0 * halfLen;

  for (int s = 0; s < 4; s++){
    if (float(s) >= shells) break;
    float shellF = (float(s) + 0.5) / shells;
    float rr = mix(inner, TUBE, shellF);

    /* ROTATION IS RESOLVED PER SHELL, BEFORE THE BUCKET IS CHOSEN, and it has to be. The bucket is picked from
     * the ray's screen angle, so a capsule rotated AFTER that lands outside the bucket that was searched for it
     * and is never found — which is a black screen, not a subtle error.
     *
     * SPIN is rigid and needs no depth. TWIST does, and this is the approximation: the ray crosses THIS shell at
     * one known radius, so the depth it happens at solves directly (rr * rd.z / k), and the shell is rotated by
     * the twist at exactly that depth. A helix has no closed form, but a capsule only has to be in the right
     * place where the ray actually meets it. */
    float zMeet = clamp(rr * rd.z / k, 0.0, FAR);
    float rot = uLsSpin * sec + uLsTwist * zMeet * 0.05;
    float base = floor((aScreen - rot) / TAU * slots);

    for (int j = 0; j < 3; j++){
      // Wrapped before hashing so the ring CLOSES — the seam at atan's cut would otherwise be one visible lane
      // where slot -n and slot +n disagree about which streak lives there.
      float slot = mod(base + float(j) - 1.0, slots);
      float id = slot + float(s) * 977.0;

      // SPREAD thins the slots that carry a streak at all. Tested first, so a rejected slot costs one hash.
      if (hash11(id * 1.7 + 0.3) > mix(0.25, 1.0, uLsRadial)) continue;

      float rAng = hash11(id * 3.1 + 5.7);
      float rRad = hash11(id * 7.3 + 11.1);
      float rPhase = hash11(id * 2.9 + 19.3);
      float rBright = hash11(id * 5.3 + 23.7);

      // Back into world space by the same rotation the bucket was chosen in, so the capsule is where the ray
      // looked for it.
      float th = (slot + 0.5 + (rAng - 0.5) * 0.8) / slots * TAU + rot;
      float rad = rr + (rRad - 0.5) * ((TUBE - inner) / shells) * 0.8;
      vec2 c = rad * vec2(cos(th), sin(th));

      // Toward the camera, wrapping through the visible run so a slot is occupied most of the time.
      float zc = mod(rPhase * span - sec * uLsSpeed * 0.55, span) - halfLen;

      float tHit;
      float d = capsuleDist(rd, c, zc - halfLen, zc + halfLen, tHit);

      float R = max(uLsThick * 0.05, 0.002) * mix(1.0, 0.4 + 1.2 * rRad, uLsVar);
      // A solid core inside a wider halo: a bright line reads as light rather than as paint, and bump reaches
      // exactly zero so neither term trails a tail across the tube.
      float amt = (bump(d * d, R * R) + 0.22 * bump(d * d, R * R * 12.0))
                * mix(1.0, 0.35 + 1.6 * rBright, uLsVar) * uLsDensity;
      // Fades in at the far end instead of appearing, and never brighter than the tunnel it lives in.
      amt *= smoothstep(FAR, FAR * 0.7, tHit);
      if (amt <= 0.0005) continue;

      acc += ramp(rBright, uLsCol, uLsColB, uLsMode, uLsHue) * amt;
      hitT = min(hitT, tHit);
    }
  }
  return acc;
}

/* PLASMA — lightning filaments that crawl and crackle.
 *
 * CRACKLE is the reciprocal thickness, taking bolts from soft veins to hair-thin forks. CRAWL slides the field
 * around the axis on top of SPIN, so bolts wander rather than turning rigidly with the layer. STRIKE adds a fast
 * component along depth that reads as a bolt firing toward the viewer. FLASH gates regions out of step with each
 * other, so the ring does not blink as one.
 */
vec2 plasma(vec3 p, float sec){
  float crawl = uPlCrawl * (sec * 0.5 + sin(p.z * 0.35 + sec * 0.7) * 1.1);
  vec2 xy = spin(p.xy, uPlSpin * sec + uPlTwist * p.z * 0.05 + crawl);
  float z = p.z + sec * uPlSpeed * 0.55 + uPlStrike * sec * 3.0;

  /* THE SPARSITY MASK IS TESTED FIRST, and that ordering is the optimisation rather than a detail. Bolts exist
   * only where this slow field allows — about a fifth of the volume — and it costs ONE noise sample where the
   * filament below costs four. Rejecting here skips the expensive part for most of the march.
   *
   * The window is narrow and high on purpose: a wide one passes most of the volume and it reads as fog. */
  float region = smoothstep(0.60, 0.80, noise3(vec3(xy * 0.45, z * 0.12)));
  if (region < 0.004) return vec2(0.0);

  // Squashed along depth so the filaments run lengthwise down the tunnel rather than crossing it.
  vec3 q = vec3(xy * 1.9, z * 0.45);
  float bolt = filament(q, mix(90.0, 420.0, clamp(uPlCrackle, 0.0, 1.0))) * region;
  if (bolt < 0.002) return vec2(0.0);

  // The gate wants a slow value that differs around the ring; three sines deliver that without a fetch, and the
  // incommensurate rates keep it from settling into a visible beat.
  float ft = sec * (0.9 + uPlFlash * 1.6);
  float gate = 0.5 + 0.5 * sin(xy.x * 0.7 + ft) * sin(xy.y * 0.61 - ft * 0.83);
  float live = mix(1.0, smoothstep(0.30, 0.72, gate), clamp(uPlFlash, 0.0, 1.0));

  return vec2(bolt * live * uPlDensity, clamp(bolt * 1.8, 0.0, 1.0));
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 rd = normalize(vec3(uv, 1.3));
  float sec = uTime;

  int steps = int(uSteps);

  /* THE MARCH STARTS WHERE THE RAY ENTERS THE SHELL, NOT AT THE EYE.
   *
   * Nothing exists inside the clear throat, and every layer's density begins at its own radius: wallProfile is
   * identically zero below 1 - COVERAGE. A ray's radial distance is |rd.xy| * t, so the depth at which it first
   * reaches the innermost enabled layer solves exactly — and every step before that was integrating vacuum.
   *
   * This is most of the cost of this shader. Measured with all layers OFF the loop still took two thirds of the
   * frame, because a ray down the middle of the screen never reaches the wall at all and was marching the full
   * range regardless. Rays that never enter now skip the loop entirely rather than stepping through nothing.
   */
  /* LIGHTSPEED IS NOT IN THIS TEST any more, and that is most of what it bought. It is solved rather than
   * marched, so with it lit alone there is no march at all — steps falls to zero and every ray exits before the
   * loop. It still occludes correctly, by the transmittance captured at its own depth below. */
  float innerMin = 1.0;
  if (uNebOn > 0.5) innerMin = min(innerMin, 1.0 - clamp(uNebCov, 0.0, 1.0));
  if (uPlOn  > 0.5) innerMin = min(innerMin, 1.0 - clamp(uPlCov,  0.0, 1.0));
  bool anyLayer = (uNebOn + uPlOn) > 0.5;

  float lsT = FAR;
  vec3 lsCol = uLsOn > 0.5 ? lightspeed(rd, sec, lsT) : vec3(0.0);
  float transAtLs = 1.0;

  float k = length(rd.xy);
  float tEnter = max(0.3, innerMin * TUBE / max(k, 1e-5));

  /* THE STEPS GROW WITH DEPTH. A uniform march spends as much on the far half of the tunnel — where everything is
   * small, dim and already half-occluded — as on the near half that fills the screen. Growing the step by a fixed
   * ratio covers the same range in far fewer samples and puts the detail where it is visible. GROWTH is solved
   * from the step count so QUALITY still means "how many samples", and the span covered is whatever is left
   * between the shell entry and FAR. */
  float span = max(FAR - tEnter, 0.0);
  float growth = 1.055;
  float gp = pow(growth, float(steps));
  float dt = span * (growth - 1.0) / (gp - 1.0);
  float t = tEnter + dt * dither(gl_FragCoord.xy);
  if (!anyLayer || span <= 0.0) steps = 0;

  vec3 col = vec3(0.0);
  float trans = 1.0;

  vec3 plCol = ramp(1.0, uPlCol, uPlColB, uPlMode, uPlHue);

  for (int i = 0; i < 96; i++){
    if (i >= steps || trans < 0.02) break;

    vec3 p = rd * t;

    // Rotation-invariant, so ONE radial distance serves every layer however each happens to be spinning.
    float s01 = clamp(length(p.xy) / TUBE, 0.0, 1.0);

    vec3 emit = vec3(0.0);
    float dens = 0.0;

    // Plasma first: its emission lights the cloud sampled at the same point, which is what makes the clouds
    // flare when a bolt fires instead of the two layers ignoring each other.
    float lightHere = 0.0;
    float pProf = wallProfile(s01, uPlCov);
    if (uPlOn > 0.5 && pProf > 0.003){
      vec2 pl = plasma(p, sec);
      float a = pl.x * pProf;
      emit += ramp(pl.y, uPlCol, uPlColB, uPlMode, uPlHue) * a * 1.9;
      dens += a * 0.5;
      lightHere = pl.x;
    }

    float nProf = wallProfile(s01, uNebCov);
    if (uNebOn > 0.5 && nProf > 0.003){
      vec2 nb = nebula(p, sec);
      float a = nb.x * nProf;
      emit += (ramp(nb.y, uNebCol, uNebColB, uNebMode, uNebHue) + plCol * lightHere * uPlLight * 9.0) * a;
      dens += a;
    }

    // Captured while the march is still IN FRONT of the streaks, so what is left when it reaches them is exactly
    // what they should be seen through.
    if (t <= lsT) transAtLs = trans;

    float alpha = clamp(dens * dt, 0.0, 1.0);
    col += trans * emit * dt;
    trans *= 1.0 - alpha;

    t += dt;
    dt *= growth;
  }

  col += lsCol * transAtLs;

  /* THE CORE CAN TAKE ITS COLOUR FROM WHATEVER IS LIT, so the far end of the tunnel belongs to the scene instead
   * of being a white dot pasted over it. SOURCE blends between the swatch and the average of the enabled layers'
   * ramps, which is why it is one slider and not a mode: the useful settings are the ends AND between them.
   *
   * With no layer lit there is nothing to average, so the swatch is the only answer and SOURCE has no effect.
   *
   * The centre stays near-white and only the CORONA takes the tint, which is how an actual bright source reads:
   * hot enough to clip in the middle, coloured at the edges. TINT at 0 restores the plain white source.
   *
   * Added AFTER the march and multiplied by the surviving transmittance, so cloud in front of it occludes it
   * rather than being washed out by a glow drawn on top. */
  float r = length(uv);

  vec3 tc = vec3(0.0);
  float tw = 0.0;
  if (uNebOn > 0.5){ tc += ramp(0.5, uNebCol, uNebColB, uNebMode, uNebHue); tw += 1.0; }
  if (uLsOn  > 0.5){ tc += ramp(0.5, uLsCol,  uLsColB,  uLsMode,  uLsHue ); tw += 1.0; }
  if (uPlOn  > 0.5){ tc += ramp(0.5, uPlCol,  uPlColB,  uPlMode,  uPlHue ); tw += 1.0; }
  tc = mix(uCoreCol, tw > 0.0 ? tc / tw : uCoreCol, uCoreAuto);
  tc = mix(vec3(1.0, 0.93, 0.80), tc, uThroatTint);

  /* PULSE breathes around full brightness; FADE takes the core away entirely and brings it back. Two
   * incommensurate sines in the pulse so the breath does not settle into a countable beat, and a cosine for the
   * fade so it starts at full rather than mid-dip. */
  float pulse = 1.0 + uCorePulse * (0.28 * sin(sec * uCorePulseRate * 1.7)
                                  + 0.12 * sin(sec * uCorePulseRate * 4.3));
  float fade = 1.0 - uCoreFade * (0.5 - 0.5 * cos(sec * uCoreFadeRate * 0.42));

  // SPIN rotates the ray fan; the wander term keeps it from reading as a rigid pinwheel, which is the one thing
  // the far end of a wormhole should not look like. Rotating the ANGLE rather than the phase is what makes SPIN
  // an angular rate the same way every layer's is, instead of a rate divided by the fan's count.
  float a = atan(uv.y, uv.x) + uCoreSpin * sec;
  float rays = 0.5 + 0.5 * sin(a * 7.0 + sin(a * 3.0 - sec * 0.37) * 1.6);
  float corona = smoothstep(0.34, 0.0, r) * mix(1.0, 0.30 + 0.70 * rays, uThroatRays);

  vec3 throat = vec3(1.0, 0.97, 0.92) * smoothstep(0.045, 0.0, r) * 2.6 * pulse
              + tc * corona * 0.55 * pulse;
  col += throat * uGlow * fade * trans;

  float ca2 = uChroma * 0.2 * r;
  col.r *= 1.0 + ca2;
  col.b *= 1.0 - 0.7 * ca2;

  col *= mix(1.0, smoothstep(1.4, 0.1, r), uVignette);
  col *= uExposure;
  col = col / (col + 1.0);
  gl_FragColor = vec4(pow(col, vec3(0.85)), 1.0);
}`;
