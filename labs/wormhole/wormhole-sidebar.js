/* Which controls exist, and how each one reads. SECTIONS is pure data in panel.js's row grammar; FMT is display
 * text only. A slider's range is in the units the SHADER wants; the formatter is the only place the displayed
 * unit exists.
 *
 * THERE IS NO GLOBAL FLOW. Every layer carries its own SPEED, TWIST and SPIN, so clouds can drift while streaks
 * tear past and bolts crawl the other way. The colour rows repeat for the same reason: one thing meaning one
 * thing in three places beats a shared control that has to compromise.
 *
 * COVERAGE IS THE EXCEPTION and lives in IMAGE. How far in from the wall the field reaches describes the tunnel
 * rather than any one layer, and the three copies of it were only ever set to the same value by hand.
 *
 * Their on/off flags are SECTION MASTERS — the third entry in a section's tuple — not rows and not a strip above
 * the panel. A master sits in the header it governs, so "is NEBULA on" and "what is NEBULA set to" are answered in
 * the same place, and panel.js already hides a disabled section's rows. Any combination can still run at once:
 * masters are independent flags, not a radio group.
 */
import { as } from '../kit/units.js';

// Named here so the mast line and the sections read the same list. The keys are the masters used below.
export const EFFECTS = [
  { key: 'nebOn', label: 'NEBULA' },
  { key: 'lsOn',  label: 'LIGHTSPEED' },
  { key: 'plOn',  label: 'PLASMA' },
];

const COLOUR_MODES = ['SOLID', 'BLEND', 'RAIN'];

// The three every layer has, in the same order each time so the eye finds them in the same place. COVERAGE used
// to be a fourth; it is now one value in IMAGE, shared by all three.
const flow = (p) => [
  [p + 'Speed', 'SPEED', -30, 30, 0.1],
  [p + 'Twist', 'TWIST', -4, 4, 0.05],
  [p + 'Spin', 'SPIN', -2, 2, 0.01],
];

/* ONLY THE ROWS THE CURRENT MODE USES ARE SHOWN, because the other ones do nothing at all: the ramp returns
 * COLOUR A alone in SOLID, mixes A to B in BLEND, and ignores both in favour of a hue-shifted cosine palette in
 * RAIN. Three rows were on screen at all times and never more than two of them were live, with nothing saying
 * which — a control that does nothing is worse than one that is absent.
 */
const colour = (p) => [
  [p + 'Mode', 'COLOUR', COLOUR_MODES],
  [p + 'Col', 'COLOUR A', '#', { when: [p + 'Mode', [0, 1]] }],
  [p + 'ColB', 'COLOUR B', '#', { when: [p + 'Mode', [1]] }],
  [p + 'Hue', 'HUE', 0, 1, 0.01, { when: [p + 'Mode', [2]] }],
];

export const SECTIONS = [
  /* RENDER FIRST: both rows are cost, not look. QUALITY is the march's step count and is the biggest single lever
   * in this lab — every enabled layer is evaluated once per step. */
  /* RENDER SCALE REACHES PAST 100%, and on a hi-dpi screen it has to. glquad sizes the buffer from the CSS box
   * with dpr pinned to 1, so 100% is one buffer pixel per CSS pixel — 57% of native on a 1.75 display, and the
   * browser stretches the rest. What that magnifies is the march's dither, which is tuned to be invisible at one
   * sample per screen pixel and reads as coarse grain at one per three. Set this to the display's dpr for native.
   */
  /* STEP SPREAD decides WHERE the samples go, where QUALITY decides how many. At 1 the march is even and the
   * far end of the tunnel is sampled as finely as the near end; high concentrates them at the eye, which is
   * cheaper to look at but leaves the background undersampled and streaking. */
  ['RENDER', [['renderScale', 'RENDER SCALE', 0.35, 2, 0.01],
              ['steps', 'QUALITY', 12, 88, 1],
              ['stepSpread', 'STEP SPREAD', 1, 16, 0.1]]],

  /* IMAGE SITS SECOND BECAUSE IT APPLIES TO EVERYTHING BELOW IT. FOV, EXPOSURE, CHROMA and VIGNETTE are the lens
   * and the whole-frame post — the last things done to whatever the march produced — so reading the panel top to
   * bottom matches the order the pixels are actually built in: how much is drawn, what the frame is seen through,
   * then each thing that draws.
   *
   * FOV IS FIRST AND IT IS THE STRONGEST ROW ON THE PANEL. A narrow angle keeps the wall away from the edge of
   * the frame and the whole field reads as weather out in front; a wide one sweeps it past the periphery and the
   * picture closes around the viewer. It is stored in degrees and converted to the ray's z where it is sent. */
  ['IMAGE', [['fov', 'FOV', 28, 104, 1],
             ['exposure', 'EXPOSURE', 0.2, 3, 0.01],
             ['chroma', 'CHROMA', 0, 3, 0.05],
             ['vignette', 'VIGNETTE', 0, 1, 0.01]]],

  /* TUNNEL IS THE SHAPE OF THE TUBE, and every row in it governs all three layers at once. They were scattered —
   * COVERAGE and BEND sat in IMAGE among the post, and each layer used to carry its own copy of COVERAGE that was
   * kept in step by hand. How far in from the wall the field reaches, how hard its edge is, and where its axis
   * goes are properties of the tunnel, not of any one thing drawn in it.
   *
   * WALL is that edge. Soft, the density climbs over a third of the radius and there is no boundary anywhere,
   * which is a cloud the camera happens to be inside; hard, it arrives over a few percent and there is a surface
   * with a mouth in it.
   *
   * RIBS are rings of dense wall with a thin tube between them, sliding toward the eye at their own FLOW. They
   * are the cheapest strong cue in the lab: a ring sits at a fixed DEPTH, so it foreshortens toward the throat
   * and arrives faster as it comes, which is what an eye reads as travelling rather than as watching a sky.
   * SPACING reads as how many of them stand between here and the far end.
   *
   * BEND makes the axis a curve instead of a line. FLOW slides the curve toward the eye so corners arrive rather
   * than sit still; TIGHTNESS is how close together they come. */
  ['TUNNEL', [['coverage', 'COVERAGE', 0, 1, 0.01],
              ['wall', 'WALL', 0, 1, 0.01],
              ['ribs', 'RIBS', 0, 1, 0.01],
              ['ribScale', 'RIB SPACING', 0.3, 12, 0.05],
              ['ribFlow', 'RIB FLOW', -20, 20, 0.1],
              ['bend', 'BEND', 0, 1, 0.01],
              ['bendFlow', 'BEND FLOW', -20, 20, 0.1],
              ['bendScale', 'TIGHTNESS', 0.1, 3, 0.01]]],

  ['NEBULA', colour('neb').concat([
    ['nebDensity', 'DENSITY', 0, 3, 0.02],
    ['nebFill', 'FILL', 0, 1, 0.01],
    ['nebFluff', 'FLUFF', 0.15, 0.9, 0.01],
    ['nebStreak', 'STREAK', 0.05, 2, 0.01],
    ['nebVar', 'VARIANCE', 0, 1, 0.01],
    ['nebScale', 'SCALE', 0.5, 8, 0.05],
    ['nebOct', 'DETAIL', 1, 5, 1],
  ], flow('neb')), 'nebOn'],

  /* LIGHTSPEED is capsules solved per pixel, not density marched — so THICKNESS is the streak's real radius and
   * LENGTH its real length, both in world units, rather than a kernel that had to widen with the sampling rate.
   * Its streaks scatter through the whole wall at any distance, exactly as the other two layers fill it, and
   * there is no shell count to set. */
  ['LIGHTSPEED', colour('ls').concat([
    ['lsDensity', 'BRIGHTNESS', 0, 4, 0.02],
    ['lsCount', 'STREAKS', 8, 260, 1],
    ['lsLen', 'LENGTH', 0.02, 1, 0.01],
    ['lsThick', 'THICKNESS', 0.04, 0.6, 0.005],
    // VARIANCE is how much streaks differ FROM EACH OTHER: length, speed, thickness, brightness, and how far
    // out from the axis each one sits. At 0 they are clones on a grid; at 1 no two are alike.
    ['lsVar', 'VARIANCE', 0, 1, 0.01],
    ['lsRadial', 'SPREAD', 0, 1, 0.01],
  ], flow('ls')), 'lsOn'],

  /* SCALE and STREAK mean here exactly what they mean in NEBULA, and they are a pair on purpose: STREAK squashes
   * the depth axis so bolts run lengthwise down the tunnel, and SCALE decides how big the field is. Squashing
   * alone strings the noise's own features along each bolt as visible beads, so the two have to be set together —
   * a hard squash wants a small field, or the beads read as rungs. */
  ['PLASMA', colour('pl').concat([
    ['plDensity', 'BRIGHTNESS', 0, 3, 0.02],
    ['plFill', 'FILL', 0, 1, 0.01],
    ['plOcclude', 'OCCLUSION', 0, 2, 0.01],
    ['plCrackle', 'CRACKLE', 0, 1, 0.01],
    ['plScale', 'SCALE', 0.5, 8, 0.05],
    ['plStreak', 'STREAK', 0.05, 1.5, 0.01],
    ['plFlash', 'FLASH', 0, 1, 0.01],
    ['plFlashRate', 'FLASH RATE', 0.05, 6, 0.05],
    ['plLight', 'LIGHTS CLOUD', 0, 1, 0.01],
  ], flow('pl')), 'plOn'],

  /* CORE is the far end of the tunnel — the bright centre the layers are wrapped around. It is drawn after the
   * march rather than inside it, so its rows are about one object and none of them cost a sample.
   *
   * SPIN turns the rays and nothing else, so it reads as doing nothing while RAYS is 0. PULSE and FADE are both
   * breaths and are separate controls because they are different ones: PULSE brightens and dims around full,
   * FADE takes the whole core away and brings it back. Each carries its own rate for the same reason every layer
   * carries its own flow — a shared rate forces the slow one to compromise. */
  ['CORE', [['glow', 'CORE', 0, 3, 0.02],
            ['coreCol', 'COLOUR', '#'],
            ['coreAuto', 'SOURCE', 0, 1, 0.01],
            ['throatTint', 'TINT', 0, 1, 0.01],
            ['throatRays', 'RAYS', 0, 1, 0.01],
            ['coreSpin', 'SPIN', -2, 2, 0.01],
            ['corePulse', 'PULSE', 0, 1, 0.01],
            ['corePulseRate', 'PULSE RATE', 0.05, 4, 0.05],
            ['coreFade', 'FADE', 0, 1, 0.01],
            ['coreFadeRate', 'FADE RATE', 0.05, 4, 0.05]], 'coreOn'],
];

const DEG = as.scaled(90, 0, '°');
const SPIN = as.scaled(90, 0, '°/s');
const SPEED = as.raw(1, 'c');

/* LENGTH reads as a percentage of the streak's repeat period rather than an absolute distance, because the
 * period is longer than the visible tunnel — the number that means something is how much of that a streak fills.
 */
export const FMT = {
  renderScale: as.pct(),
  steps:       as.raw(0, ' steps'),
  stepSpread:  as.ends(as.mult(1), 'EVEN', '', 16),

  nebHue:      as.scaled(360, 0, '°'),
  nebDensity:  as.ofRange(3),
  nebFill:     as.ends(as.pct(), 'MIST', 'THICK', 1),
  nebFluff:    as.ends(as.pct(), 'BILLOW', 'WISPY', 0.9),
  nebStreak:   as.ends(as.mult(2), 'STREAKY', 'ROUND', 2),
  nebVar:      as.off(as.pct()),
  nebScale:    as.mult(1),
  nebOct:      as.raw(0, ' oct'),
  nebSpeed: SPEED, nebTwist: DEG, nebSpin: SPIN,

  lsHue:       as.scaled(360, 0, '°'),
  lsDensity:   as.ofRange(4),
  lsCount:     as.raw(0),
  lsLen:       as.ends(as.pct(), 'DOTS', 'SOLID', 1),
  lsThick:     as.pct(),
  lsVar:       as.off(as.pct()),
  lsRadial:    as.pct(),
  lsSpeed: SPEED, lsTwist: DEG, lsSpin: SPIN,

  plHue:       as.scaled(360, 0, '°'),
  plDensity:   as.ofRange(3),
  plFill:      as.ends(as.pct(), 'RARE', 'DENSE', 1),
  plOcclude:   as.ends(as.mult(1), 'GLOW ONLY', 'SOLID', 2),
  plFlashRate: as.mult(1),
  plCrackle:   as.ends(as.pct(), 'VEINS', 'FORKED', 1),
  plScale:     as.mult(1),
  plStreak:    as.ends(as.mult(2), 'STREAKY', 'ROUND', 1.5),
  plFlash:     as.ends(as.pct(), 'STEADY', 'STUTTER', 1),
  plLight:     as.off(as.pct()),
  plSpeed: SPEED, plTwist: DEG, plSpin: SPIN,

  glow:          as.ofRange(3),
  coreAuto:      as.ends(as.pct(), 'CUSTOM', 'LAYERS', 1),
  throatTint:    as.ends(as.pct(), 'WHITE', 'COLOUR', 1),
  throatRays:    as.off(as.pct()),
  coreSpin:      SPIN,
  corePulse:     as.off(as.pct()),
  corePulseRate: as.mult(1),
  coreFade:      as.off(as.pct()),
  coreFadeRate:  as.mult(1),

  fov:         as.deg(),
  coverage:    as.pct(),
  wall:        as.ends(as.pct(), 'FOG', 'SURFACE', 1),
  ribs:        as.off(as.pct()),
  // Spacing reads as how many rings stand between the eye and the throat, which is the thing being set. FAR is
  // 13 world units and a ring repeats every TAU / uRibScale of them.
  ribScale:    as.scaled(13 / (2 * Math.PI), 1, ' rings'),
  ribFlow:     as.raw(1, 'c'),
  bend:        as.off(as.pct()),
  bendFlow:    as.raw(1, 'c'),
  bendScale:   as.mult(2),
  exposure:    as.mult(2),
  chroma:      as.ofRange(3),
  vignette:    as.pct(),
};
