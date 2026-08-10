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

    /* TEMPORARY WORKING DEFAULT — LIGHTSPEED alone, everything else off, while that layer is being reworked.
     * REVERT BEFORE SHIPPING: nebOn 1, lsOn 0, plOn 0, coreOn 1 is the tuned scene. */
    nebOn: 0,
    nebMode: 2, nebCol: '#ffb454', nebColB: '#6a3cff', nebHue: 0.02,
    nebDensity: 1.15, nebFill: 0.46, nebFluff: 0.5, nebStreak: 0.55, nebVar: 0.45,
    nebScale: 2.6, nebOct: 3,
    nebSpeed: 5.0, nebTwist: 1.4, nebSpin: 0.3, nebCov: 0.62,

    lsOn: 1,
    lsMode: 1, lsCol: '#ffffff', lsColB: '#8ecbff', lsHue: 0.0,
    lsDensity: 1.6, lsCount: 110, lsShells: 3, lsLen: 0.42, lsThick: 0.15, lsVar: 0.6, lsRadial: 0.45,
    lsSpeed: 16.0, lsTwist: 0.8, lsSpin: 0.1, lsCov: 0.85,

    plOn: 0,
    plMode: 1, plCol: '#3aa0ff', plColB: '#c9a6ff', plHue: 0.55,
    plDensity: 1.0, plCrackle: 0.72, plCrawl: 0.6, plStrike: 0.35, plFlash: 0.55, plLight: 0.55,
    plSpeed: 4.0, plTwist: 1.8, plSpin: -0.25, plCov: 0.75,

    /* coreSpin and corePulse are set to the rates the core was drawn at before either was a control, so the
     * shipped scene is unchanged by their arrival. FADE ships OFF for the same reason — it is motion nothing
     * asked for until someone turns it up. */
    coreOn: 0,                                            // TEMPORARY, with the block above
    glow: 1.0, throatTint: 0.85, throatRays: 0.6,
    coreCol: '#ffedcc', coreAuto: 1.0,
    coreSpin: 0.07, corePulse: 0.5, corePulseRate: 1.0, coreFade: 0.0, coreFadeRate: 1.0,

    exposure: 1.0, chroma: 1.0, vignette: 1.0,
    secClosed: { LIGHTSPEED: true, PLASMA: true, IMAGE: true },
  };
}

