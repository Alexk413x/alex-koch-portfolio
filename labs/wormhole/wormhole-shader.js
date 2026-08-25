/* The wormhole as a volumetric march through a 3D field. Pure source, no GL calls.
 *
 * THE FIELD IS SAMPLED AT THE REAL 3D POINT, which is what makes it a volume. Collapsing the sample position to
 * its angle gives every step down a ray the same lateral coordinate, and the march then smears radially instead of
 * building structure. The tunnel comes from the radial DENSITY PROFILE instead: clear along the axis, filling
 * toward the wall.
 *
 * THE THREE LAYERS ARE MIXED BY DEPTH, NOT STACKED. Every step asks each enabled layer for a density and an
 * emission and composites front-to-back, so a cloud can sit in front of a bolt which sits in front of another
 * cloud. Compositing three finished images could not do that.
 *
 * EVERY LAYER OWNS ITS OWN FLOW: speed, twist and spin. THE CAMERA DOES NOT MOVE AT ALL — each layer slides its own
 * field along z instead. Moving the camera is the obvious way to fly down a tunnel and it forces one speed on
 * everything; sliding the fields is the same motion and the only version in which three layers travel at three
 * rates.
 *
 * Each layer returns `vec2(density, gradient)`; the gradient is what its colour ramp reads, and each defines it
 * differently so the three do not read as one field tinted three ways.
 */
import { NOISE, PALETTE, TUNNEL } from './wormhole-glsl.js';

export const UNIFORMS = [
  'uRes', 'uTime', 'uSteps', 'uSpread', 'uBend', 'uBendFlow', 'uBendScale',
  'uFov', 'uCov', 'uWall', 'uRibs', 'uRibScale', 'uRibFlow',
  'uGlow', 'uChroma', 'uVignette', 'uExposure', 'uThroatTint', 'uThroatRays',
  'uCoreCol', 'uCoreAuto', 'uCoreSpin', 'uCorePulse', 'uCorePulseRate', 'uCoreFade', 'uCoreFadeRate',
  'uNebOn', 'uNebCol', 'uNebColB', 'uNebMode', 'uNebHue',
  'uNebDensity', 'uNebFill', 'uNebFluff', 'uNebStreak', 'uNebVar', 'uNebScale', 'uNebOct',
  'uNebSpeed', 'uNebTwist', 'uNebSpin',
  'uLsOn', 'uLsCol', 'uLsColB', 'uLsMode', 'uLsHue',
  'uLsDensity', 'uLsCount', 'uLsLen', 'uLsThick', 'uLsVar', 'uLsRadial',
  'uLsSpeed', 'uLsTwist', 'uLsSpin',
  'uPlOn', 'uPlCol', 'uPlColB', 'uPlMode', 'uPlHue',
  'uPlDensity', 'uPlCrackle', 'uPlFlash', 'uPlFlashRate', 'uPlLight',
  'uPlFill', 'uPlOcclude',
  'uPlScale', 'uPlStreak',
  'uPlSpeed', 'uPlTwist', 'uPlSpin',
];

/* THE BODY IS NOT A SHADER UNTIL A LAYER SET IS CHOSEN — see fragFor at the foot of this file. Each layer's
 * functions and its call site sit behind an #ifdef, because a layer costs even when its uniform is zero.
 */
const BODY = `
precision highp float;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime, uSteps, uSpread, uBend, uBendFlow, uBendScale;
/* ONE COVERAGE, ONE UNIFORM. It was three — one per layer — long after the panel stopped offering three rows to
 * set them from, so the shader evaluated wallProfile twice per step against two numbers the host had just sent
 * the same value to. Collapsed, the profile is computed ONCE and both marched layers read it: 2.6% of the frame,
 * for a byte-identical picture. */
uniform float uFov, uCov, uWall, uRibs, uRibScale, uRibFlow;
uniform float uGlow, uChroma, uVignette, uExposure, uThroatTint, uThroatRays;
uniform float uCoreAuto, uCoreSpin, uCorePulse, uCorePulseRate, uCoreFade, uCoreFadeRate;
uniform vec3  uCoreCol;

uniform float uNebOn, uNebMode, uNebHue, uNebDensity, uNebFill, uNebFluff, uNebStreak, uNebVar, uNebScale, uNebOct;
uniform float uNebSpeed, uNebTwist, uNebSpin;
uniform vec3  uNebCol, uNebColB;

uniform float uLsOn, uLsMode, uLsHue, uLsDensity, uLsCount, uLsLen, uLsThick, uLsVar, uLsRadial;
uniform float uLsSpeed, uLsTwist, uLsSpin;
uniform vec3  uLsCol, uLsColB;

uniform float uPlOn, uPlMode, uPlHue, uPlDensity, uPlCrackle, uPlFlash, uPlFlashRate, uPlLight;
uniform float uPlFill, uPlOcclude;
uniform float uPlScale, uPlStreak;
uniform float uPlSpeed, uPlTwist, uPlSpin;
uniform vec3  uPlCol, uPlColB;

#define TUBE 1.25
#define FAR 13.0

${NOISE}
${PALETTE}
${TUNNEL}

/* THE AXIS IS A CURVE, NOT A LINE — the rollercoaster. The camera still does not move: bending the TUNNEL around a
 * stationary eye is the same picture as flying a curved track, and it is the only version that keeps every layer
 * agreeing, because each measures its radius from this curve rather than from the z axis.
 *
 * Two incommensurate sines per axis, so the track never repeats on a countable beat. BEND FLOW slides the curve
 * toward the eye, which is what makes the corners arrive rather than sit still.
 */
vec2 bendAt(float z, float sec){
  float u = (z + sec * uBendFlow) * max(uBendScale, 0.01);
  return vec2(sin(u * 0.21) + 0.6 * sin(u * 0.37 + 1.7),
              cos(u * 0.17 + 0.9) + 0.6 * cos(u * 0.29 - 0.4)) * (uBend * 0.47);
}

/* NEBULA — volumetric cloud in the tube's wall.
 *
 * FLUFF is the fbm gain: low leaves the largest octave dominant and it reads as soft billows, high keeps the fine
 * detail and it reads as torn and wispy. STREAK compresses the field's depth axis so billows draw out into lanes
 * along the direction of travel. FILL slides the density threshold — high leaves only the peaks, which is mist;
 * low floods it into thick cover.
 */
#ifdef HAVE_NEB
vec2 nebula(vec3 p, float sec, float inv){
  vec2 xy = spin(p.xy, uNebSpin * sec + uNebTwist * p.z * 0.05);
  float z = p.z + sec * uNebSpeed * 0.55;

  vec3 q = vec3(xy, z * uNebStreak) * (uNebScale * 0.34);

  /* VARIANCE AND THE COLOUR BAND ARE TRIGONOMETRIC, NOT NOISE, and that is the single biggest saving in the
   * shader. Both want a term that changes SLOWLY over the tunnel; a noise sample costs eight hashes to deliver
   * that, and three incommensurate sines deliver it for a few multiplies. Two of the nebula's five samples per
   * step were being spent on values that never needed to be random, only unrepeating. */
  float band = sin(z * 0.21) * sin(xy.x * 0.47 + 1.7) * sin(xy.y * 0.39 - 0.6);
  float var = max(mix(1.0, 1.0 + 0.85 * band, uNebVar), 1e-3);

  /* THE THRESHOLD IS DIVIDED BY THE VARIANCE RATHER THAN THE FIELD MULTIPLIED BY IT, so the fbm knows what it has
   * to beat before it starts fetching and can stop as soon as it cannot. Both sides are positive, so it is the
   * same comparison either way round -- see fbm. */
  float lo = mix(0.80, 0.30, clamp(uNebFill, 0.0, 1.0));
  float w = fbm(q, int(uNebOct), uNebFluff, inv, lo / var, (lo + 0.26) / var);
  float dens = smoothstep(lo, lo + 0.26, w * var);

  // Colour holds over a stretch of tunnel rather than cycling per sample, which is what stops the ramp averaging
  // itself to grey across the march.
  float g = 0.5 + 0.5 * sin(z * 0.11 + band * 1.6);
  return vec2(dens * uNebDensity, g);
}
#endif

/* LIGHTSPEED — SOLVED, NOT MARCHED. A streak is a CAPSULE: a segment running parallel to the tunnel axis with a
 * radius, so its ends are round by construction rather than faded by a window function.
 *
 * THE MARCH COULD NOT DRAW THIS, which is why the layer was rebuilt rather than tuned. A marched ray either lands
 * on a thin line or misses it, so the kernel has to be widened to the sampling rate and then dimmed to conserve
 * energy — many times too wide even at maximum QUALITY. Distance to a shape has no such floor: the width here is
 * the width asked for, at any step count and any resolution.
 *
 * WHY IT CLOSES: the camera sits ON the axis and the capsules run parallel to it, so a ray's xy direction never
 * changes — in cross-section it sweeps ONE radial line out from the centre. Only streaks near that angle can be
 * hit, so bucketing by angle turns "which of two hundred streaks does this pixel see" into three candidates per
 * shell. No traversal, no marching, no step count.
 */

// Ray-to-capsule distance for a segment parallel to z, and the depth it happens at. Exact: the closest approach
// to the infinite line solves directly, and falling outside the segment's span reduces to a ray-to-endpoint
// projection — which is what rounds the caps.
#ifdef HAVE_LS
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

/* THE LAYER COMES BACK IN DEPTH BANDS, NOT AS ONE COLOUR, and that is what lets it weave. A solved layer has no
 * natural place in a marched one: it is finished before the march starts, so handing back a single colour and depth
 * means the whole layer is occluded by whatever sits in front of its NEAREST streak, and the set moves as a sheet.
 * Splitting the emission by depth and dimming each band by the transmittance the march reaches IT at is what puts
 * some streaks behind a cloud and others in front of the same one.
 *
 * Four bands is a judgement, not a law: four compares per step and four accumulators, and the banding is invisible
 * because a streak is thin enough that neighbouring bands rarely both carry one.
 */
struct Streaks { vec3 b0; vec3 b1; vec3 b2; vec3 b3; };

Streaks lightspeed(vec3 rd, float sec){
  Streaks acc;
  acc.b0 = vec3(0.0); acc.b1 = vec3(0.0); acc.b2 = vec3(0.0); acc.b3 = vec3(0.0);

  float slots = max(8.0, floor(uLsCount));
  float k = max(length(rd.xy), 1e-5);

  float inner = (1.0 - clamp(uCov, 0.0, 1.0)) * TUBE;
  float halfLen = max(uLsLen, 0.02) * (FAR * 0.5);
  float chaos = clamp(uLsVar, 0.0, 1.0);

  /* THREE RADIAL BANDS, AND THEY ARE NOT SHELLS. Each covers a contiguous third of the wall and scatters its
   * streaks anywhere inside it, so the three together fill from the inner radius out to the wall UNIFORMLY — no
   * rings, no gaps between them, and a streak may sit at any distance exactly as the cloud may.
   *
   * THE COUNT IS A WORK BOUND, NOT A LOOK, which is why it is a constant here and not a control: it is how many
   * candidate streaks a pixel tests per angular bucket. COVERAGE alone decides how far in from the wall the layer
   * reaches, and it now means for this layer what it already meant for NEBULA and PLASMA. */
  float rings = 3.0;
  float bandW = (TUBE - inner) / rings;

  for (int s = 0; s < 3; s++){
    float rr = inner + (float(s) + 0.5) * bandW;

    /* ROTATION IS RESOLVED PER BAND, BEFORE THE BUCKET IS CHOSEN, and it has to be: the bucket is picked from the ray's
     * screen angle, so a capsule rotated AFTER that lands outside the bucket searched for it and is never found —
     * which is a black screen, not a subtle error.
     *
     * SPIN is rigid and needs no depth. TWIST does, and this is the approximation: a band has a known middle radius,
     * so the depth a ray crosses it at solves directly, and the whole band rotates by the twist there. A helix has no
     * closed form, but a capsule only has to be in the right place where the ray meets it. */
    float zMeet = clamp(rr * rd.z / k, 0.0, FAR);
    /* THE BEND MOVES THE BUCKET, NOT ONLY THE CAPSULE. This layer finds a streak by the ray's ANGLE about
     * the tunnel centre; offsetting capsules without offsetting the search looks for them where they are
     * no longer, and the layer goes black. Both use the bend at the depth this band is met at — the same
     * approximation TWIST already makes, and for the same reason: a capsule only has to be right where
     * the ray actually reaches it. */
    vec2 bendM = bendAt(zMeet, sec);
    vec2 rel = rd.xy * (zMeet / max(rd.z, 1e-4)) - bendM;
    float aBand = atan(rel.y, rel.x);
    float rot = uLsSpin * sec + uLsTwist * zMeet * 0.05;
    float base = floor((aBand - rot) / TAU * slots);

    for (int j = 0; j < 3; j++){
      // Wrapped before hashing so the ring CLOSES — the seam at atan's cut would otherwise be one visible lane
      // where slot -n and slot +n disagree about which streak lives there.
      float slot = mod(base + float(j) - 1.0, slots);
      float id = slot + float(s) * 977.0;

      // SPREAD thins the slots that carry a streak at all. Tested first, so a rejected slot costs one hash.
      if (hash11(id * 1.7 + 0.3) > mix(0.25, 1.0, uLsRadial)) continue;

      // A LANE'S PERMANENT PROPERTIES: where it sits and how fast it runs.
      float rAng = hash11(id * 3.1 + 5.7);
      float rRad = hash11(id * 7.3 + 11.1);
      float rPhase = hash11(id * 2.9 + 19.3);
      float rSpd = hash11(id * 6.1 + 41.9);
      float lane = hash11(id * 1.13 + 7.7);

      // Back into world space by the same rotation the bucket was chosen in, so the capsule is where the ray
      // looked for it.
      float th = (slot + 0.5 + (rAng - 0.5) * 0.8) / slots * TAU + rot;
      /* HOW FAR OUT. At VARIANCE 0 a streak keeps to its own band, filling it edge to edge — anything less
       * leaves an unlit gap between bands, which is the ringing the old shells produced. At 1 the draw widens
       * to the whole wall, so any streak may sit at any radius and the set mingles with whatever else fills it.
       *
       * WRAPPED, NOT CLAMPED. Clamping a widened draw piles every overshoot onto the two limits, which puts a
       * hard ring of streaks at exactly the wall — one visible circle instead of a spread. Wrapping keeps the
       * draw uniform across the range and leaves nothing heaped at either end. */
      float wall = max(TUBE - inner, 1e-4);
      float rad = inner + mod(rr - inner + (rRad - 0.5) * mix(bandW, wall, chaos) + wall, wall);
      vec2 c = bendM + rad * vec2(cos(th), sin(th));

      /* EACH PASS IS A NEW BEAM. Keyed to the lane alone, every streak repeats unchanged for the life of the page, so
       * VARIANCE only ever varies them against each other and never over time. Seeding the length, thickness and
       * brightness with the lane AND the cycle number gives every pass its own.
       *
       * THE CYCLE IS COUNTED ON THE NOMINAL LENGTH, not the drawn one, or the count would depend on the draw it
       * seeds. The headroom is for the longest a pass can be at full VARIANCE.
       *
       * SEEDS ARE KEPT SMALL. hash11 starts with fract(p * 0.1031), and a large float32 holds only a few bits of
       * fraction, so feeding it a lane index multiplied by a cycle count degrades to a handful of distinct outcomes.
       * Hashing the lane to 0..1 first keeps every argument small. */
      float vel = uLsSpeed * (1.0 + chaos * (rSpd - 0.5));
      float sp = FAR + 3.0 * halfLen;
      float u = rPhase * sp - sec * vel * 0.55;
      float cyc = mod(floor(u / sp), 256.0);

      float rLen = hash11(lane * 91.7 + cyc * 1.7 + 31.1);
      float rThick = hash11(lane * 57.3 + cyc * 2.9 + 53.3);
      float rBright = hash11(lane * 33.1 + cyc * 3.7 + 23.7);

      float hl = halfLen * (1.0 + chaos * (rLen - 0.5));
      float zc = mod(u, sp) - hl;

      float tHit;
      float d = capsuleDist(rd, c, zc - hl, zc + hl, tHit);

      /* PLUS OR MINUS HALF AT FULL VARIANCE, and the same for LENGTH and SPEED above. A draw of 0.5 is
       * the value the row shows, so the control still means what it says at any variance — the spread is
       * symmetric about it rather than skewed one way. */
      float R = max(uLsThick * 0.05, 0.002) * (1.0 + chaos * (rThick - 0.5));
      // A solid core inside a wider halo: a bright line reads as light rather than as paint, and bump reaches
      // exactly zero so neither term trails a tail across the tube.
      float amt = (bump(d * d, R * R) + 0.22 * bump(d * d, R * R * 12.0))
                * mix(1.0, 0.35 + 1.6 * rBright, chaos) * uLsDensity;
      // Fades in at the far end instead of appearing, and never brighter than the tunnel it lives in.
      amt *= smoothstep(FAR, FAR * 0.7, tHit);
      if (amt <= 0.0005) continue;

      // Filed by the depth the ray actually meets this capsule at, so the march can dim it by what is in front.
      vec3 c3 = ramp(rBright, uLsCol, uLsColB, uLsMode, uLsHue) * amt;
      float q = tHit / FAR;
      if      (q < 0.25) acc.b0 += c3;
      else if (q < 0.50) acc.b1 += c3;
      else if (q < 0.75) acc.b2 += c3;
      else               acc.b3 += c3;
    }
  }
  return acc;
}
#endif

/* PLASMA — lightning filaments that crawl and crackle. CRACKLE is the reciprocal thickness, taking bolts from soft
 * veins to hair-thin forks. FLASH gates regions out of step with each other, so the ring does not blink as one.
 *
 * THE LAYER TURNS ON SPIN AND TWIST AND NOTHING ELSE, which is what NEBULA does. A separate CRAWL carrying its own
 * constant angular rate fights SPIN, so the layer turns the opposite way from the number on screen. Two controls
 * for one rate is the bug; one is the fix.
 *
 * THE LAYER IS THREE FUNCTIONS AND THE MARCH CHOOSES BETWEEN THEM. That is not a stylistic split: collapsing it
 * back into one function with early returns costs half the layer's speed, because the compiler FLATTENS an early
 * return out of a small function and evaluates it anyway. With the tests in the loop instead, the layer costs less
 * than half what it did and the frame is byte-identical.
 */

#ifdef HAVE_PL
// Where a sample sits in the layer's own frame, and whether a bolt can exist there at all.
struct PSite { vec2 xy; float z; float region; float tint; };

/* The part every sample pays: one rotation and one noise fetch, and nothing else.
 *
 * THE SPARSITY WINDOW IS NARROW AND HIGH on purpose — a wide one passes most of the volume and reads as fog.
 * It passes about a sixth, which is what makes rejecting on it worth a branch.
 */
PSite plasmaSite(vec3 p, float sec){
  PSite s;
  s.xy = spin(p.xy, uPlSpin * sec + uPlTwist * p.z * 0.05);
  s.z = p.z + sec * uPlSpeed * 0.55;
  /* THE SPARSITY MASK IS FRAMED LIKE THE FIELD IT GATES, at a third of its frequency. Sampled far too coarsely it
   * spans barely one lattice cell across the whole tube, so all it can do is switch SLABS of depth on and off, and
   * they sweep past as distinct layers. At this framing it is patchy in three dimensions, which is what a sparsity
   * mask is for.
   *
   * THE OFFSET IS NOT DECORATION. Without it this samples the same field the filament does, only slower, and the two
   * anti-correlate — where the mask passes, the filament's own value is far from its crossing, so nothing survives
   * and the layer renders black. */
  float lo = mix(0.85, 0.30, clamp(uPlFill, 0.0, 1.0));
  float n = noise3(vec3(s.xy, s.z * uPlStreak) * uPlScale * 0.35 + vec3(47.3, 11.9, 23.7));
  s.region = smoothstep(lo, lo + 0.20, n);
  /* THE COLOUR GRADIENT IS THE SPARSITY FIELD, NOT THE BOLT. See the note on ramp in wormhole-glsl:
   * t has to vary SLOWLY along a ray or the march integrates a different walk through the palette for
   * every pixel, and since a ray is a radial line on screen that disagreement draws itself as streaks
   * out of the centre. Driving it from bolt strength -- the fastest-varying thing in the layer -- broke
   * that outright, and RAIN mode showed it plainly. This value is already computed, is slow by
   * construction, and gives each patch of bolts its own colour rather than each sample. */
  s.tint = n;
  return s;
}

/* The bolt: two more fetches, worth spending only where the sparsity mask survived.
 *
 * SCALE AND STREAK ARE THE SAME TWO CONTROLS NEBULA HAS. STREAK squashes the depth axis so filaments run lengthwise
 * down the tunnel; SCALE sets how big the whole field is.
 *
 * THE TWO TOGETHER ARE WHY THE BOLTS LOOKED RIBBED. Squashing depth stretches the noise along the exact direction a
 * filament runs, so the field's own features read as beads strung along it. Relaxing the squash clears them and
 * costs the lengthwise character, turning the layer into smoke; keeping the squash and RAISING SCALE clears them by
 * making the beads too small to read as anything but texture. The shipped pair does the latter, and the cost is
 * stipple, so the layer wants its two samples per step more than ever.
 *
 * FOUR OTHER CAUSES WERE TESTED AND ARE NOT IT, so do not spend the time again: more samples per step, a quintic
 * interpolant in noise3, rotating the second noise field so the two lattices share no axes, and a second octave.
 */
float plasmaFil(PSite s){
  vec3 q = vec3(s.xy, s.z * uPlStreak) * uPlScale;
  return filament(q, mix(90.0, 420.0, clamp(uPlCrackle, 0.0, 1.0))) * s.region;
}

/* FLASH's gate, reached only where a bolt already exists. It wants a slow value that differs around the ring;
 * two sines deliver that without a fetch, and the incommensurate rates keep it off a visible beat.
 *
 * HOW MUCH AND HOW FAST ARE TWO CONTROLS, as they are for CORE's PULSE. One slider driving both cannot express
 * a slow deep flicker or a fast shallow one, and those are the two settings anyone actually wants. */
float plasmaLive(PSite s, float sec){
  float ft = sec * max(uPlFlashRate, 0.0);
  float gate = 0.5 + 0.5 * sin(s.xy.x * 0.7 + ft) * sin(s.xy.y * 0.61 - ft * 0.83);
  return mix(1.0, smoothstep(0.30, 0.72, gate), clamp(uPlFlash, 0.0, 1.0));
}
#endif

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  /* THE LENS IS A CONTROL, AND IT IS THE LARGEST SINGLE THING SEPARATING A TUNNEL FROM A BACKDROP. At a narrow
   * angle the wall never reaches the edge of the frame and the whole field sits out in front of the eye like
   * weather; opened up, the wall sweeps past the periphery and the picture closes around the viewer. uFov is the
   * ray's z, so SMALL IS WIDE -- the host sends it from an angle in degrees, which is the number a person means.
   */
  vec3 rd = normalize(vec3(uv, uFov));
  float sec = uTime;

  int steps = int(uSteps);

  /* THE MARCH STARTS WHERE THE RAY ENTERS THE SHELL, NOT AT THE EYE. Nothing exists inside the clear throat, and every
   * layer's density begins at its own radius, so the depth at which a ray first reaches the innermost enabled layer
   * solves exactly — and every step before that was integrating vacuum.
   *
   * This is most of the cost of this shader: with all layers OFF the loop still took two thirds of the frame,
   * because a ray down the middle of the screen never reaches the wall at all. */
  /* LIGHTSPEED IS NOT IN THIS TEST any more, and that is most of what it bought. It is solved rather than
   * marched, so with it lit alone there is no march at all — steps falls to zero and every ray exits before the
   * loop. It still occludes correctly, by the transmittance captured at its own depth below. */
  bool anyLayer = (uNebOn + uPlOn) > 0.5;
  float innerMin = anyLayer ? 1.0 - clamp(uCov, 0.0, 1.0) : 1.0;

#ifdef HAVE_LS
  Streaks ls;
  ls.b0 = vec3(0.0); ls.b1 = vec3(0.0); ls.b2 = vec3(0.0); ls.b3 = vec3(0.0);
  if (uLsOn > 0.5) ls = lightspeed(rd, sec);
  // Transmittance sampled at each band's MIDDLE, which is the depth its streaks average out at. All start at 1,
  // so a scene with nothing marching in front leaves the streaks at full brightness.
  float tb0 = 1.0, tb1 = 1.0, tb2 = 1.0, tb3 = 1.0;
#endif

  float k = length(rd.xy);
  /* THE ENTRY POINT ALLOWS FOR THE BEND. This solves the depth at which a ray first reaches the innermost
   * layer, and it did so for a STRAIGHT tube — but the axis can lean 0.75 of a world unit, 60% of the
   * tube's own radius, so a ray meets the bent shell EARLIER than the straight solve says and everything
   * before that was being skipped. Backing the start off by the bend's maximum costs a few steps of
   * vacuum on rays that did not need them and clips nothing. */
  float tEnter = max(0.3, (innerMin * TUBE - uBend * 0.752) / max(k, 1e-5));

  /* THE STEPS GROW WITH DEPTH. A uniform march spends as much on the far half of the tunnel — where everything is
   * small, dim and already half-occluded — as on the near half that fills the screen.
   *
   * WHAT IS FIXED IS THE RATIO BETWEEN THE FIRST STEP AND THE LAST, not the per-step growth. A constant growth rate
   * makes that ratio compound with the step count, so every sample QUALITY adds goes to the near field and the far
   * field stays where it was.
   *
   * Solving growth from the step count instead pins the near-to-far ratio at SPREAD, so every extra step refines the
   * WHOLE ray and QUALITY means what it says.
   *
   * STEP SPREAD is that ratio, and it is a control because it is a real trade rather than a right answer: 1 marches
   * evenly and gives the far field the most samples it can, high concentrates them at the eye. */
  float span = max(FAR - tEnter, 0.0);
  /* NUDGED OFF 1.0, because the step below divides by (growth^n - 1) and an EVEN march makes that exactly zero
   * over an exactly-zero numerator. NaN, and a black frame at the one end of the slider a reader would try
   * first. A hair above 1 takes the same limit: dt comes out as span / steps to five figures. */
  float growth = max(pow(max(uSpread, 1.0), 1.0 / max(float(steps), 1.0)), 1.0001);
  float gp = pow(growth, float(steps));
  float dt = span * (growth - 1.0) / (gp - 1.0);
  float t = tEnter + dt * dither(gl_FragCoord.xy, sec);
  if (!anyLayer || span <= 0.0) steps = 0;

  vec3 col = vec3(0.0);
  float trans = 1.0;

#ifdef HAVE_NEB
  // One value per frame, not per sample: fbm needs the FULL normaliser to stop early without renormalising.
  float nebInv = fbmNorm(int(uNebOct), uNebFluff);
#endif

  vec3 plCol = ramp(1.0, uPlCol, uPlColB, uPlMode, uPlHue);
  // How sharply the wall arrives. Uniform-derived, so it is resolved once rather than at every sample.
  float wallSoft = mix(0.35, 0.045, clamp(uWall, 0.0, 1.0));

  for (int i = 0; i < 96; i++){
    if (i >= steps || trans < 0.02) break;

    vec3 p = rd * t;
    // THE BEND IS APPLIED ONCE, HERE. s01 and every layer below read p.xy, so one offset leans the whole
    // field — the wall profile included, which is what stops the tunnel's mouth sliding off its own wall.
    p.xy -= bendAt(p.z, sec);

    // Rotation-invariant, so ONE radial distance serves every layer however each happens to be spinning.
    float s01 = clamp(length(p.xy) / TUBE, 0.0, 1.0);

    // Both marched layers read the same wall, so it is resolved once. RIBS scale it; see below.
    float covProf = wallProfile(s01, uCov, wallSoft);

    /* RIBS ARE RINGS OF THICK AND THIN WALL, spaced along the axis and sliding toward the eye. They are the
     * cheapest strong cue in the lab: a ring lives at a fixed DEPTH, so it foreshortens toward the throat and
     * arrives faster as it comes, and an eye reads that as travelling rather than as watching weather. The layers'
     * own flow rates are theirs; this one is the tunnel's.
     *
     * IT SCALES THE PROFILE, NOT THE COVERAGE, and that distinction is the whole effect. Fed through coverage it
     * only moved the wall's INNER edge, and wallProfile saturates at 1 for every sample beyond the wall — which is
     * most of the ray for most of the frame, since a ray leaves the tube early and keeps marching. So the rings
     * appeared in one thin annulus near the throat and nowhere else. Scaling the finished profile corrugates the
     * whole depth of the field, and the rings run out to the corners.
     *
     * READ FROM p.z ALONE, so they are planes across the tube and belong to the tunnel rather than to any one
     * layer — the same reason COVERAGE and BEND are single values. Behind a uniform test, because a scene with
     * RIBS off should not pay a cosine per sample for it, and a test on a uniform never diverges.
     */
    float ribK = 1.0;
    if (uRibs > 0.001) {
      /* THE RINGS ARE DENSE AND THE TUBE BETWEEN THEM IS THIN, not the other way round. Written as a groove —
       * density REMOVED at each ring — nothing was visible: a ray crosses several ribs on its way out and thinning
       * a few of them only changes a sum that was already smooth. A ring has to OCCLUDE to read as a ring, so the
       * near one stands in front of the far one and the eye is given the depth order for free.
       *
       * The crest is a fourth power, which is narrow, and the trough is scaled down to match, so lighting the
       * control does not simply make the frame brighter. */
      float rc0 = 0.5 + 0.5 * cos((p.z + sec * uRibFlow) * uRibScale);
      float band = rc0 * rc0; band *= band;
      ribK = mix(1.0, 0.25 + 3.2 * band, uRibs);
    }

    vec3 emit = vec3(0.0);
    float dens = 0.0;

    // Plasma first: its emission lights the cloud sampled at the same point, which is what makes the clouds
    // flare when a bolt fires instead of the two layers ignoring each other.
    float lightHere = 0.0;
#ifdef HAVE_PL
    // Each test guards the work behind it FROM THE LOOP, not from inside a function — see the note above
    // plasmaSite. Nesting them here is what makes them real.
    float pProf = covProf * ribK;
    if (uPlOn > 0.5 && pProf > 0.003){
      PSite ps = plasmaSite(p, sec);
      if (ps.region >= 0.004){
        /* TWO SAMPLES ACROSS THE STEP, NOT ONE. A bolt is thinner than a step is long over most of the tunnel, so
         * point-sampling lands on one or misses it and the layer reads as scattered dots rather than lines. Averaging
         * across the step is what the march is meant to be integrating in the first place.
         *
         * It is nearly free ONLY because it sits inside the branch — a sixth of samples reach it — and it cuts the
         * error against a converged render by far more than doubling QUALITY does, for a fraction of the cost.
         *
         * The second sample takes its OWN sparsity value; reusing this one's, to save a fetch, is barely better than
         * not sub-sampling at all. */
        float bolt = 0.5 * (plasmaFil(ps) + plasmaFil(plasmaSite(p + rd * dt * 0.5, sec)));
        if (bolt >= 0.002){
          float d = bolt * plasmaLive(ps, sec) * uPlDensity;
          float a = d * pProf;
          emit += ramp(ps.tint, uPlCol, uPlColB, uPlMode, uPlHue) * a * 1.9;
          // OCCLUSION is separate from BRIGHTNESS on purpose: BRIGHTNESS scales the glow AND the opacity
          // together, and this is the ratio between them — whether a bolt hides what is behind it or is
          // light laid over the top.
          dens += a * uPlOcclude;
          lightHere = d;
        }
      }
    }
#endif

#ifdef HAVE_NEB
    float nProf = covProf * ribK;
    if (uNebOn > 0.5 && nProf > 0.003){
      vec2 nb = nebula(p, sec, nebInv);
      float a = nb.x * nProf;
      emit += (ramp(nb.y, uNebCol, uNebColB, uNebMode, uNebHue) + plCol * lightHere * uPlLight * 9.0) * a;
      dens += a;
    }
#endif

#ifdef HAVE_LS
    // Each band keeps the transmittance the march still had on the way IN to it — what is left of the light by
    // the time it reaches that depth is exactly what its streaks are seen through.
    if (t <= FAR * 0.125) tb0 = trans;
    if (t <= FAR * 0.375) tb1 = trans;
    if (t <= FAR * 0.625) tb2 = trans;
    if (t <= FAR * 0.875) tb3 = trans;
#endif

    float alpha = clamp(dens * dt, 0.0, 1.0);
    col += trans * emit * dt;
    trans *= 1.0 - alpha;

    t += dt;
    dt *= growth;
  }

#ifdef HAVE_LS
  col += ls.b0 * tb0 + ls.b1 * tb1 + ls.b2 * tb2 + ls.b3 * tb3;
#endif

  /* THE CORE CAN TAKE ITS COLOUR FROM WHATEVER IS LIT, so the far end of the tunnel belongs to the scene instead of
   * being a white dot pasted over it. SOURCE blends between the swatch and the average of the enabled layers' ramps,
   * which is why it is one slider and not a mode: the useful settings are the ends AND between them. With no layer
   * lit there is nothing to average, so the swatch is the only answer.
   *
   * The centre stays near-white and only the CORONA takes the tint, which is how an actual bright source reads: hot
   * enough to clip in the middle, coloured at the edges.
   *
   * Added AFTER the march and multiplied by the surviving transmittance, so cloud in front of it occludes it rather
   * than being washed out by a glow drawn on top. */
  /* r IS THE SCREEN RADIUS and stays screen-centred, because CHROMA and VIGNETTE are lens effects that
   * belong to the frame rather than to the tunnel.
   *
   * THE CORE IS NOT, and must follow the bend. It is the far end of the TUNNEL, so it sits where the axis
   * has got to at FAR — project that world point the way the ray direction was built, rd = vec3(uv, uFov),
   * and the offset is bend * uFov / FAR. Left at the screen centre it drifts off the mouth of its own
   * tunnel: at full BEND the far end sits 15% of the way to the edge of the frame. */
  float r = length(uv);
  vec2 cuv = uv - bendAt(FAR, sec) * (uFov / FAR);
  float rc = length(cuv);

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
  float a = atan(cuv.y, cuv.x) + uCoreSpin * sec;
  float rays = 0.5 + 0.5 * sin(a * 7.0 + sin(a * 3.0 - sec * 0.37) * 1.6);
  float corona = smoothstep(0.34, 0.0, rc) * mix(1.0, 0.30 + 0.70 * rays, uThroatRays);

  /* THE HOT CENTRE HAS NO EDGE, and it used to have a hard one. A smoothstep over 0.045 of the frame is a DISC,
   * and a disc at this brightness reads as a ball pasted over the picture rather than as the far end of anything
   * — every shot of this scene showed it as exactly that. Cubed, the falloff peaks at the same value in the same
   * place and reaches zero over three times the radius, so it blooms into the corona instead of stopping against
   * it. */
  float hot = smoothstep(0.135, 0.0, rc);
  hot = hot * hot * hot;
  vec3 throat = vec3(1.0, 0.97, 0.92) * hot * 2.6 * pulse
              + tc * corona * 0.55 * pulse;
  col += throat * uGlow * fade * trans;

  float ca2 = uChroma * 0.2 * r;
  col.r *= 1.0 + ca2;
  col.b *= 1.0 - 0.7 * ca2;

  col *= mix(1.0, smoothstep(1.4, 0.1, r), uVignette);
  col *= uExposure;
  col = col / (col + 1.0);
  fragColor = vec4(pow(col, vec3(0.85)), 1.0);
}`;

/* A SHADER PER LAYER SET, because a layer costs whether or not it runs. Measured on integrated graphics, one layer
 * alone costs roughly half as much in a shader carrying only that layer as in one carrying all three, for a
 * byte-identical frame. Switching a layer off zeroes its uniform; it does not take its code out of the binary, and
 * the code is what the march is paying for.
 *
 * LIGHTSPEED gains nothing here and is included for completeness — it is solved rather than marched. */
export function fragFor(neb, ls, pl) {
  /* THE VERSION LEADS THE DEFINES. #version must precede everything but comments and whitespace, and this
     function is the only place the pieces are joined — so it is the only place that can guarantee the order. */
  return '#version 300 es\n'
       + (neb ? '#define HAVE_NEB 1\n' : '')
       + (ls ? '#define HAVE_LS 1\n' : '')
       + (pl ? '#define HAVE_PL 1\n' : '')
       + BODY;
}

// The superset. Correct at every setting, which is what makes it the right thing to draw with while a narrower
// build is still compiling.
export const FRAG = fragFor(true, true, true);
