/* crt-flicker.js — the two flicker engines.
 *
 * Pure state machines, no DOM. Each returns a brightness multiplier centered near 1; createFlicker() holds
 * the state so two instruments don't share phase.
 */
import { kelvinRgb, mix } from './crt-phosphor.js';

export function createFlicker() {
  // Per-bulb state, keyed by bulb id; also read by the DC for warmth and health sag (warm/hmod).
  const bulbs = {};
  // The screen's own phosphor flicker is a single event, not a cycle.
  let flkEv = null, flkNext = null;
  /* Last emitted pair, keyed on the two quantized inputs (health, temp) so most frames of a burst reuse it —
   * the Object.assign and cache-key build downstream are still paid every call regardless of the hit. */
  const thMemo = { ka: '', va: null, kb: '', vb: null };

  /* One scripted mains-fault timeline, not a random cycle — the same fault every run, since the shape is the
   * point. Both bulbs and the screen react to this single event, which is what reads as the room's power
   * rather than the fixture's health. Seven phases (collapse/struggle/build/flash/cut/dark/recover) run start
   * to end over SURGE_MS; returns null when none is running, the caller's cue to leave every value alone.
   */
  let surgeT0 = null;
  const SURGE_MS = 4600;
  // Smoothstep, used to interpolate between keyframes without a linear kink.
  const sEase = (x) => x * x * (3 - 2 * x);
  // Hashed off the step index, not Math.random, so the same run always guts the same way.
  const sHash = (n) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
  /* Keyframed, not eased: a single slide is monotone once the eye knows the direction, so each recovery leg
   * sets up the next drop instead. Warmth ratchets up-only while brightness bounces, since a cooling arc
   * doesn't un-cool on a momentary recovery — that divergence stops a recovery reading as "fault over".
   */
  const SG_KEYS = [
    [0, 1.00, 1.00, 0.0], [180, 0.42, 0.50, 0.8], [340, 0.88, 0.90, 0.5], [520, 0.25, 0.34, 1.6],
    [700, 0.70, 0.74, 1.2], [900, 0.18, 0.26, 2.2], [1080, 0.52, 0.58, 1.9], [1400, 0.34, 0.38, 2.6],
  ];
  // Interpolates the SG_KEYS timeline at dt, smoothstepped per leg.
  function sgKey(dt) {
    let i = 0;
    while (i < SG_KEYS.length - 2 && dt >= SG_KEYS[i + 1][0]) i++;
    const a = SG_KEYS[i], b = SG_KEYS[i + 1];
    const q = sEase(Math.max(0, Math.min(1, (dt - a[0]) / (b[0] - a[0]))));
    return { lamp: a[1] + (b[1] - a[1]) * q, screen: a[2] + (b[2] - a[2]) * q, warm: a[3] + (b[3] - a[3]) * q };
  }
  // Phase-table lookup for a running surge: dt in ms since trigger selects the multipliers below.
  function surgeAt(now) {
    if (surgeT0 == null) return null;
    const dt = now - surgeT0;
    if (dt < 0 || dt > SURGE_MS) { surgeT0 = null; return null; }
    if (dt < 1400) return sgKey(dt);
    if (dt < 2400) {
      /* Level climbs while short dips interrupt it (heals while guttering); warm stays pinned so the recovery
       * is brightness only. DIMMER is applied downstream, so this floor compounds rather than being final. */
      const p = (dt - 1400) / 1000;
      const h = sHash(Math.floor(dt / 42));
      const g = h < 0.12 ? 0.45 + h * 2.5 : 1;
      return { lamp: (0.34 + 0.28 * p) * g, screen: (0.38 + 0.26 * p) * g, warm: 2.6 };
    }
    if (dt < 2700) { const q = sEase((dt - 2400) / 300); return { lamp: 0.62 + q * 0.68, screen: 0.64 + q * 0.66, warm: 2.6 }; }
    if (dt < 2830) { const q = sEase((dt - 2700) / 130); return { lamp: 1.30 + q * 2.30, screen: 1.30 + q * 2.70, warm: 2.6 }; }
    if (dt < 2900) { const q = sEase((dt - 2830) / 70); return { lamp: 3.6 * (1 - q), screen: 4.0 * (1 - q), warm: 2.6 }; }
    if (dt < 3800) return { lamp: 0, screen: 0, warm: 2.6 };
    // warm only unwinds here — held at 2.6 through the flash, cut and dark, so color is the last thing to return.
    const p = (dt - 3800) / 800, gulp = Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p);
    const lvl = p * (1 - gulp * 0.85) + gulp * 0.25;
    return { lamp: lvl, screen: lvl, warm: 2.6 * (1 - sEase(p)) };
  }
  // Fired by the DC; retriggering restarts the timeline rather than layering a second fault on top.
  function triggerSurge(now) { surgeT0 = (now == null ? performance.now() : now); }

  /* Screen phosphor flicker: an irregular dip-and-recover event, not an oscillator — hz sets the average
   * rate and the gap scatters around it. Depth is strength * random^2.2, mostly mild with rare deep dips.
   * Returns the opacity multiplier to apply, or 1 when off.
   */
  function screenFlicker(now, hz, strength, on) {
    if (!(on && hz > 0.05)) { flkEv = null; flkNext = null; return 1; }
    if (flkNext == null) flkNext = now;
    if (!flkEv && now >= flkNext) {
      flkEv = { t0: now, dur: 40 + Math.random() * 150, depth: strength * Math.pow(Math.random(), 2.2) };
    }
    let op = 1;
    if (flkEv) {
      const p = (now - flkEv.t0) / flkEv.dur;
      if (p >= 1) { flkEv = null; flkNext = now + (1000 / hz) * (0.35 + Math.random() * 1.3); }
      else op = 1 - flkEv.depth * Math.sin(Math.PI * p);
    }
    return op;
  }

  // Live per-bulb state, so the DC can read this cycle's warmth and health sag.
  function bulbState(id) { return bulbs[id]; }

  /* Per-bulb flicker (fixture tubes): hz sets base rate, flux the amplitude; jitter scatters cycle period,
   * chaos scatters dip depth and re-strike odds. The fall/rise waveform is asymmetric — fast extinguish,
   * slower re-ignite — which is what most reads as electrical rather than animated. Cycles run in bursts
   * separated by calm holds, each with an optional buzz.
   */
  function bulbFlick(now, id, hz, flux, on, jit, chaos, health) {
    let st = bulbs[id];
    if (!st) st = bulbs[id] = { period: 0, t: 0, last: now, dip: 1, peak: 1, drop: 0.2, rest: 0, restVal: 1,
      started: false, warm: 0, warmTarget: 0, hmod: 1, hmodTarget: 1, dropEase: 2, riseEase: 1,
      envT: 0, envDur: 0, envFast: 0.6, burst: 0, buzzOn: false };
    if (!(on && hz > 0.05 && flux > 0.001)) {
      st.period = 0; st.t = 0; st.rest = 0; st.warm = 0; st.warmTarget = 0; st.hmod = 1; st.hmodTarget = 1; st.last = now;
      return 1;
    }
    const dt = Math.min(120, now - st.last); st.last = now;
    st.warm = st.warmTarget;   // snapped, not eased: an eased color shift reads as a fade, not a strike
    st.hmod = st.hmodTarget;
    const baseMs = 1000 / hz;
    // Occasional (buzzOn) ±6% flux ripple at a per-tube detuned rate, independent of the main cycle.
    const buzz = st.buzzOn ? 1 + flux * 0.06 * Math.sin(2 * Math.PI * (id === 'B' ? 61 : 53) * (now / 1000)) : 1;
    st.t += dt;
    // Cycle speed builds then falls within a randomized window (slow-fast-slow), so flicker rides in waves.
    st.envT += dt;
    if (st.envDur <= 0 || st.envT >= st.envDur) {
      st.envT = 0; st.envDur = 700 + Math.random() * (2200 + chaos * 4500); st.envFast = 0.35 + Math.random() * 0.45;
    }
    const ep = st.envT / st.envDur, slow = 1 + chaos * 0.8;
    const envMult = slow - (slow - st.envFast) * Math.pow(Math.sin(Math.PI * ep), 1.5);
    if (st.rest > 0) { st.rest -= dt; return st.restVal * buzz; }   // holding at an extreme between bursts
    if (st.period <= 0 || st.t >= st.period) {
      st.t = st.period > 0 ? st.t - st.period : 0;
      /* Burst phrasing: a short run of cycles, then a long calm hold (1 = the fixture's own set values) before
       * the next; low CHAOS means longer calm and fewer cycles per burst. */
      if (st.period > 0 && st.burst <= 0) {
        st.rest = baseMs * (6 + Math.random() * (8 + (1 - chaos) * 16));
        st.restVal = 1;
        st.burst = 2 + Math.floor(Math.random() * (2 + chaos * 6));
        st.buzzOn = Math.random() < 0.35 + chaos * 0.3;
        return st.restVal * buzz;
      }
      if (st.burst > 0) st.burst--;
      st.period = baseMs * envMult * (1 + (Math.random() * 2 - 1) * jit * 0.9);
      if (!st.started) { st.started = true; st.t = Math.random() * st.period; }   // random phase, so A and B desync from the start
      const reach = 1 - Math.random() * chaos;                  // dip depth fraction (1 = the full flux range)
      st.dip = Math.max(0, 1 - flux * reach);
      /* Strike temperature is independent of dip depth (a real re-ignition color is set by the arc, not how
       * far it fell) and can go negative: warm>0 is the tired pinkish cast, warm<0 the cold re-strike
       * overshoot. CHAOS sets the odds, never certainty — a jump every cycle would read as scripted. */
      /* Two ranges: a soft drift (still the same fixture) vs a minority of HARD strikes clamped near the
       * 2200K floor or 9000K ceiling, so a wrong-gas misfire reads as drastic without every strike railing. */
      // Tube condition, 0..1 — hoisted because the health sag below uses it too.
      const h = Math.max(0, Math.min(1, health == null ? 1 : health));
      if (Math.random() < 0.05 + chaos * 0.13) {
        const hard = Math.random() < chaos * 0.25;
        /* Health biases strike-color odds — a dying tube strikes warm more often — but never decides them,
         * and magnitude is untouched, so every color stays reachable at every health. */
        const pWarm = 0.5 + (1 - h) * 0.4;
        st.warmTarget = (Math.random() < pWarm ? 1 : -1) * (hard ? 1.4 + Math.random() * 1.1 : 0.3 + Math.random() * 1.0);
      }
      // A chance to shift warmth this cycle, scaled by the dip depth; otherwise it cools back toward neutral.
      else if (Math.random() < 0.28) st.warmTarget = (1 - st.dip) * (0.55 + Math.random() * 0.85);
      else st.warmTarget *= 0.5;
      /* Health sag: pSag rises as health falls (a dying tube misfires low more often); heal claws back roughly
       * half the deficit per cycle at full health, much less when unhealthy, so a sag only lingers in a
       * failing tube. At health 1 both reduce to the original constants exactly. */
      const pSag = 0.20 + (1 - h) * 0.35;
      const heal = 0.50 - (1 - h) * 0.32;
      if (Math.random() < pSag) st.hmodTarget = 1 - (1 - st.dip) * (0.5 + Math.random() * 0.5);
      else st.hmodTarget += (1 - st.hmodTarget) * heal;
      st.peak = Math.random() < chaos * 0.55 ? 1 + flux * (0.25 + 0.6 * Math.random()) : 1;   // re-strike overshoot
      st.drop = 0.06 + Math.random() * (0.12 + jit * 0.4);      // fast-fall fraction; JITTER widens the spread of dip speeds
      st.rise = 0.4 + Math.random() * (0.25 + chaos * 0.4);     // recovery split — how fast it re-ignites
      // Per-cycle easing exponents so transitions aren't uniform; CHAOS widens the spread.
      st.dropEase = 1.3 + Math.random() * (1.4 + chaos * 1.6);
      st.riseEase = 0.6 + Math.random() * (1.6 + chaos * 1.4);
    }
    const p = Math.min(1, st.t / st.period), d = st.drop, rs = st.rise || 0.55, de = st.dropEase || 2, re = st.riseEase || 1;
    if (p < d) { const q = p / d; return Math.max(0, 1 - (1 - st.dip) * Math.pow(q, de)) * buzz; }
    const q = (p - d) / (1 - d);
    if (q < rs) { const r = q / rs; return Math.max(0, st.dip + (st.peak - st.dip) * Math.pow(r, 1 / re)) * buzz; }
    const r = (q - rs) / (1 - rs);
    return Math.max(0, st.peak + (1 - st.peak) * Math.pow(r, 1 / re)) * buzz;
  }

  // surgeAt clears surgeT0 once dt runs past SURGE_MS; peekSurge checks bounds first so a mere probe-ahead
  // can't cancel a live fault the way calling surgeAt directly would.
  const running = (now) => surgeT0 != null && now - surgeT0 >= 0 && now - surgeT0 <= SURGE_MS;
  const peekSurge = (now) => (running(now) ? surgeAt(now) : null);
  return { screenFlicker, bulbFlick, bulbState, triggerSurge,
           surgeAt: peekSurge, surgeMs: () => SURGE_MS,
           // 0..1 progress through the fault, or null when none is running — for a readout.
           surgeProgress: (now) => (running(now) ? (now - surgeT0) / SURGE_MS : null) };
}
