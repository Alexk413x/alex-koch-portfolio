/* The intro's configuration: the shipped tube, off, waiting to be struck. The warp and the fault run at the
 * lab's own length so the detail in them reads; the intro's beat is sized to let them finish before the power
 * is cut. The type runs at a reading pace, since the boot text is the one thing the intro asks to be read. Render scale is capped: this frame shares a thread with two more.
 */
export function introPreset(gpu) {
  return {
    ...defaultPreset(gpu),
    power: 0,
    // The fitting starts dark; the director strikes it with the tube.
    lightOn: 0,
    type: 1.1,
    // The warp outlasts the power: it is still pulling, gathered to the middle, as the picture collapses.
    warpSec: 4.4, warpGather: 1,
    surgeRate: 1.0,
    // The fault's screen share is low so the picture never blacks out on its own before the power is cut, and
    // the lamp's share high so its flash is the peak the cut lands on.
    surgeScreen: 0.35, surgeLamp: 1.3,
    // The room's light and the tube gutter harder here than in the lab: it is atmosphere, not a calibration.
    flickHz: 7, fstr: 0.5, lflickA: 11, lflickB: 7, lfstrA: 0.75, lfstrB: 0.9, lfchaos: 0.7,
    // The bare tube, filling the frame: the molding is the lab's, and here the screen is the whole screen. The
    // glass edge is a wide vignette rather than a line, and the sides bend less so the curve lives in the corners.
    frameOn: 0,
    vig: 0.85, vigFall: 0.45,
    bend: 3, corner: 20,
    collapse: 0.75, ignite: 1.5,
    renderScale: gpu && gpu.integrated ? 0.45 : 0.8,
  };
}

// The shipped preset values, held apart from the scene so a second view can drive it from different starting values.
// `gpu` is a parameter, not an import — this module has no renderer to ask before one exists.
export function defaultPreset(gpu) {
  return {
  power: 1, lightOn: 1,
  // Seconds for the tube's collapse and warm-up, at the reference's own defaults — duration only; the poses
  // and easing are fixed, since a collapse is the strike played backward.
  collapse: 1, ignite: 1,
  // wint/wwig/warpSec mirror the reference's FIELD/WIGGLE/DURATION. Here the warp is a displacement field on
  // the beam's coordinate, so its shape splits into drag, pull, twist and rim clamp below.
  wint: 2.7, wwig: 4, warpSec: 5.4,
  // warpPull/warpPinch/warpSwirl are bounded by the pole's own gaussian and can only ever disturb a local patch.
  // warpDrag has no falloff, so it alone leans the whole picture with the pole.
  warpDrag: 0.205, warpPull: 0.18, warpPinch: 0, warpSwirl: 0,
  warpSpring: 0.29,   // how much of the motion is the raster ringing back rather than following the field
  warpGather: 0,      // how far the pole is drawn to the middle over the run's last part; the intro sets it
  // warpR is wide because the pole orbits: a wide field on a straight path reads as a global wave, but on an
  // orbit it reads as a large area being swung, like a coil held against the glass.
  warpR: 1.64,        // the pole's reach, in picture widths
  warpRim: 0,      // how far out the clamp starts -- 1 pins only the last pixel, 0 pins nearly everything
  // warpRGB and CONVERGENCE below are in CSS px, like every screen distance on this panel. The guns sit 120°
  // apart, so this is the triad's radius; at 31.5 the three rasters land a full glyph apart.
  warpRGB: 31.5,
  // crt-flicker owns the 4.6s mains-fault timeline. Each gain here scales the fault's departure from normal:
  // 1 is the reference's own event, 0 removes the channel, 3 exceeds what a real supply would survive.
  surgeScreen: 1, surgeLamp: 1, surgeWarm: 3300, surgeHealth: 1,
  // surgeRate paces the fault slower than the reference (0.55 puts it at 8.4s) so the dark stretch (0.9-1.6s)
  // has room for failed restrikes before it reads as suspense rather than a blip.
  surgeRate: 1,
  // Guttering the fault drives on top of the timeline, worst where the level is furthest from normal.
  surgeHz: 14, surgeStr: 0.75, surgeLampHz: 18,
  // How much of the fault is not authored: where the chop lands, and how many restrikes fail in the dark.
  // 0 is the reference's behavior -- the identical fault every press.
  surgeChaos: 0.7,
  face: 1, overscan: 1, corner: 30, bend: 6,
  frameOn: 1,            // the reference ships frameOn: true; off shows the bare tube
  frameCol: '#2d1b15',   // the molding's own plastic -- crt-bezel's default, and the reference's
  famp: 2.1,          // DEPTH: scales the fold-bounded amplitude; 1 is the reference's own depth
  // No FIT control: buildFaceLUT solves the face LUT for u=1 by construction at s=1, so a FIT reading the LUT's
  // last sample would always yield 1.0 — identical to forcing OVERSCAN to 100%, which OVERSCAN already does.
  fexp: 3, grings: 20,        // FALLOFF exponent and CURVE AREA, both tuned on this build rather than the reference's
  scan: 10, scanw: 1.0, scanop: 50, grille: 17, grillew: 1.0, grilleop: 40,
  glow: 1,          // SCREEN GLOW in nits -- the excited coating around active content, on BRIGHTNESS's scale
  glowFall: 0.095,  // how far past the block's own edge that excitation reaches
  // glow, glowFall and phos were tuned together (3->1, 0.13->0.095, 0.13->0.07): less excitation reaching less
  // far, over a dimmer wash -- lowering the wash alone would leave the text haloed on a face gone dark behind it.
  phos: 0.07, bloom: 0.5, bloomThresh: 0.72, bright: 0.7, beam: 1.0,
  // bloomSize is the blur radius in CSS px; 16 is the reference's own default. The reference's single bloom
  // control IS the width -- here BLOOM (the gain) and bloomSize (the reach) are separate.
  bloomSize: 16,
  vig: 0.5, vigFall: 0.22,
  // sweepSec stores the period in seconds, not the rate: a rate slider is wildly non-linear in perceived time,
  // cramming every useful setting into the last few pixels of travel. The reciprocal is taken once where it's
  // handed to the shader; 0 means parked.
  sweepSec: 20, sweepOn: 1,
  // sweepSL is in scanlines, not screen %: a 5% band drew 118 of 1250 rows and looked different per window
  // size. Scanlines tie the beam to the raster it's writing, so it resizes with the pattern.
  sweepSL: 0.25,
  // Beam-tip params, all CSS px unless noted: sweepSol is edge hardness (0 soft, 1 hard); sweepRGB is the guns'
  // split across the band; hsweep is the tip rate (1/hsweep seconds to cross); dotR/dotLvl are its radius and
  // drive; beamPull is how far the active line drags as the tip loads the supply.
  sweepSol: 1, sweepRGB: 2,
  // Tip glow in nits, same coating as the beam (90 nt tip vs 62 nt beam is about half again as hard). sweepStep
  // is in scanlines, like the rest of the beam's geometry.
  hsweepSec: 25, dotNits: 100, dotHaloNits: 0, tipRGBc: 0.5, tipRGBr: 0.25, beamConvC: 1.75, dipNoise: 0.75, pullInk: 0.85, sweepStep: 0.5, beamPull: 20,
  // The tip gets both axes in their own units -- height in scanlines, width in grille columns -- since one
  // round radius wouldn't fit the frame the beam actually works in.
  dotH: 0.5, dotW: 0.5,
  // The deficit ahead of the beam -- see the note in crt-gl. dipFall is in multiples of sweep height.
  sweepDip: 1, dipFall: 60, sweepWhite: 0,
  // CONVERGE as a signed percentage of the full-deflection error; 11 is 0.45px. Per-gun convergence is
  // uniform across the face -- static convergence, as a service manual means it.
  beamOn: 1,        // the whole sweep assembly; off also skips its per-pixel work
  convOn: 1, convRX: 1, convRY: -1, convGX: 3, convGY: 1, convBX: 1, convBY: -3, persist: 0.4,
  // Measured off the reference lab: opening 432x216px (half-extents 0.347 x 0.232 of glass half-size) on a
  // 1245x933 glass; tubes 76% wide at 29%/71% down the opening, 20 thick, ftilt 0.
  //
  // Fixture size is stored in millimeters, not a fraction of the glass, so an impossible fitting (a tube longer
  // than its housing, lamps closer than their own diameter) can't be represented. Tube length and cap size stay
  // derived from the housing/tube spec rather than stored separately. SCALE maps mm to the picture via the glass
  // half-height.
  //
  // mm-to-unit scale is a constant, not a control: apparent size is (real size/U)/(real distance/U), so U
  // cancels -- a slider here could only ever be a no-op or a bug.
  distMM: 1200,        // how far the fitting is from the glass
  fixWmm: 1200, fixHmm: 600, recessMM: 40,
  tubeDiaMM: 20,       // T8. T5 is 16, T12 is 38
  tubeInsetMM: 60,     // how far short of the housing each lamp stops -- tube LENGTH derives from this
  tubeGapMM: 250,      // between the two lamps' axes
  fixXmm: 550,
  // railMM matches the reference's measured rail ratio: 9.1875px on a 592.76px fitting (1.55%) ~ 18.6mm at
  // this 1200mm housing. Overhang and fade follow at 4x and 2x, also measured (36.55px and 18.28px).
  railMM: 20,
  capMM: 15,   // the ferrule -- flush with the glass, so this is only how far down the tube it reaches
  fixYmm: 680,
  frost: 0.1, diffuse: 0.1, prism: 0.5, prismN: 40,
  fixTilt: 1.276637,
  // One lamp at a time: its own level and color. Two tubes in one fitting are rarely the same age, and color
  // drift as a phosphor blend ages is most of what makes real fluorescent light read as real.
  lightA: 0.8, tempA: 5000,
  lightB: 0.8, tempB: 4400,
  healthA: 1.0, healthB: 1.0, lflickA: 6, lflickB: 3,
  // flickerOn is gone: it was a second gate on the lamps' flicker with no panel row, which could strand the
  // four FLICKER rows switched off with no way back. See the note at lampOn.
  lfstrA: 0.5, lfstrB: 0.7, lfjit: 0.72, lfchaos: 0.5, fstr: 0.3, flickHz: 3.5,
  // crt-flicker decides when a tube re-ignites and how far its coating stumbles; these scale what that's worth
  // on screen. Reference values are 1500K and gain 1 -- too quiet once the fitting is the thing being watched,
  // so these are honest multipliers on the machine's own picks; timing stays unpredictable, only amplitude moves.
  lfwarmK: 2600, lfhdip: 2.0,
  // tubeDead floors how much of a spent section still shows, so a dead tube reads as glass, not a hole. A
  // higher floor measured 118/255 against 239 lit -- too bright for a failed lamp; 0.18 leaves just enough body.
  tubeDead: 0.18,
  sheen: 0.06, matte: 0.0,
  // glare is a display-space transparency, not a linear-light reflectance -- see the note in crt-gl where
  // emisBare is taken. Not migrated from the older unit, so a stored session reads weaker until touched once.
  glare: 0.21,
  // scatterCM is a room distance, stored in cm and converted by SCALE like the fitting's own dimensions --
  // in bare shader units, changing SCALE would move the fitting but leave its glow the same size.
  scatterCM: 25,
  // How much of the face's curve the reflection takes. See the note where rd is built -- 1 is physical
  // and unusable, so this is a fraction and the useful settings are low.
  // ripple is the 100Hz mains beat every fluorescent has (twice the 50Hz supply). No separate tube-grain
  // texture besides it: at this size, grain and striation read as noise fighting the burnout pattern.
  // Matches the reference's --bgvis/--railvis: housing and rails fade independently of each other and the lamps.
  boxVis: 0.4, railVis: 0.29,
  glowA: 0.15, glowB: 0.15, ripple: 0,
  // spot is calibrated against a flat 4% reflectance so room light lights the whole face, not just the rim.
  // The reference ships lightOn:false; 0.5 measures 35.6 against its 13.4.
  spot: 1,
  // Text is measured in raster cells, not pixels -- see textGrid(). Cell height is in scanlines and cell width
  // is in grille columns, so text sits on the same lattice the scan pattern draws and a density change resizes
  // the type with it.
  tcell: 3, tgap: 1,   // ROW HEIGHT and LINE GAP, in scanlines
  tcols: 0,            // CHAR WIDTH, in grille columns; 0 = AUTO, i.e. derived from the font's own advance
  // 70/64 are the reference's own shipped values. Height isn't cosmetic: with ANCHOR BOTTOM the text stands on
  // the block's lower edge, so 64% puts the boot low on the tube; AUTO height instead centers the block on TEXT Y.
  tw: 74, tht: 67,     // the block's size as a % of the picture; 0 = AUTO (shrink to the text)
  tjust: 0,            // ALIGN: 0 left, 1 center, 2 right -- the ragged edge INSIDE the block
  type: 1.2,             // TYPE SPEED, x350 = WPM
  tox: 0, toy: 0,
  tvert: 0,        // 0 = anchor bottom (grows up), 1 = anchor top (grows down)
  // Which sections are folded. Only the closed ones are named: absent means open, so a section renamed or
  // added later stays open with no migration needed.
  secClosed: {
    BEAM: true, CONVERGENCE: true, FIXTURE: true, FRAME: true, GLASS: true, POWER: true,
    RASTER: true, SURGE: true, TERMINAL: true, TUBE: true, WARP: true,
  },
  // Every control needs a default here: fixSolo had a row and a read in the draw call but no entry, so it was
  // undefined until touched -- harmless only because the upload carries `|| 0`.
  debugOn: 0, guidesOn: 1, heat: 1, gridOn: 1, fixSolo: 0,
  phName: 'amber', phCustom: '#4c67f0',
  // frameW is in CSS px, matching what crt-bezel expects; 13 is the reference's own fwid.
  // frame is a post-tone-map opacity, not a pre-tone-map radiance -- same story as glare. A stored value keeps
  // its number and loses its meaning until the slider is touched.
  frame: 0.19, frameW: 13, frameBleed: 0.8,
  frameScreen: 1,     // the tube's output reflected across the bezel, in the screen's color
  frameFixture: 1,    // the light fixture, across the whole bezel, from wherever POS Y puts it
  // The integrated branch is chosen for look, not budget: downscaling averages the one-pixel shadow-mask
  // structure down far enough that the tube reads as an older, softer set. The discrete default stays 1.0 --
  // a look tuned at one sampling density says nothing about another, so extending the softness elsewhere means
  // dropping the branch rather than reusing this number.
  renderScale: gpu.integrated ? 0.5 : 1.0,
  };
}
