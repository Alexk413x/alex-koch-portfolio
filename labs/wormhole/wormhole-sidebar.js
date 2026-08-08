/* Which controls exist, and how each one reads. SECTIONS is pure data in panel.js's row grammar; FMT is display
 * text only. A slider's range is in the units the SHADER wants; the formatter is the only place the displayed
 * unit exists.
 */
import { as } from '../kit/units.js';

export const SECTIONS = [
  /* RENDER ABOVE THE FIELD, for the reason crt-sidebar puts it above the tube: it sets the resolution everything
   * else is drawn at, so it governs every section rather than belonging to one -- and it is the control you reach
   * for first when the frame rate is wrong, which is not a reason to scroll. */
  ['RENDER', [['renderScale', 'RENDER SCALE', 0.35, 1, 0.01]]],
  /* MODE is not a row: it selects which of the three density functions every slider below is feeding, so it sits
   * at the top of the panel as its own strip, above the sections. TURBULENCE does nothing at all in LIGHTSPEED. */
  ['FIELD', [['speed', 'SPEED', -12, 12, 0.05],
             ['turb', 'TURBULENCE', 0, 3, 0.05],
             ['twist', 'TWIST', -4, 4, 0.05],
             ['rot', 'ROTATION', -2, 2, 0.02]]],
  ['COLOUR', [['chroma', 'CHROMA', 0, 3, 0.05],
              ['glow', 'GLOW', 0.2, 3, 0.05],
              ['hue', 'HUE', 0, 1, 0.01]]],
];

/* SPEED IS SIGNED AND READS IN c, which is the joke the lab is built on and also the honest unit: the sign is the
 * direction of travel down the throat, and 0 is a standing field rather than a stopped one.
 *
 * The three 0..3 sliders read as a percentage OF THEIR OWN RANGE rather than as a raw multiplier, because none of
 * them has a physical unit and "58%" answers "how far up is this" where "1.74" does not.
 *
 * TWIST and ROTATION are stored as the shader's own coefficients and read as the angle they describe, which is why
 * they are `scaled` rather than `deg`: the number in state is not a number of degrees.
 */
export const FMT = {
  speed:  as.raw(1, 'c'),
  turb:   as.ofRange(3),
  twist:  as.scaled(90, 0, '°'),
  rot:    as.scaled(90, 0, '°/s'),
  chroma: as.ofRange(3),
  glow:   as.ofRange(3),
  hue:    as.scaled(360, 0, '°'),
  renderScale: as.pct(),
};
