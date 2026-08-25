/* The GLSL every wormhole effect shares, as named chunks the shader composes. Split out so noise, color and the
 * tunnel mapping are written once: three effects sampling three slightly different noises is how a field stops
 * looking like one place.
 */

// Value noise and its fbm. `oct` is a uniform, so the loop is a fixed bound with an early break — GLSL ES 1.00
// will not accept a variable loop condition. The noise itself is a texture lookup; see below.
export const NOISE = `
#define TAU 6.28318530718

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

/* A COMPACT BUMP WHERE A GAUSSIAN WOULD DO.
 *
 * exp() runs on the special-function unit, which on integrated hardware issues at a fraction of the ALU rate.
 * This is a squared falloff with the same shape over the range that matters and none of the cost, and its
 * SUPPORT IS FINITE, so it reaches zero instead of trailing a faint tail forever — which is the better property
 * for something summed over a hundred samples.
 */
float bump(float d2, float w2){
  float x = clamp(1.0 - d2 / w2, 0.0, 1.0);
  return x * x;
}

/* 3D VALUE NOISE IN ONE TEXTURE FETCH.
 *
 * Computed in the shader this is eight hashes and seven interpolations; here the sampler's bilinear unit does x
 * and y for nothing, the two channels carry slices z and z+1, and only the z mix is left. See valueNoiseTexture
 * in kit/glquad.js for how the offset packing works.
 *
 * The half-texel shift is required: a texture sample lands at a texel CENTER, and without it every lookup sits on
 * a corner and the hardware averages four lattice points that should have been one.
 */
uniform sampler2D uNoise;

float noise3(vec3 x){
  vec3 p = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = p.xy + vec2(37.0, 17.0) * p.z + f.xy + 0.5;
  /* textureLod, NOT texture. This is called from inside the march loop, which breaks early and is therefore
     non-uniform control flow -- where implicit derivatives are undefined and the hardware computes an LOD
     anyway. The texture has no mipmaps (MIN_FILTER is LINEAR, not LINEAR_MIPMAP_*), so that LOD can only
     ever be 0 and asking for it explicitly costs nothing in quality. */
  vec2 rg = textureLod(uNoise, uv / 256.0, 0.0).rg;
  return mix(rg.x, rg.y, f.z);
}

/* GAIN IS THE FLUFF CONTROL. Each octave contributes gain^n, so a low gain leaves the largest octave dominant and
 * the cloud reads as soft billows; a high gain keeps the fine octaves and it reads as wispy and torn.
 *
 * THE SUM STOPS AS SOON AS THE OCTAVES LEFT CANNOT CHANGE THE ANSWER, which is most of the time and was most of
 * this shader's cost. The only consumer of this is a smoothstep between lo and hi, and a partial sum already
 * bounds the finished one: the remaining octaves add at most rem and at least nothing. So a sum that cannot climb
 * to lo is a density of zero however it finishes, and one already past hi is a density of one — and in both cases
 * every fetch after it buys a number nobody reads. A tunnel is mostly empty, so most samples take the first exit.
 * Measured on an Intel UHD 630 at the shipped scene: 19.0 ms per frame down to 12.1.
 *
 * EXACT, NOT AN APPROXIMATION. The value comes back on the same side of the same threshold, so the frame is
 * byte-identical; only the work is smaller.
 *
 * inv IS THE FULL NORMALIZER AND HAS TO BE PASSED IN. Accumulating it here would renormalize against the octaves
 * that happened to run, which is a different field rather than the same one cut short — and it is one value per
 * frame, so the caller resolves it once outside the march.
 */
float fbm(vec3 p, int oct, float gain, float inv, float lo, float hi){
  float v = 0.0, rem = 1.0, a = 0.5 * inv;
  for (int i = 0; i < 5; i++){
    if (i >= oct) break;
    v += a * noise3(p);
    rem -= a;
    if (v + rem <= lo) return lo;
    if (v >= hi) return hi;
    p = p * 2.03 + vec3(1.7);
    a *= gain;
  }
  return v;
}

// The normalizer fbm needs to stop early, which is one value per frame rather than one per sample.
float fbmNorm(int oct, float gain){
  float a = 0.5, norm = 0.0;
  for (int i = 0; i < 5; i++){ if (i >= oct) break; norm += a; a *= gain; }
  return 1.0 / max(norm, 1e-4);
}

/* FILAMENTS, NOT FOAM OR CRUMBS.
 *
 * One noise field's mid-level is a SURFACE, and marching through surfaces gives cellular froth — not a bolt. Two
 * independent fields cross along a LINE, so the distance to both being zero picks out exactly that line.
 *
 * The falloff is exponential rather than a threshold on purpose. A hard cut leaves the filament only where the
 * march happens to land on it, which reads as scattered dust; a smooth kernel still has a value a step either
 * side, so the line survives being undersampled. sharp is the reciprocal thickness.
 *
 * NO BACKTICKS IN A COMMENT INSIDE THESE CHUNKS: the GLSL lives in a JS template literal and a backtick
 * closes it, after which the rest of the shader is parsed as JavaScript. It surfaces as a SyntaxError
 * naming a token far from the cause.
 */
float filament(vec3 p, float sharp){
  // ONE OCTAVE EACH, not two. A second octave doubles the fetches to roughen a field that is then squeezed
  // through the kernel anyway — the roughness barely survives it, and the smoother crossing gives a cleaner
  // line for half the cost.
  float a = noise3(p) - 0.5;
  float b = noise3(p * 1.31 + vec3(19.3, 7.1, 3.7)) - 0.5;
  return bump(a * a + b * b, 2.6 / sharp);
}
`;

/* One color ramp for all three effects, so "set the color" means the same thing everywhere.
 *
 *   mode 0 SOLID    color A only
 *   mode 1 BLEND    A to B across the effect's own gradient
 *   mode 2 RAINBOW  a cosine palette, hue-shiftable
 *
 * `t` MUST VARY SLOWLY ALONG A RAY. Integrating a hundred samples of a fast-cycling palette averages it to gray —
 * which is exactly what a density-driven gradient does here, because density is high-frequency. Each effect
 * therefore drives `t` from something coherent over depth: a slow band for the cloud, a per-streak constant for
 * the streaks. Color then survives the march instead of canceling out.
 */
export const PALETTE = `
vec3 ramp(float t, vec3 a, vec3 b, float mode, float hue){
  t = clamp(t, 0.0, 1.0);
  if (mode < 0.5) return a;
  if (mode < 1.5) return mix(a, b, t);
  return 0.5 + 0.5 * cos(TAU * (vec3(1.0, 0.85, 0.65) * t + vec3(0.0, 0.12, 0.28) + hue));
}
`;

/* THE TUNNEL, AND WHY THE RAY IS NOT NORMALIZED.
 *
 * With rd = vec3(uv, 1.0) a point at parameter t is exactly (uv * t, t): depth is t and radial distance from the
 * axis is |uv| * t. So the wall at radius 1 is reached at t = 1 / |uv| — which runs to infinity down the center of
 * the screen, and that divergence IS the tunnel. Normalizing would cost a sqrt per pixel and buy nothing.
 *
 * `dir` is constant along a ray, so the angular coordinate is computed once per pixel rather than per step. Only
 * the twist, which varies with depth, has to be applied inside the loop.
 */
export const TUNNEL = `
/* Radial falloff from the wall inward. COVERAGE 0 leaves a thin skin on the wall; 1 fills the tube to the axis.
 *
 * SOFT IS THE WALL'S EDGE, and it decides whether the tube reads as a surface or as weather. Wide, the density
 * climbs over a third of the radius and there is no boundary anywhere -- which is a cloud the camera happens to
 * be inside. Narrow, it arrives over a few percent and there is a wall with a mouth in it.
 *
 * THE TWO EDGES ARE FORCED APART. smoothstep with equal edges is undefined, and COVERAGE 0 produced exactly that
 * -- a NaN and a black frame at one end of a slider that anyone would try first.
 */
float wallProfile(float s01, float coverage, float soft){
  float e0 = min(1.0 - clamp(coverage, 0.0, 1.0), 0.996);
  float e1 = min(e0 + max(soft, 0.004), 0.999);
  return smoothstep(e0, e1, s01);
}

/* One layer's rotation about the tunnel axis: SPIN turns the whole field at a constant rate, TWIST turns it more
 * the further away it is, which is what corkscrews the tube. Both in one matrix because they are one rotation.
 *
 * Each layer applies its own, so the radial distance is computed BEFORE this and shared — length(xy) does not
 * change under rotation, so the wall profile is the same whatever any layer is doing.
 */
vec2 spin(vec2 xy, float ang){
  float c = cos(ang), s = sin(ang);
  return mat2(c, -s, s, c) * xy;
}

/* Jitter for the march start, so a fixed step count does not band into rings.
 *
 * BLUE NOISE, READ FROM THE TEXTURE'S SPARE CHANNEL. What limits how few steps this shader can take is not
 * banding but the LOOK of the leftover error: white noise puts energy at the low frequencies the eye is most
 * sensitive to and reads as clumpy grain, while blue noise pushes it high where the eye averages it away.
 * Interleaved gradient noise is cheaper still but its lattice prints a visible cross-hatch at these step counts.
 *
 * gl_FragCoord lands on pixel centers, so dividing by the texture size hits texel centers exactly and the LINEAR
 * filter returns the stored value rather than a blend of four. The tile repeats every 64 pixels.
 *
 * THE TILE MOVES EVERY FRAME, and that is what makes a low step count watchable. Held still, the leftover march
 * error is a FIXED pattern: the scene slides through it while the stipple stays nailed to the screen, which reads
 * as a dirty display rather than as grain. Offset per frame, the error is different noise each time and motion
 * averages it away — the eye does for free what another eight steps would have paid for.
 *
 * OFFSET BY WHOLE TEXELS. A fractional shift lands every lookup between four texels, the LINEAR filter blends
 * them, and the result is no longer blue noise — which is the one property this is here for.
 */
float dither(vec2 fc, float sec){
  vec2 o = floor(vec2(fract(sec * 21.7), fract(sec * 47.3)) * 256.0);
  return textureLod(uNoise, (fc + o) / 256.0, 0.0).b;
}
`;
