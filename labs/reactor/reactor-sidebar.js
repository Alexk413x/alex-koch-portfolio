/* Which controls exist, and how each one reads. SECTIONS is pure data in panel.js's row grammar; FMT is display
 * text only and no formatter may alter state.
 *
 * Angles and rates are stored in radians and rad/s — the units the maths wants — and read out in degrees and RPM.
 * Speeds are signed and centred on zero, so a rotation can be stopped at rest from either direction.
 */
import { as } from '../kit/units.js';
import { MODES } from './reactor-presets.js';

export const SECTIONS = [
  /* RENDER FIRST, for the reason crt-sidebar puts it above the tube: it sets the resolution everything below is
   * drawn at, so it governs every section rather than belonging to one -- and on a seventy-step raymarch it is the
   * control you reach for the moment the frame rate is wrong. */
  ['RENDER', [['renderScale', 'RENDER SCALE', 0.35, 1, 0.01]]],

  /* CORE: the colour first, because every other row in the section is read through it, then the two rotations,
   * then the surface, then how much of it there is to compute. DETAIL is last because it is a cost dial, not a
   * look dial -- each octave is another noise evaluation per march step. */
  ['CORE', [['coreHex', 'CORE COLOUR', '#'],
            ['hue', 'RADIATION', 0, 6.2832, 0.01],
            ['size', 'SIZE', 0, 1.5, 0.01],
            ['shape', 'SHAPE', ['●', '◈', '■', '▲', '▬']],
            ['coreSpin', 'SPIN Y', -5.236, 5.236, 0.02],
            ['coreAngle', 'ANGLE Y', -Math.PI, Math.PI, 0.01],
            ['coreSpinX', 'SPIN X', -5.236, 5.236, 0.02],
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
             ['pulseBright', 'BRIGHT', 0, 4, 0.1],
             ['pulseDur', 'DURATION', 0.3, 4, 0.1],
             ['pulseSize', 'SWELL', -1, 2, 0.1],
             ['subVT', 'SUB VIS/TRB', -3, 3, 0.1]]],

  ['VENT', [['ventSize', 'SIZE', 0.3, 6, 0.1],
            ['ventBright', 'BRIGHT', 0, 4, 0.1],
            ['ventDur', 'DURATION', 1, 10, 0.1],
            ['ventSwellPct', 'SWELL', -1, 2, 0.1],
            ['ventVT', 'VENT VIS/TRB', -3, 3, 0.1]]],

  /* RING, BEHIND A MASTER. Switching the ring off is not the same as folding the section away, which is exactly
   * the distinction kit/panel.js's buildSection draws: one removes the ring from the picture, the other tidies the
   * panel while everything carries on. Both can apply at once.
   *
   * Each axis reads ANGLE then its SPEED, because a static pose and a rate about the same axis are one decision. */
  ['RING', [['ringR', 'SIZE', 0.6, 3.0, 0.01],
            ['ringAngleX', 'ANGLE X', -Math.PI, Math.PI, 0.01],
            ['orbitX', 'ORBIT', -5.236, 5.236, 0.02],
            ['ringAngleY', 'ANGLE Y', -Math.PI, Math.PI, 0.01],
            ['orbit', 'SPIN', -5.236, 5.236, 0.02],
            ['wobble', 'WOBBLE', 0, 1.5708, 0.01],
            ['wobbleSpd', 'WOB SPD', -20, 20, 1],
            ['ringLight', 'LIGHTS', 0, 1, 0.01],
            ['ringGlow', 'SHIELD', 0, 1, 0.01],
            ['ringBreak', 'BREAK', 0, 1, 0.05],
            ['breakSpd', 'BREAK SPD', 0, 3, 0.1]], 'ringOn'],

  ['CAMERA', [['camEl', 'HEIGHT', -1.4, 1.4, 0.01],
              ['camAngle', 'ANGLE', -Math.PI, Math.PI, 0.01],
              ['cam', 'ORBIT', -5.236, 5.236, 0.02],
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
  hue:         as.rad(),
  coreSpin:    as.rpm(),
  coreAngle:   as.rad(),
  coreSpinX:   as.rpm(),
  coreAngleX:  as.rad(),
  orbit:       as.rpm(),
  orbitX:      as.rpm(),
  cam:         as.rpm(),
  ringAngleY:  as.rad(),
  ringAngleX:  as.rad(),
  camAngle:    as.rad(),
  ringR:       METRES,
  wobble:      as.rad(),
  wobbleSpd:   as.hz(),
  ringLight:   as.pct(),
  ringGlow:    as.pct(),
  ringBreak:   as.pct(),
  breakSpd:    as.raw(1, ' m/s'),
  camEl:       METRES,
  zoom:        as.mult(2),
  pulseAmp:    as.raw(0, ' kPa'),
  pulseSize:   as.pct(),
  dropN:       as.raw(0),
  pulseBright: as.mult(1),
  pulseDur:    as.sec(1),
  ventSize:    as.mult(1),
  ventBright:  as.mult(1),
  ventDur:     as.sec(1),
  ventSwellPct: as.pct(),
  subVT:       as.mult(1),
  ventVT:      as.mult(1),
  renderScale: as.pct(),
};
