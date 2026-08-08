/* The three reaction states, and which of them the current settings are. Pure data plus one predicate; kept
 * apart from reactor-sidebar because a scene, its values and its chrome vary independently.
 */

// The camera is the user's, not a preset's: applyPreset strips these, and matchIdx ignores them so that moving
// the view does not make a preset read as CUSTOM.
export const CAM_KEYS = ['cam', 'zoom', 'camAngle', 'camEl'];

export const MODES = ['STABLE', 'CRITICAL', 'MELTDOWN'];

export const PRESETS = [
  { size: 0.50, visc: 1.8, turb: 0.40, rate: 5, amp: 0.03, glow: 1.25, hue: 0.0, orbit: 0.4, cam: 0, zoom: 1.0, ringR: 1.10, orbitX: 0, ringAngleY: 0, ringAngleX: 0, wobble: 0, wobbleSpd: 1.5, ringLight: 0.5, ringGlow: 0.17, camAngle: 0, camEl: 0, coreSpin: 1.0472, coreAngle: 0, coreSpinX: 0.2094, coreAngleX: 0.15, pulseAmp: 10, pulseBright: 1, pulseDur: 1.2, ventSize: 3, ventBright: 1, ventDur: 6, coreHex: '#28ff1a' },
  { size: 0.75, visc: 3.4, turb: 0.50, rate: 6, amp: 0.08, glow: 1.0, hue: 0.0, orbit: 2.6, cam: 0, zoom: 1.0, ringR: 1.10, orbitX: 0, ringAngleY: 0, ringAngleX: 0, wobble: 0, wobbleSpd: 1.5, ringLight: 1.0, ringGlow: 0.35, camAngle: 0, camEl: 0, coreSpin: 1.40, coreAngle: 0, coreSpinX: 0.65, coreAngleX: 0.25, pulseAmp: 15, pulseBright: 1.6, pulseDur: 1, ventSize: 1.4, ventBright: 1.6, ventDur: 4.5, coreHex: '#ffcc14' },
  { size: 1.00, visc: 5.0, turb: 0.82, rate: 6, amp: 0.14, glow: 2.8, hue: 0.0, orbit: 2.2, cam: 0, zoom: 1.0, ringR: 1.10, orbitX: 0, ringAngleY: 0, ringAngleX: 0, wobble: 0, wobbleSpd: 1.5, ringLight: 1.0, ringGlow: 0.17, camAngle: 0, camEl: 0, coreSpin: 2.80, coreAngle: 0, coreSpinX: -1.30, coreAngleX: 0.40, pulseAmp: 20, pulseBright: 2.4, pulseDur: 0.8, ventSize: 2, ventBright: 2.4, ventDur: 4, coreHex: '#f23304' },
];

/* The shipped configuration: STABLE, plus the values no preset carries.
 *
 * `ringOn` is positive, not `ringHidden`: panel.js shows a section's rows when its master key is TRUTHY, so an
 * inverted flag would light the button while the ring was gone and hide the rows that switch it back on.
 *
 * Render scale starts lower on integrated graphics — this is a seventy-step sphere trace with a twenty-droplet
 * inner loop.
 */
export function defaultPreset(gpu) {
  return {
    mode: 0, shape: 0,
    ringOn: 1, ringBreak: 0, breakSpd: 0,
    ventSwellPct: 0.9, subVT: 1, ventVT: 1,
    octaves: 1, pulseSize: 0.3, dropN: 10,
    coreHex: '#28ff1a',
    renderScale: gpu && gpu.integrated ? 0.55 : 0.62,
    secClosed: {},
    ...PRESETS[0],
  };
}

// Which preset these values are, or -1 for none (the masthead's CUSTOM, and all three pills unlit). Derived from
// the values rather than remembered, so editing a slider unlights the preset it no longer matches. Compared with a
// tolerance because these floats have been through a slider and JSON.
export function matchIdx(s) {
  for (let i = 0; i < PRESETS.length; i++) {
    const p = PRESETS[i];
    const same = Object.keys(p).every((k) => {
      if (CAM_KEYS.includes(k)) return true;
      const b = p[k];
      if (typeof b === 'string') return s[k] === b;
      return Math.abs((s[k] ?? 0) - b) < 1e-4;
    });
    if (same) return i;
  }
  return -1;
}
