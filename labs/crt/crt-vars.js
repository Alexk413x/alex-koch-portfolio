/* crt/crt-vars.js — the screen's CSS custom properties.
 *
 * ONE function, state in and a style string out. It is the whole bridge between the settings and the DOM: every layer in
 * the tube reads var(--something) from static inline styles, so this string is the only thing that changes per render and
 * nothing else has to be re-templated.
 *
 * Why that shape matters: a value written here paints immediately because the markup that reads it has already streamed.
 * Interpolating the same values into the markup instead would stall every one of those properties behind the render.
 *
 * Pure: no DOM, no component state. Colour comes from crt-phosphor, so the tube body, its halo and the recess walls
 * describe one light.
 */
import { kelvinRgb } from './crt-phosphor.js';

/* ph   the active phosphor {fg, glow}
 * ig   crt-fixture's ignite() output
 * thA/thB  crt-fixture's tubeHealth() per bulb
 * glowScaleA/B, eg, hg  the per-bulb and averaged health gates the caller already computed
 */
export function screenVars({ s, ph, ig, thA, thB, glowScaleA, glowScaleB, eg, hg }) {
  const p = ph;
  // Derived here rather than passed: the caller's masked settings never touch power, so this cannot disagree with it.
  const on = s.power === 'on';
  const vg = (s.vig == null ? 30 : s.vig) / 100;   // VIGNETTE: one control for size + intensity
  // Tube glass reads as unlit metal-grey + darker when the glow is off, saturating and
  // brightening back to full as TUBE GLOW (×dimmer) comes up.
  const glv = Math.min(1, s.veil * 1.18) * Math.min(1, s.ldim * 1.05);
  const tubefx = 'saturate(' + (0.45 + 0.55 * glv).toFixed(3) + ') brightness(' + (0.82 + 0.23 * glv).toFixed(3) + ')';
  const vars = '--fg:' + p.fg + ';--glow:' + p.glow
    + ';--bloom:' + s.bloom + 'px;--bright:' + s.bright
    /* THE SAME CONSTANT THE BANDS USE. This is the rim alpha for the tube miniature in the fixture's portal, and the
     * vignette is a REACH now: 90% black at the rim at every non-zero setting, with the setting deciding how far in it
     * carries (--vigfall/--vigspread do that here). It briefly carried a 0.55 gamma matching an alpha curve in the view
     * that has since been deleted, so the comment claimed parity with a formula that no longer existed and the two
     * halves of one vignette disagreed -- 0.670 here against a ramp starting at 0.75.
     */
    + ';--viga:' + (vg > 0 ? '0.900' : '0.000')
    // Two emitters: the lamp (glv, shared with --spillop so they cannot disagree) and the tube's own face.
    + ';--sheen:' + (s.sheen * 0.5 * Math.min(1, glv * (s.lightOn ? 1 : 0) + (on ? 0.5 : 0))).toFixed(3)
    + ';--phos:' + s.phos.toFixed(3)
    + ';--pglow:' + ((s.pglow == null ? 100 : s.pglow) / 100).toFixed(3)
    + ';--fixdisp:' + (s.lightOn ? 'block' : 'none')
    + ';--glarelight:' + Math.min(1, s.glare).toFixed(3)
    + ';--railvis:' + s.rail.toFixed(3)
    + ';--bgvis:' + s.box.toFixed(3)
    + ';--fixvis:' + (s.lightOn ? 1 : 0)
    + ';--frostpanel:' + (Math.min(1, Math.max(s.frost / 100, s.diffuse / 150)) * hg).toFixed(3)
    // --diffcol is NOT written here any more. It is a colour the fixture's light produces, so it belongs on the per-frame
    // path with --lcol: crt-flicker emits it from the same averaged, warm-shifted temperature. Written from s.temp here it
    // was the one lit surface that ignored the flicker.
    + ';--diffuseblur:' + (s.diffuse > 0 ? 'blur(' + s.diffuse + 'px) brightness(' + (1 + (s.diffuse / 200) * 1.2).toFixed(3) + ')' : 'none')
    + ';--frostboost:' + (1 + Math.min(1, s.frost / 100) * 0.22 * hg).toFixed(3)
    /* glv, not ldim alone — the spill is light the lamp throws, so it has to track TUBE GLOW as well as the dimmer.
     * No `on ? 0.5` term, unlike --sheen: the CRT does not cast this, and --spilldisp already hides it with the lamp. */
    + ';--spillop:' + (s.spill * glv * hg).toFixed(3)
    // --spillsize is NOT emitted any more. It was `(s.spillsize * 2.2) + 'px'`, read by the old CSS radial-gradient the
    // spill used to be; the plotted path derives its reach from s.spillsize directly, in JS. Nothing has read this variable
    // since, so it was a px number sitting in the cascade inviting the next reader to believe it meant something.
    + ';--spilldisp:' + (s.spill > 0 && s.lightOn ? 'block' : 'none')
    /* THE SPILL'S BLUR. This is the layer's entire falloff: the pool is ONE solid rounded-rect ring and the blur is what
     * turns it into a glow. 0.42 of the reach puts most of the softening inside the ring's own width, so it fades rather
     * than ending on an edge, while staying isotropic -- a blur softens a rectangle without pulling it toward an ellipse,
     * which is the property a radialGradient could never have.
     *
     * It used to be derived from a 14-ring stack's pitch, to hide the steps those rings introduced. The rings are gone and
     * so is K; there is one shape and one blur, and nothing here has a twin in the DC to drift from.
     */
    + ';--spillblur:' + (0.42 * ((s.spillsize == null ? 40 : s.spillsize) / 100
        * ((s.fw == null ? 60 : s.fw) * 0.0045 * (typeof window === 'undefined' ? 1600 : (window.innerWidth || 1600))) / 2)).toFixed(2) + 'px'
    + ';--seamop:' + (s.seam * 0.9).toFixed(3)
    + ';--prismop:' + (s.prism > 0 ? Math.min(1, 0.35 + s.prism * 0.65) : 0).toFixed(3)
    + ';--prismcell:' + (16 - s.prism * 11).toFixed(1) + 'px'
    + ';--prismhalf:' + ((16 - s.prism * 11) / 2).toFixed(1) + 'px'
    + ';--cm:0.45vw'
    + ';--persp:' + 'calc(' + s.persp + ' * var(--cm))'
    + ';--fdepth:' + 'calc(' + s.fdepth + ' * var(--cm))'
    + ';--fw:' + s.fw + ';--fh:' + s.fh + ';--pwr:1' + ';--ftilt:' + s.ftilt + 'deg' + ';--fposx:' + s.fposx + '%;--fposy:' + s.fposy + '%' + ';--tdrop:' + (s.tdrop / 100).toFixed(3)
    + ';--lt1:' + (50 - s.tspace * 0.43).toFixed(1) + '%;--lt2:' + (50 + s.tspace * 0.43).toFixed(1) + '%;--ltm:' + ((100 - s.ltwd) / 2) + '%;--ltkraw:' + 'calc(' + (s.ltk / 10).toFixed(2) + ' * var(--cm))'
    /* MATTE AS A WHOLE FILTER, NOT AS A RADIUS -- because `blur(0px)` is not free and `none` is.
     *
     * #clRefl is a full-stage group carrying mix-blend-mode:screen, and it read `filter: blur(var(--matte, 0px))`. At
     * MATTE 0 that is a zero-radius blur, which the compositor does NOT treat as a no-op: the element still gets its
     * own render surface and a filter pass over the whole tube, on every frame that touches the subtree -- and the
     * flicker engine touches it up to twenty times a second. A blur of nothing, applied to a million pixels, forever.
     *
     * The isolation the group needs does NOT come from the filter -- #clRefl carries `isolation: isolate` explicitly --
     * so dropping to `none` at zero changes the compositing not at all. --matte survives as the radius for anything
     * that wants the number; --mattefx is what the element applies. */
    + ';--matte:' + (s.matte * 50).toFixed(1) + 'px'
    + ';--mattefx:' + (s.matte > 0.001 ? 'blur(' + (s.matte * 50).toFixed(1) + 'px)' : 'none')
    + ';--beam:' + s.beam
    /* THE TEXT BLOCK: a point measured from the centre, plus which of the block's own corners sits on it.
     * --tox/--toy are halved because the slider reads 0..100 from centre to EDGE, while CSS wants a percentage of the
     * the box: the block is translated back by HALF ITS OWN SIZE on both axes, so the point is its centre and nothing
     * else needs to know how big it is. That is the whole reason the offsets can be symmetric: overhang at +40% and at
     * -40% are mirror images, and TEXT WIDTH over 100% spills evenly off both sides rather than all off one.
     *
     * ALIGN is now text-align ONLY -- it no longer moves the block, because with a centred anchor there is nothing for
     * it to move. TEXT H, BORDER and GROW are gone: height came from a bottom-pinned log inside a fixed frame, which
     * made a SIZE control silently MOVE the text; BORDER was padding on a positioned ancestor, which an absolutely
     * positioned child never sees; and GROW named which edge was nailed down, which a centre anchor answers by itself.
     */
    + ';--tox:' + s.tox.toFixed(2) + '%;--toy:' + s.toy.toFixed(2) + '%'
    /* AUTO IS THE CSS KEYWORD, not a number: max-content for the width (as wide as the longest line) and auto for the
     * height (as tall as the lines). The height's tricky half lives in the template, not here: a flex item's automatic
     * minimum is its own content, so a 50% height measured 53% until the log got min-height:0.
     */
    + ';--tw:' + ((s.tw == null || s.tw < 1) ? 'max-content' : s.tw + '%')
    + ';--tht:' + ((s.tht == null || s.tht < 1) ? 'auto' : s.tht + '%')
    + ';--talign:' + (s.tjust === 'r' ? 'right' : s.tjust === 'c' ? 'center' : 'left')
    + ';--tsize:' + s.tsize + ';--tlh:' + s.tlh + ';--lcol:' + kelvinRgb(s.temp) + ';--llvl:' + ig.llvl + ';--themit1:' + thA.themit + ';--tchar1:' + thA.tchar + ';--themit2:' + thB.themit + ';--tchar2:' + thB.tchar + ';--tbloomop1:' + (parseFloat(ig.tbloomop) * glowScaleA).toFixed(3) + ';--tbloomop2:' + (parseFloat(ig.tbloomop) * glowScaleB).toFixed(3) + ';--gwall:' + (parseFloat(ig.gwall) * eg).toFixed(3) + ';--gwallhi:' + (parseFloat(ig.gwallhi) * eg * Math.pow(Math.cos(Math.min(1.55, Math.abs(s.ftilt) * Math.PI / 180)), 1.2)).toFixed(3) + ';--walllit:' + ig.walllit + ';--capvis:' + ig.capvis + ';--capcol:' + ig.capcol + ';--capcol2:' + ig.capcol2 + ';--tubefx:' + tubefx + ';--tglowspread:calc(' + (s.tbloom / 10).toFixed(2) + ' * var(--cm));--tglowblur:calc(' + (s.bfall / 10).toFixed(2) + ' * var(--cm));';
  return vars;
}
