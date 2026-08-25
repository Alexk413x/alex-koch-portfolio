/* crt-presets.js — the shipped values, lifted out of the lab page.
 *
 * A view is a scene, a set of values and some chrome. Holding the values here is what lets a second view drive the
 * same scene from a different starting point instead of copying the scene to change its numbers.
 *
 * `gpu` is a parameter rather than an import because this module has no renderer to ask, and a preset that reached
 * for one could not be read without first booting WebGL.
 */
export function defaultPreset(gpu) {
  return {
  power: 1, lightOn: 1,
  /* HOW LONG THE TUBE TAKES TO GO OUT AND TO COME BACK, in seconds -- the reference's own COLLAPSE and WARM-UP,
   * at the reference's own defaults. They are the animation's duration and nothing else: the poses and the
   * easing are fixed, because a collapse is the strike played backwards and that relationship is not a setting. */
  collapse: 1, ignite: 1,
  /* THE MAGNET. field/wiggle/warpSec are the reference's FIELD, WIGGLE and DURATION at its own defaults (1 / 1.4 /
   * 2.2s); the four below them are what this build can express and the DOM one could not. There, the warp is a CSS
   * transform on the text element, so its shape is fixed at "rigid sheet" and its only knobs are how hard and how
   * long. Here it is a displacement field on the beam's coordinate, so the SHAPE is separable: how much is a pull
   * toward the middle of the tube, how much is the travelling pole, how much is the twist, and how far in from the
   * rim the raster stops being clamped. */
  wint: 2.7, wwig: 4, warpSec: 5.4,
  /* DRAG LEADS NOW. PULL and SWIRL are bounded by the pole's own gaussian, so on their own they can only ever
   * disturb a patch -- which is what "the warp effect seems like a really small management" was describing, and
   * no amount of driving them harder fixes it, because the bound is the shape of the term and not its size. DRAG
   * has no falloff, so the whole picture leans with the pole and the effect is as big as the tube. */
  warpDrag: 0.205, warpPull: 0.18, warpPinch: 0, warpSwirl: 0,
  warpSpring: 0.29,   // how much of the motion is the raster ringing back rather than following the field
  /* LARGE AGAIN, AND THE ORBIT IS WHY IT CAN BE. A wide reach was tried and rejected once -- at 0.45 with a pole
   * crossing left to right it read as a global breath, because a wide field on a straight path is a wave by
   * construction. What made it a wave was the PATH. With the pole going round instead, a wide field is a large
   * area being swung about, which is the thing a coil held against the glass actually does. */
  warpR: 1.64,        // the pole's reach, in picture widths
  warpRim: 0,      // how far out the clamp starts -- 1 pins only the last pixel, 0 pins nearly everything
  /* IN CSS PIXELS, like every other screen distance on this panel — the scanline width, the frame, the beam tip and
   * the CONVERGENCE rows this one adds to. A fraction of the picture reads as one distance on this window and
   * another on the next; a gun split is a distance on the glass.
   *
   * The guns are seated 120° apart, so this is the RADIUS of the triad. Set against CONVERGENCE's own couple of
   * pixels the separation is real and reads as nothing; at this size the three rasters land a full glyph apart and
   * the text genuinely comes to pieces, which is the ask. */
  warpRGB: 31.5,
  /* THE MAINS FAULT. crt-flicker owns the 4.6s timeline -- the same one the reference fires -- and everything here
   * is how hard this build spends it. Each gain scales the fault's DEPARTURE from normal rather than its value, so
   * 1 is the reference's own event, 0 removes that channel from the fault entirely, and 3 is the same fault taken
   * somewhere a real supply would not survive. */
  surgeScreen: 1, surgeLamp: 1, surgeWarm: 3300, surgeHealth: 1,
  /* SLOWER THAN THE REFERENCE ON PURPOSE. Its 4.6s is paced for a lab where the fault is one of a dozen things
   * being tuned; as a thing to WATCH it is over before the dark has had time to feel like anything. 0.55 puts
   * it at 8.4s, which spends the extra time where the suspense is -- the dark stretches from 0.9s to 1.6s, and
   * the failed restrikes have room to land in it. */
  surgeRate: 1,
  // The guttering the fault drives ON TOP of the timeline, at its worst where the level is furthest from normal.
  surgeHz: 14, surgeStr: 0.75, surgeLampHz: 18,
  // How much of the fault is not authored: where the chop lands, and how many times the supply fails to restrike
  // in the dark. 0 is the reference's behaviour -- the identical fault every press.
  surgeChaos: 0.7,
  face: 1, overscan: 1, corner: 30, bend: 6,
  frameOn: 1,            // the reference ships frameOn: true; off shows the bare tube
  frameCol: '#2d1b15',   // the moulding's own plastic -- crt-bezel's default, and the reference's
  famp: 2.1,          // DEPTH: scales the fold-bounded amplitude; 1 is the reference's own depth
  /* FIT IS GONE, AND THE PIN IS WHY. It held the picture's rim on the glass by overriding OVERSCAN with the face
   * LUT's last sample. buildFaceLUT now solves for the radius at s = 1 against target = r1 = F(1), which returns
   * u = 1 by construction for every profile at every FACE — so the number FIT read became the constant 1.0 and the
   * switch quietly turned into "force OVERSCAN to 100%", which the OVERSCAN slider already does.
   *
   * The rim it was guarding is still guarded. That is what the pin IS. */
  fexp: 3, grings: 20,        // FALLOFF exponent and CURVE AREA, both tuned on this build rather than the reference's
  scan: 10, scanw: 1.0, scanop: 50, grille: 17, grillew: 1.0, grilleop: 40,
  glow: 1,          // SCREEN GLOW in nits -- the excited coating around active content, on BRIGHTNESS's scale
  glowFall: 0.095,  // how far past the block's own edge that excitation reaches
  /* THE COATING RUNS COOLER THAN IT DID. glow 3 -> 1, glowFall 0.13 -> 0.095 and phos 0.13 -> 0.07 were tuned
   * together on the running build: less excitation around the text, reaching less far, over a dimmer wash on
   * the empty glass. They belong together because they are one surface -- lowering the wash without pulling
   * the glow in leaves the text haloed on a face that has gone dark behind it. */
  phos: 0.07, bloom: 0.5, bloomThresh: 0.72, bright: 0.7, beam: 1.0,
  /* BLOOM'S RADIUS, IN CSS PIXELS, and 16 is the reference's own default. BLOOM was a gain with no width
   * beside it -- the spread was a constant of the quarter-res buffer the blur runs on -- so the panel could
   * say how much bloom and never how far it reached. The reference's single bloom control IS the width. */
  bloomSize: 16,
  vig: 0.5, vigFall: 0.22,
  /* THE TWO RATES ARE SET IN SECONDS, NOT IN RATE. A slider linear in FREQUENCY is wildly non-linear in the TIME
   * anyone reads off it: at the fast end one step moves the sweep by a hundredth of a second and at the slow end
   * the same step moves it by twenty, so every useful setting is crammed into the last few pixels of travel.
   *
   * Storing the PERIOD makes every step the same size, and the reciprocal is taken once at the boundary where it is
   * handed to the shader. Zero means parked. */
  sweepSec: 20, sweepOn: 1,
  /* THE BEAM IS MEASURED IN SCANLINES, NOT IN SCREEN PERCENT -- the same move the terminal's text made.
   *
   * SWEEP HEIGHT was a fraction of the picture, and a fraction of the picture is not a thing the beam knows
   * about: at 5% it drew a band 118 rows tall on a 1250-row picture and read as a glow with no edge, while the
   * SAME setting on a different window drew a different beam. What the beam actually relates to is the raster it
   * is writing -- it covers some number of LINES -- so that is the number, and changing SCANLINES H now resizes
   * the beam with the pattern it belongs to. */
  sweepSL: 0.25,
  /* THE BEAM TIP AND ITS SIDE EFFECTS. The sweep used to be a vertical band and nothing else -- no tip, so the
   * one part of a raster that is genuinely lit at any instant was the part that was not drawn.
   *   sweepSol  how square the band's own profile is; 0 is the old four-gaussian haze, 1 a hard-edged line
   *   sweepRGB  the guns' split ACROSS the band, in CSS px -- fringes its edge, which is where it shows
   *   hsweep    the tip's rate; 1/hsweep is the seconds it takes to cross
   *   dotR      the tip's radius in CSS px, dotLvl how hard it drives the coating
   *   beamPull  how far the active line is dragged as the tip loads the supply, in CSS px */
  sweepSol: 1, sweepRGB: 2,
  /* TIP GLOW IN NITS, on BRIGHTNESS's own scale -- it is the same coating emitting, so it is readable against
   * it: 90 nt of tip beside 62 nt of beam says the spot is driving the phosphor about half again as hard.
   * sweepStep is in SCANLINES, like everything else describing the beam's geometry. */
  hsweepSec: 25, dotNits: 100, dotHaloNits: 0, tipRGBc: 0.5, tipRGBr: 0.25, beamConvC: 1.75, dipNoise: 0.75, pullInk: 0.85, sweepStep: 0.5, beamPull: 20,
  // THE TIP GETS BOTH AXES, in the units each one belongs to: its height in scanlines, its width in the grille's
  // own columns. One radius could only ever be round on the glass, which is not the frame the beam works in.
  dotH: 0.5, dotW: 0.5,
  /* THE DEFICIT AHEAD OF THE BEAM -- see the note in crt-gl. dipFall is in multiples of SWEEP HEIGHT, so
   * widening the beam widens the shadow it is chasing, which is the relationship the two actually have. */
  sweepDip: 1, dipFall: 60, sweepWhite: 0,
  // CONVERGE as a signed percentage of the full-deflection error; 11 is the old 0.45px default.
  /* CONVERGENCE PER GUN, in CSS px, uniform across the face -- static convergence, as a service manual
   * means it. Red and blue split a couple of px either side of green, which is a well-set-up tube. */
  beamOn: 1,        // the whole sweep assembly; off also skips its per-pixel work
  convOn: 1, convRX: 1, convRY: -1, convGX: 3, convGY: 1, convBX: 1, convBY: -3, persist: 0.4,
  /* MEASURED OFF THE REFERENCE, not chosen. Read out of the running lab: fw=60 fh=30 in --cm (0.45vw) units,
   * centred at fposx/fposy = 0 on a 1245x933 glass -- so the opening is 432x216px, half-extents 0.347 x 0.232 of
   * the glass half-size. Inside it the tubes are ltwd=76% wide, at lt1=29% / lt2=71% down the opening, ltk=20
   * thick, and ftilt ships at 0. Every one of these was a guess before and every one of them was wrong -- the
   * fixture was at the top of the glass when the real one is dead centre. */
  /* THE FIXTURE IN MILLIMETRES, because a light fitting has a size. A bare fraction of the glass means nothing on its
   * own and lets you build a fitting that could not exist: a 26mm tube in a housing 40mm deep, ends sticking through
   * the sides, two lamps closer together than their own diameter. Real numbers make those states unreachable and the
   * plausible ones obvious — a T8 tube IS 26mm, a 4-foot lamp IS 1200mm, an office troffer IS about 600x600x90.
   *
   * WHAT IS DERIVED STAYS DERIVED. Tube length is the housing minus an end allowance, because that is what decides it
   * on a real fitting. Same for the caps: an end cap is a moulded part about 25mm long whatever tube it is on.
   *
   * SCALE ties millimetres to the picture: how much of the room the glass half-height spans. */
  /* MM_PER_UNIT IS A CONSTANT, NOT A CONTROL. Apparent size is (real size / U) over (real distance / U), so the U
   * cancels and fixWmm/distMM is the entire answer — a global scale on top of a real size and a real distance can
   * only be a no-op or a bug. It appeared to work only while DISTANCE was secretly a focal length.
   *
   * Kept as a constant because the conversion still has to happen somewhere; it just is not anybody's decision. */
  distMM: 1200,        // how far the fitting is from the glass
  fixWmm: 1200, fixHmm: 600, recessMM: 40,
  tubeDiaMM: 20,       // T8. T5 is 16, T12 is 38
  tubeInsetMM: 60,     // how far short of the housing each lamp stops -- tube LENGTH derives from this
  tubeGapMM: 250,      // between the two lamps' axes
  fixXmm: 550,
  /* 19mm because that is the REFERENCE'S RATIO, not a round number. Measured off the lab's computed style, its
   * rail is 9.1875px on a 592.76px fitting -- 1.55% -- which at the default 1200mm housing here is 18.6mm. The
   * overhang and fade follow at 4x and 2x, also measured (36.55px and 18.28px against that same 9.1875px). */
  railMM: 20,
  capMM: 15,   // the ferrule -- flush with the glass, so this is only how far down the tube it reaches
  fixYmm: 680,
  frost: 0.1, diffuse: 0.1, prism: 0.5, prismN: 40,
  fixTilt: 1.276637,
  // A LAMP AT A TIME: its own level, its own colour. Two tubes in one fitting are rarely the same age,
  // and colour is the first thing to drift as a phosphor blend ages -- that mismatch is most of what makes
  // real fluorescent light read as real.
  lightA: 0.8, tempA: 5000,
  lightB: 0.8, tempB: 4400,
  healthA: 1.0, healthB: 1.0, lflickA: 6, lflickB: 3,
  // flickerOn is gone -- a second gate on the lamps' flicker with no row on the panel, which could and did
  // strand the four FLICKER rows switched off with no way to reach them. See the note at lampOn.
  lfstrA: 0.5, lfstrB: 0.7, lfjit: 0.72, lfchaos: 0.5, fstr: 0.3, flickHz: 3.5,
  /* HOW HARD A STRIKE READS. crt-flicker decides WHEN a tube re-ignites at a different temperature and how far
   * its coating stumbles; these two decide what those decisions are worth on screen. The reference's own values
   * are 1500K and a gain of 1 -- correct for a fitting glimpsed in the corner of a lab, and too quiet when the
   * fitting is the thing being watched. Both are honest multipliers on the machine's own picks, so the timing
   * stays unpredictable and only the amplitude moves. */
  lfwarmK: 2600, lfhdip: 2.0,
  /* HOW MUCH OF A SPENT SECTION IS STILL THERE. crt-gl kept this as a fixed floor so a dead tube stayed a solid
   * object rather than a hole -- defensible, and it meant a fully dead middle still measured 118 of 255 against
   * lit ends at 239. Half lit is not what a failed lamp looks like. 0.18 leaves just enough body to read as
   * glass rather than absence, and lets the ends do the talking. */
  tubeDead: 0.18,
  sheen: 0.06, matte: 0.0,
  /* THE NUMBER CHANGED BECAUSE THE UNIT DID. GLARE was a reflectance spent in linear light; it is a transparency spent
   * in display space now — see the note in crt-gl where emisBare is taken. Under the old mapping the tone map and
   * gamma between the control and the eye meant a low value already produced most of a full reflection, so this is
   * the same picture said in the new unit and nothing about the shipped look moves.
   *
   * A STORED VALUE KEEPS ITS NUMBER AND LOSES ITS MEANING, which is worth knowing rather than migrating: an old
   * session will read much weaker until the slider is touched once. Not worth a schema bump — that discards every
   * other setting to fix one row. */
  glare: 0.21,
  // SCATTER IS A DISTANCE IN THE ROOM, so it is stored in cm and converted by SCALE like the fitting's own
  // dimensions. It was a bare 0..1 in shader units, which meant changing SCALE moved the fitting and left
  // its glow the same size -- the halo detaching from the thing casting it.
  scatterCM: 25,
  // How much of the face's curve the reflection takes. See the note where rd is built -- 1 is physical
  // and unusable, so this is a fraction and the useful settings are low.
  /* THE RIPPLE EVERY MAINS-DRIVEN DISCHARGE HAS -- a fluorescent runs at twice mains, so 100Hz on a 50Hz
   * supply. TUBE TEXTURE used to sit beside it (coating grain, discharge striation, cathode hot-spots) and is
   * gone: at the size this fitting is ever drawn it was noise, and it fought the burnout pattern along the
   * tube, which is the detail that actually carries information. SPILL and SPILL SIZE went earlier, for a
   * different reason -- a painted glow standing in for light the ray-traced tubes now actually cast. */
  /* The reference's --bgvis and --railvis: the housing and the rails fade INDEPENDENTLY of each other and
   * of the lamps, so either can be taken out without touching what is standing in front of it. */
  boxVis: 0.4, railVis: 0.29,
  glowA: 0.15, glowB: 0.15, ripple: 0,
  /* ROOM LIGHT RECALIBRATED, because the reflectance underneath it changed meaning. It was 0.5 back when the
   * glass's reflectance ramped from 0.03 at the centre to 1.0 at the rim -- so at the centre the room was being
   * multiplied by 0.0009 and contributed essentially nothing, and 0.5 was a number chosen to make the RIM look
   * right. With a flat, physical 4% the same 0.5 lit the whole face: empty glass measured 35.6 against the
   * reference's 13.4. The reference ships lightOn:false, i.e. no room at all, so this is the level at which the
   * room is present without washing the tube out. */
  // GLASS DEPTH is gone -- it bought about eight pixels of parallax at the rim and nothing anyone could point
  // at. The note at the deleted `par` in crt-gl records what it did and why it is not worth reinventing.
  spot: 1,
  /* THE TEXT IS MEASURED IN RASTER CELLS, NOT PIXELS -- see textGrid().
   *
   * These were `tsize` (a percentage of the render height) and `tlh` (a bare line-height multiplier), which is a
   * type scale that knows nothing about the tube it is drawn on: changing SCANLINES H moved the raster and left
   * the glyphs exactly where they were. The reference has never done that. Its cell height is in SCANLINES and
   * its cell width is in GRILLE COLUMNS, so the text sits on the same lattice the scan pattern draws and a
   * change of density resizes the type with it. Same three numbers, said in the units the surface has.
   */
  tcell: 3, tgap: 1,   // ROW HEIGHT and LINE GAP, in scanlines
  tcols: 0,            // CHAR WIDTH, in grille columns; 0 = AUTO, i.e. derived from the font's own advance
  /* 70 / 64 ARE THE REFERENCE'S OWN SHIPPED VALUES, and the height especially is not cosmetic: with ANCHOR
   * BOTTOM the text stands on the block's lower edge, so a block 64% of the picture tall puts the boot low on
   * the tube where it belongs. AUTO height makes the block exactly as tall as the text, which then centres on
   * TEXT Y and floats the whole thing into the middle of the screen. */
  tw: 74, tht: 67,     // the block's size as a % of the picture; 0 = AUTO (shrink to the text)
  tjust: 0,            // ALIGN: 0 left, 1 centre, 2 right -- the ragged edge INSIDE the block
  type: 1.2,             // TYPE SPEED, x350 = WPM
  tox: 0, toy: 0,
  tvert: 0,        // 0 = anchor bottom (grows up), 1 = anchor top (grows down)
  /* WHICH SECTIONS ARE FOLDED. An object, so a section added later defaults to open without a migration.
   *
   * ONLY THE CLOSED ONES ARE NAMED: absent means open, so anything renamed or added stays open for free. Listing the
   * open ones too would work and would quietly break that.
   *
   * A fourteen-section panel opened on all fourteen is a wall, so the shipped fold is the working set. */
  secClosed: {
    BEAM: true, CONVERGENCE: true, FIXTURE: true, FRAME: true, GLASS: true, POWER: true,
    RASTER: true, SURGE: true, TERMINAL: true, TUBE: true, WARP: true,
  },
  // fixSolo had a row under DEBUG and a read in the draw call but no entry here, so it was undefined until the
  // slider was touched -- harmless only because the upload carries a || 0. A control needs a default like any other.
  debugOn: 0, guidesOn: 1, heat: 1, gridOn: 1, fixSolo: 0,
  // The phosphor is a setting like any other; it just lived in a module variable rather than here.
  phName: 'amber', phCustom: '#4c67f0',
  /* WIDTH IN CSS PIXELS. It was a fraction of the glass half-height, which meant the same setting drew a
   * different moulding on a different window -- and crt-bezel wants px anyway, so the fraction had to be
   * converted back at every call site. 13 is the reference's own fwid. */
  /* THE NUMBER CHANGED BECAUSE THE UNIT DID — the same story as GLARE. FRAME scaled the moulding's radiance ahead of
   * the tone map and the gamma, so most of its visible range sat in the bottom of the travel; it fades the finished
   * tone now, which is a true opacity, and a given fraction of a finished tone is dimmer than the same fraction of a
   * radiance. This is the same frame, said in the new unit.
   *
   * A STORED VALUE KEEPS ITS NUMBER AND LOSES ITS MEANING, exactly as GLARE's did. */
  frame: 0.19, frameW: 13, frameBleed: 0.8,
  frameScreen: 1,     // the tube's output reflected across the bezel, in the screen's colour
  frameFixture: 1,    // the light fixture, across the whole bezel, from wherever POS Y puts it
  /* 0.62 ON INTEGRATED, AND THE NUMBER IS MEASURED RATHER THAN CHOSEN. At 0.72 this scene sits exactly on the
     * 16.67ms edge on a UHD 630: min 16.4ms every time, but the median alternates between 16.9 and 33.2 across
     * repeats -- half the frames land one vsync late. A build that is marginal is a build that stutters on any
     * machine slightly slower than the one it was tuned on, so the cap buys headroom rather than an average. */
  /* FULL RESOLUTION EVERYWHERE NOW. This was 0.62 on integrated, chosen when the fill rate looked like the
   * binding constraint. Measured since, on the UHD 630 this targets: 60 FPS at 0.62, at 0.80 AND at 1.00 -- the
   * scale was not buying frames. It was costing the shadow mask, which is a one-pixel structure and gets averaged
   * away by the upscale: cell-grid energy on empty glass measured 0.379 / 0.496 / 0.686 across those three
   * scales, against the reference's 1.256. Kept as a control for slower hardware than this. */
  /* BACK TO ADAPTIVE. I raised this to 1.0 on a single reading that showed 60 FPS at every scale; repeated runs
   * show 38-44 at 1.00 and it fell to 21 once the fixture became genuinely visible, so that reading was noise and
   * the claim it supported was wrong. The scale is a real trade -- cell-grid energy measured 0.379 / 0.496 / 0.686
   * at 0.62 / 0.80 / 1.00 -- so it stays a control, defaulted to what the hardware can actually hold. */
  /* CHOSEN FOR THE LOOK RATHER THAN THE BUDGET, which reverses the reasoning above and is worth saying plainly. Every
   * earlier move of this number was a fill-rate decision that regretted what it cost the shadow mask; here the
   * one-pixel structure is averaged down far enough that the tube reads as an older, softer set, which is the wanted
   * result rather than a price paid for frames.
   *
   * ONLY THE INTEGRATED BRANCH MOVED. The discrete default stays 1.0: a look tuned at one sampling density is not
   * evidence about another. If the softness is wanted everywhere, the honest edit is to drop the branch entirely
   * rather than guess a second number. */
  renderScale: gpu.integrated ? 0.5 : 1.0,
  };
}
