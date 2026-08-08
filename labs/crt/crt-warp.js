/* crt/crt-warp.js — the magnet warp.
 *
 * A rigid-sheet skew/scale/rotate over the LIVE text layer, plus a true RGB channel split, so typing keeps showing
 * through while the picture is being dragged around by an imaginary magnet.
 *
 * It owns its own frame loop and touches only the elements it is handed. The DC decides WHICH elements those are and what
 * happens when it ends; everything about how the warp moves is here.
 */

/* runWarp({...}) starts the animation and returns a stop() that cancels it and restores everything.
 *
 *   el       the layer to warp — the TEXT. Its siblings that describe the GLASS (the power animation, the matte,
 *            the phosphor wash, the scanlines) must stay still, or the tube wobbles rather than the picture in it.
 *   glow     #clGlowLayer, the exception: its boxes are traced over the text's own lines, so it is light the
 *            picture emits and it moves with `el`. Transform only — its blur IS the glow.
 *   glass    the barrel-filtered element. Its filter is STRIPPED for the duration: the always-on displacement map and
 *            the screen blur would re-rasterize the entire subtree every frame under a moving transform, which is the
 *            difference between this running smoothly and not running at all.
 *   screen   likewise, for its blur.
 *   aberrR/B the feOffset primitives of the aberration filter, pushed apart as the warp swings.
 *   curve    how domed the tube is, 0..1 (FACE over its 90 degree range). The warp is a RIGID SHEET, so it cannot
 *            displace points individually -- but the sheet is sitting on a curved surface, and that changes which way a
 *            magnet drags things. On a flat face the picture slides; on a domed one the dome is a bowl and everything
 *            pulled off-axis also falls toward the middle. So curve trades the lateral swing for an inward squeeze.
 *   field    WIGGLE's amplitude partner — the overall strength.
 *   wiggle   how many oscillations the sweep carries.
 *   seconds  duration.
 *   onEnd    called once after everything is restored.
 */
export function runWarp({ el, glass, screen, glow, aberrR, aberrB, field, wiggle, seconds, curve, onEnd }) {
  if (!el) return () => {};
  // What the borrowed elements looked like before we took their filters away.
  /* Saved and put back verbatim, never spelled out as a literal and never cleared to ''. These come from static
   * style ATTRIBUTES that the runtime writes once at mount and never rewrites, so anything this function fails to
   * restore is gone until reload — #clContent's filter carries the phosphor bloom, and its transform is 2D on
   * purpose (a literal perspective()/translateZ() here re-promoted it to a 3D layer that rastered one 512px tile). */
  const saved = {
    glass: glass && glass.style.filter, screen: screen && screen.style.filter,
    el: el.style.filter,
    tf: el.style.transform,
    glowTf: glow && glow.style.transform,
  };
  const base = el.style.filter;   // read once: it does not change while the warp runs
  if (glass) glass.style.filter = 'none';
  if (screen) screen.style.filter = 'none';
  el.style.willChange = 'transform, filter';
  el.style.transformOrigin = '50% 50%';
  if (glow) {
    glow.style.willChange = 'transform';
    glow.style.transformOrigin = '50% 50%';
  }

  const W = el.offsetWidth || 800, H = el.offsetHeight || 600;
  const dome = Math.max(0, Math.min(1, curve || 0));
  const dur = Math.max(0.1, seconds) * 1000, TAU = Math.PI * 2, t0 = performance.now();
  let raf = 0, done = false;

  const restore = () => {
    if (done) return;
    done = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    // Back to exactly what was there, both of them: see the note on `saved` -- nothing re-renders these.
    el.style.transform = saved.tf;
    el.style.filter = saved.el;
    el.style.willChange = '';
    if (glow) { glow.style.transform = saved.glowTf; glow.style.willChange = ''; }
    if (glass) glass.style.filter = saved.glass || '';
    if (screen) screen.style.filter = saved.screen || '';
    if (onEnd) onEnd();
  };

  const run = (now) => {
    const t = (now - t0) / dur;
    if (t >= 1) { restore(); return; }
    const env = Math.sin(Math.PI * t);          // the envelope: ramps 0 -> 1 -> 0, so it starts and ends at rest
    const mag = -0.2 + t * 1.4;                 // the magnet sweeping across; the warp pivots on centre
    const amp = field * env, ph = t * TAU * (2 + wiggle * 4);
    const wob = Math.sin(ph), wob2 = Math.cos(ph * 0.8);
    // Skew and rotate share `wob` while the scales run at other rates — a rigid sheet being pulled, not a soft blob.
    const skx = amp * 16 * wob, sky = amp * 9 * wob2, rot = amp * 4 * wob;
    /* THE DOME PULLS EVERYTHING TOWARD THE MIDDLE, and that is the whole difference between warping a sheet of paper and
     * warping a picture painted on the inside of a bowl.
     *
     * transformOrigin is already the centre, so a scale below 1 IS an inward pull -- every point moves toward the middle
     * in proportion to how far out it started, which is what a magnet dragging across a curved face does to the edges
     * first. `pull` is the amplitude times the dome, so a flat face keeps exactly the old rigid-sheet behaviour and a
     * fully domed one squeezes hardest.
     *
     * The lateral swing is traded away for it rather than added to. On a bowl a picture cannot slide sideways as freely
     * as on a flat sheet: the walls are in the way, so the same magnet that used to shove it across now pushes it into
     * the middle. Both translate terms scale down as the pull scales up, which keeps the total displacement in the same
     * range and stops a deep FACE from throwing the text off the tube entirely.
     */
    const pull = amp * dome, slide = 1 - dome * 0.55;
    const scx = 1 + amp * 0.22 * Math.sin(ph * 0.5) - pull * 0.18;
    const scy = 1 - amp * 0.16 * Math.cos(ph * 0.7) - pull * 0.14;
    const txp = amp * (mag - 0.5) * W * 0.06 * slide, typ = amp * H * 0.03 * Math.sin(ph * 0.9) * slide;
    // Appended to each element's own resting transform, not replacing it, so whatever registers the two at rest
    // still registers them mid-swing.
    const tf = 'translate(' + txp.toFixed(1) + 'px,' + typ.toFixed(1) + 'px) rotate(' + rot.toFixed(2)
      + 'deg) skew(' + skx.toFixed(2) + 'deg,' + sky.toFixed(2) + 'deg) scale(' + scx.toFixed(3) + ',' + scy.toFixed(3) + ')';
    el.style.transform = (saved.tf ? saved.tf + ' ' : '') + tf;
    if (glow) glow.style.transform = (saved.glowTf ? saved.glowTf + ' ' : '') + tf;
    // A real channel split: R and B pushed opposite ways, wobbling with the warp rather than a fixed offset.
    const ox = (amp * 5 * wob).toFixed(2), oy = (amp * 2.5 * wob2).toFixed(2);
    if (aberrR) { aberrR.setAttribute('dx', ox); aberrR.setAttribute('dy', oy); }
    if (aberrB) { aberrB.setAttribute('dx', (-ox).toString()); aberrB.setAttribute('dy', (-oy).toString()); }
    /* `base` LEADS: the bloom is computed on un-split glyphs and the aberration fringes the result. Reversed, the
     * text splits first and each channel blooms separately — three coloured halos instead of one fringed halo.
     * Blur capped at 0.7px off the SHORTER edge, so a large glass does not smear into illegibility. */
    el.style.filter = base + ' url(#crtAberr) brightness(' + (1 + amp * 0.25).toFixed(2) + ') blur('
      + Math.min(0.7, amp * Math.min(W, H) * 0.0006).toFixed(2) + 'px)';
    raf = requestAnimationFrame(run);
  };

  raf = requestAnimationFrame(run);
  return restore;
}
