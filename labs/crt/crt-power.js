/* crt-power.js — the tube's strike and collapse, as poses on a clock.
 *
 * Pure: no DOM, no renderer. The host owns state.power and the boot text; this owns where the animation has got
 * to, which is not a setting and must never be persisted.
 *
 * OFF IS ON MIRRORED IN TIME. PWR_ON's 100% is PWR_OFF's 0%, its 34% is the other's 66%, and the two beziers are
 * each other's reversal — reverse(x1,y1,x2,y2) = (1-x2,1-y2,1-x1,1-y1). Change one and recompute the other.
 *
 * Columns: sx/sy become uPwr, the picture's surviving extent; bright and op multiply into the level that rides
 * on uFlicker, which the shader spends on everything the tube emits and nothing it reflects.
 */

const PWR_ON = [
  [0.00, 0.015, 0.004, 4.4, 1],
  [0.34, 1.020, 0.006, 3.0, 1],
  [0.70, 1.000, 1.000, 1.5, 1],
  [1.00, 1.000, 1.000, 1.0, 1],
];
const PWR_OFF = [
  [0.00, 1.000, 1.000, 1.0, 1],
  [0.30, 1.000, 1.000, 1.5, 1],
  [0.66, 1.020, 0.006, 3.0, 1],
  [1.00, 0.015, 0.004, 4.4, 0],
];

/* A cubic-bezier timing function, solved for y given x.
 *
 * Newton on x, because t is not the curve's input: the progress is x and what is wanted is y. The bisection
 * fallback is for the flat-derivative case, where Newton cannot converge.
 *
 * THE POLYNOMIAL FORM, NOT THE BERNSTEIN ONE. With the endpoints pinned at 0 and 1 the curve expands to
 * (1+3a-3b)t³ + (3b-6a)t² + 3a·t; an earlier version carried a 6 where the middle term wants a 3, which left
 * every keyframe correct and every position between them wrong. Verified against the identities:
 * cubic-bezier(.5,0,.7,0) must reduce to y = t³ and (.3,1,.5,1) to 1-(1-t)³.
 */
export function bezier(x1, y1, x2, y2) {
  const curve = (t, a, b) => (((1 + 3 * a - 3 * b) * t + (3 * b - 6 * a)) * t + 3 * a) * t;
  const slope = (t, a, b) => 3 * (1 + 3 * a - 3 * b) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 4; i++) {
      const e = curve(t, x1, x2) - x;
      if (Math.abs(e) < 1e-5) return curve(t, y1, y2);
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 20; i++) { t = (lo + hi) * 0.5; if (curve(t, x1, x2) < x) lo = t; else hi = t; }
    return curve(t, y1, y2);
  };
}

const EASE_ON  = bezier(0.3, 1, 0.5, 1);
const EASE_OFF = bezier(0.5, 0, 0.7, 0);

/* The pose at progress u, with the interval's OWN easing applied inside it.
 *
 * CSS eases each interval, not the whole run: the bezier is re-applied from 0 to 1 across each adjacent pair of
 * keyframes. Easing the global progress and interpolating linearly puts every pose at the wrong time but the ends.
 */
export function poseAt(track, u, ease) {
  let i = 0;
  while (i < track.length - 2 && u > track[i + 1][0]) i++;
  const a = track[i], b = track[i + 1];
  const e = ease(Math.min(1, Math.max(0, (u - a[0]) / Math.max(1e-6, b[0] - a[0]))));
  const at = (j) => a[j] + (b[j] - a[j]) * e;
  return { sx: at(1), sy: at(2), lvl: at(3) * at(4) };
}

const SETTLED_ON  = { sx: 1, sy: 1, lvl: 1 };
const SETTLED_OFF = { sx: 1, sy: 1, lvl: 0 };

/* A factory, because it holds phase: two instruments on one page cannot share each other's clock.
 *
 * `at` is PURE — it reads the phase and never retires it, so a measurement can sample past the end of a run
 * without switching the tube off. `advance` is the frame loop's call, and the only thing that moves time on.
 */
export function createPower(on) {
  let phase = on ? 'on' : 'off';
  let t0 = 0;

  const at = (now, secs) => {
    if (phase === 'on')  return SETTLED_ON;
    if (phase === 'off') return SETTLED_OFF;
    const igniting = phase === 'ignite';
    const u = (now - t0) / (Math.max(0.05, igniting ? secs.ignite : secs.collapse) * 1000);
    if (u >= 1) return igniting ? SETTLED_ON : SETTLED_OFF;
    return poseAt(igniting ? PWR_ON : PWR_OFF, u, igniting ? EASE_ON : EASE_OFF);
  };

  return {
    at,
    get phase() { return phase; },
    get t0() { return t0; },
    strike(now) { phase = 'ignite'; t0 = now; },
    collapse(now) { phase = 'collapse'; t0 = now; },
    advance(now, secs) {
      if (phase === 'ignite' || phase === 'collapse') {
        const dur = Math.max(0.05, phase === 'ignite' ? secs.ignite : secs.collapse) * 1000;
        if (now - t0 >= dur) phase = phase === 'ignite' ? 'on' : 'off';
      }
      return at(now, secs);
    },
  };
}
