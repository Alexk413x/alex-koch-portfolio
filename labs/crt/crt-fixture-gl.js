/* crt/crt-fixture-gl.js — the light fitting, as GLSL.
 *
 * ONE COPY, TWO PROGRAMS. The fixture is traced into its own target so its blur can be mip-prefiltered, and the
 * main pass samples that target -- so both shader programs have to contain the same geometry and shading. They
 * used to carry it as two verbatim copies inside crt-gl.js: ~850 lines each of hitTube, hitBoxInside, litReach,
 * tubeLight, axisDist, tubeVit, tubeSurface and traceFixture. Nothing had drifted when this was extracted (all
 * nine checked function by function, byte-identical) but only because every edit to the fitting had to be made
 * twice by hand. The failure that invites is silent: a reflection that disagrees with its own glow, no error,
 * nothing to grep for. Same two-descriptions-of-one-thing bug crt/README.md exists to prevent, one level up.
 *
 * IT IS A STRING, NOT A MODULE OF FUNCTIONS, because GLSL has no include. crt-gl composes it into both programs.
 * What belongs here is anything the FITTING is: its geometry, its materials, how a tube's coating fails along
 * its length. What does not is anything about the TUBE'S PICTURE -- the raster, the mask, the warp -- which is
 * the screen's business and stays in crt-gl.
 *
 * The uniforms it reads are declared by whichever program includes it. That is the one seam left: crt-gl still
 * declares them twice, and merging those lists is the next thing worth doing here.
 */

/* THE UNIFORMS THE FITTING READS -- declared here, once, and included by every program that uses it.
 *
 * crt-gl used to declare these in both of its shader programs. The comment justifying that said the compiler
 * drops whatever is unused so "the whole list costs nothing and cannot be short" -- true of the generated code,
 * and not the point: the cost is that two lists describe one interface, and the fixture's inputs were spelled
 * out in two places that nothing checked against each other.
 *
 * These are exactly the names FIXTURE_GLSL references, derived from it rather than curated by hand. A program
 * that includes the fitting gets its inputs with it; anything else it declares is its own business.
 */
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
/* WHERE A DYING TUBE'S LIGHT ACTUALLY COMES FROM, which is not the whole tube.
 *
 * reach is tubeHealth's own: how far in from each end the discharge still runs, 8%..50% of the length. At 0.5
 * the two lit zones meet and the lamp emits along its full length, which is the healthy case and identical to
 * what this did before. Below that the middle is dead glass -- it is drawn dark by tubeSurface, and it must not
 * go on throwing light either, or a lamp with a burnt-out centre still lights the housing behind that centre as
 * brightly as its glowing ends do.
 *
 * So the nearest-point clamp excludes the dead stretch: a surface opposite the middle of a half-dead lamp is
 * lit from the nearest LIVE end, at that end's distance and from that end's direction. The flux still carries
 * the overall dimming; this only says where it leaves from. */
float litReach(float h) { return clamp((clamp(h, 0.0, 1.0) - 0.2) * 0.9, 0.08, 0.5); }

vec3 tubeLight(vec3 pos, vec3 nrm, float y0, float z0, float halfLen, float r, vec3 col, float flux, float reach) {
  float xin = halfLen * max(1.0 - 2.0 * reach, 0.0);        // inner edge of the still-lit zone
  float sx  = pos.x >= 0.0 ? 1.0 : -1.0;                    // sign(), but never zero
  vec3 c = vec3(sx * clamp(abs(pos.x), xin, halfLen), y0, z0);   // nearest LIT point on the tube's axis
  vec3 d = c - pos;
  float dist = max(length(d), r);

  /* THE TUBE HAS A THICKNESS AND THE LIGHT HAS TO KNOW ABOUT IT.
   *
   * r used to appear once, as max(length(d), r) -- a floor on the distance that only bites for a surface closer
   * to the axis than the tube's own skin, which is to say never. Everything else treated the lamp as an
   * infinitely thin line. That is why FROST measured byte-identical: it scales the radius, and the radius was
   * read by nothing that could show it. TUBE DIA had the same problem.
   *
   * A source with real width WRAPS: it lights surfaces turned partly away from it, because part of it is still
   * above their horizon. How much depends on how large it looks from here -- r over the distance to it -- so
   * that ratio is the wrap term, and it falls out of the geometry rather than being a knob. A frosted sleeve
   * then does the one thing a frosted sleeve does: it makes the source bigger, so the shading gets softer and
   * the shadows open up. */
  float wrap = clamp(r / max(dist, 1e-4), 0.0, 1.0);
  float lam  = max((dot(nrm, d / dist) + wrap) / (1.0 + wrap), 0.0);
  return col * flux * lam / (0.35 + dist * 2.2);
}

/* SURFACE SHADING FOR THE TUBE ITSELF. Now that it is a cylinder there is a real normal, so the specular band
 * runs round the curve as the tilt changes instead of sitting where a 2D gaussian was told to put it. The
 * cathode sag stays -- it is a property of the coating, not of the geometry. */
/* HOW NEAR THIS RAY CAME TO A LAMP -- the closest approach between the ray and the tube's axis segment.
 *
 * This is what makes the halo THREE-DIMENSIONAL rather than a blur. The reference glows its tubes with a CSS
 * box-shadow, which is a fixed ring in screen space: it cannot foreshorten, cannot lean when the fitting tilts,
 * and sits at the same width along a tube running away from you as one lying across your view. Measuring the
 * distance in the FITTING's own space instead means the halo is thin where the tube is far, fat where it is
 * near, and elliptical when it leans -- all of it falling out of the geometry rather than being drawn on.
 *
 * Standard closest-approach between two lines, with the axis parameter clamped to the segment so the glow stops
 * at the tube's ends instead of running off to infinity, and the ray parameter clamped at zero so nothing behind
 * the eye contributes. rd and the axis are both unit vectors, which is why the determinant is just 1 - b^2. */
/* THE AXIAL COORDINATE COMES BACK OUT NOW, and it was being computed and thrown away.
 *
 * tc is already where along the tube the closest approach lands -- the function needs it to measure the distance
 * at all. Returning it as well is free, and it is the only way anything outside the tube's SURFACE can ask what
 * condition the lamp is in at that point. Normalised to 0..1 end to end. */
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
 * because the halo has to ask the same question: a burnt-out middle throws no light, so it can carry no glow,
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
  /* HOW FAR THIS POINT IS FROM THE TUBE'S END, AS A FRACTION OF ITS HALF-LENGTH -- and the fraction is the
   * point, not a retreat from measuring in millimetres.
   *
   * This was halfLen - abs(pos.x): a length, compared against a cap length in the same nominal units. It barely
   * moved -- 5mm and 100mm differed by three thousand pixels -- because pos.x carries the aspect factor and
   * halfLen does not, so the two sides of the subtraction are not in the same space. Rather than untangle that
   * convention (the tube's own length and the housing get it consistently, so the picture is right), both sides
   * are made DIMENSIONLESS: distance from the end over the half-length, against the cap over the half-length.
   * No units left to disagree about.
   *
   * It is still a fixed physical size. The caller divides the cap's millimetres by the tube's own millimetres,
   * so a 25mm cap stays 25mm of real part however long the lamp is -- which is what a moulded end cap does. */
  float fromEnd = 1.0 - axial;
  float face    = max(dot(nrm, -rd), 0.0);

  /* HEALTH IS THE REFERENCE'S CURVE, PORTED -- not a model of my own that happens to look similar.
   *
   * Three earlier attempts here each invented their own failure: end-inward creep, then middle-outward creep,
   * then a ten-step band. All of them were arguing with crt-fixture.js, which has had a worked-out answer the
   * whole time in tubeHealth(). The states are meant to MATCH the lab, so the arithmetic is transcribed from it
   * rather than reinvented, and the breakpoints below are its numbers.
   *
   * The lab paints the tube as a horizontal gradient with five stops per half, built from three colours whose
   * mix ratios are functions of health. Since everything here is linear-light emission rather than sRGB fill,
   * what gets transcribed is the VITALITY at each stop -- how lit that part of the tube is, 0..1 -- and the
   * emission is then mixed between the dead coating and the live phosphor by it.
   *
   *   endVital  the ENDS go charred -> lit across 18%..30%. Above 30% the ends are simply lamp-coloured, which
   *             is why a half-dead tube still has two bright tips.
   *   conn      the MIDDLE. Dead below 40%; climbs to only HALF-lit by 90%; completes over the last tenth. The
   *             last faint bit of the middle is the last thing to come alive, and this single line is most of
   *             what makes the lab's tubes look tired well before they look broken.
   *   reach     how far the end glow reaches inward, 8%..50% of the length, growing from about 20% health.
   *
   * The lab's midCol is the average of frontCol and centerCol and sits halfway between their two stops, so
   * those three stops are exactly a straight line from front to centre -- collapsed here into one mix. */
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
   * the soot that makes a spent lamp look burnt rather than merely unlit. */
  float tchar    = clamp((0.25 - h) / 0.25, 0.0, 1.0) * 0.92;
  float dead     = 1.0 - vit;
  /* THE SLEEVE IS METAL ALL THE WAY, and this ramp was the last thing making it look wrong.
   *
   * caps used to fade in across the whole cap -- smoothstep(0, uCapLen, fromEnd) -- which made sense while the
   * cap was a shading effect on a single cylinder: a soft blend into the glass. It stopped making sense the
   * moment the sleeve became its own geometry at its own radius. The material now ramped across a part that is
   * physically uniform, so the sleeve's INNER half rendered as bright glass at the wider radius: a bulge of
   * lamp sticking out past the tube, which is exactly what a metal cup should be hiding.
   *
   * The geometry says where the sleeve is, so the material follows it exactly -- full metal from the shoulder
   * out, with only enough softness on the boundary to keep it from aliasing. */
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
   * Two parts, and the reference draws both. The dead coating is a dark warm solid -- crt-fixture calls its
   * equivalent char, and notes it is "visible under screen blend, not vanishing" -- so the tube stays a solid
   * object in front of the housing rather than a tube-shaped gap, which reads as a rendering fault.
   *
   * Over it sits the OUTLINE. The reference's tubes carry two permanent inset highlights down their long edges,
   * which is what still says "glass cylinder" when the phosphor inside it is dead. Here that is the grazing
   * term: fres is brightest exactly at the silhouette and nothing face-on, so a spent tube reads as a dark body
   * with its rim still catching the fitting's light. It does not depend on health, so at zero the outline is
   * the whole of what is left. */
  /* THE TWO DEAD COLOURS ARE THE LAB'S OWN, converted. char is rgb(46,38,33) and gapDark is rgb(38,31,27) --
   * it calls them "charred solid" and "dead coating" and notes both must stay "visible under screen blend, not
   * vanishing", which is the same requirement here for the same reason: a tube that goes to nothing punches a
   * hole in the fitting. gapCol crossfades between them from 15% health, exactly as the lab does. */
  vec3 charLin = vec3(0.0273, 0.0194, 0.0152);
  vec3 gapLin  = vec3(0.0194, 0.0137, 0.0110);
  vec3 gapCol  = mix(charLin, gapLin, clamp((h - 0.15) * 1.6, 0.0, 1.0));
  /* THE 0.28 FLOOR IS THE FITTING'S OWN AMBIENT, so it goes out when the fitting does.
   *
   * The floor exists on purpose -- the note above says the dead coating must stay "visible under screen blend,
   * not vanishing", because a tube that goes to nothing punches a tube-shaped HOLE in the housing behind it and
   * that reads as a rendering fault. That argument is sound, and it silently assumes there is a housing to see
   * the hole against. In a blackout there is not: the housing, the rails and the moulding are all dark by then,
   * so nothing is left for a hole to be a hole IN, and a bare constant here is the last thing in the fitting
   * still lit by a light that does not exist. Measured during the fault's dark phase, this was the tube bodies
   * hanging visibly in an otherwise black frame.
   *
   * Scaled by the pair's own output rather than by this tube's, and deliberately: a dead lamp beside a live one
   * IS lit -- by its neighbour, off the inside of the housing -- so it keeps its body and only loses it when the
   * whole fitting goes. That is exactly the case the floor was written to protect. */
  float ambT = clamp(max(uFlkA * uHealthA, uFlkB * uHealthB), 0.0, 1.0);
  /* DEAD COATING IS A CONTROL NOW, and at its old fixed strength a spent section was not spent enough.
   *
   * The note above is right that a tube going to literal nothing punches a tube-shaped hole in the housing --
   * but it protected that at the cost of the thing the health model exists to show. Measured along a tube at
   * HEALTH 40%, where the middle is fully dead by the vitality curve: the ends read 239 and the middle read 118.
   * Mid grey. A fluorescent whose centre has given up does not read as half lit; it reads as a dark bar with two
   * glowing ends, and that contrast IS the effect.
   *
   * So the floor stays available and stops being compulsory. At 1 this is exactly what it was; at 0 a dead
   * section is black and the tube becomes two lit ends floating in the fitting. The hole-in-the-housing problem
   * the old note worried about is real only when there is a housing behind it to see -- which is BOX's business,
   * and BOX is a control too. */
  vec3 coat = gapCol * (0.30 + 0.70 * face) * (0.28 * ambT + 0.72 * flk) * uTubeDead;
  /* The outline the lab gets from two permanent inset highlights down the tube's long edges -- the thing that
   * still says "glass cylinder" once the phosphor inside is dead. */
  // The outline goes with it: it is the dead section's own glass catching light, so it cannot outlive the body.
  vec3 rim  = col * pow(fres, 0.8) * flk * 0.85 * uTubeDead;
  emit = mix(emit, coat + rim, dead);
  emit *= mix(1.0, 0.34, tchar);

/* THE END CAP IS A METAL FERRULE, and it has to READ as a cylinder.
   *
   * Two goes at this so far. It was mix(1.0, 0.18, caps) -- the same emissive phosphor at 18%, which is a dim
   * patch of tube and not a different part at all. Then it was grey metal shaded by a rim term, which is
   * backwards for a solid: pow(1 - dot(n,-v)) is BRIGHTEST at the silhouette, so the cap lit up around its
   * outline and went dark through the middle. That is how you shade a glowing shell, and it flattens a cylinder
   * into a ring.
   *
   * A metal band lit from in front is the other way round: brightest where it faces you and falling away toward
   * the edges, which is the shading that makes a curved surface read as curved. So the body term is the facing
   * cosine, and the specular is a TIGHT band on top of it rather than a wash -- aluminium has a hard highlight,
   * not a soft one.
   *
   * FAINTLY GREEN, because that is what the cap on a fluorescent tube actually looks like: anodised aluminium
   * with a slight cast, against warm-white glass. The difference in hue is most of what separates the cap from
   * the lamp at a glance -- neutral grey beside 5000K glass just reads as more glass, dimmed.
   *
   * Scaled by flk so it goes dark with its own tube: a cap is lit BY the lamp it is fitted to, so a dead tube
   * has dark ends beside a live one's bright ones. */
/* NEARLY FLAT, AND THAT IS THE POINT NOW. The sleeve is a real cylinder standing proud of the glass, so its
   * ROUNDNESS is carried by its silhouette -- the shape you see against the tube behind it -- and does not need
   * to be spelled out again in the shading. Doing both was the error: a strong facing gradient PLUS a hard
   * specular on a part that is already visibly round reads as a bulging bead, and the colour swings so far
   * across it that it stops looking like one material.
   *
   * A painted end cap is close to matte anyway. So: a shallow lift toward the eye, enough that it is not a flat
   * sticker, and no highlight at all. The hue holds steady across the whole part, which is what makes it read
   * as one piece of metal rather than as a gradient. */
  vec3  capCol = vec3(0.27, 0.34, 0.28);          // anodised, with the green cast the real part has
  vec3  metal  = capCol * (0.82 + 0.18 * face) * flk;
  return mix(emit, metal, caps);
}


/* THE FIXTURE'S WHOLE REFLECTION, AS A FUNCTION OF ONE RAY -- so it can be sampled more than once.
 *
 * It was inline, which meant exactly one trace per pixel and therefore no way to blur it: a rough surface
 * reflects an AVERAGE of many directions, and averaging needs more than one sample. The single attempt at
 * jittering the one ray produced salt and pepper rather than softness, because one sample of a distribution is
 * a coin flip and not a mean.
 *
 * Everything the trace needs now arrives as an argument, so MATTE can call it around a small ring and average
 * the results. Nothing about the sharp path changed -- with MATTE off it is called once, with the same ray, and
 * the branch is uniform so the extra taps cost nothing when they are not wanted. */
vec3 traceFixture(vec2 sp2, float ct, float st, vec3 boxLo, vec3 boxHi,
                  float halfLen, float tubeR, float tubeRlit, float tubeZ,
                  float flkA, float flkB) {
  /* THE FITTING'S OWN AMBIENT, AND IT HAS TO COME FROM THE LAMPS.
   *
   * Two constants below -- 0.25 on the housing's inner wall and 0.10 on the rails -- exist so the fitting reads
   * as a moulded object with form rather than a silhouette, and they were bare numbers. A bare number is a claim
   * that there is some OTHER light in the room, and there is not: this fitting is the only source in the scene.
   * So with both lamps dead the housing and its rails went on quietly showing themselves in the glass. Measured
   * during the mains fault's dark phase, with screen and lamp both at exactly 0: peak 59 of 255, all of it here.
   *
   * What that light physically IS, is the lamps bouncing around inside the housing. So it scales with them, and
   * at any normal output it saturates and nothing about a working fitting changes. */
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

    /* PIXEL FOOTPRINTS, TAKEN HERE AND NOWHERE ELSE, because every silhouette below is a boolean.
     *
     * The fitting is built from hit tests -- inside the opening or not, on a rail or not -- and one sample per
     * pixel of a step function is an aliased edge by construction. Measured on the outline: 57 to 200 across a
     * SINGLE pixel, with the crossing walking 1041, 1044, 1046, 1050 down successive rows. A one-pixel step on
     * a shallow diagonal is a staircase, and at RENDER SCALE 0.67 each tread is about one and a half display
     * pixels wide. That is the blockiness.
     *
     * The fix is analytic coverage: rather than asking whether this pixel's CENTRE is inside, ask how much of
     * the pixel is, using the edge function's own screen-space derivative as the pixel's width. Two fwidth()
     * calls, no extra samples.
     *
     * THEY MUST BE COMPUTED BEFORE ANY BRANCH ON facing. fwidth() is undefined inside non-uniform control flow
     * -- neighbouring fragments in a quad have to be on the same instruction for a derivative to mean anything
     * -- so they sit up here where every fragment reaches them, and the branches below only READ them. */
    /* ONE fwidth, ON A vec2, FOR ALL THREE EDGES -- and that is not tidiness, it is 2ms.
     *
     * The first cut took three separate scalar derivatives: one for the aperture and one for each rail axis.
     * Because they have to be computed before the branch, every fragment on the screen paid for all three
     * whether or not it was anywhere near the fitting, and the frame went 15.2ms to 17.3ms. A derivative is
     * also not just an arithmetic op -- it forces the quad to stay in lockstep and costs the compiler some
     * scheduling freedom -- so three of them on every pixel is worse than the instruction count suggests.
     *
     * They collapse into one. The rails need d|x| and d|y|, which is a single vec2 derivative; and the
     * aperture's edge function is max(|x|-hx, |y|-hy), whose own footprint is whichever of those two is
     * larger. So all three fall out of the same fwidth. */
    vec2  aOa   = abs(atOpen.xy);
    vec2  rW    = max(fwidth(aOa), vec2(1e-6));
    float apD   = max(aOa.x - boxHi.x, aOa.y - boxHi.y);     // <0 inside the opening, >0 outside
    float apW   = max(rW.x, rW.y);
    float apCov = 1.0 - smoothstep(-apW, apW, apD);
    float rWy   = rW.y;
    float rWx   = rW.x;
    vec3  room   = vec3(0.0);

    /* THE PANEL BENDS THE RAY, WHICH IS WHAT MAKES IT A PRISM.
     *
     * A prismatic cover does not shade the lamps, it REFRACTS them: each facet deflects what passes through it,
     * so every cell carries its own displaced copy of the tubes and the lamp appears repeated across the panel.
     * Doing that here -- bending the ray at the aperture and THEN tracing -- means the copies are real
     * intersections with the real cylinders rather than a pattern painted over one, so they move correctly when
     * the fitting tilts, the lamps move, or the tubes change size.
     *
     * FLAT FACETS, NOT A LENS. sign() gives each quadrant of a cell a constant slope pointing away from its
     * centre: a four-sided pyramid, which is how the common panel is moulded, and what gives the hard straight
     * grid instead of a field of soft beads. fract() keys it to the cell, so the facets stay with the fitting
     * rather than sliding across it.
     *
     * Applied to rdl ONLY. atOpen above keeps the true ray, so the panel refracts what is behind it without
     * moving where the panel itself is -- the seam lines and the aperture test still land where the part is. */
    /* EACH CELL IS A LENS, SO THE DEFLECTION IS PROPORTIONAL -- and that is the whole difference between this
     * and a grid of slightly offset copies.
     *
     * It was sign(pf) * 0.055: a BINARY deflection, one constant angle for the left half of a cell and the
     * opposite for the right. That translates each half-cell sideways and does nothing else -- no cell forms an
     * image, so there is nothing for the grid to be a grid OF. And 0.055 radians is about three degrees, small
     * enough that the whole effect measured as a 5% shift in the frame mean across the control's entire range.
     *
     * A prismatic lens panel is a moulded array of little pyramids. Within one cell the facet's slope grows
     * steadily from the apex out to the wall, so a ray is bent in proportion to how far off that cell's axis it
     * enters -- which is a lens. Each cell then forms its own small image of the lamps behind it, and a panel of
     * them reads as a grid of bright cells rather than as a texture printed over one big lamp. pf already runs
     * -0.5..0.5 across the cell, so it IS that proportion; it only ever needed to be used instead of thrown
     * away by sign(). */
    if (uPrism > 0.001 && facing) {
      float pn = max(uPrismN, 2.0);
      vec2  pf = fract(atOpen.xy / max(boxHi.x, 1e-4) * pn * 0.5) - 0.5;
      /* THE ANGLE IS SMALL, AND THAT IS THE MEASURED ANSWER RATHER THAN THE OBVIOUS ONE.
       *
       * The reasoning that got this wrong twice: a bend at the aperture only shows as the ray travels away from
       * it, the lamps sit only ~24mm behind the panel at RECESS 40, so surely the angle has to be big. It was
       * 0.055 rad and invisible; pushed to 1.6 rad it was worse than invisible -- every cell aimed somewhere
       * that misses the lamps and the whole panel went flat. Measured across the lamp with 18 cells set:
       *
       *     K        0     0.1    0.2    0.3    0.45    0.9    1.6
       *     cells   17     16     16     13      7       0      0
       *     sd      18.9   28.2    6.7    5.4    4.3     3.4    1.1
       *     mean   196    126     79     72     67      63     61
       *
       * Structure PEAKS at 0.1 and falls off a cliff after it. Past that the refraction is not breaking the
       * lamp into cells, it is steering the samples off the lamp altogether -- the mean collapses because the
       * cells are looking at dark housing, and a grid of uniformly dark cells has no structure in it.
       *
       * The other thing that table says: at K = 0 there are already 17 cells at full brightness. The GRID is
       * the moulding, drawn by the seam term below; refraction's job is only to modulate what each cell shows,
       * and a little of it does far more than a lot. */
      /* AND IT SCALES WITH THE CELL, or the control below it stops meaning anything.
       *
       * A fixed facet angle sounds right -- moulded acrylic has the slope it has, whatever the pitch -- but the
       * displacement it produces over the gap is then fixed too, while the cells themselves get smaller. Past a
       * certain fineness every sample lands in some OTHER cell's territory and the per-cell image is gone. The
       * tuning above was done at 18 cells; at the same K with 40 the structure collapsed from sd 28 to 1.5 and
       * the panel went flat, which is that failure exactly.
       *
       * Dividing by the pitch keeps the displacement to about a constant fraction of a cell, so a fine panel
       * and a coarse one both read as panels rather than one reading as a panel and the other as noise. */
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

        /* THE HALO -- the tube's edge going soft, in three dimensions.
         *
         * A bright fluorescent does not end at its glass. Light scatters in the envelope, in the air, and in the
         * eye looking at it, so the boundary between lamp and not-lamp is a gradient whose width grows with how
         * hard the lamp is driven. The reference does this with a box-shadow; that ring is fixed in screen space
         * and cannot foreshorten, which is exactly what a 3D version has to fix. See axisDist.
         *
         * EXPONENTIAL, not a smoothstep, because a glow has no edge -- a smoothstep would put a second, softer
         * silhouette around the first one, which is the thing that makes painted glows look painted. The falloff
         * width is measured in tube radii, so a fatter lamp gets a proportionally fatter halo.
         *
         * Scaled by each lamp's own flux and health, so a dead tube casts none and a mismatched pair glows by
         * different amounts -- and it is ADDED, because scattered light is light that is already there arriving
         * somewhere else, not a tint over what is behind it. */
        /* IT HAS TO OUTSHINE THE EDGE IT IS HIDING, which the first version could not.
         *
         * The halo peaked at roughly half the tube's own core, so the silhouette still stepped: measured across
         * a tube at full strength, 179 outside against 213 inside -- a 34-level cliff where the glass ends. A
         * glow that is dimmer than what it surrounds does not soften an edge, it draws a second one.
         *
         * Two changes. The falloff is much wider -- up to about eight tube radii rather than three -- and the
         * amplitude is high enough that near the tube BOTH sides of the silhouette run off the top of the tone
         * curve. That is how a real bloom hides a boundary: not by blending it, but by driving everything around
         * it past the point where the display can tell the difference.
         *
         * AND THE DIFFUSER DRIVES IT. A cover's whole job is to stop you resolving the lamps, so it widens the
         * scattering with it -- which is what keeps a hard white cylinder from reading straight through the
         * panel at a raking angle. DIFFUSER contributes to the glow even with the control itself at zero. */
        /* ONE PER LAMP. A shared control could only ever say how much the FITTING glows, and the two tubes in a
         * fitting are not interchangeable -- they are already allowed their own level, colour temperature,
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
          /* AND ON THE COATING WHERE THE GLOW IS ACTUALLY COMING FROM, which is what was missing.
           *
           * hGlow is one number for the whole lamp, so a tube whose middle has burnt out went on throwing its
           * full halo along its entire length -- over its own dead section, and over the housing wall behind it.
           * Two visible failures from one cause: a spent middle read as TRANSPARENT rather than burnt, because
           * the glow was painted across it and this halo is deliberately driven hard enough to run off the top
           * of the tone curve; and BOX looked broken, because the same saturation buried the wall it fades.
           *
           * Light comes from coating that is still alight. tubeVit answers that at the point the halo is being
           * sampled from -- the same function the tube's own surface uses, so the body and its glow cannot
           * disagree about which parts of the lamp are dead. */
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
         * a sample of them. DIFFUSER crossfades toward it. MATTE used to as well, which was the bug directly
         * below; it is a screen property and has no business reaching inside the fitting. */
        vec3 atPanel = vec3(atOpen.xy, 0.0);
        vec3 panelN  = vec3(0.0, 0.0, 1.0);
        vec3 smoothLit = tubeLight(atPanel, panelN, -uFixGap, tubeZ, halfLen, tubeRlit, uLampA, flkA * uHealthA, litReach(uHealthA))
                       + tubeLight(atPanel, panelN,  uFixGap, tubeZ, halfLen, tubeRlit, uLampB, flkB * uHealthB, litReach(uHealthB));
        /* MATTE DOES NOT BELONG IN HERE AT ALL, and a line saying otherwise stood on this spot for a long time.
         *
         * It was: room = mix(room, smoothLit * 0.68, uMatte) -- a crossfade from the traced fitting to the
         * aperture irradiance, the second of four attempts at this control. It survived the arrival of the
         * mip chain, which is the model that actually shipped, and the two then ran at once.
         *
         * At MATTE 1 the crossfade REPLACED the fitting outright with a smooth dim field containing no
         * fixture. That is the whole of the "it disappears at 100%" bug -- not the blur depth, which is where
         * two rounds of investigation went. The proof is that capping the mip chain at 1, 2, 3, 4, 5 and 6
         * levels produced byte-identical frames: by the time the chain was consulted there was nothing left
         * of the fitting to blur.
         *
         * MATTE is the ROUGHNESS OF THE GLASS. It selects a mip level, and that is all it does. A rough
         * surface scatters a reflection; it does not substitute a different image for it. smoothLit stays
         * because DIFFUSER genuinely is a substitution -- an opal cover really does stop you seeing the
         * tubes -- but that is a property of the FITTING, and this is a property of the SCREEN. */

        if (uDiffuse > 0.001) {
  /* AN OPAL COVER GLOWS -- it does not average. This was a flat constant: the total flux behind the
           * panel, spread evenly, which is uniform but dead. A real cover is brightest where the lamps are behind
           * it and dims toward the corners, because the panel is being LIT from a few centimetres away and the
           * inverse square still applies over that distance. Losing that gradient is what made it read as a grey
           * card rather than as something with lamps behind it.
           *
           * So it is the irradiance again, but computed with the source blown up: as DIFFUSER rises, the tubes
           * are treated as progressively fatter cylinders until they are wider than the gap between them and
           * their two pools have merged into one field. The wrap term in tubeLight does the rest -- a wider
           * source wraps further round, so the panel gets smoother AND brighter at the same time, which is
           * exactly what a cover does: it hides the lamps by spreading them, and spreading them is not the same
           * as dimming them.
           *
           * The gain rises with it for that reason. A diffuser scatters light forward; it does not eat it, and
           * the previous 0.45 made turning the cover on look like turning the lamps down. */
          /* THE INFLATION IS BOUNDED BY THE TUBE SPACING, and at 16x it was not bounded by anything.
           *
           * The intent above is right -- fatten the source until the tubes stop being objects -- but 16x put the
           * source radius at 323mm against a 220mm gap between the lamps, so the two pools did not merely merge,
           * they swamped the whole aperture. Measured as a vertical scan down the fitting's centre, crossing both
           * tubes, DIFFUSER at 1 read 195 198 200 201 201 201 200 201 201 201 200 201 200 196: a range of SIX
           * levels out of 255. That is the grey card this comment was already written to prevent, arrived at from
           * the opposite direction -- not a flat constant, but a gradient inflated until it was flat anyway.
           *
           * 5x keeps the source narrower than the gap, so the panel still carries two soft pools where the lamps
           * are and dims between and beyond them, which is what an opal cover actually looks like. */
          /* WHAT YOU SEE THROUGH A COVER IS THE LAMP'S SHAPE WITH SOFT EDGES -- not the lamp, and not a dome.
           *
           * Both previous goes got this wrong from opposite ends. The first left a tenth of the SHARP traced
           * tube on top, so a hard white cylinder read straight through the panel. The second replaced the tubes
           * with tubeLight's analytic irradiance from an inflated source, which does hide them -- but it hides
           * the SHAPE too: measured, a slice down the panel at DIFFUSER 70 was a single smooth hump with the two
           * lamps no longer distinguishable at all. A diffuser is not a lampshade that forgets where the lamps
           * were. You should still see two elongated bright regions; what should change is how crisply their
           * edges are drawn.
           *
           * So the panel is built from the BAR ITSELF, blurred. axisDist gives the ray's distance to each tube's
           * axis -- already clamped to the segment, so the shape ends where the lamp ends -- and a smoothstep on
           * that distance is a bar with a soft edge. Widening the smoothstep IS the blur, and its width is what
           * DIFFUSER drives. The bar keeps the tube's length, its lean under TILT and its foreshortening for
           * free, because the distance is measured in the fitting's own space.
           *
           * smoothLit under it is the panel's ambient: a cover glows over its whole area, not only where a lamp
           * is directly behind it, and without this the gaps between and beyond the bars go dead. */
          /* TWO STAGES, AND THE ORDER IS THE POINT: HIDE THE LAMP, THEN FLOOD THE PANEL.
           *
           * One linear ramp did both at once, so the control spent its whole range half-hiding a tube that was
           * still legible while also half-lighting a panel that was still patchy -- neither finished until the
           * end. A cover does these in sequence: the first thing it buys you is that you can no longer make out
           * the lamp, and only past that does the panel start reading as one lit surface.
           *
           * hide runs 0..35% and owns the blur's first and largest jump AND the crossfade, so the lamp stops
           * being legible in the first third of the control rather than dragging on to the end.
           *
           * spread runs 55..100% and is the second half of the widening plus the ambient fill -- the part that
           * pushes the two bars into each other until they read as one lit surface.
           *
           * THE GAP BETWEEN THEM IS DELIBERATE. From about 35% to 55% neither term is moving: each lamp is a
           * soft even glow with no shape left in it, and the two are still plainly two. That plateau is a real
           * state of a real fitting and the control had nowhere to sit in it while the two ramps overlapped --
           * the lamp was still half-readable at the point the bars were already merging, so it went from
           * "visibly a tube" to "one wash" without passing through the stage that actually looks like a
           * diffuser. Hidden first, uniform second, merged last. */
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

        /* THE SEAM WHERE THE FACETS MEET -- and that is ALL that is left here on purpose.
         *
         * Every earlier version of this modulated brightness after the trace: room *= something. A multiply can
         * only darken or lighten what is already there, which is a shadow printed on the fitting, and that is
         * exactly how it read. The refraction now happens where it belongs -- the ray is bent at the aperture,
         * before anything is intersected, so each facet shows its own displaced copy of the tubes and the lamps
         * genuinely repeat across the panel. See the note where rdl is perturbed.
         *
         * What a bend cannot produce is the join between two mouldings, so that is what this is: a thin darker
         * line on the cell boundary. Across stronger than down, the reference's own weighting, so it reads as
         * fluting first and a grid second. */
        /* THE MOULDING BETWEEN THE CELLS, as a defined line rather than a wash.
         *
         * This was two mix()es across the whole cell -- a soft gradient from centre to gutter, which reads as a
         * dirty panel and not as a moulded one. What a real lens panel shows is narrow: the wall where two
         * pyramids meet catches almost nothing and goes distinctly dark, while the apex of each facet points
         * straight at you and picks up a little extra. Everything between is flat.
         *
         * Also weighted equally on both axes now. The old version was deliberately stronger across than down so
         * it would read as fluting first and a grid second -- correct for the ridged panel it was modelling,
         * wrong for a square-celled one, where the two directions are the same moulding. */
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


  /* THE ROOM GRADIENT IS GONE. It was a two-colour vertical wash -- ceiling over floor -- standing in for an
     * environment, and it lit the glass everywhere at once regardless of what was actually in front of it. With
     * the fitting properly visible there is a real thing being reflected, and a flat gradient behind it only
     * lifted the blacks and flattened the very reflection it was supposed to sit behind.
     *
     * WHAT REPLACES IT IS SCATTER, WHICH IS SHEEN'S REAL JOB. Light entering the faceplate does not all come
     * straight back out: some of it scatters sideways inside the glass and leaves as a soft halo AROUND whatever
     * put it there. So every reflection that reaches the glass gets a glow, its size set by how far the light
     * travels before it escapes, and nothing glows where nothing is being reflected. That is the difference
     * between this and the gradient -- it is a property OF the reflection rather than a thing beside it. */
    /* MEASURED AT THE APERTURE, NOT ON THE SCREEN -- and it was not, until now. This used sp2, the raw screen
     * coordinate, so the halo was an axis-aligned rectangle sitting around a fitting that reflects as a tilted,
     * foreshortened trapezoid. Turn TILT up and the glow stayed square while its own source leaned away from it.
     *
     * atOpen is the same ray the fixture is traced with, after the tilt and with the perspective already in it,
     * so a distance from it is a distance in the fixture's frame. The halo leans, foreshortens and slides with
     * the thing casting it because it is derived from the same geometry. A ray pointing away from the aperture
     * plane has no crossing to measure and gets no halo at all. */
    /* THE RAILS: FOUR BARS THAT CROSS AT THE CORNERS, which is the reference's part and not the ring that stood
     * here before.
     *
     * What this replaces was a flange -- a closed rectangular band hugging the opening, mitred at the corners
     * like a picture frame. That was my own invention, standing in for rails I had deleted for being painted
     * hairlines. The lab has never drawn it that way. Its four rails (see the fixture block in the .dc.html)
     * each OVERSHOOT the corner and fade out, so the members cross rather than meet and the fitting reads as
     * something suspended on rails rather than something with a trim ring around it.
     *
     * THE PROPORTIONS ARE THE LAB'S, and they turn out to be one number. Measured off its computed style rather
     * than read off the CSS: 9.1875px thick, 36.5539px of overhang, 18.2769px of fade -- t, 4t and 2t. So RAILS
     * sets the thickness and the rest follow, and the crossing is automatic: a bar reaching 4t past the corner
     * necessarily passes over the perpendicular bar, which only occupies t.
     *
     * THE FADE IS THE ONE PROPORTION DELIBERATELY NOT THE LAB'S. At 2t it is 38mm on a rail 1352mm long -- under
     * 3% of the length -- which at this scale reads as an end rather than as a fade. 6t runs the taper across
     * the whole overhang and on past the corner, so a rail is only fully opaque where it lies over the fitting
     * and thins continuously from there out. The lab gets away with 2t because its fitting is small on the
     * glass; the same ratio on a fitting this size just looks cut off.
     *
     * The fade stays LINEAR, matching the linear-gradient it is copied from, and runs to zero at the very tip.
     * It is also the whole reason these read as rails and not as a frame -- a member that stops dead is a
     * border, and one that dissolves is a part continuing out of the picture. */
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
        /* THE LAB'S OWN COLOUR, CONVERTED. Its rails are rgba(224,212,185) -- a warm bone white -- and that is an
         * sRGB value, while everything here is linear light. Dropping the triple in raw would have made them
         * too bright and too yellow at once. This is that colour through the sRGB transfer function, used as an
         * ALBEDO rather than as a result. */
        vec3 railCol = vec3(0.745, 0.658, 0.484);
        /* AND THE LAMPS LIGHT THEM FROM THE FRONT, WHICH tubeLight CANNOT SEE.
         *
         * A rail lies in the plane of the OPENING with its face toward the room, and the tubes sit behind that
         * plane. So the direction from a rail to either lamp points backwards, dot(n, d) goes negative, and
         * tubeLight correctly returns almost nothing -- which left the rails on their 0.10 ambient and rendered
         * them a dark grey-brown. That is not wrong lighting, it is the wrong LIGHT: what actually illuminates
         * a ceiling rail is the fitting's own output coming back off the ceiling around it, and no ray in this
         * scene carries that.
         *
         * So it is supplied directly, from the same lamp-output term the sheen uses. It keeps the lamp COLOUR,
         * so TEMP A/B tints the rails and a mismatched pair shows on them; it keeps the level, so they dim with
         * LIGHT and blink with FLICKER; and rlit stays in at a lower weight for the small amount of grazing
         * light that is genuinely there, which is what makes the near corners read brighter than the far ones. */
        /* MOSTLY THE LEVEL, ONLY A LITTLE OF THE COLOUR -- because the albedo is ALREADY warm.
         *
         * Driving straight from the lamp's colour tinted a bone-white rail with a 5200K light and warmed it
         * twice: measured, the brightest rail came out at G/R 0.906 and B/R 0.762 against the reference's 0.946
         * and 0.826, which reads as tan rather than as painted metal. #E0D4B9 is not an albedo the lab picked in
         * a vacuum, it is what a pale rail under these lamps already LOOKS like, so most of what the lamps
         * contribute here is intensity. 35% of the tint is kept so a mismatched pair still shows on the rails,
         * which is the one thing a pure luminance drive would throw away.
         *
         * BOTH CONSTANTS ARE FITTED, not chosen. At GLARE 1 with both lamps full: a pure colour drive measured
         * G/R 0.906 and B/R 0.762, a 35% one measured 0.973 and 0.920, and the reference is 0.946 and 0.826 --
         * two points on either side, so the mix lands at 0.72. The gain was fitted the same way, from #C4B59C
         * up to the reference's red, undoing the tone map on both ends first. */
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
