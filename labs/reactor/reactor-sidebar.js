/* Which controls exist, and how each one reads. SECTIONS is pure data in panel.js's row grammar; FMT is display
 * text only and no formatter may alter state.
 *
 * Angles are stored in radians and read in degrees. ROTATION RATES ARE STORED IN RPM, the unit their rows
 * read and step in, so the panel does no arithmetic at all: integer range, integer step, integer readout.
 * reactor-sim converts to rad/s once, where a rate becomes a phase.
 * Speeds are signed and centred on zero, so a rotation can be stopped at rest from either direction.
 */
import { as } from '../kit/units.js';

export const SECTIONS = [
  /* RENDER FIRST, for the reason crt-sidebar puts it above the tube: it sets the resolution everything below is
   * drawn at, so it governs every section rather than belonging to one -- and on a seventy-step raymarch it is the
   * control you reach for the moment the frame rate is wrong. */
  ['RENDER', [['renderScale', 'RENDER SCALE', 0.35, 1, 0.01]]],

  /* CORE: SHAPE first as a wide, label-less strip -- these are silhouettes rather than words, and at row height
   * beside a label they read as punctuation. Then the colour, which every row below is read through, then the two
   * rotations, then the surface, then how much of it there is to compute. DETAIL is last because it is a cost
   * dial, not a look dial -- each octave is another noise evaluation per march step. */
  ['CORE', [['shape', '', ['●', '⬟', '■', '▲', '▬'], { wide: true }],
            ['coreHex', 'CORE COLOUR', '#'],
            ['size', 'SIZE', 0, 1.5, 0.01],
            ['coreSpin', 'SPIN Y', -50, 50, 1],
            ['coreAngle', 'ANGLE Y', -Math.PI, Math.PI, 0.01],
            ['coreSpinX', 'SPIN X', -50, 50, 1],
            ['coreAngleX', 'ANGLE X', -Math.PI, Math.PI, 0.01],
            ['visc', 'VISCOSITY', -7, 7, 0.05],
            ['turb', 'TURBULENCE', 0, 1, 0.005],
            ['rate', 'RATE', 0, 20, 1],
            ['amp', 'AMPLITUDE', 0, 2.0, 0.01],
            ['glow', 'GLOW', 0, 5, 0.05],
            ['octaves', 'DETAIL', 1, 6, 1]]],

  /* PULSE: FORCE is the impulse the spring is kicked with and DURATION is its period, so the two together decide
   * how far the surface travels -- they are the same gesture and sit together. */
  ['PULSE', [['pulseAmp', 'FORCE', 1, 20, 0.5],
             ['dropN', 'SUB-CORES', 0, 20, 1],
             ['dropSize', 'SUB-CORE SIZE', 0.2, 2, 0.05],
             ['pulseBright', 'BRIGHT', 0, 4, 0.1],
             ['pulseDur', 'DURATION', 0.3, 4, 0.1],
             ['pulseSize', 'SWELL', -1, 2, 0.1],
             /* Two controls, not one: SUB VIS/TRB roils the whole surface while a pulse fires, SUB-CORE SURFACE
              * only decides whether the sub-cores carry that surface too. At 0 they render as smooth spheres. */
             ['subVT', 'SUB VIS/TRB', -3, 3, 0.1],
             ['subSurf', 'SUB-CORE SURFACE', 0, 2, 0.05]]],

  ['VENT', [['ventSize', 'SIZE', 0.3, 6, 0.1],
            ['ventBright', 'BRIGHT', 0, 4, 0.1],
            ['ventDur', 'DURATION', 1, 10, 0.1],
            ['ventSwellPct', 'SWELL', -1, 2, 0.1],
            ['ventVT', 'VENT VIS/TRB', -3, 3, 0.1]]],

  /* RING, BEHIND A MASTER. Switching the ring off is not the same as folding the section away, which is exactly
   * the distinction kit/panel.js's buildSection draws: one removes the ring from the picture, the other tidies the
   * panel while everything carries on. Both can apply at once.
   *
   * THREE AXES, GROUPED BY AXIS, each reading its rate then its static ANGLE -- a pose and a rate about the same
   * axis are one decision. SPIN turns the band inside its own plane and moves nothing but the surface pattern;
   * ORBIT X and ORBIT Z each flip it end over end, and between them the ring can present any face to the core.
   * Each tumble carries its own WOBBLE, because a nutation belongs to the axis it perturbs -- one shared wobble
   * cannot say which way the ring should judder.
   *
   * The three rates reach +-60 RPM, one revolution per second, past the +-50 the rest use: MELTDOWN has to
   * express the whole of its motion here now, and nothing downstream scales it.
   *
   * LIGHTS, ROUGHNESS and WEAR sit together above SHIELD: the three describe the band's own surface, where SHIELD
   * describes the film in front of it. ROUGHNESS is a percentage of satin, not of gloss, so both dials read "more
   * of the thing named" as they rise. */
  ['RING', [['ringR', 'SIZE', 0.6, 3.0, 0.01],
            ['orbit', 'SPIN', -60, 60, 1],
            ['ringAngleY', 'SPIN ANGLE', -Math.PI, Math.PI, 0.01],
            ['orbitX', 'ORBIT X', -60, 60, 1],
            ['ringAngleX', 'ANGLE X', -Math.PI, Math.PI, 0.01],
            ['wobbleX', 'WOBBLE X', 0, 1.5708, 0.01],
            ['wobSpdX', 'WOB X SPD', -20, 20, 1],
            ['orbitZ', 'ORBIT Z', -60, 60, 1],
            ['ringAngleZ', 'ANGLE Z', -Math.PI, Math.PI, 0.01],
            ['wobbleZ', 'WOBBLE Z', 0, 1.5708, 0.01],
            ['wobSpdZ', 'WOB Z SPD', -20, 20, 1],
            ['ringLight', 'LIGHTS', 0, 1, 0.01],
            ['ringRough', 'ROUGHNESS', 0, 1, 0.01],
            ['ringWear', 'WEAR', 0, 1, 0.01],
            ['ringGlow', 'SHIELD', 0, 1, 0.01],
            ['ringBreak', 'BREAK', 0, 1, 0.05],
            ['breakSpd', 'BREAK SPD', 0, 3, 0.1]], 'ringOn'],

  ['CAMERA', [['camEl', 'HEIGHT', -1.4, 1.4, 0.01],
              ['camAngle', 'ANGLE', -Math.PI, Math.PI, 0.01],
              ['cam', 'ORBIT', -50, 50, 1],
              ['zoom', 'ZOOM', 0.5, 3, 0.01]]],
];

/* The units are the instrument's fiction, held consistently: metres for a metre-scale core, megawatts for GLOW,
 * pascal-seconds for VISCOSITY. Nothing is dimensionally derived — they are labels chosen once, taken from
 * kit/units.js so two rows describing the same kind of quantity cannot read differently. */
const METRES = as.scaled(100, 0, ' m');

export const FMT = {
  size:        METRES,
  visc:        as.raw(1, ' Pa·s'),
  turb:        as.pct(),
  rate:        as.hz(),
  amp:         METRES,
  glow:        as.scaled(100, 0, ' MW'),
  octaves:     as.raw(0, ' oct'),
  coreSpin:    as.raw(0, ' RPM'),
  coreAngle:   as.rad(),
  coreSpinX:   as.raw(0, ' RPM'),
  coreAngleX:  as.rad(),
  orbit:       as.raw(0, ' RPM'),
  orbitX:      as.raw(0, ' RPM'),
  orbitZ:      as.raw(0, ' RPM'),
  cam:         as.raw(0, ' RPM'),
  ringAngleY:  as.rad(),
  ringAngleX:  as.rad(),
  ringAngleZ:  as.rad(),
  camAngle:    as.rad(),
  ringR:       METRES,
  wobbleX:     as.rad(),
  wobSpdX:     as.hz(),
  wobbleZ:     as.rad(),
  wobSpdZ:     as.hz(),
  ringLight:   as.pct(),
  ringRough:   as.pct(),
  ringWear:    as.pct(),
  ringGlow:    as.pct(),
  ringBreak:   as.pct(),
  breakSpd:    as.raw(1, ' m/s'),
  camEl:       METRES,
  zoom:        as.mult(2),
  pulseAmp:    as.raw(0, ' kPa'),
  pulseSize:   as.pct(),
  dropN:       as.raw(0),
  dropSize:    as.mult(2),
  pulseBright: as.mult(1),
  pulseDur:    as.sec(1),
  ventSize:    as.mult(1),
  ventBright:  as.mult(1),
  ventDur:     as.sec(1),
  ventSwellPct: as.pct(),
  subVT:       as.mult(1),
  subSurf:     as.mult(2),
  ventVT:      as.mult(1),
  renderScale: as.pct(),
};
