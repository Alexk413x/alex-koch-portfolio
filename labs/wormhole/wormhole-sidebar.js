/* HEAD and shellSections describe the panel's rows in panel.js's grammar; FMT formats their values for
 * display. A shell is a surface, not an effect: its rows split into where it is (RADIUS, SPEED, STRETCH,
 * SPIN) and what's drawn on it (NEBULA, PLASMA, STREAKS, RINGS), so any effect can appear on any shell
 * instead of being locked to one. */
import { as } from '../kit/units.js';
import { MAXL } from './wormhole-shader.js';

export const LAYER_NAMES = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH'];

/* Rows for one shell, keyed by index i — every section reuses this so adding a shell needs no new rows.
 * Keys still say CLOUD/BOLT where labels say NEBULA/PLASMA: saved settings are filed under the old names,
 * so renaming the keys would orphan them (same reason CRT Lab stores under `crtgl`). */
const shellRows = (i) => [
  ['L' + i + 'Rad', 'RADIUS', 0.12, 2.4, 0.01],
  ['L' + i + 'Amt', 'AMOUNT', 0, 2, 0.02],
  ['L' + i + 'Speed', 'SPEED', -25, 25, 0.1],
  ['L' + i + 'Warp', 'STRETCH', 0.03, 1.2, 0.01],
  ['L' + i + 'Spin', 'SPIN', -2, 2, 0.01],

  /* Each effect's amount is followed by its own color pair and FILL/EDGE, so a shell reads as what's drawn
   * on it, not a block of amounts matched by eye to a block of colors. A two-key array renders one swatch
   * row, hidden while its effect is off. FILL/EDGE are per effect — sharing one once coupled the nebula's
   * softness to the plasma's thickness, and DETAIL only applies to nebula's octaves; plasma has none. */
  ['L' + i + 'Cloud', 'NEBULA', 0, 2, 0.02],
  [['L' + i + 'CloudA', 'L' + i + 'CloudB'], 'NEBULA COLOR', '#'],
  ['L' + i + 'Fill', 'NEBULA FILL', 0, 1, 0.01],
  ['L' + i + 'Edge', 'NEBULA EDGE', 0.02, 0.7, 0.01],
  ['L' + i + 'Oct', 'NEBULA DETAIL', 1, 5, 1],

  ['L' + i + 'Bolts', 'PLASMA', 0, 2, 0.02],
  [['L' + i + 'BoltA', 'L' + i + 'BoltB'], 'PLASMA COLOR', '#'],
  ['L' + i + 'BoltFill', 'PLASMA FILL', 0, 1, 0.01],
  ['L' + i + 'BoltEdge', 'PLASMA EDGE', 0.01, 0.7, 0.01],
  ['L' + i + 'BoltRipple', 'PLASMA RIPPLE', 0, 4, 0.05],

  ['L' + i + 'Streak', 'STREAKS', 0, 2, 0.02],
  [['L' + i + 'StrkA', 'L' + i + 'StrkB'], 'STREAK COLOR', '#'],
  ['L' + i + 'Lanes', 'LANES', 8, 400, 1],

  ['L' + i + 'Ring', 'RINGS', 0, 1, 0.01],
  ['L' + i + 'RingN', 'RING SPACING', 0.5, 14, 0.1],
  ['L' + i + 'RingFlow', 'RING FLOW', -20, 20, 0.2],
];

/* Builds one section per active shell, up to MAXL, so LAYERS adds and removes whole sections rather than
 * leaving dead ones on screen. Each shell's master is its own On key, so muting it keeps its settings. */
export function shellSections(n) {
  const out = [];
  for (let i = 0; i < Math.min(n, MAXL); i++) {
    out.push([LAYER_NAMES[i] + ' SHELL', shellRows(i), 'L' + i + 'On']);
  }
  return out;
}

// Order: RENDER (cost/framing), TUNNEL (shape), BLACK HOLE (what it ends at), then the shells. RENDER
// merges the old image/render split — RENDER SCALE alone didn't justify a section of its own.
export const HEAD = [
  ['RENDER', [['renderScale', 'RENDER SCALE', 0.25, 2, 0.05],
              ['fov', 'FOV', 30, 110, 1],
              ['exposure', 'EXPOSURE', 0.2, 3, 0.02]]],

  ['TUNNEL', [['far', 'DEPTH', 6, 90, 0.5],
              ['fog', 'DEPTH FADE', 0, 1, 0.01],
              ['bend', 'BEND', 0, 12, 0.05],
              ['bendDir', 'BEND TOWARD', -3.14, 3.14, 0.02],
              ['bendFlow', 'BEND FLOW', -20, 20, 0.2]]],

  // A real geodesic trace: the shadow, photon ring, disc inner edge and its second image above the shadow
  // are consequences of MASS, not separate sliders.
  ['BLACK HOLE', [['mass', 'MASS', 0, 24, 1],
                  // MASS is the hole's only number — a separate LENS once let warp and shadow disagree
                  // about the same hole. 1 M☉ = 0.2 world units of Rs, set in the shader where rs is
                  // computed; the range tops out at 24 because the shadow already eats most of the frame
                  // by 30 and the render is solid black by 40.
                  ['disc', 'DISC', 0, 2, 0.02],
                  [['discA', 'discB'], 'DISC COLOR', '#'],
                  ['discTilt', 'DISC TILT', -90, 90, 1],
                  // TILT 0 is flat, 90 is edge-on (the slab keeps an edge-on disc visible); negative TILT
                  // flips the disc rather than reaching for LEAN. Both angles are stored and shown in
                  // degrees, converted from the shader's radians like FOV — they used to be stored as
                  // radians and labeled degrees, so a 69° turn read as "1".
                  ['discLean', 'DISC LEAN', -180, 180, 1],
                  ['discOut', 'DISC REACH', 0.2, 30, 0.1],
                  // REACH is a radius in DEPTH's world units, so it doesn't move with MASS. The inner edge
                  // is fixed at 3 Rs (the ISCO), not a control.
                  ['discH', 'DISC HEIGHT', 0.05, 2.0, 0.05],
                  // Half-thickness at the inner edge, in Rs. A real control because the disc is integrated
                  // as a volume along the march; an earlier version only sized the sampling window and
                  // canceled out of the brightness, so it moved nothing.
                  ['discSpin', 'DISC SPIN', -20, 20, 1],
                  ['discFlow', 'DISC FLOW', -8, 8, 1],
                  // SPIN (rotation) and FLOW (radial drift) are independent. FLOW is signed as a rate of
                  // change of radius, so negative accretes and positive streams outward — they used to
                  // share a sign, so reversing SPIN also reversed FLOW.
                  ['doppler', 'DOPPLER', -2, 2, 0.05]], 'holeOn'],
];

// Every key persist() must know about, whether or not its section is on screen at the moment.
export const ALL_SECTIONS = HEAD.concat(shellSections(MAXL));

// Every shell, always. Each is switched at its own header, so there is nothing for a count to decide.
export function sectionsFor() {
  return ALL_SECTIONS;
}

const DEG = as.scaled(90, 0, '°/s');
const SPEED = as.raw(1, 'c');

export const FMT = {
  renderScale: as.pct(),

  fov:         as.deg(),
  exposure:    as.mult(2),
  fog:         as.off(as.pct()),

  far:         as.raw(0, ' deep'),
  bend:        as.off(as.mult(2)),
  bendDir:     as.rad(0),
  bendFlow:    SPEED,

  mass:        as.off(as.raw(0, ' M\u2609')),
  disc:        as.off(as.ofRange(2)),
  discTilt:    as.deg(),
  discLean:    as.deg(),
  discOut:     as.raw(1, ' out'),
  discH:       as.raw(2, ' Rs'),
  // Shown as the inner edge's own rate — a Keplerian disc has no single rate; everything further out goes
  // as r^-3/2 of it.
  discSpin:    as.scaled(28.6, 0, '°/s'),
  // r/s = world units of radius per second, matching DISC REACH; negative falls inward (accretion).
  discFlow:    as.scaled(0.075, 2, ' r/s'),
  // Not as.off(): DOPPLER's range is -2..2, not 0..range, so as.off() would read every negative setting
  // as OFF.
  doppler:     as.mult(2),
};

// One set of formatters applied to every shell index, for the same reason the rows are generated.
for (let i = 0; i < MAXL; i++) {
  Object.assign(FMT, {
    ['L' + i + 'Rad']:    as.mult(2),
    ['L' + i + 'Amt']:    as.ofRange(2),
    ['L' + i + 'Cloud']:  as.off(as.ofRange(2)),
    ['L' + i + 'Bolts']:  as.off(as.ofRange(2)),
    ['L' + i + 'Streak']: as.off(as.ofRange(2)),
    ['L' + i + 'Lanes']:  as.raw(0, ' lanes'),
    ['L' + i + 'Ring']:   as.off(as.pct()),
    // Spacing reads as how many rings stand between the eye and the throat, which is the thing being set.
    ['L' + i + 'RingN']:  as.raw(0, ' rings'),
    ['L' + i + 'RingFlow']: SPEED,
    ['L' + i + 'Fill']:   as.ends(as.pct(), 'RARE', 'SOLID', 1),
    ['L' + i + 'Edge']:   as.ends(as.pct(), 'HARD', 'SOFT', 0.7),
    ['L' + i + 'Oct']:    as.raw(0, ' oct'),
    ['L' + i + 'BoltFill']: as.ends(as.pct(), 'RARE', 'SOLID', 1),
    ['L' + i + 'BoltEdge']: as.ends(as.pct(), 'HARD', 'SOFT', 0.7),
    // How fast the filament reshapes, as distinct from how fast SPEED carries it along the tube.
    ['L' + i + 'BoltRipple']: as.off(as.mult(2)),
    ['L' + i + 'Speed']:  SPEED,
    ['L' + i + 'Warp']:   as.ends(as.mult(2), 'STREAKY', 'ROUND', 1.2),
    ['L' + i + 'Spin']:   DEG,
  });
}
