/* crt/crt-glsl-common.js — GLSL both shader programs need, and neither owns.
 *
 * ONE ENTRY SO FAR, and it is here rather than in crt-fixture-gl.js on purpose: the fitting does not use it.
 * Anything the FITTING is belongs in that module and travels with it; this is for snippets that are simply
 * shared plumbing, where putting them in one consumer would make the other consumer depend on something it
 * has no business knowing about.
 *
 * GLSL has no include, so these are strings and crt-gl composes them in.
 */
export const GLSL_HASH = `/* THE SAME IDEA, BUT IT SURVIVES A BIG ARGUMENT. sin(dot(p,...)) * 43758 is fine while p is a screen coordinate
 * and useless once it is not: uTime is wall-clock seconds, so a grain keyed on it hands sin() an argument around
 * 1e8, and float32 carries about seven digits -- every frame lands on the same quantised value and the "noise"
 * sits perfectly still. Measured: frame-to-frame spread 0.005 with the grain supposedly at full strength.
 * This one folds into fract() FIRST, so it never evaluates a transcendental at a large argument at all. */
float hash21(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}`;
