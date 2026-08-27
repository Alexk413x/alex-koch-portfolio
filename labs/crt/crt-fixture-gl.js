/* crt-fixture-gl.js — the light fitting, as GLSL.
 *
 * ONE COPY, TWO PROGRAMS. The fixture is traced into its own target so its blur can be mip-prefiltered, and the
 * main pass samples that target, so both programs have to contain the same geometry and shading. Two copies must
 * be edited in step by hand, and the failure that invites is silent: a reflection that disagrees with its own
 * glow, no error, nothing to grep for.
 *
 * IT IS A STRING, NOT A MODULE OF FUNCTIONS, because GLSL has no include; crt-gl composes it into both programs.
 * What belongs here is anything the FITTING is — its geometry, its materials, how a tube's coating fails along
 * its length. What does not is anything about the TUBE'S PICTURE, which stays in crt-gl.
 */

/* THE UNIFORMS THE FITTING READS — declared here, once, and included by every program that uses it. Two lists
 * describing one interface is the cost worth avoiding; that the compiler drops whatever is unused says nothing
 * about it.
 *
 * These are exactly the names FIXTURE_GLSL references, derived from it rather than curated by hand. */
export const FIXTURE_UNIFORMS = `uniform float uBoxVis, uCapLen, uDiffuse, uFixDist, uFixGap, uFixLens, uFixture, uFlkA, uFlkB, uFrost, uGlowA, uGlowB, uHealthA, uHealthB, uMatte, uPrism, uPrismK, uPrismN, uRailVis, uRailW, uTubeDead;
uniform vec3 uLampA, uLampB;`;

export const FIXTURE_GLSL = `float hitTube(vec3 ro, vec3 rd, float y0, float z0, float hl, float r, float capL) {
  float best = -1.0;
  float bodyHL = max(hl - capL, 0.0);          // where the glass stops and the metal starts
  float rc     = r;                            // FLUSH: the cap is the same diameter as the glass

  vec2 o = vec2(ro.y - y0, ro.z - z0), d = vec2(rd.y, rd.z);
  float a = dot(d, d);
  if (a > 1e-9) {
    // THE GLASS BARREL, ending where the sleeves begin
    float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - a * c;
    if (h >= 0.0) {
      h = sqrt(h);
      for (int k = 0; k < 2; k++) {
        float t = (k == 0 ? (-b - h) : (-b + h)) / a;
        if (t > 0.0 && abs(ro.x + rd.x * t) <= bodyHL && (best < 0.0 || t < best)) best = t;
      }
    }
    // THE TWO SLEEVES, wider, over the last capL of each end
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

  // AND THE DISC THAT CLOSES EACH SLEEVE, at the sleeve's own radius
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

// Ray vs an axis-aligned box, from INSIDE: the far intersection is the wall the ray lands on.
// Returns t, and writes the surface normal of the face that was hit.
float hitBoxInside(vec3 ro, vec3 rd, vec3 lo, vec3 hi, out vec3 n) {
  // GLSL has no vector <; the componentwise form is lessThan/mix. Guarding each axis against a zero
  // divide matters here because a ray exactly parallel to a face is the common case, not a rare one.
  vec3 safe = mix(rd, vec3(1e-7), vec3(lessThan(abs(rd), vec3(1e-7))));
  vec3 inv = 1.0 / safe;
  vec3 t1 = (lo - ro) * inv, t2 = (hi - ro) * inv;
  vec3 tf = max(t1, t2);
  float t = min(min(tf.x, tf.y), tf.z);
  n = -sign(rd) * vec3(t == tf.x ? 1.0 : 0.0, t == tf.y ? 1.0 : 0.0, t == tf.z ? 1.0 : 0.0);
  return t;
}

/* THE EMISSION A CYLINDER THROWS AT A POINT, integrated crudely but with the right FALLOFF SHAPE. A tube is a
 * line source, not a point: its irradiance falls off with 1/d rather than 1/d^2 near the axis, which is why a
 * fluorescent lights a wall so evenly along its length and why substituting a point light looks wrong. This is
 * the term that makes the flicker do something -- when a tube dips, the box it sits in dims with it. */
/* WHERE A DYING TUBE'S LIGHT ACTUALLY COMES FROM, which is not the whole tube. reach is tubeHealth's own: how
 * far in from each end the discharge still runs. At 0.5 the two lit zones meet and the lamp emits along its full
 * length, which is the healthy case. Below that the middle is dead glass — drawn dark by tubeSurface, and it must
 * not go on throwing light either.
 *
 * So the nearest-point clamp excludes the dead stretch: a surface opposite the middle of a half-dead lamp is lit
 * from the nearest LIVE end, at that end's distance and direction. The flux carries the overall dimming; this
 * only says where it leaves from. */
float litReach(float h) { return clamp((clamp(h, 0.0, 1.0) - 0.2) * 0.9, 0.08, 0.5); }

vec3 tubeLight(vec3 pos, vec3 nrm, float y0, float z0, float halfLen, float r, vec3 col, float flux, float reach) {
  float xin = halfLen * max(1.0 - 2.0 * reach, 0.0);        // inner edge of the still-lit zone
  float sx  = pos.x >= 0.0 ? 1.0 : -1.0;                    // sign(), but never zero
  vec3 c = vec3(sx * clamp(abs(pos.x), xin, halfLen), y0, z0);   // nearest LIT point on the tube's axis
  vec3 d = c - pos;
  float dist = max(length(d), r);

  /* THE TUBE HAS A THICKNESS AND THE LIGHT HAS TO KNOW ABOUT IT. Used only as a floor on the distance, the radius
   * is read by nothing that can show it — which is why FROST and TUBE DIA would measure byte-identical.
   *
   * A source with real width WRAPS: it lights surfaces turned partly away from it, because part of it is still
   * above their horizon. How much depends on how large it looks from here — r over the distance — so that ratio
   * is the wrap term, and it falls out of the geometry rather than being a knob. A frosted sleeve then does the
   * one thing a frosted sleeve does: it makes the source bigger, so the shading softens. */
  float wrap = clamp(r / max(dist, 1e-4), 0.0, 1.0);
  float lam  = max((dot(nrm, d / dist) + wrap) / (1.0 + wrap), 0.0);
  return col * flux * lam / (0.35 + dist * 2.2);
}

/* SURFACE SHADING FOR THE TUBE ITSELF. Now that it is a cylinder there is a real normal, so the specular band
 * runs round the curve as the tilt changes instead of sitting where a 2D gaussian was told to put it. The
 * cathode sag stays -- it is a property of the coating, not of the geometry. */
/* HOW NEAR THIS RAY CAME TO A LAMP — the closest approach between the ray and the tube's axis segment.
 *
 * This is what makes the halo THREE-DIMENSIONAL rather than a blur. A screen-space glow cannot foreshorten,
 * cannot lean when the fitting tilts, and sits at the same width along a tube running away from you as one lying
 * across your view. Measured in the FITTING's own space the halo is thin where the tube is far, fat where it is
 * near, and elliptical when it leans.
 *
 * Standard closest-approach between two lines, with the axis parameter clamped to the segment so the glow stops
 * at the tube's ends, and the ray parameter clamped at zero so nothing behind the eye contributes. rd and the
 * axis are both unit vectors, which is why the determinant is just 1 - b². */
/* THE AXIAL COORDINATE COMES BACK OUT NOW, and it was being computed and thrown away.
 *
 * tc is already where along the tube the closest approach lands -- the function needs it to measure the distance
 * at all. Returning it as well is free, and it is the only way anything outside the tube's SURFACE can ask what
 * condition the lamp is in at that point. Normalized to 0..1 end to end. */
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
float axisDist(vec3 ro, vec3 rd, float ax, float az, float hl) {
  float ig; return axisDist(ro, rd, ax, az, hl, ig);
}

/* HOW ALIVE THE COATING IS AT ONE POINT ALONG A TUBE -- crt-fixture's tubeHealth curve, transcribed once.
 *
 * t01 runs 0..1 end to end; the answer is 0 for spent coating and 1 for fully lit. This existed already, inline
 * inside tubeSurface, which was fine while the tube's BODY was the only thing that cared. It is a function now
 * because the halo has to ask the same question: a burned-out middle throws no light, so it can carry no glow,
 * and the alternative was a second copy of the same five constants free to drift from the first. Same reason
 * crt/README gives for keeping the geometry in one place. */
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

vec3 tubeSurface(vec3 pos, vec3 nrm, vec3 rd, float halfLen, float health, float flk, vec3 col, float seed) {
  float axial = clamp(abs(pos.x) / max(halfLen, 1e-4), 0.0, 1.0);
  /* HOW FAR THIS POINT IS FROM THE TUBE'S END, AS A FRACTION OF ITS HALF-LENGTH — and the fraction is the point.
   *
   * Compared as lengths, the two sides are not in the same space: pos.x carries the aspect factor and halfLen does
   * not, so a cap length barely moves across its whole range. Both sides are made DIMENSIONLESS instead — distance
   * from the end over the half-length, against the cap over the half-length — so there are no units left to
   * disagree about.
   *
   * It is still a fixed physical size: the caller divides the cap's millimeters by the tube's own, so a 25mm cap
   * stays 25mm of real part however long the lamp is. */
  float fromEnd = 1.0 - axial;
  float face    = max(dot(nrm, -rd), 0.0);

  /* HEALTH IS crt-fixture's CURVE, PORTED — not a model of my own that happens to look similar. The states are meant
   * to MATCH the lab, so the arithmetic is transcribed from tubeHealth() and the breakpoints below are its numbers.
   *
   * The lab paints the tube as a horizontal gradient with five stops per half, built from three colors whose mix
   * ratios are functions of health. Everything here is linear-light emission rather than sRGB fill, so what is
   * transcribed is the VITALITY at each stop — how lit that part of the tube is — and the emission is mixed
   * between the dead coating and the live phosphor by it.
   *
   *   endVital  the ENDS go charred -> lit across 18%..30%. Above 30% they are simply lamp-colored, which is why
   *             a half-dead tube still has two bright tips.
   *   conn      the MIDDLE. Dead below 40%; climbs to only HALF-lit by 90%; completes over the last tenth. This
   *             single line is most of what makes a tube look tired well before it looks broken.
   *   reach     how far the end glow reaches inward, 8%..50% of the length, growing from about 20% health.
   *
   * The lab's midCol is the average of frontCol and centerCol and sits halfway between their two stops, so those
   * three stops are a straight line from front to center — collapsed here into one mix. */
  float h        = clamp(health, 0.0, 1.0);
  float endVital = clamp((h - 0.18) / 0.12, 0.0, 1.0);
  float conn     = h < 0.4 ? 0.0
                 : (h < 0.9 ? (h - 0.4) / 0.5 * 0.5
                            : 0.5 + (h - 0.9) / 0.1 * 0.5);
  /* frontCol is mix(mix(endCol, gapCol, 0.65), lamp, conn) -- a mostly-dead base lifted by the middle's own
   * vitality, which is what makes the end glow fade INTO the middle instead of stopping against it. */
  float vFront   = 0.35 * endVital * (1.0 - conn) + conn;
  float reach    = clamp((h - 0.2) * 0.9, 0.08, 0.5);
  float p1       = reach * 0.45;
  float p2       = reach;
  float p3       = min(0.5, reach + 0.18);

  float t01      = clamp(pos.x / max(halfLen, 1e-4) * 0.5 + 0.5, 0.0, 1.0);
  // THE SHARED CURVE, not a second copy of it -- see tubeVit. The halo asks the same question of the same
  // function, so the tube's body and the glow it throws cannot disagree about which parts of it are dead.
  float vit      = tubeVit(t01, health);
  /* CHARRED AND SMOKY BELOW A QUARTER. The lab lays a #221b17 multiply over the whole tube at this opacity --
   * the soot that makes a spent lamp look burned rather than merely unlit. */
  float tchar    = clamp((0.25 - h) / 0.25, 0.0, 1.0) * 0.92;
  float dead     = 1.0 - vit;
  /* THE SLEEVE IS METAL ALL THE WAY. Fading the material in across the whole cap makes sense while the cap is a
   * shading effect on a single cylinder — a soft blend into the glass — and stops making sense the moment the
   * sleeve becomes its own geometry at its own radius: the ramp then runs across a part that is physically
   * uniform, and the sleeve's INNER half renders as bright glass at the wider radius, a bulge of lamp sticking
   * out past the tube.
   *
   * The geometry says where the sleeve is, so the material follows it exactly — full metal from the shoulder out,
   * with only enough softness on the boundary to keep it from aliasing. */
  float caps  = 1.0 - smoothstep(max(uCapLen, 1e-5) * 0.94, max(uCapLen, 1e-5), fromEnd);
  float fres  = pow(1.0 - face, 3.0);                           // the envelope brightens at grazing angles
  // FROST TAKES THE GLINT OFF: a scattering sleeve is Lambertian, so the grazing-angle brightening that
  // makes bare glass read as glass has to go away as the frost comes up.
  /* A LAMP OUTGUNS EVERYTHING IT LIGHTS, and this had no headroom to do that with.
   *
   * Without the gain the tubes peaked at 189 while the RAILS reached 212 -- the source rendering dimmer than the
   * painted metal it illuminates, which is why they read as tired even at full LIGHT. An emitter has to sit well
   * above 1 in linear light so the tone map compresses its core toward white and leaves the surfaces around it
   * on the straight part of the curve; that separation IS what makes something look like a light rather than a
   * bright object. */
  vec3 emit = col * flk * (0.75 + 0.85 * fres * (1.0 - uFrost)) * 3.4;

  /* TUBE TEXTURE IS GONE, deliberately, and this note is here so it is not reinvented as an improvement.
   *
   * It was three things riding on one control: coating GRAIN from a hash, discharge STRIATION from a sine along
   * the bore, and CATHODE hot-spots just inside each end. All defensible on a real lamp, and all of it noise at
   * the size this fitting is ever drawn -- a reflection a few hundred pixels across, usually behind MATTE or a
   * diffuser. The lamp reads as a lamp from its shape and its ends; the grain only ever fought the burnout
   * pattern, which is the detail along the tube that carries actual information. */

  /* WHAT A SPENT SECTION LOOKS LIKE: AN OUTLINE, NOT A HOLE.
   *
   * Two parts. The dead coating is a dark warm solid — crt-fixture calls its equivalent char and notes it must
   * stay visible rather than vanishing — so the tube stays a solid object in front of the housing rather than a
   * tube-shaped gap, which reads as a rendering fault.
   *
   * Over it sits the OUTLINE: fres is brightest exactly at the silhouette and nothing face-on, so a spent tube
   * reads as a dark body with its rim still catching the fitting's light. It does not depend on health, so at
   * zero the outline is the whole of what is left. */
  /* THE TWO DEAD COLORS ARE THE LAB'S OWN, converted. char is rgb(46,38,33) and gapDark is rgb(38,31,27) --
   * it calls them "charred solid" and "dead coating" and notes both must stay "visible under screen blend, not
   * vanishing", which is the same requirement here for the same reason: a tube that goes to nothing punches a
   * hole in the fitting. gapCol crossfades between them from 15% health, exactly as the lab does. */
  vec3 charLin = vec3(0.0273, 0.0194, 0.0152);
  vec3 gapLin  = vec3(0.0194, 0.0137, 0.0110);
  vec3 gapCol  = mix(charLin, gapLin, clamp((h - 0.15) * 1.6, 0.0, 1.0));
  /* THE AMBIENT FLOOR IS THE FITTING'S OWN, so it goes out when the fitting does. The floor exists on purpose — a
   * tube that goes to nothing punches a tube-shaped HOLE in the housing behind it — but that argument assumes
   * there is a housing to see the hole against. In a blackout there is not, and a bare constant here is the last
   * thing in the fitting still lit by a light that does not exist.
   *
   * Scaled by the pair's own output rather than by this tube's, deliberately: a dead lamp beside a live one IS lit
   * — by its neighbor, off the inside of the housing — so it keeps its body and only loses it when the whole
   * fitting goes. That is the case the floor was written to protect. */
  float ambT = clamp(max(uFlkA * uHealthA, uFlkB * uHealthB), 0.0, 1.0);
  /* DEAD COATING IS A CONTROL. At a fixed strength a spent section reads as mid gray, and a fluorescent whose
   * center has given up does not read as half lit — it reads as a dark bar with two glowing ends, and that
   * contrast IS the effect.
   *
   * So the floor stays available and stops being compulsory. At 1 this is exactly what it was; at 0 a dead section
   * is black and the tube becomes two lit ends floating in the fitting. The hole-in-the-housing problem is real
   * only when there is a housing behind it to see, which is BOX's business, and BOX is a control too. */
  vec3 coat = gapCol * (0.30 + 0.70 * face) * (0.28 * ambT + 0.72 * flk) * uTubeDead;
  /* The outline the lab gets from two permanent inset highlights down the tube's long edges -- the thing that
   * still says "glass cylinder" once the phosphor inside is dead. */
  // The outline goes with it: it is the dead section's own glass catching light, so it cannot outlive the body.
  vec3 rim  = col * pow(fres, 0.8) * flk * 0.85 * uTubeDead;
  emit = mix(emit, coat + rim, dead);
  emit *= mix(1.0, 0.34, tchar);

/* THE END CAP IS A METAL FERRULE, and it has to READ as a cylinder.
   *
   * Shading it with a rim term is backwards for a solid: pow(1 - dot(n,-v)) is BRIGHTEST at the silhouette, so the
   * cap lights up around its outline and goes dark through the middle — that is how you shade a glowing shell, and
   * it flattens a cylinder into a ring.
   *
   * A metal band lit from in front is the other way round: brightest where it faces you, falling away toward the
   * edges. So the body term is the facing cosine, with a TIGHT specular on top rather than a wash — aluminum has
   * a hard highlight.
   *
   * FAINTLY GREEN, because that is what the cap on a fluorescent tube looks like: anodised aluminum with a slight
   * cast, against warm-white glass. Neutral gray beside 5000K glass just reads as more glass, dimmed.
   *
   * Scaled by flk so it goes dark with its own tube: a cap is lit BY the lamp it is fitted to. */
/* NEARLY FLAT. The sleeve is a real cylinder standing proud of the glass, so its ROUNDNESS is carried by its
   * silhouette and does not need spelling out again in the shading. A strong facing gradient PLUS a hard specular
   * on a part that is already visibly round reads as a bulging bead, and the color swings so far across it that
   * it stops looking like one material.
   *
   * A painted end cap is close to matte anyway: a shallow lift toward the eye, enough that it is not a flat
   * sticker, and no highlight. The hue holds steady across the whole part. */
  vec3  capCol = vec3(0.27, 0.34, 0.28);          // anodised, with the green cast the real part has
  vec3  metal  = capCol * (0.82 + 0.18 * face) * flk;
  return mix(emit, metal, caps);
}


/* THE FIXTURE'S WHOLE REFLECTION, AS A FUNCTION OF ONE RAY — so it can be sampled more than once. Inline it is
 * exactly one trace per pixel and therefore no way to blur it: a rough surface reflects an AVERAGE of many
 * directions, and one sample of a distribution is a coin flip, not a mean.
 *
 * Everything the trace needs arrives as an argument, so MATTE can call it around a small ring and average the
 * results. With MATTE off it is called once with the same ray, and the branch is uniform, so the extra taps cost
 * nothing when they are not wanted. */
vec3 traceFixture(vec2 sp2, float ct, float st, vec3 boxLo, vec3 boxHi,
                  float halfLen, float tubeR, float tubeRlit, float tubeZ,
                  float flkA, float flkB) {
  /* THE FITTING'S OWN AMBIENT, AND IT HAS TO COME FROM THE LAMPS. The constants on the housing's inner wall and its
   * rails exist so the fitting reads as a molded object with form rather than a silhouette. A bare number there
   * is a claim that there is some OTHER light in the room, and there is not — this fitting is the only source in
   * the scene, so with both lamps dead the housing and rails go on quietly showing themselves in the glass.
   *
   * What that light physically IS, is the lamps bouncing around inside the housing. So it scales with them, and at
   * any normal output it saturates and nothing about a working fitting changes. */
  float lampAmb = clamp(max(flkA * uHealthA, flkB * uHealthB), 0.0, 1.0);
  vec3 ro  = vec3(0.0, 0.0, 0.0);
  vec3 rd  = normalize(vec3(sp2, -uFixLens));
  mat3 rot = mat3(1.0, 0.0, 0.0, 0.0, ct, -st, 0.0, st, ct);
  vec3 rol = rot * (ro - vec3(0.0, 0.0, -max(uFixDist, 0.05) * uFixLens));
  vec3 rdl = rot * rd;
    /* WHERE THIS PIXEL'S RAY CROSSES THE APERTURE, computed once and read by three things: the fixture's own
     * visibility test, the prism's flutes, and the scatter halo further down. It is the ray AFTER the tilt
     * rotation and with the perspective divergence already in it, so anything measured against it is in the
     * FIXTURE's frame rather than the screen's. */
    float tOpen  = rdl.z != 0.0 ? -rol.z / rdl.z : -1.0;
    vec3  atOpen = rol + rdl * tOpen;
    bool  facing = tOpen > 0.0;

    /* PIXEL FOOTPRINTS, TAKEN HERE AND NOWHERE ELSE, because every silhouette below is a boolean. The fitting is built
     * from hit tests, and one sample per pixel of a step function is an aliased edge by construction — a one-pixel
     * step on a shallow diagonal is a staircase, and at a render scale below 1 each tread is wider still.
     *
     * The fix is analytic coverage: rather than asking whether this pixel's CENTER is inside, ask how much of the
     * pixel is, using the edge function's own screen-space derivative as the pixel's width.
     *
     * THEY MUST BE COMPUTED BEFORE ANY BRANCH ON facing. fwidth() is undefined inside non-uniform control flow —
     * neighboring fragments in a quad have to be on the same instruction for a derivative to mean anything — so
     * they sit up here where every fragment reaches them, and the branches below only READ them. */
    /* ONE fwidth, ON A vec2, FOR ALL THREE EDGES, and that is not tidiness: because they have to be computed before
     * the branch, every fragment on the screen pays for each one whether or not it is anywhere near the fitting.
     * A derivative also forces the quad to stay in lockstep and costs the compiler scheduling freedom, so three of
     * them on every pixel is worse than the instruction count suggests.
     *
     * They collapse into one: the rails need d|x| and d|y|, which is a single vec2 derivative. */
    vec2  aOa   = abs(atOpen.xy);
    vec2  rW    = max(fwidth(aOa), vec2(1e-6));
    float apD   = max(aOa.x - boxHi.x, aOa.y - boxHi.y);     // <0 inside the opening, >0 outside
    float apW   = max(rW.x, rW.y);
    float apCov = 1.0 - smoothstep(-apW, apW, apD);
    float rWy   = rW.y;
    float rWx   = rW.x;
    vec3  room   = vec3(0.0);

    /* THE PANEL BENDS THE RAY, WHICH IS WHAT MAKES IT A PRISM. A prismatic cover does not shade the lamps, it
     * REFRACTS them: each facet deflects what passes through it, so every cell carries its own displaced copy of
     * the tubes. Bending the ray at the aperture and THEN tracing means those copies are real intersections with
     * the real cylinders, so they move correctly when the fitting tilts or the lamps move.
     *
     * FLAT FACETS, NOT A LENS at this level: sign() gives each quadrant of a cell a constant slope pointing away
     * from its center — a four-sided pyramid, which is how the common panel is molded. fract() keys it to the
     * cell, so the facets stay with the fitting rather than sliding across it.
     *
     * Applied to rdl ONLY. atOpen keeps the true ray, so the panel refracts what is behind it without moving
     * where the panel itself is. */
    /* EACH CELL IS A LENS, SO THE DEFLECTION IS PROPORTIONAL — the difference between this and a grid of slightly
     * offset copies. A binary deflection translates each half-cell sideways and does nothing else: no cell forms
     * an image, so there is nothing for the grid to be a grid OF.
     *
     * A prismatic lens panel is a molded array of little pyramids, and within one cell the facet's slope grows
     * steadily from the apex out to the wall, so a ray is bent in proportion to how far off that cell's axis it
     * enters. Each cell then forms its own small image of the lamps behind it. pf already runs -0.5..0.5 across
     * the cell, so it IS that proportion. */
    if (uPrism > 0.001 && facing) {
      float pn = max(uPrismN, 2.0);
      vec2  pf = fract(atOpen.xy / max(boxHi.x, 1e-4) * pn * 0.5) - 0.5;
      /* THE ANGLE IS SMALL, AND THAT IS THE MEASURED ANSWER RATHER THAN THE OBVIOUS ONE. The lamps sit only a few
       * centimeters behind the panel, so the intuition is that the bend has to be large. It does not: structure
       * peaks at a small angle and falls off a cliff after it, because past that the refraction is not breaking
       * the lamp into cells, it is steering the samples off the lamp altogether — the cells look at dark housing,
       * and a grid of uniformly dark cells has no structure in it.
       *
       * The GRID is the molding, drawn by the seam term below; refraction's job is only to modulate what each
       * cell shows, and a little of it does far more than a lot. */
      /* AND IT SCALES WITH THE CELL, or the control below stops meaning anything. A fixed facet angle sounds right —
       * molded acrylic has the slope it has, whatever the pitch — but the displacement it produces over the gap
       * is then fixed too, while the cells get smaller. Past a certain fineness every sample lands in some OTHER
       * cell's territory and the per-cell image is gone.
       *
       * Dividing by the pitch keeps the displacement to about a constant fraction of a cell, so a fine panel and
       * a coarse one both read as panels. */
      rdl = normalize(rdl + vec3(pf * uPrism * uPrismK * (18.0 / pn), 0.0));
    }


    if (uFixture > 0.001) {
      float capLen = uCapLen * halfLen;                 // CAP LENGTH is a fraction of the lamp's half-length
      float tA = hitTube(rol, rdl, -uFixGap, tubeZ, halfLen, tubeR, capLen);
      float tB = hitTube(rol, rdl,  uFixGap, tubeZ, halfLen, tubeR, capLen);
      vec3  nW; float tW = hitBoxInside(rol, rdl, boxLo, boxHi, nW);

      // Nearest hit wins. The tubes are inside the box, so they occlude its walls exactly as they should.
      float tHit = tW; int mat = 0;
      if (tA > 0.0 && tA < tHit) { tHit = tA; mat = 1; }
      if (tB > 0.0 && tB < tHit) { tHit = tB; mat = 2; }

      /* CLIPPED BY THE OPENING, AT THE OPENING PLANE. Testing the HIT point against the box was wrong: every ray
       * eventually strikes some wall of an enclosing box, so the fixture painted itself across the whole glass. What
       * bounds it is the aperture -- where the ray crosses z = 0 -- exactly as a real recess is bounded by its own
       * mouth. Miss the mouth and you are looking at the bezel, not into the housing. */
      // The coverage IS the test now: a pixel the opening partly covers is drawn, then weighted by how much.
      bool insideOpening = facing && apCov > 0.001;
      vec3 pos = rol + rdl * tHit;

      if (insideOpening) {
        if (mat == 0) {
          /* THE BOX INTERIOR, LIT BY THE TUBES. This is the part the 2D version could not have: the walls are a
           * surface, so the light the tubes throw on them rises and falls with the flicker. A guttering fluorescent
           * dims its whole housing, which is most of what the effect reads as. */
          vec3 wall = vec3(0.030, 0.029, 0.026);
          vec3 lit  = tubeLight(pos, nW, -uFixGap, tubeZ, halfLen, tubeRlit, uLampA, flkA * uHealthA, litReach(uHealthA))
                    + tubeLight(pos, nW,  uFixGap, tubeZ, halfLen, tubeRlit, uLampB, flkB * uHealthB, litReach(uHealthB));
          /* uBoxVis is the reference's --bgvis: the housing's own visibility, separate from everything standing
           * in front of it. Fading it leaves the lamps and the rails hanging in the dark, which is the whole
           * point of having it apart from the lamp controls. */
          room = wall * (0.25 * lampAmb + lit * 3.2) * uBoxVis;
        } else {
          /* TWO SURFACES, TWO NORMALS. The barrel's points outward from the axis; the flat end's points along
           * it. A capsule could use one expression for both because everything on it was curved -- a closed
           * cylinder cannot, and using the radial one on the end disc is what would round it off again. */
          float ax = mat == 1 ? -uFixGap : uFixGap;
          vec3  nrm = abs(pos.x) >= halfLen - 1e-4
                    ? vec3(sign(pos.x), 0.0, 0.0)
                    : normalize(vec3(0.0, pos.y - ax, pos.z - tubeZ));
          room = tubeSurface(pos, nrm, rdl, halfLen,
                             mat == 1 ? uHealthA : uHealthB,
                             mat == 1 ? flkA    : flkB, mat == 1 ? uLampA : uLampB, float(mat));
        }

        /* THE HALO — the tube's edge going soft, in three dimensions. A bright fluorescent does not end at its glass:
         * light scatters in the envelope, in the air and in the eye, so the boundary is a gradient whose width
         * grows with how hard the lamp is driven. See axisDist for why this is measured in the fitting's space
         * rather than the screen's.
         *
         * EXPONENTIAL, not a smoothstep, because a glow has no edge — a smoothstep puts a second, softer
         * silhouette around the first, which is what makes painted glows look painted. The falloff width is in
         * tube radii, so a fatter lamp gets a proportionally fatter halo.
         *
         * Scaled by each lamp's own flux and health, and ADDED: scattered light is light that is already there
         * arriving somewhere else, not a tint over what is behind it. */
        /* IT HAS TO OUTSHINE THE EDGE IT IS HIDING. A halo peaking below the tube's own core leaves the silhouette
         * stepping — a glow dimmer than what it surrounds does not soften an edge, it draws a second one.
         *
         * So the falloff is wide and the amplitude high enough that near the tube BOTH sides of the silhouette
         * run off the top of the tone curve. That is how a real bloom hides a boundary: not by blending it, but
         * by driving everything around it past the point where the display can tell the difference.
         *
         * AND THE DIFFUSER DRIVES IT. A cover's whole job is to stop you resolving the lamps, so it widens the
         * scattering with it — which is what keeps a hard white cylinder from reading straight through the panel
         * at a raking angle. */
        /* ONE PER LAMP. A shared control could only ever say how much the FITTING glows, and the two tubes in a
         * fitting are not interchangeable -- they are already allowed their own level, color temperature,
         * condition and flicker, so a pair where one is scattering hard and the other is not is exactly the kind
         * of mismatch this section exists to describe. The falloff WIDTH is per lamp too, not just the
         * brightness: a hazy tube spreads further as well as glowing harder, and sharing the width would have
         * made the dimmer one look like a crisp lamp behind a wash. */
        float amtA = clamp(uGlowA + uDiffuse * 0.25, 0.0, 1.0);
        float amtB = clamp(uGlowB + uDiffuse * 0.25, 0.0, 1.0);
        if (amtA > 0.001 || amtB > 0.001) {
          float wA = tubeRlit * (0.30 + 7.5 * amtA);
          float wB = tubeRlit * (0.30 + 7.5 * amtB);
          float axA, axB;
          float gA = exp(-max(axisDist(rol, rdl, -uFixGap, tubeZ, halfLen, axA) - tubeRlit, 0.0) / max(wA, 1e-5));
          float gB = exp(-max(axisDist(rol, rdl,  uFixGap, tubeZ, halfLen, axB) - tubeRlit, 0.0) / max(wB, 1e-5));
          /* GATED ON hGlow, the lab's own: clamp((h - 0.2) / 0.55). The broad glow fades in as the tube heals,
           * so a lamp at 20% health throws no halo at all and one at 75% throws its full share. */
          /* AND ON THE COATING WHERE THE GLOW IS ACTUALLY COMING FROM. hGlow is one number for the whole lamp, so a tube
           * whose middle has burned out throws its full halo along its entire length — over its own dead section
           * and over the housing wall behind it. Two visible failures from one cause: a spent middle reads as
           * TRANSPARENT rather than burned, and BOX looks broken because the same saturation buries the wall it
           * fades.
           *
           * Light comes from coating that is still alight. tubeVit answers that at the point the halo is sampled
           * from — the same function the tube's surface uses, so the body and its glow cannot disagree. */
          float hgA = clamp((uHealthA - 0.2) / 0.55, 0.0, 1.0) * tubeVit(axA, uHealthA);
          float hgB = clamp((uHealthB - 0.2) / 0.55, 0.0, 1.0) * tubeVit(axB, uHealthB);
          room += (uLampA * flkA * hgA * gA * amtA + uLampB * flkB * hgB * gB * amtB) * 5.5;
        }

        /* THE OPAL PANEL. A diffuser does not blur the tubes, it REPLACES them: the panel itself becomes the
         * source, glowing at whatever irradiance lands on its back, and the tubes behind it stop being objects
         * you can see. So this is a crossfade to the analytic irradiance at the aperture -- which is already
         * smooth by construction, being an integral over the tube rather than a sample of it -- and not a blur.
         * A blur of two bright bars is two soft bright bars; a diffuser is neither. */
        /* THE APERTURE'S OWN IRRADIANCE, smooth by construction -- it is an integral over the tubes rather than
         * a sample of them. DIFFUSER crossfades toward it; MATTE deliberately does not, being a screen property
         * with no business reaching inside the fitting. */
        vec3 atPanel = vec3(atOpen.xy, 0.0);
        vec3 panelN  = vec3(0.0, 0.0, 1.0);
        vec3 smoothLit = tubeLight(atPanel, panelN, -uFixGap, tubeZ, halfLen, tubeRlit, uLampA, flkA * uHealthA, litReach(uHealthA))
                       + tubeLight(atPanel, panelN,  uFixGap, tubeZ, halfLen, tubeRlit, uLampB, flkB * uHealthB, litReach(uHealthB));
        /* MATTE DOES NOT BELONG IN HERE AT ALL. A crossfade from the traced fitting to the aperture irradiance REPLACES
         * the fitting outright at MATTE 1 with a smooth dim field containing no fixture — which is the whole of
         * the "it disappears at 100%" bug, and why capping the mip chain at any depth produces byte-identical
         * frames: by the time the chain is consulted there is nothing left of the fitting to blur.
         *
         * MATTE is the ROUGHNESS OF THE GLASS. It selects a mip level, and that is all it does: a rough surface
         * scatters a reflection, it does not substitute a different image for it. smoothLit stays because DIFFUSER
         * genuinely is a substitution — an opal cover really does stop you seeing the tubes — but that is a
         * property of the FITTING, and this is a property of the SCREEN. */

        if (uDiffuse > 0.001) {
  /* AN OPAL COVER GLOWS — it does not average. A flat constant is the total flux behind the panel spread evenly,
           * which is uniform and dead. A real cover is brightest where the lamps are behind it and dims toward the
           * corners, because the panel is being LIT from a few centimeters away and the inverse square still
           * applies over that distance.
           *
           * So it is the irradiance again, computed with the source blown up: as DIFFUSER rises the tubes are
           * treated as progressively fatter cylinders. The wrap term in tubeLight does the rest — a wider source
           * wraps further round, so the panel gets smoother AND brighter, which is what a cover does: it hides
           * the lamps by spreading them, and spreading them is not the same as dimming them.
           *
           * The gain rises with it for that reason: a diffuser scatters light forward, it does not eat it. */
          /* THE INFLATION IS BOUNDED BY THE TUBE SPACING. Fattening the source until the tubes stop being objects is right,
           * but past the gap between the lamps the two pools do not merely merge, they swamp the whole aperture —
           * a scan down the fitting's center then varies by a handful of levels out of 255, which is the same gray
           * card this is written to prevent, arrived at from the opposite direction.
           *
           * Kept narrower than the gap, the panel still carries two soft pools where the lamps are and dims
           * between and beyond them. */
          /* WHAT YOU SEE THROUGH A COVER IS THE LAMP'S SHAPE WITH SOFT EDGES — not the lamp, and not a dome.
           *
           * Leaving a fraction of the SHARP traced tube on top reads straight through the panel as a hard white
           * cylinder. Replacing the tubes with an analytic irradiance from an inflated source hides them, but
           * hides the SHAPE too: a slice down the panel becomes a single smooth hump with the two lamps no longer
           * distinguishable. A diffuser is not a lampshade that forgets where the lamps were.
           *
           * So the panel is built from the BAR ITSELF, blurred. axisDist gives the ray's distance to each tube's
           * axis — already clamped to the segment, so the shape ends where the lamp ends — and a smoothstep on
           * that distance is a bar with a soft edge. Widening the smoothstep IS the blur, and its width is what
           * DIFFUSER drives. The bar keeps the tube's length, its lean under TILT and its foreshortening for
           * free, because the distance is measured in the fitting's own space.
           *
           * smoothLit under it is the panel's ambient: a cover glows over its whole area, not only where a lamp is
           * directly behind it. */
          /* TWO STAGES, AND THE ORDER IS THE POINT: HIDE THE LAMP, THEN FLOOD THE PANEL. One linear ramp does both at once,
           * so the control spends its whole range half-hiding a tube that is still legible while also half-lighting
           * a panel that is still patchy. A cover does these in sequence: first you can no longer make out the
           * lamp, and only past that does the panel start reading as one lit surface.
           *
           * hide owns the blur's first and largest jump AND the crossfade; spread is the second half of the
           * widening plus the ambient fill, which pushes the two bars into each other.
           *
           * THE GAP BETWEEN THEM IS DELIBERATE. In the middle neither term moves: each lamp is a soft even glow
           * with no shape left in it, and the two are still plainly two. That plateau is a real state of a real
           * fitting, and with the ramps overlapped the control has nowhere to sit in it. Hidden first, uniform
           * second, merged last. */
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

        /* THE SEAM WHERE THE FACETS MEET — and that is ALL that is left here on purpose. Modulating brightness after the
         * trace can only darken or lighten what is already there, which is a shadow printed on the fitting. The
         * refraction happens where it belongs, at the aperture, before anything is intersected.
         *
         * What a bend cannot produce is the join between two moldings, so that is what this is: a thin darker
         * line on the cell boundary. */
        /* THE MOLDING BETWEEN THE CELLS, as a defined line rather than a wash. A soft gradient from center to gutter
         * reads as a dirty panel, not a molded one. What a real lens panel shows is narrow: the wall where two
         * pyramids meet catches almost nothing and goes distinctly dark, while the apex of each facet points
         * straight at you and picks up a little extra. Everything between is flat.
         *
         * Weighted equally on both axes: stronger across than down is correct for a ridged panel and wrong for a
         * square-celled one, where the two directions are the same molding. */
        if (uPrism > 0.001) {
          float pn   = max(uPrismN, 2.0);
          vec2  g    = abs(fract(atOpen.xy / max(boxHi.x, 1e-4) * pn * 0.5) - 0.5) * 2.0;
          float line = max(g.x, g.y);                        // 0 at a cell's apex, 1 at its wall
          float wall = smoothstep(0.72, 1.0, line);
          float apex = 1.0 - smoothstep(0.0, 0.30, line);
          room *= 1.0 + (apex * 0.20 - wall * 0.58) * clamp(uPrism, 0.0, 1.0);
        }
        // Applied once, at the end, so it feathers everything the opening contains rather than one layer of it.
        room *= apCov;
      }
    }


  /* NO ROOM GRADIENT. A two-color vertical wash standing in for an environment lights the glass everywhere at once
     * regardless of what is actually in front of it, so it only lifts the blacks and flattens the very reflection
     * it is supposed to sit behind.
     *
     * WHAT REPLACES IT IS SCATTER, WHICH IS SHEEN'S REAL JOB. Light entering the faceplate does not all come
     * straight back out: some scatters sideways inside the glass and leaves as a soft halo AROUND whatever put it
     * there. So every reflection gets a glow, its size set by how far the light travels before it escapes, and
     * nothing glows where nothing is being reflected — a property OF the reflection rather than a thing beside it. */
    /* MEASURED AT THE APERTURE, NOT ON THE SCREEN. From the raw screen coordinate the halo is an axis-aligned
     * rectangle sitting around a fitting that reflects as a tilted, foreshortened trapezoid, so turning TILT up
     * leaves the glow square while its own source leans away from it.
     *
     * atOpen is the same ray the fixture is traced with, after the tilt and with the perspective already in it, so
     * a distance from it is a distance in the fixture's frame. A ray pointing away from the aperture plane has no
     * crossing to measure and gets no halo at all. */
    /* THE RAILS: FOUR BARS THAT CROSS AT THE CORNERS, not a closed trim ring. Each rail OVERSHOOTS the corner and
     * fades out, so the members cross rather than meet and the fitting reads as something suspended on rails
     * rather than something with a frame around it.
     *
     * THE PROPORTIONS ARE ONE NUMBER: thickness t, overhang 4t, fade 6t. RAILS sets the thickness and the rest
     * follow, and the crossing is automatic — a bar reaching 4t past the corner necessarily passes over the
     * perpendicular bar, which only occupies t.
     *
     * THE FADE IS THE ONE PROPORTION NOT TAKEN FROM THE REFERENCE. At 2t it is under 3% of the rail's length,
     * which at this scale reads as an end rather than as a fade. 6t runs the taper across the whole overhang and
     * on past the corner, so a rail is fully opaque only where it lies over the fitting.
     *
     * The fade stays LINEAR and runs to zero at the very tip. It is also the whole reason these read as rails and
     * not as a frame: a member that stops dead is a border, and one that dissolves is a part continuing out of
     * the picture. */
    vec2  railD = abs(atOpen.xy);
    float railT = uRailW;
    if (uFixture > 0.001 && railT > 1e-4 && facing) {
      float railOv = railT * 4.0;                       // overhang past the corner
      float railFd = railT * 6.0;                       // fade length at each tip -- see the note above
      /* The rails' long edges get the same treatment. Being thin and near-horizontal they staircase worse than
       * anything else in the fitting -- a shallow edge crossing few pixels per row is the worst case for a
       * boolean test. */
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
        /* THE LAB'S OWN COLOR, CONVERTED. Its rails are rgba(224,212,185) -- a warm bone white -- and that is an
         * sRGB value, while everything here is linear light. Dropping the triple in raw would have made them
         * too bright and too yellow at once. This is that color through the sRGB transfer function, used as an
         * ALBEDO rather than as a result. */
        vec3 railCol = vec3(0.745, 0.658, 0.484);
        /* AND THE LAMPS LIGHT THEM FROM THE FRONT, WHICH tubeLight CANNOT SEE. A rail lies in the plane of the OPENING
         * with its face toward the room and the tubes sit behind that plane, so the direction from a rail to
         * either lamp points backwards, dot(n, d) goes negative, and tubeLight correctly returns almost nothing.
         * That is not wrong lighting, it is the wrong LIGHT: what illuminates a ceiling rail is the fitting's own
         * output coming back off the ceiling around it, and no ray in this scene carries that.
         *
         * So it is supplied directly, from the same lamp-output term the sheen uses. It keeps the lamp COLOR, so
         * TEMP A/B tints the rails and a mismatched pair shows on them, and the level, so they dim with LIGHT and
         * blink with FLICKER. rlit stays in at a lower weight for the grazing light that is genuinely there,
         * which is what makes the near corners read brighter than the far ones. */
        /* MOSTLY THE LEVEL, ONLY A LITTLE OF THE COLOR — because the albedo is ALREADY warm. Driving straight from the
         * lamp's color tints a bone-white rail with a warm light and warms it twice, which reads as tan rather
         * than as painted metal. The rail's albedo is what a pale rail under these lamps already LOOKS like, so
         * most of what the lamps contribute here is intensity.
         *
         * A third of the tint is kept so a mismatched pair still shows on the rails, which is the one thing a pure
         * luminance drive would throw away. Both constants are fitted against the reference, not chosen. */
        vec3  spill    = (uLampA * flkA * uHealthA + uLampB * flkB * uHealthB) * 0.5;
        float spillLum = dot(spill, vec3(0.2126, 0.7152, 0.0722));
        vec3  drive    = mix(vec3(spillLum), spill, 0.72);
        /* RAIL FADE IS MIXED THROUGH THE TONE CURVE, not straight across the radiances underneath it.
         *
         * mix() in linear light is the right way to blend two radiances and the wrong way to spend a control
         * called FADE. The rails are BRIGHT -- lit, driven, and multiplied by 2.7 -- so blending toward them
         * linearly and tone-mapping afterwards front-loads the whole range: measured, RAIL FADE at 10% already
         * showed 39% of the rails' full presence and 50% showed 82%. Nine tenths of what you can see happened
         * in the first half of the slider.
         *
         * So the two ends are pushed through the tone map and the gamma FIRST, blended there, and the result
         * inverted back into the radiance this function returns. That is exact rather than a fitted curve --
         * D(x) = (x/(1+x))^(1/2.2) is invertible, and both ends are known here. Identical at 0 and 1, where the
         * mix is a no-op either way.
         *
         * Guarded on the amount, because the two pow pairs are only worth paying for where a rail is. */
        /* THE CONTROL IS PRE-WARPED, AND THIS ONE IS FITTED RATHER THAN EXACT -- said plainly because the
         * difference matters. FRAME's fade is exact: it happens after the last curve between it and the eye, so
         * there is nothing left to distort it. This is not that. The rails are inside the fitting's trace, whose
         * output is a radiance that gets a SECOND tone map at the end of the main pass along with everything
         * else -- so making this term perceptually linear in isolation over-corrects for the composite, which is
         * exactly what the measurement showed: pure display-space mixing read 9/16/32/70 where linear-light
         * mixing read 39/64/82/92, one side of straight and then the other.
         *
         * An exact answer needs the rest of the frame, which this function cannot see; getting it would mean
         * tracing the fitting twice, once with rails and once without. The exponent is fitted to land between
         * the two measured curves instead. 0.69 solves pow(0.5, g) for the input that reads 50%.
         *
         * WARPING THE CONTROL, NOT THE COVERAGE. railA is the rail's antialiased edge, and bending that would
         * soften the silhouette as the fade moved -- only uRailVis is the thing anyone is dragging. */
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
