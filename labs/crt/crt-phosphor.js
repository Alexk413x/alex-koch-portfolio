/* crt/crt-phosphor.js — color. The phosphor palette, the blackbody table, and the three mixers everything else uses.
 *
 * Pure: no DOM, no component state. This is the bottom of the stack — crt-fixture imports it, nothing here imports
 * anything. Every color in the instrument comes from one of these four functions, which is what keeps the tube body,
 * its glow, the recess walls and the bezel tint describing ONE light rather than four cosmetic approximations of it.
 */

export const PH = {
  amber: { fg: '#f0a24a', hi: '#ffe0c0', glow: '255,150,60', name: 'AMBER' },
  green: { fg: '#74ffa6', hi: '#d6ffe4', glow: '90,255,150', name: 'GREEN' },
  /* NEUTRAL AND ACTUALLY WHITE. This was fg #dfe8ff on a 150,190,255 glow -- a strong blue cast that read as a cold monitor
   * rather than a white phosphor, and the blue reached everything downstream: the glow color feeds the bloom, the phosphor
   * wash and the ambient tint, so picking WHITE tinted the whole tube.
   *
   * fg AND hi are both pure #ffffff, which costs the boot text's two-tone on this phosphor -- dim label, bright value -- and
   * that is accepted rather than overlooked. There is nothing brighter than white to promote a highlight to, so the only way
   * to keep the contrast would be to make the body text gray, and a white phosphor whose text is gray is not white. An
   * intermediate fg was tried (#dedede) and it also broke the pill match below, since the swatch's pure white then agreed
   * with no preset. */
  white: { fg: '#ffffff', hi: '#ffffff', glow: '255,255,255', name: 'WHITE' },
};

/* Blackbody sRGB per 100K (Mitchell Charity / Andreas Siess). Red is 255 across this whole range, so only [G, B] is
 * stored. A constant rather than a rebuilt literal: it was being reconstructed on every kelvinRgb() call. */
export const KELVIN = {2200:[147,44],2300:[152,54],2400:[157,63],2500:[161,72],2600:[165,79],2700:[169,87],2800:[173,94],2900:[177,101],3000:[180,107],3100:[184,114],3200:[187,120],3300:[190,126],3400:[193,132],3500:[196,137],3600:[199,143],3700:[201,148],3800:[204,153],3900:[206,159],4000:[209,163],4100:[211,168],4200:[213,173],4300:[215,177],4400:[217,182],4500:[219,186],4600:[221,190],4700:[223,194],4800:[225,198],4900:[227,202],5000:[228,206],5100:[230,210],5200:[232,213],5300:[233,217],5400:[235,220],5500:[236,224],5600:[238,227],5700:[239,230],5800:[240,233],5900:[242,236],6000:[243,239],6100:[244,242],6200:[245,245],6300:[246,248],6400:[248,251],6500:[249,253]};

/* THE COLOR PARSER. Hex in, [r,g,b] out -- and rgb()/rgba() in too, which it did not use to accept.
 *
 * That gap was a real bug rather than a missing feature: resolvePhosphor returns fg as a HEX and hi as an rgb() string
 * (mix() gives a triple and it is joined), so the two fields of one palette are in different notations. Anything comparing
 * them as strings is comparing '#ffffff' with 'rgb(255,255,255)' and concluding they differ -- which is exactly how the boot
 * text's dim-label rule failed to fire on a custom pure white while working on the named preset.
 *
 * Parsing here rather than normalizing resolvePhosphor's output, because fg cannot change notation: crt-bezel feeds it to
 * this function and the panel's swatch needs a hex for <input type="color">.
 */
export function hexRgb(h) {
  const s = String(h == null ? '' : h).trim();
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    // Alpha is dropped on purpose: every consumer wants a color to mix, not a compositing instruction.
    return [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(p[i] || 0))));
  }
  let x = (s || '#f0a24a').replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const n = parseInt(x, 16);
  return isNaN(n) ? [240, 162, 74] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}


export function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }

// Memo is module-level and keyed by the rounded kelvin, so it is shared and still deterministic. The formatted string
// is what callers want ('255,G,B' for a CSS rgba() triple), so that is what is cached.
const _kelCache = {};

/* 6500K -> sRGB D65 white point; the warm end is a real tan/cream. Interpolates linearly between the 100K table
 * entries so the color varies smoothly at any slider resolution. */
export function kelvinRgb(k) {
  k = Math.max(2200, Math.min(6500, k || 6500));
  const key = Math.round(k);
  const v = _kelCache[key];
  if (v) return v;
  const lo = Math.floor(k / 100) * 100, hi = Math.min(6500, lo + 100), f = hi > lo ? (k - lo) / (hi - lo) : 0;
  const a = KELVIN[lo] || [255, 255], b = KELVIN[hi] || a;
  const g = Math.round(a[0] + (b[0] - a[0]) * f), bl = Math.round(a[1] + (b[1] - a[1]) * f);
  return (_kelCache[key] = '255,' + g + ',' + bl);
}

// The active phosphor, named or custom. A custom color derives its highlight rather than taking a second picker: one
// color in, and the text and its caret cannot be set to an unreadable pair.
export function resolvePhosphor(phosphor, custom) {
  if (phosphor !== 'custom' && PH[phosphor]) return PH[phosphor];
  const hex = custom || '#f0a24a', rgb = hexRgb(hex);
  return { fg: hex, hi: 'rgb(' + mix(rgb, [255, 255, 255], 0.6).join(',') + ')', glow: rgb.join(','), name: 'CUSTOM' };
}
