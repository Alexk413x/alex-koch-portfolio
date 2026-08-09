/* Which controls exist, and how each one reads. SECTIONS is pure data in panel.js's row grammar; FMT is display
 * text only. A slider's range is in the units the SHADER wants; the formatter is the only place the displayed
 * unit exists.
 *
 * THERE IS NO GLOBAL FLOW. Every layer carries its own SPEED, TWIST, SPIN and COVERAGE, so clouds can drift while
 * streaks tear past and bolts crawl the other way. The three colour rows repeat for the same reason: one thing
 * meaning one thing in three places beats a shared control that has to compromise.
 *
 * Their on/off flags are NOT rows — they live in the strip above the panel, because any combination can run at
 * once and the strip is where you reach for that.
 */
import { as } from '../kit/units.js';

// Named here rather than inline so the host builds the toggle strip from the same list the sections use.
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
  ['RENDER', [['renderScale', 'RENDER SCALE', 0.35, 1, 0.01],
              ['steps', 'QUALITY', 12, 88, 1]]],

  ['NEBULA', colour('neb').concat([
    ['nebDensity', 'DENSITY', 0, 3, 0.02],
    ['nebFill', 'FILL', 0, 1, 0.01],
    ['nebFluff', 'FLUFF', 0.15, 0.9, 0.01],
    ['nebStreak', 'STREAK', 0.05, 2, 0.01],
    ['nebVar', 'VARIANCE', 0, 1, 0.01],
    ['nebScale', 'SCALE', 0.5, 8, 0.05],
    ['nebOct', 'DETAIL', 1, 5, 1],
  ], flow('neb'))],

  ['LIGHTSPEED', colour('ls').concat([
    ['lsDensity', 'BRIGHTNESS', 0, 4, 0.02],
    ['lsCount', 'STREAKS', 8, 260, 1],
    ['lsLen', 'LENGTH', 0.004, 1, 0.004],
    ['lsThick', 'THICKNESS', 0.04, 0.6, 0.005],
    ['lsVar', 'VARIANCE', 0, 1, 0.01],
    ['lsRadial', 'SPREAD', 0, 1, 0.01],
  ], flow('ls'))],

  ['PLASMA', colour('pl').concat([
    ['plDensity', 'BRIGHTNESS', 0, 3, 0.02],
    ['plCrackle', 'CRACKLE', 0, 1, 0.01],
    ['plCrawl', 'CRAWL', 0, 2, 0.01],
    ['plStrike', 'STRIKE', 0, 2, 0.01],
    ['plFlash', 'FLASH', 0, 1, 0.01],
    ['plLight', 'LIGHTS CLOUD', 0, 1, 0.01],
  ], flow('pl'))],

  ['IMAGE', [['glow', 'THROAT', 0, 3, 0.02],
             ['throatTint', 'THROAT TINT', 0, 1, 0.01],
             ['throatRays', 'THROAT RAYS', 0, 1, 0.01],
             ['exposure', 'EXPOSURE', 0.2, 3, 0.01],
             ['chroma', 'CHROMA', 0, 3, 0.05],
             ['vignette', 'VIGNETTE', 0, 1, 0.01]]],
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

  glow:        as.ofRange(3),
  throatTint:  as.ends(as.pct(), 'WHITE', 'LAYERS', 1),
  throatRays:  as.off(as.pct()),
  exposure:    as.mult(2),
  chroma:      as.ofRange(3),
  vignette:    as.pct(),
};
