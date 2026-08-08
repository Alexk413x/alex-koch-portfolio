/* The containment core as a fragment shader: a sphere-traced SDF scene — the core and its goo droplets, nine
 * alloy ring fragments, and the continuous inner shield band — marched in one loop between a bounding sphere's
 * entry and exit. Pure source, no GL calls.
 *
 * Rotations arrive as a PHASE (uPhOrbit), not a rate: reactor-sim integrates them, so changing a speed does not
 * teleport whatever it was driving.
 *
 * uFragFly and uSnap are read but never move — the auto-fling they drive is not wired to any control. Removing
 * them changes what this shader can express, so they stay at 0 and 1 until that is decided.
 */
export const UNIFORMS = [
  'uAmp', 'uBreakBurst', 'uCamAngle', 'uCamEl', 'uCoreAngle', 'uCoreAngleX', 'uCoreCol', 'uDropData', 'uDropN',
  'uFragFly', 'uGlow', 'uHue', 'uOct', 'uPhCam', 'uPhCoreX', 'uPhCoreY', 'uPhOrbit', 'uPhOrbitX', 'uPhRate',
  'uPhWob', 'uPulse', 'uPulseBright', 'uPulseSize', 'uRate', 'uRes', 'uRingAngleX', 'uRingAngleY', 'uRingGlow',
  'uRingLight', 'uRingOn', 'uRingR', 'uScatter', 'uShape', 'uShieldExpand', 'uSize', 'uSnap', 'uSubVT', 'uSwellAmt',
  'uSwellRingBase', 'uSwellTarget', 'uTime', 'uTurb', 'uVent', 'uVentBright', 'uVentBurst', 'uVentSize',
  'uVentSwell', 'uVisc', 'uWobble', 'uZoom'
];

export const FRAG = `
#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec2 uRes; uniform float uTime,uSize,uVisc,uTurb,uRate,uGlow,uZoom,uHue,uPulse,uVent,uVentBurst,uRingR,uRingLight,uRingGlow,uRingOn,uOct,uCamAngle,uCamEl,uAmp,uPulseBright,uVentSize,uVentBright,uShape,uWobble,uCoreAngle,uCoreAngleX,uPulseSize,uDropN,uPhOrbit,uPhWob,uPhCam,uPhCoreY,uPhCoreX,uPhRate,uRingAngleY,uRingAngleX,uPhOrbitX;

uniform vec4 uDropData[20];   // per-droplet center.xyz + radius.w, precomputed on CPU each frame
uniform vec3 uCoreCol;        // CORE COLOR picker (base, before RADIATION hue-shift)
uniform float uVentSwell;    // VENT SWELL envelope: 0..1 animation ramp
uniform float uSwellAmt;     // VENT SWELL target: signed fraction (+1 = ring, +2 = past, -1 = shrink to 0)
uniform float uSwellRingBase; // original ring radius used as the SWELL target (so the ring can expand separately)
uniform float uFragFly;      // 0..1: rips the 9 fragments off and flings them outward (they return to reform)
uniform float uSubVT;        // sub-core (droplet) viscosity/turbulence multiplier
uniform float uSwellTarget;  // the (break-expanded) ring radius the SWELL reaches toward
uniform float uScatter;      // break-scatter distance: flings each of the 9 pieces off in a random direction with a random tumble
uniform float uSnap;         // shield failure flicker (1 = steady, <1 = flickering as it snaps)
uniform float uShieldExpand; // shield ring balloons outward as it dies during a break
uniform float uBreakBurst;    // seconds since a break began (>=1.3 = inactive) - drives the shockwave flashes
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
mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }
mat3 rotZ(float a){ float c=cos(a),s=sin(a); return mat3(c,-s,0., s,c,0., 0.,0.,1.); }
vec3 ringSpace(vec3 p);   // forward declaration (defined below, used in coreSDF)
vec3 hueShift(vec3 col,float a){ const vec3 k=vec3(0.57735); float c=cos(a); return col*c+cross(k,col)*sin(a)+k*dot(k,col)*(1.0-c); }
float caust(vec2 p){                 // cheap sunlight-through-water caustic
  float t=uTime*0.5; vec2 q=p; float v=0.0;
  for(int i=0;i<3;i++){
    q += vec2(sin(t + q.y*1.7), cos(t + q.x*1.7))*0.6;
    v += 1.0/(0.35+abs(sin(q.x)*sin(q.y)));
  }
  return pow(v*0.12,1.8);
}

float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0); }
float sdHexPrism(vec3 p, vec2 h){ const vec3 k=vec3(-0.8660254,0.5,0.57735); p=abs(p); p.xy-=2.0*min(dot(k.xy,p.xy),0.0)*k.xy; vec2 d=vec2(length(p.xy-vec2(clamp(p.x,-k.z*h.x,k.z*h.x),h.x))*sign(p.y-h.x), p.z-h.y); return min(max(d.x,d.y),0.0)+length(max(d,0.0)); }
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
  else if(uShape<3.5) return sdOcta(q, r*1.05);           // pyramid
  return sdDisk(q, r, r*0.0875);                           // disk
}
float coreRadius(){
  float breathe = uAmp*(0.5-0.5*cos(uPhRate));       // pulse swells outward from the base, never below it
  float base = uSize + breathe + uPulse*uPulseSize;
  float delta = uSwellAmt>=0.0 ? uSwellAmt*(max(uSwellTarget,base)-base) : uSwellAmt*base;   // +: toward/past the ring (follows the break-expanded radius); -: toward 0m
  return max(base + clamp(uVentSwell,0.0,1.0)*delta, 0.0);   // VENT SWELL animates the core size during a vent
}
float coreSDF(vec3 p){
  vec3 p0=p;                                         // world point (for ring-aligned bulge)
  p = rotY(uCoreAngle + uPhCoreY) * p;               // core rotation Y
  p = rotX(uCoreAngleX + uPhCoreX) * p;              // core rotation X
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
      float db=shapeSDF(p - D.xyz, D.w) - disp*0.7*uSubVT;    // droplets share the core's turbulent surface (SUB VIS/TRB scales it)
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
vec3 ringSpace(vec3 p){
  vec3 q = rotY(uRingAngleY + uPhOrbit) * p;                              // Y orbit: static ANGLE Y + ORBIT Y speed
  q = rotX(uRingAngleX + uPhOrbitX + uWobble*sin(uPhWob)) * q;    // X orbit + wobble
  return q;                           // spin acts on the surface pattern only (below)
}
vec3 ringToWorld(vec3 q){            // inverse of ringSpace (ring-local -> world)
  return rotY(-(uRingAngleY + uPhOrbit)) * (rotX(-(uRingAngleX + uPhOrbitX + uWobble*sin(uPhWob))) * q);
}
float ringSDF(vec3 p){
  if(uRingOn<0.5) return 1e5;
  vec3 pr=ringSpace(p);
  float seg=6.28318/9.0;
  float segLen=uSwellRingBase*seg*1.02;
  float harc=min(seg*0.5, (segLen*0.5)/max(uRingR,0.001));
  float scat=uScatter + uFragFly*2.5;                   // manual break-scatter + auto fling
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

vec3 coreCol(){
  return hueShift(uCoreCol, uHue);   // base = CORE COLOR picker; RADIATION rotates hue on top
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
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/uRes.y;   // the stage's own centre -- the panel is a flex sibling now
  vec3 cc=coreCol();

  float ca=uCamAngle + uPhCam;         // ANGLE = static position, ORBIT = rotation speed
  float el=uCamEl;
  vec3 ro=vec3(sin(ca),el,cos(ca))*(3.7/max(uZoom,0.1));
  vec3 fw=normalize(-ro), rt=normalize(cross(vec3(0,1,0),fw)), up=cross(fw,rt);
  vec3 rd=normalize(fw + uv.x*rt*1.15 + uv.y*up*1.15);

  float t=0.0, glow=0.0; int id=0; vec3 hp=ro;
  // bounding sphere: skip empty space and bail on rays that miss the scene
  float Rb=max(uRingR+0.2, coreRadius()+1.6) + uVentBurst*uVentSize*3.0 + uFragFly*2.4 + uScatter*1.3;   // grow the march radius on a VENT/fling/scatter so nothing is clipped
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
    float ang=atan(pr.z,pr.x);
    float pat=ang;   // pattern rides with the ring's orbit
    vec3 L=normalize(-hp);
    float dif=max(dot(n,L),0.0);
    vec3 rad=normalize(vec3(pr.x,0.0,pr.z));
    float facing=dot(nl,rad);
    float outer=smoothstep(0.15,0.6,facing);
    float inner=smoothstep(0.15,0.6,-facing);
    float fy=abs(pr.y);
    // 9-section angular alien circuitry with a circle in each section
    float sects=9.0;
    float su=pat*sects/6.28318;
    float bnd=fract(su);
    float cellAng=bnd-0.5;
    float rail=smoothstep(0.005,0.001, abs(fy-0.041));                       // twin rails
    float divider=smoothstep(0.03,0.006, min(bnd,1.0-bnd)) * step(fy,0.047);  // 9 radial dividers
    float tick=smoothstep(0.52,0.46, abs(fract(pat*40.0/6.28318)-0.5)) * step(fy,0.022); // fine ticks
    float cellArc=cellAng*(6.28318*uRingR/sects);
    float rC=length(vec2(cellArc, pr.y));
    float circle=smoothstep(0.010,0.004, abs(rC-0.030));                      // circle per section
    float arcB=min(bnd,1.0-bnd)*(6.28318*uRingR/sects);   // arc dist to nearest divider
    float edgeD=0.043-fy;                                  // dist from rail edge
    float cham=smoothstep(0.004,0.0, abs(arcB-edgeD)) * step(arcB,0.05) * step(edgeD,0.05) * step(0.0,edgeD); // 45° line at each corner
    // broken X inside each section (lines stop short of the middle)
    float nx=clamp(cellAng*2.0,-1.0,1.0);
    float ny=clamp(pr.y/0.043,-1.0,1.0);
    float xr=max(abs(nx),abs(ny));
    float xmark=smoothstep(0.11,0.03, abs(abs(nx)-abs(ny))) * step(0.42,xr) * step(xr,0.88) * step(fy,0.043);
    float struc=max(max(rail,divider),max(circle,max(cham,xmark)));   // low-freq structure only
    float lines=max(struc,tick);
    float emb=clamp(dFdx(struc)+dFdy(struc),-0.4,0.4);   // bevel from structure gradient
    vec3 lineCol=vec3(0.90,0.93,0.97);            // bright etched alloy
    // --- fine circuit grid (AA, resolution independent) ---
    float gu=pat*34.0, gv=pr.y*70.0;                    // constant angular density (does NOT densify on a big ring)
    float gwu=fwidth(gu), gwv=fwidth(gv);
    float gx=smoothstep(0.5-gwu,0.5, abs(fract(gu)-0.5));
    float gy=smoothstep(0.5-gwv,0.5, abs(fract(gv)-0.5));
    float grid=max(gx,gy)*step(fy,0.046)*clamp(1.5-(gwu+gwv)*1.5,0.0,1.0);  // fade where sub-pixel
    // --- relief bump: tilt the normal along the structure edges so it self-shades ---
    vec3 nb=normalize(n - vec3(dFdx(struc),dFdy(struc),0.0)*2.0);
    // --- lighting basis (sole light = the core) ---
    vec3 Vd=-rd, Hh=normalize(L+Vd);
    float difB=max(dot(nb,L),0.0);
    float ndv=max(dot(nb,Vd),0.0);
    float spec=pow(max(dot(nb,Hh),0.0),55.0);
    float fres=pow(1.0-ndv,4.0);
    float micro=noise(pr*80.0)*0.5+0.5;                 // brushed micro-variation
    // --- albedo: dark brushed alloy; etched traces are cleaner brighter metal ---
    vec3 alb=mix(vec3(0.085,0.095,0.115), vec3(0.15,0.16,0.185), micro);
    alb=mix(alb, lineCol*0.9, clamp(lines*outer,0.0,1.0)*0.8);
    alb*=1.0 - 0.22*grid*outer;                         // grooves darken (AO)
    // --- cold environment reflection sheen (metal catches the chamber, not just diffuse) ---
    vec3 Rr=reflect(-Vd,nb);
    float envG=clamp(0.5+0.5*Rr.y,0.0,1.0);
    vec3 envCol=mix(vec3(0.015,0.02,0.03), vec3(0.05,0.07,0.10), envG);
    envCol += cc*0.05*pow(max(dot(Rr,L),0.0),3.0);      // faint core reflection (subtle)
    // --- compose ---
    vec3 m = alb*(0.05 + difB*1.05);                    // diffuse; backside stays in shadow
    m += envCol*(0.5 + 0.5*fres)*(0.25+0.75*outer);     // reflection sheen gives it form
    m += vec3(0.85,0.88,0.95)*spec*(0.15+difB)*0.7;     // sharp machined specular
    m += fres*vec3(0.45,0.52,0.62)*0.22*outer;          // cool metal fresnel edge (not a glow)
    m += outer*emb*0.7*lineCol;                         // raised bevel highlight on structure
    m += lines*outer*lineCol*(0.10 + difB*0.9);         // etched design catches the core light
    float nodeLit=smoothstep(0.013,0.0, rC);            // glowing node at each section center
    vec3 emitCol=mix(cc,vec3(1.0),0.10);                // powered light stays close to the core color (less white)
    m += nodeLit*outer*emitCol*uRingLight*5.0;          // powered center light
    float cline=smoothstep(0.0032,0.0011, abs(fy));                       // thin centerline (thinner than the node dots)
    float dash=smoothstep(0.5,0.4, abs(fract(pat*80.0/6.28318)-0.5));     // dashed pattern
    float dLine=cline*dash*smoothstep(0.09,0.14, abs(cellAng));           // dashes sit BETWEEN the dots (skip the node center)
    m += dLine*outer*emitCol*uRingLight*3.0;            // thin dashed light line between nodes
    // --- inner face: topographic land / water camo map, lit by the core ---
    float cw=clamp(caust(vec2(cos(pat)*uRingR*3.0, sin(pat)*uRingR*3.0 + pr.y*30.0)),0.0,2.0);   // seamless cylindrical caustic - no wrap seam
    vec3 lp=vec3(cos(pat)*uRingR*3.5, pr.y*10.0, sin(pat)*uRingR*3.5);  // seamless cylindrical coord — no wrap seam, rides with the ring
    float e=fbm3(lp + fbm3(lp*0.5)*1.7);                               // domain-warped elevation
    e=clamp((e-0.25)/0.5,0.0,1.0);                                     // stretch to a full 0..1 range
    float coast=smoothstep(0.28,0.34,e);                              // 1 = land, 0 = water
    float mott=fbm3(lp*2.4 + 8.0);                                     // fine surface mottle
    vec3 waterC=vec3(0.03,0.12,0.17)+cw*vec3(0.03,0.09,0.11);          // teal water + caustic glints
    vec3 sandC =vec3(0.44,0.38,0.24);                                  // sandy beach
    vec3 grassC=mix(vec3(0.08,0.13,0.05),vec3(0.19,0.24,0.10),mott);   // mottled green lowland
    vec3 rockC =mix(vec3(0.17,0.15,0.13),vec3(0.26,0.24,0.21),mott);   // grey-brown rock
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
    m = mix(m, innerM, inner*clamp(uRingGlow*1.05,0.0,1.0));           // segment inner face also fades with SHIELD (0 = plain alloy, no land)
    col = m * uSnap;                                                    // flicker at the moment the shield fails
  } else if(id==3){
    vec3 bg=vec3(0.015,0.02,0.017) + cc*glow*uGlow*1.7;               // what sits behind the shield band (bg + core bloom)
    float sAlpha=clamp(uRingGlow*1.05, 0.0, 1.0);                    // SHIELD % = opacity: 0 removes it entirely, solid when high
    col = mix(bg, shieldMaterial(hp, rd, cc), sAlpha) * uSnap;        // full continuous inner shield ring, transparency driven by SHIELD
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
  gl_FragColor=vec4(col,1.0);
}`;
