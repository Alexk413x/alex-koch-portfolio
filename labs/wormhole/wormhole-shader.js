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
  'uLsDensity', 'uLsCount', 'uLsLen', 'uLsThick', 'uLsVar', 'uLsRadial',
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

uniform float uLsOn, uLsMode, uLsHue, uLsDensity, uLsCount, uLsLen, uLsThick, uLsVar, uLsRadial;
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

/* LIGHTSPEED — streaks, not clouds.
 *
 * The volume is cut into cells across the tube's cross-section; each cell holds one streak running parallel to
 * the axis, with its own phase, length and brightness. LENGTH is a fraction of the streak's repeat period, so
 * taking it to zero turns the lanes into passing dots through the same code rather than a second branch.
 */
vec2 lightspeed(vec3 p, float sec, float footprint, float lateral){
  vec2 sxy = spin(p.xy, uLsSpin * sec + uLsTwist * p.z * 0.05);
  float z = p.z + sec * uLsSpeed * 0.55;

  float cell = mix(0.5, 0.055, clamp((uLsCount - 8.0) / 252.0, 0.0, 1.0));
  vec2 gi = floor(sxy / cell);
  vec2 gf = fract(sxy / cell) - 0.5;

  // SPREAD thins out which cells carry a streak at all, so they do not tile the whole cross-section. Tested on
  // its own hash BEFORE the other two are computed — most cells are rejected, and they need no randoms.
  float r3 = hash11(dot(gi, vec2(13.3, 61.7)) + 4.2);
  if (r3 > mix(0.30, 1.0, uLsRadial)) return vec2(0.0);

  float r1 = hash11(dot(gi, vec2(1.7, 91.3)) + 0.5);
  float r2 = hash11(dot(gi, vec2(37.1, 5.9)) + 11.0);

  // Jitter inside the cell, or every streak sits on a lattice and the grid shows.
  vec2 off = (vec2(r1, r2) - 0.5) * cell * 0.7;
  vec2 rel = gf * cell - off;

  /* THICKNESS IS IN WORLD UNITS, never narrower than one pixel covers at this depth, and DIMMED IN PROPORTION.
   *
   * A streak core thinner than its footprint is sampled at one point per pixel and comes back as a dotted line —
   * the march either lands on it or does not. Widening the kernel fixes that, but a wider kernel that keeps its
   * amplitude is adding light that was never there, and the far half of the tunnel merges into a wash. Scaling
   * by the area ratio conserves the streak's cross-section, so distance makes it fainter rather than fatter. */
  /* ...AND AT LEAST AS WIDE AS THE RAY MOVES SIDEWAYS IN ONE STEP.
   *
   * Near the axis a ray runs almost parallel to the streaks and follows one for a long way. Further out it cuts
   * ACROSS them, and with the steps growing at depth each crossing gets one or two samples — which draws the
   * streak as a row of beads. The lateral term is how far the ray travels perpendicular per step, so a kernel that wide
   * guarantees consecutive samples overlap. Same energy correction: wider means fainter, not brighter. */
  float wMin = max(uLsThick * 0.09, 0.0015);
  float w = max(wMin, max(footprint * 1.3, lateral * 0.6));
  float across = bump(dot(rel, rel), w * w * 2.6) * (wMin * wMin) / (w * w);

  /* THE PERIOD IS LONGER THAN THE VISIBLE TUNNEL, and that is what makes a streak a line instead of a dashed
   * row of dots. At a period of 5 a ray covering 13 units crosses the SAME cell's streak two or three times, so
   * one streak was drawn repeatedly down its own length. One repeat per ray means one streak. */
  float period = 42.0;
  float len = max(uLsLen * mix(1.0, 0.3 + 1.5 * r2, uLsVar), 0.004);
  float f = fract(z / period + r1);
  float along = smoothstep(0.0, 0.02, f) * (1.0 - smoothstep(len, len + 0.05, f));

  float bright = mix(1.0, 0.3 + 1.6 * r1, uLsVar);
  // Constant per streak, so a streak is one colour end to end rather than a smear of the whole ramp.
  return vec2(along * across * bright * uLsDensity, r2);
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

  // World units one pixel covers per unit of depth — the footprint that keeps thin features from aliasing.
  float pxWorld = 2.0 / uRes.y;
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
  float innerMin = 1.0;
  if (uNebOn > 0.5) innerMin = min(innerMin, 1.0 - clamp(uNebCov, 0.0, 1.0));
  if (uLsOn  > 0.5) innerMin = min(innerMin, 1.0 - clamp(uLsCov,  0.0, 1.0));
  if (uPlOn  > 0.5) innerMin = min(innerMin, 1.0 - clamp(uPlCov,  0.0, 1.0));
  bool anyLayer = (uNebOn + uLsOn + uPlOn) > 0.5;

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

    float lProf = wallProfile(s01, uLsCov);
    if (uLsOn > 0.5 && lProf > 0.003){
      vec2 ls = lightspeed(p, sec, t * pxWorld, dt * k);
      float a = ls.x * lProf;
      emit += ramp(ls.y, uLsCol, uLsColB, uLsMode, uLsHue) * a * 2.2;
      dens += a * 0.6;
    }

    float alpha = clamp(dens * dt, 0.0, 1.0);
    col += trans * emit * dt;
    trans *= 1.0 - alpha;

    t += dt;
    dt *= growth;
  }

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
