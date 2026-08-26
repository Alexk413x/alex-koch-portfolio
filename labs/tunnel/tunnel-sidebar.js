/* Which controls exist, and how each one reads. SECTIONS is pure data in panel.js's row grammar; FMT is display
 * text only.
 *
 * THE SHELL SECTIONS ARE GENERATED, not written out. There are up to MAXL of them and they are identical but for
 * an index, so writing five copies is five places to forget the same edit. LAYERS decides how many the panel
 * shows, and the host rebuilds it when that changes.
 *
 * A SHELL IS A SURFACE, NOT AN EFFECT. Its rows split in two: where it is (RADIUS, SPEED, STRETCH, SPIN) and what
 * is drawn on it (NEBULA, PLASMA, STREAKS, RINGS, any mix). The first shape of this lab tied one effect to one
 * shell -- a cloud shell, a bolt shell -- and that put every interesting combination out of reach: bolts on the
 * near shell AND the far one, a shell carrying both, streaks anywhere but the outside.
 *
 * WHICH MEANS EVERY PARAMETER OF AN EFFECT IS THE SHELL'S TOO. STREAKS briefly kept a global COUNT, SPEED and
 * COLOR while its amount was per shell -- half a property of the surface and half not, which is the same mistake
 * one step smaller. It now takes the shell's own SPEED and COLOR and carries only LANES, so streaks on the near
 * shell tear past while streaks on the far one drift. That difference is depth, and depth is what shells are for.
 */
import { as } from '../kit/units.js';
import { MAXL } from './tunnel-shader.js';

export const LAYER_NAMES = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH'];

/* The rows one shell owns. `i` only reaches the key; every label is the same, because the section header is
 * already saying which shell this is.
 *
 * THE LABELS SAY NEBULA AND PLASMA; THE KEYS STILL SAY CLOUD AND BOLT. A key is an address, not a label -- every
 * saved configuration is filed under the old words, and renaming them would orphan the lot in silence rather
 * than fail loudly. Same reason CRT Lab stores under `crtgl`. Read the two as the same thing. */
const shellRows = (i) => [
  ['L' + i + 'Rad', 'RADIUS', 0.12, 2.4, 0.01],
  ['L' + i + 'Amt', 'AMOUNT', 0, 2, 0.02],
  ['L' + i + 'Speed', 'SPEED', -25, 25, 0.1],
  ['L' + i + 'Warp', 'STRETCH', 0.03, 1.2, 0.01],
  ['L' + i + 'Spin', 'SPIN', -2, 2, 0.01],

  /* EACH EFFECT'S AMOUNT IS FOLLOWED BY ITS OWN COLORS, so a shell reads as a list of what is drawn on it rather
   * than a block of amounts and a block of colors that have to be matched up by eye. The swatch pair is ONE row:
   * two ends of one gradient is one decision made twice, and split across two rows it reads as two unrelated
   * settings at twice the height. A row is hidden while its effect is off, because a color that tints nothing is
   * a control that does nothing. */
  /* EACH EFFECT CARRIES ITS OWN SHAPE CONTROLS, directly under it.
   *
   * FILL, EDGE and DETAIL used to sit at the bottom serving whichever of NEBULA and PLASMA was lit, and that was
   * wrong twice over. DETAIL and FILL only ever reached the nebula -- the plasma field is a distance to where two
   * noise fields both cross zero, and there are no octaves in it and nothing to threshold. EDGE reached both,
   * so tuning the nebula's softness moved the plasma's thickness. One slider, two surfaces, no way to set either
   * without disturbing the other. */
  ['L' + i + 'Cloud', 'NEBULA', 0, 2, 0.02],
  [['L' + i + 'CloudA', 'L' + i + 'CloudB'], 'NEBULA COLOR', '#'],
  ['L' + i + 'Fill', 'NEBULA FILL', 0, 1, 0.01],
  ['L' + i + 'Edge', 'NEBULA EDGE', 0.02, 0.7, 0.01],
  ['L' + i + 'Oct', 'NEBULA DETAIL', 1, 5, 1],

  ['L' + i + 'Bolts', 'PLASMA', 0, 2, 0.02],
  [['L' + i + 'BoltA', 'L' + i + 'BoltB'], 'PLASMA COLOR', '#'],
  ['L' + i + 'BoltFill', 'PLASMA FILL', 0, 1, 0.01],
  ['L' + i + 'BoltEdge', 'PLASMA EDGE', 0.01, 0.7, 0.01],

  ['L' + i + 'Streak', 'STREAKS', 0, 2, 0.02],
  [['L' + i + 'StrkA', 'L' + i + 'StrkB'], 'STREAK COLOR', '#'],
  ['L' + i + 'Lanes', 'LANES', 8, 400, 1],

  ['L' + i + 'Ring', 'RINGS', 0, 1, 0.01],
  ['L' + i + 'RingN', 'RING SPACING', 0.5, 14, 0.1],
  ['L' + i + 'RingFlow', 'RING FLOW', -20, 20, 0.2],
];

/* Sections for the shells the state currently has. Called by the host on every rebuild, so LAYERS adds and
 * removes whole sections rather than leaving dead ones on screen.
 *
 * A shell's master is its own On key, so a shell can be silenced without losing what it was set to. */
export function shellSections(n) {
  const out = [];
  for (let i = 0; i < Math.min(n, MAXL); i++) {
    out.push([LAYER_NAMES[i] + ' SHELL', shellRows(i), 'L' + i + 'On']);
  }
  return out;
}

/* RENDER first, because its rows are cost and framing rather than scene. TUNNEL next: the shape every shell is
 * drawn in. Then BLACK HOLE, which is what the tunnel ends at. Then the shells themselves.
 *
 * There was an IMAGE section between the first two and it is gone -- it held the lens and the whole-frame post,
 * and RENDER SCALE alone is not a section. Nobody looking for EXPOSURE knew whether that counted as image or as
 * render, which is the test a section boundary has to pass.
 */
export const HEAD = [
  /* RENDER IS EVERYTHING ABOUT THE PICTURE RATHER THAN THE SCENE: how much is drawn, the lens it is seen
   * through, and the post applied to the finished frame. It was two sections and the split never earned itself --
   * RENDER SCALE alone is not a section, and nobody looking for EXPOSURE knows whether that counts as image or
   * as render. */
  ['RENDER', [['renderScale', 'RENDER SCALE', 0.25, 2, 0.05],
              ['fov', 'FOV', 30, 110, 1],
              ['exposure', 'EXPOSURE', 0.2, 3, 0.02]]],

  ['TUNNEL', [['far', 'DEPTH', 6, 90, 0.5],
              ['fog', 'DEPTH FADE', 0, 1, 0.01],
              ['bend', 'BEND', 0, 12, 0.05],
              ['bendDir', 'BEND TOWARD', -3.14, 3.14, 0.02],
              ['bendFlow', 'BEND FLOW', -20, 20, 0.2]]],

  /* THE FAR END IS A BLACK HOLE, not a glow, and the shader traces the real null geodesic through it. What
   * that buys is that almost nothing here is a control: the shadow, the photon ring, the disc's inner edge and
   * the second image of the disc arcing over the top of the shadow are all consequences of MASS and appear
   * without a slider naming any of them.
   *
   * MASS IS THE ONLY NUMBER THE HOLE HAS. There was a LENS beside it and it was a second gravity -- it scaled
   * how hard light bent while the shadow stayed on MASS, so the warp and the thing it warped around were free
   * to disagree about the same hole. There is nothing left for it to mean.
   *
   * IT READS IN SOLAR MASSES AND STEPS BY ONE, because that is the unit a black hole's mass is quoted in and
   * one is the increment somebody actually wants. It was a PERCENTAGE OF ITS OWN RANGE stepping by 0.05, which
   * is two failures at once: a percentage of a range is not a measurement of anything, and a step that fine
   * meant twenty presses of the arrow to move the hole a size you could see. One solar mass is 0.2 world units
   * of Schwarzschild radius here -- stated once, in the shader, where rs is worked out.
   *
   * DISC REACH IS AN OUTRIGHT RADIUS, in the same world units as DEPTH, so it stays put when MASS moves. The
   * INNER edge is not a control at all: it is the innermost stable orbit, 3 Rs, and nothing orbits inside it.
   *
   * DISC HEIGHT IS THE SLAB'S HALF-THICKNESS at the inner edge, IN SCHWARZSCHILD RADII. It is a real control
   * now because the disc is integrated as a volume along the same march that bends the light -- a deeper slab
   * holds more gas and glows more where the ray runs further through it. The earlier version of this slider only
   * sized a sampling window and cancelled out of the brightness, so it moved nothing, and it was removed.
   * It read as a PERCENTAGE of the inner edge, which is a ratio to something the panel never names; Rs is the
   * length everything else about the hole is quoted in, so the slab is quoted in it too.
   *
   * TILT 0 IS FLAT: the disc's normal points at the eye and you look down on a ring. At 90 you see the plane
   * along its own surface -- it crosses the middle as a bar and its far side bends over the top of the shadow
   * and under the bottom at the same time, which is the picture everyone means. It reaches 0 and it reaches 90;
   * the slab is what lets an exactly edge-on disc still be found.
   *
   * IT RUNS TO -90 AS WELL, which tips the disc the other way so the eye sits under its plane rather than over
   * it. That is not a second control: -t is the same plane as +t with LEAN swung half a turn, and having it on
   * TILT means you can cross the flat and come out the other side without also reaching for LEAN.
   *
   * BOTH ANGLES ARE STORED AND SHOWN IN DEGREES, and step by one. They were stored in RADIANS and printed with
   * a degree sign, so a disc turned 69 degrees read as "1" on the panel -- a number in one unit wearing another
   * unit's label. The shader wants radians and the host converts on the way out, which is exactly what FOV
   * already does. A step of 0.01 radians was also 0.57 of a degree, so the arrow key moved the disc by an
   * amount no one could see.
   *
   * TILT AND LEAN ARE THE ONLY TWO ANGLES A PLANE HAS. Its orientation is its normal and a direction takes two
   * numbers; the third rotation a solid would have does nothing to a plane. What that one would have done is
   * turn the pattern, and DISC SPIN already does.
   *
   * DOPPLER SCALES THE ORBITAL HALF OF ONE REDSHIFT FACTOR. The gravitational half is not a control, because
   * it is a fact about where the light was emitted rather than a taste. Both drive brightness and colour from
   * the same number.
   */
  /* THE TOP OF THE MASS RANGE IS THE LAST SETTING THAT STILL SHOWS SOMETHING, and it was measured rather than
     derived. The shadow's apparent radius is 2.598 Rs scaled by fov/DEPTH, so it grows straight through the
     frame: at the shipped FOV and DEPTH it is 0.27 of the frame's half-height at 20 solar masses, most of the
     picture by 30, and at 40 the render comes back COMPLETELY BLACK -- correct, and useless as a control. The
     old top end was 40, so the last third of the slider did nothing anyone could see. 24 keeps the shadow
     inside the frame with the disc clear of it. It also caps the worst case the march can be asked for, which
     is the same edge from the other side. */
  ['BLACK HOLE', [['mass', 'MASS', 0, 24, 1],
                  ['disc', 'DISC', 0, 2, 0.02],
                  [['discA', 'discB'], 'DISC COLOR', '#'],
                  ['discTilt', 'DISC TILT', -90, 90, 1],
                  ['discLean', 'DISC LEAN', -180, 180, 1],
                  ['discOut', 'DISC REACH', 0.2, 30, 0.1],
                  ['discH', 'DISC HEIGHT', 0.05, 2.0, 0.05],
                  ['discSpin', 'DISC SPIN', -20, 20, 1],
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
  // The slab's half-thickness at the inner edge, as a length. Rs is the unit every other radius here is in.
  discH:       as.raw(2, ' Rs'),
  /* AN ANGULAR RATE, READ AS ONE. It was printed in fractions of c, borrowed from the shell SPEED rows -- and
     the disc's pattern rate is not a speed of light and has no business wearing that unit. The number shown is
     how fast the INNER EDGE turns, because a Keplerian disc has no single rate: everything further out goes as
     r^-3/2 of it. 0.5 rad per unit per second is the shader's own factor, in degrees. */
  discSpin:    as.scaled(28.6, 0, '°/s'),
  /* NOT as.off(). It names the BOTTOM of a range, and DOPPLER's bottom is now -2 rather than 0 -- so every
     negative setting would have read OFF while the beaming ran backwards in front of you. A signed control
     cannot use a formatter that means "this end is nothing". */
  doppler:     as.mult(2),
};

// The shell rows share one set of formatters; written once and applied to every index for the same reason the
// sections are generated.
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
    // The bolts' pair reads the same way the cloud's does, because it means the same thing on its own surface.
    ['L' + i + 'BoltFill']: as.ends(as.pct(), 'RARE', 'SOLID', 1),
    ['L' + i + 'BoltEdge']: as.ends(as.pct(), 'HARD', 'SOFT', 0.7),
    ['L' + i + 'Speed']:  SPEED,
    ['L' + i + 'Warp']:   as.ends(as.mult(2), 'STREAKY', 'ROUND', 1.2),
    ['L' + i + 'Spin']:   DEG,
  });
}
