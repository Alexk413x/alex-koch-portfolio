/* The GLSL every wormhole effect shares, as named chunks the shader composes. Split out so noise, colour and the
 * tunnel mapping are written once: three effects sampling three slightly different noises is how a field stops
 * looking like one place.
 */

// Value noise and its fbm. `oct` is a uniform, so the loop is a fixed bound with an early break — GLSL ES 1.00
// will not accept a variable loop condition. The noise itself is a texture lookup; see below.
export const NOISE = `
#define TAU 6.28318530718

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

/* 3D VALUE NOISE IN ONE TEXTURE FETCH.
 *
 * Computed in the shader this is eight hashes and seven interpolations; here the sampler's bilinear unit does x
 * and y for nothing, the two channels carry slices z and z+1, and only the z mix is left. See valueNoiseTexture
 * in kit/glquad.js for how the offset packing works.
 *
 * The half-texel shift is required: a texture sample lands at a texel CENTRE, and without it every lookup sits on
 * a corner and the hardware averages four lattice points that should have been one.
 */
uniform sampler2D uNoise;

float noise3(vec3 x){
  vec3 p = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = p.xy + vec2(37.0, 17.0) * p.z + f.xy + 0.5;
  vec2 rg = texture2D(uNoise, uv / 256.0).rg;
  return mix(rg.x, rg.y, f.z);
}

/* GAIN IS THE FLUFF CONTROL. Each octave contributes gain^n, so a low gain leaves the largest octave dominant and
 * the cloud reads as soft billows; a high gain keeps the fine octaves and it reads as wispy and torn. */
float fbm(vec3 p, int oct, float gain){
  float v = 0.0, a = 0.5, norm = 0.0;
  for (int i = 0; i < 5; i++){
    if (i >= oct) break;
    v += a * noise3(p);
    norm += a;
    p = p * 2.03 + vec3(1.7);
    a *= gain;
  }
  return v / max(norm, 1e-4);
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
  // through an exponential anyway — the roughness barely survives the kernel, and the smoother crossing gives a
  // cleaner line for half the cost.
  float a = noise3(p) - 0.5;
  float b = noise3(p * 1.31 + vec3(19.3, 7.1, 3.7)) - 0.5;
  return exp(-(a * a + b * b) * sharp);
}
`;

/* One colour ramp for all three effects, so "set the colour" means the same thing everywhere.
 *
 *   mode 0 SOLID    colour A only
 *   mode 1 BLEND    A to B across the effect's own gradient
 *   mode 2 RAINBOW  a cosine palette, hue-shiftable
 *
 * `t` MUST VARY SLOWLY ALONG A RAY. Integrating a hundred samples of a fast-cycling palette averages it to grey —
 * which is exactly what a density-driven gradient does here, because density is high-frequency. Each effect
 * therefore drives `t` from something coherent over depth: a slow band for the cloud, a per-streak constant for
 * the streaks. Colour then survives the march instead of cancelling out.
 */
export const PALETTE = `
vec3 ramp(float t, vec3 a, vec3 b, float mode, float hue){
  t = clamp(t, 0.0, 1.0);
  if (mode < 0.5) return a;
  if (mode < 1.5) return mix(a, b, t);
  return 0.5 + 0.5 * cos(TAU * (vec3(1.0, 0.85, 0.65) * t + vec3(0.0, 0.12, 0.28) + hue));
}
`;

/* THE TUNNEL, AND WHY THE RAY IS NOT NORMALISED.
 *
 * With rd = vec3(uv, 1.0) a point at parameter t is exactly (uv * t, t): depth is t and radial distance from the
 * axis is |uv| * t. So the wall at radius 1 is reached at t = 1 / |uv| — which runs to infinity down the centre of
 * the screen, and that divergence IS the tunnel. Normalising would cost a sqrt per pixel and buy nothing.
 *
 * `dir` is constant along a ray, so the angular coordinate is computed once per pixel rather than per step. Only
 * the twist, which varies with depth, has to be applied inside the loop.
 */
export const TUNNEL = `
// Radial falloff from the wall inward. COVERAGE 0 leaves a thin skin on the wall; 1 fills the tube to the axis.
float wallProfile(float s01, float coverage){
  float inner = 1.0 - clamp(coverage, 0.0, 1.0);
  return smoothstep(inner, min(inner + 0.35, 0.999), s01);
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
 * A HASH, NOT INTERLEAVED GRADIENT NOISE. IGN is cheaper and better distributed, but its structure is a regular
 * lattice — at these step counts it prints a visible cross-hatch over the whole image. White noise is worse per
 * sample and much less noticeable, because the eye finds the pattern and not the noise.
 */
float dither(vec2 fc){
  return fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5453);
}
`;
