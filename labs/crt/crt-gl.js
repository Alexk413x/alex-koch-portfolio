/* crt/crt-gl.js — the tube as ONE render pass instead of thirteen composited surfaces.
 *
 * WHY THIS EXISTS, in one measurement: on an Intel UHD 630 at 6.7 device megapixels the DOM build runs the whole
 * instrument at 96-148ms a frame (7-10fps) with everything on, and every lever inside the CSS compositing model has
 * been tried and lost -- coarser flicker quantisation, plot-once-and-translate, plot-and-scale, a 24-bucket sweep,
 * `will-change` on two different groups, and an in-page resolution cap (106 -> 149ms, worse). The model is the
 * constraint: thirteen `mix-blend-mode` full-stage layers each need a real backing surface at device resolution, and
 * a shared-memory GPU cannot move that much traffic. Here a blend is `a+b-ab` in a register and there are no
 * surfaces to move. Measured on the same chip: 59.9fps.
 *
 * IT ALSO GETS THE ONE THING THE DOM CANNOT HAVE. A page cannot ask to be rastered at lower resolution -- measured,
 * twice -- but a canvas simply allocates a smaller backing store. `renderScale` is one assignment, and the mask,
 * scanlines and grille are GENERATED at output resolution regardless, so lowering it softens the picture without
 * softening the CRT structure.
 *
 * THE RULE THIS FILE IS BUILT AROUND: the shader does not know what the face's shape is. `crt-projection.faceProfile`
 * stays the single authority; buildFaceLUT samples it and inverts it numerically, and the shader does a texture
 * lookup. Geometry that can re-derive the surface is geometry that can disagree with it, which is the failure
 * `crt/README.md` exists to prevent -- so the GPU is given a table, never a formula.
 *
 * The colour constants are NOT invented here either: amber #f0a24a with a 255,150,60 halo and the #4a2c22 bezel
 * plastic are crt-phosphor's PH table and crt-bezel's base, converted to linear light at the call site.
 *
 * Pure in the same sense as its neighbours: no component state, no document beyond the canvas it is handed.
 */

import { FIXTURE_GLSL, FIXTURE_UNIFORMS } from './crt-fixture-gl.js';
import { GLSL_HASH } from './crt-glsl-common.js';

/* THE INVERSE MAP, AS A TABLE THE PROJECTION ITSELF GENERATED.
 *
 * Everything plotted in the DOM build is a FORWARD map: take a point on the ideal surface, push it through faceF,
 * emit it. A shader is a GATHER -- for each output pixel it must ask which source texel it came from -- so it needs
 * F inverse. For p = 2 that inverts in closed form, but writing the algebra here would be a second statement of the
 * projection and the two would drift the first time FALLOFF changed. So this samples the REAL profile densely and
 * inverts it by walking the (monotone) curve. Any p, any amplitude, no second opinion.
 */
export function buildFaceLUT(profile, N) {
  const n = N || 512;
  const u = new Float32Array(n);

  /* PINNED AT THE RIM, BECAUSE THAT IS WHAT THE LAB ACTUALLY DOES.
   *
   * crt-projection lists the unpinned rim as settled, and an earlier version of this file cited it while REMOVING
   * the F(1) normalisation. That was a regression, and reading only the module was how it happened: the lab
   * overrides that decision in its own code, with a comment saying why --
   *
   *     const k = f.pin == null ? f(1, 0) : f.pin;
   *     return (u, th) => f(u, th) / kk;
   *
   * "That objection belonged to the LENS: magnification there meant resampling an image, so the middle really was
   * stretched pixels. Nothing is resampled now."
   *
   * Measured on the shipped lab, FACE 0 -> OUT 90 makes the terminal block 11.4% wider and 11.5% taller and moves
   * it OUTWARD from centre. Unpinned, this renderer did the exact opposite -- minified the picture and pulled it
   * off the glass, leaving a bare band of bezel. The rim is pinned here so the two builds agree.
   *
   * THE LAB'S ESCAPE CLAUSE DOES NOT COVER THIS FILE, and that has to be paid for elsewhere. The lab plots
   * geometry, so its interior is regenerated at the new scale. This renderer GATHERS from a content texture, so
   * magnifying really is resampling and the middle really would be stretched pixels -- the exact bug the original
   * objection describes. The page compensates by sizing the content canvas by 1/F(1), so there is still at least
   * one source texel per output pixel after the magnification. Pin here, resolution there; neither alone is
   * enough.
   *
   * WHAT THE TABLE HOLDS is the RATIO F-inverse(s*F(1))/s, indexed by s = the glass-normalised screen radius,
   * which is exactly what aperture() returns and is 1 on the rim on every ray. Storing the ratio rather than the
   * radius matters: the shader would otherwise divide by s, and near the centre that is a ratio of two small
   * numbers where the table's own quantisation becomes a several-percent random scale -- which showed up as the
   * middle of the tube shimmering. The ratio is smooth and has a finite limit at the origin.
   */
  if (!profile) {
    u.fill(1);
    return { u: u, r1: 1, rimK: 1 };
  }
  const rimK = Math.max(0.5, 1 + profile.sg * profile.A);   // faceProfile's own denominator floor, at uB = 1
  const r1 = 1 / rimK;                                      // F(1), the pin
  const M = n * 8;
  const fu = new Float32Array(M + 1);
  for (let j = 0; j <= M; j++) fu[j] = profile.at(j / M);   // forward, over the source radius 0..1
  let j = 0;
  u[0] = r1;                          // the limit at the origin: F-inverse(s*r1)/s -> r1 as s -> 0
  for (let i = 1; i < n; i++) {
    const s = i / (n - 1);                                  // PINNED screen radius: 1 is the glass rim
    const target = s * r1;                                  // the unpinned radius the profile speaks in
    while (j < M && fu[j + 1] < target) j++;
    const lo = fu[j], hi = fu[j + 1] == null ? lo : fu[j + 1];
    const t = hi > lo ? (target - lo) / (hi - lo) : 0;
    u[i] = Math.min(1, (j + t) / M) / s;
  }
  return { u: u, r1: r1, rimK: rimK };
}

/* THE OUTLINE, AS A TABLE crt-geometry GENERATED -- for exactly the reason the face profile is one.
 *
 * The first version of this shader had its own superellipse: `pow(pow(x,e)+pow(y,e), 1/e)` with e mixed from
 * SQUIRCLE, plus a hand-rolled bend term. It looked close and it was a SECOND DESCRIPTION of the aperture, which
 * is the thing this project's one rule exists to forbid -- guideOutline already solves a normalised superellipse
 * with a bend that cannot leave the glass, clamps it to the box, and pins the corner vertex onto a sample so a
 * square measures its corner exactly. None of that survives being re-derived from the control value.
 *
 * So: sample rQ(theta) over the first quadrant and hand the GPU the answer. The outline is symmetric in both axes,
 * so a quadrant is the whole shape, and the shader folds its ray into it. Rebuilt when SQUIRCLE, BEND or the
 * aspect changes -- all settle-time events, none of them per frame.
 */
export function buildOutlineLUT(outline, N) {
  const n = N || 256, out = new Float32Array(n * 2);
  /* SAMPLED IN THE SHADER'S OWN PARAMETER, t = |y|/(|x|+|y|), not in theta. The shader cannot afford an atan per
   * pixel, so it indexes by that ratio; this table must therefore be built in the same coordinate or the two
   * describe different rays. t -> direction (1-t, t) -> the angle guideOutline wants.
   *
   * TWO CHANNELS, because the projection needs both of guideOutline's per-ray numbers and they must come from the
   * SAME sample. R is rQ, the outline's radius. G is wQ, the axis weight (1 - q^2)^2 -- 1 on the flat runs, 0 at
   * the diagonal -- which is what faceShaped bows the flats by. crt-geometry's own note is explicit that these
   * two are complements and cannot be allowed to disagree about which ray is a corner and which is a flat, so
   * interpolating them out of one texture fetch is the point, not a saving. */
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), ang = Math.atan2(t, 1 - t);
    out[i * 2] = outline.rQ(ang);
    out[i * 2 + 1] = outline.wQ ? outline.wQ(ang) : 0;
  }
  return out;
}

/* sRGB -> linear. Everything in the shader is linear light and tone-maps once at the end; the palette constants
 * are authored in sRGB because that is what crt-phosphor and crt-bezel publish. */
export function toLinear(rgb255) {
  return rgb255.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

const VERT = `#version 300 es
in vec2 p; out vec2 v;


void main(){ v = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

/* THE FITTING'S GEOMETRY AND SHADING, WRITTEN ONCE AND COMPILED INTO BOTH PROGRAMS.
 *
 * The fixture is traced in its own pass and sampled again by the main pass, so both programs need the same
 * ~850 lines: hitTube, hitBoxInside, litReach, tubeLight, axisDist, tubeVit, tubeSurface and traceFixture.
 * They used to exist as two verbatim copies. Nothing had drifted -- checked function by function before this
 * was extracted, all nine byte-identical -- but only because every edit to the fitting had to be made twice by
 * hand, and the failure it invites is silent: a reflection that disagrees with its own glow, with no error and
 * nothing to grep for. That is the same two-descriptions-of-one-thing bug crt/README.md says this directory
 * exists to prevent, one level up from the geometry.
 *
 * The two copies differed only in four blank lines. This is FRAG's spacing.
 */

const FIXTURE_FRAG = `#version 300 es
/* THE FIXTURE, RENDERED ONCE INTO ITS OWN TARGET SO ITS BLUR CAN BE PREFILTERED.
 *
 * MATTE is surface roughness, and rough reflections are a solved problem: rather than sampling N directions per
 * pixel, render the reflection once, build a mip chain over it, and choose the mip from the roughness. That is
 * what every real-time renderer does for glossy surfaces -- one textureLod instead of a loop -- and it makes the
 * cost CONSTANT and independent of how rough the glass is.
 *
 * The trace was costing 4 to 16 full ray-casts per pixel and could not hold 30fps. This pass costs one, once.
 *
 * IT NEEDS NOTHING FROM THE PICTURE. q is the raw screen coordinate -- (v - 0.5) * 2 -- with no dependence on
 * the face profile, the LUTs or anything the main pass computes, which is why the fixture can be lifted out
 * into its own pass at all.
 *
 * ALPHA CARRIES COVERAGE. Blurring a small bright object against black spreads it and dims it toward nothing,
 * which is why the fitting vanished at high MATTE. Writing coverage alongside colour lets the main pass divide
 * it back out, so the blur changes the SHAPE of the reflection without draining its brightness. */
precision highp float;
in vec2 v; out vec4 o;
/* EVERY UNIFORM THE MAIN PASS DECLARES, VERBATIM. Carrying only the ones a scan said were used
 * missed the ones this pass's own main() reads, and a missing uniform in GLSL is not an error -- it is a
 * silently undeclared identifier that fails to compile with a line number pointing somewhere else. The
 * compiler drops whatever is unused, so the whole list costs nothing and cannot be short. */
/* THE FITTING'S INPUTS COME FROM ITS OWN MODULE, and what follows is only what THIS pass adds on top --
 * the ray it builds and the fitting's placement. This block used to be every uniform the main pass
 * declares, copied verbatim; see the note beside FIXTURE_UNIFORMS for why that is not free. */
${FIXTURE_UNIFORMS}
uniform float uAspect, uFixH, uFixTilt, uFixW, uFixX, uFixY, uMainsPh, uOpenH, uOpenW, uRecess, uRipple, uTime;

${GLSL_HASH}
/* THE LAMP AS THREE PIECES: a glass barrel with a METAL SLEEVE over each end.
 *
 * Three wrongs before this. hitCyl solved an INFINITE cylinder and the caller hid the overshoot with an alpha
 * cut, so there was no end surface at all. Then hemispheres, which is a capsule, which is a bullet. Then a flat
 * disc, which is the right silhouette but still ONE cylinder -- and that is the thing that kept CAP LENGTH
 * looking broken. The cap was never a part; it was the same glass at a different colour, so no length ever made
 * it read as a fitting sitting on the tube.
 *
 * A real ferrule is FLUSH with the glass -- the cup is set into the end, not slipped over it, so the lamp is
 * one unbroken cylinder from tip to tip. What separates the cap from the tube is the MATERIAL, not a step in
 * the silhouette. It is still its own piece of geometry, because it needs its own surface to shade and its own
 * end disc to close, and CAP LENGTH is how far down the tube it reaches.
 *
 * Body, then two sleeves, then a disc closing each sleeve. Nearest hit wins. */
${FIXTURE_GLSL}

void main(){
  vec2  q   = (v - 0.5) * 2.0;
  vec2  sp2 = vec2(q.x * uAspect - uFixX, q.y - uFixY);
  float ct = cos(uFixTilt), st = sin(uFixTilt);
  float ripple = 1.0 - uRipple * 0.5 * (0.5 - 0.5 * cos(uMainsPh * 6.2831853));
  float flkA = uFlkA * ripple, flkB = uFlkB * ripple;
  float halfLen  = uFixW * uAspect;
  float tubeR    = uFixH;
  float tubeRlit = tubeR * (1.0 + uFrost * 1.8);
  float tubeZ    = -uRecess * 0.6;
  vec3  boxHi = vec3(uOpenW * uAspect, uOpenH, 0.0);
  vec3  boxLo = vec3(-uOpenW * uAspect, -uOpenH, -max(uRecess, 1e-3));
  vec3  room  = traceFixture(sp2, ct, st, boxLo, boxHi, halfLen, tubeR, tubeRlit, tubeZ, flkA, flkB);
  float cov   = step(1e-5, dot(room, vec3(1.0)));
  o = vec4(room, cov);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;

// uFix  the fixture, traced once and mip-filtered; uFixLods is how many levels its chain has
${FIXTURE_UNIFORMS}
uniform sampler2D uFix;
uniform float uFixLods;
uniform sampler2D uContent, uBloom, uPrev, uFace, uOutline;
uniform float uTime, uAspect;
uniform float uOverscan, uFaceN, uBow, uOutlineN;
uniform float uScanN, uScanW, uScanA, uGrilleN, uGrilleW, uGrilleA;
uniform vec3  uGrilleInk;
uniform float uPhos, uBloomAmt, uBright, uBeam;
uniform float uVig, uVigFall, uHeat, uSagA, uSagU0, uSagP;
uniform float uSweep, uSweepOn, uSweepH;
/* THE BEAM TIP AND WHAT IT DRAGS BEHIND IT.
 *   uHSweep   how fast the tip crosses, as a rate; 0 parks it
 *   uDotRX/RY its radii, already in suv -- the caller measures them in GRILLE COLUMNS and SCANLINES and
 *             converts, so the spot is round in RASTER CELLS rather than round on the glass
 *   uDotLvl   how hard it drives the coating under it
 *   uSweepSol how square the V-sweep's own profile is -- 0 is the old gaussian, 1 a hard-edged line
 *   uSweepRGB the three guns' vertical split ACROSS the sweep, in screen pixels
 *   uBeamPull how far the active line is dragged off true as the tip loads the supply, in screen pixels */
uniform float uHSweep, uDotRX, uDotRY, uDotLvl, uSweepSol, uSweepRGB, uBeamPull;
/* uSweepDip  how far the coating ahead of the beam has fallen before it is refreshed
 * uDipFall   how quickly it recovers going down, in multiples of the sweep's own height */
uniform float uSweepDip, uDipFall;
/* uSweepStep  how far the line has drifted down by the time the beam gets back to a column, in suv
 * uDotHalo    the coating lit AROUND the cell, on the same nits scale as uDotLvl */
uniform float uSweepStep, uDotHalo;
/* uTipRGBX/Y  the guns' split across the tip, on each axis, already in suv. The caller measures X in
 * grille COLUMNS and Y in SCANLINES, the units each axis of the tip is sized in. */
uniform float uTipRGBX, uTipRGBY;
/* uBeamConv  extra convergence error where the beam is passing, in suv x -- the yoke is working hardest
 *            on the line it is writing, so the guns land furthest apart there
 * uDipNoise  how much of the un-refreshed region ahead of the beam is static rather than a clean fade */
uniform float uBeamConv, uDipNoise;
// uPullInk  how much harder the beam drags where it is actually driving content, as a fraction of BEAM PULL
uniform float uPullInk;
/* uRipple   depth of the mains ripple -- a fluorescent runs at TWICE mains, so 100Hz on a 50Hz supply
 * uMainsPh  that ripple's PHASE, 0..1, computed on the CPU -- see the note where it is used */
uniform float uRipple, uMainsPh;
/* uCapLen  the end cap, as a FRACTION of the tube's own half-length -- see the note in tubeSurface for why
 * it is expressed that way rather than as a length. */
/* THE DIFFUSER, IN ITS THREE REAL FORMS -- these are what sits between the tubes and the room on an actual
 * fitting, and which one it is changes the light more than any other single thing about it.
 *   uFrost    a scattering sleeve ON the tube: the source gets bigger and softer, the glass stops glinting
 *   uDiffuse  an opal panel ACROSS the aperture: the tubes stop being visible at all and the whole opening
 *             glows at whatever irradiance reaches it
 *   uPrism    a ridged acrylic lens: the aperture is cut into vertical flutes that alternate bright and dark
 *   uPrismN   how many flutes across the opening */
// uRailW  thickness of the four mounting rails; their overhang and fade are 4x and 2x it (the lab's ratios)
// uRecess  the housing's depth behind the aperture, in the fixture's own units
uniform float uRecess;
/* uSweepWhite  how far the beam's own light runs toward white, away from the phosphor's colour */
uniform float uSweepWhite;
/* uPwr  THE POWER COLLAPSE: what is left of the picture's width and height, 1,1 at rest.
 *
 * A tube switching off does not fade. The deflection supply dies before the beam does, so the raster falls in on
 * itself -- vertical first, to a bright line across the middle -- and only then goes out. That is a transform on
 * what the tube EMITS, and on nothing else: the room is still in the glass, the moulding is still plastic. The
 * split this shader already keeps between emission and reflection -- the line where emis is multiplied by
 * uFlicker -- is exactly that boundary, so the collapse lands on the emission side of it and needs no second
 * opinion about where that boundary runs.
 *
 * The LEVEL rides on uFlicker, which is already the tube's own output this frame. Only the GEOMETRY is here. */
uniform vec2 uPwr;
/* THE MAGNET. uWarpK is (pinch, pull, swirl, rgb) and a zero vector switches the whole thing off; uWarpPos is the
 * pole, in the picture's own 0..1 coordinate; uWarpR is (reach, rim knee) -- how far the pole's field carries, and
 * how far in from the edge the raster stops being clamped. The MOTION is not here -- the page sweeps the pole and
 * shapes the envelope, because that is a timeline and this is a field. See the note at the use site. */
uniform vec4 uWarpK;
uniform vec2 uWarpPos;
uniform vec2 uWarpR;
uniform vec2 uWarpD;
uniform float uFlicker, uPersist, uGlowAmt, uGlowFall;
uniform vec2 uConvR, uConvG, uConvB;
uniform vec4 uTextRect;
uniform float uFixX, uFixY, uFixW, uFixH, uFixTilt, uOpenW, uOpenH;
uniform float uSheen, uGlare;
// uSheenR  how far the scatter reaches, IN THE FIXTURE'S OWN UNITS -- so it is a real distance in the room
uniform float uSheenR;
// uResH  the render target's height in pixels -- MATTE's blur radius is a real screen distance
uniform float uResH;
// uFixSolo  the fixture on its own, straight to the screen -- a bench view, not a look
uniform float uFixSolo;
uniform float uSpot;
// uTubeDead  how much a SPENT section of a lamp still shows. 1 is the old fixed floor, 0 is truly black.
uniform float uFrame, uFrameW, uFrameOn, uFrameFit;
/* TWO LAMPS, TWO COLOURS. A pair of tubes in one fitting are rarely the same age and almost never the same
 * batch, and colour temperature is the first thing to drift as a phosphor blend ages -- one goes green,
 * one stays white, and that mismatch is one of the most recognisable things about real fluorescent light.
 * uLamp survives as the pair's average, for the things that see the fitting as a single source. */
uniform vec3  uInk, uHalo, uLamp;
uniform vec3  uBzBase, uBzLo, uBzHi;
uniform float uBzInner, uBzLocal, uBzPhos, uBzLamp;

const float PI = 3.14159265;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
${GLSL_HASH}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}

/* THE APERTURE IS A LOOKUP, NOT A FORMULA. uOutline holds crt-geometry.guideOutline's rQ() over the first
 * quadrant, in the same units as the incoming ray. Fold the ray in (the outline is symmetric in both
 * axes), read the rim's radius on that ray, and divide: 1.0 lands on the rim by construction, not by
 * tuning. NO BACKTICKS IN HERE -- this comment lives inside a template literal, and one closes it. */
float outlineR(vec2 cc){
  /* INDEXED BY |y|/(|x|+|y|), NOT BY THE ANGLE. Same ray, same lookup, but atan() is a transcendental evaluated
   * once per pixel and this is a divide. Measured on the UHD 630 at 2.9MP: the atan version alternated 16.7/33.3
   * (30fps, 55% dropped). The parameter is monotone in theta over the first quadrant, so it orders the rays
   * identically -- buildOutlineLUT samples in the SAME parameter, so the table and the index cannot disagree. */
  /* texelFetch AND AN EXPLICIT LERP, not texture(). uOutline is RG32F, and a 32-bit float texture is NOT
   * filterable in WebGL2 without OES_texture_float_linear -- so a texture() fetch on it is NEAREST whatever the
   * sampler says. That made the aperture PIECEWISE CONSTANT across the table's angular steps, which means every
   * iso-contour of ap -- the moulding's inner edge, the vignette, the elevation rings, the clip -- was a polygon
   * rather than a curve. It reads as sharp angles in the glass, and the calibration grid makes it obvious because
   * straight grid lines run right across the facets.
   *
   * The face LUT already had this fixed; this one was missed. Two fetches and a mix do the interpolation the
   * sampler will not, exactly, and cost one extra tap on a 1D table that is almost certainly in cache. */
  vec2 a = abs(cc);
  float t = a.y / max(a.x + a.y, 1e-6);
  float x = clamp(t, 0.0, 1.0) * uOutlineN;
  float i = floor(x);
  float r0 = texelFetch(uOutline, ivec2(int(i), 0), 0).r;
  float r1 = texelFetch(uOutline, ivec2(int(min(i + 1.0, uOutlineN)), 0), 0).r;
  return max(mix(r0, r1, x - i), 1e-5);
}
float aperture(vec2 cc){ return length(cc) / outlineR(cc); }

/* THE EXCITED AREA OF COATING, AS A SHAPE RATHER THAN A BLURRED COPY OF THE GLYPHS.
 *
 * This was two blur passes over the content at 1/16 -- which follows the text's own distribution, so it came out
 * lumpy: brighter between the long lines, dimmer at the ragged right edge, and shaped like the writing rather
 * than like the region being driven. A phosphor area does not know what is written on it. What it knows is that
 * a rectangle of it is being scanned, and that rectangle glows fairly evenly with a soft edge.
 *
 * So it is a rounded-box distance field over the block's measured bounds. Uniform inside by construction --
 * exp(0) is 1 everywhere within the rect -- and falling off outside at a rate GLOW FALLOFF sets in fractions of
 * the screen. That also deleted both blur passes and their two render targets.
 */
float glowField(vec2 uv){
  if (uTextRect.z < 0.0) return 0.0;                       // nothing typed yet
  vec2 mid = (uTextRect.xy + uTextRect.zw) * 0.5;
  vec2 hs  = (uTextRect.zw - uTextRect.xy) * 0.5;
  vec2 d   = abs(uv - mid) - hs;
  float outside = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return exp(-max(outside, 0.0) / max(uGlowFall, 1e-3));
}

/* THE RADIAL SCALE AT A GIVEN SCREEN RADIUS. uFace holds F-inverse(r)/r over 0..F(1); past the rim the profile is
 * the straight line F(u) = u/(1+sg*A), so the ratio is the constant rimK and no table is needed. Continuous at
 * the join by construction: the last sample is 1/r1, which is rimK.
 *
 * texelFetch AND AN EXPLICIT LERP, not texture(). R32F is not filterable in WebGL2 without OES_texture_float_linear
 * -- asking for LINEAR on it silently returns 0, which this file has already been bitten by once (the 7x zoom).
 * Fetching the two neighbours and mixing does the interpolation the sampler will not, exactly, for one extra tap.
 * Never clamped: a clamp here would flatten the scale at the rim and smear the last row of the picture across the
 * gap outside it, and that gap is real. */
float faceK(float r){
  float x = clamp(r, 0.0, 1.0) * uFaceN;
  float i = floor(x);
  float a = texelFetch(uFace, ivec2(int(i), 0), 0).r;
  float b = texelFetch(uFace, ivec2(int(min(i + 1.0, uFaceN)), 0), 0).r;
  return mix(a, b, x - i);
}

// A rounded-rect field, used for the fluorescent tubes and the recess behind them.
float rrect(vec2 p, vec2 b, float r){
  vec2 d = abs(p) - b + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

/* ---- THE FIXTURE, AS GEOMETRY ------------------------------------------------------------------------
 * Local space: x along the tubes, y across them, z into the screen. The opening is the z = 0 plane and the
 * recess runs back to z = -depth, so the ray enters through the opening and hits the inside of the box.
 */

// Ray vs an infinite cylinder along X at (y0, z0). Returns the near root, or -1.
/* THE LAMP AS THREE PIECES: a glass barrel with a METAL SLEEVE over each end.
 *
 * Three wrongs before this. hitCyl solved an INFINITE cylinder and the caller hid the overshoot with an alpha
 * cut, so there was no end surface at all. Then hemispheres, which is a capsule, which is a bullet. Then a flat
 * disc, which is the right silhouette but still ONE cylinder -- and that is the thing that kept CAP LENGTH
 * looking broken. The cap was never a part; it was the same glass at a different colour, so no length ever made
 * it read as a fitting sitting on the tube.
 *
 * A real ferrule is FLUSH with the glass -- the cup is set into the end, not slipped over it, so the lamp is
 * one unbroken cylinder from tip to tip. What separates the cap from the tube is the MATERIAL, not a step in
 * the silhouette. It is still its own piece of geometry, because it needs its own surface to shade and its own
 * end disc to close, and CAP LENGTH is how far down the tube it reaches.
 *
 * Body, then two sleeves, then a disc closing each sleeve. Nearest hit wins. */
${FIXTURE_GLSL}

void main(){
  vec2 uv = v;
  vec2 c  = (uv - 0.5) * 2.0;
  c.x *= uAspect;
  vec2 q  = vec2(c.x / uAspect, c.y);          // square space, for the aperture and the fixture

  /* THE GLASS SHRINKS SO THE GLASS PLUS ITS MOULDING FILLS THE VIEWPORT, rather than the moulding growing off
   * the edge of it. The outline spans the whole box, so a frame drawn from ap = 1 outward had nowhere to go and
   * was simply cut by the canvas -- WIDTH past a few percent ran the moulding off the stage and took the tube's
   * corners with it.
   *
   * Scaling the aperture is the whole fix: multiply ap by 1 + WIDTH and the rim lands at 1/(1 + WIDTH) of the
   * outline, which puts the moulding's OUTER edge exactly where the glass rim used to be. The picture follows
   * automatically, because the gather is indexed by ap -- so the content shrinks with the glass instead of
   * needing a second scale that could disagree with it. Exactly 1 when the frame is off, so nothing moves. */
  float oR = outlineR(c);
  float ap = length(c) / oR * uFrameFit;

  /* ---------------------------------------------------------------- THE MOULDING
   * THE THREE TONES ARE crt-bezel's, NOT MINE. bezelCols() already solves this: base is the body, lo is the
   * shadowed outer edge (the plastic mixed 42% toward black), hi is the sheen along the lit edge, and tint is the
   * phosphor and the lamp mixed by FRAME LIGHT with its glow^1.6 lift. The first version of this block invented a
   * ramp from the raw #4a2c22 and a couple of exponentials -- plausible, and a second opinion about a colour the
   * project already computes. So the ramp interpolates between the tones it is HANDED.
   *
   * hi -> base -> lo runs inward-to-outward because the lit edge is the one facing the glass: the moulding is lit
   * by the room AND by the tube's own face, which is why bezelCols takes the phosphor as an argument at all.
   *
   * The grain is noise rather than an feTurbulence over 140% of the stage -- which cost the DOM build 54.2ms
   * until it became a tiled pattern, the single biggest win in that file. */
  float aaB = max(fwidth(ap), 1e-5);
  vec3 mouldCol = vec3(0.0);
  float mouldCov = 0.0;
  /* ENTERED A PIXEL EARLY, so the band straddling the rim computes BOTH the moulding and the picture and
   * can blend them. Outside that band nothing changes: a pixel fully inside the moulding still returns
   * here without touching the gather, and a pixel fully on the glass never runs this at all. */
  if (ap > 1.0 - aaB) {
    // FRAME OFF is no moulding at all, not a black one: past the glass is simply outside the tube.
    /* THE MOULDING IS A CONSTANT WIDTH, NOT A CONSTANT FRACTION.
     *
     * ap is length(c) over the outline's radius on that ray, so a flat 1 + uFrameW is a fraction of THAT radius
     * -- and the radius is 1.29x longer on the long axis of this tube than the short one, so the frame came out
     * 29% thicker down the sides than across the top. A real moulding is a moulded part with one wall thickness.
     *
     * Dividing by the outline radius converts the distance back into the ap units this test is in, which makes
     * the band a fixed number of units wide on every ray. Radially fixed rather than perpendicular-fixed: the two
     * agree exactly on the axes and at the diagonal, where the radius IS the surface normal by symmetry, and
     * differ only slightly in between -- far closer to uniform than a fraction ever was, for one divide. */
    float outer = 1.0 + uFrameW * uFrameFit / oR;
    if (uFrameOn < 0.5 || ap > outer + max(fwidth(ap), 1e-5)) { o = vec4(0.006, 0.006, 0.007, 1.0); return; }
    float t = (ap - 1.0) / max(uFrameW, 1e-4);          // 0 at the glass, 1 at the outside edge
    vec3 col = mix(uBzHi, uBzBase, smoothstep(0.0, max(uBzInner, 0.02), t));
    col = mix(col, uBzLo, smoothstep(max(uBzInner, 0.02), 1.0, t));
    /* A MOULDING IS NOT A LIGHT SOURCE, and until this line it was behaving like one.
     *
     * These three tones are crt-bezel's, and that module models illumination as a MIX TOWARD A LIT COLOUR --
     * litAmt runs 0.18 to 1.0 and the result is always the plastic's own colour blended some way toward the
     * lamp's. Nothing in it ever reaches black, because it is answering "what colour is this plastic" and a
     * colour is a reflectance. That is the right answer to the question it was asked. It is the wrong thing to
     * PAINT, because what you see is reflectance times the light arriving, and with no light arriving you see
     * nothing at all.
     *
     * It never showed up before because the two things that can darken it are switches: crt-bezel takes power
     * and lightOn, so a room switched off still counted as a room. The mains fault is the case that breaks it --
     * the switch says the fitting is on while its output is momentarily zero -- and the surround went on quietly
     * glowing its own brown through a blackout. Measured: peak 102 of 255 on a frame with no light in the scene.
     *
     * So the base is scaled by what is actually falling on it this frame, from the only two sources there are:
     * the fitting, and the tube's own face. Both already exist as live values here. At the shipped state the
     * fitting alone saturates the clamp, so nothing about a lit room changes -- verified by measurement, not by
     * argument. The additive terms below were always gated correctly and are left alone. */
    /* HOW MUCH SCREEN THERE IS LEFT TO LIGHT ANYTHING WITH -- the power collapse, spent on the frame.
     *
     * uFlicker already carries the tube's LEVEL, so the moulding's screen-lit terms dimmed correctly with the
     * power switch. What they had no idea about was the tube's AREA. Switching off drives the level to 4.4x
     * while the raster shrinks to a three-pixel line, and the frame took the 4.4 and none of the shrink -- so at
     * the exact moment the picture folded away to nothing, the surround flared to its brightest. The screen
     * appeared to go out while the plastic around it lit up, which is the opposite of what a collapsing raster
     * does to its own bezel.
     *
     * Flux is level times area, and uPwr is what is left of both axes, so their product IS the area. At rest it
     * is 1x1 and nothing changes; at the line it is about 0.006, so the 4.4x strike throws roughly 3% of a full
     * screen's light -- which is what a bright hairline actually illuminates. The same factor makes the strike
     * on the way UP arrive in the right order too: the frame stays dark until there is a raster to light it,
     * instead of announcing the picture before it exists. */
    float pwrArea = clamp(uPwr.x * uPwr.y, 0.0, 1.0);
    /* WHAT THE PAIR IS ACTUALLY PUTTING OUT, flux AND condition together -- and the condition half was missing.
     *
     * This was max(uFlkA, uFlkB): the flicker multiplier alone. That is how hard each tube is being DRIVEN this
     * instant, and says nothing about how much coating is left to answer. So a pair of tubes at 10% health threw
     * exactly as much light on the moulding as a new pair, and only the tubes themselves looked tired -- the
     * reference hit the same bug and its --tout note records the same fix. Everything else the fitting lights
     * already reads both: the box interior, the rails' spill, the diffuser panel, the per-tube halo and the
     * scatter all take uLampX * flkX * uHealthX. This was the one surface still taking half the story.
     *
     * MEAN, NOT MAX, following the reference: a single pool of light cannot be two brightnesses, and the tube
     * bodies and their halos are where the difference between the two lamps belongs. Identical at the shipped
     * state, where both are at full flux and full health and mean and max are both 1. */
    float lampOut = (uFlkA * uHealthA + uFlkB * uHealthB) * 0.5;
    float roomLit = uFixture * lampOut;
    /* THE SCREEN'S SHARE. crt-bezel's own note says the tube's face "throws enough light on a surrounding
     * moulding to keep its edge readable in a dark room", which is exactly this term; 3.0 puts a default tube
     * with the room off at about a quarter lit, which is that sentence's "readable". */
    float tubeLit = uFlicker * uPhos * uBright * pwrArea * 3.0;
    col *= clamp(roomLit + tubeLit, 0.0, 1.0);
    /* THE PHOSPHOR LIGHTS THE FRAME WHERE THE PICTURE IS ACTUALLY BRIGHT, not uniformly.
     *
     * uBzTint is one colour that bezelCols mixes across the entire moulding at one strength. That is a statement
     * about the tube's AVERAGE output, so it reads as a general glow coming off the monitor and cannot respond to
     * anything: a line of text hard against the left edge lights the right side of the frame exactly as much.
     *
     * A bezel is lit by whatever is next to it. Walking this ray back to the glass rim gives the content
     * ADJACENT to this piece of frame, and the bloom buffer already holds that content blurred -- which is what
     * scattered light off a diffuse plastic surface is. So the tint keeps its colour and gains a local weight.
     *
     * At ap = 1 the pin makes k exactly 1, so the rim's source coordinate is just the ray scaled back to the rim
     * -- no LUT fetch needed. Falls off across the frame's width, because the far edge of the moulding is further
     * from the glass than the near one. */
    vec2 cRim = c / max(ap, 1e-4);
    /* SAMPLED INWARD FROM THE RIM, not at it. The first version read the bloom exactly at the glass edge and
     * measured nothing, because the content there is black: the terminal block is inset from the raster and the
     * outermost texel of the picture is empty on every side. What lights a bezel is the bright thing NEAR it, so
     * three taps stepping in along the ray pick up a line of text sitting close to that edge whether it is
     * touching it or not. Max rather than mean -- one bright line should light the frame beside it, and averaging
     * it against the empty rows either side is how it disappears. */
    /* THE PHOSPHOR'S OWN EMISSION, AVERAGED -- not the bloom.
     *
     * uBloom is thresholded at BLOOM KNEE, so it carries only the brightest peaks: it is text-SHAPED by
     * construction, and bleeding it onto the moulding put a blurred copy of the glyphs on the plastic. What
     * actually lights a bezel is the coating next to it glowing, dim parts included. So this reads uContent --
     * the phosphor's emission before any threshold -- at several points along the rim and AVERAGES them, which is
     * what a diffuse surface integrating the light reaching it does. Averaged, not max: max is right for "is
     * there a bright line here", wrong for "how much light is falling on this".
     *
     * Squared to linear, because uContent is stored gamma-encoded and this is being added to a linear-light
     * accumulator -- the same conversion the picture goes through a few lines below. */
    /* ONE FETCH OF THE GLOW BUFFER, not sixteen taps of a disc. The disc existed because there was no
     * low-frequency copy of the content to read -- so it averaged one by brute force, at 16 taps per moulding
     * pixel. uGlow is that copy, blurred at 1/16 and unthresholded, which is both smoother than the disc and a
     * sixteenth of the cost. The sweep still has to be added by hand: it is generated in the picture path, which
     * this block returns before. */
    vec2 srcRim = cRim * uFrameFit / uOverscan;
    srcRim.x /= uAspect;
    vec2 uvRim = srcRim * 0.5 + 0.5;
    float spR = 1.0 - fract(uTime * uSweep);
    float sweepR = exp(-pow((uvRim.y - spR) / max(uSweepH * 3.0, 1e-4), 2.0))
                 + exp(-pow((uvRim.y - spR) / max(uSweepH * 7.0, 1e-4), 2.0)) * 0.4;
    vec3 bleed = vec3(glowField(uvRim) * 0.05) + vec3(sweepR * uSweepOn * 0.02);
    bleed *= exp(-t * 2.2);
    /* ADDED, NEVER SUBSTITUTED. A first attempt scaled the uniform tint down by the local weight so the two
     * summed to one -- which meant turning SCREEN BLEED up REMOVED the average lift faster than the local one
     * replaced it, and the whole moulding went darker. Measured: -19.8 on the lit edge at full bleed. The
     * uniform tint is the tube's ambient contribution and is still true; the local term is what the picture is
     * doing right here, on top of it. */
    /* NOT TINTED TWICE. This multiplied the sample by uBzTint, and the sample already carried the phosphor's
     * colour -- so the product went as R^2 > G^2 > B^2 and the moulding lit up a saturated red that no phosphor
     * emits. The light leaving the glass is the coating's own colour; the plastic only scales how much of it
     * comes back. uHalo is that colour, published by crt-phosphor and the same constant the wash and the bloom
     * are tinted with, so all three agree about what amber is. */
    /* THE FLAT TINT IS GONE. It mixed ONE colour across the WHOLE moulding at one strength -- a statement
     * that the plastic is that colour everywhere, which is the one thing a lit surface never is. Everything it
     * was standing in for now exists properly: the moulding takes the phosphor's own light where the picture is
     * near it, the fixture's where the lamp is, and its base colour where neither reaches. A uniform wash over
     * the top of all three could only ever flatten them back out. COLOUR still sets the plastic itself. */
    /* GAIN, because area-averaging dilutes. The disc covers a patch of coating the text only partly
     * fills, so the mean is a fraction of the glyphs' own brightness -- correct as a measure of the
     * light arriving, and invisible on the plastic without a scale. 28 puts SCREEN BLEED 1 at a clearly
     * readable pool while leaving room above the default 0.6. */
    col += uHalo * bleed * uBzLocal * 70.0 * uFlicker * pwrArea;

    /* TWO MORE LIGHTS ON THE MOULDING, and they are different things with different shapes.
     *
     * SCREEN GLOW -- the whole phosphor layer, on the lip facing the glass. SCREEN BLEED above answers "what is
     * bright right HERE", which is why it is local and why an empty corner of the frame stays dark. But a lit
     * tube also throws its average output at whatever surrounds it, and that reaches the inner edge of the bezel
     * everywhere at once, brightest where the plastic faces the glass and falling off across its width. uPhos is
     * the coating's own level and uBright is how hard it is being driven, so their product is what the layer is
     * putting out; uHalo is its colour. Falls off sharply -- exp(-t*4) is most of the way gone by the middle of
     * the frame, which is what a lip lit edge-on looks like.
     *
     * LAMP -- the fixture, on the whole bezel, from wherever it actually is. A room light is above the monitor,
     * so the top of the moulding catches it and the bottom sits in its own shadow. Weighted by height RELATIVE TO
     * uFixY, so moving the fixture moves the highlight instead of it being baked to "up"; uLamp is kelvinRgb's
     * colour temperature, so the tint follows TEMP. Deliberately weak per unit -- this is bounced room light, not
     * a key light -- with the slider carrying the range. */
    /* SCREEN GLOW -- the tube's own output reflected across the whole bezel, in the SCREEN's colour.
     *
     * This was a tight exp(-t*4) lip, mostly gone by the middle of the frame. That is what a lit EDGE looks like,
     * not what a reflection looks like: a bezel sitting in front of a lit tube picks the screen up across its
     * whole face, brightest nearest the glass and falling off gently, the same broad shape the fixture's light
     * has. So it keeps a bias toward the inner edge and reaches the outer one.
     *
     * AND IT FLICKERS. uFlicker is the tube's own output modulation -- if the screen dips, so does everything it
     * is lighting. The moulding block returns before the picture path, so it never saw it and the reflection sat
     * perfectly steady over a guttering tube, which reads as a painted-on highlight. Applies to the local pool
     * too, for the same reason. */
    float phosOut = uPhos * uBright * uFlicker * pwrArea;
    col += uHalo * uBzPhos * phosOut * 2.2 * mix(1.0, 0.30, t);

    /* THE LIGHT FIXTURE, across the whole bezel, from wherever it actually is. A room light is above the monitor,
     * so the top of the moulding catches it and the bottom sits in its own shadow. Weighted by height RELATIVE TO
     * uFixY, so moving POS Y moves the highlight rather than it being baked to "up"; uLamp is kelvinRgb's colour,
     * so the tint follows TEMP. Scaled by the lamp's own flicker, not the screen's. */
    float lampW = smoothstep(-0.35, 0.95, q.y - uFixY);
    /* GATED ON uFixture, AND WITHOUT IT THE FITTING LIT THE FRAME WHILE SWITCHED OFF.
     *
     * uFlkA and uFlkB are flicker MULTIPLIERS, and crt-flicker returns exactly 1.0 from bulbFlick when a tube is
     * not flickering -- including when it is not running at all, which is the correct answer to "how much is this
     * lamp's output being modulated" and a completely wrong one to "how much light is there". So max(uFlkA, uFlkB)
     * is 1 in a dark room, and this term went on painting a lamp highlight across the top of the moulding with
     * every lamp in the scene dead. Measured with the room switched off and the tube powered down: peak 102 of
     * 255, all of it here -- it dropped to the backdrop the moment FRAME was turned off, which is what identified
     * it. uFixture is the fitting's own gate and is the thing that actually says whether there is a lamp. */
    col += uLamp * uBzLamp * lampW * 0.55 * lampOut * uFixture;
    col *= 0.90 + 0.20 * noise(q * 260.0);              // moulding grain
    /* FRAME FADES IN DISPLAY SPACE, NOT IN LINEAR LIGHT, so the number on the panel is the opacity it claims.
     *
     * It was col *= uFrame, ahead of the tone map and the gamma -- the same mistake GLARE carried. Scaling
     * radiance is the physically honest operation and a useless control, because both curves after it compress
     * what you just did: measured, FRAME at 10% already showed 39% of the moulding's full brightness and 50%
     * showed 79%. Four fifths of the visible range lived in the bottom half of the travel.
     *
     * Fading the FINISHED tone is exact rather than approximately right -- no exponent fitted to a measurement,
     * because the fade happens after every curve that would have distorted it. 0 is the same black it always
     * was and 1 is the same moulding, since the multiply is a no-op at both ends. */
    vec3 m = col / (1.0 + col);
    // NOT CLAMPED AT 1: the control runs to 1.5 and always has, so past full it over-drives the finished tone
    // toward white rather than being a fade. Only the 0..1 half is an opacity, which is the half that was wrong.
    m = pow(max(m, 0.0), vec3(1.0/2.2)) * max(uFrame, 0.0);
    mouldCol = m;
    /* COVERAGE AT BOTH EDGES. The inner one is new: this block used to return unconditionally for ap > 1, so the
     * moulding REPLACED the picture along a hard threshold and the join stair-stepped exactly as its outer edge
     * did. There was no glass colour to blend toward because the gather had not run yet -- so the fix is to let
     * the boundary band fall through and composite at the end instead. */
    mouldCov = smoothstep(1.0 - aaB, 1.0 + aaB, ap);
    /* THE OUTER SILHOUETTE IS ANTIALIASED. The band test above is binary, so the moulding's outside edge was a
     * hard threshold against near-black -- a stair-step, worst at the corners where the boundary runs diagonally
     * across the pixel grid. fwidth(ap) is how much ap changes across one pixel, which is exactly the width the
     * transition needs to be, so one smoothstep resolves it at any frame width or zoom.
     *
     * ONLY THE OUTER EDGE. The inner one, where the moulding meets the glass, cannot be done here: this branch
     * returns before the picture is gathered, so there is no glass colour to blend toward. Fixing that means
     * compositing the moulding OVER the picture instead of replacing it -- the right architecture, and a
     * restructure of main() rather than a line. Recorded rather than half-done. */
    if (ap > 1.0 + aaB) {
      o = vec4(mix(m, vec3(0.006, 0.006, 0.007), smoothstep(outer - aaB, outer + aaB, ap)), 1.0);
      return;
    }
  }

  /* ---------------------------------------------------------------- THE PICTURE */
  float r    = length(c);
  float rn   = r / length(vec2(uAspect, 1.0));    // circular; only the aberration and vignette want this

  /* THE WARP IS MEASURED AGAINST THE GLASS, NOT AGAINST A CIRCLE -- and that was the bug.
   *
   * Normalising by the box DIAGONAL, as this did, makes the field's level sets circles: u = 1, where the whole
   * bend lives, is then only ever reached at the four corners. On a 16:10 stage the left and right edge midpoints
   * topped out near 0.85 and the top and bottom near 0.53, so the corners took all of the bend, the flat runs got
   * almost none, and nothing the warp did lined up with the edge of the glass. That is the same "a dome whose
   * iso-contours are the wrong shape is not a dome" failure faceShaped exists to fix, reappearing on the gather
   * side of the same geometry.
   *
   * faceShaped's answer is G(u,th) = rho * F(u/rho), with rho the aperture radius over the box radius on that ray.
   * Divide through and u/rho is just the radius measured in GLASS units -- which is exactly what aperture()
   * already returns: ap is 1 on the outline, on every ray, squircle and bend included. So in that coordinate the
   * shaped projection IS the plain one, and gathering through it is a single inverse:
   *
   *     u_glass = F-inverse(ap),   k = u_glass / ap
   *
   * Level sets are now the outline's own shape, so the bend tracks the edge of the glass by construction rather
   * than by tuning -- and the whole rho/box normalisation cancels instead of being carried around.
   *
   * NO uFaceAmt. It was state.face passed straight through as a mix weight while the LUT was ALREADY built from
   * the signed angle state.face * 90, so the face was applied twice -- and once FACE gained its IN half the weight
   * went negative, where mix() extrapolates rather than blends: at IN 90 this evaluated to 2 - k, a mirrored
   * convex warp instead of a concave one. k carries the entire projection on its own.
   */
  /* AND faceShaped's BOW ON THE FLAT RUNS, which rho cannot supply. The outline normalises its own bulge by its
   * peak, so rho is exactly 1 on both axes at every BEND -- meaning everything BEND does to rho happens at the
   * DIAGONAL. faceShaped therefore pushes the flats out with a separate term, weighted by the axis weight wAx,
   * and without it here the picture and the plotted grid disagree by ~2% on the axes at the shipped BEND and
   * ~5% at its top. Two descriptions of one surface drifting apart is the bug class this project is built to
   * avoid, so the gather carries the term rather than approximating it away.
   *
   * Forward it is  ap = F(u/rho) * (1 + bow*wAx*u^2), which is implicit in u. One fixed-point step closes it:
   * the bow is at most 5%, so seeding with the un-bowed solve leaves an error of order bow^2. */
  vec2  an   = abs(c) / vec2(uAspect, 1.0);
  float sBox = max(an.x, an.y);                                  // 1 on the box edge, on every ray
  float rho  = clamp(ap > 1e-5 ? sBox / ap : 1.0, 0.05, 1.0);
  vec2  ac   = abs(c);
  float t2   = ac.y / max(ac.x + ac.y, 1e-6);        // aperture()'s own ray parameter, same table
  // Interpolated for the same reason as the radius above -- a stepped bow would crease the flats.
  float xw   = clamp(t2, 0.0, 1.0) * uOutlineN;
  float iw   = floor(xw);
  float wAx  = mix(texelFetch(uOutline, ivec2(int(iw), 0), 0).g,
                   texelFetch(uOutline, ivec2(int(min(iw + 1.0, uOutlineN)), 0), 0).g, xw - iw);
  float b    = uBow * wAx;
  float bs   = 1.0;                                              // the bow, as a scale on the sampled radius
  if (b > 1e-5) { float ug = ap * faceK(ap) * rho; bs = 1.0 / (1.0 + b * ug * ug); }
  float k    = faceK(ap * bs) * bs;                              // no divide by ap anywhere: nothing to cancel
  /* SCALED BY uFrameFit TOO, or the picture does not follow the glass. Shrinking the aperture alone moved the
   * rim, the mask and the vignette inward while the raster stayed the size it was, so at WIDTH 0.30 the text ran
   * straight off the left of the tube. c is in box units and the glass rim now sits at 1/uFrameFit of the
   * outline, so the source coordinate has to be stretched by the same factor for the raster's edge to land back
   * on it -- at the rim that gives |src| = k, which is 1 under the pin, exactly as it was before the frame
   * existed. */
  vec2 src   = c * uFrameFit * k / uOverscan;
  src.x /= uAspect;
  vec2 suv = src * 0.5 + 0.5;

  /* THE COLLAPSE, APPLIED TO THE PICTURE'S OWN COORDINATE -- so everything drawn IN that coordinate follows it.
   *
   * Dividing suv by the remaining extent squeezes the content, the scan pattern, the beam and the bloom into the
   * surviving band together, because all four are functions of suv and none of them is free to disagree with it.
   * That is the same grouping the DOM lab gets structurally, by putting every beam-drawn layer inside the element
   * carrying the animation: what the tube emits collapses, and the glass in front of it does not.
   *
   * pwrCov is the band's EXTENT, and it is measured in the box coordinate rather than in the raster's, which is
   * what makes it a true no-op at rest. The raster stops short of the glass on a convex face -- that gap is what
   * inRaster below exists to cover -- so gating anything on the raster's own bounds would dim the rim whenever
   * FACE is out. an is 1 at the box edge on each axis, so at uPwr = 1,1 the whole face is inside the band.
   *
   * Guarded by a uniform branch: at rest neither line runs, so no arithmetic here can perturb the shipped look. */
  float pwrCov = 1.0;
  if (uPwr.x < 0.999 || uPwr.y < 0.999) {
    suv = (suv - 0.5) / max(uPwr, vec2(2e-4)) + 0.5;
    // fwidth, so the band's edge is one pixel wide at every stage of the collapse. A hard step on a 3px-tall
    // line crawls as it shrinks, which reads as the line stuttering rather than closing.
    vec2 aw = max(fwidth(an), vec2(1e-5));
    pwrCov  = (1.0 - smoothstep(uPwr.x - aw.x, uPwr.x + aw.x, an.x))
            * (1.0 - smoothstep(uPwr.y - aw.y, uPwr.y + aw.y, an.y));
  }

  /* ================================================================ THE MAGNET
   *
   * A magnet held against a shadow-mask tube bends the BEAM, not the glass. Everything the beam is responsible for
   * therefore moves together: the glyphs, the calibration grid, the scanline it is currently writing, the mask it
   * writes through, the bloom that light casts. Nothing about the faceplate moves at all.
   *
   * That is one line here, and it is the same line the collapse above uses. suv IS the beam's own coordinate, so
   * displacing it drags every one of those things by construction -- they cannot disagree, because there is only
   * one description of where the beam landed. The DOM lab could not do this: its layers are separate elements and
   * its warp is a CSS transform, so it transforms the TEXT and leaves the scanlines and the wash standing still.
   * Its own note says so, and calls the alternative "the tube wobbling rather than the picture in it". Here the
   * distinction is kept by WHAT the coordinate feeds rather than by which elements are inside a transform.
   *
   * THE RIM STAYS PINNED. warpRim is 0 on the box edge and rises inward, so the picture stays welded to the glass
   * however hard the field pulls -- the deflection error goes to zero where the raster is clamped. Without it the
   * whole picture slides and the tube reads as a photograph being dragged, which is the thing this must not be.
   *
   * Three fields, summed, all rim-pinned:
   *   PINCH   a pole behind the middle of the tube: everything is drawn inward, hardest where the rim is furthest.
   *           Sampling FARTHER OUT is what pulls the picture IN -- the content from further out lands here.
   *   PULL    a moving pole at uWarpPos, gaussian-bounded by uWarpR, dragging the raster toward itself.
   *   SWIRL   the same pole's tangential component. A real field twists as well as attracts, and the twist is what
   *           makes it read as magnetic rather than as a lens.
   *
   * uWarpK is (pinch, pull, swirl, rgb) and a zero vector skips all of it.
   *
   * ALL FOUR COMPONENTS GATE THIS, and testing only .xyz was a silently dead control. warpF -- how hard the
   * field bites at this pixel -- is computed in here, and the gun split downstream multiplies by it. So with
   * PINCH, PULL and SWIRL all at zero the branch never ran, warpF stayed 0, and GUN SPLIT did nothing at any
   * setting: a slider with a readout, moving a number that could not reach the picture. The split is a real
   * effect of the field on its own -- three beams pushed apart with the raster left where it was is exactly
   * what a weak stray field does -- so the whole vector decides whether there is a field, not three quarters
   * of it. Measured before the fix: red, green and blue all displaced 0.00px at GUN SPLIT 40. */
  float warpF = 0.0;                       // how hard the field is biting here -- the guns' split rides on it
  /* THE TRIAD, SOLVED ONCE AND SPENT THREE TIMES. These are the three guns' displacements under the field, and
   * everything the guns draw reads them: the picture, the sweep band, and the beam's own tip. They were computed
   * inline at the picture's convergence site, which meant the field split the CONTENT while the beam writing it
   * stayed perfectly converged -- a raster laying down three separate images with one undivided spot, which is
   * not a thing a magnet can do to a tube. One description here, three consumers below. */
  vec2 wgR = vec2(0.0), wgG = vec2(0.0), wgB = vec2(0.0);
  if (dot(uWarpK, uWarpK) > 1e-9) {
    /* SMOOTHSTEP, NOT A LINEAR TAPER. A linear rim mask has a corner at the edge, and a corner in a displacement
     * field is a visible crease running right around the picture. This lands flat against the rim. */
    float warpRim = 1.0 - smoothstep(clamp(uWarpR.y, 0.0, 0.98), 1.0, max(an.x, an.y));
    vec2  q  = suv - 0.5;
    vec2  d  = suv - uWarpPos;
    float r  = length(d) / max(uWarpR.x, 1e-3);
    float fall = exp(-r * r);                                  // the pole's reach, soft-bounded
    vec2  dir  = r > 1e-4 ? d / max(length(d), 1e-6) : vec2(0.0);
    vec2  tang = vec2(-dir.y, dir.x);                          // tangential: the twist
    /* DRAG -- THE WHOLE RASTER SHOVED BODILY, and it is what makes this read as a big magnet rather than a
     * small one. PULL and SWIRL are bounded by the pole's own gaussian, so however hard they are driven they
     * only ever disturb a patch: the picture around them stays put and the effect has a radius you can see. A
     * real coil held near a tube does not politely confine itself -- the whole picture leans. This term has no
     * falloff at all, only the rim clamp, so it moves everything together; the CPU points it, because where the
     * pole is relative to the middle is a timeline question, not a per-pixel one. */
    vec2  off  = uWarpD                                        // DRAG, the entire picture leaning
               + q * uWarpK.x                                  // PINCH, toward the middle of the tube
               + dir * uWarpK.y * fall                         // PULL, toward the pole
               + tang * uWarpK.z * fall;                       // SWIRL, around it
    suv  += off * warpRim;
    /* THE SPLIT RIDES ON THE WHOLE FIELD, not on the pole's gaussian alone. It used to be the fall times the rim
     * mask, so the guns only parted inside the pole's own radius -- which is why the fringing stayed local no
     * matter how far GUN SPLIT was driven. The drag is a field too, and a picture leaning bodily is three beams
     * leaning by three different amounts. Floored at the drag's own share so the separation reaches everywhere
     * the displacement does. */
    warpF = clamp(max(fall, length(uWarpD) * 6.0), 0.0, 1.0) * warpRim;
    /* THE THREE GUNS' OWN DISPLACEMENTS -- see the note where these are declared.
     *
     * A delta-gun tube seats its cathodes in a triangle in the neck, 120 degrees apart, so each enters the field
     * at a different place and leaves it displaced a different way. Green takes a smaller share because it is
     * the reference the other two are converged against; moving it as far reads as the whole picture sliding
     * rather than as the guns parting.
     *
     * Taken from the DISPLACED suv, so the split follows the field where the field has already dragged the beam
     * to -- which is where those electrons actually are. */
    if (uWarpK.w > 1e-6) {
      vec2 wd = suv - uWarpPos;
      wd = length(wd) > 1e-5 ? normalize(wd) : vec2(1.0, 0.0);
      float amt = uWarpK.w * warpF;
      // +/-120 degrees, written out rather than called: cos = -0.5, sin = +/-0.8660254.
      wgR = wd * amt;
      wgG = vec2(wd.x * -0.5 - wd.y *  0.8660254, wd.x *  0.8660254 + wd.y * -0.5) * amt * 0.55;
      wgB = vec2(wd.x * -0.5 + wd.y *  0.8660254, wd.x * -0.8660254 + wd.y * -0.5) * amt;
    }
  }

  /* THIS GATES THE CONTENT, AND ONLY THE CONTENT.
   *
   * A convex face leaves screen area with no CONTENT behind it -- F(1) < 1, so the source raster's rim lands
   * inside the glass rim and crt-projection refuses to close that gap. The content texture is CLAMP_TO_EDGE, so
   * without this test the last row of glyphs is dragged out to the rim and the gap reads as a stretch.
   *
   * BUT IT MUST NOT GATE THE TUBE. An earlier version multiplied the phosphor, the scanlines AND the grille by
   * this, which switched the tube's own surface off outside the text raster and drew a hard dark rectangle inside
   * the glass -- measured against the reference lab at identical settings, where the phosphor reaches the rim on
   * every ray and there is no rectangle at all. The phosphor coats the whole faceplate; the scanlines are the
   * beam's path across that faceplate. Neither is a property of the content, and neither ends where the text
   * does. Only the glyph sample stops here. */
  float inRaster = (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) ? 1.0 : 0.0;

  /* GLASS DEPTH IS GONE, and this note is here so the parallax is not reinvented as an improvement.
   *
   * It modelled the phosphor sitting a few millimetres behind the faceplate, so the picture was picked up at a
   * small offset from where the eye was looking -- zero on axis, growing toward the rim. Real, and defensible on
   * paper. The arithmetic was c * thick * 0.004 halved into suv, which at the top of its range put the rim about
   * four thousandths of the picture off true: eight pixels on a 2013-wide buffer, on the one part of the tube
   * where the projection is already compressing hardest and the scan pattern is finest. Nothing in the picture
   * could be pointed at and attributed to it.
   *
   * What it DID do was displace the coordinate that the content, the bloom and the glow are all sampled through,
   * so every one of those had to carry an offset that never earned its place. puv still exists because BEAM PULL
   * genuinely does move the picture off the raster -- that is a real, visible, timed effect -- and it needs a
   * coordinate of its own to do it in. It simply starts level with suv now. */
  vec2 puv = suv;

  /* THE LINE BEING DRAWN GETS DRAGGED OFF TRUE, and it is the tip that drags it.
   *
   * A raster is not a picture that appears; it is one dot laid down a row at a time. Driving that dot costs
   * current, and on a real set the horizontal deflection loading the supply is visible as the active line
   * bending or stepping away from where the geometry says it should be -- worst at the extremes of the sweep,
   * where the yoke is working hardest and the supply has sagged furthest.
   *
   * So the displacement is the product of three things: how close this pixel is to the line currently being
   * written, how far out toward the SIDES it sits, and which side the tip is on right now. The tip crossing
   * left to right therefore rocks the ends of the active line up and then down, and the rest of the picture --
   * everything the beam is not touching this instant -- stays exactly where it was.
   *
   * APPLIED TO puv ONLY, so it moves the PICTURE and not the raster. The scanlines and the grille are the
   * beam's path across the faceplate; they are where they are. What bends is the content being laid onto them,
   * which is the whole distinction this file keeps between the surface and what is drawn on it.
   *
   * hx is computed here rather than in the sweep block below because the sample stage needs it first. It is a
   * SAWTOOTH like the vertical one, and for the same reason the reference gives: a beam that eases into its
   * turn draws attention to the turn. It crosses, then retraces. */
  /* THE TIP PING-PONGS, so uHSweep is now a ROUND TRIP and not a crossing.
   *
   * A real yoke retraces -- it flies back dark and starts the next line from the same side -- which is why the
   * vertical sweep is a sawtooth and why this used to be one too. This is the deliberate departure from that:
   * the turn is the interesting part here, because the step in the line has to change which side it is on, and
   * a retrace would snap it rather than swing it. */
  float hPhase = fract(uTime * uHSweep);
  float hx     = 1.0 - abs(2.0 * hPhase - 1.0);     // 0 -> 1 -> 0, a triangle
  float spY = 1.0 - fract(uTime * uSweep);
  /* HOW LONG AGO THE BEAM WAS LAST AT THIS COLUMN -- which is the only thing that sets how far the line has
   * drifted, and the reason the first version jumped.
   *
   * That version asked a yes/no question: is this column ahead of the tip or behind it, given which way the tip
   * is going. At the turn the direction flips, so every column's answer flips with it, and the entire line
   * swapped heights in one frame. The tip reversing is not supposed to move anything -- it is supposed to carry
   * on downward from where it already is.
   *
   * Asking "when was the beam last here" has no such moment. The tip crosses each column twice per round trip,
   * once on the way out at u = x/2 and once on the way back at u = 1 - x/2, so the age is the smaller of the two
   * gaps and it varies smoothly everywhere -- including through the turn, where the tip is at an edge and the
   * only discontinuity sits at the edge with it.
   *
   * The one jump that REMAINS is at the tip itself, which is where it belongs: step across the beam and the age
   * goes from nothing to half a trip. That is the corner, and it travels with the tip instead of the line. */
  float ageOut  = fract(hPhase - suv.x * 0.5);        // last passed here on the way out
  float ageBack = fract(hPhase - 1.0 + suv.x * 0.5);  // ...or on the way back
  float lastSeen = min(ageOut, ageBack);              // 0 right at the tip, up to a full trip away from it
  float spLine  = spY - uSweepStep * lastSeen;
  if (uBeamPull > 0.0001 && uSweepOn > 0.001) {
    float onLine = exp(-pow((suv.y - spY) / max(uSweepH * 2.2, 1e-4), 2.0));
    /* TWO PARTS, BECAUSE THE SIDE-ROCK ALONE IS INVISIBLE ON A TYPICAL FRAME.
     *
     * The rock is the honest half: the supply sags most where the yoke works hardest, so the ENDS of the active
     * line move and the middle barely does, and which way they move follows the tip across. But displacement
     * only SHOWS where there is something to displace, and a terminal block sits mid-picture -- measured, a
     * 20px pull moved four thousand pixels and not one of them was near an edge, because no content is. A
     * control that is correct and invisible is the failure this project keeps having.
     *
     * So a local kink travels WITH the tip as well. That is not a fudge: the loading is caused by the beam, and
     * it is worst immediately around the beam. The two together mean the picture always shows the tip passing,
     * and still rocks hardest at the extremes where a real set does. */
    float nearTip = exp(-pow((suv.x - hx) / max(uDotRX * 8.0, 0.03), 2.0));
    float toSide  = abs(suv.x - 0.5) * 2.0;         // 0 in the middle, 1 at either end of the line
    /* IT DRAGS HARDER WHERE THERE IS SOMETHING TO DRAW. The sag is the supply being loaded, and what loads it
     * is beam CURRENT -- so a line the beam is crossing with the gun shut costs nothing, and a line full of lit
     * glyphs costs the most. A pull that ignores the content is modelling the deflection and forgetting the
     * thing doing the deflecting.
     *
     * Read at the UNdisplaced position, necessarily: the displacement is what we are about to compute, so it
     * cannot also be its own input. One extra tap, inside a branch that is already gated on the pull being on
     * and the sweep running, so it costs nothing whenever either is off. */
    float ink = max(max(texture(uContent, puv).r, texture(uContent, puv).g), texture(uContent, puv).b);
    float load = 1.0 + uPullInk * ink * inRaster;
    puv.y += uBeamPull * onLine * load * (nearTip * 0.65 + toSide * (hx - 0.5) * 2.0 * 0.35);
  }

  // CONVERGENCE ERROR: the three guns do not land on the same triad, and the error grows off-axis.
  /* CONVERGENCE, SPLIT INTO ITS TWO AXES, because on a real tube they are not the same number.
   *
   * The three guns sit on a horizontal line -- that is what "in-line" means -- so the red and blue beams are
   * displaced from green along x at the gun and land either side of it on the screen. The horizontal error is the
   * one the geometry creates and it is typically the larger of the two. The vertical error comes from a different
   * cause: the deflection yoke's field is not perfectly uniform top to bottom, so misconvergence there is a
   * separate adjustment on a real set -- which is why service manuals list H and V static convergence as two
   * controls and not one.
   *
   * Both still grow as rn^2. Convergence is exact on axis by construction (the guns are aimed there) and the
   * error accumulates with deflection angle, so a quadratic in the normalised radius is the right shape for both;
   * only the coefficient differs. Setting V to 0 gives the classic in-line behaviour, which is why it is a
   * separate slider rather than a fixed fraction of H. */
  /* CONVERGENCE IS PER GUN NOW, and it is a STATIC offset rather than a deflection error.
   *
   * This was one signed pair driving red and blue apart symmetrically, scaled by rn^2 -- the dynamic convergence
   * error, exact on axis and growing toward the corners. That is the right law for the residual a service
   * technician cannot adjust out, and the wrong one for setting the guns up by hand: at rn^2 nothing moves in the
   * middle of the screen, so at the text block a 40px setting displaced about 20 and it read as barely working.
   *
   * A real set has three guns, each adjustable in x and y, and static convergence is exactly that -- a uniform
   * shift of one raster against another. So each gun gets its own pair, applied evenly across the face, and
   * green is adjustable too rather than being an assumed reference. The old symmetric pair is a special case of
   * this: RED X = +n with BLUE X = -n.
   *
   * The uniforms arrive in content-uv, converted from CSS px by the page against the stage's own size -- so the
   * number is a screen distance and survives both devicePixelRatio and RENDER SCALE. */

  /* THE BEAM SPOT. A CRT drags a gaussian along a line rather than sampling a bitmap, so a stroke blooms ALONG
   * the scan and stays tight across it. Five taps with the spot's own anisotropy -- wider in x than y -- is what
   * turns "text on a screen" into "text drawn by a beam", and it is the cue that was missing entirely. The taps
   * are in CONTENT space so they follow the warp with everything else. */
  /* THE SPOT IS MEASURED IN SCREEN PIXELS, via fwidth. Scaling it by the scanline COUNT was wrong by two
   * orders of magnitude -- it put the taps ~15px apart, which is not a beam spot, it is a ghost. A real
   * spot is on the order of one pixel across, wider along the scan than across it. */
  /* THE BEAM DISTURBS CONVERGENCE ON THE LINE IT IS WRITING, and that is why the sweep passing over text
   * should smear its colour and not merely displace it.
   *
   * Static convergence is the error with the yoke at rest. The line being scanned right now is the one the yoke
   * is actually working on, so the guns land further apart there than they do anywhere else on the face -- an
   * error that arrives with the beam and leaves with it. BEAM PULL already moved the picture as the beam went
   * by; this moves the three guns by DIFFERENT amounts, which is what makes the text fringe rather than shift.
   *
   * Red and blue take equal and opposite offsets and green stays put, the same in-line geometry the CONVERGENCE
   * section models -- so this reads as the same defect getting momentarily worse, not as a second unrelated one. */
  float onLineC = uBeamConv > 1e-6
                ? exp(-pow((suv.y - spLine) / max(uSweepH * 2.5, 1e-4), 2.0)) * uSweepOn : 0.0;
  vec2 cR = uConvR + vec2( uBeamConv, 0.0) * onLineC;
  vec2 cG = uConvG;
  vec2 cB = uConvB + vec2(-uBeamConv, 0.0) * onLineC;
  /* THE FIELD SPLITS THE GUNS, and it belongs HERE rather than as a filter over the finished picture.
   *
   * The DOM lab fringes its warp with an SVG channel-split filter -- the only tool it had -- which offsets the
   * three channels of an already-rendered image by a constant. A magnet does not do that: it deflects three
   * beams of the same energy through slightly different paths, so the split follows the FIELD, is strongest
   * where the field is strongest, and points along it. This build already models the guns separately for
   * CONVERGENCE, so the warp has somewhere real to put its error: the same three offsets, pushed apart in
   * proportion to how hard the field is biting at this point. Red out, blue back, green the reference -- the
   * same geometry the panel's own CONVERGENCE rows describe, which is what makes it read as that defect getting
   * worse under the magnet rather than as a coloured ghost laid over the top. */
  /* THREE DIRECTIONS, NOT ONE AXIS -- because that is where the guns actually are.
   *
   * This pushed red and blue equal and opposite along a single line, which is right for STATIC convergence (the
   * yoke's error is one axis) and wrong for a stray field. A delta-gun tube carries its three cathodes in a
   * TRIANGLE in the neck, 120 degrees apart, so each one enters the field at a different place and comes out
   * displaced a different way. One shared axis can only ever produce a red-to-blue fringe -- the same coloured
   * edge everywhere -- where a real magnet smears a white glyph into three separate ghosts that walk apart.
   *
   * So each gun takes the field direction rotated by its own seat in the triad. Green at 120 rather than 0 keeps
   * it off the red/blue line entirely; it carries a smaller share because it is the reference the other two are
   * converged against, and moving it as far reads as the whole picture sliding rather than as the guns parting. */
  cR += wgR; cG += wgG; cB += wgB;

  vec2 texel = vec2(fwidth(suv.x), fwidth(suv.y));
  vec2 spot = vec2(uSpot * 1.35, uSpot * 0.42) * texel;
  vec3 emis = vec3(0.0);
  float wsum = 0.0;
  // THREE TAPS, NOT FIVE. The outer pair carried exp(-3) = 0.05 of the weight and cost two texture
  // fetches per pixel each; dropping them is invisible and measurable.
  for (int i = -1; i <= 1; i++) {
    float fi = float(i);
    float wt = exp(-fi * fi * 0.75);
    vec2  o  = vec2(spot.x * fi, 0.0);
    emis += vec3(texture(uContent, puv + o + cR).r,
                 texture(uContent, puv + o + cG).g,
                 texture(uContent, puv + o + cB).b) * wt;
    wsum += wt;
  }
  emis /= wsum;
  /* Across the scan the spot is tight, so only a single extra pair, close in.
   *
   * PER GUN HERE TOO, and forgetting it made the convergence controls look dead. This is a max() against the tap
   * loop above, and on a bright glyph it WINS -- so sampling it at puv with no offset pulled all three channels
   * back onto the unshifted raster and undid the displacement the loop had just applied. Measured: a 120px green
   * offset moved the green edge 3.5px. Every place the content is fetched has to agree about where each gun is
   * pointing, or the one that disagrees decides. */
  emis = max(emis, 0.55 * (texture(uContent, puv + cR + vec2(0.0, spot.y)).rgb +
                           texture(uContent, puv + cR - vec2(0.0, spot.y)).rgb) * 0.5 * vec3(1.0, 0.0, 0.0)
                 + 0.55 * (texture(uContent, puv + cG + vec2(0.0, spot.y)).rgb +
                           texture(uContent, puv + cG - vec2(0.0, spot.y)).rgb) * 0.5 * vec3(0.0, 1.0, 0.0)
                 + 0.55 * (texture(uContent, puv + cB + vec2(0.0, spot.y)).rgb +
                           texture(uContent, puv + cB - vec2(0.0, spot.y)).rgb) * 0.5 * vec3(0.0, 0.0, 1.0));

  /* THE CONTENT CARRIES ITS OWN COLOUR NOW, and the version this replaces was a second opinion about it.
   *
   * That one drew the text white and remapped luminance to ink-or-highlight in here, which is a rule about which
   * glyphs are bright -- and crt-terminal.bootLines already decides that: labels take ph.fg, values take ph.hi,
   * and it carries a targeted rule for WHITE phosphor where hi cannot be brighter than fg so the contrast has to
   * come from below. A luminance threshold in a shader cannot express any of that, and would flatten exactly the
   * case that module went to trouble over.
   *
   * So the texture arrives already coloured and this only has to linearise it -- the canvas is sRGB, the rest of
   * this shader is linear light. 2.2 rather than the piecewise curve: the difference is under a code value in the
   * near-black where the text sits, and this is a per-pixel path. */
  vec3 lin = pow(max(emis, 0.0), vec3(2.2));
  float lum = dot(lin, vec3(0.299, 0.587, 0.114));
  emis = lin * uBright * uBeam * inRaster;   // the CONTENT stops at the raster

  /* PERSISTENCE, ON THE BEAM ONLY -- and the distinction is the whole difference between a decaying phosphor and
   * a compounding fog. Reading the previous COMPOSITE back in feeds the glass reflections, the wash and the bloom
   * into their own input, so the frame settles at a bright fixed point instead of fading: the face went pale grey
   * where the reference is nearly black. The alpha channel of the history buffer carries the beam's luminance and
   * nothing else, so what decays is what the phosphor emitted. */
  float prevBeam = texture(uPrev, uv).a;
  float beamLum  = dot(emis, vec3(0.299, 0.587, 0.114));
  // uInk, not the sampled colour: a decaying phosphor glows in ITS OWN emission colour whatever was
  // written to it, which is why persistence reads amber on a white glyph rather than white.
  emis = max(emis, uInk * prevBeam * uPersist);
  beamLum = max(beamLum, prevBeam * uPersist);

  /* THE SHADOW MASK: STROKES AT A PITCH, NOT A COSINE -- and that is what the reference actually draws.
   *
   * The DOM build strokes N lines with 'vector-effect="non-scaling-stroke"', so the LINE WIDTH is in rendered
   * pixels and is set directly rather than derived from the pitch. Its own comment is explicit that this replaced
   * a duty cycle precisely so width and spacing could move independently. A cosine ties them back together: it has
   * no width of its own, only a period, so it can only ever produce soft bands where the reference has hairlines
   * with gaps between them.
   *
   * N comes from crt-controls' PPI rule -- round(span * density / 100), the picture's height for H and its width
   * for V -- computed on the CPU and handed in, so the density means here what the panel says it means.
   *
   * WIDTH IN SCREEN PIXELS THROUGH A WARPED COORDINATE is what fwidth is for: it reports how much the line index
   * changes per screen pixel, so dividing by it converts a distance-to-line into pixels no matter how hard the
   * dome is compressing that part of the picture. The lines stay one pixel wide at the rim, which is exactly what
   * a non-scaling stroke does and what a cosine cannot.
   *
   * INK: black for the horizontal pass, warm #2a1608 for the vertical one. crt/README.md records those as the one
   * thing fixed in code rather than controlled, so they are not mine to choose. Both MULTIPLY -- applied to the
   * beam before anything glows, which is the paint order the DOM stack could never get right because
   * screen-blended glow kept lifting the dark lines back up. */
  /* THE WASH IS ADDED BEFORE THE MASK, and that ordering is the whole reason the cell grid is visible.
   *
   * It used to sit after: the mask multiplied the beam, then the wash was added on top of the result, so the
   * face away from the glyphs was a flat lift with no structure in it and the grid only showed where the text
   * was. The reference has it woven across the ENTIRE face. The wash is phosphor emission -- the same coating,
   * just excited by scatter rather than by the beam -- so the shadow mask occludes it for the same reason it
   * occludes everything else the phosphor emits. Multiply on black is black; the mask needs something to bite. */
  /* THE WASH IS THE ONLY EMISSION OUT ON EMPTY GLASS, so it is what the shadow mask has to bite into -- and
   * cutting it is how the scan pattern stopped covering the background.
   *
   * It was briefly 0.0121, calibrated so the empty glass matched the reference's measured 13.3/255. That number
   * was right and the conclusion drawn from it was wrong: at the time most of this build's brightness was
   * REFLECTION being added after the mask, so matching the total meant starving the part that actually passes
   * through it. With the layer order fixed -- emission above the mask, reflection below, the same stack the
   * reference uses -- the wash is modulated rather than merely added, so it can carry its own weight again.
   *
   * The reference's own note is explicit that a scan pattern on an unlit tube is SUPPOSED to be faint, and warns
   * against chasing it with alpha. This is not that: it is restoring the emission the pattern modulates, which is
   * the mechanism that note describes. */
  emis += uHalo * uPhos * 0.055;                                  // phosphor wash, BEFORE the mask

  /* NO NYQUIST FADE HERE, AND THE ATTEMPT IS WORTH RECORDING.
   *
   * A previous pass added smoothstep(0.5, 0.25, fwidth(n)) to both masks, on the theory that rendering at
   * renderScale and upscaling put the one-pixel structure near the sampling limit and beat into the large
   * diagonal bands visible on the empty glass. It was the wrong diagnosis. Those bands were the DITHER, which was
   * being added in linear light at a fixed amplitude before the tone map -- see the note at the end of main().
   * With that fixed, the empty glass measures 1.9 non-uniformity against the reference's 5.7, and the fade turned
   * out to be costing the thing it was supposed to protect: high-frequency energy on the faceplate measured 0.508
   * against the reference's 1.240, so it was erasing 60% of the phosphor cell grid to solve a problem that was
   * never there.
   *
   * If aliasing is ever a real problem here, it will show up as structure that MOVES when nothing is animating,
   * and the frame-diff harness will find it. It does not today: with the sweeps off, zero percent of the frame
   * moves by more than 12 levels between consecutive frames. */

  /* THE BEAM, ITS WAKE AND ITS FRINGE -- a sawtooth running TOP TO BOTTOM.
   *
   * Two things were wrong. It ran the wrong way: suv.y is 1 at the top here, so fract(t) swept upward, while a
   * raster runs down and snaps back. And it was one gaussian, where the lab plots four strokes sharing the beam's
   * position plus three faint copies BEHIND it and a fringe -- its own note calls the wake "three faint copies
   * behind a moving object". A single band has no direction of travel you can read; the wake is what makes it a
   * scan rather than a glowing stripe.
   *
   * A PLAIN MODULO, NOT A TRIANGLE, for the same reason the lab settled on one: a beam that eases into its turn
   * draws attention to the turn. It reaches the bottom and restarts at the top.
   *
   * HIDDEN, NOT WRAPPED, past either end -- a wake copy that reappears at the top while the beam is near the
   * bottom is two beams, and the reset is the whole point of a sawtooth. */
  /* Likewise gated on its own amount: four gaussians and a fifth for the fringe, uniform branch, free to skip. */
  float sp = spLine;                               // the STEPPED line: see where spLine is built
  /* SPLIT BY WHAT THE LIGHT IS, NOT BY WHERE IT IS. The tight part of both the band and the tip is the BEAM --
   * electrons arriving, which is why it runs toward white. Everything spread around it is COATING answering
   * that beam, which is the phosphor's own colour by definition. Colouring them alike put a white halo around
   * a white core and made the whole sweep glow like a torch rather than like a screen. */
  vec3 sweepCore = vec3(0.0), sweepSpread = vec3(0.0);
  vec3 dotCoreC = vec3(0.0), dotHaloC = vec3(0.0);   // per gun: the tip splits like everything else does
  float dip = 0.0;   // how much the coating AHEAD of the beam has faded before it gets back to it
  if (uSweepOn > 0.001) {
    /* THE PROFILE, WITH A CHOICE OF SHAPE -- and the old one only had the soft half.
     *
     * Four stacked gaussians and a fringe make a glowing STRIPE: everywhere is a little lit and nowhere is a
     * line. A raster does not look like that. The beam is on a line, the phosphor behind it is decaying, and
     * the boundary between "being written" and "already written" is sharp because the beam either is or is not
     * there. So the shape is a flat-topped core with real shoulders, plus an exponential wake trailing back up
     * the way the beam came -- and SOLIDITY crossfades to the old gaussian for anyone who wants the haze.
     *
     * The wake is one-sided on purpose. Light ahead of the beam is light the beam has not emitted yet. */
    float d    = suv.y - sp;                        // >0 is BEHIND, because sp descends
    float w    = max(uSweepH, 1e-4);
    float soft = exp(-pow(d / w, 2.0))
               + exp(-pow(d / (w * 3.4), 2.0)) * 0.16;
    float core = 1.0 - smoothstep(w * 0.35, w * 1.05, abs(d));
    /* A SHORT WAKE, NOT A HALO. This trailed at 2.6 widths and 0.55 amplitude, which put a big soft glow above
     * the line and buried the line in it -- the thing that made the sweep read as a moving gradient rather than
     * as a beam. Cut to roughly a width and a third of the brightness, the line is the brightest thing in its
     * own neighbourhood, which is what it should have been all along. SOLIDITY at 0 still returns the haze. */
    float wake = d > 0.0 ? exp(-d / (w * 1.1)) * 0.35 : 0.0;
    float hard = core + wake;

    /* PER GUN, ACROSS THE SCAN. The three beams are split vertically here rather than horizontally because the
     * sweep is a horizontal line -- a sideways split slides along the line and cannot be seen, while a split
     * across it fringes the edge, which is where a misconverged sweep actually shows. Sampling the profile
     * three times at three offsets costs nothing: it is an analytic shape, not a texture. */
    for (int g = 0; g < 3; g++) {
      /* AND THE FIELD SPLITS THE BAND TOO. uSweepRGB is the set's own static misconvergence across the scan --
       * a constant. The magnet is on top of it, and it is the reason the two are added rather than one replacing
       * the other: a stray field makes the existing defect worse, in its own direction, where it happens to be
       * biting. Only the y component is taken, for the reason this loop already exists: the band is a horizontal
       * line, and a lengthwise split slides along it where nothing can see it. */
      vec2  wg = g == 0 ? wgR : (g == 1 ? wgG : wgB);
      float dg = d - (float(g) - 1.0) * uSweepRGB + wg.y;
      float fc = exp(-pow(dg / w, 2.0));                          // soft: the line
      float fs = exp(-pow(dg / (w * 3.4), 2.0)) * 0.16;           // soft: the fringe around it
      float hc = 1.0 - smoothstep(w * 0.35, w * 1.05, abs(dg));   // hard: the line
      float hs = dg > 0.0 ? exp(-dg / (w * 1.1)) * 0.35 : 0.0;    // hard: the short wake behind it
      float cv = mix(fc, hc, uSweepSol);
      float sv = mix(fs, hs, uSweepSol);
      if (g == 0)      { sweepCore.r = cv; sweepSpread.r = sv; }
      else if (g == 1) { sweepCore.g = cv; sweepSpread.g = sv; }
      else             { sweepCore.b = cv; sweepSpread.b = sv; }
    }

    /* THE DARK SIDE OF THE LINE, WHICH IS AHEAD OF IT -- and this is the half the sweep never had.
     *
     * The beam descends, refreshing each line as it passes. So the coating immediately BELOW the beam is the
     * coating that has waited longest: the beam left it behind almost a whole frame ago and will not return to
     * it until it has finished the trip. Its age is nearly a full period, and it is therefore the dimmest part
     * of the frame -- darkest right under the line, recovering the further down you go, because those rows were
     * written later in the previous pass.
     *
     * That is why the old profile read wrong even with the wake fixed. A sweep is not a bright thing added to a
     * uniform picture; it is a bright edge with a DEFICIT in front of it, and the deficit is what makes the eye
     * read a surface being refreshed rather than a light being dragged across a poster.
     *
     * Multiplied into the emission rather than added, because this is the phosphor having less to give, not a
     * black object drawn on top -- so it scales whatever is there and cannot push a dark area below zero. */
    float ahead = d < 0.0 ? exp(d / (w * max(uDipFall, 0.05))) : 0.0;
    /* STATIC, NOT A CLEAN FADE. What sits ahead of the beam is a decaying image nobody is driving -- and a
     * phosphor left to itself does not fade evenly, it breaks up. Grained PER RASTER CELL rather than per pixel,
     * because that is the size of the thing that is decaying: one column of one line either still has charge or
     * it does not. Re-drawn on its own clock so it crawls, which is what makes it read as noise rather than as
     * a texture stuck to the glass. */
    float cellX = floor(suv.x * uGrilleN);
    float cellY = floor(suv.y * uScanN);
    // The time index is WRAPPED as well as hashed: 64 distinct frames of noise is more than the eye resolves,
    // and it keeps the argument small no matter how long the page has been open.
    float tIdx  = mod(floor(uTime * 30.0), 64.0);
    float grain = hash21(vec2(cellX, cellY) + tIdx * 37.0);
    dip = uSweepDip * ahead * mix(1.0, grain, clamp(uDipNoise, 0.0, 1.0));

    /* THE TIP: THE POINT OF THE RAY, WHICH IS THE ONLY PART OF A RASTER THAT IS EVER ACTUALLY LIT.
     *
     * Three concentric discs -- halo, body, core -- rather than a gradient, which is the reference's own
     * construction for this layer and the same widest-first ramp every glow in the project uses. Distance is
     * aspect-corrected so the tip stays ROUND on screen; measured in suv it would be an ellipse everywhere the
     * picture is not square, and it would change shape as the window resized.
     *
     * It rides on spY, so the tip is always on the line the sweep is drawing. That coupling is the point: they
     * are not two animations, they are the position of one beam. */
    // EITHER LEVEL KEEPS THE BLOCK ALIVE. Gating on uDotLvl alone made TIP HALO dead whenever TIP GLOW was
    // at zero -- two independent controls, one of them silently the other's master.
    if ((uDotLvl > 0.001 || uDotHalo > 0.001) && uDotRX > 1e-6 && uDotRY > 1e-6) {
      /* MEASURED IN CELLS, WHICH IS WHY THERE IS NO ASPECT TERM ANY MORE. The radii arrive as fractions of the
       * picture already scaled by the raster -- x by the grille's column count, y by the scanline count -- so
       * dividing each axis by its own radius lands both in the same normalised space and dd is a true radius
       * in spot-widths. The old form corrected x by uAspect to keep the spot round ON THE GLASS; a spot that is
       * round in CELLS is the more useful object, because the beam's footprint is what writes them. */
      /* THE TIP SITS ON THE WRITTEN LINE, NOT BETWEEN THE TWO SHOULDERS.
       *
       * It used to ride half a step down, at the midpoint of the kink, and that put THREE heights on screen at
       * once: the trailing line up here, the tip in the middle, the leading line below. Nothing touched anything
       * and the trailing row read as a separate stripe floating above the beam.
       *
       * On the written height there are only two, and they meet AT the tip: the line the beam has already laid
       * down runs straight into it, and the part it has not reached yet drops away on the far side. The tip is
       * the corner, which is what it physically is -- the last place the beam has been. */
      vec2 dp = vec2((suv.x - hx) / max(uDotRX, 1e-6),
                     (suv.y - spY) / max(uDotRY, 1e-6));
      /* ONE PHOSPHOR, NOT A LAMP. This was three stacked gaussians -- core, body and a halo reaching THREE spot
       * radii out -- which is the right construction for a glow and the wrong one for a dot. A phosphor is a
       * small blob of coating with an edge: it is lit or it is not, and what little softness it has is the
       * beam's own focus, not a corona hanging around it. The halo was most of what you could see, so the tip
       * read as a light source floating on the glass rather than as a cell being driven.
       *
       * So: an edged disc, and a whisper past that edge purely so it does not alias into a hard circle. TIP
       * HEIGHT and TIP WIDTH set its size in scanlines and columns, which is the size a phosphor is measured in
       * anyway -- one cell, or a few if the focus is soft. */
      /* A CELL IS A RECTANGLE, so the distance is the BOX's and not the circle's. Chebyshev -- the larger of the
       * two axes -- draws a square in whatever space it is measured in, and this space is already scaled by the
       * raster, so TIP HEIGHT scanlines by TIP WIDTH columns is exactly the rectangle you get. length() gave a
       * disc, which is the shape of a beam in free flight and not the shape of the thing it lands on.
       *
       * SPLIT SIDEWAYS, PER GUN, and sideways is the axis that matters here. The band's own split is vertical
       * because the band is a horizontal line and a lengthwise split slides along it invisibly; the tip is a
       * compact cell, so it shows a split on either axis -- and the three guns sit on a horizontal line, which
       * is what "in-line" means and what the CONVERGENCE section already models. So the tip splits the way the
       * guns are actually arranged, and each offset copy is tinted by its own component of uHalo further down:
       * the red gun lights the red phosphor. */
      for (int g = 0; g < 3; g++) {
        /* BOTH AXES. A real set lists H and V static convergence as two adjustments and not one -- the sideways
         * error is the guns' own geometry, the vertical one is the yoke's field being uneven top to bottom --
         * which is exactly why CONVERGENCE carries an X and a Y per gun. The tip is a compact cell, so unlike
         * the band it shows an error on either axis, and it gets both. */
        float k  = float(g) - 1.0;
        /* THE TIP TAKES THE FIELD ON BOTH AXES. It is a compact cell rather than a line, so unlike the band it
         * shows an error whichever way the field pushes -- and the tip is the one place on the face where the
         * three beams are a single spot you can watch come apart. */
        vec2  wg = g == 0 ? wgR : (g == 1 ? wgG : wgB);
        vec2  dq = vec2((suv.x - hx  - k * uTipRGBX + wg.x) / max(uDotRX, 1e-6),
                        (suv.y - spY - k * uTipRGBY + wg.y) / max(uDotRY, 1e-6));
        float dd = max(abs(dq.x), abs(dq.y));
        float cv = (1.0 - smoothstep(0.80, 1.00, dd)) * uDotLvl;   // the cell, edged
        float hv = exp(-pow(dd / 2.0, 2.0)) * uDotHalo;            // coating lit around it, its own level
        if (g == 0)      { dotCoreC.r = cv; dotHaloC.r = hv; }
        else if (g == 1) { dotCoreC.g = cv; dotHaloC.g = hv; }
        else             { dotCoreC.b = cv; dotHaloC.b = hv; }
      }
    }
  }
  // THE DEFICIT FIRST, THEN THE LINE. The beam's own light is not subject to the fade it is curing.
  emis *= 1.0 - clamp(dip * uSweepOn, 0.0, 0.95);
  /* THE BEAM IS NOT THE SAME COLOUR AS WHAT IT WRITES, and running it through uHalo said it was.
   *
   * uHalo is the PHOSPHOR's colour -- what the coating gives back once it has been excited and is re-emitting.
   * The sweep is not that. It is the excitation itself, arriving: a stream of electrons hitting the coating at
   * full current, before any of the colour-shifting the phosphor does on the way back out. Tinting it amber made
   * the whole sweep read as one more orange thing on an already orange screen, which is exactly the complaint.
   *
   * So it gets its own colour, and SWEEP TINT says how far toward white it runs. At 0 it is the old behaviour --
   * the beam wearing the coating's colour -- and at 1 it is bare excitation. The tip stays whiter still than its
   * own band, because the tip IS the instant of maximum current. */
  vec3 beamCol = mix(uHalo, vec3(1.0), clamp(uSweepWhite, 0.0, 1.0));
  /* THE BEAM WHITE, WHAT IT EXCITES AMBER. The spread terms take uHalo straight, so no amount of SWEEP TINT can
   * put a white halo on the screen -- the tint moves the BEAM's colour and leaves the coating's alone, which is
   * the only way round that stays true when the phosphor is switched to green or white. */
  emis += beamCol * sweepCore   * uSweepOn * 0.06;
  emis += uHalo   * sweepSpread * uSweepOn * 0.06;
  /* ONLY THE CORE IS THE BEAM. The body was on beamCol too, and because it is a gaussian at 1.2 radii it still
   * carried most of the light two spot-widths out -- so the "white core, amber surround" split existed in the
   * code and not on the screen: measured, red-over-blue only moved 1.22 to 1.39 from centre to edge.
   *
   * A real spot is on the order of a pixel. Everything wider than that is coating glowing, not electrons
   * arriving, so body and halo both belong to the phosphor and only the tight core stays hot. */
  /* THE TIP IS THE PHOSPHOR'S COLOUR, ALL OF IT. The core used to run 45% toward white on the argument that the
   * beam is hotter than what it excites -- true of the electrons, but what LEAVES the screen at that point is
   * still the same coating giving back the same spectrum, just harder. Only the amount differs, and TIP GLOW is
   * the amount. So it is uHalo throughout and the level carries the difference. */
  /* NORMALISED SO THE LEVEL MEANS WHAT IT SAYS. The dot peaks at 1.0 + 0.10 = 1.10, so
   * without dividing by that the tip emits nearly twice its own stated level -- and this add had also lost the
   * 0.06 every other emission term carries when it was converted to nits, leaving it about seventeen times too
   * bright. The tone map is x/(1+x) PER CHANNEL, so anything that bright drives red, green and blue all to the
   * top and the tip renders pure white no matter what colour it was given. It was not a tint bug; it was a
   * level bug wearing a tint bug's clothes.
   *
   * Divided here, once, so TIP GLOW in nits sits on exactly the same scale as BRIGHTNESS: 90 nt of tip beside
   * 62 nt of beam is a spot driving the coating about half again as hard, which is a sentence worth reading. */
  emis += uHalo * (dotCoreC + dotHaloC) * uSweepOn;


  /* SAMPLED AT suv, NOT uv -- the bloom is a blurred copy of the CONTENT, so it lives in the content's coordinate
   * system and has to be read through the same warp as the glyphs that cast it. Read at screen uv it drifts off
   * its own source as FACE bends the picture, which showed up as a bright horizontal streak sitting below the text
   * rather than around it. The tell was that it persisted with SWEEPS at zero. */
  /* SAMPLED AT puv, THE SAME COORDINATE THE PICTURE IS, and that was a real bug when it was not.
   *
   * The parallax exists because the phosphor sits behind a few millimetres of faceplate, so the eye picks the
   * picture up slightly off from where it is looking -- zero on axis, growing toward the rim. The bloom is that
   * same phosphor's light, leaving through that same glass. Sampling it at suv left the glow pinned to the
   * UNrefracted position while the picture slid away from it, so the halo sat off to one side of the text by the
   * full parallax -- worst off-axis, which is exactly where a bottom-anchored terminal block lives. */
  /* PER GUN, because the bloom is that gun's OWN light spreading. One RGB fetch at puv gave every channel the
   * same halo at the same place, so displacing a gun moved its glyph and left its glow behind -- a red raster
   * with a green-and-blue halo still sitting where red used to be. Three taps of an already quarter-resolution
   * buffer is the whole cost.
   *
   * (Halation used to sit below this and was deliberately NOT split, on the grounds that light scattered inside
   * the faceplate has lost the geometry of whichever gun started it. It has since been removed entirely -- see
   * the note where it was.) */
  emis += vec3(texture(uBloom, puv + uConvR).r,
               texture(uBloom, puv + uConvG).g,
               texture(uBloom, puv + uConvB).b) * uBloomAmt;   // bloom, summed in linear light

  /* THE PHOSPHOR GLOW -- a WIDE lift wherever the coating has content near it, with no structure of its own.
   *
   * Distinct from both of its neighbours here, and it was missing. The bloom is thresholded and follows the
   * glyphs, so it draws a halo ON the text. Neither that nor the beam spot says "this part of
   * the screen is busy and the whole area around it is sitting brighter", which is what an excited coating
   * actually does and what the reference carries as its own phosphor glow layer. Rendered at 1/16 so it cannot
   * have structure even in principle. */
  /* ON THE SAME SCALE AS BRIGHTNESS, so the two can be compared. uBright is nits/100 and the beam contributes
   * lin * uBright, so an emission term expressed the same way is directly readable against it -- 3 nt of glow
   * beside 62 nt of beam says the coating's ambient excitation is about 5% of what the beam drives, which is a
   * sentence worth being able to read off the panel. The 0.05 that used to be here was an unnamed scale factor
   * doing the same job invisibly; the page divides by 100 instead, exactly as it does for BRIGHTNESS. */
  emis += uHalo * glowField(puv) * uGlowAmt;

  /* HALATION IS GONE, and it is worth saying why rather than leaving a gap.
   *
   * It modelled light scattering sideways inside the faceplate and re-exciting the coating around a bright spot:
   * wider than the bloom, weaker, and red-shifted because the long wavelengths travel furthest. Real -- it is in
   * every photograph of a tube -- and it cost four taps of the bloom buffer plus a tint.
   *
   * MEASURED, IT WAS NOT EARNING THAT. At 140%, twice its own default, it moved the halo around the text by +3.1
   * red and under half a level on green and blue. Four fetches for something that could not be pointed at.
   *
   * What replaced it was not a cheaper halation but a better-aimed layer: SCREEN GLOW is the coating's own
   * excitation over the area being driven, analytic, one evaluation, no buffer -- and it does the wide-soft-halo
   * job halation was mostly being asked to do. The one thing it does not carry is the warm shift, and if that is
   * ever wanted it belongs as a tint on the glow rather than as a second pass over the same buffer. */


  /* THE MASK GOES HERE, AFTER EVERY PHOSPHOR TERM AND BEFORE EVERY REFLECTION TERM -- and that ordering is the
   * whole reason the cell grid is visible or not.
   *
   * It used to sit immediately after the wash, which put the sweep, the bloom and the halation on the WRONG side
   * of it: those are additive, so their light never went through the mask and filled the dark lines straight back
   * in. Measured against the reference on empty glass, the mask's amplitude came out 0.260 row-to-row against
   * 1.806 -- about a seventh -- while the mean level was HIGHER, 19.2 against 13.3. A darker face with more
   * structure is the signature of light that is being masked; a brighter face with less is the signature of light
   * that is bypassing it.
   *
   * The split is physical, not aesthetic. Beam, wash, sweep, bloom and halation are all the phosphor coating
   * emitting -- by the beam, by scatter, or by light trapped in the faceplate -- so all of them leave THROUGH the
   * shadow mask. Room, sheen and glare are the room reflecting off the FRONT surface, in front of the mask, and
   * must not be modulated by it. Everything above this line is emission; everything below is reflection.
   *
   * This is the same lesson the DOM build's own note records -- screen-blended glow kept lifting the dark lines
   * back up -- arrived at again from the other direction. */
  float ny = suv.y * uScanN;
  float fy = max(fwidth(ny), 1e-6);
  float dyPx = abs(fract(ny) - 0.5) / fy;                      // distance to the nearest line centre, in px
  float covH = 1.0 - smoothstep(uScanW*0.5 - 0.5, uScanW*0.5 + 0.5, dyPx);
  emis *= 1.0 - uScanA * covH;                                                            // the SCANLINES cross the whole face

  float nx = suv.x * uGrilleN;
  float fx = max(fwidth(nx), 1e-6);
  float dxPx = abs(fract(nx) - 0.5) / fx;
  float covV = 1.0 - smoothstep(uGrilleW*0.5 - 0.5, uGrilleW*0.5 + 0.5, dxPx);
  emis *= mix(vec3(1.0), uGrilleInk, uGrilleA * covV);              // so does the grille

  /* ---------------------------------------------------------------- THE GLASS
   * Everything from here is light arriving at the front surface rather than leaving the phosphor, so it ADDS and
   * it is weighted by FRESNEL -- a glass face reflects far more at grazing incidence, which is why a real tube
   * shows the room hardest at its edges and corners.
   */
  /* A CONSTANT, BECAUSE A GLASS FACE VIEWED FROM THE FRONT REFLECTS A CONSTANT.
/* THE REFLECTANCE OF THE GLASS, SCHLICK, WITH BOTH THE TERMS THAT MAKE IT SCHLICK.
   *
   * This was 0.03 + 0.97 * pow(ap, 4.0) -- a ramp on the screen RADIUS sold as Fresnel. The test that killed it:
   * Fresnel depends on the angle between the eye ray and the SURFACE NORMAL, so it has to move when the surface
   * does, and that expression contained no term from the face profile at all. It was bit-identical at FACE 0,
   * where the glass is dead flat, and at OUT 90. A slope term with no slope in it is a rim light wearing a
   * physics name.
   *
   * It was then a flat 0.04, which is honest but incomplete: 4.0% head-on, 4.2% at 45 degrees, 7% at 60. I
   * argued at the time that every angle occurring here lands in the flat part of the curve. That is true of the
   * FACE's own tilt alone and false once the eye ray is included -- the view diverges toward the rim, so the two
   * tilts add, and at the corners of a strongly bowed face they reach far enough up the curve to matter.
   *
   * So: the real thing. The normal comes from the sag profile's own derivative -- d/dr of uSagA * r^uSagP -- so
   * it is zero everywhere when FACE is flat and grows with FACE by construction, which is exactly the test the
   * fake one could not pass. The eye ray diverges from a viewpoint EYE half-heights in front of the glass.
   * Head-on it still returns 0.04 and nothing about the centre of the picture changes. */
  const float EYE = 2.4;                                        // viewing distance, in glass half-heights
  float slopeF = uSagA * uSagP * pow(max(ap, 1e-3), max(uSagP - 1.0, 0.0));
  vec2  radial = length(c) > 1e-5 ? normalize(c) : vec2(0.0);
  vec3  nrmF   = normalize(vec3(-slopeF * radial, 1.0));        // the face's own normal, tilting with FACE
  vec3  eyeD   = normalize(vec3(-c, EYE));                      // eye ray at this pixel, diverging toward the rim
  float cosI   = clamp(dot(nrmF, eyeD), 0.0, 1.0);
  float fres   = 0.04 + 0.96 * pow(1.0 - cosI, 5.0);            // Schlick, R0 = 0.04 for n = 1.5

  // THE FIXTURE, reflected in the face. Two tubes in a recess, tilted back, with rails and end caps -- projected
  // through the same warp as the picture, so it cannot drift from it the way three implementations of one
  // projection did in the DOM build.
  /* INTO THE FIXTURE'S OWN SPACE, AS A RAY.
   *
   * The glass is a flat mirror, so the fixture is placed as a virtual image behind it and the ray just travels
   * into the screen -- no reflection maths needed and the parallax comes out right for free. The ray is built in
   * ISOTROPIC screen units (x scaled back up by the aspect) because a direction measured in per-axis-normalised
   * coordinates is not a direction; that is what made the old field look stretched.
   */
  /* BOTH AXES. Only y was ever offset, which made the fitting slide up and down but never left or right --
   * an asymmetry with no reason behind it; the reference has carried fposx alongside fposy all along.
   *
   * The two are directly comparable once the aspect is folded in: q.y is 1 at the glass's half-height and
   * q.x * uAspect is that same unit measured along x, so a centimetre sideways is the same distance as a
   * centimetre up and one conversion serves both. */
  /* CURVE IS THE PICTURE'S OWN WARP, APPLIED TO THE REFLECTION -- one shared transformation, not a second
   * description of the same surface.
   *
   * What stood here was a real mirror reflection: bounce the eye ray off the face's normal and trace whatever it
   * hits. Physically that is the honest answer and it looks ridiculous, because the sag tilts the normal by tens
   * of degrees near the rim and the fitting swings somewhere else entirely. It also did not AGREE with anything
   * -- the picture, the grid and the rings are all placed by the projection's radial factor k, so a reflection
   * bent by a different rule visibly disobeyed the surface it was supposedly reflecting in.
   *
   * k is that factor: faceK(ap * bs) * bs, the same value the raster is gathered with a few lines up. Scaling
   * the fixture's screen coordinate by it puts the reflection through the identical mapping, so it bows exactly
   * as the debug grid bows and cannot drift from it.
   *
   * AND THERE IS NO CONTROL ON IT. There was one -- GLASS > CURVE, a 0..1 fraction of k -- and it made sense
   * only while this was a physical mirror reflection: that version was unusable at full strength and needed
   * dialling back. Once it is the picture's own mapping the fraction has no meaning left, because any value
   * below 1 is a reflection bending by a different rule than the surface reflecting it -- the exact
   * disagreement the change was made to remove.
   *
   * How curved the glass is already has controls, and they are in TUBE: FACE, CURVE AREA, FALLOFF, DEPTH. This
   * follows them by construction, being built from the same number they produce. */
  vec2 cFix = c * k;
  vec2 sp2  = vec2(cFix.x - uFixX, cFix.y - uFixY);
  vec3 ro  = vec3(0.0, 0.0, 0.0);
  /* A FIXED FIELD OF VIEW, AND THE FIXTURE MOVES. This was normalize(vec3(sp2, -uFixDepth * 6.0)) with the
   * fitting pinned one unit away, which makes the control a FOCAL LENGTH: a ray reaching the aperture plane
   * lands at x = sp2.x / D, so the fitting's size on the glass went UP with the number labelled DISTANCE.
   * Backwards, and not subtly -- turning "distance" up zoomed in.
   *
   * The eye's cone is a property of the eye, so it is a constant here; the fitting is what has a position. Put
   * the distance where the distance belongs and apparent size goes as 1/L for free, along with the right
   * foreshortening: far away is small AND flat, near is large AND strongly raked, which one number cannot do
   * when it is standing in for both. */
/* HOW MUCH OF THE GLASS'S CURVE THE REFLECTION IS ALLOWED TO TAKE.
   *
   * A flat ray -- vec3(sp2, -1) -- reflects the fitting identically at FACE 0 and FACE 90, which is wrong: the
   * one thing that is ENTIRELY a property of the surface's shape stayed flat while the picture and the frame
   * both bowed.
   *
   * Reflecting properly about the face's own normal fixes that and, at full strength, is unusable. The sag
   * tilts the normal by tens of degrees near the rim, so the reflected ray swings far enough that the fitting
   * leaves the frame -- which a real curved mirror with a lamp off to one side genuinely does, and which makes
   * the thing impossible to look at. Correct and useless are not exclusive.
   *
   * So it is a fraction. 0 is the flat ray exactly, 1 is the honest reflection, and the interesting settings are
   * low: enough that the fitting stretches and leans toward the rim as FACE comes up, not so much that it slides
   * out of view. nrmF is already here, taken from the sag profile's derivative for the Fresnel above. */
  vec3 rd = normalize(vec3(sp2, -uFixLens));

  // Tilt the whole assembly about X, which is what --ftilt does to the real one.
  float ct = cos(uFixTilt), st = sin(uFixTilt);
  mat3 rot = mat3(1.0, 0.0, 0.0, 0.0, ct, -st, 0.0, st, ct);
  vec3 rol = rot * (ro - vec3(0.0, 0.0, -max(uFixDist, 0.05) * uFixLens));
  vec3 rdl = rot * rd;

  float halfLen = uFixW * uAspect;
  float tubeR   = uFixH;
  // A FROSTED SLEEVE MAKES THE SOURCE BIGGER, which is the whole reason it softens the shadows it casts.
  /* FROST WIDENS THE SOURCE; MATTE WIDENS IT AGAIN, and the second one is a modelling shortcut worth naming.
   * A matte face does not change the lamp -- it scatters the lamp's IMAGE, which is the same integral seen from
   * the other end. Treating the source as larger is the cheap equivalent and needs no second pass. */
  /* MATTE'S ONE JOB: how far the reflected IMAGE is smeared. Inflating the source is the cheap equivalent
   * of blurring what comes back off the glass, and with the additive wash gone this carries the control
   * on its own -- so it reaches further than it used to. FROST is the same operation on the lamp itself. */
  float tubeRlit = tubeR * (1.0 + uFrost * 1.8);
  /* THE LAMPS SIT INSIDE THE HOUSING, which stopped being true the moment RECESS became a real depth.
   *
   * Their axis was hardcoded at -uOpenH * 1.15 -- a depth derived from how TALL the aperture is. That was fine
   * while the box was uOpenH * 2.6 deep, because both scaled together and the lamps always landed about
   * midway. Giving the housing a real depth in millimetres broke the pairing: a 600mm-tall aperture put the
   * lamps 380mm back inside a box 90mm deep, so they were behind the rear wall, occluded by it, and neither
   * they nor their light reached the glass at all.
   *
   * A lamp is mounted a proportion of the way into its reflector, so that is what this is. Nothing else in the
   * fixture may derive a depth from the aperture's height again. */
  float tubeZ = -uRecess * 0.6;
  vec3  boxHi   = vec3(uOpenW * uAspect, uOpenH, 0.0);
  // THE HOUSING IS AS DEEP AS IT IS, not 2.6x however tall the aperture happens to be. A recess depth that
  // moved whenever the opening resized is a fixture that changes shape when you change its face.
  vec3  boxLo   = vec3(-uOpenW * uAspect, -uOpenH, -max(uRecess, 1e-3));

  /* A FLUORESCENT RUNS ON ALTERNATING CURRENT and the discharge extinguishes and re-strikes on every half
   * cycle, so its output pulses at TWICE the mains frequency -- 100Hz on a 50Hz supply. The phosphor's own
   * persistence smooths it, which is why it reads as a shimmer and not as a strobe, so this is shallow by
   * design. It is a different thing from HEALTH and FLICKER above: those model a tube that is FAULTY, this is
   * what a perfectly good one does all the time, and it is most of why fluorescent light feels like fluorescent
   * light. Applied to both bulbs together because they share a supply. */
  /* THE PHASE ARRIVES ALREADY WRAPPED, and it has to. cos(uTime * 628.318) is 100Hz written the obvious way and
   * it does not survive contact with a real clock: uTime is wall-seconds, so after half an hour the argument is
   * past a million and float32 carries about seven digits -- every frame lands on the same quantised value and
   * the ripple stands perfectly still. Exactly the failure the DIP STATIC grain had, for exactly the same
   * reason. JS doubles wrap it exactly; the shader only ever sees 0..1. */
  float ripple = 1.0 - uRipple * 0.5 * (0.5 - 0.5 * cos(uMainsPh * 6.2831853));
  float flkA = uFlkA * ripple, flkB = uFlkB * ripple;

  /* THE FIXTURE ARRIVES PREFILTERED, and MATTE is which mip to read.
   *
   * It used to be traced here, 4 to 16 times per pixel, and could not hold thirty frames. It is traced once now,
   * into its own target with a mip chain over it, and roughness chooses a level: sharp at 0, twice as blurred
   * per level after. That is how glossy reflections are done in real-time rendering -- prefilter the radiance,
   * index it by roughness -- and it makes the cost constant instead of proportional to the blur.
   *
   * ROUGHNESS SQUARED, the usual mapping: perceived roughness is not linear in filter width, and r^2 keeps the
   * low end of the control useful instead of jumping straight to a wash.
   *
   * DIVIDED BY COVERAGE, which is what stops it disappearing. Blurring a small bright thing against black
   * spreads it AND dims it, so at high MATTE the fitting was being averaged into the void around it. Alpha
   * carries how much fixture went into each texel, so dividing restores the brightness while keeping the
   * blurred shape: the reflection gets softer and wider, not fainter. */
  float tOpen  = rdl.z != 0.0 ? -rol.z / rdl.z : -1.0;
  vec3  atOpen = rol + rdl * tOpen;
  bool  facing = tOpen > 0.0;
  float lod    = uMatte * uMatte * uFixLods;
  /* WHERE TO READ THE PRE-TRACED FITTING. The fixture pass renders it flat, indexed by screen position, so
   * CURVE is applied by reading at the WARPED coordinate rather than by re-tracing anything: cFix is c after
   * the projection's own radial factor, and this is that same point back in texture space. At CURVE 0 it is
   * exactly v, by construction, so the control cannot move the fitting when it is off.
   *
   * The warp can reach past the edge of the buffer, where there is nothing recorded. Clamping there would smear
   * the edge texel across the glass, so it fades out instead -- the ordinary limitation of anything sampled in
   * screen space, stated rather than hidden. */
  vec2  vb     = vec2(cFix.x / uAspect, cFix.y) * 0.5 + 0.5;
  vec2  vfade  = smoothstep(vec2(0.0), vec2(0.015), vb) * (1.0 - smoothstep(vec2(0.985), vec2(1.0), vb));
  vec4  fixS   = textureLod(uFix, clamp(vb, 0.0, 1.0), lod) * (vfade.x * vfade.y);
  /* NO COVERAGE DIVISION. It was undoing the blur it was meant to survive.
   *
   * The idea was to stop a blurred fixture being averaged into the black around it: alpha carries how much
   * fitting went into each texel, so dividing restores the brightness. What it actually does at a silhouette is
   * renormalise every partially-covered pixel back to FULL strength -- so the outline stays razor sharp while
   * the interior softens, and where alpha crosses the floor there is a hard step. Blurred inside, stamped
   * outside, with blocky notches on the seam. Exactly what it looked like.
   *
   * The vanishing it was fixing had a simpler cause: the chain runs to a 1x1 top level, and MATTE at 1 was
   * asking for it -- one colour averaged over the whole screen, which IS nothing. Capping how far up the chain
   * roughness may reach solves that without touching what the blur does to the edges. A blurred reflection
   * SHOULD spread and soften at its outline; that is what makes it look blurred. */
  vec3  room   = fixS.rgb;

  vec2  outAp  = abs(atOpen.xy) - vec2(boxHi.x, boxHi.y);
  float dOut   = facing ? length(max(outAp, vec2(0.0))) : 1e3;
  /* THE SCATTER IS A HALO AROUND THE FITTING, AND IT WAS A FLAT WASH ACROSS THE INSIDE OF IT.
   *
   * dOut is the distance OUTSIDE the aperture, so max(outAp, 0) pins it to zero everywhere within the opening
   * and exp(-0/R) is 1. Every pixel of the fitting's own image therefore received the halo at FULL strength,
   * added on top of whatever had been rendered there.
   *
   * That single term is behind both of the complaints it took three separate patches to chase. A burnt-out
   * section of a lamp could not go black, because this was laid over it: measured at HEALTH 40%, the dead
   * middle read 26 with everything on and 0 the moment SHEEN was removed -- the wash was ALL of it. And BOX
   * looked broken for the same reason: it fades the housing wall, and the wall was buried under the same
   * uniform sheet of light, so the slider moved a number that could not reach the picture.
   *
   * A halo is light that has spread AWAY from a source, arriving where the source itself is not. Inside the
   * aperture you are looking straight at the fitting, and the fitting has already been rendered there -- adding
   * its glow again on top is counting the same photons twice. So it fades out across the aperture edge rather
   * than stopping at it: a hard cut would draw the silhouette this is meant to soften, which is the failure the
   * halo's own note warns about. dIn is how far INSIDE the boundary the pixel sits, on the same scale. */
  float dIn    = facing ? -max(max(outAp.x, outAp.y), -1e3) : 0.0;
  float inFade = 1.0 - exp(-max(dIn, 0.0) / max(uSheenR * 0.65, 1e-4));
  float scatter = exp(-dOut / max(uSheenR, 1e-3)) * (1.0 - inFade);
  // WEIGHTED BY EACH LAMP'S OWN OUTPUT, so the halo takes the colour of whichever tube is actually lit.
  vec3  lampAvg = (uLampA * flkA * uHealthA + uLampB * flkB * uHealthB) * 0.5;


  room += lampAvg * scatter * uSheen * 0.5 * uFixture;
/* MATTE NO LONGER ADDS A WASH HERE, and that term was the whole complaint.
   *
   * It was: room += lampAvg * exp(-dOut / (uSheenR * (1 + uMatte * 5))) * uMatte * 0.45. An ADDITIVE glow,
   * widened five-fold by roughness, laid over the entire glass. So turning MATTE up did not soften the
   * reflection, it poured extra light across the screen -- amplifying, which is the one thing a rough surface
   * cannot do.
   *
   * The two controls have different jobs and this one was doing both. SHEEN is how far the light spreads and it
   * already owns the halo above. MATTE is how sharply the glass returns an image, which is a property of the
   * REFLECTION and belongs where the reflection is formed, not in a term added beside it. */

  /* THE PAINTED RAILS ARE GONE, for the same reason the painted spill went. They were two hairlines of near-
   * white -- vec3(0.22, 0.21, 0.19), brighter than anything the tubes themselves put on the wall -- stamped
   * along the opening's lip in SCREEN space, with no normal, no material and no relationship to where the light
   * actually is. A lit edge that does not move when you move the lamp is not a lit edge, it is a highlight drawn
   * on. The recess has real walls and a real opening now, and where its lip catches the tubes is something
   * tubeLight() already answers. */

  /* THE PAINTED SPILL IS GONE. It was an elliptical blob of lamp colour laid over the reflection -- a stand-in
   * from before the tubes were real geometry. They are two ray-traced cylinders now, lighting the inside of the
   * box through tubeLight(), so a hand-painted glow on top was the same light modelled twice and the second
   * model was the worse one. Measured before removal: the frame mean moved 29.354 to 29.389 across the control's
   * ENTIRE range -- one part in a thousand, which is a control that cannot be seen doing anything. */

  /* NO LONGER SQUARED. The squaring existed to stop the lamp sitting visibly across the middle of the picture --
   * but that was the ramp's fault, not the lamp's: at ap = 0 the old fres was 0.03, so squaring it drove the
   * centre to 0.0009 and crushed the fixture into invisibility while leaving the rim at full strength. With a flat
   * reflectance there is nothing to shape and squaring would just be a second, invented attenuation. */
  /* GLARE IS HOW MIRRORED THE FACE IS, and that is a better control than the veil it replaces.
   *
   * fres is what the glass really does: about 4% head-on, rising at the rim. Physically honest and, on its own,
   * a screen you can barely see anything in -- which is correct for a bonded anti-glare face and useless as the
   * only option. GLARE lifts that reflectance from the physical value to a full mirror, so at 100% the fitting
   * is simply THERE in the glass at full strength, and the curve of the face bends it exactly as a curved
   * mirror would.
   *
   * This is one number governing every reflection rather than a separate haze added beside them. The veil I had
   * here a moment ago could brighten the face but could never make anything appear IN it -- the complaint that
   * the glass controls did not affect what was being reflected, arriving a second time in a new costume. */
  /* GLARE IS THE REFLECTANCE ITSELF, from nothing to a mirror, and Fresnel now only shapes it.
   *
   * It used to be mix(fres, 1.0, uGlare), which meant GLARE at zero still left the physical 4% -- the fitting
   * dimmed but plainly still there. Zero should mean zero: a face that reflects nothing. So the control IS the
   * reflectance, and fres contributes the ANGLE dependence it is actually responsible for, normalised to 1
   * head-on so the number on the panel means what it says in the middle of the picture.
   *
   * The physical value of glass is 4%, so GLARE at 4% is a real anti-glare face -- which makes the readout a
   * statement about the coating rather than an arbitrary strength. */
  /* THE TUBE'S OWN MODULATION IS SPENT HERE, BEFORE THE ROOM IS ADDED -- and this is the whole reason a dark
   * set still shows the ceiling in it.
   *
   * uFlicker is state.power multiplied by the screen's flicker envelope: what the PHOSPHOR is putting out this
   * frame. It used to be applied at the very end, after the reflection had already been summed in, which meant
   * POWER off multiplied the reflection by zero along with everything else -- measured, the whole frame went to
   * a peak of 0. A switched-off CRT is not a black hole; it is a dark grey mirror, and the fitting overhead is
   * the most visible thing in it.
   *
   * The reflection is not the tube's light. It is the room's light bouncing off the front of the glass, and it
   * does not care whether the set is on, guttering, or dead. So everything the tube emits is scaled first, and
   * the room is added afterwards where nothing can switch it off. */
  /* AND THE COLLAPSE IS SPENT HERE TOO, for the same reason and on the same side of the line.
   *
   * Squeezing suv moves everything drawn THROUGH suv, but the wash is a constant -- uHalo * uPhos * 0.055, the
   * coating glowing from scatter -- so it has no coordinate to be moved by and would sit at full extent while
   * the picture fell in on itself, brightening across the whole face as the strike ran. It is still phosphor
   * emission, so it collapses with the rest of it. Applied to emis rather than to that one term because every
   * addend above this line is the tube emitting, which is exactly the set the collapse applies to. */
  emis *= uFlicker * pwrCov;

  /* GLARE IS A TRANSPARENCY NOW, NOT A REFLECTANCE, and the reason is measured.
   *
   * It used to BE the reflectance -- uGlare multiplied the reflection in linear light, which is the physically
   * honest thing to do and made "4%" mean a real anti-glare coating. The trouble is what the two curves after it
   * do to that number. The fitting is deliberately driven well above 1 in linear light (see tubeSurface: an
   * emitter has to outgun what it lights, or it reads as a bright object rather than a lamp), so it sits on the
   * flat part of the tone map, and gamma then lifts whatever survives. Measured end to end: GLARE 1% against
   * 100% cut the light by 114x -- almost exactly the 100x asked for -- and moved the pixel by 3.7x, 237 to 64.
   * The fitting at "1%" was still a plainly visible bright shape.
   *
   * That is not a bug in the arithmetic; it is true of real reflections, and a 1% reflection of something 500x
   * brighter than its surroundings genuinely is still brighter than them. It is a bad CONTROL, which is a
   * different complaint and the one worth answering: the whole visible range lived in the bottom 8% of the
   * slider and the other 92% did nothing anyone could see.
   *
   * So the mix happens in DISPLAY space, after the tone map and the gamma, against the same picture with no
   * fitting in it at all. Half means half as visible, by construction rather than by a fitted curve -- there is
   * no exponent here to be approximately right. The ends are untouched: 0 is the identical black it always was,
   * and 1 is the identical full reflection, because at both the mix is a no-op.
   *
   * fres keeps the job it was actually responsible for -- the ANGLE. Normalised to 1 head-on, so the rim still
   * takes more than the middle and the number on the panel still means what it says in the centre of the
   * picture, which is where anyone reads it. */
  float reflA = clamp(fres / 0.04, 0.0, 1.0);
  vec3  emisBare = emis;                 // the tube with nothing of the room reflected in it
  emis += room * uFixture * reflA;

  /* SHEEN AND GLARE ARE BOTH THE ROOM, so both are scaled by ROOM LIGHT and neither exists without it. That
   * coupling is the fix for "the glass sliders do not affect the reflection": they were three independent
   * constants added on top of a reflection, so turning the room down left them shining regardless.
   *
   * SHEEN is the room's light RAKING across the face -- a directional streak, the reflection of a window or an
   * open door. GLARE is the same light arriving from everywhere at once: the veil that lifts the blacks and is
   * the reason you cannot read a CRT in a bright room. One has a direction, the other does not, and both go up
   * and down with how bright the room is. MATTE spreads them, exactly as it spreads the fixture. */
  /* GLARE IS GONE. It added vec3(uGlare) -- a flat, colourless, positionless lift over the entire face. It
   * reflected nothing: not the room, not the fixture, not the tubes, not anything that moved when you moved
   * them. It was a haze standing in for a reflection back when there was no reflection to have. There is one
   * now, it is ray-traced, and it comes off the same Fresnel two lines above this. A constant added on top
   * could only ever wash that out -- which is exactly what "the glare does not affect the things being
   * reflected" describes. Measured before removal: frame mean 26.50 to 27.23 across its whole range, all of it
   * uniform grey. */

  /* THE EDGE GATHER IS GONE -- a corner-weighted bright band just inside the rim, on uGather / EDGE GLASS.
   * Removed on request: it is not a thing the reference does, and it was one of the layers measured as painting
   * the glass at a level the reference never uses. Nothing else read uGather, so the uniform and the control go
   * with it rather than being left switched off. */

  // INNER VIGNETTE: the tube's edge falloff, darkening the reflections as well as the picture -- so it is applied
  // after the glass layers, not before, which is the paint order the layer handoff settled on.
  /* THE VIGNETTE GOES ON BOTH, or the two would not be the same picture apart from the reflection and the mix
   * would be blending in a brightness difference as well as a fitting. */
  float vigF = mix(1.0 - uVig, 1.0, smoothstep(1.0, 1.0 - max(uVigFall, 1e-3), ap));
  emis *= vigF; emisBare *= vigF;

  vec3 col = emis / (1.0 + emis);                                 // tone map once, at the end
  col = pow(max(col, 0.0), vec3(1.0/2.2));

  /* AND THE TRANSPARENCY IS SPENT HERE -- see the note where emisBare is taken. Both sides go through the same
   * tone map and the same gamma first, so what is being mixed is two finished pictures and the control is a
   * plain opacity between them. A uniform branch skips the second solve entirely at the ends, which is where
   * the control sits almost all of the time. */
  if (uGlare < 0.999) {
    vec3 colBare = emisBare / (1.0 + emisBare);
    colBare = pow(max(colBare, 0.0), vec3(1.0/2.2));
    col = mix(colBare, col, clamp(uGlare, 0.0, 1.0));
  }

  /* THE ELEVATION OVERLAY -- the debug instrument, and it reads the SURFACE, not the picture.
   *
   * This is what replaced the ring-band heat map. The bands sampled twenty annuli and reported the worst
   * COMPRESSION in each, which is elevation's derivative -- so a band told you the surface was changing without
   * telling you where it had got to. The sag is available in closed form, so the overlay reports it directly, per
   * pixel, on every ray.
   *
   * NOT MEASURED OFF faceK. The obvious shortcut is ap * (faceK(ap) - 1), but that is the PICTURE's displacement,
   * and since the rim is pinned that quantity is negative everywhere and zero at the rim regardless of which way
   * the glass bends -- it would report a dished face and a domed one identically. The sag is crt-projection's own
   * shape term, sign included: sg * A * uB^p, zero inside the band and largest at the rim.
   *
   * Cool where the glass is dished, near-black at flat, warm where it bulges. Contours every 2% of radius, which
   * is what turns a gradient into something you can read a height off. */
  if (uHeat > 0.5) {
    float uB = clamp((ap - uSagU0) / max(1e-4, 1.0 - uSagU0), 0.0, 1.0);
    float elev = uSagA * pow(uB, uSagP);
    /* A PLAIN GRADIENT, NO CONTOUR LINES. The rings were white bands every 2% of radius, and they read as
     * decoration rather than as slope: a contour tells you where equal heights are, but reading STEEPNESS off one
     * means eyeballing how close together the rings sit, which is exactly the work a gradient does for you. Their
     * spacing also had nothing to do with the ramp's own scale, so the two disagreed about where the surface was
     * changing fastest. Removed rather than tuned.
     *
     * Teal where the glass is dished, near-black at flat, amber where it bulges -- signed, because FACE runs both
     * ways and a debug view that renders IN and OUT alike is not reporting anything. */
    float e = clamp(elev * 3.0, -1.0, 1.0);
    vec3 cool = vec3(0.10, 0.62, 0.75), flatc = vec3(0.05, 0.05, 0.06), warm = vec3(1.0, 0.42, 0.10);
    vec3 hc = e < 0.0 ? mix(flatc, cool, -e) : mix(flatc, warm, e);
    col = mix(col, hc, 0.55);
  }

  /* DITHER GOES HERE, IN OUTPUT SPACE, AT HALF AN 8-BIT STEP -- and getting that wrong is what made the whole
   * face shimmer.
   *
   * It used to be added to emis, in LINEAR light, at a FIXED 0.010. Dither has to be sized against the
   * quantisation it is hiding, and the quantisation is in the 8-bit output, not in the linear signal. Empty glass
   * sits around 0.01-0.05 linear here, so a +-0.005 linear wobble is a large FRACTION of the signal, and the
   * 1/2.2 encode then stretches the dark end further -- measured at 41% of the frame moving more than 12 levels
   * between consecutive frames with the flicker, the sweeps and the persistence all switched OFF. That is not
   * dither, it is noise, and it got worse once the phosphor wash reached the whole faceplate instead of stopping
   * at the text raster.
   *
   * After the encode, 1/255 is one output step by definition at every brightness, so +-0.5 of one is the largest
   * dither that can never be seen as a flicker and the smallest that still breaks a band. It stays TEMPORAL --
   * hash includes uTime -- because a static pattern reads as fixed-pattern grain on a surface that is meant to be
   * smooth; at half a step, temporal averaging is what removes the banding without anything visibly moving. */
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0;

  // ALPHA CARRIES THE BEAM, LINEAR AND UNTONEMAPPED, for next frame's persistence to decay. The colour channels
  // are gamma-encoded for display and would be wrong to feed back.
  // THE MOULDING, COMPOSITED OVER THE PICTURE rather than replacing it -- zero except in the one-pixel band
  // that straddles the glass rim, which is the whole point of computing it this late.
  if (mouldCov > 0.0) col = mix(col, mouldCol, mouldCov);
  /* THE FIXTURE ON ITS OWN. Everything above composites the fitting as a REFLECTION -- attenuated by GLARE,
   * folded into the phosphor's light, sitting behind whatever the tube is doing. That is the right way to see
   * it and the wrong way to BUILD it: at four percent reflectance, behind text, a millimetre of cap or a flute
   * of prism is invisible, so it cannot be judged and therefore cannot be got right.
   *
   * This shows the model itself, at full strength, with nothing in front of it. It is not a rendering mode --
   * nothing about the picture changes -- it is the instrument equivalent of taking the part out and putting it
   * on the bench. The geometry is identical; only the compositing is skipped. */
  if (uFixSolo > 0.5) {
    /* GAIN 2.2, NOT 6. The bench view exists to JUDGE the model, and x6 defeated that: everything above about
     * a sixth of full scale landed on the flat part of x/(1+x), so the glass at 0.9 and the metal cap at 0.25
     * both came back near white and the materials were indistinguishable. A view that saturates cannot be used
     * to tell two surfaces apart, which is the one thing it is for. Bright enough to see into the recess,
     * dim enough that the tone curve is still doing work. */
    vec3 solo = room * max(uFixture, 0.001) * 2.2;
    col = solo / (1.0 + solo);
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  }
  o = vec4(col, beamLum);
}`;

const BLOOM_FRAG = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D uTex; uniform vec2 uDir; uniform float uThresh; uniform vec3 uTint;
void main(){
  /* SEPARABLE, AT QUARTER RESOLUTION, AND THRESHOLDED. The DOM equivalent is blur(40px) on a full-stage layer --
     a real gaussian over every device pixel, every time anything invalidates it. Thirteen taps on a quarter-size
     buffer is around thirty times less work, and because the input is linear and unclamped there is something
     above white to bloom FROM rather than a grey haze. */
  vec3 s = vec3(0.0); float wsum = 0.0;
  for (int i = -6; i <= 6; i++){
    float w = exp(-float(i*i) / 18.0);
    vec3 t = texture(uTex, v + uDir * float(i)).rgb;
    s += max(t - uThresh, 0.0) * w; wsum += w;
  }
  o = vec4(s / wsum * uTint, 1.0);
}`;

/* THE PRESENT PASS IS A COPY, AND IT WAS BEING DONE WITH THE BLUR.
 *
 * The final blit to the default framebuffer ran BLOOM_FRAG with uDir = (0,0), uThresh = 0 and uTint = 1 --
 * which is arithmetically an identity (thirteen taps of the same texel, weighted, divided by the same
 * weights) and costs thirteen full-resolution texture fetches per pixel to compute it. Measured with
 * EXT_disjoint_timer_query_webgl2 on the UHD 630 at 2.53 MP: 2.535 ms of the frame's 15.8 ms, 16% of all
 * GPU time, spent copying a buffer.
 *
 * One tap does the same job. The blur program stays exactly as it was -- it is still the right shader for
 * the two passes that actually blur -- and only the pass that was never blurring anything changes. */
const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D uTex;
void main(){ o = vec4(texture(uTex, v).rgb, 1.0); }`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function target(gl, w, h, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  /* MIPS ONLY WHERE THEY ARE WANTED. A mip chain is how the fixture's blur is prefiltered -- roughness picks a
   * level and one textureLod replaces a loop of ray-casts -- but building one costs bandwidth, so the buffers
   * that never sample below level 0 do not get the flag. */
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { tex: t, fbo: f, w, h };
}

/* WHICH ADAPTER ARE WE ON. A page cannot CHOOSE its GPU -- powerPreference:'high-performance' is ignored on
 * Windows Chrome, measured -- but it can ask which one it got, and adapt. Detection is available even though
 * selection is not, and that is the whole adaptive story. */
export function detectGPU(gl) {
  try {
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const name = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '';
    return { name, integrated: /intel|uhd|iris|radeon\s*graphics|adreno|mali|apple/i.test(name) };
  } catch (_) { return { name: '', integrated: false }; }
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;
  if (!gl.getExtension('EXT_color_buffer_half_float')) return null;

  const main = program(gl, FRAG);
  const fixp = program(gl, FIXTURE_FRAG);
  const blur = program(gl, BLOOM_FRAG);
  const copyp = program(gl, COPY_FRAG);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const bind = (prog) => {
    const loc = gl.getAttribLocation(prog, 'p');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  };
  const mkTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const contentTex = mkTex(), faceTex = mkTex(), outlineTex = mkTex();
  /* THE LUT MUST BE NEAREST, and getting this wrong is a spectacular silent failure rather than a subtle one.
   *
   * R32F is not filterable in WebGL2 without OES_texture_float_linear. With LINEAR set, `texture()` returns 0 for
   * every sample -- so unwarp() reads 0, k collapses to 0, and the shader samples a pinprick at the centre of the
   * content and stretches it over the whole tube. The tell was the SCANLINE PITCH: bands about seven times too
   * coarse, which is a measurement of how far the sampling had zoomed in, not a bug in the scanlines.
   *
   * 512 entries across a monotone curve is far more resolution than a screen radius needs, so point sampling costs
   * nothing here and cannot depend on an extension being present. */
  [faceTex, outlineTex].forEach((t) => {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  });

  let bloomA = null, bloomB = null, histA = null, histB = null, fixT = null, W = 0, H = 0;
  // The fixture pass's last input signature -- see the note where it is built. null forces the next trace.
  let lastFixSig = null;

  const size = (w, h) => {
    if (w === W && h === H) return;
    W = w; H = h; canvas.width = w; canvas.height = h;
    // fixT is reallocated below, so whatever the last trace put in it is gone and the key must not claim
    // otherwise. A cache that survives its own backing store is the bug the DOM build's _flkEpoch exists for.
    lastFixSig = null;
    [bloomA, bloomB, histA, histB, fixT].forEach((t) => {
      if (!t) return; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo);
    });
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    bloomA = target(gl, bw, bh); bloomB = target(gl, bw, bh);
    histA  = target(gl, w, h);   histB  = target(gl, w, h);
    /* FULL RESOLUTION, WITH A MIP CHAIN OVER IT.
     *
     * Half res was the wrong economy. The reflection is soft ONCE MATTE IS UP -- but at zero it is a sharp image
     * of a box with straight edges and two cylinders, and halving the resolution aliases every one of those
     * edges into stair-steps that upscaling only makes bigger. Softness is what the mip chain is FOR; the base
     * level has no business being pre-softened, and it was buying a quarter of a cost that is already only one
     * trace per pixel.
     *
     * Level 0 is the sharp fixture, each level above it twice as blurred, and MATTE picks between them. */
    fixT = target(gl, w, h, true);
  };
  /* THE DOMAIN TRAVELS WITH THE TABLE. buildFaceLUT hands back { u, r1, rimK }: the samples, the screen radius
   * they run out to, and the slope past it. Keeping them together is the point -- a table uploaded with the wrong
   * r1 is a silently rescaled warp, which is exactly the class of bug this file is trying not to have. */
  let faceR1 = 1, faceRimK = 1, faceN = 1;
  const setFaceLUT = (lut) => {
    const u = lut.u || lut;                       // tolerate a bare array: identity domain
    faceR1 = lut.r1 == null ? 1 : lut.r1;
    faceRimK = lut.rimK == null ? 1 : lut.rimK;
    faceN = u.length - 1;
    gl.bindTexture(gl.TEXTURE_2D, faceTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, u.length, 1, 0, gl.RED, gl.FLOAT, u);
  };
  let outlineN = 1;
  const setOutlineLUT = (lut) => {
    outlineN = (lut.length >> 1) - 1;      // travels with the table: the shader indexes by texel, not by uv
    gl.bindTexture(gl.TEXTURE_2D, outlineTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, lut.length >> 1, 1, 0, gl.RG, gl.FLOAT, lut);
  };
  const uploadContent = (src) => {
    gl.bindTexture(gl.TEXTURE_2D, contentTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  };
  const U = (p, n) => gl.getUniformLocation(p, n);

  /* THE FIXTURE'S INPUT SIGNATURE, ACCUMULATED AS THE UNIFORMS ARE UPLOADED RATHER THAN LISTED BY HAND.
   *
   * The fixture pass is skipped when nothing it reads has moved (see the note in draw), and that needs a key
   * over its inputs. Writing that key as a list of uniform names would be a SECOND description of what the
   * fixture shader reads, free to drift from the first the next time a uniform is added to it -- the exact
   * failure this file keeps one setAll to avoid.
   *
   * So the key is recorded by the uploads themselves, and filtered by `U(prog, n)` being non-null. A uniform
   * the fixture program does not declare -- or that the compiler dropped as unused, which is what happens to
   * uTime -- has no location, contributes nothing to the key, and is already a silently-ignored upload. Add a
   * uniform to the fitting and it joins the key on its own; delete one and it leaves. The list cannot be wrong
   * because there is no list.
   *
   * uTextRect is the case that shows why the filter matters and not merely tidies: it is uploaded to both
   * programs, it moves whenever the text does, and the fitting does not read it. Keyed on unfiltered uploads
   * the cache would miss on every character typed.
   *
   * RECORDING IS `sig !== null`, NOT `sig`. The accumulator starts as the empty string, which is falsy, so a
   * truthiness test switches recording off until the first append -- meaning nothing ever appends and the key
   * is the constant '' forever. That was written once and caught by the invalidation test: the fixture traced
   * on the first frame and never again, and every scene in the fingerprint wore the first scene's fitting. */
  let sig = null;
  const keep = (n, l, v) => { if (sig !== null && l !== null) { sig += n; sig += v; sig += ';'; } };

  /* ONE PLACE THAT KNOWS THE NUMBERS, TWO PROGRAMS THAT NEED THEM.
   *
   * The fixture is traced in its own pass now, and it has to trace the SAME fitting as the main pass believes in
   * -- same lamp positions, same housing, same flicker phase. Two copies of these uploads would be two places to
   * forget one, and a fixture whose reflection disagreed with its own glow is exactly the class of bug this file
   * keeps a single source of truth to avoid. Unused uniforms in either program resolve to -1 and are ignored. */
  const setAll = (prog, s) => {
    /* uAspect BELONGS IN HERE, and leaving it out cost the whole fixture.
     *
     * It was set on the main program alone, a few lines below where this block was lifted from. The fixture pass
     * therefore traced with an aspect of zero -- the default for an unset uniform -- which collapses boxHi.x to
     * zero, degenerates the aperture, and returns black for every pixel. The fitting did not go dim or land in
     * the wrong place; it had no width to be seen at.
     *
     * Anything the two programs share has to be uploaded by the one function that knows about both. A uniform
     * set beside the draw call instead of inside here is a uniform only one of them will ever get. */
    { const l = U(prog, 'uAspect'); keep('uAspect', l, W / H); gl.uniform1f(l, W / H); }
      const f = (n, x) => { const l = U(prog, n); keep(n, l, x); gl.uniform1f(l, x); };
      f('uTime',s.time); f('uOverscan',s.overscan);
      // faceShaped's own clamp and BOW_K, not a second opinion about them.
      f('uBow', Math.max(0, Math.min(0.15, (s.bend || 0) / 100)) * 0.33); f('uScanN',s.scanN); f('uScanW',s.scanW); f('uScanA',s.scanA);
      f('uGrilleN',s.grilleN); f('uGrilleW',s.grilleW); f('uGrilleA',s.grilleA);
      f('uPhos',s.phos); f('uBloomAmt',s.bloom); f('uBright',s.bright); f('uBeam',s.beam);
      f('uVig',s.vig); f('uVigFall',s.vigFall);
      // The sag itself, straight off crt-projection's profile -- see the elevation overlay.
      f('uHeat', s.heat || 0); f('uSagA', s.sagA || 0); f('uSagU0', s.sagU0 || 0); f('uSagP', s.sagP || 2.0);
      f('uSweep',s.sweep); f('uSweepOn',s.sweepOn); f('uSweepH',s.sweepH);
      /* THE TIP'S GEOMETRY ARRIVES IN suv, NOT PIXELS. Radius, gun split and pull are all specified on the panel
       * as screen distances -- the only unit any of them is meaningful in -- and the caller divides by the render
       * height once, at the boundary, exactly as it does for the scanline width and the frame. A shader that took
       * raw px would have to know the render scale, and then two places would know it. */
      f('uHSweep', s.hsweep || 0);   f('uDotLvl', s.dotLvl || 0);
      f('uDotRX', s.dotRX || 0);     f('uDotRY', s.dotRY || 0);
      f('uSweepSol', s.sweepSol == null ? 0 : s.sweepSol);
      f('uSweepRGB', s.sweepRGB || 0); f('uBeamPull', s.beamPull || 0);
      f('uSweepDip', s.sweepDip || 0); f('uDipFall', s.dipFall == null ? 4 : s.dipFall);
      f('uSweepWhite', s.sweepWhite == null ? 0.6 : s.sweepWhite);
      f('uSweepStep', s.sweepStep || 0); f('uDotHalo', s.dotHalo || 0); f('uTipRGBX', s.tipRGBX || 0); f('uTipRGBY', s.tipRGBY || 0);
      f('uBeamConv', s.beamConv || 0); f('uDipNoise', s.dipNoise || 0);
      f('uPullInk', s.pullInk == null ? 0.5 : s.pullInk);
      f('uRipple', s.ripple || 0);
      f('uGlowA', s.glowA == null ? 0.35 : s.glowA); f('uGlowB', s.glowB == null ? 0.35 : s.glowB);
      f('uBoxVis',  s.boxVis  == null ? 1 : s.boxVis);
      f('uRailVis', s.railVis == null ? 1 : s.railVis);
      f('uMainsPh', s.mainsPh || 0); f('uCapLen', s.capLen == null ? 0.05 : s.capLen);
      f('uFrost', s.frost || 0); f('uDiffuse', s.diffuse || 0);
      f('uPrism', s.prism || 0); f('uPrismN', s.prismN == null ? 18 : s.prismN);
      f('uPrismK', window.__prismK !== undefined ? window.__prismK : 0.12);
      f('uRecess', s.recess == null ? 0.2 : s.recess);
      f('uGlowAmt', s.glow || 0); f('uGlowFall', s.glowFall || 0.12);
      { const r = s.textRect || [-1,-1,-1,-1], l = U(prog,'uTextRect');
        keep('uTextRect', l, r); gl.uniform4f(l, r[0], r[1], r[2], r[3]); }
      f('uFlicker',s.flicker); f('uPersist',s.persist);
      // THE COLLAPSE, DEFAULTING TO NO COLLAPSE. A caller that has never heard of the power animation gets 1,1
      // and the shader's uniform branch never runs -- see the note where uPwr is declared.
      const f2 = (n, a, b) => { const l = U(prog, n); keep(n, l, '' + a + ',' + b); gl.uniform2f(l, a, b); };
      { const pw = s.pwr || [1, 1]; const l = U(prog,'uPwr');
        keep('uPwr', l, pw); gl.uniform2f(l, pw[0], pw[1]); }
      // THE MAGNET, DEFAULTING TO NO MAGNET -- a zero vector and the shader's uniform branch never runs.
      { const wk = s.warpK || [0, 0, 0, 0], wp = s.warpPos || [0.5, 0.5], wr = s.warpR || [0.5, 0.55],
              wd = s.warpD || [0, 0], l = U(prog,'uWarpK');
        keep('uWarpK', l, wk); gl.uniform4f(l, wk[0], wk[1], wk[2], wk[3]);
        f2('uWarpPos', wp[0], wp[1]);
        f2('uWarpR', wr[0], wr[1]);
        f2('uWarpD', wd[0], wd[1]); }
      { const cv = s.conv || {};
        f2('uConvR', cv.rx||0, cv.ry||0);
        f2('uConvG', cv.gx||0, cv.gy||0);
        f2('uConvB', cv.bx||0, cv.by||0); }
      f('uFixture',s.fixture); f('uFixY',s.fixY); f('uFixW',s.fixW); f('uFixH',s.fixH);
      f('uFixGap',s.fixGap); f('uFixTilt',s.fixTilt); f('uFixDist',s.fixDist);
    /* THE LENS THE FITTING IS SEEN THROUGH, and it was a fisheye.
     *
     * The ray was normalize(vec3(sp2, -1.0)), which puts the screen one unit from the eye and spans it +/-1 --
     * a 90 degree vertical field of view. At that focal length a tilt throws one edge of the fitting far nearer
     * than the other and it wedges hard: measured at TILT 64, the near edge came out 1.62x the width of the far
     * edge, and the recess inside it exaggerated by the same factor. That is what "the depth is too much" was.
     *
     * A reflection's field of view is not free -- it is the angle the SCREEN subtends at the viewer. A ~30cm
     * tube seen from ~60cm is about 28 degrees, not 90, which is a focal length near 4. So the wide angle was
     * never right; it was just never questioned.
     *
     * THE DISTANCE SCALES WITH IT, which is what makes this safe. Longer lens and proportionally further away
     * is the same apparent size with less divergence -- ordinary telephoto compression -- so sp2 = X/uFixDist
     * either way and nothing about an untilted fitting moves. Verified rather than assumed: at TILT 0 the
     * silhouette measures 633x314 px at lens 1.0 and 633x314 at lens 4.0, identical. Only the tilted case
     * changes, which is the only case that was wrong.
     *
     *     lens    1.0   1.5   2.0   3.0   4.0
     *     wedge  1.62  1.38  1.27  1.17  1.13     (near edge / far edge at TILT 64)
     *
     * 3.0 rather than the fully physical 4.0: a reflection with no taper at all stops reading as tilted, and
     * TILT is a control someone is meant to see working. `window.__fixLens` overrides it live for tuning. */
      f('uFixLens', window.__fixLens !== undefined ? window.__fixLens : 3.0);
      f('uFixX',s.fixX || 0);
      f('uOpenW',s.openW); f('uOpenH',s.openH);
      f('uFlkA',s.flkA); f('uFlkB',s.flkB); f('uHealthA',s.healthA); f('uHealthB',s.healthB);
      f('uSheen',s.sheen); f('uMatte',s.matte); f('uGlare',s.glare || 0);
      f('uSheenR', s.sheenR == null ? 0.25 : s.sheenR); f('uResH', H); f('uFixSolo', s.fixSolo || 0);
      f('uRailW', s.railW || 0);
      f('uSpot',s.spot); f('uTubeDead', s.tubeDead == null ? 1 : s.tubeDead);
      f('uFrame',s.frame); f('uFrameW',s.frameW);
      f('uFrameOn', s.frameOn ? 1 : 0);
      // 1 + WIDTH when the frame is shown, so glass + moulding exactly fills the box; 1 when it is not.
      /* THE FIT IS SET BY THE TIGHTEST RAY. With a constant-width frame the outer edge cannot land on
       * the box on every ray at once -- the outline's radius varies and the frame's width does not --
       * so it is solved on the SHORTEST radius (the short axis, where the outline is 1 in these units)
       * and the long axis simply keeps a little margin. Solving it anywhere else overflows. */
      f('uFrameFit', s.frameOn ? 1 / Math.max(0.35, 1 - s.frameW) : 1);
      /* NO uFrameTint / uFrameGlow. Both were uploaded every frame and read by nothing: bezelCols
       * resolves TINT and the lamp lift into the base/lo/hi/tint tones before they ever reach here, so
       * the shader was being handed the inputs to a calculation it does not perform. */
      const v3 = (n, a) => { const l = U(prog, n); keep(n, l, a); gl.uniform3f(l, a[0], a[1], a[2]); };
      v3('uInk',s.ink); v3('uHalo',s.halo); v3('uLamp',s.lamp); v3('uGrilleInk',s.grilleInk);
      v3('uLampA', s.lampA || s.lamp); v3('uLampB', s.lampB || s.lamp);
      v3('uBzBase',s.bzBase); v3('uBzLo',s.bzLo); v3('uBzHi',s.bzHi);
      f('uBzInner', s.bzInner); f('uBzLocal', s.bzLocal || 0);
      f('uBzPhos', s.bzPhos || 0); f('uBzLamp', s.bzLamp || 0);
  };

  const draw = (s) => {
    /* THE FIXTURE FIRST, ONCE, INTO ITS OWN HALF-RESOLUTION TARGET, then a mip chain over it.
     *
     * This replaces 4 to 16 ray-casts PER PIXEL in the main pass with one ray-cast per pixel of a buffer that
     * has a quarter of them -- and the cost stops depending on MATTE entirely, because roughness now picks a mip
     * level instead of a tap count. generateMipmap is done by the driver, in hardware.
     *
     * The same uniforms go to this program as to the main one: it traces the same fitting with the same numbers,
     * and the two disagreeing about where the lamps are would be the exact class of bug this project keeps
     * having. */
    /* AND SKIPPED ENTIRELY WHEN NOTHING IT READS HAS MOVED, which most frames it has not.
     *
     * fixT holds the result until something overwrites it, and the only writer is this pass -- so a frame
     * whose fixture uniforms are identical to the last one's would re-trace the same fitting into the same
     * buffer and rebuild the same mip chain for it. Measured on the UHD 630 at 2.53 MP: 2.59 ms for the trace
     * and 0.57 ms for the chain, 23% of the frame's GPU time, to produce a byte-identical texture.
     *
     * The uniforms are still uploaded -- setAll runs, and that is what BUILDS the key -- because the upload
     * is the cheap part and the fixture program is not the only consumer of the values. Only the draw and the
     * mipmap are skipped, and they are the entire cost.
     *
     * THE KEY MUST INCLUDE THE BUFFER, and size() is where it is invalidated: a resize reallocates fixT, and
     * the fresh texture is empty however familiar the uniforms look.
     *
     * WHEN IT DOES NOT HIT, and this is honest rather than a caveat: any lamp that is actively guttering moves
     * uFlkA or uFlkB every frame, and RIPPLE moves uMainsPh every frame at any non-zero setting. Those frames
     * pay the full cost, exactly as before. What this recovers is the steady state -- flicker at rest between
     * bursts, both lamps off, or the panel simply sitting still -- which is most of the time the page is open
     * and all of the time it spends being looked at rather than driven. */
    /* useProgram FIRST, THEN setAll. gl.uniform* writes to the program that is CURRENTLY BOUND, not to the one
     * the location came from, so uploading fixp's locations while another program is active is an
     * INVALID_OPERATION per call and the values never land. setAll therefore runs once, in the right order,
     * and the key it records is a by-product of the upload rather than a second pass over the same values. */
    gl.useProgram(fixp); bind(fixp);
    sig = '';
    setAll(fixp, s);
    const fixSig = sig;
    sig = null;
    if (fixSig !== lastFixSig) {
      lastFixSig = fixSig;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fixT.fbo);
      gl.viewport(0, 0, fixT.w, fixT.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, fixT.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    gl.useProgram(blur); bind(blur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomA.fbo);
    gl.viewport(0, 0, bloomA.w, bloomA.h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, contentTex);
    gl.uniform1i(U(blur,'uTex'), 0);
    /* THE TAP SPACING IS THE BLOOM'S SIZE. It was hard-wired to one texel, which made the radius a constant of
     * the buffer's resolution -- the panel could say how MUCH bloom but never how WIDE, and the reference's only
     * bloom control is exactly the width. Thirteen taps weighted exp(-i*i/18) is a sigma of three taps, so the
     * blur is three times whatever one step covers, and stretching the step stretches the gaussian with it.
     *
     * The caller hands over a spacing already in texels of THIS buffer -- see where bloomSpread is computed --
     * because turning a CSS-pixel radius into texels needs the device ratio and the render scale, and neither
     * belongs in here. Same boundary the scanline width is converted at.
     *
     * HONEST LIMIT: past about three texels of spacing thirteen taps no longer sample the gaussian densely and
     * the tail starts to band. Bloom is a soft wash over the brightest peaks, so it hides this far better than a
     * sharp image would, but it is undersampling and not a wider blur. More taps is the fix if it ever shows. */
    const spread = s.bloomSpread == null ? 1 : s.bloomSpread;
    gl.uniform2f(U(blur,'uDir'), spread/bloomA.w, 0);
    gl.uniform1f(U(blur,'uThresh'), s.bloomThresh);
    gl.uniform3f(U(blur,'uTint'), s.halo[0], s.halo[1], s.halo[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomB.fbo);
    gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.uniform2f(U(blur,'uDir'), 0, spread/bloomA.h);
    gl.uniform1f(U(blur,'uThresh'), 0);
    gl.uniform3f(U(blur,'uTint'), 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(main); bind(main);
    gl.bindFramebuffer(gl.FRAMEBUFFER, histB.fbo);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, contentTex); gl.uniform1i(U(main,'uContent'),0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomB.tex); gl.uniform1i(U(main,'uBloom'),1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, histA.tex);  gl.uniform1i(U(main,'uPrev'),2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, faceTex);    gl.uniform1i(U(main,'uFace'),3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, outlineTex); gl.uniform1i(U(main,'uOutline'),4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, fixT.tex);   gl.uniform1i(U(main,'uFix'),5);
    // HOW MANY LEVELS THE CHAIN HAS, so MATTE at 1 lands on the last one rather than off the end.
    /* FIVE LEVELS -- a 32-texel filter, and the cap this started with.
     *
     * It is worth recording that this number was blamed for the "fixture disappears at MATTE 100%" bug and was
     * changed to 3 to fix it. That was wrong. The cause was a leftover crossfade inside traceFixture (see the
     * long note there) which discarded the fitting before the chain was ever sampled, and the tell was that
     * capping at 1, 2, 3, 4, 5 and 6 levels all produced THE SAME FRAME TO THE LAST DECIMAL. A control that
     * changes nothing across its whole range is not the control that is breaking something.
     *
     * With the crossfade gone the depth finally reads as a blur, measured on the fitting's own region:
     *
     *     cap    1     2     3     4     5     6     8
     *     peak  182   172   171   160   141   120    62
     *     mean   62    62    64    66    70    69    53
     *
     * Peak falling while the mean HOLDS is scattering -- light trading structure for area. At 8 the mean falls
     * too, which means the fitting is being smeared out of its own region and into the field, and that is the
     * disappearance the cap does have to prevent. Five sits at the end of the flat part of the mean: the
     * strongest blur that still moves light around rather than away.
     *
     * `window.__fixLods` overrides it live, which is how the table above was measured -- set it, call
     * renderNow(), read the frame back; leave it undefined and the constant applies. It costs one property
     * lookup per frame and it is the reason the false lead was caught rather than shipped. */
    gl.uniform1f(U(main,'uFixLods'), window.__fixLods !== undefined ? window.__fixLods : 5.0);
    gl.uniform1f(U(main,'uAspect'), W / H);
    gl.uniform1f(U(main,'uFaceN'), faceN); gl.uniform1f(U(main,'uOutlineN'), outlineN);
    setAll(main, s);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // THE PRESENT PASS -- one tap, not thirteen. See the note on COPY_FRAG.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(copyp); bind(copyp);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, histB.tex);
    gl.uniform1i(U(copyp,'uTex'),0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const t = histA; histA = histB; histB = t;
  };

  return { gl, size, draw, setFaceLUT, setOutlineLUT, uploadContent, gpu: detectGPU(gl) };
}
