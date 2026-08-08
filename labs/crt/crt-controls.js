/* crt/crt-controls.js — the control table and the panel's layout.
 *
 * Pure data. One entry per control, keyed by the state field it drives, carrying its range, step, keyboard step, and the
 * fmt/parse pair that formats the readout and reads a typed value back. fmt and parse must be INVERSES: the readout is an
 * editable field, so a parse that does not undo its own fmt is a control that changes value when you click into it and
 * out again.
 *
 * createMeta({ faceLim }) rather than a bare object, because exactly one formatter needs to reach outside itself: FACE
 * reports the EFFECTIVE cap, marked, whenever a fold forces it below the request, and that ceiling is computed by the
 * projection. It is injected as an accessor so the table stays free of the component -- the moment a table can read the
 * component it can disagree with it.
 *
 * The rule it follows: THE READOUT SHOWS WHAT IS DRAWN. Not what was asked for, and never a clamped value presented as
 * if it were the request.
 *
 * SCANLINES USED TO NEED THE SAME TREATMENT AND NO LONGER DOES, which is worth knowing before adding a second ceiling.
 * It was a total line count, so the largest renderable value depended on how many pixels the layer had -- 218 lines on a
 * short window, 446 on a tall one -- and the top of the slider was unreachable by an amount that moved as you resized.
 * As a DENSITY in rendered pixels the limit is a property of the control, not of the window: the range simply stops at
 * 3px between lines. The ceiling did not get raised, it stopped being window-dependent, and the marker went with it.
 *
 * SECTIONS is the panel's layout: section names and the control keys each one shows, in order. Toggles and swatches are
 * NOT here -- they are handlers wired to state, so the DC adds them. Two keys in the table (capX, capBump) appear in no
 * section on purpose: they drive the electrode-cap geometry and are state-only, but they stay in the table so the
 * save/clamp pass still covers them.
 */

export function createMeta({ faceLim }) {
  const defs = {
    /* SCANLINES and GRILLE are DENSITIES -- lines per 100 rendered pixels -- not totals.
     *
     * A total is the wrong quantity for a tube that resizes: it pins the line count and lets the apparent fineness drift
     * with the window, and it makes the renderable ceiling window-dependent. A density pins what you actually see. The
     * line count now falls out of the size, which is the right way round.
     *
     * 0 TO 100, and the round number is the point: 100 PPI is one line per rendered pixel, 50 is one every two, 25 is
     * one every four. The unit divides into the thing it measures, so a value is a pitch you can work out in your head.
     * 0 is OFF for that axis -- no lines generated at all, not one line hidden.
     *
     * IT USED TO STOP AT 33 and that cap is gone rather than raised. 33 was a 3px pitch, which was the point the OLD
     * width model -- a fixed 42% of the pitch -- stopped producing anything that read as a line: at a finer pitch the
     * derived stroke went sub-pixel and hazed. SCAN WIDTH is a separate control now, so the two are no longer tied: a
     * 1px pitch with a 0.25px line is a perfectly good fine texture, and nothing about a dense setting forces a heavy
     * one. Decoupling the controls is what removed the ceiling; do not put it back without putting the coupling back.
     *
     * Two axes, independently, so the triads can be RECTANGULAR: real masks are not square, and a 25/12 pair is a
     * perfectly ordinary shadow-mask geometry. Equal values give square triads.
     *
     * PPI IS A COSTUME, AND A DELIBERATE ONE. The number is exactly what it was -- lines per 100 rendered pixels, the
     * real drawn quantity, measurable on screen with a ruler -- and only the label reads as a display spec. It is NOT
     * pixels per inch: the tube has no declared diagonal, so a true inch measure is not available to compute. That is
     * the line this instrument holds: dress the unit however suits the fiction, never the value. If a TUBE SIZE control
     * ever lands, a real PPI and a real mm dot pitch both become derivable and this can stop being a costume.
     *
     * The state key for the vertical axis is still 'grille' -- it was the aperture grille before the pair was renamed to
     * H and V. Renaming it would invalidate every saved setting for a cosmetic gain, so it stays.
     */
    scan:   { key: 'scan',   label: 'SCANLINES H', min: 0, max: 100, step: 1, keystep: 1,
              fmt: (v) => v < 0.5 ? 'OFF' : Math.round(v) + ' PPI', parse: (r) => parseFloat(r) },
    grille: { key: 'grille', label: 'SCANLINES V', min: 0, max: 100, step: 1, keystep: 1,
              fmt: (v) => v < 0.5 ? 'OFF' : Math.round(v) + ' PPI', parse: (r) => parseFloat(r) },
    /* LINE WIDTH, in rendered px, set directly rather than derived.
     *
     * This replaced a duty cycle -- the stroke used to be a fixed 42% of the pitch, so width and spacing were one
     * control and you could not thin the lines without also making them denser. Two separate things, two separate
     * controls. QUARTER-PIXEL steps because the useful range is only a few pixels wide and the interesting part of it
     * is under 1px: at 0.25 the line is a hairline the renderer antialiases to a faint grey, at 1 it is a crisp single
     * pixel, and by 3 it is a heavy band. A 1px step would have offered three usable settings.
     *
     * 0 IS A REAL SETTING, not an off switch by accident: it drops the stroke to nothing while leaving the level and
     * the densities where they are, so you can null out one axis and keep the other.
     */
    scanw:  { key: 'scanw',  label: 'WIDTH H',    min: 0, max: 3, step: 0.25, keystep: 0.25,
              fmt: (v) => v < 0.01 ? 'OFF' : v.toFixed(2) + 'px', parse: (r) => parseFloat(r) },
    grillew:{ key: 'grillew', label: 'WIDTH V',    min: 0, max: 3, step: 0.25, keystep: 0.25,
              fmt: (v) => v < 0.01 ? 'OFF' : v.toFixed(2) + 'px', parse: (r) => parseFloat(r) },
    /* LEVEL is the stroke's alpha, one to one: 100% is a genuinely opaque line. It used to top out at 0.68, so the
     * control said 100 and delivered two thirds.
     *
     * ONE PER AXIS, like width and density. The vertical pass used to be pinned at 0.28 of the horizontal one -- a
     * hard-coded ratio that decided for you that the grille was always the quiet one. It usually should be, but that is
     * a look, not a law, and with the ratio gone every axis is set the same way: three controls, no derived values, no
     * axis silently scaled off the other. The warm ink on the vertical pass is what still distinguishes it by default.
     */
    scanop: { key: 'scanop', label: 'LEVEL H',    min: 0, max: 100, step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    grilleop:{key: 'grilleop',label: 'LEVEL V',   min: 0, max: 100, step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    /* SECONDS PER PASS, NOT Hz -- and the old readout was not describing this control at all.
     *
     * It printed `50 + v/3*70` Hz, a straight remap of the slider onto 50-120 that had no relationship to the motion:
     * sweepStep derives the period as `7/(v+FLOOR)`, so the number on screen and the speed on the glass only agreed by
     * coincidence, and at the slow end it read "50 Hz" for a bar taking half a minute to cross. Now both come from the
     * same expression, so the readout cannot drift from the mechanism.
     *
     * STEP 0.01, NOT 0.05. The interesting range for a slow sweep is entirely below 0.1, where 0.05 gave exactly two
     * usable positions. Fine steps cost nothing here -- the value is a divisor, not a plotted quantity. */
    sweep:  { key: 'sweep',  label: 'V-SWEEP',    min: 0,   max: 3,    step: 0.01, fmt: (v) => v < 0.005 ? 'OFF' : (7 / (v + 0.04)).toFixed(1) + 's', parse: (r) => Math.max(0, 7 / Math.max(0.1, parseFloat(r)) - 0.04) },
    hsweep: { key: 'hsweep', label: 'H-SWEEP',    min: 0,   max: 3,    step: 0.01, fmt: (v) => v < 0.005 ? 'OFF' : (0.9 / (v + 0.04)).toFixed(2) + 's', parse: (r) => Math.max(0, 0.9 / Math.max(0.02, parseFloat(r)) - 0.04) },
    str:    { key: 'str',    label: 'SWEEP GLOW', min: 0,   max: 1.6,  step: 0.05, fmt: (v) => v.toFixed(2) + '×', parse: (r) => parseFloat(r) },
    beam:   { key: 'beam',   label: 'BEAM',       min: 0.3, max: 3,    step: 0.05, fmt: (v) => (v * 7).toFixed(1) + 'px', parse: (r) => parseFloat(r) / 7 },
    glare:  { key: 'glare',  label: 'GLARE',      min: 0,   max: 1,    step: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    matte:  { key: 'matte',  label: 'MATTE',      min: 0,   max: 1,    step: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    sheen:  { key: 'sheen',  label: 'SHEEN',      min: 0,   max: 1,    step: 0.01, keystep: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    // Two different phosphor effects, and they are worth telling apart. PHOSPHOR is the flat WASH -- a constant tint
    // over the whole field, the screen never being truly black. PHOS GLOW scales the radial BLOOM that swells with
    // content: it is driven by --textglow (type-in progress), and this is the amount control on top of that.
    phos:   { key: 'phos',   label: 'PHOSPHOR',   min: 0,   max: 1,    step: 0.05, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    /* CAPPED AT 100%, because it is a fraction of a thing that exists. The layer's opacity is bright * pglow/100, so 150
     * asked for one and a half times the glow the phosphor produces -- a percentage of an amount cannot exceed the amount.
     * The top end read as extra headroom and was really just clipping: past ~107% (the point where bright * pglow hits 1)
     * every further step did nothing at all.
     */
    pglow:  { key: 'pglow',  label: 'PHOS GLOW',  min: 0,   max: 100,  step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    frost:  { key: 'frost',  label: 'FROST',      min: 0,   max: 100,  step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    prism:  { key: 'prism',  label: 'PRISM',      min: 0,   max: 1,    step: 0.05, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    spill:  { key: 'spill',  label: 'SPILL',      min: 0,   max: 1,    step: 0.01, keystep: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    spillsize:{ key: 'spillsize', label: 'SPILL SIZE', min: 0, max: 120, step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    // The exponent on spillBands' ramp: 1 is linear across the reach, higher hugs the lamp, lower carries further.
    spillfall:{ key: 'spillfall', label: 'SPILL FALL', min: 0.2, max: 6, step: 0.1, keystep: 0.1, fmt: (v) => '^' + v.toFixed(1), parse: (r) => parseFloat(r) },
    seam:   { key: 'seam',   label: 'SEAM SHADOW', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    rail:   { key: 'rail',   label: 'BORDER',     min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    box:    { key: 'box',    label: 'BOX',        min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    diffuse:{ key: 'diffuse',label: 'DIFFUSE',    min: 0, max: 200, step: 1, fmt: (v) => Math.round(v) + 'px', parse: (r) => parseFloat(r) },
    persp:  { key: 'persp',  label: 'PERSPECTIVE',min: 40, max: 500, step: 5, keystep: 5, fmt: (v) => Math.round(v) + 'cm', parse: (r) => parseFloat(r) },
    veil:   { key: 'veil',   label: 'TUBE GLOW',  min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    temp:   { key: 'temp',   label: 'TEMP',       min: 2200, max: 6500, step: 10, keystep: 25, fmt: (v) => Math.round(v) + 'K', parse: (r) => parseFloat(r) },
    ltk:    { key: 'ltk',    label: 'TUBE DIA',   min: 5,   max: 50,   step: 1, keystep: 1, fmt: (v) => (v / 10).toFixed(1) + 'cm', parse: (r) => parseFloat(r) * 10 },
    ltwd:   { key: 'ltwd',   label: 'TUBE LEN',   min: 20,  max: 100,  step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    ldim:   { key: 'ldim',   label: 'DIMMER',     min: 0,   max: 1,    step: 0.01, keystep: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    healthA:{ key: 'healthA',label: 'HEALTH A',   min: 0,   max: 1,    step: 0.05, keystep: 0.05, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    healthB:{ key: 'healthB',label: 'HEALTH B',   min: 0,   max: 1,    step: 0.05, keystep: 0.05, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    tbloom: { key: 'tbloom', label: 'GLOW SPREAD',min: 0,   max: 200,  step: 1, keystep: 1, fmt: (v) => (v / 10).toFixed(1) + 'cm', parse: (r) => parseFloat(r) * 10 },
    bfall:  { key: 'bfall',  label: 'GLOW FALL',  min: 0,   max: 200,  step: 1, keystep: 1, fmt: (v) => (v / 10).toFixed(1) + 'cm', parse: (r) => parseFloat(r) * 10 },
    ftilt:  { key: 'ftilt',  label: 'TILT',       min: -90, max: 90,   step: 1, keystep: 1, fmt: (v) => Math.round(v) + '°', parse: (r) => parseFloat(r) },
    tdrop:  { key: 'tdrop',  label: 'TUBE DROP',  min: 0,   max: 100,  step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    fposx:  { key: 'fposx',  label: 'FIXTURE X',  min: -100, max: 100,   step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    fposy:  { key: 'fposy',  label: 'FIXTURE Y',  min: -100, max: 100,   step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    fdepth: { key: 'fdepth', label: 'DEPTH',      min: 0,   max: 60,   step: 1, keystep: 1, fmt: (v) => Math.round(v) + 'cm', parse: (r) => parseFloat(r) },
    fw:     { key: 'fw',     label: 'WIDTH',      min: 0,   max: 200,  step: 1, keystep: 1, fmt: (v) => Math.round(v) + 'cm', parse: (r) => parseFloat(r) },
    fh:     { key: 'fh',     label: 'HEIGHT',     min: 0,   max: 200,  step: 1, keystep: 1, fmt: (v) => Math.round(v) + 'cm', parse: (r) => parseFloat(r) },
    vig:    { key: 'vig',    label: 'VIGNETTE',   min: 0,  max: 100, step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    fwid:   { key: 'fwid',   label: 'FRAME WIDTH',min: 0,  max: 70,  step: 1, keystep: 1, fmt: (v) => Math.round(v) + 'px', parse: (r) => parseFloat(r) },
    ftint:  { key: 'ftint',  label: 'GLOW TINT',  min: 0,  max: 100, step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    fglow:  { key: 'fglow',  label: 'FRAME LIGHT', min: 0, max: 100, step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    // SQUIRCLE and BEND describe the outline; the projection normalises its radius against that outline, so both reach the
    // warp as well as the clip.
    gsqe:   { key: 'gsqe',   label: 'SQUIRCLE',   min: 0,  max: 100, step: 1, keystep: 1, fmt: (v) => Math.round(v) === 0 ? 'SQUARE' : Math.round(v) === 100 ? 'CIRCLE' : Math.round(v) + '%', parse: (r) => parseFloat(r) },
    // A single smooth second-order term on the squircle, not a separate side curve. Weighted by the shape's own axis
    // balance squared -- 1 on the axes, 0 at the diagonal, C1 smooth between -- so the axis extents stay pinned while the
    // diagonal tucks in or pushes out. The flat run gains a belly relative to its chord and the corner broadens with it,
    // from ONE continuous factor: no tangent to match, so no angle can jump.
    gbend:  { key: 'gbend',  label: 'BEND'      , min: 0, max: 15, step: 1, keystep: 1, fmt: (v) => Math.round(v) === 0 ? 'FLAT' : Math.round(v) + '%', parse: (r) => parseFloat(r) },
    // The cap half-angle in degrees, signed: 0 dead flat, +90 a hemisphere bulging toward the viewer, -90 domed in.
    // Degrees because they are the physical description of a faceplate ("a 25 degree cap"), and the sign is the sag's.
    // The readout reports the EFFECTIVE cap, marked, whenever a fold forces it below the request -- a slider whose
    // number disagrees with what is drawn is the same defect as one whose top end does nothing.
    fcurve: { key: 'fcurve', label: 'FACE'      , min: -90, max: 90,  step: 0.5, keystep: 0.5, fmt: (v) => {
      if (Math.abs(v) < 0.05) return 'FLAT';
      const lim = faceLim() == null ? 90 : faceLim();
      const eff = Math.min(Math.abs(v), lim);
      return (v > 0 ? 'OUT ' : 'IN ') + eff.toFixed(1) + '\u00b0' + (eff < Math.abs(v) - 0.05 ? ' MAX' : '');
    }, parse: (r) => parseFloat(r) },
    /* HOW QUICKLY THE BEND ARRIVES INSIDE THE BAND -- the profile's exponent, where CURVE AREA is the band itself. Same
     * depth at the rim at every setting (the amplitude is pinned there); what moves is where the picture gives it up. At
     * EVEN the surface starts bending the moment it enters the band; at 2 it eases in, which is the shape that shipped; by
     * 4-5 nothing happens until the last few percent and then it turns hard.
     *
     * STOPS AT 1, not 0: below 1 the profile has infinite slope where the band opens, which draws a crease ring at the band
     * boundary instead of a gentler curve. The top end is renderable because the fold test is bisected against this same
     * exponent rather than against a fixed square.
     */
    fexp:   { key: 'fexp',   label: 'FALLOFF'   , min: 1, max: 5, step: 0.1, keystep: 0.1,
              fmt: (v) => v <= 1.05 ? 'EVEN' : '^' + v.toFixed(1), parse: (r) => /ev/i.test(r) ? 1 : parseFloat(r) },
    // 100% is the full stage width; 0% is square, sized off the SHORTER edge. Interpolating the width between those
    // two is the honest reading of an aspect control on a tube: a real screen is a fixed piece of glass, so changing
    // its shape changes the glass, not a marking drawn on it.
    /* THREE SHAPES, NOT A CONTINUUM. A tube is a fixed piece of glass -- it is 4:3 or it is 9:16, it is never 63.5% of
     * the way between them -- and every value in the old range that was not an endpoint described a screen that does
     * not exist. The three that do: a portrait phone (9:16), a square, and the full stage.
     */
    gstretch:{key: 'gstretch',label:'ASPECT',     snap: [0, 50, 100], min: 0, max: 100, step: 50,
              fmt: (v) => v < 25 ? 'PHONE' : v < 75 ? 'SQUARE' : 'FULL',
              parse: (r) => /ph/i.test(r) ? 0 : /sq/i.test(r) ? 50 : /fu/i.test(r) ? 100 : parseFloat(r) },
    tspace: { key: 'tspace', label: 'TUBE SPACE', min: 0,   max: 100,  step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    capX:   { key: 'capX',   label: 'CAP POS',    min: -40, max: 90,   step: 1, keystep: 1, fmt: (v) => Math.round(v) + '', parse: (r) => parseFloat(r) },
    capBump:{ key: 'capBump',label: 'CAP CURVE',  min: 0,   max: 40,   step: 1, keystep: 1, fmt: (v) => Math.round(v) + '', parse: (r) => parseFloat(r) },
    // Runs to 60. The pitch divides the radius by the COUNT, so a higher count is just a finer sampling of the same
    // shape -- and with FACE CURVE riding the rings, more of them is what lets the dome's falloff be read as a curve
    // rather than a handful of steps. Past 20 they no longer coincide with grid lines; they become a gradient.
    // READ AS A PERCENTAGE OF THE PICTURE, which is what it physically is: each step is one grid cell, 5% of the span
    // (2.5% in from each side), and the count is how far in from the rim the warp reaches. The underlying value stays the
    // band COUNT because every geometry path is written in those units -- only the readout changes, so 20 reads FULL.
    grings: { key: 'grings', label: 'CURVE AREA',  min: 0,   max: 20,   step: 1, keystep: 1, fmt: (v) => { const n = Math.round(v); return n < 1 ? 'OFF' : n >= 20 ? 'FULL' : (n * 5) + '%'; }, parse: (r) => parseFloat(r) / 5 },
    bloom:  { key: 'bloom',  label: 'BLOOM',      min: 0,   max: 40,   step: 0.5,  fmt: (v) => Math.round(v) + 'px', parse: (r) => parseFloat(r) },
    flick:  { key: 'flick',  label: 'FLICKER',    min: 0,   max: 30,   step: 0.5,  fmt: (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + ' Hz', parse: (r) => parseFloat(r) },
    fstr:   { key: 'fstr',   label: 'FLICK STR',  min: 0,   max: 1,    step: 0.05, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    bright: { key: 'bright', label: 'BRIGHTNESS', min: 0.6, max: 1.7,  step: 0.02, fmt: (v) => Math.round(v * 100) + ' nt', parse: (r) => parseFloat(r) / 100 },
    lflickA:{ key: 'lflickA',label: 'FLICKER A',  min: 0,   max: 15,   step: 0.1,  keystep: 0.1, fmt: (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + ' Hz', parse: (r) => parseFloat(r) },
    lfstrA: { key: 'lfstrA', label: 'FLUX A',     min: 0,  max: 1,    step: 0.01, keystep: 0.01, fmt: (v) => '±' + Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    lflickB:{ key: 'lflickB',label: 'FLICKER B',  min: 0,   max: 15,   step: 0.1,  keystep: 0.1, fmt: (v) => v < 0.05 ? 'OFF' : v.toFixed(1) + ' Hz', parse: (r) => parseFloat(r) },
    lfstrB: { key: 'lfstrB', label: 'FLUX B',     min: 0,  max: 1,    step: 0.01, keystep: 0.01, fmt: (v) => '±' + Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    lfjit:  { key: 'lfjit',  label: 'JITTER',     min: 0,  max: 1,    step: 0.01, keystep: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    lfchaos:{ key: 'lfchaos',label: 'CHAOS',      min: 0,  max: 1,    step: 0.01, keystep: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    type:   { key: 'type',   label: 'TYPE SPEED', min: 0.3, max: 3,    step: 0.05, fmt: (v) => Math.round(v * 350) + ' WPM', parse: (r) => parseFloat(r) / 350 },
    fsize:  { key: 'fsize',  label: 'SIZE',       min: 0.35, max: 1,   step: 0.01, fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 },
    /* CENTRE TO CENTRE. The block's own centre is placed at a point offset from the picture's centre, so 0 is dead
     * centre and +-50% puts that centre on the edge with half the block hanging off. Two earlier models are gone: a
     * top-left corner (which grew right and down and ran off the right edge past X~50), then a corner anchor (which
     * always pulled back toward the centre and so could not overhang at all). Centre-anchoring is what makes TEXT WIDTH
     * overhang EVENLY -- a 200% block spills the same amount off both sides instead of all of it off one.
     */
    tox:    { key: 'tox',    label: 'TEXT X',     min: -50, max: 50, step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    toy:    { key: 'toy',    label: 'TEXT Y',     min: -50, max: 50, step: 1, keystep: 1, fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) },
    /* AUTO AT ZERO HERE TOO, and it means the same thing it means for the height: the box comes from the text instead of
     * the text being fitted to the box. For a width that is max-content -- as wide as the longest line, no wrapping --
     * which is the honest default for a terminal, where lines are written to a length rather than flowed to a column.
     * Past 100% is deliberate: a block wider than the picture is a real thing to look at, and with a centred anchor the
     * overhang is even on both sides.
     */
    tw:     { key: 'tw',     label: 'TEXT WIDTH', min: 0,   max: 200,  step: 1, keystep: 1, fmt: (v) => v < 1 ? 'AUTO' : Math.round(v) + '%', parse: (r) => /au/i.test(r) ? 0 : parseFloat(r) },
    /* AUTO AT ZERO, because a height is optional in a way a width is not: lines wrap against the width, so it always
     * has to be a number, while the height either follows the text or overrides it. Set, it behaves exactly like the
     * width -- a percentage of the picture, over 100% for a deliberate overhang -- and because the block is centred the
     * overhang is even top and bottom. This is NOT the old TEXT H: that one sized a frame the text was pinned to the
     * bottom of, so raising it moved the text instead of resizing anything.
     */
    tht:    { key: 'tht',    label: 'TEXT HEIGHT',min: 0,   max: 200,  step: 1, keystep: 1, fmt: (v) => v < 1 ? 'AUTO' : Math.round(v) + '%', parse: (r) => /au/i.test(r) ? 0 : parseFloat(r) },
    /* THE CHARACTER CELL, IN SCANLINES -- which is what a text size physically IS on a CRT. A real terminal does not
     * have a font size; it has a character ROM of a fixed cell height, and the cell spans a whole number of scanlines
     * (8x8, 8x16, 9x16). Everything else follows: the row count is however many cells fit the raster, and the text sits
     * ON the lines instead of drifting between them.
     *
     * Snapped, because a cell 11.5 scanlines tall is not a thing that can exist -- the value is one of these or it is
     * a fiction. ROWS is derived and shown in the readout rather than being its own control: two controls for one
     * relationship is how they end up disagreeing.
     */
    tcell:  { key: 'tcell',  label: 'ROW HEIGHT', snap: [1, 2, 3, 4, 5, 6, 8, 10, 12, 16], min: 1, max: 16, step: 1, fmt: (v) => Math.round(v) + ' SL', parse: (r) => parseFloat(r) },
    /* EXTRA SCANLINES BETWEEN CELLS -- leading, not a multiplier. As a x1..x3 multiple of the font size this control
     * scaled the GLYPHS as well as the spacing, so ROW HEIGHT and LINE GAP were two controls fighting over one number
     * and neither one alone told you how big the text would be. On real hardware the gap is whole scanlines of blank
     * raster between one character cell and the next, which is a quantity that adds rather than multiplies: the cell
     * is the text size, full stop, and this only decides how far apart the cells sit.
     */
    tgap:   { key: 'tgap',   label: 'LINE GAP',   snap: [0, 1, 2, 3, 4, 6, 8], min: 0, max: 8, step: 1, fmt: (v) => Math.round(v) + ' SL', parse: (r) => parseFloat(r) },
    /* THE OTHER HALF OF THE CELL. A character cell is columns x scanlines -- 8x16, 9x16 -- and until now only the
     * height was on the grid: the width was whatever the font's advance happened to be, so characters drifted across
     * the triads instead of sitting on them. This sets the advance to a whole number of grille columns, and the
     * letter-spacing needed to hit it exactly is derived from the font's own measured advance.
     */
    tcols:  { key: 'tcols',  label: 'CHAR WIDTH', snap: [0, 1, 2, 3, 4, 5, 6, 8, 10, 12], min: 0, max: 12, step: 1, fmt: (v) => v < 1 ? 'AUTO' : Math.round(v) + ' COL', parse: (r) => /au/i.test(r) ? 0 : parseFloat(r) },
    tlh:    { key: 'tlh',    label: 'LINE GAP',   min: 1,   max: 3,    step: 0.05, fmt: (v) => v.toFixed(2) + '×', parse: (r) => parseFloat(r) },
    wint:   { key: 'wint',   label: 'FIELD',      min: 0,   max: 2,    step: 0.05, fmt: (v) => Math.round(v / 2 * 500) + ' G', parse: (r) => parseFloat(r) / 500 * 2 },
    wwig:   { key: 'wwig',   label: 'WIGGLE',     min: 0,   max: 3,    step: 0.05, fmt: (v) => Math.round(v * 8) + ' Hz', parse: (r) => parseFloat(r) / 8 },
    wdur:   { key: 'wdur',   label: 'DURATION',   min: 0,   max: 10,   step: 0.1,  fmt: (v) => v.toFixed(1) + 's', parse: (r) => parseFloat(r) },
    onHold: { key: 'onHold', label: 'ON DWELL',   min: 1,   max: 20,   step: 0.5,  fmt: (v) => v.toFixed(1) + 's', parse: (r) => parseFloat(r) },
    offHold:{ key: 'offHold',label: 'OFF DWELL',  min: 0.5, max: 10,   step: 0.5,  fmt: (v) => v.toFixed(1) + 's', parse: (r) => parseFloat(r) },
    collapse:{key: 'collapse',label:'COLLAPSE',   min: 0.3, max: 2,    step: 0.05, fmt: (v) => v.toFixed(2) + 's', parse: (r) => parseFloat(r) },
    ignite: { key: 'ignite', label: 'WARM-UP',    min: 0.3, max: 2,    step: 0.05, fmt: (v) => v.toFixed(2) + 's', parse: (r) => parseFloat(r) },
  };
  // Stamps each entry's own key, so a table cannot carry a name that disagrees with the state field it drives.
  Object.keys(defs).forEach((k) => { defs[k].key = k; });
  return defs;
}

export const SECTIONS = [
  // Sliderless: two independent debug switches (layer outlines, the guide overlay) as ROWS under one shared header,
  // rather than each owning a section header of its own for a single toggle. See toggleRows in lab/Sidebar.
  { name: 'DEBUG', keys: [] },
  // The six scan controls are grouped BY AXIS, not by kind: you tune one direction at a time, so H's density, width and
  // level sit together and V's below them. Interleaving them by kind put the two halves of every decision apart.
  //
  // THE GUIDE'S FOUR CONTROLS ARE THE LAST ROWS HERE, not a section of their own. CURVE AREA, FACE, SQUIRCLE and BEND all
  // shape the glass -- FACE and CURVE AREA are the projection every plotted layer rides, SQUIRCLE and BEND are the outline
  // the face is clipped to AND the shape that projection normalises its radius against, so all four bend the picture --
  // so they describe the tube, not an instrument. Under their own GUIDE header they read as
  // settings for the dashed overlay, which is the one thing they are not: that overlay is a VIEW of them, toggled from
  // DEBUG, and it can be off while all four still shape the picture.
  //
  // Last rather than first because they are the deepest settings in the panel -- reached rarely, and calibrated against
  // everything above them.
  { name: 'TUBE', keys: ['bright', 'phos', 'pglow',
    'scan', 'scanw', 'scanop', 'grille', 'grillew', 'grilleop',
    'flick', 'fstr', 'glare', 'matte', 'sheen',
    'grings', 'fcurve', 'fexp', 'gsqe', 'gbend'] },
  // VIGNETTE lives here rather than under TUBE: it rides the guide outline and darkens the rim of the picture, so it
  // describes the frame's edge, not the phosphor's behaviour.
  { name: 'FRAME', keys: ['fsize', 'gstretch', 'fwid', 'fglow', 'ftint', 'vig'] },
  { name: 'SCAN', keys: ['sweep', 'hsweep', 'str', 'beam'] },
  // BLOOM sits here, not under TUBE. It is a drop-shadow on #clContent -- it glows the EMITTING content and nothing
  // else, so it belongs with the content rather than with the glass. GLARE, MATTE and SHEEN are the glass controls.
  // The header pill is the content SELECTOR: text or test pattern, the two things the terminal can be showing.
  { name: 'TERMINAL', keys: ['bloom', 'type', 'tcell', 'tcols', 'tgap', 'tw', 'tht', 'tox', 'toy'] },
  { name: 'LIGHT FIXTURE', keys: ['ldim', 'temp', 'healthA', 'healthB', 'veil', 'tbloom', 'bfall', 'spill', 'spillsize', 'spillfall',
    'ltk', 'ltwd', 'tdrop', 'tspace', 'diffuse', 'frost', 'prism', 'seam', 'rail', 'box', 'ftilt', 'persp',
    'fw', 'fh', 'fdepth', 'fposx', 'fposy'] },
  { name: 'LIGHT FLICKER', keys: ['lflickA', 'lfstrA', 'lflickB', 'lfstrB', 'lfjit', 'lfchaos'] },
  { name: 'WARP', keys: ['wint', 'wwig', 'wdur'] },
  { name: 'POWER', keys: ['onHold', 'offHold', 'collapse', 'ignite'] },
];
