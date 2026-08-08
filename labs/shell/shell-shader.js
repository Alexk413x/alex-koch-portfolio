/* THE SUBJECT: one stroked shape, so that every control in the panel has something visible to move.
 *
 * DELIBERATELY THE SIMPLEST SHADER THAT IS STILL A REAL ONE. This lab is a template, and a template whose subject
 * is interesting competes with the thing it is teaching. Four SDFs, a stroke, a glow, a debug overlay -- enough
 * that each control type has an obvious effect and nothing more.
 *
 * Pure source, no GL calls: [[glquad]] compiles it and the host decides what the numbers mean.
 *
 * `fwidth` NEEDS THE DERIVATIVES EXTENSION, in the shader AND on the context. WebGL1 has no derivatives by
 * default, so a shader using one compiles to nothing and createQuad returns null -- which surfaces as a page that
 * never initialises rather than as anything mentioning fwidth. The host must pass
 * `ext: ['OES_standard_derivatives']`; the directive below is the other half and has to be the FIRST line.
 */
export const UNIFORMS = [
  'uRes', 'uTime', 'uShape', 'uSize', 'uAspect', 'uRot', 'uRadius', 'uWeight',
  'uHue', 'uGlow', 'uOpacity', 'uInk', 'uDebug', 'uOutline', 'uCross',
];

export const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec2 uRes;
uniform float uTime, uShape, uSize, uAspect, uRot, uRadius, uWeight, uHue, uGlow, uOpacity;
uniform float uDebug, uOutline, uCross;
uniform vec3 uInk;

vec3 hueShift(vec3 c, float a){ const vec3 k=vec3(0.57735); float co=cos(a);
  return c*co + cross(k,c)*sin(a) + k*dot(k,c)*(1.0-co); }

// A rounded box, which is also the square (r=0) and, at r = half the shorter side, the circle/bar.
float sdRoundBox(vec2 p, vec2 b, float r){ vec2 q=abs(p)-b+r; return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r; }
// A regular octagon, as the intersection of two boxes rotated 45 degrees from each other.
float sdOctagon(vec2 p, vec2 b){
  vec2 q = abs(p);
  vec2 r = abs(vec2(q.x+q.y, q.x-q.y)) * 0.70710678;
  return max(max(q.x-b.x, q.y-b.y), max(r.x, r.y) - b.x*0.92);
}

float shapeSDF(vec2 p, vec2 half_, float r){
  if(uShape < 0.5)      return sdRoundBox(p, half_, r);              // SQUARE (rounded by CORNER)
  else if(uShape < 1.5) return sdRoundBox(p, half_, min(half_.x, half_.y));   // CIRCLE / ellipse
  else if(uShape < 2.5) return sdOctagon(p, half_);                  // OCTAGON
  return sdRoundBox(p, vec2(half_.x, half_.y*0.22), min(r, half_.y*0.22));    // BAR
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / uRes.y;   // the stage's own centre; the panel is a flex sibling
  float c = cos(uRot), s = sin(uRot);
  vec2 p = mat2(c, -s, s, c) * uv;

  vec2 half_ = vec2(uSize, uSize * uAspect);
  float d = shapeSDF(p, half_, uRadius * min(half_.x, half_.y));

  vec3 ink = hueShift(uInk, uHue);

  // THE STROKE IS THE SHAPE'S OUTLINE, so LINE is a real width in the same units as everything else: the distance
  // field's zero crossing, thickened. fwidth keeps the edge one pixel soft at any render scale.
  float w = uWeight * 0.0016;
  float aa = fwidth(d) + 1e-5;
  float stroke = 1.0 - smoothstep(w - aa, w + aa, abs(d));

  // Computed from the same distance field as the stroke, so the glow follows the silhouette rather than a box.
  float glow = uGlow > 0.0001 ? exp(-abs(d) / (uGlow * 0.0016 + 1e-5)) * 0.55 : 0.0;

  vec3 col = vec3(0.012, 0.014, 0.016);
  col += ink * glow;
  col = mix(col, ink, stroke);
  col *= uOpacity;

  // THE DEBUG OVERLAY, gated on the section master. A dashed bounding box and a centre cross -- the two things you
  // want when a control is not doing what you expected.
  if(uDebug > 0.5){
    vec2 b = half_ + 0.028;
    vec2 q = abs(p) - b;
    float box = max(q.x, q.y);
    float dash = step(0.5, fract((abs(p.x) + abs(p.y)) * 42.0));
    float onBox = (1.0 - smoothstep(0.0, 0.004, abs(box))) * dash * uOutline;
    col = mix(col, vec3(0.5, 0.82, 1.0), onBox * 0.85);
    float cross = (1.0 - smoothstep(0.0, 0.0022, abs(uv.y))) + (1.0 - smoothstep(0.0, 0.0022, abs(uv.x)));
    col = mix(col, vec3(1.0, 0.24, 0.24), clamp(cross, 0.0, 1.0) * 0.6 * uCross);
  }

  col = col / (col + 0.85);
  gl_FragColor = vec4(pow(col, vec3(0.85)), 1.0);
}`;
