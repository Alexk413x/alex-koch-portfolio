/* lab/controls.js — the value plumbing every lab was hand-rolling.
 *
 * Pure functions, no DOM, no component state. The convention all three labs already share:
 *
 *   META[key] = { key, label, min, max, step, keystep?, fmt?, parse? }   one entry per control
 *   state[key] = <number>                                               the live value
 *   onChange(key, value) => this.setState({ [key]: value })             the only way a value changes
 *
 * so the sidebar never owns a value — it reads `state` and calls back. That is what makes it generic: it has no idea
 * what any of these numbers mean.
 */

/* Build the sidebar's `sections` prop from a layout spec.
 *
 *   sections([{ name: 'CORE', keys: ['size', 'hue'] }], META, this.state)
 *
 * Each spec entry may also carry `toggle` ({ on, onToggle, onLabel, offLabel }), `swatch` ({ color, onInput }) and
 * `colors` (a key -> css colour map, to tint individual labels). Unknown keys are DROPPED rather than rendered blank:
 * a control whose META entry was deleted is a mistake to make visible in the console, not a mystery row in the panel.
 */
export function sections(spec, meta, state, onWarn) {
  return (spec || []).map((s) => {
    const keys = s.keys || [];
    const sliders = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], m = meta[k];
      if (!m) { if (onWarn) onWarn(k); else console.warn('[sidebar] no META entry for control ' + JSON.stringify(k)); continue; }
      sliders.push(Object.assign({}, m, { value: state[k], color: (s.colors && s.colors[k]) || null }));
    }
    const out = { name: s.name, sliders: sliders };
    if (s.toggle) out.toggle = s.toggle;
    if (s.swatch) out.swatch = s.swatch;
    // Forwarded by name, like the two above. This is an ALLOW-LIST, so anything the Sidebar grows has to be added here
    // or it silently never arrives: toggleRows worked when a lab passed sections straight to the Sidebar and vanished
    // when the same spec went through this builder, which looks like a Sidebar bug and is not one.
    if (s.toggleRows) out.toggleRows = s.toggleRows;
    return out;
  });
}

// Every control key a spec references, in panel order. Useful for persisting exactly the values the panel can change.
export function keysOf(spec) {
  const out = [];
  (spec || []).forEach((s) => (s.keys || []).forEach((k) => { if (out.indexOf(k) < 0) out.push(k); }));
  return out;
}

/* Clamp restored values into each control's CURRENT range, in place, and return the object.
 *
 * Narrowing a range otherwise leaves a persisted value the control cannot represent: the thumb pins at max while the
 * readout shows the old number. A range clamp cannot catch a control whose MEANING changed, though -- an in-range
 * number that now means something else needs a migration, keyed by storage key rather than by a version field.
 */
export function clamp(meta, state) {
  Object.keys(meta).forEach((k) => {
    const m = meta[k], v = state[k];
    if (typeof v === 'number' && m && m.min != null) state[k] = Math.max(m.min, Math.min(m.max, v));
  });
  return state;
}

// localStorage, which throws in enough situations (private mode, quota, disabled) that no caller should have to care.
export function load(storeKey) {
  try { return JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch (e) { return null; }
}

// Writes only the named keys when `keys` is given, so a lab's transient state (animation phase, boot counters, the
// power flag) never lands on disk and come back as a setting.
export function save(storeKey, state, keys) {
  const out = {};
  (keys || Object.keys(state)).forEach((k) => { out[k] = state[k]; });
  try { localStorage.setItem(storeKey, JSON.stringify(out)); } catch (e) {}
  return out;
}

/* Formatters. A META table is mostly `fmt`, and hand-writing them is where the units drift: a slider reading "50" when
 * it means 50% and another reading "0.50" for the same quantity. Each returns a { fmt, parse } pair, so the readout and
 * the typed-in value always agree about units -- the text field is editable, and a parse that does not invert its own
 * fmt is a control that changes value when you click into it and out again.
 */
export const as = {
  // The value IS the number shown. digits fixes the decimals.
  raw: (digits, suffix) => ({ fmt: (v) => v.toFixed(digits == null ? 2 : digits) + (suffix || ''), parse: (r) => parseFloat(r) }),
  // 0..1 stored, 0..100 shown.
  pct: () => ({ fmt: (v) => Math.round(v * 100) + '%', parse: (r) => parseFloat(r) / 100 }),
  // Already 0..100.
  pct100: () => ({ fmt: (v) => Math.round(v) + '%', parse: (r) => parseFloat(r) }),
  px: () => ({ fmt: (v) => Math.round(v) + 'px', parse: (r) => parseFloat(r) }),
  deg: (digits) => ({ fmt: (v) => v.toFixed(digits == null ? 0 : digits) + '\u00b0', parse: (r) => parseFloat(r) }),
  mult: (digits) => ({ fmt: (v) => v.toFixed(digits == null ? 2 : digits) + '\u00d7', parse: (r) => parseFloat(r) }),
  // Off at the bottom of the range, which is a label rather than a separate control.
  off: (inner, at) => ({ fmt: (v) => (v <= (at == null ? 0 : at) ? 'OFF' : inner.fmt(v)), parse: inner.parse }),
  // Named ends: 0 reads lo, max reads hi, everything between uses inner.
  ends: (inner, lo, hi, max) => ({ fmt: (v) => v <= 0 ? lo : v >= max ? hi : inner.fmt(v), parse: inner.parse }),
};

/* One control entry, so a META table reads as a list of decisions instead of a wall of repeated punctuation:
 *
 *   size: ctl('SIZE', 0, 1.5, 0.01, as.pct()),
 */
export function ctl(label, min, max, step, unit, extra) {
  return Object.assign({ label: label, min: min, max: max, step: step, keystep: step,
    fmt: unit ? unit.fmt : undefined, parse: unit ? unit.parse : undefined }, extra || {});
}

// Stamps the `key` on every entry, so a table cannot carry a name that disagrees with the state field it drives.
export function table(defs) {
  Object.keys(defs).forEach((k) => { defs[k].key = k; });
  return defs;
}
