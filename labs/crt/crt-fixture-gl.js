/* crt-fixture-gl.js — the fitting's GLSL, shared as a string by both the fixture target and the main pass so
 * their geometry and shading can't drift apart. GLSL has no include; crt-gl composes this into both programs.
 * What belongs here is the FITTING itself; the tube's picture stays in crt-gl.
 */

// Uniform list the fitting reads, declared once so both programs agree on the interface.
export const FIXTURE_UNIFORMS = `uniform float uBoxVis, uCapLen, uDiffuse, uFixDist, uFixGap, uFixLens, uFixture, uFlkA, uFlkB, uFrost, uGlowA, uGlowB, uHealthA, uHealthB, uMatte, uPrism, uPrismK, uPrismN, uRailVis, uRailW, uTubeDead;
uniform vec3 uLampA, uLampB;`;

// Ray vs a capped cylinder: a glass barrel, wider sleeves over the last capL at each end, closed by end discs.
export const FIXTURE_GLSL = `float hitTube(vec3 ro, vec3 rd, float y0, float z0, float hl, float r, float capL) {
  float best = -1.0;
  float bodyHL = max(hl - capL, 0.0);          // where the glass stops and the metal starts
  float rc     = r;                            // FLUSH: the cap is the same diameter as the glass

  vec2 o = vec2(ro.y - y0, ro.z - z0), d = vec2(rd.y, rd.z);
  float a = dot(d, d);
  if (a > 1e-9) {
    float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - a * c;
    if (h >= 0.0) {
      h = sqrt(h);
      for (int k = 0; k < 2; k++) {
        float t = (k == 0 ? (-b - h) : (-b + h)) / a;
        if (t > 0.0 && abs(ro.x + rd.x * t) <= bodyHL && (best < 0.0 || t < best)) best = t;
      }
    }
    float c2 = dot(o, o) - rc * rc, h2 = b * b - a * c2;
    if (h2 >= 0.0) {
      h2 = sqrt(h2);
      for (int k = 0; k < 2; k++) {
        float t = (k == 0 ? (-b - h2) : (-b + h2)) / a;
        float px = abs(ro.x + rd.x * t);
        if (t > 0.0 && px >= bodyHL && px <= hl && (best < 0.0 || t < best)) best = t;
      }
    }
  }

  if (abs(rd.x) > 1e-9) {
    for (int e = 0; e < 2; e++) {
      float px = (e == 0 ? -hl : hl);
      float t  = (px - ro.x) / rd.x;
      if (t > 0.0) {
        vec3 p = ro + rd * t;
        vec2 rv = vec2(p.y - y0, p.z - z0);
        if (dot(rv, rv) <= rc * rc && (best < 0.0 || t < best)) best = t;
      }
    }
  }
  return best;
}

// Ray vs an axis-aligned box from inside: returns t at the far wall and writes that wall's normal.
float hitBoxInside(vec3 ro, vec3 rd, vec3 lo, vec3 hi, out vec3 n) {
  // GLSL has no vector <, so lessThan/mix stands in; guarded against zero divide since a ray parallel to a
  // face is the common case here, not a rare one.
  vec3 safe = mix(rd, vec3(1e-7), vec3(lessThan(abs(rd), vec3(1e-7))));
  vec3 inv = 1.0 / safe;
  vec3 t1 = (lo - ro) * inv, t2 = (hi - ro) * inv;
  vec3 tf = max(t1, t2);
  float t = min(min(tf.x, tf.y), tf.z);
  n = -sign(rd) * vec3(t == tf.x ? 1.0 : 0.0, t == tf.y ? 1.0 : 0.0, t == tf.z ? 1.0 : 0.0);
  return t;
}

// Fraction of the tube, from each end, still discharging at health h — below 0.5 the middle is dark and emits nothing.
float litReach(float h) { return clamp((clamp(h, 0.0, 1.0) - 0.2) * 0.9, 0.08, 0.5); }

// Irradiance a tube throws at a point. A line source falls off as 1/d, not 1/d^2, and only the still-lit
// zone (per reach) counts as the nearest point, so a burned-out middle throws no light.
vec3 tubeLight(vec3 pos, vec3 nrm, float y0, float z0, float halfLen, float r, vec3 col, float flux, float reach) {
  float xin = halfLen * max(1.0 - 2.0 * reach, 0.0);        // inner edge of the still-lit zone
  float sx  = pos.x >= 0.0 ? 1.0 : -1.0;                    // sign(), but never zero
  vec3 c = vec3(sx * clamp(abs(pos.x), xin, halfLen), y0, z0);   // nearest LIT point on the tube's axis
  vec3 d = c - pos;
  float dist = max(length(d), r);

  // wrap models the source's finite width: r/dist is how far round a wide emitter still shows above the horizon.
  float wrap = clamp(r / max(dist, 1e-4), 0.0, 1.0);
  float lam  = max((dot(nrm, d / dist) + wrap) / (1.0 + wrap), 0.0);
  return col * flux * lam / (0.35 + dist * 2.2);
}

// Closest approach between a ray and the tube's axis segment, in the fixture's own space (not screen space)
// so the halo foreshortens and leans with the tube. ax01 returns where along the tube (0..1) that point falls.
float axisDist(vec3 ro, vec3 rd, float ax, float az, float hl, out float ax01) {
  vec3  A  = vec3(-hl, ax, az);
  vec3  u  = vec3(1.0, 0.0, 0.0);
  vec3  w0 = ro - A;
  float b  = dot(rd, u);
  float d  = dot(rd, w0);
  float e  = dot(u,  w0);
  float den = 1.0 - b * b;
  float sc  = den < 1e-5 ? max(-d, 0.0) : (b * e - d) / den;
  sc = max(sc, 0.0);
  float tc = clamp(e + b * sc, 0.0, 2.0 * hl);
  ax01 = clamp(tc / max(2.0 * hl, 1e-5), 0.0, 1.0);
  return length((ro + rd * sc) - (A + u * tc));
}
// Overload for callers that don't need the axial coordinate.
float axisDist(vec3 ro, vec3 rd, float ax, float az, float hl) {
  float ig; return axisDist(ro, rd, ax, az, hl, ig);
}

// Coating vitality at t01 (0..1 end to end): 0 dead, 1 fully lit. Transcribed from crt-fixture's tubeHealth
// so the tube body and its halo read the same curve instead of two copies that could drift apart.
float tubeVit(float t01, float health) {
  float h        = clamp(health, 0.0, 1.0);
  float endVital = clamp((h - 0.18) / 0.12, 0.0, 1.0);
  float conn     = h < 0.4 ? 0.0
                 : (h < 0.9 ? (h - 0.4) / 0.5 * 0.5
                            : 0.5 + (h - 0.9) / 0.1 * 0.5);
  float vFront   = 0.35 * endVital * (1.0 - conn) + conn;
  float reach    = clamp((h - 0.2) * 0.9, 0.08, 0.5);
  float p1 = reach * 0.45, p2 = reach, p3 = min(0.5, reach + 0.18);
  float fromEnd  = min(t01, 1.0 - t01);
  return fromEnd < p1 ? endVital
       : fromEnd < p2 ? mix(endVital, vFront, (fromEnd - p1) / max(p2 - p1, 1e-4))
       : fromEnd < p3 ? mix(vFront, conn,     (fromEnd - p2) / max(p3 - p2, 1e-4))
       : conn;
}

// Shading for the tube itself: emission blended with dead coating and a rim, then a metal end cap on top.
vec3 tubeSurface(vec3 pos, vec3 nrm, vec3 rd, float halfLen, float health, float flk, vec3 col, float seed) {
  float axial = clamp(abs(pos.x) / max(halfLen, 1e-4), 0.0, 1.0);
  // Distance from the tube's end as a fraction of halfLen, not a raw length — pos.x carries the aspect factor
  // and halfLen doesn't, so comparing raw lengths against uCapLen barely moves; the cap stays a fixed physical size.
  float fromEnd = 1.0 - axial;
  float face    = max(dot(nrm, -rd), 0.0);

  // Ported from crt-fixture's tubeHealth(): endVital lights the ends over health 18-30%; conn (the middle)
  // stays dead below 40%, half-lit by 90%; reach (8-50% of length) is how far the end glow reaches inward.
  float h        = clamp(health, 0.0, 1.0);
  float endVital = clamp((h - 0.18) / 0.12, 0.0, 1.0);
  float conn     = h < 0.4 ? 0.0
                 : (h < 0.9 ? (h - 0.4) / 0.5 * 0.5
                            : 0.5 + (h - 0.9) / 0.1 * 0.5);
  // vFront: a mostly-dead base lifted by the middle's own vitality, so the end glow fades into the middle
  // instead of stopping against it.
  float vFront   = 0.35 * endVital * (1.0 - conn) + conn;
  float reach    = clamp((h - 0.2) * 0.9, 0.08, 0.5);
  float p1       = reach * 0.45;
  float p2       = reach;
  float p3       = min(0.5, reach + 0.18);

  float t01      = clamp(pos.x / max(halfLen, 1e-4) * 0.5 + 0.5, 0.0, 1.0);
  float vit      = tubeVit(t01, health);   // shared curve, so body and halo agree on which parts are dead
  float tchar    = clamp((0.25 - h) / 0.25, 0.0, 1.0) * 0.92;   // soot multiply below 25% health
  float dead     = 1.0 - vit;
  // Full metal from the sleeve's shoulder out, not faded across the cap — now that the sleeve is its own
  // geometry, fading would render its inner half as glass at the wider radius, a bulge past the tube.
  float caps  = 1.0 - smoothstep(max(uCapLen, 1e-5) * 0.94, max(uCapLen, 1e-5), fromEnd);
  float fres  = pow(1.0 - face, 3.0);                           // the envelope brightens at grazing angles
  // 3.4 gain: without it tubes measured 189 vs rails' 212 — a lamp must sit well above what it lights so the
  // tone map reads it as a light, not a bright object. FROST removes this grazing glint as the glass turns matte.
  vec3 emit = col * flk * (0.75 + 0.85 * fres * (1.0 - uFrost)) * 3.4;

  // char (46,38,33) and gapDark (38,31,27), the lab's own sRGB values converted to linear; gapCol crossfades
  // between them from 15% health, matching the lab.
  vec3 charLin = vec3(0.0273, 0.0194, 0.0152);
  vec3 gapLin  = vec3(0.0194, 0.0137, 0.0110);
  vec3 gapCol  = mix(charLin, gapLin, clamp((h - 0.15) * 1.6, 0.0, 1.0));
  // Scaled by the PAIR's output, not this tube's own, so a dead lamp beside a live one stays lit by its
  // neighbor off the housing and only goes fully dark when both tubes do.
  float ambT = clamp(max(uFlkA * uHealthA, uFlkB * uHealthB), 0.0, 1.0);
  // uTubeDead is a control: at 1 a dead section reads as gray coating; at 0 it's black, letting BOX show through.
  vec3 coat = gapCol * (0.30 + 0.70 * face) * (0.28 * ambT + 0.72 * flk) * uTubeDead;
  vec3 rim  = col * pow(fres, 0.8) * flk * 0.85 * uTubeDead;   // the dead glass's own rim still catches light
  emit = mix(emit, coat + rim, dead);   // dead sections stay a visible body with a rim, not a hole
  emit *= mix(1.0, 0.34, tchar);

  // Shaded as a metal band facing the camera, not a rim term — rim shading peaks at the silhouette and would
  // flatten a cylinder into a ring. Green cast: anodised aluminum against warm glass. capCol/metal stay nearly
  // flat since the sleeve's roundness already reads from its silhouette; a strong gradient plus specular here
  // would bulge it into a bead instead.
  vec3  capCol = vec3(0.27, 0.34, 0.28);          // anodised, with the green cast the real part has
  vec3  metal  = capCol * (0.82 + 0.18 * face) * flk;
  return mix(emit, metal, caps);
}


// The fixture's whole reflection as a function of one ray, so MATTE can call it several times per pixel and
// average for a rough-surface blur; with MATTE off it's called once and the extra taps cost nothing.
vec3 traceFixture(vec2 sp2, float ct, float st, vec3 boxLo, vec3 boxHi,
                  float halfLen, float tubeR, float tubeRlit, float tubeZ,
                  float flkA, float flkB) {
  // The fitting is the only light source in the scene, so its own ambient (housing walls, rails) scales with
  // the lamps' output rather than a fixed constant — with both dead, nothing here should still glow.
  float lampAmb = clamp(max(flkA * uHealthA, flkB * uHealthB), 0.0, 1.0);
  vec3 ro  = vec3(0.0, 0.0, 0.0);
  vec3 rd  = normalize(vec3(sp2, -uFixLens));
  mat3 rot = mat3(1.0, 0.0, 0.0, 0.0, ct, -st, 0.0, st, ct);
  vec3 rol = rot * (ro - vec3(0.0, 0.0, -max(uFixDist, 0.05) * uFixLens));
  vec3 rdl = rot * rd;
    // Where this ray crosses the aperture plane, after the tilt rotation — read below by the visibility test,
    // the prism facets, and the halo, so all three measure distance in the fixture's frame, not the screen's.
    float tOpen  = rdl.z != 0.0 ? -rol.z / rdl.z : -1.0;
    vec3  atOpen = rol + rdl * tOpen;
    bool  facing = tOpen > 0.0;

    // Analytic pixel coverage for the silhouette edges below (fwidth as pixel width, not a center-point test),
    // computed here before any branch since fwidth() is undefined inside non-uniform control flow. One vec2
    // derivative covers all three edges — the rails need d|x| and d|y| anyway.
    vec2  aOa   = abs(atOpen.xy);
    vec2  rW    = max(fwidth(aOa), vec2(1e-6));
    float apD   = max(aOa.x - boxHi.x, aOa.y - boxHi.y);     // <0 inside the opening, >0 outside
    float apW   = max(rW.x, rW.y);
    float apCov = 1.0 - smoothstep(-apW, apW, apD);
    float rWy   = rW.y;
    float rWx   = rW.x;
    vec3  room   = vec3(0.0);

    // A prismatic panel bends the ray at the aperture rather than shading what's behind it, so each cell's
    // displaced copy is a real intersection that moves correctly as the fitting tilts. Flat facets (sign())
    // per quadrant approximate the molded pyramid grid; pf (-0.5..0.5 across a cell) scales the bend so each
    // cell forms its own image instead of two half-cells sliding sideways. The bend angle is small by
    // measurement, not by the obvious guess — past it, refraction steers samples off the lamp instead of
    // dividing it into cells — and divided by pn (pitch) so a finer panel doesn't overshoot into its neighbor.
    if (uPrism > 0.001 && facing) {
      float pn = max(uPrismN, 2.0);
      vec2  pf = fract(atOpen.xy / max(boxHi.x, 1e-4) * pn * 0.5) - 0.5;
      rdl = normalize(rdl + vec3(pf * uPrism * uPrismK * (18.0 / pn), 0.0));
    }


    if (uFixture > 0.001) {
      float capLen = uCapLen * halfLen;                 // fraction of the lamp's half-length
      float tA = hitTube(rol, rdl, -uFixGap, tubeZ, halfLen, tubeR, capLen);
      float tB = hitTube(rol, rdl,  uFixGap, tubeZ, halfLen, tubeR, capLen);
      vec3  nW; float tW = hitBoxInside(rol, rdl, boxLo, boxHi, nW);

      float tHit = tW; int mat = 0;    // nearest hit wins; the tubes occlude the box walls behind them
      if (tA > 0.0 && tA < tHit) { tHit = tA; mat = 1; }
      if (tB > 0.0 && tB < tHit) { tHit = tB; mat = 2; }

      // Clipped at the aperture plane (z=0), not by the hit point against the box: every ray eventually hits
      // some wall of an enclosing box, so testing the hit point painted the fixture across the whole glass.
      // apCov is the visibility test itself now, weighted rather than boolean.
      bool insideOpening = facing && apCov > 0.001;
      vec3 pos = rol + rdl * tHit;

      if (insideOpening) {
        if (mat == 0) {
          // The box interior lit by the tubes, so a guttering fluorescent dims its own housing with it.
          vec3 wall = vec3(0.030, 0.029, 0.026);
          vec3 lit  = tubeLight(pos, nW, -uFixGap, tubeZ, halfLen, tubeRlit, uLampA, flkA * uHealthA, litReach(uHealthA))
                    + tubeLight(pos, nW,  uFixGap, tubeZ, halfLen, tubeRlit, uLampB, flkB * uHealthB, litReach(uHealthB));
          // uBoxVis is the reference's --bgvis: the housing's own visibility, separate from the lamps/rails.
          room = wall * (0.25 * lampAmb + lit * 3.2) * uBoxVis;
        } else {
          // Two normals: the barrel's points outward from the axis, the end disc's points along it — a closed
          // cylinder needs both, unlike a capsule where one radial expression covers the whole surface.
          float ax = mat == 1 ? -uFixGap : uFixGap;
          vec3  nrm = abs(pos.x) >= halfLen - 1e-4
                    ? vec3(sign(pos.x), 0.0, 0.0)
                    : normalize(vec3(0.0, pos.y - ax, pos.z - tubeZ));
          room = tubeSurface(pos, nrm, rdl, halfLen,
                             mat == 1 ? uHealthA : uHealthB,
                             mat == 1 ? flkA    : flkB, mat == 1 ? uLampA : uLampB, float(mat));
        }

        // The tube's edge going soft in 3D (see axisDist for why the fitting's own space, not screen space).
        // Exponential, not smoothstep, since a glow has no hard edge — a smoothstep draws a second, softer
        // silhouette around the first. Width is in tube radii; scaled by each lamp's own flux/health and
        // added, since scattered light is light already present arriving somewhere else.
        // Amplitude has to outshine the silhouette it's hiding: too dim and it just draws a second edge, so
        // near the tube both sides run off the top of the tone curve — real bloom hides a boundary by
        // overexposing around it, not by blending it. Per lamp, not shared, since two tubes can differ in
        // level, health and flicker, and a shared width would make the dimmer one look crisp behind a wash.
        float amtA = clamp(uGlowA + uDiffuse * 0.25, 0.0, 1.0);
        float amtB = clamp(uGlowB + uDiffuse * 0.25, 0.0, 1.0);
        if (amtA > 0.001 || amtB > 0.001) {
          float wA = tubeRlit * (0.30 + 7.5 * amtA);
          float wB = tubeRlit * (0.30 + 7.5 * amtB);
          float axA, axB;
          float gA = exp(-max(axisDist(rol, rdl, -uFixGap, tubeZ, halfLen, axA) - tubeRlit, 0.0) / max(wA, 1e-5));
          float gB = exp(-max(axisDist(rol, rdl,  uFixGap, tubeZ, halfLen, axB) - tubeRlit, 0.0) / max(wB, 1e-5));
          // Gated on hGlow (the lab's own: clamp((h-0.2)/0.55)) and on tubeVit at the sampled point, so a
          // burned-out middle throws no halo along its own dead length — otherwise it reads as transparent
          // rather than burned, and washes out BOX behind it with the same saturation.
          float hgA = clamp((uHealthA - 0.2) / 0.55, 0.0, 1.0) * tubeVit(axA, uHealthA);
          float hgB = clamp((uHealthB - 0.2) / 0.55, 0.0, 1.0) * tubeVit(axB, uHealthB);
          room += (uLampA * flkA * hgA * gA * amtA + uLampB * flkB * hgB * gB * amtB) * 5.5;
        }

        // A diffuser replaces the tubes rather than blurring them — the panel becomes the source, glowing at
        // the irradiance landing on its back. atPanel/smoothLit is that irradiance, smooth by construction (an
        // integral over the tubes, not a sample). DIFFUSER crossfades toward it; MATTE deliberately never does
        // — MATTE is glass roughness, picking a mip level of an existing reflection, and once did crossfade
        // like this, which made the whole fitting vanish into a fixture-less smooth field at MATTE 1.
        vec3 atPanel = vec3(atOpen.xy, 0.0);
        vec3 panelN  = vec3(0.0, 0.0, 1.0);
        vec3 smoothLit = tubeLight(atPanel, panelN, -uFixGap, tubeZ, halfLen, tubeRlit, uLampA, flkA * uHealthA, litReach(uHealthA))
                       + tubeLight(atPanel, panelN,  uFixGap, tubeZ, halfLen, tubeRlit, uLampB, flkB * uHealthB, litReach(uHealthB));

        if (uDiffuse > 0.001) {
          // An opal cover glows, it doesn't average: the irradiance stays brightest near the lamps and dims
          // toward the corners. Computed by inflating the tube radius as DIFFUSER rises — tubeLight's own wrap
          // term does the rest, spreading and brightening together the way a real cover does. Inflation is
          // capped below the tube spacing: past the gap the two pools merge and swamp the whole panel flat.
          // The bar itself (axisDist, smoothstepped) carries the panel's shape rather than only the inflated
          // glow, so the lamp's length and lean under TILT survive being hidden; smoothLit is the ambient fill
          // around it. Two stages, in order — hide first blurs the bar past legibility, spread then widens
          // further and floods the panel — because a real cover hides the lamp before it reads as one lit
          // surface; the gap between the two smoothsteps is the real plateau where a cover looks like two
          // soft, still-separate glows.
          float dAmt   = clamp(uDiffuse, 0.0, 1.0);
          float hide   = smoothstep(0.0,  0.35, dAmt);
          float spread = smoothstep(0.55, 1.0,  dAmt);
          float dblur  = tubeRlit * (0.35 + 8.0 * hide + 5.0 * spread);
          float dEdge0 = max(tubeRlit - dblur * 0.35, 0.0);
          float dEdge1 = tubeRlit + dblur;
          float barA = 1.0 - smoothstep(dEdge0, dEdge1, axisDist(rol, rdl, -uFixGap, tubeZ, halfLen));
          float barB = 1.0 - smoothstep(dEdge0, dEdge1, axisDist(rol, rdl,  uFixGap, tubeZ, halfLen));
          vec3 panelLit = (uLampA * flkA * uHealthA * barA
                         + uLampB * flkB * uHealthB * barB) * (2.0 + 0.9 * hide)
                        + smoothLit * (0.30 + 1.5 * spread);
          room = mix(room, panelLit, hide);
        }

        // The molding seam where facets meet, as a narrow defined line — a soft center-to-edge gradient reads
        // as a dirty panel, not a molded one. Weighted equally on both axes, correct for a square-celled panel
        // (a ridged one would weight one axis over the other).
        if (uPrism > 0.001) {
          float pn   = max(uPrismN, 2.0);
          vec2  g    = abs(fract(atOpen.xy / max(boxHi.x, 1e-4) * pn * 0.5) - 0.5) * 2.0;
          float line = max(g.x, g.y);                        // 0 at a cell's apex, 1 at its wall
          float wall = smoothstep(0.72, 1.0, line);
          float apex = 1.0 - smoothstep(0.0, 0.30, line);
          room *= 1.0 + (apex * 0.20 - wall * 0.58) * clamp(uPrism, 0.0, 1.0);
        }
        room *= apCov;   // applied once at the end, so it feathers everything the opening contains
      }
    }

    // Four rails crossing at the corners, not a closed trim ring — each overshoots by railOv and fades over
    // railFd, so members visibly cross instead of forming a frame. One number drives it all: thickness t
    // (uRailW), overhang 4t, fade 6t. 6t is the one proportion not taken from the reference: at 2t the fade is
    // under 3% of the rail's length and reads as a hard end; 6t spans the whole overhang and reads as fading.
    vec2  railD = abs(atOpen.xy);
    float railT = uRailW;
    if (uFixture > 0.001 && railT > 1e-4 && facing) {
      float railOv = railT * 4.0;                       // overhang past the corner
      float railFd = railT * 6.0;                       // fade length at each tip
      // Antialiased with rWx/rWy (the aperture edge's own screen-derivative widths) since a thin, near-
      // horizontal rail edge staircases worse than anything else in the fitting.
      float bandH = smoothstep(boxHi.y - rWy, boxHi.y + rWy, railD.y)
                  * (1.0 - smoothstep(boxHi.y + railT - rWy, boxHi.y + railT + rWy, railD.y));
      float bandV = smoothstep(boxHi.x - rWx, boxHi.x + rWx, railD.x)
                  * (1.0 - smoothstep(boxHi.x + railT - rWx, boxHi.x + railT + rWx, railD.x));
      float aH = bandH * clamp((boxHi.x + railOv - railD.x) / railFd, 0.0, 1.0);
      float aV = bandV * clamp((boxHi.y + railOv - railD.y) / railFd, 0.0, 1.0);
      float railA = max(aH, aV);
      if (railA > 0.0) {
        vec3 rp = vec3(atOpen.xy, 0.0);
        vec3 rn = vec3(0.0, 0.0, 1.0);
        vec3 rlit = tubeLight(rp, rn, -uFixGap, tubeZ, halfLen, tubeRlit, uLampA, flkA * uHealthA, litReach(uHealthA))
                  + tubeLight(rp, rn,  uFixGap, tubeZ, halfLen, tubeRlit, uLampB, flkB * uHealthB, litReach(uHealthB));
        // Lab's rgba(224,212,185) sRGB converted to linear, used as an albedo rather than a raw result.
        vec3 railCol = vec3(0.745, 0.658, 0.484);
        // tubeLight can't see this light: a rail faces the room while the tubes sit behind the opening plane,
        // so dot(n,d) goes negative and tubeLight returns almost nothing — the real light on a ceiling rail is
        // the fitting's own output bouncing back off the ceiling, which no ray here traces. Supplied directly
        // from lamp output instead, mostly as level (spillLum) with only 28% color (drive), since the albedo
        // is already warm and driving fully by lamp color would double-warm it into tan, not painted metal.
        vec3  spill    = (uLampA * flkA * uHealthA + uLampB * flkB * uHealthB) * 0.5;
        float spillLum = dot(spill, vec3(0.2126, 0.7152, 0.0722));
        vec3  drive    = mix(vec3(spillLum), spill, 0.72);
        // RAIL FADE is warped through the tone curve, not mixed straight across the radiances: measured,
        // mixing the (bright, x2.7) rails linearly and tone-mapping after front-loaded the range — 10% showed
        // 39% of the rails' full presence, 50% showed 82%. Both ends go through the display curve
        // D(x)=(x/(1+x))^(1/2.2) first, mix there, then invert back to radiance. The 0.69 exponent is fitted,
        // not exact — this trace can't see the second tone map the main pass applies afterward, so a
        // perceptually-linear fade in isolation over-corrects for the composite; 0.69 solves pow(0.5,g) for
        // the 50% reading measured with that second pass in place.
        vec3  railT = railCol * (0.10 * lampAmb + rlit * 2.0 + drive * 1.6) * 2.7;
        float railF = clamp(railA * pow(clamp(uRailVis, 0.0, 1.0), 0.69), 0.0, 1.0);
        if (railF > 0.001) {
          vec3 dA = pow(room  / (1.0 + room),  vec3(1.0/2.2));
          vec3 dB = pow(railT / (1.0 + railT), vec3(1.0/2.2));
          vec3 dM = pow(clamp(mix(dA, dB, railF), 0.0, 0.9995), vec3(2.2));
          room = dM / max(1.0 - dM, vec3(1e-4));
        }
      }
    }
  return room;
}`;
