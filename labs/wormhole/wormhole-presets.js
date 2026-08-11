/* What the field is set to. Pure data, kept apart from the panel layout.
 *
 * The four sections that can be switched off — the three layers and the core — are independent masters rather than
 * one-of-N: any combination can run, and the march mixes whichever layers are enabled by depth.
 */

/* THE SHIPPED SCENE IS A REAL SAVED CONFIGURATION, not a neutral baseline — these numbers were lifted out of a
 * session's stored settings rather than picked one at a time. That is what makes them worth keeping together:
 * they were tuned against each other, and a value moved on its own is likely to disagree with the rest.
 *
 * It is also the reference every measurement is taken against, so changing it invalidates any stored render
 * fingerprint. See CLAUDE.md on clearing localStorage from a page on the same origin that is NOT the app — the
 * flush on hide writes the in-memory state straight back otherwise, and you never see the defaults at all.
 *
 * All three layers run at once and the CORE is off: the far end of the tunnel is whatever the layers make of it.
 */
export function defaultPreset(gpu) {
  const weak = gpu && gpu.integrated;
  return {
    /* MEASURED, NOT GUESSED, on the integrated side: with the noise moved into a lookup texture, the default
     * scene holds 60 at 32 steps on an Intel UHD 630 and drops to 45 fps at 44. The discrete figures are
     * extrapolated — there was no discrete adapter to measure on.
     *
     * Enabling all three layers used to cost about three times one of them. It no longer does: the shader is
     * built for the layer set that is on, so the three-layer build is the one this scene compiles to and pays
     * for nothing it does not run.
     */
    renderScale: weak ? 0.45 : 0.75,
    steps: weak ? 32 : 56,

    /* STEP SPREAD 1 IS AN EVEN MARCH, and it ships that way because this scene is mostly thin structure. The
     * far half of the tunnel is sampled as finely as the near half; biasing samples toward the eye leaves the
     * background undersampled, which reads as streaking in the plasma and the clouds. It costs nothing to set —
     * the sample count is QUALITY, and this only decides where they land. */
    stepSpread: 1.0,

    nebOn: 1,
    nebMode: 1, nebCol: '#611d00', nebColB: '#421e00', nebHue: 0.02,
    nebDensity: 3.0, nebFill: 0.15, nebFluff: 0.5, nebStreak: 1.0, nebVar: 0.65,
    nebScale: 2.6, nebOct: 5,
    nebSpeed: 6.3, nebTwist: 0.0, nebSpin: 0.0,

    lsOn: 1,
    lsMode: 1, lsCol: '#ff6600', lsColB: '#b80000', lsHue: 1.0,
    lsDensity: 2.34, lsCount: 150, lsLen: 1.0, lsThick: 0.17, lsVar: 0.21, lsRadial: 0.66,
    lsSpeed: 30.0, lsTwist: 0.0, lsSpin: 0.0,

    plOn: 1,
    plMode: 1, plCol: '#ff0000', plColB: '#ff4d00', plHue: 0.55,
    /* FILL 0.45, FLASH RATE 1.8 and OCCLUSION 0.5 are the constants they replaced, to five figures: the sparsity
     * window was fixed at 0.60..0.80 and the gate ran at 0.9 + FLASH * 1.6. Exposing a constant should not move
     * the picture. */
    plDensity: 1.0, plFill: 0.45, plOcclude: 0.5, plCrackle: 0.72,
    plFlash: 0.84, plFlashRate: 4.8, plLight: 0.55,
    /* SCALE and STREAK ship at the framing that keeps bolts lengthwise WITHOUT the ribbing: the same 4.2x depth
     * squash the layer always had, at roughly twice the frequency. The old constants were 1.9 and 0.24 — the
     * squash without the frequency, which is what strung visible beads along every bolt. */
    plScale: 3.4, plStreak: 0.238,
    // SPEED is 5.9 rather than 4.0 because STRIKE was a SECOND rate along the same axis, worth 1.05 on top of
    // SPEED's 2.2. Folded in when that control went, so removing it did not slow the layer down.
    plSpeed: 5.9, plTwist: 2.35, plSpin: 1.5,

    // The CORE is off: with all three layers lit there is already something at the far end, and a bright throat
    // over the top of it washes out the thing it is supposed to be the end of. Its settings are kept so turning
    // the section on gives something tuned rather than something raw.
    coreOn: 0,
    glow: 0.4, throatTint: 1.0, throatRays: 1.0,
    coreCol: '#ff5900', coreAuto: 0.0,
    coreSpin: -0.74, corePulse: 0.51, corePulseRate: 4.0, coreFade: 0.0, coreFadeRate: 3.95,

    // ONE COVERAGE FOR ALL THREE LAYERS — how far in from the wall the whole field reaches.
    coverage: 0.8,
    /* BEND SHIPS AT FULL. The axis leans 0.75 of a world unit against a tube radius of 1.25, which is as far as
     * it goes without the wall reaching the eye. TIGHTNESS is low, so corners are long and sweeping rather than
     * a slalom, and FLOW brings them on at a little above the clouds' own speed. */
    bend: 1.0, bendFlow: 6.8, bendScale: 0.44,
    exposure: 1.94, chroma: 1.0, vignette: 1.0,
    // NEBULA and LIGHTSPEED open folded: the scene is tuned, and the two sections worth reaching first are the
    // ones that change the whole frame.
    secClosed: { NEBULA: true, LIGHTSPEED: true, PLASMA: false, IMAGE: false },
  };
}
