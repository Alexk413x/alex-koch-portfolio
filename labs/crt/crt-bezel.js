/* crt/crt-bezel.js — the frame's colours.
 *
 * Pure. The bezel is PLASTIC: it takes a little of the screen's phosphor colour and a little of the room light's colour,
 * but only a little — plastic scatters rather than mirrors. The base colour comes straight from the picker and the tint is
 * mixed ON TOP of it rather than replacing it, so the moulding still reads as one material whatever colour is chosen:
 * its shadowed edge and its sheen are both derived from the base, never picked separately.
 */
import { hexRgb, mix, kelvinRgb } from './crt-phosphor.js';

const rgbStr = (a) => 'rgb(' + a.map((v) => Math.round(v)).join(',') + ')';

/* s = the settings, phosphor = the active phosphor. Returns the stroke colours and widths for the bezel's four SVG paths.
 *
 * The tint source depends on what is actually emitting: the phosphor while the tube is lit, the fixture's colour
 * temperature while the room light is on, a half-and-half mix when both are, and nothing at all when neither is.
 */
export function bezelCols(s, phosphor) {
  const on = s.power === 'on';
  const baseRgb = hexRgb(s.fcol || '#4a2c22');
  const phRgb = hexRgb(phosphor.fg);
  const lampRgb = kelvinRgb(s.temp).split(',').map(Number);
  let tintRgb = null;
  if (on && s.lightOn) tintRgb = mix(phRgb, lampRgb, 0.5);
  else if (on) tintRgb = phRgb;
  else if (s.lightOn) tintRgb = lampRgb;
  const amt = (s.ftint == null ? 35 : s.ftint) / 100;
  /* FRAME LIGHT scales the lift the lamp gives the moulding's lit edge. 50% is neutral -- the 0.28 bezelCols always applied --
   * so the default frame is unchanged and the slider reads as a departure in either direction.
   *
   * NON-LINEAR, because straight multiplication put the whole range between 0.28 and 0.56 and, with the lamp off, litAmt cut
   * that to 0.126-0.25: a few RGB points per step on a dark moulding. The 1.6 exponent leaves the midpoint exactly where it
   * was (1^1.6 = 1) while full deflection reaches the 0.9 cap, so the slider gains its top half without moving the neutral
   * setting every existing frame is calibrated against.
   *
   * AND IT REACHES ALL THREE STOPS, at falling strength -- lit edge in full, body at 0.4, shadowed outer edge at 0.15.
   * Feeding `hi` alone gave it the top ~13px of a thin frame and nothing else, which is a large change to almost no pixels.
   * Illumination falls off away from the source but does not stop; the shadow keeps most of its darkness so the frame still
   * reads as a moulding with depth rather than a flat lit ring.
   */
  const glow = Math.max(0, Math.min(2, (s.fglow == null ? 50 : s.fglow) / 50));
  const lift = Math.pow(glow, 1.6);
  /* THE LIT EDGE IS LIT BY SOMETHING, and until now it was not. `hi` was mixed from the moulding's own colour and pure
   * white at a fixed strength, so the sheen along the frame stayed exactly as bright with the fixture switched off, the
   * dimmer at zero and the tube dead as it did under a lamp at full -- a highlight with no light source. The tint band
   * beside it already tracked both, which is what made the disagreement visible.
   *
   * Two contributors, because there are two emitters: the lamp (scaled by the dimmer, and only when it is actually on) and
   * the tube's own face, which throws enough light on a surrounding moulding to keep its edge readable in a dark room. At
   * a lamp on full the strength reaches 1.0, so the frame under a working lamp looks exactly as it always did; with the
   * lamp off it drops to the tube's contribution alone, and with everything off the moulding goes nearly flat -- dead
   * plastic, which is what unlit plastic looks like.
   *
   * THE HIGHLIGHT ALSO TAKES THE LAMP'S COLOUR rather than staying white, for the same reason the tint does: a 3200K bulb
   * cannot leave a neutral highlight. It is mixed toward the lamp's own kelvin in proportion to how much of the light is
   * the lamp's, so a cold lamp reads cold and an unlit frame keeps its neutral specular.
   */
  const lamp = (on && s.lightOn) ? Math.max(0, Math.min(1, s.ldim == null ? 1 : s.ldim)) : 0;
  const litAmt = (on || s.lightOn) ? 0.45 + lamp * 0.55 : 0.18;
  const litCol = mix([255, 255, 255], lampRgb, lamp * 0.75);
  const litAt = (share) => Math.min(0.9, 0.28 * lift * litAmt * share);
  const w = (s.fwid == null ? 22 : s.fwid);
  return {
    base: rgbStr(mix(baseRgb, litCol, litAt(0.4))),
    lo: rgbStr(mix(mix(baseRgb, [0, 0, 0], 0.42), litCol, litAt(0.15))),   // the shadowed outer edge
    hi: rgbStr(mix(baseRgb, litCol, litAt(1))),   // the sheen along the lit edge of the moulding
    tint: tintRgb ? rgbStr(tintRgb) : 'rgba(0,0,0,0)',
    tintOp: tintRgb ? (0.5 * amt).toFixed(3) : '0',
    w: w,
    wOuter: w + 7,
    wInner: Math.max(1, w * 0.42),
  };
}
