/* Panel schema: SECTIONS is pure data with no dependencies. FMT takes state/cssPx/textGrid as
 * arguments rather than importing them, since two of the three come from a live canvas — that keeps
 * formatters unit-testable without a DOM.
 */

// Builds the panel's value formatters. They only ever produce display text — never mutate state.
export function makeFmt({ state, cssPx, textGrid }) {
  const FMT = {
  corner:  (v) => Math.round(v) + '°',
  // Bend reads as the arc the bowed edge sweeps: 4*atan(s/L) from sagitta s and half-chord L,
  // computed from the current outline (memoized on SQUIRCLE/aspect/bend) since the sagitta depends on both.
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
  tubeDead:(v) => v < 0.005 ? 'BLACK' : Math.round(v * 100) + '%',
  lfwarmK: (v) => v < 25 ? 'NONE' : '±' + Math.round(v) + 'K',
  lfhdip:  (v) => v < 0.025 ? 'NONE' : v.toFixed(2) + '×',
  // Step is tenths, not percent: the lamp's decay only has ten discernible states, so a finer step
  // moved the number without moving the picture.
  healthA: (v) => Math.round(v * 100) + '%',
  healthB: (v) => Math.round(v * 100) + '%',
  tempA:   (v) => Math.round(v) + 'K',
  tempB:   (v) => Math.round(v) + 'K',
  lightA:  (v) => Math.round(v * 100) + '%',
  lightB:  (v) => Math.round(v * 100) + '%',
  fixTilt: (v) => (v * 57.2958).toFixed(0) + '°',
  sheen:   (v) => Math.round(v * 100) + '%',
  glare:   (v) => Math.round(v * 100) + '%',
  scatterCM:(v) => (v / 10).toFixed(1) + 'cm',
  matte:   (v) => Math.round(v * 100) + '%',
  renderScale: (v) => Math.round(v * 100) + '%',
  // OFF below 1, FULL at 20, and each step is one grid cell (5%).
  grings:  (v) => { const n = Math.round(v); return n < 1 ? 'OFF' : n >= 20 ? 'FULL' : (n * 5) + '%'; },
  // EVEN at 1, ^N above it; KNEE is the fraction of the band where half the sag has happened:
  // 0.5^(1/p) — 50% at EVEN, 13% at ^5. (Read by fexp below.)
  // tcell/tgap/tcols/tw/tht below report what the setting buys (rows, columns), not just its raw
  // value. They call textGrid(), so contentPx is declared up with cssPx rather than beside resize().
  tcell:   (v) => Math.round(v) + 'SL/' +
                  Math.max(1, Math.floor(textGrid().nSL / Math.max(1, v + state.tgap))) + 'R',
  // Pitch shown beside the gap — pitch is what actually spaces the rows; the gap alone never appears.
  tgap:    (v) => Math.round(v) + 'SL/' + Math.round(state.tcell + v) + 'P',
  // AUTO reports what it chose, not just that a decision was made.
  tcols:   (v) => { const g = textGrid();
                    return v < 1 ? 'AUTO ' + Math.round(g.charW / g.colW) + 'C' : Math.round(v) + ' COL'; },
  tw:      (v) => { const g = textGrid();
                    return (v < 1 ? 'AUTO' : Math.round(v) + '%') + ' ' +
                           Math.max(1, Math.floor(g.W * (v < 1 ? 100 : v) / 100 / g.charW)) + 'C'; },
  tht:     (v) => { const g = textGrid();
                    return v < 1 ? 'AUTO' : Math.round(v) + '% ' +
                           Math.max(1, Math.floor(g.H * v / 100 / g.pitch)) + 'R'; },
  tox:     (v) => Math.round(v) + '%',
  toy:     (v) => Math.round(v) + '%',
  // No cps readout: it's WPM restated (WPM*5/60), not a second fact, and "350WPM/29cps" overflowed
  // the ~10-character field.
  type:    (v) => Math.round(v * 350) + ' WPM',
  collapse:(v) => v.toFixed(2) + 's',
  ignite:  (v) => v.toFixed(2) + 's',
  // 250 G per unit, 8 Hz per unit. Range here runs past what a stock panel could show on purpose —
  // that's not a reason to renormalize the unit underneath it.
  wint:    (v) => v < 0.001 ? 'OFF' : Math.round(v * 250) + ' G',
  wwig:    (v) => Math.round(v * 8) + ' Hz',
  warpSec: (v) => v.toFixed(1) + 's',
  // warpPinch/warpPull: percent of the picture they displace it by, at full FIELD.
  warpPinch:(v) => Math.round(v * 100) + '%',
  warpPull: (v) => Math.round(v * 100) + '%',
  // Percent plus px, since a raw percent doesn't say how far the picture actually moves.
  warpDrag: (v) => v < 0.002 ? 'OFF' : Math.round(v * 100) + '% · ' + Math.round(v * cssPx.w) + 'px',
  warpSwirl:(v) => Math.round(v * 100) + '%',
  // How far past rest the raster rings on the rebound. 0 is a dead sweep with no spring in it at all.
  warpSpring:(v) => v < 0.005 ? 'DEAD' : Math.round(v * 100) + '%',
  warpR:    (v) => Math.round(v * 100) + '% W',
  // How much of the half-width stays clamped. 0.55 pins the outer 45%.
  warpRim:  (v) => v <= 0.001 ? 'ALL' : Math.round((1 - v) * 100) + '% PINNED',
  // CSS px, the unit the CONVERGENCE rows this one adds to are already in.
  warpRGB:  (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'px',
  // x1 is the fault as authored; other values are this build exaggerating or damping it, so it
  // reads as a multiplier rather than a percentage — 0 means the fault doesn't touch this at all.
  surgeScreen:(v) => v < 0.001 ? 'NONE' : v.toFixed(2) + '×',
  surgeLamp:  (v) => v < 0.001 ? 'NONE' : v.toFixed(2) + '×',
  surgeHealth:(v) => Math.round(v * 100) + '%',
  // Kelvin the arc drops by at the fault's deepest; 1500 is the calibrated default.
  surgeWarm:  (v) => v < 1 ? 'NONE' : '-' + Math.round(v) + 'K',
  surgeHz:    (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'Hz',
  surgeLampHz:(v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'Hz',
  surgeStr:   (v) => Math.round(v * 100) + '%',
  // FIXED means the identical fault every press; above 0 it redraws the grain.
  surgeChaos: (v) => v < 0.005 ? 'FIXED' : Math.round(v * 100) + '%',
  // The event is 4.6s at x1, so the readout says how long THIS setting makes it run.
  surgeRate:  (v) => (4.6 / v).toFixed(1) + 's',
  // A px distance, not a fraction of the radius.
  frameW:  (v) => Math.round(v) + 'px',
  glow:    (v) => Math.round(v) + ' nt',
  // Fixture geometry: mm only where mm is the everyday unit (a tube is a T8 at 26mm, never "2.6cm");
  // everything else describing the housing and fitting — width, depth, spacing — reads in cm.
  distMM:  (v) => (v / 1000).toFixed(2) + 'm',
  fixWmm:  (v) => (v / 10).toFixed(1) + 'cm',
  fixHmm:  (v) => (v / 10).toFixed(1) + 'cm',
  recessMM:(v) => (v / 10).toFixed(1) + 'cm',
  tubeDiaMM:(v) => { const t = v < 12 ? 'T4' : v < 20 ? 'T5' : v < 32 ? 'T8' : v < 44 ? 'T12' : '';
                     return Math.round(v) + 'mm' + (t ? ' ' + t : ''); },
  // Inset is the handle; the derived tube LENGTH is what you're actually choosing, and it has to
  // land on a real lamp size — 600, 900, 1200, 1500.
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
  ripple:  (v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  glowFall:(v) => Math.round(v * 100) + '%',
  // PPI only, not pitch and density — they're reciprocals, so showing both was two readings of one
  // setting to reconcile instead of one to read.
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
  // Seconds, not Hz: SWEEP RATE is one fall down the picture, TIP RATE one across-and-back.
  sweepSec:  (v) => v < 0.5 ? 'OFF' : Math.round(v) + 's',
  hsweepSec: (v) => v < 0.5 ? 'OFF' : Math.round(v) + 's',
  // SL = scanlines, COL = grille columns — the raster's own units, same as TERMINAL uses.
  sweepSL: (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' SL',
  dotH:    (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' SL',
  dotW:    (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' COL',
  sweepSol:(v) => Math.round(v * 100) + '%',
  // 0 is the phosphor's own color, 100% is bare excitation -- see the note where beamCol is built.
  sweepWhite:(v) => Math.round(v * 100) + '%',
  sweepDip:(v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  dipNoise:(v) => v < 0.005 ? 'OFF' : Math.round(v * 100) + '%',
  // Extra convergence error the beam brings, in grille columns like the tip's own split.
  beamConvC:(v) => v < 0.01 ? 'OFF' : v.toFixed(2) + ' COL',
  // In sweep heights — what it's measured against; a taller beam casts a longer shadow.
  dipFall: (v) => v.toFixed(1) + 'h',
  sweepRGB:(v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'px',
  dotNits: (v) => Math.round(v) + ' nt',
  sweepStep:(v) => v < 0.01 ? 'OFF' : v.toFixed(2) + ' SL',
  dotHaloNits:(v) => v < 0.5 ? 'OFF' : Math.round(v) + ' nt',
  // Grille columns, matching TIP WIDTH — one column of split is one cell of misconvergence.
  tipRGBc:(v) => v < 0.01 ? 'OFF' : v.toFixed(2) + ' COL',
  tipRGBr:(v) => v < 0.01 ? 'OFF' : v.toFixed(2) + ' SL',
  beamPull:(v) => v < 0.05 ? 'OFF' : v.toFixed(1) + 'px',
  // How much more than BEAM PULL a fully-lit pixel drags; 50% is half again at full gun.
  pullInk: (v) => v < 0.005 ? 'OFF' : '+' + Math.round(v * 100) + '%',
  bloom:   (v) => Math.round(v * 100) + '%',
  bloomThresh:(v) => Math.round(v * 100) + '%',
  // Radius in CSS px, the unit BLOOM above it is already specified in.
  bloomSize:(v) => Math.round(v) + 'px',
  persist: (v) => Math.round(v * 100) + '%',
  frame:   (v) => Math.round(v * 100) + '%',
  // Explicit percent formatters: without them these fall through to the default (two decimals under
  // 40), so a 0..1 fraction read "0.35" instead of "35%".
  frameFixture:(v) => Math.round(v * 100) + '%',
  frameScreen:(v) => Math.round(v * 100) + '%',
  frameBleed:(v) => Math.round(v * 100) + '%',
  guidesOn:(v) => v ? 'ON' : 'OFF',
  heat:    (v) => v ? 'ON' : 'OFF',
  gridOn:  (v) => v ? 'ON' : 'OFF',
  };
  return FMT;
}

// Panel layout, top to bottom. A row is [key, label, min, max, step]; a section is
// [title, rows, masterKey?] — masterKey names the section's collapse/bypass toggle.
export const SECTIONS = [
  // DEBUG sits first: it's what you reach for while tuning every row below it.
  ['DEBUG', [['guidesOn','GUIDE',0,1,1],['heat','ELEVATION',0,1,1],['gridOn','GRID',0,1,1],
             ['fixSolo','FIXTURE',0,1,1]], 'debugOn'],
  // RENDER sits above TUBE: it sets the resolution everything below draws at, and it's the first
  // thing to reach for when the frame rate is wrong.
  ['RENDER', [['renderScale','RENDER SCALE',0.35,1,0.01]]],
  // TUBE reads outside-in: SQUIRCLE sets the outline before BEND can bow it, and OVERSCAN is last
  // since it relates the raster to a glass shape the rows above it must set first.
  ['TUBE', [['corner','SQUIRCLE',0,90,1],['bend','BEND',0,100,1],
            // FACE is the curve amount; CURVE AREA is how far in from the rim it spreads; FALLOFF
            // is where in that band it lands. Both depend on FACE, so they sit under it.
            ['face','FACE',-1,1,0.01],['grings','CURVE AREA',0,20,1],['fexp','FALLOFF',1,5,0.1],['famp','DEPTH',0,6,0.05],
            ['vig','VIGNETTE',0,1,0.01],
            // Runs -50%..+50% (not 1..1.15) so the picture can pull back inside the rim, not just
            // push past it. Stored value is the shader's divisor: 0.5 = half size, 1.5 = half again.
            ['overscan','OVERSCAN',0.5,1.5,0.005],
            ]],

  // GLASS sits with TUBE — it's the tube's front surface, not something FIXTURE merely reflects in.
  // MATTE is the glass's finish and governs SHEEN/GLARE, so it's ordered above them.
  ['GLASS', [['glare','GLARE',0,1,0.01],['matte','MATTE',0,1,0.01],
             ['sheen','SHEEN',0,1,0.01],['scatterCM','SCATTER',1,200,1]]],

  // FRAME (the molding) reads outward from the glass, before FIXTURE. COLOR is the material every
  // other row departs from, so it comes first.
  ['FRAME', [['frameCol','COLOR','#'],['frame','FRAME',0,1.5,0.01],['frameW','WIDTH',1,30,1],
             // Ordered by reach: the fixture's light (external, broadest) before the screen's own
             // glow and its local bleed (internal, narrowest).
             ['frameFixture','LIGHT FIXTURE',0,1,0.01],['frameScreen','SCREEN GLOW',0,1,0.01],
             ['frameBleed','SCREEN BLEED',0,1,0.01]], 'frameOn'],

  // CONVERGENCE gets its own collapsible section (six rows is a lot to scroll past) and its master
  // doubles as a bypass: off means the three rasters land exactly on each other. Placed after TUBE,
  // before RASTER, since it's the gun assembly painting the raster, not the pattern itself.
  // Signed (misconvergence has a direction) and measured in px at the rim — the error grows as r*n²,
  // so the page converts to shader uv against the stage size, which is what survives a resize.
  ['CONVERGENCE', [['convRX','RED X',-200,200,1],['convRY','RED Y',-200,200,1],
            ['convGX','GREEN X',-200,200,1],['convGY','GREEN Y',-200,200,1],
            ['convBX','BLUE X',-200,200,1],['convBY','BLUE Y',-200,200,1]], 'convOn'],

  // Each axis is a density/width/level triplet, in that order: density governs the width and level
  // that ride on it.
  ['RASTER', [['scan','SCANLINES H',5,30,1],['scanw','WIDTH H',0.25,4,0.25],['scanop','LEVEL H',0,100,1],
              ['grille','SCANLINES V',5,30,1],['grillew','WIDTH V',0.25,4,0.25],['grilleop','LEVEL V',0,100,1],
              ]],

  // BRIGHTNESS and WASH are the phosphor's two output levels (beam-driven vs. scatter-glow); every
  // row after them describes how that light spreads. PERSISTENCE lives here too, as a coating
  // property rather than a separate effect.
  ['PHOSPHOR', [['bright','BRIGHTNESS',0,2,0.01],['phos','WASH',0,1,0.01],
                ['glow','SCREEN GLOW',0,30,1],['glowFall','GLOW FALLOFF',0.01,0.5,0.005],
                ['spot','BEAM SPOT',0,10,0.05],
                ['persist','PERSISTENCE',0,0.95,0.01],
                ['bloom','BLOOM',0,2,0.01],['bloomSize','BLOOM SIZE',0,40,0.5],['bloomThresh','BLOOM KNEE',0,1,0.01],
                ['flickHz','FLICKER',0,20,0.1],['fstr','FLICK STR',0,1,0.01]]],

  // Reads whole sweep -> tip -> what the tip disturbs, the order the thing actually happens in.
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
  // TERMINAL sits above FIXTURE: the panel reads outward from the picture, and text IS the picture —
  // filing it after 29 rows of lamp millimeters buried the most-used section. Reads cell, then
  // block, then placement: ROW HEIGHT/LINE GAP/CHAR WIDTH describe one glyph's cell; WIDTH/HEIGHT/
  // TEXT X/Y are the box itself.
  ['TERMINAL', [['type','TYPE SPEED',0.3,3,0.05],
                ['tcell','ROW HEIGHT',1,16,1],['tgap','LINE GAP',0,8,1],['tcols','CHAR WIDTH',0,12,1],
                ['tjust','ALIGN',['LEFT','CENTER','RIGHT']],
                ['tvert','ANCHOR',['BOTTOM','TOP']],
                ['tw','WIDTH',0,200,1],['tht','HEIGHT',0,200,1],
                ['tox','TEXT X',-50,50,1],['toy','TEXT Y',-50,50,1]]],

  // Builds the fitting top to bottom: housing size, then the lamps it holds, then what covers them,
  // then each lamp's own condition.
  ['FIXTURE', [['distMM','DISTANCE',300,6000,20],
               ['fixWmm','HOUSING W',200,2400,10],['fixHmm','HOUSING H',100,1500,10],
               ['recessMM','RECESS',10,400,5],
               ['tubeDiaMM','TUBE DIA',8,60,1],['tubeInsetMM','TUBE INSET',0,400,5],
               ['tubeGapMM','TUBE SPACING',0,800,5],['capMM','CAP LENGTH',0,120,1],
               ['fixXmm','POS X',-2500,2500,10],['fixYmm','POS Y',-1500,1500,10],['fixTilt','TILT',0,1.4,0.02],
               ['frost','FROST',0,1,0.01],['diffuse','DIFFUSER',0,1,0.01],
               ['prism','PRISM',0,1,0.01],['prismN','PRISM CELLS',2,40,1],
               ['railMM','RAILS',0,150,1],['railVis','RAIL FADE',0,1,0.01],['boxVis','BOX',0,1,0.01],
               // ONE LAMP PER BLOCK: level, color, condition, then failure mode — everything about
               // tube A together, then tube B, so a mismatched pair is set by reading one block then the other.
               // DEAD COATING sits above both blocks since it sets what HEALTH means: at 0 a dead
               // middle is black (two glowing ends); at 1 a dead center still reads half as bright as the ends.
               ['tubeDead','DEAD COATING',0,1,0.01],
               ['lightA','LIGHT A',0,1,0.01],['glowA','GLOW A',0,1,0.01],['tempA','TEMP A',2200,6500,50],['healthA','HEALTH A',0,1,0.1],
               ['lflickA','FLICKER A',0,20,0.1],['lfstrA','FLICK STR A',0,1,0.01],
               ['lightB','LIGHT B',0,1,0.01],['glowB','GLOW B',0,1,0.01],['tempB','TEMP B',2200,6500,50],['healthB','HEALTH B',0,1,0.1],
               ['lflickB','FLICKER B',0,20,0.1],['lfstrB','FLICK STR B',0,1,0.01],
               // Shared by both tubes. bulbFlick already takes these — JITTER scatters each cycle's
               // period, CHAOS scatters dip depth and triggers re-strike overshoots — this panel
               // just never exposed a row for either.
               ['lfjit','FLICK JITTER',0,1,0.01],['lfchaos','FLICK CHAOS',0,1,0.01],
               // CHAOS above decides how often the arc misfires; these two decide how far — color
               // drop and coating loss — multiplying the machine's own picks, so timing stays its call.
               ['lfwarmK','COLOR STRIKE',0,6000,50],['lfhdip','HEALTH DIP',0,4,0.05],
               ['ripple','MAINS RIPPLE',0,1,0.01]], 'lightOn'],
  // Two durations: raster fall-in and warm-up. WARM-UP also derives when boot text starts (0.5s
  // after strike finishes) instead of a flat delay that would desync at other settings.
  ['POWER', [['collapse','COLLAPSE',0.3,2,0.05],['ignite','WARM-UP',0.3,2,0.05]]],

  // WARP is a magnet: FIELD/WIGGLE/DURATION (how hard, how long), then field shape, then reach and
  // effect on the guns. Ranges run well past a plausible desk magnet on purpose — this is a lab.
  ['WARP', [['wint','FIELD',0,4,0.05],['wwig','WIGGLE',0,6,0.05],['warpSec','DURATION',0.2,12,0.1],
            // The whole picture leaning, with no falloff — the only term not bounded by the pole's
            // own radius, so the only one that can move the entire raster at once.
            ['warpDrag','DRAG',0,0.6,0.005],
            ['warpPull','PULL',0,2,0.01],
            // How much of the motion is the raster ringing back through rest, not following the field.
            ['warpSpring','SPRING',0,1.5,0.01],
            ['warpPinch','PINCH',0,1.5,0.01],['warpSwirl','SWIRL',0,2,0.01],
            ['warpR','REACH',0.05,2.5,0.01],
            // How much of the picture stays welded to the glass — the one control deciding whether
            // this reads as a magnet on a tube or a photo being dragged around.
            ['warpRim','EDGE HOLD',0,0.98,0.01],
            ['warpRGB','GUN SPLIT',0,140,0.5]]],

  // SURGE scales crt-flicker's fixed, scripted timeline — these rows say how hard, not when. TUBE
  // and FIXTURE first (they move together), then what makes it a fault not a dimmer, then RATE, the clock.
  ['SURGE', [['surgeScreen','TUBE',0,3,0.05],['surgeLamp','FIXTURE',0,3,0.05],
             ['surgeWarm','COLOR DROP',0,4000,50],
             ['surgeHealth','STARVE',0,1,0.01],
             ['surgeHz','GUTTER RATE',0,60,0.5],['surgeStr','GUTTER DEPTH',0,1,0.01],
             ['surgeLampHz','LAMP GUTTER',0,40,0.5],
             // CHAOS redraws only the grain (where guttering bites, how many failed restrikes); the
             // timeline's shape always comes from crt-flicker, even at CHAOS 0.
             ['surgeChaos','CHAOS',0,1,0.01],
             ['surgeRate','RATE',0.15,4,0.05]]],

];
