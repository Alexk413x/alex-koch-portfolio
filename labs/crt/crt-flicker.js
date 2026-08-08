/* crt/crt-flicker.js — the two flicker engines.
 *
 * Pure state machines: no DOM. Each returns a brightness MULTIPLIER centred near 1, and the DC writes it to a CSS
 * variable. They are here rather than in the DC because they are the only stateful-per-frame logic in the instrument,
 * and mixing "what value should this be now" with "which element gets it" is what made them impossible to reason about.
 *
 * createFlicker() carries the machines' state, so two instruments cannot share each other's phase.
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
   * Not a flicker. bulbFlick models a tube failing on its own -- random cycles, its own phase per bulb, no beginning or
   * end. A surge is a single EVENT on the supply feeding everything, so it is authored as a timeline rather than sampled
   * from a distribution: the same fault every time, because the shape is the point. It is also the only thing here that
   * both tubes AND the screen obey together, which is what makes it read as the room's power rather than the fixture's
   * health.
   *
   * The seven phases, and why each is that length:
   *   COLLAPSE 1400ms  the rail failing, keyframed as a series of lurches and false recoveries rather than an eased slide
   *                    -- see SG_KEYS. Brightness bounces between 0.88 and 0.18; warmth ratchets one way only, to 2.6,
   *                    driving through the 2200K floor so the tubes end at the deepest orange the model has.
   *   STRUGGLE 1000ms  guttering, and HEALING as it gutters. The level climbs 0.20 -> 0.55 while 42ms steps keep chopping
   *                    into it, so the tube reads as fighting its way back rather than as simply broken -- a flat level
   *                    here was the whole reason the bulbs looked destroyed. The colour does NOT recover with it: warm
   *                    stays pinned at 2.6, because a re-striking arc brings its brightness back long before the phosphor
   *                    and mercury warm up. Hard-edged steps rather than a sine -- an arc losing and regaining its strike
   *                    is a switch, not a wave. Deterministic, hashed off the step index, so the same fault plays the same
   *                    way every run.
   *   BUILD     300ms  the core coming back -- BRIGHTNESS ONLY. The level climbs 0.62 past 1.3 while warmth stays pinned at
   *                    2.6, so the tube gets brighter without getting healthier: a re-striking arc drives harder long before
   *                    its phosphor and mercury come back up to temperature, and letting the colour recover here made the
   *                    fault look finished 300ms before it was. The only quiet phase, and it exists to buy the flash its
   *                    impact -- without a ramp the flash is just another spike.
   *   FLASH     130ms  everything at once, AND STILL ORANGE. 3.6x on the lamp, 4.0x on the screen, health clamped back to
   *                    full so the whole tube lights rather than just its ends -- but warmth stays at 2.6. Swinging the
   *                    colour cold here was wrong: it made the flash read as a different, whiter lamp switching on, when
   *                    what it should read as is THIS lamp -- the same starved orange one you have been watching for two
   *                    seconds -- driven far past what it can take. Keeping the hue and moving only the intensity is what
   *                    ties the flash to the fault instead of ending it.
   *   CUT        70ms  the breaker, with fall time rather than a step to zero, and the colour still held.
   *   DARK      900ms  nothing. Long enough to stop waiting, which is what makes the recovery a surprise.
   *   RECOVER   800ms  three decaying gulps converging on 1 as the arc re-establishes, and the ONLY place the temperature
   *                    unwinds -- 2.6 back to 0 across the phase, so the colour is the last thing to come home.
   *
   * Returns null when no surge is running, which is the caller's signal to leave every value alone.
   */
  let surgeT0 = null;
  const SURGE_MS = 4600;
  const sEase = (x) => x * x * (3 - 2 * x);
  // Deterministic per-step noise: the guttering must be the same fault every run, so it is hashed off the step index
  // rather than drawn from Math.random.
  const sHash = (n) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
  /* THE COLLAPSE IS A ROLLER COASTER, NOT A RAMP.
   *
   * A single eased slide from 1 to the starve floor is monotone: once the eye has the direction, the rest of the phase
   * carries no information and the fault stops being frightening about 200ms in. A supply actually failing does not
   * descend -- it lurches, catches, appears to recover, and drops further than it did before, and it is the RECOVERIES
   * that make the next plunge land, because each one re-establishes a level for the next drop to violate.
   *
   * So the phase is keyframed rather than eased: plunge to 0.42, snap back to 0.88 (nearly normal -- the false all-clear),
   * deeper to 0.25, up to 0.70, deepest to 0.18, half-recover, then settle onto the starve floor. Each leg is smoothstepped
   * between its keys so the motion swoops rather than steps; the drama is in the ORDER of the levels, not in the easing.
   *
   * The colour ratchets one way only. Brightness bounces, warmth climbs monotonically to 2.6 -- because a cooling arc does
   * not un-cool when the voltage momentarily returns, so a bright recovery at 1.2 warmth still looks sicker than the one
   * before it. That divergence is what stops the recoveries from reading as the fault being over.
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
      /* THE BULB HEALS WHILE IT GUTTERS, and the COLOUR DOES NOT. Two things a real re-strike separates: the arc
       * re-establishing brings the brightness back, but the phosphor and mercury are still cold, so it comes back deep
       * orange and stays there. Holding the level flat read as a bulb that was simply broken; letting it climb while the
       * gutter keeps interrupting reads as one fighting its way back. warm stays pinned at 2.6 -- through the 2200K floor
       * -- so the recovery is in the brightness alone.
       *
       * THE FLOOR IS 0.34, NOT 0.20, because this multiplier is not the final word on how bright the tube is: DIMMER is
       * applied separately downstream, so the two compound. A 0.20 floor under a 60% DIMMER put the starve at 12% of full
       * rather than the 20% it was written to mean, and the darker the room was already set, the darker the fault went. */
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
   * PERIOD (up to ±90% of base) and CHAOS scatters how deep each dip reaches, plus triggers occasional bright
   * re-strike overshoots. The waveform is ASYMMETRIC — a fast extinguish then a slower re-ignite — which is the way a
   * failing tube actually behaves and the single thing that most makes this read as electrical rather than animated.
   *
   * Structure, outermost first: bursts of flicker separated by long calm holds; within a burst, a rate envelope that
   * speeds up and slows down; within a cycle, the fall/rise waveform; over all of it, an optional high-frequency buzz.
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
       * The shift below it is scaled by (1 - st.dip), which ties colour to dip depth -- so a shallow cycle can only ever
       * nudge the colour, and a tube can dim visibly and come back at exactly the temperature it left. A failing
       * fluorescent does the opposite: the striking colour is set by what the arc does at re-ignition, not by how far it
       * fell, so the jump is sometimes large after a small dip and absent after a big one.
       *
       * NEGATIVE IS ALLOWED, and that is most of the point. warm > 0 drops kelvin (the tired pinkish cast of an old tube)
       * while warm < 0 raises it -- the cold blue-green of a re-strike before the phosphor catches up. Only the warm half
       * existed, so the fixture could get old but never get cold. Weighted toward warm, because that is the commoner fault.
       *
       * CHAOS GOVERNS THE ODDS rather than a new slider: at 0 the colour holds still and the tube only dims, and at full it
       * jumps on nearly a fifth of cycles. It stays a CHANCE at every setting -- a jump every cycle reads as an effect,
       * and the whole reason this is rare is that a colour that changes only sometimes is what makes it look electrical.
       */
      /* TWO SIZES OF STRIKE, because one range cannot be both. A ±1.3 ceiling is a believable drift -- about 1950K, so a
       * 5000K lamp lands between 3050K and 6950K, clearly a different colour but still the same fixture. What it cannot do
       * is misfire: a tube that strikes on the wrong gas mix goes somewhere unreasonable, and clamping is what makes that
       * legible -- a HARD strike of up to ±3750K drives straight into the 2200K floor or the 9000K ceiling, so it reads as
       * deep amber or cold blue rather than as a slightly different white.
       *
       * Hard strikes are a MINORITY of strikes (a quarter at full CHAOS, none at zero), which is the only thing keeping
       * them drastic. If every strike went to the rail there would be no scale left to be drastic against, and the fixture
       * would read as cycling colours instead of failing.
       */
      // The tube's CONDITION, 0..1. Hoisted because the health sag below leans on it too, on the same terms.
      const h = Math.max(0, Math.min(1, health == null ? 1 : health));
      if (Math.random() < 0.05 + chaos * 0.13) {
        const hard = Math.random() < chaos * 0.25;
        /* HEALTH BIASES THE DIRECTION; IT DOES NOT DECIDE IT. A tube going down loses mercury and its phosphor ages, so it
         * strikes warm more often than cold -- but a healthy tube striking warm is an ordinary misfire, not an impossibility,
         * and a dying one can still flash cold on re-ignition before the coating catches up.
         *
         * So the odds run 0.5 at full health to 0.9 at none: even money on a good tube, strongly warm on a dead one, and
         * NEVER 0 or 1 at either end. The magnitude is untouched by health -- hard strikes reach the 2200K floor and the
         * 9000K ceiling at any condition -- so every colour stays reachable from every state, which is what keeps the
         * bias readable as a tendency rather than felt as a rule.
         */
        const pWarm = 0.5 + (1 - h) * 0.4;
        st.warmTarget = (Math.random() < pWarm ? 1 : -1) * (hard ? 1.4 + Math.random() * 1.1 : 0.3 + Math.random() * 1.0);
      }
      // A chance to shift warmth this cycle, scaled by the dip depth; otherwise it cools back toward neutral.
      else if (Math.random() < 0.28) st.warmTarget = (1 - st.dip) * (0.55 + Math.random() * 0.85);
      else st.warmTarget *= 0.5;
      /* A chance to sag this tube's health -- the coating dying back, greying out and dimming; otherwise recovers.
       *
       * HEALTH BIASES HOW OFTEN THE SAG COMES AND HOW LONG IT HOLDS, on exactly the terms the colour strike above
       * uses: it leans the odds, it never decides them, and it is never 0 or 1 at either end. Both constants were
       * flat, and measured that way: across 12 runs of two simulated minutes each, a tube at 30% health sagged
       * 33.9% of the time and one at full health sagged 35.2%. The difference was noise. A dying lamp found a low
       * state no more readily than a new one, which is the opposite of how a lamp dies.
       *
       *   pSag  0.20 on a good tube to 0.55 on a spent one -- a failing lamp reaches for a lower state far more
       *         often, but a healthy one can still misfire.
       *   heal  the fraction of the remaining deficit recovered per cycle, and the reason a sag never LASTED:
       *         a flat 0.5 halves the gap every cycle, so a tube is 87% recovered within three of them. At low
       *         health it claws back 0.18 instead and the dip persists for several cycles before it climbs out.
       *         That is the difference between a tube that blinks and a tube that is going.
       *
       * AT FULL HEALTH BOTH ARE THEIR OLD CONSTANTS EXACTLY, so a healthy tube is unchanged and the h = 1 case
       * stays a control to measure the rest against. */
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

  /* EVERY CSS VARIABLE THE FIXTURE'S FLICKER DRIVES, as a flat map: name -> string value.
   *
   * This is the whole point of the module owning the rate rather than the caller: the two bulbs' cycles, the warmth shift
   * they cause, the health sag, the colour temperature that follows from it, and the seventeen variables that fall out of
   * all that are ONE calculation. Splitting the values from the machine meant the caller had to know which of them were
   * per-tube, which were averaged, and which were residuals -- and get the ratios right by hand.
   *
   * The caller's only job is to write the ones that changed. It receives strings, already rounded, so a plain !== on each
   * entry is an exact "did this need writing" test.
   *
   *   tubeHealth   crt-fixture's, injected: the emission pattern is the fixture's model, not the flicker's
   *   tbloomBase   the halo opacity ignite() settled on, which the live health then scales
   *
   * Structure worth keeping straight: each tube's brightness lands at its OWN multiplier (--lflk1/2), while the shared
   * ambient -- the recess walls, the rail, the spill -- tracks the AVERAGE (--lflk).
   *
   * NOTHING IS EMITTED THAT NOTHING READS, and six entries used to be. --warm1/2, --hmod1/2 and --lflkb1/2 were written
   * every update and read by no element, no stylesheet rule and no other module: grep found the writes here and nowhere
   * else. --lflkb1/2 was the residual m/avg, meant to multiply on top of the shared average so a per-tube surface landed
   * back at m exactly; whatever consumed it was rewired away and the producer stayed.
   *
   * They were not free. A dead property still costs a full repaint of #clRefl when it changes, and warmth and health move
   * on cycle boundaries -- so a warmth shift too small to move the quantised temperature (and therefore too small to move
   * --themit) still dirtied the whole blend group to update three numbers nobody would look at. Deleting them removes a
   * class of repaint that could not, even in principle, change a pixel. What is left is what something resolves.
   *
   * warmA / hmodA are still COMPUTED -- the temperature and health below are derived from them. They are just not shipped.
   */
  function frameVars(now, s, tubeHealth, tbloomBase) {
    /* THE FIXTURE DOES NOT OBEY THE MONITOR'S POWER SWITCH, and it used to.
     *
     * `s.power === 'on'` was in this condition, so switching the CRT off froze both tubes: bulbFlick stopped advancing,
     * mA/mB settled to their rest values, and every variable derived from them (--lflk*, --tout, --tbloomop*) stopped
     * moving. The room lamp visibly changed state because the SCREEN was switched off -- two unrelated appliances wired
     * to one switch.
     *
     * The fixture already has its own controls: LIGHT ON is its switch and FLICKER ON is its fault toggle. Those are the
     * only two things that belong here.
     *
     * The surge stays shared on purpose -- see triggerSurge. A mains fault is upstream of BOTH the fixture and the tube,
     * so it is the one event they are supposed to obey together; that is what makes it read as the room's power failing
     * rather than the lamp's ballast. Sharing an EVENT is not the same as sharing a power switch. */
    const on = s.lightOn && s.flickerOn;
    // HEALTH is passed so the colour strike can lean warm on a dying tube -- see the note in bulbFlick. The SLIDER value is
    // the right signal, not the live sag: the sag is this cycle's weather, health is the tube's condition.
    let mA = bulbFlick(now, 'A', s.lflickA, s.lfstrA, on, s.lfjit || 0, s.lfchaos || 0, s.healthA);
    let mB = bulbFlick(now, 'B', s.lflickB, s.lfstrB, on, s.lfjit || 0, s.lfchaos || 0, s.healthB);
    /* THE SURGE OVERRIDES THE FLICKER RATHER THAN ARGUING WITH IT. A mains fault is upstream of both tubes, so its level
     * MULTIPLIES whatever each bulb happened to be doing and its warmth ADDS to theirs. A dying tube still reads as the
     * sicker of the two right through the event, which keeps the fault a property of the room and the health a property
     * of the fixture. */
    const sg = surgeAt(now);
    if (sg) { mA *= sg.lamp; mB *= sg.lamp; }
    /* QUANTISED AT THE SOURCE, and this is the whole performance fix.
     *
     * Every variable below is read inside #clRefl, which carries a reference filter over a 1561x1103 group. Profiling
     * (707 frames): frames where the diff loop wrote NOTHING ran 16.7ms median; frames where it wrote ran 100.1ms. The
     * filter is not a standing cost -- it is free until something invalidates it. So the only lever that matters is how
     * OFTEN a value changes, not how much work the write itself does (0.1ms of JS either way).
     *
     * At 3 decimals a continuous oscillator produces a new string on essentially every frame. At 2 it repeats for runs of
     * frames, and the diff goes quiet. Rounding mA/mB HERE rather than at each toFixed means --lflk1, --lflk2, --lflk and
     * both --tbloomop* all go quiet on the same frames -- one invalidation instead of five staggered ones -- and the bloom
     * opacities keep their third decimal, which they need because tbloomBase can be small enough that 2dp would band.
     *
     * Two decimals of a brightness multiplier is 1%. Nothing on this screen resolves that.
     *
     * COARSER WAS TRIED AND LOST -- recorded so it is not tried again. The theory was that since this comment says the
     * only lever is how OFTEN a value changes, a coarser grid (1/32, 3.1% a step) would give longer runs of frames
     * where the diff writes nothing. Measured on the Intel UHD 630 at the shipped stress state with both tubes at 0.9:
     * 42.9ms min / 51.7 median before, 49.2 / 56.5 after. Worse, and not marginally.
     *
     * WHAT THAT RULES OUT IS THE INTERESTING PART. If invalidation frequency were what the fixture's 15.7ms is made
     * of, writing a third as often would have shown up. It did not, so on this adapter that cost is STANDING -- the
     * reference filter and the blend are paid whether or not anything changed. The discrete-GPU profiling this comment
     * was written from found the opposite because there the standing cost fits in the frame and only the spikes show.
     * Reducing writes cannot fix a cost that is not caused by writes; removing the filter can. */
    mA = Math.round(mA * 100) / 100;
    mB = Math.round(mB * 100) / 100;
    const avg = Math.round(((mA + mB) / 2) * 100) / 100;
    const A = bulbs.A || {}, B = bulbs.B || {};
    const warmA = (A.warm || 0) + (sg ? sg.warm : 0), warmB = (B.warm || 0) + (sg ? sg.warm : 0);
    const hmodA = A.hmod == null ? 1 : A.hmod, hmodB = B.hmod == null ? 1 : B.hmod;
    // The REAL per-tube health, so the zonal emission pattern (ends / middle / dead coating) actually shifts rather than
    // the tube just dimming. Quantised to 1/40 so tubeHealth's cache stays small -- it is keyed on this value.
    const baseA = s.healthA == null ? 1 : s.healthA, baseB = s.healthB == null ? 1 : s.healthB;
    /* THE SURGE DRIVES HEALTH, NOT JUST BRIGHTNESS, so a starved tube shows its ENDS instead of going evenly black.
     *
     * Multiplying only the flicker multiplier dims the whole tube uniformly -- every zone by the same factor -- so at 20%
     * the fixture was a pair of dark bars with nothing happening in them. That is not how a fluorescent starves: the arc
     * collapses toward the cathodes, so the ends stay lit and orange while the middle dies out, and the ends keep
     * guttering there while the overall level sinks.
     *
     * tubeHealth already draws exactly that pattern -- it is what low HEALTH looks like -- so the surge just has to lower
     * the health it is asked for. Floored at 0.22 rather than following the sag to zero: below that the ends go too, and
     * the ends are the thing worth keeping. Clamped at 1 above, so the flash cannot make a tube healthier than it is.
     */
    const sgH = sg ? Math.max(0.22, Math.min(1, sg.lamp)) : 1;
    const effA = Math.round(Math.max(0, baseA * hmodA * sgH) * 40) / 40;
    const effB = Math.round(Math.max(0, baseB * hmodB * sgH) * 40) / 40;
    // Warmth feeds back as a real colour-temperature drop through the SAME kelvin pipeline the TEMP slider uses, so the
    // tube body, its halo and the walls share one colour model. A cosmetic filter on top would not survive the blend.
    /* CLAMPED AT BOTH ENDS, because warmth can now be negative: a colour strike that raises kelvin has to stop somewhere,
     * and 9000K is already past the coldest daylight tube anyone makes. The 20K quantisation is what keeps tubeHealth's
     * cache small -- it is keyed on this value -- so colour moves in steps while brightness moves continuously. */
    const tempA = Math.round(Math.min(9000, Math.max(2200, s.temp - warmA * 1500)) / 20) * 20;
    const tempB = Math.round(Math.min(9000, Math.max(2200, s.temp - warmB * 1500)) / 20) * 20;
    const kA = effA + '|' + tempA, kB = effB + '|' + tempB;
    if (kA !== thMemo.ka) { thMemo.ka = kA; thMemo.va = tubeHealth(Object.assign({}, s, { temp: tempA }), effA); }
    if (kB !== thMemo.kb) { thMemo.kb = kB; thMemo.vb = tubeHealth(Object.assign({}, s, { temp: tempB }), effB); }
    const thA = thMemo.va, thB = thMemo.vb;
    /* THE LAMP COLOUR IS NOT A PER-FRAME QUANTITY, and it was being recomputed and re-serialised as though it were.
     *
     * kelvinRgb + mix ran every frame and produced STRINGS, so any wobble in the averaged temperature emitted a new one --
     * 33 writes each per 20s in profiling, every one of them invalidating the filtered group for a colour shift no eye can
     * resolve. tempA/tempB are already quantised to 20K for tubeHealth's cache, but their AVERAGE lands on 10K steps and
     * moves whenever either tube's warmth does.
     *
     * Quantising the average to 50K and memoising on it collapses that to a write only when the light's colour genuinely
     * changes. 50K at 3000K is under a percent -- far below the just-noticeable difference for a large dim surface. */
    const tempAvg = Math.round(((tempA + tempB) / 2) / 50) * 50;
    if (thMemo.ktemp !== tempAvg) {
      thMemo.ktemp = tempAvg;
      thMemo.lcol = kelvinRgb(tempAvg);
      thMemo.diffcol = mix([255, 255, 255], thMemo.lcol.split(',').map(Number), 0.8).join(',');
    }
    const tb = tbloomBase || 0;
    return {
      /* WHAT THE TUBES ARE ACTUALLY PUTTING OUT, as one number, so the light in the ROOM can be scaled by the state of the
       * things emitting it. --lflk only carries the flicker multiplier, which is 1 whenever the fixture is steady -- so a
       * pair of tubes at 10% health threw exactly as much light on the wall as a new pair, and only the tubes themselves
       * looked tired. The bezel already reasons this way (its lit edge takes a contribution from the lamp AND one from the
       * tube face); this is the same argument applied to the spill.
       *
       * The average of the two effective healths, which already fold in the live sag as well as the HEALTH sliders -- so it
       * moves when a tube's coating dies back mid-burst, not just when a slider does. Averaged rather than per-tube because
       * a single pool of light cannot be two brightnesses; the tube bodies and their halos carry that difference.
       */
      /* THE SCREEN'S SHARE OF THE FAULT. Written every frame of an event and settling back to exactly '1', so the diff
       * stops writing it the moment the event ends and the picture returns to whatever BRIGHTNESS says. */
      '--surge': sg ? sg.screen.toFixed(3) : '1',
      '--tout': ((effA + effB) / 2).toFixed(3),
      '--lflk1': mA.toFixed(3),
      '--lflk2': mB.toFixed(3),
      '--lflk': avg.toFixed(3),
      '--themit1': thA.themit,
      '--tchar1': thA.tchar,
      '--themit2': thB.themit,
      '--tchar2': thB.tchar,
      /* THE HALO FLICKERS WITH ITS OWN TUBE. This was built from health and the emission alpha only -- no mA, no mB, no
       * surge -- so the glow around each tube sat at a constant opacity while the tube inside it guttered, and during a
       * surge it simply went dark and stayed dark. A halo is light leaving the tube: if the tube's output moves, its halo
       * moves with it, and a still glow around a flickering source is the giveaway that they are two unrelated layers.
       *
       * Clamped at 1.35 rather than left open, because mA carries re-strike overshoots above 1 and an opacity that runs
       * past full just clips -- the clamp keeps the overshoot readable as a brighter bloom instead of a silent ceiling. */
      '--tbloomop1': (tb * (0.12 + 0.88 * effA) * parseFloat(thA.eg) * Math.min(1.35, Math.max(0, mA))).toFixed(3),
      '--tbloomop2': (tb * (0.12 + 0.88 * effB) * parseFloat(thB.eg) * Math.min(1.35, Math.max(0, mB))).toFixed(3),
      // The shared light colour is the average of the two warm-shifted temps, through the same pipeline again.
      '--lcol': thMemo.lcol,
      /* THE DIFFUSER'S COLOUR MOVED HERE FROM crt-vars, because it has to follow the flicker like everything else the light
       * touches. crt-vars runs per RENDER; this runs per FRAME. Built there from the nominal s.temp, the frost panel held the
       * slider's temperature while --lcol warmed and cooled around it every cycle -- and at high FROST that panel is the
       * largest lit surface in the fixture, so the one thing you look at most was the one thing not participating.
       *
       * Same 80% mix toward the lamp colour it always used, and the same averaged temp --lcol uses, so the panel and the
       * light behind it can no longer disagree about what colour the tubes are. */
      '--diffcol': thMemo.diffcol,
    };
  }

  /* surgeAt IS PUBLISHED, and frameVars is the reason it has to be.
   *
   * The fault's three numbers were reachable only by calling frameVars, which is a DOM-shaped answer: it builds CSS
   * variable strings, runs tubeHealth twice and serialises kelvin colours. A consumer that does not write CSS variables
   * -- the GL build hands these to uniforms -- had no way to read the event at all, and the alternative was a second
   * copy of the timeline, which is exactly the two-descriptions-of-one-thing failure this directory exists to prevent.
   *
   * Same reasoning as bulbState: the machine's state is the caller's to read, and how it is SPENT is the caller's to
   * decide. frameVars is one such caller and is unchanged. SURGE_MS goes with it so a caller can show progress
   * without knowing the phase table.
   *
   * PURE, unlike the version frameVars calls into: sampling past the end must not end the run. surgeAt clears surgeT0
   * when it reads past SURGE_MS, so a caller probing the future would cancel a live fault -- see peekSurge. */
  const running = (now) => surgeT0 != null && now - surgeT0 >= 0 && now - surgeT0 <= SURGE_MS;
  const peekSurge = (now) => (running(now) ? surgeAt(now) : null);
  return { screenFlicker, bulbFlick, bulbState, frameVars, triggerSurge,
           surgeAt: peekSurge, surgeMs: () => SURGE_MS,
           // How far into the fault we are, 0..1, or null when none is running -- for a readout.
           surgeProgress: (now) => (running(now) ? (now - surgeT0) / SURGE_MS : null) };
}
