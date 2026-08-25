/* The containment core as a fragment shader: a sphere-traced SDF scene — the core and its goo droplets, nine
 * alloy ring fragments, and the continuous inner shield band — marched in one loop between a bounding sphere's
 * entry and exit. Pure source, no GL calls.
 *
 * Rotations arrive as a PHASE (uPhSpin), not a rate: reactor-sim integrates them, so changing a speed does not
 * teleport whatever it was driving.
 *
 * The ring has three: a SPIN about its own axis, and two TUMBLES about world X and world Z. See ringSpace for why
 * the spin has to be composed innermost.
 *
 * THE WHOLE OF FRAG IS ONE TEMPLATE LITERAL, so no backtick and no ${ may appear below — including inside a GLSL
 * comment. Either one ends the string, and the failure surfaces as a JavaScript parse error naming a token from
 * the middle of a shader.
 */
export const UNIFORMS = [
  'uAmp', 'uBreakBurst', 'uCamAngle', 'uCamEl', 'uCoreCol', 'uDropData', 'uDropN', 'uRingM', 'uCoreM',
  'uGlow', 'uOct', 'uPhCam', 'uPhRate',
  'uPulse', 'uPulseBright', 'uPulseSize', 'uRate', 'uRes', 'uRingGlow',
  'uRingLight', 'uRingOn', 'uRingR', 'uRingRough', 'uRingWear',
  
  'uScatter', 'uShape', 'uShieldExpand', 'uSize', 'uSubSurf', 'uSwellAmt',
  'uSwellRingBase', 'uSwellTarget', 'uTime', 'uTurb', 'uVent', 'uVentBright', 'uVentBurst', 'uVentSize',
  'uVentSwell', 'uVisc', 'uZoom'
];

export const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes; uniform float uTime,uSize,uVisc,uTurb,uRate,uGlow,uZoom,uPulse,uVent,uVentBurst,uRingR,uRingLight,uRingGlow,uRingOn,uOct,uCamAngle,uCamEl,uAmp,uPulseBright,uVentSize,uVentBright,uShape,uPulseSize,uDropN,uPhCam,uPhRate;

uniform vec4 uDropData[20];   // per-droplet center.xyz + radius.w, precomputed on CPU each frame
uniform mat3 uRingM;          // world -> ring space, composed on CPU each frame (see ringSpace)
uniform mat3 uCoreM;          // world -> core space, composed on CPU each frame (see coreSDF)
uniform vec3 uCoreCol;        // CORE COLOR picker — the scene's only light, and every surface is read through it
uniform float uVentSwell;    // VENT SWELL envelope: 0..1 animation ramp
uniform float uSwellAmt;     // VENT SWELL target: signed fraction (+1 = ring, +2 = past, -1 = shrink to 0)
uniform float uSwellRingBase; // original ring radius used as the SWELL target (so the ring can expand separately)
uniform float uSubSurf;      // SUB-CORE SURFACE: how much of the core's displaced surface the droplets carry.
                             // 0 renders them as smooth spheres, which reads as round objects leaving a lumpy one
uniform float uSwellTarget;  // the (break-expanded) ring radius the SWELL reaches toward
uniform float uScatter;      // break-scatter distance: flings each of the 9 pieces off in a random direction with a random tumble
uniform float uShieldExpand; // shield ring balloons outward as it dies during a break
uniform float uBreakBurst;    // seconds since a break began (>=1.3 = inactive) - drives the shockwave flashes
uniform float uRingRough;    // RING ROUGHNESS: 0 = mirror alloy, 1 = satin. Widens the specular lobe.
uniform float uRingWear;     // RING WEAR: bare metal on the machined lips, grime pooled in the recessed bays
float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 p=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(p+vec3(0,0,0)),hash(p+vec3(1,0,0)),f.x),
                 mix(hash(p+vec3(0,1,0)),hash(p+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(p+vec3(0,0,1)),hash(p+vec3(1,0,1)),f.x),
                 mix(hash(p+vec3(0,1,1)),hash(p+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<6;i++){ if(i>=int(uOct)) break; v+=a*noise(p); p=p*2.02+vec3(1.7); a*=0.5; } return v; }
float fbm3(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.03+vec3(1.7); a*=0.5; } return v; }  // fixed 4-octave (for the ring's land/water map — independent of DETAIL)
mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
vec3 ringSpace(vec3 p);   // forward declaration
float caust(vec2 p){                 // cheap sunlight-through-water caustic
  float t=uTime*0.5; vec2 q=p; float v=0.0;
  for(int i=0;i<3;i++){
    q += vec2(sin(t + q.y*1.7), cos(t + q.x*1.7))*0.6;
    v += 1.0/(0.35+abs(sin(q.x)*sin(q.y)));
  }
  return pow(v*0.12,1.8);
}

float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0); }
float sdOcta(vec3 p, float s){ p=abs(p); return (p.x+p.y+p.z-s)*0.57735; }
float sdDisk(vec3 p, float r, float h){ vec2 d=vec2(length(p.xz)-r, abs(p.y)-h); return min(max(d.x,d.y),0.0)+length(max(d,0.0)); }
float smin(float a, float b, float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }  // goo blend (bridges + pinch-off)
float sdFacetBall(vec3 p, float R){                // dodecahedron — clean low-poly ball (12 faces)
  vec3 a=abs(p); float ph=1.618, s=0.5257;
  float d=max(dot(a,vec3(0.0,s,ph*s)), max(dot(a,vec3(s,ph*s,0.0)), dot(a,vec3(ph*s,0.0,s))));
  return d - R;
}
float shapeSDF(vec3 q, float r){                    // the currently-selected core shape at radius r
  if(uShape<0.5) return length(q)-r;                       // sphere
  else if(uShape<1.5) return sdFacetBall(q, r*0.82);      // faceted ball
  else if(uShape<2.5) return sdBox(q, vec3(r*0.66));       // cube
  else if(uShape<3.5) return sdOcta(q, r*1.05);           // octahedron
  return sdDisk(q, r, r*0.0875);                           // disk
}
float coreRadius(){
  float breathe = uAmp*(0.5-0.5*cos(uPhRate));       // pulse swells outward from the base, never below it
  float base = uSize + breathe + uPulse*uPulseSize;
  float delta = uSwellAmt>=0.0 ? uSwellAmt*(max(uSwellTarget,base)-base) : uSwellAmt*base;   // +: toward/past the ring (follows the break-expanded radius); -: toward 0m
  return max(base + clamp(uVentSwell,0.0,1.0)*delta, 0.0);   // VENT SWELL animates the core size during a vent
}
float coreSDF(vec3 p){
  /* One CPU-composed matrix, for the same reason as uRingM. Both angles come from uniforms, so the two
     rotations resolve to the same matrix for every pixel. This is called once per march step and four more
     times by the normal estimator, so a 70-step ray built it 74 times to get one answer. */
  p = uCoreM * p;
  float t=uTime*(0.35+uRate*0.12);
  vec3 q=p*uVisc + vec3(0.0,t,0.0);
  float n=fbm(q + fbm(q*0.5+t*0.3)*1.2);
  float disp=(n-0.5)*uTurb*(1.0+uPulse*0.3);         // gentle pulse influence on the base surface
  float R=coreRadius();
  float base=shapeSDF(p, R);
  float d = base - disp;
  // --- goo droplets: on a PULSE, blobs stretch out of the surface, pinch into their own orbs, then merge back as it decays ---
  float pd = clamp(uPulse, 0.0, 2.5);
  if(pd > 0.002){
    for(int i=0;i<20;i++){
      if(i>=int(uDropN)) break;
      vec4 D=uDropData[i];                              // center.xyz, radius.w (CPU-precomputed — no per-step hashing/trig)
      float db=shapeSDF(p - D.xyz, D.w) - disp*0.7*uSubSurf;  // droplets share the core's turbulent surface (SUB-CORE SURFACE scales it)
      d=smin(d, db, 0.16*R);                           // stretching goo bridge that thins & pinches off
    }
  }
  return d;
}
float boxTorus(vec3 p,float R,vec2 he,float rad){
  vec2 q=vec2(length(p.xz)-R, p.y);
  vec2 d=abs(q)-he;
  return length(max(d,0.0))+min(max(d.x,d.y),0.0)-rad;
}
/* THE THREE AXES, AND THE SPIN IS INNERMOST. Composed the other way round it is not a spin at all: a rotation
 * about world Y swings a TILTED ring's axis around a cone, so SPIN would silently do a second job — precession —
 * whenever anything else had tipped the ring, and the two controls would stop being independent. Innermost, it
 * turns the band inside its own plane and moves nothing but the surface pattern.
 *
 * The two tumbles are about world X and world Z. Between them the ring's axis reaches
 * (-sin g cos b, cos g cos b, sin b), which is the whole sphere — the ring can present any face to the core. */
/* ONE MATRIX, BUILT ON THE CPU. Every angle in this transform comes from a uniform, so the three rotations
   resolve to the same mat3 for every pixel and every march step. Composing them in the shader cost eight
   transcendentals and three matrix multiplies PER CALL, and ringSDF and shieldSDF each call it once inside the
   march loop -- so a 70-step ray paid for it 140 times to get an answer that never changed.
   reactor-uniforms.js builds uRingM. Same treatment, and the same reason, as uDropData. */
vec3 ringSpace(vec3 p){ return uRingM * p; }

// Inverse of ringSpace. A composition of rotations is orthonormal, so the transpose IS the inverse.
vec3 ringToWorld(vec3 q){ return transpose(uRingM) * q; }
float ringSDF(vec3 p){
  if(uRingOn<0.5) return 1e5;
  vec3 pr=ringSpace(p);
  float seg=6.28318/9.0;
  float segLen=uSwellRingBase*seg*1.02;
  float harc=min(seg*0.5, (segLen*0.5)/max(uRingR,0.001));
  float scat=uScatter;
  if(scat<0.001){
    float ang=atan(pr.z,pr.x);                          // fast path: intact ring with gaps
    float k=floor((ang+3.14159)/seg);
    float center=-3.14159+(k+0.5)*seg;
    float d=boxTorus(pr,uRingR,vec2(0.009,0.05),0.006);
    float gap=abs(ang-center)-harc;
    return d + max(0.0,gap)*uRingR*2.0;
  }
  float best=1e5;
  for(int k=0;k<9;k++){
    float center=-3.14159+(float(k)+0.5)*seg;
    vec3 pc=vec3(cos(center)*uRingR,0.0,sin(center)*uRingR);   // piece center
    vec3 h=vec3(hash(vec3(float(k)*3.1,1.0,0.0)),hash(vec3(float(k)*3.1,2.0,0.0)),hash(vec3(float(k)*3.1,3.0,0.0)));
    vec3 rdir=normalize(vec3(cos(center),0.0,sin(center))*1.2 + (h-0.5)*2.0);   // random outward direction per piece
    vec3 T=rdir*scat;
    float a=scat*(1.5+h.x*4.0);                         // random tumble per piece
    vec3 q=pr-pc-T;
    q=rotY(-a)*q;                                       // single-axis tumble (cheaper)
    q+=pc;
    float ang=atan(q.z,q.x);
    float dd=boxTorus(q,uRingR,vec2(0.009,0.05),0.006);
    float gp=abs(ang-center); gp=min(gp,6.28318-gp)-harc;
    best=min(best, dd + max(0.0,gp)*uRingR*2.0);
  }
  return best;
}
float shieldSDF(vec3 p){                                // FULL continuous inner shield ring (the land/topo band) — never segmented
  if(uRingOn<0.5 || uRingGlow<0.01) return 1e5;         // fully gone (no occluding outline) when the shield is off/broken
  vec3 pr=ringSpace(p);
  return boxTorus(pr, uRingR+uShieldExpand, vec2(0.007,0.044), 0.005);   // nested just inside the alloy fragments; balloons out on a break
}
vec3 nrmC(vec3 p){ vec2 k=vec2(1.0,-1.0)*0.0013;   // core-only normal (skips ring SDF)
  return normalize(k.xyy*coreSDF(p+k.xyy) + k.yyx*coreSDF(p+k.yyx) + k.yxy*coreSDF(p+k.yxy) + k.xxx*coreSDF(p+k.xxx)); }
vec3 nrmR(vec3 p){ vec2 k=vec2(1.0,-1.0)*0.0013;   // ring-only normal (skips core SDF + metaballs)
  return normalize(k.xyy*ringSDF(p+k.xyy) + k.yyx*ringSDF(p+k.yyx) + k.yxy*ringSDF(p+k.yxy) + k.xxx*ringSDF(p+k.xxx)); }
vec3 nrmSh(vec3 p){ vec2 k=vec2(1.0,-1.0)*0.0013;   // shield-ring normal
  return normalize(k.xyy*shieldSDF(p+k.xyy) + k.yyx*shieldSDF(p+k.yyx) + k.yxy*shieldSDF(p+k.yxy) + k.xxx*shieldSDF(p+k.xxx)); }

// The ring's machined dimensions, in meters: the band is 112mm tall and 18mm thick, so relief stays under 2mm.
const float RIB_W=0.014, RAIL_Y=0.0425, CHAM=0.014, BAY_D=0.0017;
const float BOSS_R=0.032, BOSS_H=0.0009, LENS_R=0.0075, TRACE_D=0.0007;
/* TWO conductors per bay, one at each end, as FRACTIONS of the bay rather than a metric period — so it stays two
 * however large the ring grows, instead of the count rising with the circumference. */
const float DASH_POS=0.34, DASH_LEN=0.09;
/* 1/sin^2 of the core's angular radius at the shipped SIZE and RING SIZE. The falloff below is physical, which
 * means every stored setting would otherwise arrive at a different brightness than it was calibrated against. */
const float LIGHT_NORM=4.84;

/* A feature's coverage from its distance field, never allowed below one pixel wide. A fixed smoothstep cannot do
 * this: once a line is finer than a pixel it aliases into sparkle instead of fading out. The W forms take the
 * pixel footprint instead of measuring it, for coordinates whose own derivative is not trustworthy. */
float coverW(float d, float halfW, float w){ return clamp((halfW-abs(d))/max(w,1e-6)+0.5, 0.0, 1.0); }
float cover(float d, float halfW){ return coverW(d, halfW, fwidth(d)); }
/* One period of a repeating dash, likewise pixel-bounded. The footprint must come from an UNWRAPPED coordinate
 * because fract's derivative spikes at every wrap, which draws a bright seam once per period. */
float dashesW(float x, float duty, float w){ return clamp((duty*0.5-abs(fract(x)-0.5))/max(w,1e-6)+0.5, 0.0, 1.0); }
float dashes(float x, float duty){ return dashesW(x, duty, fwidth(x)); }

/* Diffuse irradiance from the core treated as a uniform sphere rather than a point. sinA is its angular radius
 * seen from the surface, which both softens the terminator by the light's real size and supplies the inverse-square
 * falloff — so CORE SIZE and RING SIZE now change how lit the ring is. */
float sphereDiff(vec3 n, vec3 L, float sinA){
  return sinA*sinA*clamp((dot(n,L)+sinA)/(1.0+sinA), 0.0, 1.0);
}
/* The direction to the point on the core a reflection ray actually strikes. The core is most of a meter wide seen
 * from the ring, so its highlight has to have a size; a point light gives metal a dot. */
vec3 sphereSpecL(vec3 Lv, vec3 Rr, float Rc){
  vec3 c=Rr*max(dot(Lv,Rr),0.0)-Lv;
  return normalize(Lv+c*clamp(Rc/max(length(c),1e-5), 0.0, 1.0));
}
/* Tilts a normal by a height field's true world-space gradient: the hit point's screen derivatives convert
 * dH/dpixel into dH/dmeter. Perturbing the normal's x and y components with screen derivatives directly tilts it
 * in a direction unrelated to the surface, which shades but never reads as relief. */
vec3 bumpN(vec3 p, vec3 n, float H){
  vec3 dpx=dFdx(p), dpy=dFdy(p);
  vec3 r1=cross(dpy,n), r2=cross(n,dpx);
  float det=dot(dpx,r1);
  vec3 g=sign(det)*(dFdx(H)*r1+dFdy(H)*r2);
  return normalize(abs(det)*n-g);
}

struct Surf { float h; float bay; float rim; float trace; float lens; float dash; float halo; };
/* The ring's machined relief: height in meters, and every mask its albedo, its shading and its lamps read off.
 * One function because the bump, the cavity darkening and the paint must describe the SAME surface.
 *
 * bx is meters along the arc from the nearest bay's center, y meters up the band, bayL one bay's arc length, aw
 * the arc footprint of one pixel. The bay centers are aligned to the SDF's nine fragment centers, so a boss sits
 * on a fragment and never on a joint. */
Surf ringRelief(float bx, float y, float bayL, float aw){
  Surf s;
  float dBay=abs(y)-RAIL_Y;                                  // one channel running the whole band: bounded by the rails, open at both ends
  s.bay=smoothstep(0.0,0.0016,-dBay);
  s.rim=cover(dBay,0.0030);                                  // the machined lip, where wear and grazing light land
  s.h=-BAY_D*s.bay;

  float rN=length(vec2(bx,y));
  float boss=smoothstep(0.0,0.0018,BOSS_R-rN)*s.bay;         // raised instrument boss at each bay's center
  s.h+=BOSS_H*boss;
  s.lens=smoothstep(LENS_R,LENS_R*0.5,rN)*s.bay;
  s.halo=smoothstep(BOSS_R*1.7,0.0,rN)*s.bay;

  // Drawn as two separate spans rather than one mirrored distance: abs(abs(bx)-c) kinks at the dash center, and
  // fwidth reads that fold as an edge.
  float dHalf=DASH_LEN*bayL*0.5, dAt=DASH_POS*bayL;
  s.dash=max(coverW(bx-dAt,dHalf,aw), coverW(bx+dAt,dHalf,aw))*cover(y,0.0018)*s.bay;
  float nx=clamp(bx/max(bayL*0.5-RIB_W-CHAM,1e-4),-1.0,1.0);
  float ny=clamp(y/(RAIL_Y-CHAM*0.5),-1.0,1.0);
  float xr=max(abs(nx),abs(ny));
  float xm=cover(abs(nx)-abs(ny),0.075)*step(0.45,xr)*step(xr,0.86)*s.bay;   // the broken X, stopping short of the middle
  float ring=cover(rN-BOSS_R*0.78,0.0016)*boss;              // groove circling the boss
  // The dash is a lit conductor, not an etched groove: cut to the same depth, but kept out of the trace mask that
  // darkens a cavity. A powered line does not sit in its own shadow.
  s.trace=max(ring,xm);
  s.h-=TRACE_D*max(s.trace,s.dash);
  return s;
}

vec3 shieldMaterial(vec3 hp, vec3 rd, vec3 cc){        // the full inner shield ring: land/water topo + shield film
  vec3 n=nrmSh(hp);
  vec3 pr=ringSpace(hp);
  float ang=atan(pr.z,pr.x), pat=ang;
  float dif=max(dot(n,normalize(-hp)),0.0);
  float fres=pow(1.0-max(dot(n,-rd),0.0),3.0);
  float cw=clamp(caust(vec2(cos(pat)*uRingR*3.0, sin(pat)*uRingR*3.0 + pr.y*30.0)),0.0,2.0);   // seamless cylindrical caustic (no wrap seam)
  vec3 lp=vec3(cos(pat)*uRingR*3.5, pr.y*10.0, sin(pat)*uRingR*3.5);
  float e=fbm3(lp + fbm3(lp*0.5)*1.7);
  e=clamp((e-0.25)/0.5,0.0,1.0);
  float coast=smoothstep(0.28,0.34,e);
  float mott=fbm3(lp*2.4+8.0);
  vec3 waterC=vec3(0.03,0.12,0.17)+cw*vec3(0.03,0.09,0.11);
  vec3 grassC=mix(vec3(0.08,0.13,0.05),vec3(0.19,0.24,0.10),mott);
  vec3 rockC=mix(vec3(0.17,0.15,0.13),vec3(0.26,0.24,0.21),mott);
  vec3 topo=waterC;
  topo=mix(topo,vec3(0.44,0.38,0.24),smoothstep(0.30,0.35,e));
  topo=mix(topo,grassC,smoothstep(0.37,0.44,e));
  topo=mix(topo,rockC,smoothstep(0.60,0.68,e));
  topo=mix(topo,vec3(0.86,0.89,0.94),smoothstep(0.78,0.88,e+mott*0.06));
  float bands=abs(fract(e*9.0)-0.5);
  topo+=smoothstep(0.09,0.0,bands)*0.05*coast;
  vec3 cp=vec3(cos(pat+uTime*0.05)*uRingR*2.6, pr.y*7.0, sin(pat+uTime*0.05)*uRingR*2.6);
  float cl=smoothstep(0.58,0.80, fbm3(cp));
  topo=mix(topo,vec3(0.88,0.90,0.94),cl*0.55);
  topo=mix(topo,topo*(0.5+cc),0.30);
  vec3 M=topo*(0.5+dif*1.5)*(0.7+uGlow*0.4)*(0.5+uRingGlow*5.0);
  float shield=(0.30+0.90*fres)*(0.6+0.5*cw);
  float shAmt=(0.18+shield)*uRingGlow;
  M=mix(M, M*cc*3.6, clamp(shAmt*1.3,0.0,0.99));
  M += cc*shAmt*1.1;
  M=mix(M, cc*(0.45+0.55*dif), clamp(shAmt*0.55,0.0,0.75));
  float shimmer=pow(cw,2.0)*3.4 + cl*1.4;
  M += cc*shimmer*uRingGlow*9.5;
  M += cc*cw*0.02*uGlow*(uRingGlow*6.0);
  return M;
}

void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/uRes.y;   // the stage's own center -- the panel is a flex sibling now
  vec3 cc=uCoreCol;   // CORE COLOR, straight from the picker

  float ca=uCamAngle + uPhCam;         // ANGLE = static position, ORBIT = rotation speed
  float el=uCamEl;
  vec3 ro=vec3(sin(ca),el,cos(ca))*(3.7/max(uZoom,0.1));
  vec3 fw=normalize(-ro), rt=normalize(cross(vec3(0,1,0),fw)), up=cross(fw,rt);
  vec3 rd=normalize(fw + uv.x*rt*1.15 + uv.y*up*1.15);

  float t=0.0, glow=0.0; int id=0; vec3 hp=ro;
  // bounding sphere: skip empty space and bail on rays that miss the scene
  float Rb=max(uRingR+0.2, coreRadius()+1.6) + uVentBurst*uVentSize*3.0 + uScatter*1.3;   // grow the march radius on a VENT or a scatter so nothing is clipped
  float bb=dot(ro,rd), cs=dot(ro,ro)-Rb*Rb, hh=bb*bb-cs;
  float tenter = hh>0.0 ? max(0.0,-bb-sqrt(hh)) : 1e9;
  float texit  = hh>0.0 ? (-bb+sqrt(hh)) : -1.0;
  t=tenter + hash(vec3(gl_FragCoord.xy, floor(uTime*60.0)))*0.035;   // jittered ray start breaks concentric bloom banding
  for(int i=0;i<70;i++){
    if(t>texit) break;                               // also handles full miss (0 iterations)
    vec3 p=ro+rd*t;
    float dc=coreSDF(p), dr=ringSDF(p), dsh=shieldSDF(p);
    float d=min(dc,min(dr,dsh));
    glow += smoothstep(-0.03,0.06,dr-dc)*exp(-max(dc,0.0)*max(5.6 - uVentBurst*2.4*uVentSize, 0.7)) * min(dc,0.06);   // marched bloom gradient; the BURST widens it, SIZE = reach
    if(d<0.002){ id = (dc<=dr && dc<=dsh)?1 : (dr<=dsh?2:3); hp=p; break; }
    t += d*0.8;
  }

  vec3 col = vec3(0.015,0.02,0.017);
  col += cc * glow * uGlow * (1.7 + uVent*7.0*uVentBright + pow(uVent,2.0)*10.0*uVentBright);   // VENT glow burst; brightness fades in step with the shrinking reach

  if(id==1){
    vec3 n=nrmC(hp);
    float fres=pow(1.0-max(dot(n,-rd),0.0),2.2);
    float inner=fbm(hp*3.0*uVisc*0.4 + uTime*0.4);
    inner=pow(clamp(inner,0.0,1.0),2.0);       // deepen & sharpen the drifting blotches
    vec3 base=cc*(inner*inner*1.75);           // black spots go to true black for stronger contrast
    base += fres*mix(cc,vec3(1.0),0.04)*2.0;   // edge = almost pure selected color, minimal white
    col = base*(0.16 + uGlow)*(1.0 + uPulse*uPulseBright*0.6 + uVent*uVentBright*1.8);  // GLOW 0 = dark colored core; core surface also brightens with PULSE and VENT flashes
    vec3 hot=mix(cc, vec3(1.0), clamp(uVent*uVentBright*0.55,0.0,1.0));   // color heats toward white as the vent brightens
    col += hot*uVent*uVentBright*(1.4 + inner*1.2);   // VENT floods the WHOLE surface so it never reads as a dark object
    col += vec3(1.0)*uVent*uVentBright*uVent*(1.0 - inner)*1.1;   // dark spots heat to white-hot with brightness
  } else if(id==2){
    vec3 n=nrmR(hp);
    vec3 pr=ringSpace(hp);
    vec3 nl=ringSpace(n);
    float pat=atan(pr.z,pr.x);   // pattern rides with the ring's orbit
    vec3 Lv=-hp; float dL=max(length(Lv),1e-4); vec3 L=Lv/dL;
    float dif=max(dot(n,L),0.0);
    vec3 rad=normalize(vec3(pr.x,0.0,pr.z));
    float facing=dot(nl,rad);
    float outer=smoothstep(0.15,0.6,facing);
    float inner=smoothstep(0.15,0.6,-facing);
    // --- the machined surface, measured in meters along the band so a feature keeps its size as the ring grows ---
    float bayL=6.28318*uRingR/9.0;
    float arc=pat*uRingR;
    float bx=(fract(arc/bayL+0.5)-0.5)*bayL;             // meters from the nearest bay center
    /* Measured off the ring's circular position, not off bx or pat: bx wraps once a bay and atan once a
     * revolution, and with the ribs gone there is no longer a blanked-out band hiding either fold. */
    float aw=max(length(fwidth(vec2(cos(pat),sin(pat))))*uRingR, 1e-6);
    Surf S=ringRelief(bx, pr.y, bayL, aw);
    vec3 nb=bumpN(hp, n, S.h);
    float scribe=max(dashesW(pat*34.0,0.06,aw*34.0/max(uRingR,1e-4)), dashes(pr.y*70.0,0.06))*S.bay;   // constant angular density: does NOT densify on a big ring

    // --- lighting basis: the core is the sole light, and it is a sphere, not a point ---
    vec3 Vd=-rd;
    float Rc=coreRadius();
    float sinA=clamp(Rc/dL,0.0,0.995);                   // the core's angular radius from here
    vec3 lit=cc*(0.35+uGlow*0.85);
    float irr=sphereDiff(nb,L,sinA)*LIGHT_NORM;
    float ndv=clamp(dot(nb,Vd),0.0,1.0);
    float fres=pow(1.0-ndv,4.0);

    // --- albedo: dark anodised alloy, brushed along the arc, worn back to bare metal on the machined lips ---
    float grain=noise(vec3(arc*300.0, pr.y*26.0, 4.0));
    float mottA=noise(vec3(arc*7.0, pr.y*9.0, 1.0));
    vec3 alloy=mix(vec3(0.052,0.058,0.068), vec3(0.105,0.112,0.126), grain*0.65+mottA*0.35);
    vec3 alb=mix(alloy*1.3, alloy*0.7, S.bay);           // the recessed bay is painted darker than its frame
    // Named blotch, not patch: patch is a RESERVED WORD in GLSL ES 3.00 and will not compile.
    float blotch=noise(vec3(arc*2.3, pr.y*3.0, 7.0));     // low frequency, so some lips are worn bare and others are not
    float wear=uRingWear*S.rim*(0.12+0.88*smoothstep(0.30,0.72,blotch*0.7+grain*0.3));
    float grime=uRingWear*S.bay*(0.30+0.70*mottA)*(1.0-S.rim);
    alb=mix(alb, vec3(0.46,0.48,0.51), wear);
    alb=mix(alb, alb*0.55, grime*0.5);
    alb=mix(alb, vec3(0.38,0.40,0.43), S.trace*0.75);    // grooves cut through the coating to clean metal
    alb=mix(alb, alb*2.4, scribe*0.5);                   // fine scribing does the same, a fraction as deep

    // --- specular: rough metal, the lobe widened by the core's real angular size ---
    float rough=clamp(mix(0.10,0.78,uRingRough)-wear*0.30+grime*0.24, 0.04, 0.95);
    vec3 F0=mix(vec3(0.075), vec3(0.56,0.57,0.60), wear);
    vec3 Rr=reflect(-Vd,nb);
    vec3 Ls=sphereSpecL(Lv,Rr,Rc);
    vec3 Hh=normalize(Ls+Vd);
    float ndl=clamp(dot(nb,Ls),0.0,1.0);
    float ndh=clamp(dot(nb,Hh),0.0,1.0);
    float shine=mix(4.0,760.0,pow(1.0-rough,3.0))/(1.0+sinA*sinA*22.0);
    vec3 F=F0+(1.0-F0)*pow(1.0-clamp(dot(Vd,Hh),0.0,1.0),5.0);
    vec3 spec=lit*F*((shine+2.0)*0.04)*pow(ndh,shine)*ndl;

    /* The chamber is not empty: the core's bloom fills it, so an alloy face turned away from the core still has
     * something to reflect. Radiance down the reflection ray is that haze floor plus the core itself where the ray
     * happens to point back at it. This is the whole of what lights the outward face — it has no diffuse. */
    float toCore=max(dot(Rr,L),0.0);
    // Not pure core color: bloom scattered through the chamber comes back desaturated, and it is the only thing
    // that keeps the alloy reading as metal rather than as tinted glass.
    vec3 haze=mix(cc,vec3(1.0),0.16);
    /* ROUGHNESS acts HERE, not only on the core's highlight — the outward face never sees that highlight at all.
     * A wide lobe integrates a broad cone of the chamber and so catches the core even where the mirror direction
     * misses it; a polished face reflects the sharp image of an empty chamber, which is nearly black. */
    float envSharp=mix(16.0,1.6,rough);
    vec3 env=haze*uGlow*(mix(0.02,0.19,rough)+0.55*pow(toCore,envSharp));
    float ao=clamp(1.0+S.h*260.0,0.30,1.0)*(1.0-0.25*S.trace)*(1.0-0.25*grime);
    vec3 m=alb*lit*irr*ao;
    m+=spec*ao;
    m+=env*(F0+(1.0-F0)*fres)*ao;                        // the haze reflected in the metal; worn lips catch far more of it
    m+=alb*haze*uGlow*0.30*ao;                           // the same haze arriving diffusely
    vec3 emitCol=mix(cc,vec3(1.0),0.10);                 // powered light stays close to the core color (less white)
    m+=emitCol*uRingLight*outer*(S.lens*4.2+S.dash*0.45);
    m+=alb*emitCol*uRingLight*outer*S.halo*4.0;          // and what the lamps throw onto the alloy around them
    /* --- inner face: topographic land / water camo map, lit by the core ---
     *
     * BEHIND A BRANCH because it is the expensive half of this shader — four domain-warped fbm3 chains and a
     * caustic — and the outward face discards every one of them through a mix factor of zero. The two faces are
     * large contiguous regions on screen, so the branch is coherent across a warp rather than per pixel. No
     * derivative is taken inside it, which is what makes it safe to skip. */
    float innerMix=inner*clamp(uRingGlow*1.05,0.0,1.0);
    if(innerMix>0.003){
    float cw=clamp(caust(vec2(cos(pat)*uRingR*3.0, sin(pat)*uRingR*3.0 + pr.y*30.0)),0.0,2.0);   // seamless cylindrical caustic - no wrap seam
    vec3 lp=vec3(cos(pat)*uRingR*3.5, pr.y*10.0, sin(pat)*uRingR*3.5);  // seamless cylindrical coord — no wrap seam, rides with the ring
    float e=fbm3(lp + fbm3(lp*0.5)*1.7);                               // domain-warped elevation
    e=clamp((e-0.25)/0.5,0.0,1.0);                                     // stretch to a full 0..1 range
    float coast=smoothstep(0.28,0.34,e);                              // 1 = land, 0 = water
    float mott=fbm3(lp*2.4 + 8.0);                                     // fine surface mottle
    vec3 waterC=vec3(0.03,0.12,0.17)+cw*vec3(0.03,0.09,0.11);          // teal water + caustic glints
    vec3 sandC =vec3(0.44,0.38,0.24);                                  // sandy beach
    vec3 grassC=mix(vec3(0.08,0.13,0.05),vec3(0.19,0.24,0.10),mott);   // mottled green lowland
    vec3 rockC =mix(vec3(0.17,0.15,0.13),vec3(0.26,0.24,0.21),mott);   // gray-brown rock
    vec3 snowC =vec3(0.86,0.89,0.94);                                  // snow cap
    vec3 topo=waterC;
    topo=mix(topo,sandC, smoothstep(0.30,0.35,e));                     // beach at the shoreline
    topo=mix(topo,grassC,smoothstep(0.37,0.44,e));                     // lowland green
    topo=mix(topo,rockC, smoothstep(0.60,0.68,e));                     // rocky mountains
    topo=mix(topo,snowC, smoothstep(0.78,0.88,e + mott*0.06));         // snow caps on the peaks
    float bands=abs(fract(e*9.0)-0.5);
    topo+=smoothstep(0.09,0.0,bands)*0.05*coast;                       // topographic contour lines
    vec3 cp=vec3(cos(pat+uTime*0.05)*uRingR*2.6, pr.y*7.0, sin(pat+uTime*0.05)*uRingR*2.6);  // clouds slowly drift around the band
    float cl=fbm3(cp);                                                // drifting cloud layer (seamless)
    cl=smoothstep(0.58,0.80,cl);
    topo=mix(topo,vec3(0.88,0.90,0.94),cl*0.55);                       // soft white clouds over land & sea
    topo=mix(topo,topo*(0.5+cc),0.30);                                 // tint toward the core color
    vec3 innerM=topo*(0.5 + dif*1.5)*(0.7 + uGlow*0.4)*(0.5 + uRingGlow*5.0);   // lit land/water map; RING GLOW brightens it
    float shield=(0.30 + 0.90*fres)*(0.6 + 0.5*cw);                    // containment field: full film + bright glancing rim
    float shAmt=(0.18 + shield)*uRingGlow;                             // shield strength
    innerM = mix(innerM, innerM*cc*3.6, clamp(shAmt*1.3,0.0,0.99));    // tint terrain strongly toward the core color (colored, not white)
    innerM += cc*shAmt*1.1;                                           // colored glow on top
    innerM = mix(innerM, cc*(0.45 + 0.55*dif), clamp(shAmt*0.55,0.0,0.75));   // less transparent: blend toward a solid core-color film
    float shimmer=pow(cw,2.0)*3.4 + cl*1.4;                            // moving water caustics + drifting clouds (sharper, stronger wisps)
    innerM += cc*shimmer*uRingGlow*9.5;  // colored wispy shield strands
    innerM += cc*cw*0.02*uGlow*(uRingGlow*6.0);   // faint inner-face caustic glow
    m = mix(m, innerM, innerMix);           // segment inner face also fades with SHIELD (0 = plain alloy, no land)
    }
    col = m;
  } else if(id==3){
    vec3 bg=vec3(0.015,0.02,0.017) + cc*glow*uGlow*1.7;               // what sits behind the shield band (bg + core bloom)
    float sAlpha=clamp(uRingGlow*1.05, 0.0, 1.0);                    // SHIELD % = opacity: 0 removes it entirely, solid when high
    col = mix(bg, shieldMaterial(hp, rd, cc), sAlpha);   // full continuous inner shield ring, transparency driven by SHIELD
  }

  float vig=smoothstep(1.5,0.2,length(uv));
  col*=vig;
  float sceneD=(id>0)?length(hp-ro):1e9;   // scene depth for occluding the flashes
  if(uBreakBurst < 0.22){
    float segb=6.28318/9.0;
    for(int k=0;k<9;k++){
      vec3 hb=vec3(hash(vec3(float(k)*5.1,1.0,3.0)),hash(vec3(float(k)*5.1,2.0,6.0)),hash(vec3(float(k)*5.1,4.0,9.0)));
      float gb=-3.14159+float(k)*segb;                 // gap angle (between two pieces)
      vec3 C=ringToWorld(uRingR*vec3(cos(gb),0.0,sin(gb)));   // world position of the gap
      float lt=uBreakBurst - hb.x*0.03;                // all fire together within ~0.1s
      float dur=0.05+hb.y*0.05;                        // very fast, done in ~0.1s
      float tt=dot(C-ro,rd);
      if(lt>0.0 && lt<dur && tt>0.0 && tt < sceneD){   // occluded when behind the core/ring
        float f=lt/dur;
        vec3 cp=ro+rd*tt;
        vec3 dir=normalize(cp-C);
        float closest=length(cp-C);
        float jag=noise(dir*7.0 + float(k)*3.0 + uTime*34.0)-0.5;   // erratic, animated distortion
        float crack=noise(dir*24.0 + uTime*70.0);                   // high-freq electric crackle
        float sr=f*(0.15+hb.z*1.2) + jag*0.13*(1.0-f);              // big random size variance, jagged shell
        float width=(0.007+hb.x*0.018)*(1.0+crack*1.8);            // thin, crackling filament
        float shell=exp(-(closest-sr)*(closest-sr)/(width*width));
        shell*=0.35+1.0*crack;                                      // flicker along the arc \u2014 lightning-like
        float fade=(1.0-f)*(0.6+hb.y*1.6);                          // random brightness, snaps out fast
        col += cc*shell*fade*3.4;                                   // colored electric sonic-boom at the break point
      }
    }
  }
  col=col/(col+0.85); col=pow(col,vec3(0.85));
  col += (hash(vec3(gl_FragCoord.xy, fract(uTime)))-0.5)/160.0;   // dither: smooths the bloom gradient banding
  fragColor=vec4(col,1.0);
}`;
