/* crt-gl.js -- the CRT tube rendered as one pass instead of composited layers.
 *
 * The shader never re-derives the face's shape: crt-projection.faceProfile is the single authority,
 * buildFaceLUT samples and inverts it into a table, and the shader only looks the answer up. Pure like its
 * neighbors -- no component state, no document beyond the canvas it is handed.
 */

import { FIXTURE_GLSL, FIXTURE_UNIFORMS } from './crt-fixture-gl.js';
import { GLSL_HASH } from './crt-glsl-common.js';

/* Builds the inverse-face lookup table: samples faceProfile densely and inverts it by walking the monotone
 * curve, so the shader gathers from a table instead of re-deriving the projection's algebra. */
export function buildFaceLUT(profile, N) {
  const n = N || 512;
  const u = new Float32Array(n);

  /* Pinned at the rim: the lab regenerates its interior at each scale, but this renderer gathers from a content
   * texture, so the page sizes the content canvas by 1/F(1) to keep at least one source texel per output pixel.
   *
   * The table holds the ratio F-inverse(s*F(1))/s, indexed by glass-normalized radius s, not the radius itself --
   * dividing by s near the center would turn the table's own quantization into a visible shimmer. */
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

/* Builds the outline lookup table from crt-geometry.guideOutline: samples rQ (and wQ) over the first quadrant,
 * since the outline is symmetric in both axes. Rebuilt on SQUIRCLE, BEND or aspect changes. */
export function buildOutlineLUT(outline, N) {
  const n = N || 256, out = new Float32Array(n * 2);
  // Sampled at t = |y|/(|x|+|y|), matching the shader's own parameterization (no per-pixel atan).
  // R channel is rQ (the outline radius), G is wQ (the axis weight faceShaped bows the flats by).
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

/* The fixture's geometry and shading, written once (FIXTURE_GLSL) and compiled into both programs, so the
 * fixture pass and the main pass's reflection sample can never silently drift apart. */

const FIXTURE_FRAG = `#version 300 es
/* Renders the fixture once into its own target so MATTE (roughness) can pick a mip via textureLod instead of
 * sampling N directions per pixel. Independent of the face profile/LUTs, which is what lets it be its own pass.
 * Alpha carries coverage, so the main pass can divide the blur's brightness back out instead of it fading to
 * black. */
precision highp float;
in vec2 v; out vec4 o;
// Every uniform the main pass declares, verbatim -- an undeclared one fails to compile with a misleading line
// number, and the compiler drops whatever this pass doesn't use, so nothing is spent keeping the list long.
// FIXTURE_UNIFORMS covers the fitting's own inputs; what follows is only what this pass adds (the ray, placement).
${FIXTURE_UNIFORMS}
uniform float uAspect, uFixH, uFixTilt, uFixW, uFixX, uFixY, uMainsPh, uOpenH, uOpenW, uRecess, uRipple, uTime;

${GLSL_HASH}
/* The lamp as three pieces: glass barrel, then two flush metal end-sleeves (CAP LENGTH sets their reach), then a
 * disc closing each sleeve. Nearest hit wins. */
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
// uHSweep tip crossing rate (0 parks it). uDotRX/RY tip radii in suv, sized in GRILLE COLUMNS/SCANLINES so the
// spot is round in raster cells. uDotLvl drives the coating; uSweepSol blends soft (0) to hard-edged (1) sweep.
// uSweepRGB is the guns' split across the sweep, uBeamPull the line's drag under load -- both in screen px.
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
// uCapLen: the end cap as a FRACTION of the tube's own half-length -- see the note in tubeSurface for why.
// The diffuser, in three forms: uFrost scatters ON the tube (bigger, softer source); uDiffuse is an opal panel
// ACROSS the aperture (tubes stop being visible, whole opening glows); uPrism cuts vertical flutes, uPrismN of them.
// uRailW  thickness of the four mounting rails; their overhang and fade are 4x and 2x it (the lab's ratios)
// uRecess  the housing's depth behind the aperture, in the fixture's own units
uniform float uRecess;
/* uSweepWhite  how far the beam's own light runs toward white, away from the phosphor's color */
uniform float uSweepWhite;
/* uPwr: the power collapse -- what's left of the picture's width/height, 1,1 at rest. A dying tube's deflection
 * supply fails before the beam does, so the raster falls in on itself (vertical first) rather than fading; this
 * carries only that GEOMETRY, the LEVEL rides on uFlicker separately. */
uniform vec2 uPwr;
// The magnet: uWarpK = (pinch, pull, swirl, rgb), zero vector = off. uWarpPos is the pole in 0..1 picture space;
// uWarpR = (reach, rim knee). Motion lives on the page (a timeline), not here (a field) -- see the use site.
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
// uTubeDead  how much a SPENT section of a lamp still shows. 1 leaves it at the lit floor, 0 is truly black.
uniform float uFrame, uFrameW, uFrameOn, uFrameFit;
// Two lamps, two colors -- a real pair ages unevenly and drifts apart in color temperature. uLamp is their
// average, for anything that treats the fitting as one source.
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

/* Looks up the aperture from crt-geometry's outline table (rQ over the first quadrant, folded by symmetry) rather
 * than computing a formula; 1.0 lands on the rim by construction. No backtick in this comment -- it would close
 * the template literal this shader lives in. */
float outlineR(vec2 cc){
  // Indexed by |y|/(|x|+|y|), not the angle -- atan() cost a measured 16.7/33.3ms alternation (55% dropped
  // frames) on the UHD 630 at 2.9MP. Monotone in theta, so buildOutlineLUT samples the same parameter.
  // texelFetch + explicit lerp, not texture(): uOutline is RG32F, unfilterable without OES_texture_float_linear,
  // so texture() silently goes NEAREST and every ap iso-contour becomes a polygon.
  vec2 a = abs(cc);
  float t = a.y / max(a.x + a.y, 1e-6);
  float x = clamp(t, 0.0, 1.0) * uOutlineN;
  float i = floor(x);
  float r0 = texelFetch(uOutline, ivec2(int(i), 0), 0).r;
  float r1 = texelFetch(uOutline, ivec2(int(min(i + 1.0, uOutlineN)), 0), 0).r;
  return max(mix(r0, r1, x - i), 1e-5);
}
float aperture(vec2 cc){ return length(cc) / outlineR(cc); }

// The excited coating as a shape, not a blurred copy of the glyphs: a rounded-box distance field over the
// text block's bounds, uniform inside and falling off outside at the rate GLOW FALLOFF sets.
float glowField(vec2 uv){
  if (uTextRect.z < 0.0) return 0.0;                       // nothing typed yet
  vec2 mid = (uTextRect.xy + uTextRect.zw) * 0.5;
  vec2 hs  = (uTextRect.zw - uTextRect.xy) * 0.5;
  vec2 d   = abs(uv - mid) - hs;
  float outside = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return exp(-max(outside, 0.0) / max(uGlowFall, 1e-3));
}

/* The radial scale at a screen radius: uFace holds F-inverse(r)/r over 0..F(1); past the rim it's the constant
 * rimK, continuous at the join. texelFetch + lerp because R32F with LINEAR silently returns 0 without
 * OES_texture_float_linear. Never clamped -- clamping would smear the picture's last row across the real gap
 * outside the rim. */
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

// Fixture geometry, in local space: x along the tubes, y across them, z into the screen. The opening is the
// z=0 plane; the recess runs back to z=-depth.
/* The lamp as three pieces: glass barrel, then two flush metal end-sleeves (CAP LENGTH sets their reach), then a
 * disc closing each sleeve. Nearest hit wins. */
${FIXTURE_GLSL}

void main(){
  vec2 uv = v;
  vec2 c  = (uv - 0.5) * 2.0;
  c.x *= uAspect;
  vec2 q  = vec2(c.x / uAspect, c.y);          // square space, for the aperture and the fixture

  /* The glass shrinks so glass+molding fills the viewport (the outline spans the whole box, so a frame drawn
   * outward from ap=1 has nowhere to go). uFrameFit scales ap so the molding's outer edge lands where the rim
   * sits with the frame off; exactly 1 when the frame is off. */
  float oR = outlineR(c);
  float ap = length(c) / oR * uFrameFit;

  // The molding's three tones are crt-bezel's: base (body), lo (shadowed outer edge), hi (sheen along the lit
  // edge nearest the glass). Ramped hi -> base -> lo inward-to-outward since the inner edge faces the glass.
  float aaB = max(fwidth(ap), 1e-5);
  vec3 moldCol = vec3(0.0);
  float moldCov = 0.0;
  // Entered a pixel early so the band straddling the rim computes both molding and picture and can blend them.
  if (ap > 1.0 - aaB) {
    // FRAME OFF is no molding at all, not a black one: past the glass is simply outside the tube.
    /* Constant width, not constant fraction: a flat 1+uFrameW would be a fraction of ap's radius, which runs
     * 1.29x longer on the long axis, so the frame would come out thicker down the sides. Dividing by the outline
     * radius makes the band a fixed number of ap units wide (radially, not perpendicularly, fixed -- exact on
     * axis and at the diagonal, close enough between). */
    float outer = 1.0 + uFrameW * uFrameFit / oR;
    if (uFrameOn < 0.5 || ap > outer + max(fwidth(ap), 1e-5)) { o = vec4(0.006, 0.006, 0.007, 1.0); return; }
    float t = (ap - 1.0) / max(uFrameW, 1e-4);          // 0 at the glass, 1 at the outside edge
    vec3 col = mix(uBzHi, uBzBase, smoothstep(0.0, max(uBzInner, 0.02), t));
    col = mix(col, uBzLo, smoothstep(max(uBzInner, 0.02), 1.0, t));
    /* Not a light source: crt-bezel returns a reflectance (color), never black on its own, so the base is scaled
     * by what's actually falling on it this frame -- otherwise a mains blackout would leave the molding glowing
     * its own color through the dark. */
    /* The power collapse, spent on the frame: uFlicker carries the tube's LEVEL (which spikes to 4.4x as it
     * switches off) but not its shrinking AREA, so without pwrArea the frame would flare brightest as the
     * picture folds away. Flux = level * area; uPwr is what's left of both axes, 1x1 at rest. */
    float pwrArea = clamp(uPwr.x * uPwr.y, 0.0, 1.0);
    // Flux and condition together, not flicker alone -- a 10%-health pair would otherwise light the molding as
    // brightly as a new one. Mean, not max: one pool of light can't be two brightnesses.
    float lampOut = (uFlkA * uHealthA + uFlkB * uHealthB) * 0.5;
    float roomLit = uFixture * lampOut;
    // The screen's share: 3.0 puts a default tube with the room off at about a quarter lit -- crt-bezel's
    // "readable in a dark room".
    float tubeLit = uFlicker * uPhos * uBright * pwrArea * 3.0;
    col *= clamp(roomLit + tubeLit, 0.0, 1.0);
    /* The phosphor lights the frame where the picture is actually bright, not uniformly -- uBzTint alone would
     * light the far side of the frame as much as the near side. Walking the ray back to the glass rim samples
     * the bloom buffer (already-blurred content) at the adjacent point; falls off across the frame's width. */
    vec2 cRim = c / max(ap, 1e-4);
    // One fetch of the glow buffer (unthresholded, blurred at 1/16) rather than many taps of a disc; the sweep's
    // own contribution is added separately since it lives in the picture path this block runs before.
    vec2 srcRim = cRim * uFrameFit / uOverscan;
    srcRim.x /= uAspect;
    vec2 uvRim = srcRim * 0.5 + 0.5;
    float spR = 1.0 - fract(uTime * uSweep);
    float sweepR = exp(-pow((uvRim.y - spR) / max(uSweepH * 3.0, 1e-4), 2.0))
                 + exp(-pow((uvRim.y - spR) / max(uSweepH * 7.0, 1e-4), 2.0)) * 0.4;
    vec3 bleed = vec3(glowField(uvRim) * 0.05) + vec3(sweepR * uSweepOn * 0.02);
    bleed *= exp(-t * 2.2);
    // Added, not substituted -- and not tinted again by uBzTint (the sample already carries the phosphor's color;
    // multiplying again would over-saturate toward pure red). uHalo keeps the tint the wash and bloom agree on.
    // GAIN compensates for area-averaging: the sampled patch only partly overlaps lit glyphs, so the raw mean
    // undersells the light arriving and needs a scale to become visible on the plastic.
    col += uHalo * bleed * uBzLocal * 70.0 * uFlicker * pwrArea;

    // Screen glow: the phosphor's own output reflected across the bezel (biased toward the inner edge), scaled
    // by uFlicker so a guttering tube's highlight dips with it rather than reading as painted on.
    float phosOut = uPhos * uBright * uFlicker * pwrArea;
    col += uHalo * uBzPhos * phosOut * 2.2 * mix(1.0, 0.30, t);

    // The room's lamp, weighted by height relative to uFixY so moving POS Y moves the highlight instead of it
    // being baked to "up"; uLamp carries kelvinRgb's color so the tint follows TEMP.
    float lampW = smoothstep(-0.35, 0.95, q.y - uFixY);
    // Gated on uFixture: crt-flicker returns 1.0 (not flickering) even when a lamp isn't running, so without this
    // gate a dead lamp still paints a highlight across the molding.
    col += uLamp * uBzLamp * lampW * 0.55 * lampOut * uFixture;
    col *= 0.90 + 0.20 * noise(q * 260.0);              // molding grain
    // FRAME fades in display space, not linear light: scaling radiance ahead of the tone map gets compressed by
    // it, so the panel number would stop meaning "opacity." Fading the finished tone is exact and a no-op at 0/1.
    vec3 m = col / (1.0 + col);
    // Not clamped at 1: the control runs to 1.5, so past full it over-drives the tone toward white rather than
    // fading (only the 0..1 half is an opacity).
    m = pow(max(m, 0.0), vec3(1.0/2.2)) * max(uFrame, 0.0);
    moldCol = m;
    // The boundary band falls through rather than returning: the gather hasn't run yet, so there's no glass
    // color to blend toward -- the molding composites at the end instead, avoiding a stair-step join.
    moldCov = smoothstep(1.0 - aaB, 1.0 + aaB, ap);
    // Outer silhouette antialiased via fwidth(ap), which sizes the smoothstep to one pixel at any zoom. Only the
    // outer edge: fixing the inner one means compositing the molding over the picture, a restructure not done here.
    if (ap > 1.0 + aaB) {
      o = vec4(mix(m, vec3(0.006, 0.006, 0.007), smoothstep(outer - aaB, outer + aaB, ap)), 1.0);
      return;
    }
  }

  float r    = length(c);
  float rn   = r / length(vec2(uAspect, 1.0));    // circular; only the aberration and vignette want this

  /* The warp is measured against the glass, not a circle: faceShaped's G(u,th) = rho*F(u/rho), where rho is the
   * aperture radius over the box radius, so u/rho is the radius in glass units -- exactly what aperture() (ap)
   * returns. That collapses the shaped projection to a single inverse: u_glass = F-inverse(ap), k = u_glass/ap.
   *
   * No uFaceAmt here: the LUT is already built from the signed angle, so mixing state.face in again applies FACE
   * twice, and once FACE went negative (its IN half) mix() would extrapolate rather than blend.
   *
   * BOW rides on top since rho can't supply it (rho is exactly 1 on both axes at every BEND, so bow acts only at
   * the diagonal): ap = F(u/rho)*(1+bow*wAx*u^2) is implicit in u, closed with one fixed-point step -- bow is at
   * most 5%, so seeding from the un-bowed solve leaves error of order bow^2. */
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
  // Scaled by uFrameFit too, or the picture doesn't follow the glass: with the frame on, the rim sits at
  // 1/uFrameFit of the outline, so src must stretch by the same factor for the raster edge to land on it.
  vec2 src   = c * uFrameFit * k / uOverscan;
  src.x /= uAspect;
  vec2 suv = src * 0.5 + 0.5;

  /* The power collapse is applied to suv itself, so content, scan pattern, beam and bloom (all functions of suv)
   * squeeze into the surviving band together. pwrCov is measured in box coordinates, not the raster's -- gating
   * on the raster's own bounds would dim the rim whenever FACE is out. Guarded so at rest neither line runs. */
  float pwrCov = 1.0;
  if (uPwr.x < 0.999 || uPwr.y < 0.999) {
    suv = (suv - 0.5) / max(uPwr, vec2(2e-4)) + 0.5;
    // fwidth keeps the band's edge one pixel wide through the collapse; a hard step would crawl as it shrinks.
    vec2 aw = max(fwidth(an), vec2(1e-5));
    pwrCov  = (1.0 - smoothstep(uPwr.x - aw.x, uPwr.x + aw.x, an.x))
            * (1.0 - smoothstep(uPwr.y - aw.y, uPwr.y + aw.y, an.y));
  }

  /* The magnet bends the BEAM (suv), not the glass, so displacing suv drags the glyphs, scanline, mask sample and
   * bloom together while the faceplate stays put. warpRim pins the rim (0 on the box edge, rising inward) so the
   * deflection error vanishes at the clamp instead of sliding the whole picture like a dragged photograph.
   *
   * Three rim-pinned fields, summed: PINCH (a pole behind the middle, sampling farther out to pull content in),
   * PULL (a moving pole at uWarpPos, gaussian-bounded by uWarpR), SWIRL (that pole's tangential component).
   *
   * Gated on dot(uWarpK,uWarpK), not just .xyz: warpF (how hard the field bites) feeds GUN SPLIT downstream, so
   * testing only the first three components would leave the split dead whenever they're zero but rgb isn't. */
  float warpF = 0.0;                       // how hard the field is biting here -- the guns' split rides on it
  // The three guns' field displacements, solved once here and reused by the picture, sweep band and tip -- an
  // idealization: a real magnet can't split the content while leaving the writing beam itself converged.
  vec2 wgR = vec2(0.0), wgG = vec2(0.0), wgB = vec2(0.0);
  if (dot(uWarpK, uWarpK) > 1e-9) {
    // smoothstep, not a linear taper: a linear rim mask has a corner, and a corner in a displacement field
    // shows as a crease running around the picture.
    float warpRim = 1.0 - smoothstep(clamp(uWarpR.y, 0.0, 0.98), 1.0, max(an.x, an.y));
    vec2  q  = suv - 0.5;
    vec2  d  = suv - uWarpPos;
    float r  = length(d) / max(uWarpR.x, 1e-3);
    float fall = exp(-r * r);                                  // the pole's reach, soft-bounded
    vec2  dir  = r > 1e-4 ? d / max(length(d), 1e-6) : vec2(0.0);
    vec2  tang = vec2(-dir.y, dir.x);                          // tangential: the twist
    // DRAG shoves the whole raster bodily (no falloff but the rim clamp), unlike PULL/SWIRL which are bounded
    // by the pole's gaussian -- that's what reads as a big magnet rather than a small one.
    vec2  off  = uWarpD                                        // DRAG, the entire picture leaning
               + q * uWarpK.x                                  // PINCH, toward the middle of the tube
               + dir * uWarpK.y * fall                         // PULL, toward the pole
               + tang * uWarpK.z * fall;                       // SWIRL, around it
    suv  += off * warpRim;
    // warpF includes DRAG too, floored at drag's own share, so the split reaches everywhere the displacement does.
    warpF = clamp(max(fall, length(uWarpD) * 6.0), 0.0, 1.0) * warpRim;
    // A delta-gun tube's three cathodes sit 120 degrees apart, so each is displaced differently; green takes a
    // smaller share as the reference the others converge against. Read from the already-displaced suv.
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

  /* Gates the content only. A convex face leaves screen area with no content behind it (F(1) < 1), and the
   * content texture is CLAMP_TO_EDGE, so without this the last row of glyphs drags out to the rim as a stretch.
   * Must not gate the phosphor/scanlines -- those coat the whole faceplate and don't end where the text does. */
  float inRaster = (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) ? 1.0 : 0.0;

  // GLASS DEPTH parallax is gone (removed: displaced the shared content/bloom/glow coordinate for an effect
  // nothing on screen could be attributed to). puv survives because BEAM PULL still needs its own coordinate;
  // it just starts level with suv now.
  vec2 puv = suv;

  /* BEAM PULL: the line being drawn drags off true as the tip loads the supply -- current draw bends the active
   * line away from its geometric position, worst at the sweep's extremes where the yoke works hardest. The
   * displacement multiplies three things: closeness to the written line, distance toward the sides, and which
   * side the tip is on. Applied to puv only, so it moves the picture and not the scanlines/grille themselves. */
  // The tip ping-pongs (uHSweep is a round trip, not a crossing) -- deliberately unlike the vertical sawtooth,
  // since a retrace would snap the line's side rather than swing it.
  float hPhase = fract(uTime * uHSweep);
  float hx     = 1.0 - abs(2.0 * hPhase - 1.0);     // 0 -> 1 -> 0, a triangle
  float spY = 1.0 - fract(uTime * uSweep);
  /* How long ago the beam last visited this column -- ahead-or-behind would flip every column's answer the
   * instant the tip reverses, swapping the whole line's height in one frame. The tip crosses each column twice
   * per round trip (u=x/2 and u=1-x/2), so age is the smaller gap and stays smooth except right at the tip. */
  float ageOut  = fract(hPhase - suv.x * 0.5);        // last passed here on the way out
  float ageBack = fract(hPhase - 1.0 + suv.x * 0.5);  // ...or on the way back
  float lastSeen = min(ageOut, ageBack);              // 0 right at the tip, up to a full trip away from it
  float spLine  = spY - uSweepStep * lastSeen;
  if (uBeamPull > 0.0001 && uSweepOn > 0.001) {
    float onLine = exp(-pow((suv.y - spY) / max(uSweepH * 2.2, 1e-4), 2.0));
    /* Two parts: the honest side-rock (ends move most, middle barely) is invisible when the terminal block sits
     * mid-picture, so a local kink travels with the tip too -- physically justified, since loading is worst right
     * at the beam. Together the tip's pass always shows, and the extremes still rock hardest. */
    float nearTip = exp(-pow((suv.x - hx) / max(uDotRX * 8.0, 0.03), 2.0));
    float toSide  = abs(suv.x - 0.5) * 2.0;         // 0 in the middle, 1 at either end of the line
    // Drags harder where there's beam current to load the supply -- read at the undisplaced position, since the
    // displacement being computed here can't also be its own input.
    float ink = max(max(texture(uContent, puv).r, texture(uContent, puv).g), texture(uContent, puv).b);
    float load = 1.0 + uPullInk * ink * inRaster;
    puv.y += uBeamPull * onLine * load * (nearTip * 0.65 + toSide * (hx - 0.5) * 2.0 * 0.35);
  }

  /* Convergence error: the three guns don't land on the same triad, split into x (guns are horizontal, red/blue
   * land either side of green) and y (yoke field uneven top to bottom) -- both grow as rn^2, exact on axis. It's
   * a STATIC per-gun offset (what a technician can't adjust out), not a deflection error, so nothing moves at
   * screen center where the text lives; a symmetric pair is just RED X=+n, BLUE X=-n. The uniforms arrive in
   * content-uv (converted from CSS px by the page), so the value survives devicePixelRatio and RENDER SCALE. */

  /* Beam spot: a CRT drags a gaussian along the line, so a stroke blooms along the scan and stays tight across
   * it -- the taps run in CONTENT space so they follow the warp. Measured via fwidth in SCREEN pixels; scaling by
   * scanline count instead put taps ~15px apart (a ghost, not a spot, and two orders of magnitude too wide).
   *
   * The beam also disturbs convergence on the line it's writing (worse than static convergence, since the yoke
   * is actively working that line) -- red/blue take equal-and-opposite offsets, green stays put, same as
   * CONVERGENCE. */
  float onLineC = uBeamConv > 1e-6
                ? exp(-pow((suv.y - spLine) / max(uSweepH * 2.5, 1e-4), 2.0)) * uSweepOn : 0.0;
  vec2 cR = uConvR + vec2( uBeamConv, 0.0) * onLineC;
  vec2 cG = uConvG;
  vec2 cB = uConvB + vec2(-uBeamConv, 0.0) * onLineC;
  // The field splits the guns here (not as a post-filter) so it reads as CONVERGENCE getting worse under the
  // magnet, not a colored ghost on top -- three directions, not one axis, since a delta-gun's cathodes sit 120
  // degrees apart (see wgR/wgG/wgB above) rather than on the single axis static convergence uses.
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
  /* Across the scan the spot is tight, so just one extra close pair -- per gun again: this max()es against the
   * tap loop above, and sampling at puv with no gun offset would win on bright glyphs and undo the loop's
   * displacement. Every content fetch must agree on where each gun points. */
  emis = max(emis, 0.55 * (texture(uContent, puv + cR + vec2(0.0, spot.y)).rgb +
                           texture(uContent, puv + cR - vec2(0.0, spot.y)).rgb) * 0.5 * vec3(1.0, 0.0, 0.0)
                 + 0.55 * (texture(uContent, puv + cG + vec2(0.0, spot.y)).rgb +
                           texture(uContent, puv + cG - vec2(0.0, spot.y)).rgb) * 0.5 * vec3(0.0, 1.0, 0.0)
                 + 0.55 * (texture(uContent, puv + cB + vec2(0.0, spot.y)).rgb +
                           texture(uContent, puv + cB - vec2(0.0, spot.y)).rgb) * 0.5 * vec3(0.0, 0.0, 1.0));

  /* Content arrives already colored -- crt-terminal.bootLines picks fg/hi per glyph (with a WHITE-phosphor rule
   * a shader luminance threshold couldn't express), so this only linearizes it. Plain 2.2 gamma rather than the
   * piecewise sRGB curve: the difference is under a code value in the near-black text region, per-pixel path. */
  vec3 lin = pow(max(emis, 0.0), vec3(2.2));
  float lum = dot(lin, vec3(0.299, 0.587, 0.114));
  emis = lin * uBright * uBeam * inRaster;   // the CONTENT stops at the raster

  // Persistence reads back the beam's OWN luminance (alpha channel), not the whole composite -- feeding the
  // composite back would loop reflections/wash/bloom into their own input and settle at a bright fixed point.
  float prevBeam = texture(uPrev, uv).a;
  float beamLum  = dot(emis, vec3(0.299, 0.587, 0.114));
  // uInk, not the sampled color: a decaying phosphor glows in ITS OWN emission color whatever was
  // written to it, which is why persistence reads amber on a white glyph rather than white.
  emis = max(emis, uInk * prevBeam * uPersist);
  beamLum = max(beamLum, prevBeam * uPersist);

  /* Shadow mask: strokes at a pitch, not a cosine (a cosine can't vary width and spacing independently). N is the
   * panel's PPI rule (round(span*density/100)) computed on the CPU. fwidth converts distance-to-line into screen
   * pixels through the warped coordinate, so lines stay one pixel wide at the rim regardless of dome compression.
   * Ink colors are fixed in code per crt/README.md, not controlled; both multiply, before anything glows. */
  /* The wash goes in before the mask (order matters): it's phosphor emission too (coating excited by scatter,
   * not the beam), so the mask has to occlude it the same as everything else the phosphor emits -- multiply on
   * black is black, and the wash is what the mask has to bite into on otherwise-empty glass. */
  emis += uHalo * uPhos * 0.055;                                  // phosphor wash, BEFORE the mask

  /* No Nyquist fade near the sampling limit: it looks like the fix for the diagonal bands on empty glass, but
   * those are the dither (see the note at the end of main()) -- the fade would just erase the phosphor grid to
   * solve a problem that isn't there. Real aliasing here would show as structure that MOVES when nothing
   * animates. */

  /* The sweep band: a sawtooth top-to-bottom (suv.y is 1 at the top, so plain fract(t) would sweep the wrong
   * way). A gaussian core plus a trailing wake and fringe give it a direction of travel; modulo not triangle so
   * the turn stays sharp, and it's hidden (not wrapped) past either end so a reappearing wake never reads as a
   * second beam. Gated on its own amount via a uniform branch, free to skip. */
  float sp = spLine;                               // the STEPPED line: see where spLine is built
  // Split by what the light IS, not where it is: the tight core is the beam (electrons, runs toward white),
  // the spread is coating answering it (the phosphor's own color) -- coloring both alike made it glow like a
  // torch rather than a screen.
  vec3 sweepCore = vec3(0.0), sweepSpread = vec3(0.0);
  vec3 dotCoreC = vec3(0.0), dotHaloC = vec3(0.0);   // per gun: the tip splits like everything else does
  float dip = 0.0;   // how much the coating AHEAD of the beam has faded before it gets back to it
  if (uSweepOn > 0.001) {
    /* SOLIDITY crossfades between a flat-topped core with real shoulders (sharp boundary between "being written"
     * and "already written," which is what a beam actually does) and stacked gaussians (a soft, all-lit stripe).
     * The wake is one-sided: light ahead of the beam hasn't been emitted yet. */
    float d    = suv.y - sp;                        // >0 is BEHIND, because sp descends
    float w    = max(uSweepH, 1e-4);
    float soft = exp(-pow(d / w, 2.0))
               + exp(-pow(d / (w * 3.4), 2.0)) * 0.16;
    float core = 1.0 - smoothstep(w * 0.35, w * 1.05, abs(d));
    // Short wake, not a halo: previously 2.6 widths / 0.55 amplitude buried the line in its own glow and read as
    // a moving gradient. Cut to ~1 width / 0.35 so the line stays the brightest thing near it.
    float wake = d > 0.0 ? exp(-d / (w * 1.1)) * 0.35 : 0.0;
    float hard = core + wake;

    // Split vertically, not horizontally: a sideways split on a horizontal line slides along it invisibly, while
    // a vertical split fringes the edge -- where a misconverged sweep actually shows. Free: an analytic shape.
    for (int g = 0; g < 3; g++) {
      // The magnet adds to uSweepRGB's static misconvergence rather than replacing it. Only .y is used -- a
      // lengthwise (x) split on this horizontal line would slide along it, invisibly.
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

    /* The deficit ahead of the beam (below it, since the beam descends): coating there has waited nearly a full
     * period and is the frame's dimmest, recovering further down. Multiplied into emission, not added -- this is
     * the phosphor having less to give, not a black object on top, so it can't push a dark area below zero. */
    float ahead = d < 0.0 ? exp(d / (w * max(uDipFall, 0.05))) : 0.0;
    // Static, not a clean fade: an un-driven phosphor breaks up rather than fading evenly. Grained per raster
    // cell (the size of the thing decaying), re-drawn on its own clock so it crawls rather than reading as a
    // texture stuck to the glass.
    float cellX = floor(suv.x * uGrilleN);
    float cellY = floor(suv.y * uScanN);
    // The time index is WRAPPED as well as hashed: 64 distinct frames of noise is more than the eye resolves,
    // and it keeps the argument small no matter how long the page has been open.
    float tIdx  = mod(floor(uTime * 30.0), 64.0);
    float grain = hash21(vec2(cellX, cellY) + tIdx * 37.0);
    dip = uSweepDip * ahead * mix(1.0, grain, clamp(uDipNoise, 0.0, 1.0));

    /* The tip: the only part of a raster that's ever actually lit, drawn as concentric discs (halo/body/core, the
     * project's usual widest-first ramp). It rides on spY (same beam, not two animations) and stays round via
     * aspect correction -- in raw suv it would ellipse and reshape as the window resizes. */
    // EITHER LEVEL KEEPS THE BLOCK ALIVE. Gating on uDotLvl alone made TIP HALO dead whenever TIP GLOW was
    // at zero -- two independent controls, one of them silently the other's master.
    if ((uDotLvl > 0.001 || uDotHalo > 0.001) && uDotRX > 1e-6 && uDotRY > 1e-6) {
      // Measured in cells, so no aspect term needed: radii already arrive scaled by the raster (x by grille
      // columns, y by scanlines), landing both axes in the same space.
      // The tip sits on the written line, not between two shoulders: it's the corner where the already-written
      // line meets the not-yet-reached part, which is physically what the tip is.
      vec2 dp = vec2((suv.x - hx) / max(uDotRX, 1e-6),
                     (suv.y - spY) / max(uDotRY, 1e-6));
      // One phosphor, not a lamp: an edged disc (with a whisper past the edge to avoid aliasing into a hard
      // circle), not stacked gaussians -- a phosphor blob is lit or not, not corona-softened. TIP HEIGHT/WIDTH
      // set its size in scanlines/columns.
      // A cell is a rectangle, so distance is Chebyshev (max of the two axes) rather than Euclidean, giving
      // exactly TIP HEIGHT x TIP WIDTH. Split sideways per gun and on both axes here (X from gun geometry, Y
      // from yoke unevenness, per CONVERGENCE above) -- unlike the band's vertical-only split, since the tip is
      // a compact cell that can show the error on either axis.
      for (int g = 0; g < 3; g++) {
        float k  = float(g) - 1.0;
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
  // The beam isn't the same color as what it writes: uHalo is the excited phosphor's own color, while the sweep
  // is the raw excitation arriving. SWEEP TINT runs 0 (coating's color) to 1 (bare excitation); the tip runs
  // whiter still, being the instant of maximum current.
  vec3 beamCol = mix(uHalo, vec3(1.0), clamp(uSweepWhite, 0.0, 1.0));
  // Spread terms take uHalo straight (no SWEEP TINT influence), so a white halo can't appear regardless of phosphor color.
  emis += beamCol * sweepCore   * uSweepOn * 0.06;
  emis += uHalo   * sweepSpread * uSweepOn * 0.06;
  // Only the core is the beam: a real spot is about a pixel, so body/halo both belong to the phosphor and only
  // the tight core stays hot -- otherwise a "white core, amber surround" split exists in code but not on screen.
  // The tip stays the phosphor's own color (uHalo) throughout -- hotter, not different in spectrum -- and TIP
  // GLOW carries the amount.
  emis += uHalo * (dotCoreC + dotHaloC) * uSweepOn;


  // Bloom sampled at puv (the picture's own coordinate, not screen uv) per gun -- each gun's own light spreads
  // its own glow, so a displaced gun's glyph and halo move together; three taps of an already quarter-res buffer.
  emis += vec3(texture(uBloom, puv + uConvR).r,
               texture(uBloom, puv + uConvG).g,
               texture(uBloom, puv + uConvB).b) * uBloomAmt;   // bloom, summed in linear light

  /* Phosphor glow: a wide, structureless lift (rendered at 1/16, so it can't carry structure) wherever content is
   * near, distinct from bloom's thresholded halo ON the glyphs. Scaled like uBright (nits/100) so the two are
   * directly comparable -- 3nt of glow beside 62nt of beam reads as ~5% ambient excitation. */
  emis += uHalo * glowField(puv) * uGlowAmt;

  // Halation (light scattering sideways in the faceplate, four bloom taps + a tint) is removed -- SCREEN GLOW
  // replaced it with one analytic evaluation. Missing only the warm shift; add that as a tint on the glow, not
  // a second buffer pass, if it's ever wanted.


  /* The mask sits here: after every phosphor emission term (beam, wash, sweep, bloom -- all light leaving through
   * the coating) and before every reflection term (room, sheen, glare -- light off the front surface, which must
   * not be modulated by the mask). An emission term added below this line bypasses the mask and fills the dark
   * lines back in -- a brighter, less structured face is the signature of that mistake. */
  float ny = suv.y * uScanN;
  float fy = max(fwidth(ny), 1e-6);
  float dyPx = abs(fract(ny) - 0.5) / fy;                      // distance to the nearest line center, in px
  float covH = 1.0 - smoothstep(uScanW*0.5 - 0.5, uScanW*0.5 + 0.5, dyPx);
  emis *= 1.0 - uScanA * covH;                                                            // the SCANLINES cross the whole face

  float nx = suv.x * uGrilleN;
  float fx = max(fwidth(nx), 1e-6);
  float dxPx = abs(fract(nx) - 0.5) / fx;
  float covV = 1.0 - smoothstep(uGrilleW*0.5 - 0.5, uGrilleW*0.5 + 0.5, dxPx);
  emis *= mix(vec3(1.0), uGrilleInk, uGrilleA * covV);              // so does the grille

  // From here on: light arriving at the front surface, not leaving the phosphor -- it adds, weighted by Fresnel
  // (glass reflects harder at grazing incidence, hence the room shows hardest at the edges and corners).
  /* Schlick reflectance, with both angle terms: a ramp on screen radius alone has no face-profile term (would be
   * bit-identical at FACE 0 and OUT 90 -- a rim light wearing a physics name). The normal comes from the sag
   * profile's own derivative (d/dr of uSagA*r^uSagP), zero when FACE is flat; the eye ray diverges from a
   * viewpoint EYE half-heights out, adding its own tilt near the rim. Head-on still returns 0.04. */
  const float EYE = 2.4;                                        // viewing distance, in glass half-heights
  float slopeF = uSagA * uSagP * pow(max(ap, 1e-3), max(uSagP - 1.0, 0.0));
  vec2  radial = length(c) > 1e-5 ? normalize(c) : vec2(0.0);
  vec3  nrmF   = normalize(vec3(-slopeF * radial, 1.0));        // the face's own normal, tilting with FACE
  vec3  eyeD   = normalize(vec3(-c, EYE));                      // eye ray at this pixel, diverging toward the rim
  float cosI   = clamp(dot(nrmF, eyeD), 0.0, 1.0);
  float fres   = 0.04 + 0.96 * pow(1.0 - cosI, 5.0);            // Schlick, R0 = 0.04 for n = 1.5

  // The fixture reflected in the face: two tubes in a recess, tilted back, projected through the same warp as
  // the picture so it can't drift from it.
  // The fixture is placed as a virtual image behind a flat mirror (the glass), traced as a ray with no reflection
  // math -- parallax comes free. Built in isotropic screen units (x rescaled by aspect); a direction measured in
  // per-axis-normalized coordinates isn't a direction.
  // Both axes are comparable once aspect is folded in: q.x*uAspect and q.y are the same unit on each axis.
  /* The reflection is bowed by the picture's own warp factor k = faceK(ap*bs)*bs -- the same value the raster is
   * gathered with -- rather than a true mirror reflection (physically honest, but the sag tilts the normal tens
   * of degrees near the rim and would swing the fitting away from where the picture, grid and rings actually
   * sit).
   * No separate control: it's built from the same TUBE controls (FACE, CURVE AREA, FALLOFF, DEPTH) already do. */
  vec2 cFix = c * k;
  vec2 sp2  = vec2(cFix.x - uFixX, cFix.y - uFixY);
  vec3 ro  = vec3(0.0, 0.0, 0.0);
  // Fixed field of view, the fixture moves (not the reverse) -- the eye's cone is a constant, the fitting has a
  // position, so apparent size goes as 1/L for free along with correct foreshortening (far = small and flat,
  // near = large and raked).
  vec3 rd = normalize(vec3(sp2, -uFixLens));

  // Tilt the whole assembly about X, which is what --ftilt does to the real one.
  float ct = cos(uFixTilt), st = sin(uFixTilt);
  mat3 rot = mat3(1.0, 0.0, 0.0, 0.0, ct, -st, 0.0, st, ct);
  vec3 rol = rot * (ro - vec3(0.0, 0.0, -max(uFixDist, 0.05) * uFixLens));
  vec3 rdl = rot * rd;

  float halfLen = uFixW * uAspect;
  float tubeR   = uFixH;
  // A FROSTED SLEEVE MAKES THE SOURCE BIGGER, which is the whole reason it softens the shadows it casts.
  // MATTE widens the source too (on top of FROST): a matte face scatters the lamp's IMAGE, the same integral
  // seen from the other end, so inflating the source is a cheap equivalent to blurring the reflected image.
  float tubeRlit = tubeR * (1.0 + uFrost * 1.8);
  /* Lamp axis derives from the aperture's HEIGHT only because the box depth is also derived from it -- with a
   * real depth in mm the pairing breaks (a 600mm aperture would put lamps 380mm back in a 90mm-deep box, behind
   * and occluded by the rear wall). Nothing in the fixture may derive a depth from aperture height again. */
  float tubeZ = -uRecess * 0.6;
  vec3  boxHi   = vec3(uOpenW * uAspect, uOpenH, 0.0);
  // The housing's depth is fixed, not 2.6x the aperture's height -- a depth that moved with the opening would
  // change the fixture's shape whenever the face changes.
  vec3  boxLo   = vec3(-uOpenW * uAspect, -uOpenH, -max(uRecess, 1e-3));

  // The mains ripple (100Hz on 50Hz, see uRipple above): a good tube's normal shimmer, not a fault like
  // HEALTH/FLICKER -- applied to both bulbs together since they share a supply.
  /* The phase arrives already wrapped (0..1), and must: cos(uTime*628.318) written the obvious way fails once
   * uTime's float32 (~7 digits) can no longer represent small phase steps, and the ripple freezes. JS doubles
   * wrap it exactly on the CPU first. */
  float ripple = 1.0 - uRipple * 0.5 * (0.5 - 0.5 * cos(uMainsPh * 6.2831853));
  float flkA = uFlkA * ripple, flkB = uFlkB * ripple;

  // The fixture arrives prefiltered; MATTE picks which mip to read (sharp at 0), so cost is constant rather than
  // proportional to blur. Roughness squared, since perceived roughness isn't linear in filter width.
  float tOpen  = rdl.z != 0.0 ? -rol.z / rdl.z : -1.0;
  vec3  atOpen = rol + rdl * tOpen;
  bool  facing = tOpen > 0.0;
  float lod    = uMatte * uMatte * uFixLods;
  /* CURVE is applied by reading the pre-traced (flat) fixture buffer at the warped coordinate cFix, rather than
   * re-tracing -- exactly v at CURVE 0. The warp can reach past the buffer's edge, where clamping would smear the
   * edge texel across the glass, so it fades out (vfade) instead. */
  vec2  vb     = vec2(cFix.x / uAspect, cFix.y) * 0.5 + 0.5;
  vec2  vfade  = smoothstep(vec2(0.0), vec2(0.015), vb) * (1.0 - smoothstep(vec2(0.985), vec2(1.0), vb));
  vec4  fixS   = textureLod(uFix, clamp(vb, 0.0, 1.0), lod) * (vfade.x * vfade.y);
  /* No coverage division here (tried: it renormalizes partial-coverage silhouette pixels to full strength, giving
   * a razor edge with blocky notches at the alpha floor). The reflection's apparent vanishing at high MATTE has a
   * simpler cause -- the mip chain runs to a 1x1 top level -- so capping uFixLods fixes it without touching
   * edges. */
  vec3  room   = fixS.rgb;

  vec2  outAp  = abs(atOpen.xy) - vec2(boxHi.x, boxHi.y);
  float dOut   = facing ? length(max(outAp, vec2(0.0))) : 1e3;
  /* The scatter is a halo AROUND the fitting, not a wash across the inside of it -- adding it inside the aperture
   * would double-count photons already rendered there and bury effects like a burned-out lamp section or BOX's
   * fade. Fades out across the aperture edge instead of stopping hard, to avoid drawing a silhouette. */
  float dIn    = facing ? -max(max(outAp.x, outAp.y), -1e3) : 0.0;
  float inFade = 1.0 - exp(-max(dIn, 0.0) / max(uSheenR * 0.65, 1e-4));
  float scatter = exp(-dOut / max(uSheenR, 1e-3)) * (1.0 - inFade);
  // WEIGHTED BY EACH LAMP'S OWN OUTPUT, so the halo takes the color of whichever tube is actually lit.
  vec3  lampAvg = (uLampA * flkA * uHealthA + uLampB * flkB * uHealthB) * 0.5;


  room += lampAvg * scatter * uSheen * 0.5 * uFixture;
// MATTE adds no wash here: an additive glow widened by roughness would amplify light with the screen, which a
// rough surface can't do. SHEEN owns the spread/halo; MATTE only sharpens/blurs where the reflection forms.

  // No painted rails: a highlight stamped in screen space that doesn't move with the lamp is drawn-on, not lit.
  // The recess has real walls; tubeLight() already answers where its lip catches the tubes.

  // No painted spill either: tubeLight() already ray-traces the lamps lighting the box, so a painted blob on top
  // would model the same light twice.

  /* GLARE is the reflectance itself (0 = no reflection, 1 = full mirror), with fres supplying only the ANGLE
   * dependence, normalized to 1 head-on so GLARE's number means what it says in the middle of the picture -- the
   * physical value of glass is 4%, so GLARE at 4% is a real anti-glare face. One number governs every reflection. */
  /* uFlicker (the phosphor's output this frame) is applied here, before the room is added -- applying it at the
   * very end would zero the reflection too when POWER is off, but a switched-off CRT is a dark mirror, not a
   * black hole, and the fitting overhead should stay the most visible thing in it. */
  // The power collapse (pwrCov) is applied here too, to emis as a whole: the wash has no suv coordinate to
  // squeeze on its own, but it's still phosphor emission and must collapse with everything else.
  emis *= uFlicker * pwrCov;

  /* GLARE mixes in display space, not linear light: as a linear control it's a bad one -- the fitting is driven
   * well above 1 so it sits on the tone map's flat part, where cutting the light a hundredfold moves the pixel by
   * under four. Mixing the tone-mapped, gamma'd result instead makes "half" mean half as visible, exactly, with
   * a no-op at 0 and 1. fres still supplies the angle dependence, normalized to 1 head-on. */
  float reflA = clamp(fres / 0.04, 0.0, 1.0);
  vec3  emisBare = emis;                 // the tube with nothing of the room reflected in it
  emis += room * uFixture * reflA;

  // SHEEN and GLARE are both the room's light, so both scale with uFixture -- an independent constant would
  // keep shining even with the room turned down. SHEEN is the room raking across the face (directional streak);
  // GLARE is the same light arriving from everywhere (the veil that lifts blacks). MATTE spreads both.
  // No flat GLARE term added on top: a colorless, positionless lift reflects nothing real and would only wash
  // out the ray-traced reflection above.

  // EDGE GATHER (a corner-weighted bright band near the rim, uGather) is removed: measured as painting the glass
  // brighter than the reference ever does. The uniform is gone too rather than left switched off.

  // Vignette applied after the glass layers, to both emis and emisBare -- otherwise GLARE's mix would blend in a
  // brightness difference as well as the fitting.
  float vigF = mix(1.0 - uVig, 1.0, smoothstep(1.0, 1.0 - max(uVigFall, 1e-3), ap));
  emis *= vigF; emisBare *= vigF;

  vec3 col = emis / (1.0 + emis);                                 // tone map once, at the end
  col = pow(max(col, 0.0), vec3(1.0/2.2));

  // GLARE's transparency mix happens here (see emisBare above): both sides get the same tone map and gamma
  // first, so the mix is a plain opacity between two finished pictures. Skipped entirely near 0/1 via the branch.
  if (uGlare < 0.999) {
    vec3 colBare = emisBare / (1.0 + emisBare);
    colBare = pow(max(colBare, 0.0), vec3(1.0/2.2));
    col = mix(colBare, col, clamp(uGlare, 0.0, 1.0));
  }

  /* The elevation overlay reads the SURFACE's sag directly (closed form), not faceK: the obvious shortcut
   * ap*(faceK(ap)-1) is the PICTURE's displacement, which is negative everywhere and zero at the rim regardless
   * of bend direction -- it would report a dished and a domed face identically. */
  if (uHeat > 0.5) {
    float uB = clamp((ap - uSagU0) / max(1e-4, 1.0 - uSagU0), 0.0, 1.0);
    float elev = uSagA * pow(uB, uSagP);
    // Plain gradient, no contour lines: contours require eyeballing ring spacing for steepness, which a gradient
    // shows directly. Signed -- teal dished, near-black flat, amber bulging -- since FACE runs both ways.
    float e = clamp(elev * 3.0, -1.0, 1.0);
    vec3 cool = vec3(0.10, 0.62, 0.75), flatc = vec3(0.05, 0.05, 0.06), warm = vec3(1.0, 0.42, 0.10);
    vec3 hc = e < 0.0 ? mix(flatc, cool, -e) : mix(flatc, warm, e);
    col = mix(col, hc, 0.55);
  }

  /* Dither goes here, in OUTPUT space, at half an 8-bit step -- sized against the quantization it hides, which is
   * in the 8-bit output, not the linear signal. Added earlier in linear light at fixed amplitude it was a large
   * fraction of the signal on empty glass (the large diagonal bands the faceplate used to show, not aliasing).
   * +/-0.5 of one 1/255 step is the largest dither that can't flicker and the smallest that still breaks banding.
   * Temporal (hash includes uTime) so it doesn't read as fixed-pattern grain on a surface meant to be smooth. */
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0;

  // Alpha carries the beam, linear and untonemapped, for next frame's persistence -- the color channels are
  // gamma-encoded for display and would be wrong to feed back.
  // The molding composites over the picture (not replacing it), nonzero only in the one-pixel band at the rim.
  if (moldCov > 0.0) col = mix(col, moldCol, moldCov);
  /* uFixSolo shows the fixture model itself, at full strength with nothing composited over it -- at 4%
     reflectance
   * behind text, a millimeter of cap or a prism flute is invisible and can't be judged. Same geometry, just
   * skipping the compositing. */
  if (uFixSolo > 0.5) {
    // Gain 2.2, not higher: past about a sixth of full scale, x/(1+x) flattens everything toward white and
    // different materials (glass at 0.9, a metal cap at 0.25) become indistinguishable.
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
  // Separable, quarter resolution, thresholded: thirteen taps here vs a full-res blur is ~30x less work, and
  // since the input is linear and unclamped there's real signal above white to bloom from.
  vec3 s = vec3(0.0); float wsum = 0.0;
  for (int i = -6; i <= 6; i++){
    float w = exp(-float(i*i) / 18.0);
    vec3 t = texture(uTex, v + uDir * float(i)).rgb;
    s += max(t - uThresh, 0.0) * w; wsum += w;
  }
  o = vec4(s / wsum * uTint, 1.0);
}`;

/* COPY_FRAG exists so the present pass is one tap: reusing the blur program as an identity (uDir=0, uThresh=0,
 * uTint=1) would cost thirteen full-resolution fetches for the same result. */
const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D uTex;
void main(){ o = vec4(texture(uTex, v).rgb, 1.0); }`;

// Compiles a shader, throwing the GL info log if it fails.
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
// Links a program from the shared VERT and the given fragment shader, throwing the info log if it fails.
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
// Creates an RGBA16F render target (texture + framebuffer), optionally with a mip chain for MATTE's textureLod.
function target(gl, w, h, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  // Mips only where wanted: building the chain costs bandwidth, so buffers that never sample below level 0 skip it.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { tex: t, fbo: f, w, h };
}

// Detects which GPU is active. powerPreference:'high-performance' is measured-ignored on Windows Chrome, so a
// page can't choose its GPU, only detect it and adapt.
export function detectGPU(gl) {
  try {
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const name = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '';
    return { name, integrated: /intel|uhd|iris|radeon\s*graphics|adreno|mali|apple/i.test(name) };
  } catch (_) { return { name: '', integrated: false }; }
}

/* Builds the CRT renderer: compiles the four programs, allocates the LUT and render-target textures, and
 * returns the draw/resize/upload API the lab's host page drives every frame. */
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
  /* LUTs must be NEAREST: R32F isn't filterable without OES_texture_float_linear, and with LINEAR set texture()
   * silently returns 0 for every sample -- k collapses to 0 and the shader stretches a pinprick of content over
   * the whole tube. 512 entries on a monotone curve needs no interpolation anyway. */
  [faceTex, outlineTex].forEach((t) => {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  });

  let bloomA = null, bloomB = null, histA = null, histB = null, fixT = null, W = 0, H = 0;
  // The fixture pass's last input signature -- see the note where it is built. null forces the next trace.
  let lastFixSig = null;

  // Resizes all render targets to match the canvas; a no-op if the size hasn't changed.
  const size = (w, h) => {
    if (w === W && h === H) return;
    W = w; H = h; canvas.width = w; canvas.height = h;
    // fixT is reallocated below, so the cache key must not claim to still match its old (now-gone) contents.
    lastFixSig = null;
    [bloomA, bloomB, histA, histB, fixT].forEach((t) => {
      if (!t) return; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo);
    });
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    bloomA = target(gl, bw, bh); bloomB = target(gl, bw, bh);
    histA  = target(gl, w, h);   histB  = target(gl, w, h);
    // Full resolution with a mip chain: at MATTE 0 the fixture is a sharp box with straight edges, and halving
    // resolution would alias those into stair-steps upscaling only makes worse. MATTE picks a mip, not a
    // pre-softened base.
    fixT = target(gl, w, h, true);
  };
  // The domain travels with the table: buildFaceLUT's {u, r1, rimK} must stay together, or an uploaded table
  // with the wrong r1 silently rescales the warp.
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
  // Uploads new terminal content to the content texture, flipped to match GL's bottom-up convention.
  const uploadContent = (src) => {
    gl.bindTexture(gl.TEXTURE_2D, contentTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  };
  const U = (p, n) => gl.getUniformLocation(p, n);

  /* The fixture's cache key is accumulated from the uploads themselves (filtered on U(prog,n) being non-null),
   * not a hand-written list of uniform names -- so a uniform the fixture program doesn't declare (or the
   * compiler drops as unused) never joins the key, and a new uniform joins automatically. uTextRect is why the
   * filter matters: it's uploaded to both programs but moves every character and the fixture doesn't read it.
   *
   * Checked as `sig !== null`, not truthy `sig`: the accumulator starts as '', which is falsy, so a truthiness
   * check would silently disable recording before the first append. */
  let sig = null;
  const keep = (n, l, v) => { if (sig !== null && l !== null) { sig += n; sig += v; sig += ';'; } };

  // Uploads every shared uniform to both the fixture and main programs from one place, so the fixture pass
  // traces the same fitting the main pass believes in -- two copies would be two places to forget one. Unused
  // uniforms in either program resolve to -1 and are ignored.
  const setAll = (prog, s) => {
    // uAspect must be uploaded here, not just on the main program: an unset uniform defaults to 0, which
    // collapses boxHi.x and renders the fixture pass entirely black rather than merely dim or misplaced.
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
      // Tip geometry arrives in suv, not px: the caller divides by render height once at the boundary (as it
      // does for scanline width and frame), so the shader never needs to know the render scale itself.
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
      // Defaults to no collapse (1,1) for a caller that's never heard of the power animation -- see uPwr above.
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
    /* uFixLens: a ~30cm tube at ~60cm subtends about 28 degrees, a focal length near 4 -- at 1 a tilt wedges one
     * edge of the fitting far nearer than the other. Distance scales with it (sp2 = X/uFixDist), so an untilted
     * fitting never moves. 3.0, not the physical 4.0, so TILT still reads as visibly tilted. `window.__fixLens`
     * overrides it live for tuning. */
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
      // 1 + WIDTH when the frame is shown, so glass + molding exactly fills the box; 1 when it is not.
      // Solved on the tightest ray (the short axis, outline=1): a constant-width frame's outer edge can't land
      // on the box on every ray at once, and solving anywhere else overflows.
      f('uFrameFit', s.frameOn ? 1 / Math.max(0.35, 1 - s.frameW) : 1);
      // No uFrameTint / uFrameGlow: bezelCols already resolves TINT and the lamp lift into base/lo/hi tones
      // before they reach here, so those uniforms were dead uploads.
      const v3 = (n, a) => { const l = U(prog, n); keep(n, l, a); gl.uniform3f(l, a[0], a[1], a[2]); };
      v3('uInk',s.ink); v3('uHalo',s.halo); v3('uLamp',s.lamp); v3('uGrilleInk',s.grilleInk);
      v3('uLampA', s.lampA || s.lamp); v3('uLampB', s.lampB || s.lamp);
      v3('uBzBase',s.bzBase); v3('uBzLo',s.bzLo); v3('uBzHi',s.bzHi);
      f('uBzInner', s.bzInner); f('uBzLocal', s.bzLocal || 0);
      f('uBzPhos', s.bzPhos || 0); f('uBzLamp', s.bzLamp || 0);
  };

  /* Runs one frame: traces the fixture (cache permitting), blurs the content into the bloom buffers, composites
   * the main pass, then presents and swaps the history buffers. */
  const draw = (s) => {
    // The fixture traces first into its own target, then gets a mip chain -- one ray-cast per pixel there replaces
    // 4-16 per pixel in the main pass, and cost stops depending on MATTE since roughness just picks a mip.
    /* Skipped entirely when nothing the fixture reads has moved -- setAll still runs (it builds the key), only
     * the draw and mipmap are skipped. size() invalidates the key on resize (fixT is reallocated). Doesn't hit
     * while a lamp is guttering (uFlkA/B) or RIPPLE is nonzero (uMainsPh moves every frame); otherwise it holds
     * for most of the time the page is open. */
    // useProgram before setAll: gl.uniform* writes to the currently-bound program regardless of which program's
    // location was queried, so uploading fixp's locations while another program is bound is an INVALID_OPERATION.
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
    /* Tap spacing sets the bloom's size (hard-wired to one texel would fix the width, leaving only amount as a
     * control). The caller passes spacing already in texels of this buffer -- converting a CSS-px radius needs
     * the device ratio and render scale, neither of which belongs here. Past ~3 texels of spacing the 13 taps
     * undersample the gaussian and the tail bands; more taps is the fix if that ever shows. */
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
    /* Five levels (a 32-texel filter): measured on the fixture's own region, the mean holds while the peak falls
     * as the cap rises up to five -- past that the mean falls too, meaning light is smeared out of the fixture's
     * region rather than just losing structure within it. `window.__fixLods` overrides live for tuning. */
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
