/* What the field is set to, and what each mode is called. Pure data, kept apart from the panel layout.
 *
 * The modes are NOT presets: `mode` selects which branch of the shader runs and carries no configuration, so
 * switching it leaves every slider alone. That is why it is a `choice` row rather than a preset strip.
 */
export const MODES = ['NEBULA', 'LIGHTSPEED', 'PLASMA'];

/* The shipped configuration — a tuned scene, not a neutral baseline, so an origin with stored state never shows
 * it. Renders below native by default because the soft nebula hides the upscale; lower again on integrated
 * graphics. */
export function defaultPreset(gpu) {
  return {
    mode: 2,
    speed: 5.0, turb: 1.2, twist: 1.4, rot: 0.3,
    chroma: 1.0, glow: 1.3, hue: 0.02,
    renderScale: gpu && gpu.integrated ? 0.6 : 0.7,
    secClosed: {},
  };
}
