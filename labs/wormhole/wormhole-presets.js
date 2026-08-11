/* What the field is set to. Pure data, kept apart from the panel layout.
 *
 * The four sections that can be switched off — the three layers and the core — are independent masters rather than
 * one-of-N: any combination can run, and the march mixes whichever layers are enabled by depth.
 */

/* The shipped configuration — a tuned scene, not a neutral baseline. Renders below native by default because the
 * soft field hides the upscale; lower again on integrated graphics, where the march is the expensive part.
 *
 * QUALITY is the march's step count, and it is the one number that scales the whole shader: every enabled layer
 * is evaluated once per step.
 */
export function defaultPreset(gpu) {
  const weak = gpu && gpu.integrated;
  return {
    /* MEASURED, NOT GUESSED, on the integrated side: with the noise moved into a lookup texture, the default
     * scene holds 60 at 32 steps on an Intel UHD 630 and drops to 45 fps at 44. The discrete figures are
     * extrapolated — there was no discrete adapter to measure on.
     *
     * These target the DEFAULT scene, which is nebula alone. Enabling all three costs about three times as much,
     * and QUALITY is the control to pull back when it does. */
    renderScale: weak ? 0.45 : 0.75,
    steps: weak ? 32 : 56,
    stepSpread: 8.0,

    /* TEMPORARY WORKING DEFAULT — PLASMA alone, everything else off, while that layer is being worked on.
     * REVERT BEFORE SHIPPING: nebOn 1, lsOn 0, plOn 0, coreOn 1 is the tuned scene. */
    nebOn: 0,
    nebMode: 2, nebCol: '#ffb454', nebColB: '#6a3cff', nebHue: 0.02,
    nebDensity: 1.15, nebFill: 0.46, nebFluff: 0.5, nebStreak: 0.55, nebVar: 0.45,
    nebScale: 2.6, nebOct: 3,
    nebSpeed: 5.0, nebTwist: 1.4, nebSpin: 0.3,

    lsOn: 0,
    lsMode: 1, lsCol: '#ffffff', lsColB: '#8ecbff', lsHue: 0.0,
    lsDensity: 1.6, lsCount: 110, lsLen: 0.42, lsThick: 0.15, lsVar: 0.6, lsRadial: 0.45,
    lsSpeed: 16.0, lsTwist: 0.8, lsSpin: 0.1,

    plOn: 1,
    plMode: 1, plCol: '#3aa0ff', plColB: '#c9a6ff', plHue: 0.55,
    /* FILL 0.45 and FLASH RATE 1.8 are the constants they replaced, to five figures: the window was fixed at
     * 0.60..0.80 and the gate ran at 0.9 + FLASH * 1.6. OCCLUSION 0.5 likewise. Exposing a constant should not
     * move the picture. */
    plDensity: 1.0, plFill: 0.45, plOcclude: 0.5, plCrackle: 0.72,
    plFlash: 0.55, plFlashRate: 1.8, plLight: 0.55,
    /* SCALE and STREAK ship at the framing that keeps bolts lengthwise WITHOUT the ribbing: the same 4.2x depth
     * squash the layer always had, at roughly twice the frequency. The old constants were 1.9 and 0.24 — the
     * squash without the frequency, which is what strung visible beads along every bolt. */
    plScale: 3.4, plStreak: 0.238,
    // SPIN is +0.05 rather than -0.25 because that is the rate the layer was ACTUALLY turning at: CRAWL used to
    // add a hidden +0.30 on top. The number changed so the motion would not.
    // SPEED is 5.9 rather than 4.0 for the reason SPIN moved: STRIKE was a SECOND rate along the same axis,
    // worth 1.05 on top of SPEED's 2.2. Folded in, so removing the control did not slow the layer down.
    plSpeed: 5.9, plTwist: 1.8, plSpin: 0.05,

    /* coreSpin and corePulse are set to the rates the core was drawn at before either was a control, so the
     * shipped scene is unchanged by their arrival. FADE ships OFF for the same reason — it is motion nothing
     * asked for until someone turns it up. */
    coreOn: 1,                                            // TEMPORARY, with the block above
    glow: 1.0, throatTint: 0.85, throatRays: 0.6,
    coreCol: '#ffedcc', coreAuto: 1.0,
    coreSpin: 0.07, corePulse: 0.5, corePulseRate: 1.0, coreFade: 0.0, coreFadeRate: 1.0,

    /* ONE COVERAGE FOR ALL THREE LAYERS. The three it replaced shipped at 0.62, 0.85 and 0.75;
     * this is the middle of them, and every layer now reaches the same distance in from the wall. */
    coverage: 0.75,
    // BEND ships ON, at a lean you can feel without the wall reaching the eye: the offset peaks at 0.75 of
    // a world unit against a tube radius of 1.25.
    bend: 0.4, bendFlow: 6.0, bendScale: 1.0,
    exposure: 1.0, chroma: 1.0, vignette: 1.0,
    secClosed: { LIGHTSPEED: true, PLASMA: true, IMAGE: true },
  };
}

