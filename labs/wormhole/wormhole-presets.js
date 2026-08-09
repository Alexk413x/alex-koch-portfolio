/* What the field is set to. Pure data, kept apart from the panel layout.
 *
 * The three layers are independent toggles rather than one-of-three: any combination can run, the march mixes
 * them by depth, and each carries its own speed, twist, spin and coverage. The presets below are starting points,
 * not modes — each names only the keys it changes.
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

    nebOn: 1,
    nebMode: 2, nebCol: '#ffb454', nebColB: '#6a3cff', nebHue: 0.02,
    nebDensity: 1.15, nebFill: 0.46, nebFluff: 0.5, nebStreak: 0.55, nebVar: 0.45,
    nebScale: 2.6, nebOct: 3,
    nebSpeed: 5.0, nebTwist: 1.4, nebSpin: 0.3, nebCov: 0.62,

    lsOn: 0,
    lsMode: 1, lsCol: '#ffffff', lsColB: '#8ecbff', lsHue: 0.0,
    lsDensity: 1.6, lsCount: 110, lsLen: 0.42, lsThick: 0.15, lsVar: 0.6, lsRadial: 0.45,
    lsSpeed: 16.0, lsTwist: 0.8, lsSpin: 0.1, lsCov: 0.85,

    plOn: 0,
    plMode: 1, plCol: '#3aa0ff', plColB: '#c9a6ff', plHue: 0.55,
    plDensity: 1.0, plCrackle: 0.72, plCrawl: 0.6, plStrike: 0.35, plFlash: 0.55, plLight: 0.55,
    plSpeed: 4.0, plTwist: 1.8, plSpin: -0.25, plCov: 0.75,

    glow: 1.0, throatTint: 0.85, throatRays: 0.6, exposure: 1.0, chroma: 1.0, vignette: 1.0,
    secClosed: { LIGHTSPEED: true, PLASMA: true, IMAGE: true },
  };
}

/* A preset names only what it changes, so anything absent is left as you had it. They set the toggles too — that
 * is most of what distinguishes them. Each also sets the layers' speeds AGAINST each other, which is the point of
 * per-layer flow: JUMP has streaks tearing past clouds that are barely moving.
 */
export const PRESETS = [
  { label: 'NEBULA', values: {
      nebOn: 1, lsOn: 0, plOn: 0,
      nebSpeed: 5.0, nebSpin: 0.3, nebCov: 0.62,
      nebDensity: 1.15, nebFill: 0.46, nebFluff: 0.5, nebStreak: 0.55, nebScale: 2.6 } },
  { label: 'JUMP', values: {
      nebOn: 1, lsOn: 1, plOn: 0,
      nebSpeed: 3.0, nebDensity: 0.45, nebFill: 0.2, nebStreak: 0.1, nebScale: 1.8, nebCov: 0.95,
      lsSpeed: 26.0, lsDensity: 2.2, lsCount: 150, lsLen: 0.55, lsThick: 0.1, lsCov: 0.95 } },
  { label: 'STORM', values: {
      nebOn: 1, lsOn: 0, plOn: 1,
      nebSpeed: 2.5, nebDensity: 1.5, nebFill: 0.62, nebFluff: 0.38, nebStreak: 0.9, nebCov: 0.85,
      plSpeed: 6.0, plSpin: -0.5, plDensity: 1.3, plCrackle: 0.8, plCrawl: 0.9, plFlash: 0.6, plLight: 0.8 } },
];

// Which preset these values are, or -1 for none. Derived from the values rather than remembered, so editing a
// slider unlights the preset it no longer matches.
export function matchIdx(state) {
  for (let i = 0; i < PRESETS.length; i++) {
    const v = PRESETS[i].values;
    if (Object.keys(v).every((k) => Math.abs((state[k] ?? 0) - v[k]) < 1e-4)) return i;
  }
  return -1;
}
