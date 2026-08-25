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
    /* MEASURED, NOT GUESSED, on the integrated side: this scene holds 60 at 26 steps on an Intel UHD 630 and
     * reads 54 fps at 32. The discrete figures are extrapolated — there was no discrete adapter to measure on.
     *
     * 26 RATHER THAN 32 IS THE LAST 1.8 ms, and it is a quality setting because there was nothing left in the
     * shader to spend instead. Stubbing out the bend, both layers' spin and the whole rib branch — every
     * remaining candidate — saves under 11% between them, and all three change the picture; see the README's
     * attribution table. About a third of the frame is not the shader at all but the composite scaling a
     * 561x408 canvas up to 2182x1587 device pixels, and only RENDER SCALE reaches that.
     *
     * Enabling all three layers used to cost about three times one of them. It no longer does: the shader is
     * built for the layer set that is on, so the three-layer build is the one this scene compiles to and pays
     * for nothing it does not run.
     */
    renderScale: weak ? 0.45 : 0.75,
    steps: weak ? 26 : 56,

    /* STEP SPREAD 1 IS AN EVEN MARCH, and it ships that way because this scene is mostly thin structure. The
     * far half of the tunnel is sampled as finely as the near half; biasing samples toward the eye leaves the
     * background undersampled, which reads as streaking in the plasma and the clouds. It costs nothing to set —
     * the sample count is QUALITY, and this only decides where they land. */
    stepSpread: 1.0,

    nebOn: 1,
    nebMode: 1, nebCol: '#611d00', nebColB: '#421e00', nebHue: 0.02,
    /* STREAK IS THE OTHER HALF OF THE LENS CHANGE. At 1.0 the cloud was isotropic — round billows, which look
     * the same whichever way they are moving and are exactly what "clouds going by" describes. Squashed to a
     * half, the same field draws out into lanes along the direction of travel, so it foreshortens down the tube
     * and streams outward from the throat. */
    nebDensity: 2.0, nebFill: 0.15, nebFluff: 0.5, nebStreak: 0.5, nebVar: 0.65,
    nebScale: 3.0, nebOct: 5,
    nebSpeed: 8.2, nebTwist: 0.0, nebSpin: 0.0,

    lsOn: 1,
    lsMode: 1, lsCol: '#ff6600', lsColB: '#b80000', lsHue: 1.0,
    /* THE STREAKS WERE COUNTED FOR A NARROW LENS. At 42° most of a 150-strong set at full LENGTH never reached
     * the frame; opened to 74° every one of them crosses it end to end, and the layer came back as a solid
     * starburst with the tunnel invisible behind it. Halved in number, cut to two fifths the length and thinned,
     * they read as things passing rather than as a sheet of rays. */
    lsDensity: 1.5, lsCount: 80, lsLen: 0.42, lsThick: 0.10, lsVar: 0.6, lsRadial: 0.42,
    lsSpeed: 22.0, lsTwist: 0.0, lsSpin: 0.0,

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
    /* TWIST AND SPIN ARE BOTH DOWN. Together at 2.35 and 1.5 the layer turned fast enough to read as a pinwheel
     * behind the tunnel rather than as anything inside it — the "background spiral" the scene was described as.
     * Halved, the bolts still crawl around the wall and the crawl now reads as the wall's, not the frame's. */
    plSpeed: 7.4, plTwist: 1.05, plSpin: 0.55,

    /* THE CORE IS ON NOW, AND IT IS ON BECAUSE THE THROAT EXISTS. It was switched off while COVERAGE filled the
     * tube: with the field reaching almost to the axis there was already something at the far end, and a bright
     * throat over the top only washed it out. With the field pulled back to the wall the axis is clear, and a
     * tunnel with nothing at the end of it is a corridor to nowhere — the vanishing point is what every ring and
     * every streak converges on. Kept dim, and taking its colour mostly from the layers, so it is the end of THIS
     * tunnel rather than a lamp pasted over it. */
    coreOn: 1,
    glow: 0.18, throatTint: 1.0, throatRays: 0.55,
    coreCol: '#ff5900', coreAuto: 0.65,
    coreSpin: -0.74, corePulse: 0.51, corePulseRate: 4.0, coreFade: 0.0, coreFadeRate: 3.95,

    /* THE LENS IS WIDE, and that is the single change that stopped this scene reading as weather. At the 42° it
     * was built with, the tube's wall never reached the edge of the frame: everything sat out in front of the eye
     * and the picture was clouds passing a camera. At 74° the wall sweeps the periphery and the frame closes
     * around the viewer, which is what a tunnel does. Wider still was tried and LIGHTSPEED took the frame over:
     * every streak crossed it corner to corner and the tunnel disappeared behind them. */
    fov: 74,

    /* COVERAGE IS LOW AND THE WALL IS HARD, together. At 0.8 the field filled the tube almost to the axis, so
     * there was no clear throat to travel down and no surface to travel past — the two things a tunnel is. Pulled
     * back to a skin on the wall with an edge that arrives over a few percent of the radius, the same three layers
     * describe a tube rather than a volume of fog. */
    coverage: 0.46, wall: 0.62,

    /* RINGS ACROSS THE TUBE, and they carry most of the sense of speed. About nine stand between the eye and the
     * throat; each foreshortens as it recedes and arrives faster as it comes, which is the cue the scene had
     * nothing of at all before. FLOW runs a little ahead of the clouds, so the tunnel reads as passing them. */
    ribs: 0.72, ribScale: 4.4, ribFlow: 7.4,

    /* BEND IS OFF FULL. At 1.0 the axis leaned 0.75 of a world unit against a 1.25 radius and the throat spent
     * most of its time off the side of the frame, which reads as drifting rather than as travelling. A third of
     * that keeps the corners and leaves the far end where an eye can find it. */
    bend: 0.34, bendFlow: 6.0, bendScale: 0.5,
    exposure: 1.94, chroma: 1.0, vignette: 1.0,
    // NEBULA and LIGHTSPEED open folded: the scene is tuned, and the sections worth reaching first are the ones
    // that change the whole frame.
    secClosed: { NEBULA: true, LIGHTSPEED: true, PLASMA: false, IMAGE: false, TUNNEL: false },
  };
}
