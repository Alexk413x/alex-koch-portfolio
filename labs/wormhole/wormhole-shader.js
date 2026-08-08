/* The field as a fragment shader: a domain-warped fbm tunnel swept along a seamless angular coordinate, in three
 * flavours. Pure source, no GL calls — glquad compiles it and the host decides what the values mean.
 */
export const UNIFORMS = ['uRes', 'uTime', 'uSpeed', 'uTurb', 'uTwist', 'uChroma', 'uGlow', 'uHue', 'uMode', 'uRot'];

export const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime, uSpeed, uTurb, uTwist, uChroma, uGlow, uHue, uMode, uRot;

float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 p=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(p+vec3(0,0,0)),hash(p+vec3(1,0,0)),f.x),
                 mix(hash(p+vec3(0,1,0)),hash(p+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(p+vec3(0,0,1)),hash(p+vec3(1,0,1)),f.x),
                 mix(hash(p+vec3(0,1,1)),hash(p+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<3;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
vec3 pal(float t){ return 0.5+0.5*cos(6.28318*(vec3(1.0,0.85,0.65)*t + vec3(0.0,0.12,0.28) + uHue)); }

vec3 tunnel(vec2 uv){
  float r=length(uv)+1e-4;
  float z=uTime*uSpeed + 0.85/r;                       // fly down the throat
  float ang=atan(uv.y,uv.x) + uTwist*z*0.05 + uRot*uTime;
  vec2 dir=vec2(cos(ang),sin(ang));                    // seamless around the tube (no atan seam)

  vec3 q=vec3(dir*2.6, z*0.5);
  float density;
  if(uMode<0.5){                                       // NEBULA
    float w=fbm(q + uTurb*noise(q*0.5+uTime*0.05));
    density = w*0.85 + fbm(vec3(dir*7.0, z*4.0))*0.30;
  } else if(uMode<1.5){                                // LIGHTSPEED
    density = fbm(vec3(dir*7.0, z*4.0))*1.15 + noise(q)*0.20;
  } else {                                             // PLASMA vortex (cheapest)
    density = fbm(q*1.4 + 1.5*sin(vec3(dir*2.0,z)) + uTurb*noise(q*0.5));
  }

  float glow=uGlow*(0.16/(r+0.06));
  float throat=smoothstep(0.0,0.5,0.5-r);
  float bright=density*glow + throat*1.4;
  vec3 col=pal(z*0.12 + density*0.25)*bright;
  col += vec3(1.0,0.94,0.82)*smoothstep(0.16,0.0,r)*3.2;   // hot core
  return col;
}
void main(){
  vec2 uv=(gl_FragCoord.xy - 0.5*uRes)/uRes.y;      // the stage's own centre — see the note on uPanelPx
  vec3 col=tunnel(uv);                              // one evaluation (fast)
  float r=length(uv);
  float ca=uChroma*0.22*r;                          // cheap chromatic fringe
  col.r*=1.0+ca; col.b*=1.0-0.7*ca;
  col*=smoothstep(1.35,0.15,r);                     // vignette
  col=col/(col+0.9); col=pow(col,vec3(0.82));       // tone map
  gl_FragColor=vec4(col,1.0);
}`;
