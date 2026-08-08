/* The values, and the difference between a preset and a reset.
 *
 * A PRESET is a look: a handful of values making one appearance, leaving everything else alone. RESET is a
 * different promise — put EVERYTHING back. Wiring RESET to the first preset silently strands every value the
 * preset does not name, so they are declared separately.
 */

// EVERY value the panel can reach, and the only thing RESET restores from.
export function defaultPreset(gpu) {
  return {
    shape: 0,
    size: 0.40, aspect: 1, rot: 0, radius: 0, weight: 1.5,
    ink: '#ffb454', hue: 0, glow: 18, opacity: 1,
    // OFF BY DEFAULT: a debug view that greets you is a debug view you will turn off.
    debugOn: 0, outline: 1, cross: 0,
    renderScale: gpu && gpu.integrated ? 0.7 : 1,
    secClosed: {},
  };
}

/* A PRESET NAMES ONLY WHAT IT CHANGES. Anything absent is left as the user had it -- which is what makes these
 * usable while working, rather than a hidden reset with a friendly label. */
export const PRESETS = [
  { label: 'BASE',  values: { shape: 0, size: 0.40, aspect: 1,   radius: 0,    weight: 1.5, glow: 18 } },
  { label: 'WIDE',  values: { shape: 3, size: 0.62, aspect: 1,   radius: 0.4,  weight: 3,   glow: 34 } },
  { label: 'RING',  values: { shape: 1, size: 0.34, aspect: 1,   radius: 1,    weight: 6,   glow: 60 } },
];

// Which preset these values are, or -1 for none. Derived from the values rather than remembered, so moving a
// slider unlights the preset it no longer matches.
export function matchIdx(state) {
  for (let i = 0; i < PRESETS.length; i++) {
    const v = PRESETS[i].values;
    if (Object.keys(v).every((k) => Math.abs((state[k] ?? 0) - v[k]) < 1e-4)) return i;
  }
  return -1;
}
