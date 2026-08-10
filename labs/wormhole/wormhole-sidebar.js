/* Which controls exist, and how each one reads. SECTIONS is pure data in panel.js's row grammar; FMT is display
 * text only. A slider's range is in the units the SHADER wants; the formatter is the only place the displayed
 * unit exists.
 *
 * THERE IS NO GLOBAL FLOW. Every layer carries its own SPEED, TWIST, SPIN and COVERAGE, so clouds can drift while
 * streaks tear past and bolts crawl the other way. The three colour rows repeat for the same reason: one thing
 * meaning one thing in three places beats a shared control that has to compromise.
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

// The four every layer has, in the same order each time so the eye finds them in the same place.
const flow = (p) => [
  [p + 'Speed', 'SPEED', -30, 30, 0.1],
  [p + 'Twist', 'TWIST', -4, 4, 0.05],
  [p + 'Spin', 'SPIN', -2, 2, 0.01],
  [p + 'Cov', 'COVERAGE', 0, 1, 0.01],
];

const colour = (p) => [
  [p + 'Mode', 'COLOUR', COLOUR_MODES],
  [p + 'Col', 'COLOUR A', '#'],
  [p + 'ColB', 'COLOUR B', '#'],
  [p + 'Hue', 'HUE', 0, 1, 0.01],
];

export const SECTIONS = [
  /* RENDER FIRST: both rows are cost, not look. QUALITY is the march's step count and is the biggest single lever
   * in this lab — every enabled layer is evaluated once per step. */
  /* RENDER SCALE REACHES PAST 100%, and on a hi-dpi screen it has to. glquad sizes the buffer from the CSS box
   * with dpr pinned to 1, so 100% is one buffer pixel per CSS pixel — 57% of native on a 1.75 display, and the
   * browser stretches the rest. What that magnifies is the march's dither, which is tuned to be invisible at one
   * sample per screen pixel and reads as coarse grain at one per three. Set this to the display's dpr for native.
   */
  ['RENDER', [['renderScale', 'RENDER SCALE', 0.35, 2, 0.01],
              ['steps', 'QUALITY', 12, 88, 1]]],

  /* IMAGE SITS SECOND BECAUSE IT APPLIES TO EVERYTHING BELOW IT. These three are whole-frame post — the last thing
   * done to whatever the march produced — so reading the panel top to bottom now matches the order the pixels are
   * actually built in: how much is drawn, what is done to the finished frame, then each thing that draws. */
  ['IMAGE', [['exposure', 'EXPOSURE', 0.2, 3, 0.01],
             ['chroma', 'CHROMA', 0, 3, 0.05],
             ['vignette', 'VIGNETTE', 0, 1, 0.01]]],

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
   * SHELLS is the new one: concentric rings of streaks at increasing radius, which is what gives the tube depth
   * at its edges instead of one flat sleeve. It is the only row here that multiplies the work. */
  ['LIGHTSPEED', colour('ls').concat([
    ['lsDensity', 'BRIGHTNESS', 0, 4, 0.02],
    ['lsCount', 'STREAKS', 8, 260, 1],
    ['lsShells', 'SHELLS', 1, 4, 1],
    ['lsLen', 'LENGTH', 0.02, 1, 0.01],
    ['lsThick', 'THICKNESS', 0.04, 0.6, 0.005],
    ['lsVar', 'VARIANCE', 0, 1, 0.01],
    ['lsRadial', 'SPREAD', 0, 1, 0.01],
  ], flow('ls')), 'lsOn'],

  ['PLASMA', colour('pl').concat([
    ['plDensity', 'BRIGHTNESS', 0, 3, 0.02],
    ['plCrackle', 'CRACKLE', 0, 1, 0.01],
    ['plCrawl', 'CRAWL', 0, 2, 0.01],
    ['plStrike', 'STRIKE', 0, 2, 0.01],
    ['plFlash', 'FLASH', 0, 1, 0.01],
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

  nebHue:      as.scaled(360, 0, '°'),
  nebDensity:  as.ofRange(3),
  nebFill:     as.ends(as.pct(), 'MIST', 'THICK', 1),
  nebFluff:    as.ends(as.pct(), 'BILLOW', 'WISPY', 0.9),
  nebStreak:   as.ends(as.mult(2), 'STREAKY', 'ROUND', 2),
  nebVar:      as.off(as.pct()),
  nebScale:    as.mult(1),
  nebOct:      as.raw(0, ' oct'),
  nebSpeed: SPEED, nebTwist: DEG, nebSpin: SPIN, nebCov: as.pct(),

  lsHue:       as.scaled(360, 0, '°'),
  lsDensity:   as.ofRange(4),
  lsCount:     as.raw(0),
  lsShells:    as.raw(0, ' shells'),
  lsLen:       as.ends(as.pct(), 'DOTS', 'SOLID', 1),
  lsThick:     as.pct(),
  lsVar:       as.off(as.pct()),
  lsRadial:    as.pct(),
  lsSpeed: SPEED, lsTwist: DEG, lsSpin: SPIN, lsCov: as.pct(),

  plHue:       as.scaled(360, 0, '°'),
  plDensity:   as.ofRange(3),
  plCrackle:   as.ends(as.pct(), 'VEINS', 'FORKED', 1),
  plCrawl:     as.off(as.mult(1)),
  plStrike:    as.off(as.mult(1)),
  plFlash:     as.ends(as.pct(), 'STEADY', 'STUTTER', 1),
  plLight:     as.off(as.pct()),
  plSpeed: SPEED, plTwist: DEG, plSpin: SPIN, plCov: as.pct(),

  glow:          as.ofRange(3),
  coreAuto:      as.ends(as.pct(), 'CUSTOM', 'LAYERS', 1),
  throatTint:    as.ends(as.pct(), 'WHITE', 'COLOUR', 1),
  throatRays:    as.off(as.pct()),
  coreSpin:      SPIN,
  corePulse:     as.off(as.pct()),
  corePulseRate: as.mult(1),
  coreFade:      as.off(as.pct()),
  coreFadeRate:  as.mult(1),

  exposure:    as.mult(2),
  chroma:      as.ofRange(3),
  vignette:    as.pct(),
};
