/* crt-flicker.js — the two flicker engines.
 *
 * Pure state machines: no DOM. Each returns a brightness MULTIPLIER centred near 1, and the caller decides how to
 * spend it. createFlicker() carries the machines' state, so two instruments cannot share each other's phase.
 */
import { kelvinRgb, mix } from './crt-phosphor.js';

export function createFlicker() {
  // Per-bulb machine state, keyed by bulb id. Also read by the DC for warmth and health sag (warm / hmod).
  const bulbs = {};
  // The screen's own phosphor flicker is a single event, not a cycle.
  let flkEv = null, flkNext = null;
  /* One remembered emission pair, keyed on the two quantised inputs. tubeHealth caches inside the fixture, but the
   * Object.assign that feeds it and the cache key it builds are paid on every call regardless -- and health and temp are
   * quantised here precisely so they hold still for stretches, so on most frames of a burst both are unchanged. */
  const thMemo = { ka: '', va: null, kb: '', vb: null };

  /* THE SURGE: one scripted mains fault, start to finish.
   *
   * Not a flicker. bulbFlick models a tube failing on its own — random cycles, its own phase per bulb, no beginning
   * or end. A surge is a single EVENT on the supply feeding everything, so it is authored as a timeline rather than
   * sampled from a distribution: the same fault every time, because the shape is the point. It is also the only
   * thing here that both tubes AND the screen obey together, which is what makes it read as the room's power
   * rather than the fixture's health.
   *
   * The seven phases, and why each is that length:
   *   COLLAPSE 1400ms  the rail failing, keyframed as lurches and false recoveries rather than an eased slide.
   *                    Brightness bounces; warmth ratchets one way only, driving through the 2200K floor.
   *   STRUGGLE 1000ms  guttering, and HEALING as it gutters — the level climbs while short steps keep chopping into
   *                    it, so the tube reads as fighting its way back rather than as simply broken. The colour does
   *                    NOT recover with it: a re-striking arc brings its brightness back long before the phosphor
   *                    and mercury warm up. Hard-edged steps rather than a sine, because an arc losing and regaining
   *                    its strike is a switch. Deterministic, hashed off the step index.
   *   BUILD     300ms  the core coming back, BRIGHTNESS ONLY. The only quiet phase, and it exists to buy the flash
   *                    its impact — without a ramp the flash is just another spike.
   *   FLASH     130ms  everything at once, AND STILL ORANGE. Health is clamped back to full so the whole tube lights,
   *                    but the warmth holds: swinging the colour cold reads as a different, whiter lamp switching on,
   *                    where it should read as THIS lamp driven far past what it can take.
   *   CUT        70ms  the breaker, with fall time rather than a step to zero, and the colour still held.
   *   DARK      900ms  nothing. Long enough to stop waiting, which is what makes the recovery a surprise.
   *   RECOVER   800ms  three decaying gulps converging on 1 as the arc re-establishes, and the ONLY place the
   *                    temperature unwinds — so the colour is the last thing to come home.
   *
   * Returns null when no surge is running, which is the caller's signal to leave every value alone.
   */
  let surgeT0 = null;
  const SURGE_MS = 4600;
  const sEase = (x) => x * x * (3 - 2 * x);
  // Deterministic per-step noise: the guttering must be the same fault every run, so it is hashed off the step index
  // rather than drawn from Math.random.
  const sHash = (n) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
  /* THE COLLAPSE IS A ROLLER COASTER, NOT A RAMP. A single eased slide is monotone: once the eye has the direction,
   * the rest of the phase carries no information. A supply actually failing lurches, catches, appears to recover and
   * drops further than before — and it is the RECOVERIES that make the next plunge land, because each one
   * re-establishes a level for the next drop to violate.
   *
   * So the phase is keyframed rather than eased, each leg smoothstepped between its keys so the motion swoops. The
   * drama is in the ORDER of the levels, not in the easing.
   *
   * The colour ratchets one way only: brightness bounces, warmth climbs monotonically, because a cooling arc does not
   * un-cool when the voltage momentarily returns. That divergence is what stops the recoveries reading as the fault
   * being over.
   */
  const SG_KEYS = [
    [0, 1.00, 1.00, 0.0], [180, 0.42, 0.50, 0.8], [340, 0.88, 0.90, 0.5], [520, 0.25, 0.34, 1.6],
    [700, 0.70, 0.74, 1.2], [900, 0.18, 0.26, 2.2], [1080, 0.52, 0.58, 1.9], [1400, 0.34, 0.38, 2.6],
  ];
  function sgKey(dt) {
    let i = 0;
    while (i < SG_KEYS.length - 2 && dt >= SG_KEYS[i + 1][0]) i++;
    const a = SG_KEYS[i], b = SG_KEYS[i + 1];
    const q = sEase(Math.max(0, Math.min(1, (dt - a[0]) / (b[0] - a[0]))));
    return { lamp: a[1] + (b[1] - a[1]) * q, screen: a[2] + (b[2] - a[2]) * q, warm: a[3] + (b[3] - a[3]) * q };
  }
  function surgeAt(now) {
    if (surgeT0 == null) return null;
    const dt = now - surgeT0;
    if (dt < 0 || dt > SURGE_MS) { surgeT0 = null; return null; }
    if (dt < 1400) return sgKey(dt);
    if (dt < 2400) {
      /* THE BULB HEALS WHILE IT GUTTERS, and the COLOUR DOES NOT — two things a real re-strike separates. Holding the
       * level flat reads as a bulb that is simply broken; letting it climb while the gutter keeps interrupting reads
       * as one fighting its way back. warm stays pinned, so the recovery is in the brightness alone.
       *
       * THE FLOOR IS NOT THE FINAL WORD on how bright the tube is: DIMMER is applied separately downstream, so the
       * two compound, and a floor set for full output goes far darker than intended in an already-dim room. */
      const p = (dt - 1400) / 1000;
      const h = sHash(Math.floor(dt / 42));
      const g = h < 0.12 ? 0.45 + h * 2.5 : 1;
      return { lamp: (0.34 + 0.28 * p) * g, screen: (0.38 + 0.26 * p) * g, warm: 2.6 };
    }
    if (dt < 2700) { const q = sEase((dt - 2400) / 300); return { lamp: 0.62 + q * 0.68, screen: 0.64 + q * 0.66, warm: 2.6 }; }
    if (dt < 2830) { const q = sEase((dt - 2700) / 130); return { lamp: 1.30 + q * 2.30, screen: 1.30 + q * 2.70, warm: 2.6 }; }
    if (dt < 2900) { const q = sEase((dt - 2830) / 70); return { lamp: 3.6 * (1 - q), screen: 4.0 * (1 - q), warm: 2.6 }; }
    if (dt < 3800) return { lamp: 0, screen: 0, warm: 2.6 };
    /* THE COLOUR COMES HOME LAST. Warmth is held at 2.6 right through the flash, the cut and the dark, and only unwinds
     * across the recovery -- so the temperature is the final thing to return, after the level already has. */
    const p = (dt - 3800) / 800, gulp = Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p);
    const lvl = p * (1 - gulp * 0.85) + gulp * 0.25;
    return { lamp: lvl, screen: lvl, warm: 2.6 * (1 - sEase(p)) };
  }
  // Fired by the DC. Re-triggering restarts the timeline rather than layering two faults on top of each other.
  function triggerSurge(now) { surgeT0 = (now == null ? performance.now() : now); }

  /* PHOSPHOR FLICKER — the screen. A random event machine rather than an oscillator: real phosphor dips and recovers at
   * irregular intervals, so `hz` sets the average RATE and the gap is scattered around it. Depth is
   * strength * random^2.2, which is mostly mild with rare peaks near full.
   * Returns the opacity to apply, or 1 when off.
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
      else op = 1 - flkEv.depth * Math.sin(Math.PI * p);   // a quick dip and recover
    }
    return op;
  }

  // The live machine state for a bulb, so the DC can read this cycle's warmth and health sag.
  function bulbState(id) { return bulbs[id]; }

  /* PER-BULB FLUX ENGINE — the light fixture's tubes.
   *
   * Each bulb runs its own randomised cycle. `hz` is the base rate and `flux` the amplitude; JITTER scatters the cycle
   * PERIOD and CHAOS scatters how deep each dip reaches, plus triggers occasional bright re-strike overshoots. The
   * waveform is ASYMMETRIC — a fast extinguish then a slower re-ignite — which is how a failing tube behaves and the
   * single thing that most makes this read as electrical rather than animated.
   *
   * Structure, outermost first: bursts of flicker separated by long calm holds; within a burst, a rate envelope that
   * speeds up and slows down; within a cycle, the fall/rise waveform; over all of it, an optional buzz.
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
    st.warm = st.warmTarget;   // snapped, not eased: an eased colour shift reads as a fade, not a strike
    st.hmod = st.hmodTarget;
    const baseMs = 1000 / hz;
    /* Electrical buzz: ±~6% of flux at a fast, per-tube detuned rate, independent of the main cycle. Rides only SOME
     * bursts (buzzOn, rolled when a burst is armed) so it is an occasional trait rather than a constant hum. */
    const buzz = st.buzzOn ? 1 + flux * 0.06 * Math.sin(2 * Math.PI * (id === 'B' ? 61 : 53) * (now / 1000)) : 1;
    st.t += dt;
    // Rate envelope: over a randomised window the cycle speed builds then falls back — slow, fast, slow — so the
    // flicker accelerates in waves instead of running at one rate.
    st.envT += dt;
    if (st.envDur <= 0 || st.envT >= st.envDur) {
      st.envT = 0; st.envDur = 700 + Math.random() * (2200 + chaos * 4500); st.envFast = 0.35 + Math.random() * 0.45;
    }
    const ep = st.envT / st.envDur, slow = 1 + chaos * 0.8;
    const envMult = slow - (slow - st.envFast) * Math.pow(Math.sin(Math.PI * ep), 1.5);
    if (st.rest > 0) { st.rest -= dt; return st.restVal * buzz; }   // holding at an extreme between bursts
    if (st.period <= 0 || st.t >= st.period) {
      st.t = st.period > 0 ? st.t - st.period : 0;
      /* Burst phrasing: a short run of flicker cycles, then a long calm hold before the next burst, so flicker reads as
       * events rather than constant noise. Low CHAOS = longer calm and shorter bursts; high CHAOS = wilder and more
       * frequent. The calm value is 1 — the fixture's own set values, undisturbed. */
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
      /* A COLOUR STRIKE: an occasional re-ignition at a genuinely DIFFERENT temperature, and not every cycle.
       *
       * Tying the shift to dip depth means a tube can dim visibly and come back at exactly the temperature it left. A
       * failing fluorescent does the opposite: the striking colour is set by what the arc does at re-ignition, not by
       * how far it fell, so the jump is sometimes large after a small dip and absent after a big one.
       *
       * NEGATIVE IS ALLOWED, and that is most of the point: warm > 0 drops kelvin for the tired pinkish cast of an old
       * tube, warm < 0 raises it for the cold blue-green of a re-strike before the phosphor catches up. Weighted
       * toward warm, because that is the commoner fault.
       *
       * CHAOS GOVERNS THE ODDS rather than a new slider, and it stays a CHANCE at every setting — a jump every cycle
       * reads as an effect, and the whole reason this is rare is that a colour that changes only sometimes looks
       * electrical.
       */
      /* TWO SIZES OF STRIKE, because one range cannot be both. A modest ceiling is a believable drift — clearly a
       * different colour but still the same fixture. What it cannot do is misfire: a tube that strikes on the wrong
       * gas mix goes somewhere unreasonable, and clamping is what makes that legible — a HARD strike drives straight
       * into the 2200K floor or the 9000K ceiling.
       *
       * Hard strikes are a MINORITY of strikes, which is the only thing keeping them drastic. If every strike went to
       * the rail there would be no scale left to be drastic against.
       */
      // The tube's CONDITION, 0..1. Hoisted because the health sag below leans on it too, on the same terms.
      const h = Math.max(0, Math.min(1, health == null ? 1 : health));
      if (Math.random() < 0.05 + chaos * 0.13) {
        const hard = Math.random() < chaos * 0.25;
        /* HEALTH BIASES THE DIRECTION; IT DOES NOT DECIDE IT. A tube going down strikes warm more often than cold, but a
         * healthy tube striking warm is an ordinary misfire, and a dying one can still flash cold on re-ignition.
         *
         * So the odds lean with health and are NEVER 0 or 1 at either end. The magnitude is untouched by health, so
         * every colour stays reachable from every state — which keeps the bias readable as a tendency rather than
         * felt as a rule.
         */
        const pWarm = 0.5 + (1 - h) * 0.4;
        st.warmTarget = (Math.random() < pWarm ? 1 : -1) * (hard ? 1.4 + Math.random() * 1.1 : 0.3 + Math.random() * 1.0);
      }
      // A chance to shift warmth this cycle, scaled by the dip depth; otherwise it cools back toward neutral.
      else if (Math.random() < 0.28) st.warmTarget = (1 - st.dip) * (0.55 + Math.random() * 0.85);
      else st.warmTarget *= 0.5;
      /* A chance to sag this tube's health — the coating dying back, greying out and dimming; otherwise recovers.
       *
       * HEALTH BIASES HOW OFTEN THE SAG COMES AND HOW LONG IT HOLDS, on the same terms the colour strike uses: it
       * leans the odds, it never decides them, and it is never 0 or 1 at either end. Flat, a tube at 30% health sags
       * about as often as one at full health, which is the opposite of how a lamp dies.
       *
       *   pSag  a failing lamp reaches for a low state far more often, but a healthy one can still misfire.
       *   heal  the fraction of the remaining deficit recovered per cycle, and the reason a sag never LASTED: halving
       *         the gap every cycle leaves a tube most of the way back within three of them. At low health it claws
       *         back far less and the dip persists — the difference between a tube that blinks and one that is going.
       *
       * AT FULL HEALTH BOTH ARE THEIR OLD CONSTANTS EXACTLY, so the h = 1 case stays a control to measure against. */
      const pSag = 0.20 + (1 - h) * 0.35;
      const heal = 0.50 - (1 - h) * 0.32;
      if (Math.random() < pSag) st.hmodTarget = 1 - (1 - st.dip) * (0.5 + Math.random() * 0.5);
      else st.hmodTarget += (1 - st.hmodTarget) * heal;
      st.peak = Math.random() < chaos * 0.55 ? 1 + flux * (0.25 + 0.6 * Math.random()) : 1;   // re-strike overshoot
      st.drop = 0.06 + Math.random() * (0.12 + jit * 0.4);      // fast-fall fraction; JITTER widens the spread of dip speeds
      st.rise = 0.4 + Math.random() * (0.25 + chaos * 0.4);     // recovery split — how fast it re-ignites
      // Per-cycle easing exponents, so transitions are not all the same shape: some snap, some ease in slowly. CHAOS
      // widens the spread.
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

  /* surgeAt IS PUBLISHED so a caller can read the fault without knowing its phase table, the same reasoning as
   * bulbState: the machine's state is the caller's to read, and how it is SPENT is the caller's to decide.
   *
   * PURE: sampling past the end must not end the run. surgeAt clears surgeT0 when it reads past SURGE_MS, so a
   * caller probing the future would cancel a live fault — hence peekSurge. */
  const running = (now) => surgeT0 != null && now - surgeT0 >= 0 && now - surgeT0 <= SURGE_MS;
  const peekSurge = (now) => (running(now) ? surgeAt(now) : null);
  return { screenFlicker, bulbFlick, bulbState, triggerSurge,
           surgeAt: peekSurge, surgeMs: () => SURGE_MS,
           // How far into the fault we are, 0..1, or null when none is running -- for a readout.
           surgeProgress: (now) => (running(now) ? (now - surgeT0) / SURGE_MS : null) };
}
