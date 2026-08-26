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

/* RENDER first because both rows are cost rather than look. IMAGE second because it is the lens and the
 * whole-frame post -- the last things done to whatever was drawn -- so reading the panel top to bottom follows
 * the order the pixels are built in. TUNNEL third: the shape every shell is drawn in. Then the shells.
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

  /* THE FAR END IS A BLACK HOLE, not a glow. It was a sprite painted over the vanishing point and it hid the one
   * thing this technique has that a march cannot -- the winding where the wall goes edge-on. A hole works WITH
   * that instead: MASS bends every ray near the centre so the winding wraps around it, SHADOW cuts the middle
   * out of everything behind, and the PHOTON RING is the thin circle of light that grazed it and came back.
   *
   * DISC REACH IS HOW FAR OUT THE DISC GOES, as a multiple of its inner edge -- and its range is long because
   * the inner edge is welded to MASS. A small hole would otherwise drag the whole disc down with it and the
   * shadow, the photon ring and the disc would collapse into one small feature. Welding the INNER edge is right;
   * the outer one has to be free or the two cannot be told apart.
   *
   * The DISC is a plane through the hole, solved the same way the shells are. Tilt it near edge-on and the far
   * side climbs over the top of the shadow. DOPPLER brightens the side turning toward the eye, which is what
   * makes it read as spinning rather than as a flat ring.
   *
   * TILT IS REALLY HOW FAR OFF THE DISC'S PLANE THE EYE SITS, which is why its bottom end is fenced off at
   * 0.08 rather than 0. At exactly 0 the plane passes THROUGH the camera: every ray meets it at zero distance,
   * the whole disc is skipped, and the frame comes back black. Just above 0 the eye is barely below the plane,
   * so the near half sits under the hole and the far half arcs over the top -- which reads as the light going
   * UP rather than across, and is the honest answer to why it does that. Around 0.3 to 0.6 the disc crosses the
   * middle with the far side lifted over the shadow, which is the picture everyone means.
   *
   * TILT AND LEAN ARE THE ONLY TWO ANGLES A PLANE HAS. Its orientation is its normal and a direction takes two
   * numbers; the third rotation a solid would have does nothing to a plane. What that one would have done is
   * turn the pattern, and DISC SPIN already does.
   */
  ['BLACK HOLE', [['mass', 'MASS', 0, 4, 0.02],
                  ['ring', 'PHOTON RING', 0, 3, 0.02],
                  ['ringCol', 'RING COLOR', '#'],
                  ['disc', 'DISC', 0, 2, 0.02],
                  [['discA', 'discB'], 'DISC COLOR', '#'],
                  ['discThick', 'DISC THICKNESS', 0.01, 0.6, 0.005],
                  ['discTilt', 'DISC TILT', 0.08, 1.57, 0.01],
                  ['discLean', 'DISC LEAN', -3.14, 3.14, 0.02],
                  ['discOut', 'DISC REACH', 1.1, 40, 0.1],
                  ['discSpin', 'DISC SPIN', -20, 20, 0.1],
                  ['doppler', 'DOPPLER', 0, 2, 0.02]], 'holeOn'],
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

  mass:        as.off(as.ofRange(3)),
  ring:        as.off(as.ofRange(3)),
  disc:        as.off(as.ofRange(2)),
  discThick:   as.pct(),
  discTilt:    as.rad(0),
  discLean:    as.rad(0),
  discOut:     as.mult(1),
  discSpin:    as.raw(1, 'c'),
  doppler:     as.off(as.pct()),
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
