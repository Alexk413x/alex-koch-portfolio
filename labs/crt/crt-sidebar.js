/* crt-sidebar.js — which controls exist, and how each one reads.
 *
 * SECTIONS IS PURE DATA and has no dependencies whatever. FMT has exactly three — state, cssPx and textGrid — and
 * takes them as arguments rather than importing them, because two of the three are measured from a live canvas. A
 * formatter that reached for the DOM could not be unit-tested; one handed its inputs can be.
 */

// HOW A VALUE READS IN THE PANEL. Formatters only ever produce display text -- none of them may alter state.
export function makeFmt({ state, cssPx, textGrid }) {
  const FMT = {
  corner:  (v) => Math.round(v) + '°',
  /* BEND AS THE ARC ITS EDGE SWEEPS, which is the one angle it honestly has. SQUIRCLE has a landmark — at 90 the
   * exponent is exactly 2, a circle — so degrees mean something absolute there. BEND has no such point: it is a bow
   * depth, normalized so the bulge cannot leave the glass.
   *
   * What IS measurable is the arc the bowed edge describes: with sagitta s at the edge midpoint and half chord L to
   * the corner, the included angle is 4·atan(s/L). Straight reads 0° and every value above it is a real arc.
   *
   * Computed from the CURRENT outline rather than a formula, because the sagitta depends on SQUIRCLE and the aspect
   * too. Memoized on those three, since it runs guideOutline. */
  bend:    (v) => Math.round(v) + '%',
  spot:    (v) => v.toFixed(2) + 'px',
  face:    (v) => Math.abs(v) < 0.006 ? 'FLAT'
                : (v > 0 ? 'OUT ' : 'IN ') + Math.abs(v * 90).toFixed(0) + '°',
  // Signed, so -20% and +20% cannot be confused at a glance.
  overscan:(v) => (v >= 1 ? '+' : '') + ((v - 1) * 100).toFixed(1) + '%',
  vig:     (v) => Math.round(v * 100) + '%',
  grille:  (v) => v < 0.5 ? 'OFF' : Math.round(v) + ' PPI',
  scanw:   (v) => v.toFixed(2) + 'px',
  grillew: (v) => v.toFixed(2) + 'px',
  scanop:  (v) => Math.round(v) + '%',
  grilleop:(v) => Math.round(v) + '%',
  bright:  (v) => Math.round(v * 100) + ' nt',
  phos:    (v) => Math.round(v * 100) + '%',
  flickHz: (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'Hz',
  fstr:    (v) => Math.round(v * 100) + '%',
  lflickA: (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'Hz',
  lflickB: (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'Hz',
  lfstrA:  (v) => Math.round(v * 100) + '%',
  lfstrB:  (v) => Math.round(v * 100) + '%',
  lfjit:   (v) => Math.round(v * 100) + '%',
  lfchaos: (v) => Math.round(v * 100) + '%',
  // Kelvin a full strike is worth. The reference's own figure is 1500; the clamp holds it to 2200..9000.
  tubeDead:(v) => v < 0.005 ? 'BLACK' : Math.round(v * 100) + '%',
  lfwarmK: (v) => v < 25 ? 'NONE' : '±' + Math.round(v) + 'K',
  lfhdip:  (v) => v < 0.025 ? 'NONE' : v.toFixed(2) + '×',
  /* TENTHS, TO MATCH WHAT THE CONTROL ACTUALLY DOES. The lamp's decay has ten discernible states and the
   * control steps through them one at a time -- a 1% step moved the number without moving the picture for nine
   * ticks out of ten, which reads as a broken slider rather than a fine one. */
  healthA: (v) => Math.round(v * 100) + '%',
  healthB: (v) => Math.round(v * 100) + '%',
  tempA:   (v) => Math.round(v) + 'K',
  tempB:   (v) => Math.round(v) + 'K',
  lightA:  (v) => Math.round(v * 100) + '%',
  lightB:  (v) => Math.round(v * 100) + '%',
  fixTilt: (v) => (v * 57.2958).toFixed(0) + '°',
  sheen:   (v) => Math.round(v * 100) + '%',
  glare:   (v) => Math.round(v * 100) + '%',
  // HOW FAR THE LIGHT TRAVELS SIDEWAYS INSIDE THE GLASS BEFORE IT LEAVES -- the halo's reach.
  scatterCM:(v) => (v / 10).toFixed(1) + 'cm',
  matte:   (v) => Math.round(v * 100) + '%',
  renderScale: (v) => Math.round(v * 100) + '%',
  // OFF below 1, FULL at 20, and each step is one grid cell (5%).
  grings:  (v) => { const n = Math.round(v); return n < 1 ? 'OFF' : n >= 20 ? 'FULL' : (n * 5) + '%'; },
  /* EVEN at 1, ^N above it -- the lab's format -- with the KNEE beside it: the fraction of the band, in from the
   * rim, inside which half the sag has happened. 0.5^(1/p), so 50% at EVEN and 13% at ^5. */
  /* THE TEXT SECTION READS OUT WHAT THE SETTING BUYS, NOT ONLY WHAT IT IS SET TO. SL is scanlines and COL is grille
   * columns, but a cell height is only half an answer — what you want to know is how many ROWS of it fit, and that
   * is not a division to do in your head on every drag. Same for the block: TEXT WIDTH is a percentage of the
   * picture, and what that percentage MEANS is a column count.
   *
   * COMPACT, because the value field is narrow and a spelled-out form overruns the steppers either side of it.
   *
   * These call textGrid(), which is why contentPx is declared up with cssPx rather than beside resize(). */
  tcell:   (v) => Math.round(v) + 'SL/' +
                  Math.max(1, Math.floor(textGrid().nSL / Math.max(1, v + state.tgap))) + 'R',
  // THE PITCH BESIDE IT, because the pitch is what actually spaces the rows -- the gap alone never appears.
  tgap:    (v) => Math.round(v) + 'SL/' + Math.round(state.tcell + v) + 'P',
  // AUTO STILL SAYS WHAT IT CHOSE. "AUTO" alone reports that a decision was made and not what it decided.
  tcols:   (v) => { const g = textGrid();
                    return v < 1 ? 'AUTO ' + Math.round(g.charW / g.colW) + 'C' : Math.round(v) + ' COL'; },
  tw:      (v) => { const g = textGrid();
                    return (v < 1 ? 'AUTO' : Math.round(v) + '%') + ' ' +
                           Math.max(1, Math.floor(g.W * (v < 1 ? 100 : v) / 100 / g.charW)) + 'C'; },
  tht:     (v) => { const g = textGrid();
                    return v < 1 ? 'AUTO' : Math.round(v) + '% ' +
                           Math.max(1, Math.floor(g.H * v / 100 / g.pitch)) + 'R'; },
  // A PERCENTAGE OF THE PICTURE, from its center -- so the unit belongs on the readout, as the reference has it.
  tox:     (v) => Math.round(v) + '%',
  toy:     (v) => Math.round(v) + '%',
  /* A WORD IS FIVE CHARACTERS, by the usual convention -- the same x350 the reference prints. This is the one
   * control in the section that does NOT get its consequence printed beside it: characters per second is the
   * same number said again (WPM x 5 / 60), not a second fact, and "350WPM/29cps" measured 12 characters in a
   * field that holds about ten. A real unit on its own beats a real unit plus its own restatement, clipped. */
  type:    (v) => Math.round(v * 350) + ' WPM',
  // Seconds, two places -- the DOM build's own format for the same two controls.
  collapse:(v) => v.toFixed(2) + 's',
  ignite:  (v) => v.toFixed(2) + 's',
  /* GAUSS AND HERTZ, the DOM build's own formulas for FIELD and WIGGLE -- 250 G per unit and 8 Hz per unit. The
   * ranges here are wider than the reference's, so the numbers run past what its panel could show; that is the
   * point of the wider range and not a reason to renormalize the unit underneath it. */
  wint:    (v) => v < 0.001 ? 'OFF' : Math.round(v * 250) + ' G',
  wwig:    (v) => Math.round(v * 8) + ' Hz',
  warpSec: (v) => v.toFixed(1) + 's',
  // The three field terms as a percentage of the picture they displace it by, at full FIELD.
  warpPinch:(v) => Math.round(v * 100) + '%',
  warpPull: (v) => Math.round(v * 100) + '%',
  // The whole picture's travel at full field, as a share of its own width -- and in px beside it, because a
  // percentage of the raster is the one unit that says how far the tube's contents actually move.
  warpDrag: (v) => v < 0.002 ? 'OFF' : Math.round(v * 100) + '% · ' + Math.round(v * cssPx.w) + 'px',
  warpSwirl:(v) => Math.round(v * 100) + '%',
  // How far past rest the raster rings on the rebound. 0 is a dead sweep with no spring in it at all.
  warpSpring:(v) => v < 0.005 ? 'DEAD' : Math.round(v * 100) + '%',
  warpR:    (v) => Math.round(v * 100) + '% W',
  // WHAT IT ACTUALLY BUYS: how much of the half-width stays clamped. 0.55 pins the outer 45%.
  warpRim:  (v) => v <= 0.001 ? 'ALL' : Math.round((1 - v) * 100) + '% PINNED',
  // CSS px, the unit the CONVERGENCE rows this one adds to are already in.
  warpRGB:  (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'px',
  // x1 IS THE REFERENCE'S OWN FAULT. Anything else is this build exaggerating or damping it, so it reads as a
  // multiplier rather than a percentage -- 0 is "the fault does not touch this at all".
  surgeScreen:(v) => v < 0.001 ? 'NONE' : v.toFixed(2) + '×',
  surgeLamp:  (v) => v < 0.001 ? 'NONE' : v.toFixed(2) + '×',
  surgeHealth:(v) => Math.round(v * 100) + '%',
  // Kelvin the arc is dragged DOWN by at the fault's deepest. 1500 is the reference's own figure.
  surgeWarm:  (v) => v < 1 ? 'NONE' : '-' + Math.round(v) + 'K',
  surgeHz:    (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'Hz',
  surgeLampHz:(v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'Hz',
  surgeStr:   (v) => Math.round(v * 100) + '%',
  // FIXED is the reference's guarantee: the identical fault every press. Anything above it redraws the grain.
  surgeChaos: (v) => v < 0.005 ? 'FIXED' : Math.round(v * 100) + '%',
  // The event is 4.6s at x1, so the readout says how long THIS setting makes it run.
  surgeRate:  (v) => (4.6 / v).toFixed(1) + 's',
  // A DISTANCE now, not a fraction of the radius -- reported in the px it actually measures.
  frameW:  (v) => Math.round(v) + 'px',
  glow:    (v) => Math.round(v) + ' nt',
  /* THE FIXTURE'S GEOMETRY IN PERCENT, because every one of these is already a FRACTION of the glass -- the
   * shader multiplies them straight into a space where 1 is the half-height. Printing the raw fraction made
   * eight rows read as unitless magic numbers ("0.02", "0.35") when they are all the same kind of quantity said
   * the same way. Nothing changes but the readout: the stored values and the shader are untouched. */
  /* MILLIMETERS, PRINTED AS MILLIMETERS. TUBE DIA names the standard it lands on, because T5/T8/T12 is how
   * anyone actually refers to a lamp, and TUBE INSET prints the LENGTH it produces -- that is the number you
   * are really choosing, and it is the one that has to be a real lamp size. */
  /* CENTIMETERS FOR THE FITTING ITSELF, millimeters only where the millimeter is the unit anyone actually
   * uses: a tube is a T8 at 26mm and nobody calls it 2.6cm. Everything you would describe out loud in cm --
   * how wide the housing is, how deep, how far apart the lamps sit -- reads in cm. */
  distMM:  (v) => (v / 1000).toFixed(2) + 'm',
  fixWmm:  (v) => (v / 10).toFixed(1) + 'cm',
  fixHmm:  (v) => (v / 10).toFixed(1) + 'cm',
  recessMM:(v) => (v / 10).toFixed(1) + 'cm',
  tubeDiaMM:(v) => { const t = v < 12 ? 'T4' : v < 20 ? 'T5' : v < 32 ? 'T8' : v < 44 ? 'T12' : '';
                     return Math.round(v) + 'mm' + (t ? ' ' + t : ''); },
  // PRINTS WHAT IT DECIDES. The inset is the handle; the tube LENGTH is the thing you are choosing, and it
  // is the one that has to come out a real lamp size -- 600, 900, 1200, 1500.
  tubeInsetMM:(v) => (v / 10).toFixed(1) + 'cm/' + ((Math.max(50, state.fixWmm - 2 * v)) / 10).toFixed(0) + 'L',
  tubeGapMM:(v) => (v / 10).toFixed(1) + 'cm',
  capMM:   (v) => Math.round(v) + 'mm',
  fixXmm:  (v) => (v / 10).toFixed(1) + 'cm',
  fixYmm:  (v) => (v / 10).toFixed(1) + 'cm',
  frost:   (v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  diffuse: (v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  prism:   (v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  prismN:  (v) => Math.round(v) + ' cells',
  railMM:  (v) => v < 0.5 ? 'OFF' : Math.round(v) + 'mm',
  glowA:    (v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  glowB:    (v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  boxVis:   (v) => v < 0.005 ? 'HIDDEN' : Math.round(v * 100) + '%',
  railVis:  (v) => v < 0.005 ? 'HIDDEN' : Math.round(v * 100) + '%',
  // AN ABSOLUTE LENGTH like the rest of the fixture's geometry, so it reads in the same percent they do.
  ripple:  (v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  glowFall:(v) => Math.round(v * 100) + '%',
  /* ONE NUMBER. A pitch and a density are reciprocals, so printing both was two readings of one setting and
   * something to reconcile rather than read. PPI is the one the reference's panel uses and the one worth talking
   * in, so it is the one that stays. */
  scan:    (v) => Math.round(v) + ' PPI',
  grille:  (v) => Math.round(v) + ' PPI',
  famp:    (v) => v.toFixed(2) + '×',
  fexp:    (v) => (v <= 1.05 ? 'EVEN' : '^' + v.toFixed(1)) +
                  ' \u00b7 ' + Math.round(Math.pow(0.5, 1 / Math.max(v, 1e-6)) * 100) + '%',
  convRX:  (v) => (v > 0 ? '+' : '') + Math.round(v) + 'px',
  convRY:  (v) => (v > 0 ? '+' : '') + Math.round(v) + 'px',
  convGX:  (v) => (v > 0 ? '+' : '') + Math.round(v) + 'px',
  convGY:  (v) => (v > 0 ? '+' : '') + Math.round(v) + 'px',
  convBX:  (v) => (v > 0 ? '+' : '') + Math.round(v) + 'px',
  convBY:  (v) => (v > 0 ? '+' : '') + Math.round(v) + 'px',

  sweepOn: (v) => Math.round(v * 100) + '%',
  /* THE PERIOD, PRINTED AS ITSELF. SWEEP RATE is how long the beam takes to fall down the picture once;
   * TIP RATE is how long the tip takes to go across and come back. Both parked at zero. */
  sweepSec:  (v) => v < 0.5 ? 'OFF' : Math.round(v) + 's',
  hsweepSec: (v) => v < 0.5 ? 'OFF' : Math.round(v) + 's',
  // SL is scanlines, COL is grille columns -- the raster's own units, as the TERMINAL section uses.
  sweepSL: (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' SL',
  dotH:    (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' SL',
  dotW:    (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' COL',
  /* THE TIP'S RATE READS AS THE TIME IT TAKES TO CROSS, the way SWEEP RATE reads as the time to fall -- a period
   * is the thing you can see happening, a rate is the reciprocal of it. The rest are screen distances. */
  sweepSol:(v) => Math.round(v * 100) + '%',
  // 0 is the phosphor's own color, 100% is bare excitation -- see the note where beamCol is built.
  sweepWhite:(v) => Math.round(v * 100) + '%',
  sweepDip:(v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  dipNoise:(v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  // THE EXTRA CONVERGENCE ERROR THE BEAM BRINGS WITH IT, in grille columns like the tip's own split.
  beamConvC:(v) => v < 0.01 ? 'OFF' : v.toFixed(2) + ' COL',
  // IN SWEEP HEIGHTS, because that is what it is measured against -- a taller beam casts a longer shadow.
  dipFall: (v) => v.toFixed(1) + 'h',
  sweepRGB:(v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'px',
  dotNits: (v) => Math.round(v) + ' nt',
  sweepStep:(v) => v < 0.01 ? 'OFF' : v.toFixed(2) + ' SL',
  dotHaloNits:(v) => v < 0.5 ? 'OFF' : Math.round(v) + ' nt',
  // IN GRILLE COLUMNS, matching TIP WIDTH -- one column of split is one cell of misconvergence.
  tipRGBc:(v) => v < 0.01 ? 'OFF' : v.toFixed(2) + ' COL',
  tipRGBr:(v) => v < 0.01 ? 'OFF' : v.toFixed(2) + ' SL',
  beamPull:(v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'px',
  // HOW MUCH MORE than BEAM PULL a fully-lit pixel drags: 50% means half again where the gun is wide open.
  pullInk: (v) => v < 0.005 ? 'OFF' : '+' + Math.round(v * 100) + '%',
  bloom:   (v) => Math.round(v * 100) + '%',
  bloomThresh:(v) => Math.round(v * 100) + '%',
  // A RADIUS, so it reads in the CSS pixels it is specified in -- the same unit the reference's BLOOM uses.
  bloomSize:(v) => Math.round(v) + 'px',
  persist: (v) => Math.round(v * 100) + '%',
  frame:   (v) => Math.round(v * 100) + '%',
  /* THE THREE LIGHTS ON THE MOLDING ARE FRACTIONS, SO THEY READ AS PERCENTAGES. They were falling through to the
   * default formatter, which prints two decimals for any range at or under 40 -- so a 0..1 amount read "0.35". A
   * bare decimal is not a unit: it makes you work out what the top of the range is before the number means
   * anything, and it read differently from FRAME and TINT directly above, which are the same kind of quantity. */
  frameFixture:(v) => Math.round(v * 100) + '%',
  frameScreen:(v) => Math.round(v * 100) + '%',
  frameBleed:(v) => Math.round(v * 100) + '%',
  guidesOn:(v) => v ? 'ON' : 'OFF',
  heat:    (v) => v ? 'ON' : 'OFF',
  gridOn:  (v) => v ? 'ON' : 'OFF',
  };
  return FMT;
}

// WHAT THE PANEL CONTAINS, top to bottom. Rows are [key, label, min, max, step]; a section is [title, rows].
export const SECTIONS = [
  /* DEBUG FIRST, ABOVE THE TUBE. It sits above everything it measures because it is the thing you reach for WHILE
   * tuning the rows below it, and hunting to the bottom of sixty-one controls to switch a guide on defeats the point
   * of the master. Collapsed by default, so it costs one line when off.
   *
   * WITH A MASTER, and each instrument a plain on/off: a 0..1 slider with a stepper either side is three widgets and
   * a numeric readout to express a boolean. Third element names the section's master key. */
  ['DEBUG', [['guidesOn','GUIDE',0,1,1],['heat','ELEVATION',0,1,1],['gridOn','GRID',0,1,1],
             ['fixSolo','FIXTURE',0,1,1]], 'debugOn'],
  /* OUTSIDE-IN, AND GOVERNING CONTROL FIRST. SQUIRCLE decides the outline and BEND bows the runs of it, so BEND
   * cannot be reasoned about until SQUIRCLE has been -- that pairing is the pattern every section below follows.
   * OVERSCAN is last because it is a relationship between the raster and the glass, and there is no glass to
   * relate it to until the six above it have been set. */
  /* RENDER ABOVE THE TUBE. It sets the resolution everything below is drawn at, so it governs every
   * section rather than belonging to one -- and it is the control you reach for first when the frame
   * rate is wrong, which is not a reason to scroll past sixty rows. */
  ['RENDER', [['renderScale','RENDER SCALE',0.35,1,0.01]]],
  ['TUBE', [['corner','SQUIRCLE',0,90,1],['bend','BEND',0,100,1],
            /* FACE is the amount of curve; CURVE AREA is how far in from the rim it is spread; FALLOFF is where
             * within that band it actually arrives. The two below FACE only mean anything relative to it, so
             * they sit under it. */
            ['face','FACE',-1,1,0.01],['grings','CURVE AREA',0,20,1],['fexp','FALLOFF',1,5,0.1],['famp','DEPTH',0,6,0.05],
            ['vig','VIGNETTE',0,1,0.01],
            /* OVERSCAN RUNS BOTH WAYS, -50% to +50%. It was 1..1.15, so it could only ever magnify -- which
             * covers a real tube, where overscan means the raster is driven past the visible glass, but not this
             * instrument, where pulling the picture back inside the rim to see what the projection is doing to it
             * is exactly the sort of thing the panel is for. The stored value is the DIVISOR the shader applies,
             * so 0.5 is half size and 1.5 is half again; the readout converts. */
            ['overscan','OVERSCAN',0.5,1.5,0.005],
            /* CONVERGENCE LIVES WITH THE TUBE, not the raster. It is the three guns failing to land on the same triad — a
             * property of the gun assembly and the yoke, which is why a service manual has static convergence
             * adjustments on the set and not on the signal.
             *
             * SIGNED, because misconvergence has a direction: a positive-only range could only put red outside and
             * blue in, and a real tube can be out either way.
             *
             * IN PIXELS AT THE RIM. The error is exact on axis by construction and grows as rn², so a single distance
             * only means anything if you say WHERE. The page converts to the shader's uv units against the stage's own
             * size, which is what makes the number survive a resize. */]],

  /* GLASS SITS WITH THE TUBE, because it IS the tube's front surface. It used to be filed after FIXTURE, which
   * put it next to the thing it reflects rather than next to the thing it belongs to -- and that is backwards:
   * the fitting is one of several things the faceplate can show, while the faceplate is part of the tube whether
   * anything is being reflected in it or not.
   *
   * Within the section: the room is the source, the glass is the medium, MATTE is its finish -- and the finish
   * governs how SHEEN and GLARE come back off it, so it sits above them rather than being filed after. */
  ['GLASS', [['glare','GLARE',0,1,0.01],['matte','MATTE',0,1,0.01],
             ['sheen','SHEEN',0,1,0.01],['scatterCM','SCATTER',1,200,1]]],

  /* THE MOLDING GOES WITH THE GLASS IT HOLDS. Reading down, the panel walks OUTWARD from the picture: the tube's
   * shape, the faceplate over it, the bezel around that. Filed after FIXTURE it would put the physical front of the
   * set below the room being reflected in it, and the frame is there whether the light is on or not.
   *
   * COLOR FIRST within the section: it is the molding's material, and every other row is a departure FROM it.
   * FRAME CARRIES ITS OWN MASTER — with no molding there is nothing for COLOR, WIDTH or the three lights to
   * describe. */
  ['FRAME', [['frameCol','COLOR','#'],['frame','FRAME',0,1.5,0.01],['frameW','WIDTH',1,30,1],
                          /* Ordered by how broad each light is: the whole layer, then the lamp, then the local
              * pool that only answers for the content immediately beside a given piece of plastic. */
             /* The fixture first: it is the room's light, and the screen's own glow is a reflection of
              * something the tube is doing -- so the external source sits above the internal one. */
             ['frameFixture','LIGHT FIXTURE',0,1,0.01],['frameScreen','SCREEN GLOW',0,1,0.01],
             ['frameBleed','SCREEN BLEED',0,1,0.01]], 'frameOn'],

  // Density governs the width and level that ride on it, so each axis is a triplet in that order.
  /* CONVERGENCE, IN ITS OWN COLLAPSIBLE SECTION. Six rows describing one adjustment is a lot of panel to scroll
   * past when you are not setting the guns up, and the master doubles as a bypass: off means the three rasters
   * land exactly on each other, which is the reference every one of these numbers is measured against.
   *
   * It sits after TUBE and before RASTER because it belongs to the gun assembly -- the thing that PAINTS the
   * raster -- rather than to the pattern being painted. */
  ['CONVERGENCE', [['convRX','RED X',-200,200,1],['convRY','RED Y',-200,200,1],
            ['convGX','GREEN X',-200,200,1],['convGY','GREEN Y',-200,200,1],
            ['convBX','BLUE X',-200,200,1],['convBY','BLUE Y',-200,200,1]], 'convOn'],

  ['RASTER', [['scan','SCANLINES H',5,30,1],['scanw','WIDTH H',0.25,4,0.25],['scanop','LEVEL H',0,100,1],
              ['grille','SCANLINES V',5,30,1],['grillew','WIDTH V',0.25,4,0.25],['grilleop','LEVEL V',0,100,1],
              ]],

  /* The beam and the coating it excites, then the light that escapes them, then what modulates the whole thing.
   * PERSISTENCE is a property of that coating rather than an effect applied afterwards, so it sits with the beam
   * controls; BLOOM KNEE depends on BLOOM and follows it. */
  /* WASH DIRECTLY UNDER BRIGHTNESS. They are the coating's two output levels -- BRIGHTNESS is what the beam
   * drives, WASH is what the rest of it glows at from scatter -- and everything after them (the spot, the
   * persistence, the bloom) is a description of how that light SPREADS. Levels first, then spread. */
  ['PHOSPHOR', [['bright','BRIGHTNESS',0,2,0.01],['phos','WASH',0,1,0.01],
                ['glow','SCREEN GLOW',0,30,1],['glowFall','GLOW FALLOFF',0.01,0.5,0.005],
                ['spot','BEAM SPOT',0,10,0.05],
                ['persist','PERSISTENCE',0,0.95,0.01],
                ['bloom','BLOOM',0,2,0.01],['bloomSize','BLOOM SIZE',0,40,0.5],['bloomThresh','BLOOM KNEE',0,1,0.01],
                ['flickHz','FLICKER',0,20,0.1],['fstr','FLICK STR',0,1,0.01]]],

  /* THE BAND, THEN THE TIP THAT DRAWS IT, THEN WHAT THE TIP DISTURBS. Reading down is reading from the whole
   * sweep to the single moving point that makes it, which is the order the thing actually happens in. */
  ['BEAM', [['sweepOn','SWEEPS',0,1,0.01],['sweepSec','SWEEP RATE',0,120,1],
            ['sweepSL','SWEEP HEIGHT',0.25,40,0.25],['sweepStep','SWEEP STEP',0,20,0.25],
            ['sweepSol','SOLIDITY',0,1,0.01],['sweepRGB','SWEEP RGB',0,20,0.5],['sweepWhite','SWEEP TINT',0,1,0.01],
            ['sweepDip','AHEAD DIP',0,1,0.01],['dipFall','DIP FALL',0.5,60,0.5],
            ['dipNoise','DIP STATIC',0,1,0.01],
            ['hsweepSec','TIP RATE',0,120,1],['dotH','TIP HEIGHT',0.25,40,0.25],['dotW','TIP WIDTH',0.25,40,0.25],
            ['dotNits','TIP GLOW',0,300,1],['dotHaloNits','TIP HALO',0,300,1],
            ['tipRGBc','TIP RGB H',0,20,0.25],['tipRGBr','TIP RGB V',0,20,0.25],
            ['beamPull','BEAM PULL',0,20,0.5],['pullInk','INK PULL',0,2,0.01],
            ['beamConvC','BEAM RGB',0,20,0.25]], 'beamOn'],
  // Size governs row height, and both govern where the block can sit -- so placement comes after them.
  /* THE CELL FIRST, THEN THE BLOCK, THEN WHERE THE BLOCK SITS. ROW HEIGHT / LINE GAP / CHAR WIDTH describe one
   * character's cell in raster units; ALIGN and ANCHOR say which edge the lines are nailed to; then WIDTH,
   * HEIGHT and TEXT X/Y are the box itself -- how big it is and where it sits. Reading top to bottom is reading
   * outward from the glyph, and the four rows that describe one rectangle are adjacent rather than split by the
   * toggles. WIDTH and HEIGHT drop the TEXT prefix because every row in this section is about the text; the
   * position pair keeps it only because X and Y alone would not say what they moved. */
  /* ABOVE FIXTURE, because the panel reads outward from the picture and the terminal IS the picture. Everything
   * before this describes the tube and what it draws; FIXTURE is the room the tube is standing in. Filing the
   * text after the light fitting put the most-reached section of the panel behind twenty-nine rows of millimeters
   * describing a lamp. */
  ['TERMINAL', [['type','TYPE SPEED',0.3,3,0.05],
                ['tcell','ROW HEIGHT',1,16,1],['tgap','LINE GAP',0,8,1],['tcols','CHAR WIDTH',0,12,1],
                ['tjust','ALIGN',['LEFT','CENTER','RIGHT']],
                ['tvert','ANCHOR',['BOTTOM','TOP']],
                ['tw','WIDTH',0,200,1],['tht','HEIGHT',0,200,1],
                ['tox','TEXT X',-50,50,1],['toy','TEXT Y',-50,50,1]]],

  /* Master switch and color, then the housing, then the tubes INSIDE that housing (its size defines the space
   * they occupy, so it has to be settled first), then where the finished assembly sits, then each tube's own
   * condition as a HEALTH / FLICKER / STRENGTH triplet, then the light it throws beyond itself. */
  /* SIZE FIRST, THEN THE LAMPS INSIDE IT, THEN WHAT COVERS THEM, THEN THEIR CONDITION. Reading down is
   * building the fitting: housing, tubes, diffuser, and only then how well the lamps are working. */
  ['FIXTURE', [['distMM','DISTANCE',300,6000,20],
               ['fixWmm','HOUSING W',200,2400,10],['fixHmm','HOUSING H',100,1500,10],
               ['recessMM','RECESS',10,400,5],
               ['tubeDiaMM','TUBE DIA',8,60,1],['tubeInsetMM','TUBE INSET',0,400,5],
               ['tubeGapMM','TUBE SPACING',0,800,5],['capMM','CAP LENGTH',0,120,1],
               ['fixXmm','POS X',-2500,2500,10],['fixYmm','POS Y',-1500,1500,10],['fixTilt','TILT',0,1.4,0.02],
               ['frost','FROST',0,1,0.01],['diffuse','DIFFUSER',0,1,0.01],
               ['prism','PRISM',0,1,0.01],['prismN','PRISM CELLS',2,40,1],
               ['railMM','RAILS',0,150,1],['railVis','RAIL FADE',0,1,0.01],['boxVis','BOX',0,1,0.01],
               /* ONE LAMP PER BLOCK. Level, color, condition, then how it fails -- everything about tube A
                * together and everything about tube B together, so a mismatched pair is set by reading down
                * one block and then the other rather than by hopping between six interleaved rows. */
               /* HOW DEAD A DEAD SECTION LOOKS. Sits above the per-lamp blocks because it describes what HEALTH
                * MEANS -- at 0 a spent middle is black and the tube reads as two glowing ends, at 1 it is the
                * old floor where a fully dead center still measured half as bright as the ends. */
               ['tubeDead','DEAD COATING',0,1,0.01],
               ['lightA','LIGHT A',0,1,0.01],['glowA','GLOW A',0,1,0.01],['tempA','TEMP A',2200,6500,50],['healthA','HEALTH A',0,1,0.1],
               ['lflickA','FLICKER A',0,20,0.1],['lfstrA','FLICK STR A',0,1,0.01],
               ['lightB','LIGHT B',0,1,0.01],['glowB','GLOW B',0,1,0.01],['tempB','TEMP B',2200,6500,50],['healthB','HEALTH B',0,1,0.1],
               ['lflickB','FLICKER B',0,20,0.1],['lfstrB','FLICK STR B',0,1,0.01],
               /* SHARED BY BOTH TUBES, so they sit after the pair rather than inside either block. bulbFlick has
                * taken these since it was written -- JITTER scatters each cycle's PERIOD, CHAOS scatters how deep
                * each dip goes and triggers the re-strike overshoots -- and this build simply never gave them a
                * row, so two of the four things shaping the fixture's flicker were unreachable at their defaults.
                * The reference carries both under LIGHT FLICKER; same names, same ranges. */
               ['lfjit','FLICK JITTER',0,1,0.01],['lfchaos','FLICK CHAOS',0,1,0.01],
               /* WHAT A STRIKE IS WORTH. CHAOS above decides how OFTEN the arc misfires; these two decide how
                * far it goes when it does -- the color it comes back at, and how much coating it drops. Both
                * multiply the machine's own picks, so the timing stays its decision. */
               ['lfwarmK','COLOR STRIKE',0,6000,50],['lfhdip','HEALTH DIP',0,4,0.05],
               ['ripple','MAINS RIPPLE',0,1,0.01]], 'lightOn'],
  /* LAST, AS THE REFERENCE FILES IT. Two durations: how long the raster takes to fall in, and how long it takes
   * to open back up. WARM-UP is the one that also sets when the boot text starts, because typing begins half a
   * second after the tube has finished striking -- derived from this rather than being a flat delay that only
   * lands correctly at one setting. The ranges and the labels are the DOM build's own. */
  ['POWER', [['collapse','COLLAPSE',0.3,2,0.05],['ignite','WARM-UP',0.3,2,0.05]]],

  /* THE MAGNET. FIELD, WIGGLE and DURATION are the reference's three, at its ranges; the rest describe the SHAPE
   * of the field, which is the thing a displacement on the beam's coordinate can express and a CSS transform on
   * one element cannot. Ordered as the effect is built: how hard and how long, then what the field is made of,
   * then where it reaches and what it does to the guns.
   *
   * THE RANGES GO WELL PAST PLAUSIBLE ON PURPOSE. A degaussing coil held against the glass is not a subtle
   * instrument, and this is a lab -- the useful settings for "what does the projection do under a hard pull" are
   * nowhere near the useful settings for "a magnet walked past the desk". */
  ['WARP', [['wint','FIELD',0,4,0.05],['wwig','WIGGLE',0,6,0.05],['warpSec','DURATION',0.2,12,0.1],
            /* THE WHOLE PICTURE LEANING, with no falloff -- the only term here that is not bounded by the pole's
             * own radius, and therefore the only one that can move the tube's entire raster at once. */
            ['warpDrag','DRAG',0,0.6,0.005],
            ['warpPull','PULL',0,2,0.01],
            // How much of the motion is the raster ringing back through rest rather than following the field.
            ['warpSpring','SPRING',0,1.5,0.01],
            ['warpPinch','PINCH',0,1.5,0.01],['warpSwirl','SWIRL',0,2,0.01],
            ['warpR','REACH',0.05,2.5,0.01],
            /* HOW MUCH OF THE PICTURE STAYS WELDED TO THE GLASS. The deflection error goes to zero where the
             * raster is clamped, so this is the one control that decides whether the effect reads as a magnet
             * on a tube or as a photograph being dragged around. */
            ['warpRim','EDGE HOLD',0,0.98,0.01],
            ['warpRGB','GUN SPLIT',0,140,0.5]]],

  /* THE MAINS FAULT. crt-flicker's timeline is fixed -- it is a scripted event and the shape IS the point -- so
   * every row here is how hard this build spends it, not what happens when. TUBE and FIXTURE first, because they
   * are the two things the fault has to move together; then the three that make it a FAULT rather than a dimmer
   * (color, health, and the guttering on top); then RATE, which is the whole event's clock. */
  ['SURGE', [['surgeScreen','TUBE',0,3,0.05],['surgeLamp','FIXTURE',0,3,0.05],
             ['surgeWarm','COLOR DROP',0,4000,50],
             ['surgeHealth','STARVE',0,1,0.01],
             ['surgeHz','GUTTER RATE',0,60,0.5],['surgeStr','GUTTER DEPTH',0,1,0.01],
             ['surgeLampHz','LAMP GUTTER',0,40,0.5],
             /* HOW MUCH OF THE FAULT IS NOT AUTHORED. At 0 it is the reference's event exactly -- the same chop
              * in the same places every press, which is what that module set out to guarantee. Turned up, the
              * SHAPE still comes from the timeline and only the grain is redrawn: where the guttering bites, and
              * how many times the supply fails to restrike while the breaker is out. */
             ['surgeChaos','CHAOS',0,1,0.01],
             ['surgeRate','RATE',0.15,4,0.05]]],

  // RINGS only means anything to HEAT MAP, so it sits under it rather than after GRID.
  // RINGS is gone: it was CURVE AREA under another name, and two sliders on one value can disagree.

];
