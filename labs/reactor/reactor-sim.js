/* The reaction as a state machine: `step(state, dt, sec)` in, a table of numbers out. No DOM, no GL — the
 * description of what is happening is kept separate from the drawing of it, as labs/crt/ is.
 *
 * A factory, not a singleton: everything here is machine phase, so two reactors on one page must not share spin.
 *
 * Rotations are integrated into a PHASE — `orbit` is rad/s, the shader receives the accumulated angle — so
 * turning a speed down slows the rotation instead of teleporting whatever it was driving.
 *
 * `step` fills and returns the SAME object every frame rather than allocating. Read it and drop it.
 */

// Deterministic per-vent and per-droplet variation: the same seed replays the same event, so one can be measured
// rather than merely watched.
const h = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

// The vent's phase boundaries, in seconds from the trigger. Exported because the HUD prints them: DURATION sets
// the total, and what that buys — two building pulses, a charge, a boom, a fade — is not obvious from the number.
export function ventTimings(vd) {
  const build = vd * 0.55, chold = 0, atk = 0.15;
  const fade = Math.max(0.2, vd - build - chold - atk);
  const hold = Math.min(0.28, fade * 0.18);
  const fadeR = fade - hold;                                  // ends exactly at the stated duration
  const b1s = 0.0, b1e = 0.30 * build, b2s = 0.3636 * build, b2e = 0.7576 * build;
  const boom = build + chold + atk;
  return { build, chold, atk, hold, fadeR, b1s, b1e, b2s, b2e, boom, end: boom + hold + fadeR };
}

/* ONE RPM IN RAD/S, and the only place the two units meet. Rates are stored, shown, stepped and authored in RPM;
 * the phases they feed are radians. Converting here rather than in the panel keeps the UI arithmetic-free. */
const RAD_PER_RPM = Math.PI / 30;

export function createSim() {
  const P = { spin: 0, orbitX: 0, orbitZ: 0, wobX: 0, wobZ: 0, cam: 0, coreY: 0, coreX: 0, rate: 0 };
  let pulse = 0, pulseVel = 0, pulseSeed = 0;
  let venting = false, ventT = 0, ventSeed = 0;
  let vent = 0, ventBurst = 0, ventSwell = 0;
  let inst = 0;
  let breakPrev = false, burstOn = false, burstT = 0;
  let scatArm = false, scatActive = false, scatEl = 0, scatMaxD = 0, scatterT = 0;
  // STARTS SETTLED, NOT AT ZERO. shieldFac ramps the shield back over a second after a break; from 0 the lab would
  // open with no shield at all and grow one, which reads as a bug on first load.
  let shieldT = 5;

  const dropData = new Float32Array(80);          // 20 droplets x vec4(center.xyz, radius)
  const out = {
    inst: 0, pulse: 0, vent: 0, ventBurst: 0, ventSwell: 0,
    visc: 0, turb: 0,
    phSpin: 0, phOrbitX: 0, phOrbitZ: 0, phWobX: 0, phWobZ: 0,
    phCam: 0, phCoreY: 0, phCoreX: 0, phRate: 0,
    wobbleX: 0, wobbleZ: 0,
    ringR: 1, swellRingBase: 1, swellTarget: 1,
    ringGlow: 0, shieldExpand: 0, scatter: 0, breakBurst: 999,
    dropN: 0, dropData,
    ringSpin: 0,
  };

  return {
    get venting() { return venting; },
    get ventT() { return ventT; },

    /* A pulse is an impulse, not a position: FORCE kicks the spring's velocity and DURATION sets its period, so
     * a harder pulse travels further in the same time rather than taking longer. The seed varies the sub-cores'
     * arrangement in step(). */
    firePulse(s) {
      const w = 6.0 / (s.pulseDur || 1);
      pulseVel += s.pulseAmp * w * 0.16;
      pulseSeed = Math.random() * 97.0;
    },
    fireVent() { ventT = 0; venting = true; ventSeed = Math.random() * 97.0; },

    // `sec` is wall-clock elapsed time, separate from dt because the droplets drift on it: deriving it from a
    // phase would freeze them whenever that phase's rate was 0.
    step(s, dt, sec) {
      /* INSTABILITY IS A GAUGE, AND NOTHING ELSE READS IT. It is derived from the settings that would actually
       * destabilize a core — how hard the surface is roiling, how fast the ring is being driven, how far it
       * breathes — and NOT from which preset is lit. A mode is only a set of slider positions.
       *
       * It lags rather than tracking and rises faster than it falls, and it reads the PREVIOUS frame's vent and
       * pulse deliberately: using this frame's would make the ramp depend on statement order. */
      const pf = Math.min(1.3, Math.abs(pulse) * 2.6);
      const instRaw = s.turb * 0.35 + (Math.abs(s.orbitX) + Math.abs(s.orbitZ)) * 0.0065
                    + s.amp * 0.9 + Math.abs(s.visc) * 0.017 + vent * 1.6 + pf * 0.6;
      const k = instRaw > inst ? (venting ? dt * 15 : dt * 3)
                               : dt * (13 - Math.min(1, Math.abs(pulse)) * 10);
      inst += (instRaw - inst) * Math.min(1, k);

      /* EVERY RATE IS EXACTLY ITS CONTROL. Adding an instability term from the mode to each of these would mean
       * ORBIT and WOBBLE at zero still moved the ring and no slider told the truth about what it did. A preset
       * that wants a violent ring says so in its own values. */
      const rad = dt * RAD_PER_RPM;          // RPM -> radians for this frame
      P.spin   += s.orbit * rad;             // about the ring's own axis: moves the surface pattern, nothing else
      P.orbitX += s.orbitX * rad;            // tumble about world X
      P.orbitZ += s.orbitZ * rad;            // tumble about world Z
      P.cam    += s.cam * rad;
      P.coreY  += s.coreSpin * rad;
      P.coreX  += s.coreSpinX * rad;
      P.wobX   += s.wobSpdX * dt;            // wobble speeds are the instrument's own unit, not RPM
      P.wobZ   += s.wobSpdZ * dt;
      P.rate   += s.rate * dt;

      // A DAMPED SPRING, integrated explicitly. DURATION is the period, so w is inversely proportional to it.
      const w = 6.0 / (s.pulseDur || 1);
      pulseVel += (-w * w * pulse - 2.0 * w * 0.55 * pulseVel) * dt;
      pulse += pulseVel * dt;

      /* A scripted event rather than a decay: two building bumps, a charge, an exponential boom, a hold and a
       * long fade, scaled to fit DURATION exactly. Three envelopes, because brightness, the burst's reach and the
       * core's swell do not share a shape. */
      if (venting) {
        ventT += dt;
        const vd = s.ventDur || 3, t = ventT, r = ventSeed;
        const T = ventTimings(vd);
        const a1 = 0.24 + 0.12 * h(1, r);                       // per-vent variance in the two building bumps
        const a2 = 0.38 + 0.12 * h(2, r);
        const ease = (x) => 1 - x * x * (3 - 2 * x);
        const ei = (x) => (Math.exp(4.5 * x) - 1) / (Math.exp(4.5) - 1);   // slow start, ramps hard: shoots out
        const hump = (x, pk) => x < pk ? Math.sin((x / pk) * Math.PI * 0.5)
                                       : Math.cos(((x - pk) / (1 - pk)) * Math.PI * 0.5);
        let v = 0, vb = 0, sw = 0;
        if (t < T.b1s) v = 0;
        else if (t < T.b1e) v = a1 * hump((t - T.b1s) / (T.b1e - T.b1s), 0.4);
        else if (t < T.b2s) v = 0;
        else if (t < T.b2e) v = a2 * hump((t - T.b2s) / (T.b2e - T.b2s), 0.4);
        else if (t < T.build) { const x = (t - T.b2e) / (T.build - T.b2e); v = 0.1 + 0.9 * x * x; vb = 0; sw = 0.85 * (x * x * (3 - 2 * x)); }
        else if (t < T.boom) { const x = (t - T.build - T.chold) / T.atk; v = 1; vb = ei(x); sw = 0.85 + 0.15 * x; }
        else if (t < T.boom + T.hold) { v = 1; vb = 1; sw = 1; }
        else if (t < T.boom + T.hold + T.fadeR) { const x = (t - T.boom - T.hold) / T.fadeR; v = ease(x); vb = ease(x); sw = ease(x); }
        else { v = 0; vb = 0; sw = 0; venting = false; }
        vent = Math.max(0, v);
        ventBurst = Math.max(0, vb);
        ventSwell = Math.max(0, v);      // core size tracks BRIGHTNESS, so it bumps with each building pulse
      } else { vent = 0; ventBurst = 0; ventSwell = 0; }

      // The surface roils harder during a pulse and much harder during a vent. Two multipliers so the sub-cores
      // and the vent can be dialed independently of the base setting.
      const subVT = s.subVT != null ? s.subVT : 1, ventVT = s.ventVT != null ? s.ventVT : 1;
      out.visc = s.visc + vent * 6.0 * ventVT + Math.abs(pulse) * 1.6 * subVT;
      out.turb = Math.max(0, Math.min(1.4, s.turb + Math.abs(pulse) * 0.2 * subVT + vent * 0.35 * ventVT));

      /* The core's live radius is recomputed here exactly as the shader's coreRadius() computes it, because
       * whether the core has pushed PAST the ring decides what happens next and the CPU cannot ask the GPU without
       * a readback stall. A change to coreRadius() needs a matching change here.
       *
       * Swelling past 100% breaks the ring on its own; past 200% it also flies apart. */
      const breatheJS = s.amp * (0.5 - 0.5 * Math.cos(P.rate));
      const baseR = Math.max(s.size + breatheJS + pulse * s.pulseSize, 0);
      const pct = s.ventSwellPct != null ? s.ventSwellPct : 0.9;
      const delta = pct >= 0 ? pct * (Math.max(s.ringR, baseR) - baseR) : pct * baseR;
      const coreR = Math.max(baseR + ventSwell * delta, 0);
      const over = Math.max(0, coreR + 0.06 - s.ringR);
      const swLive = Math.max(ventSwell * (s.ventSwellPct || 0), Math.abs(pulse) * (s.pulseSize || 0));
      const autoBreak = swLive > 1.0 ? Math.min(1, (swLive - 1.0) + 0.1) : 0;
      const autoSpd = swLive >= 2.0 ? 1.0 : 0;
      const effBreak = Math.max(s.ringBreak || 0, autoBreak);
      const effSpd = Math.max(s.breakSpd || 0, autoSpd);

      if (!breakPrev && effBreak >= 0.999) { burstT = 0; burstOn = true; }   // shockwaves fire on the edge, once
      breakPrev = effBreak >= 0.999;

      const breakExpand = effBreak * s.ringR * 0.9;
      const expand = over + breakExpand;
      out.ringR = s.ringR + expand;                 // the ring EXPANDS; fixed-length fragments open the gaps
      out.swellRingBase = s.ringR;
      out.swellTarget = s.ringR + breakExpand;
      const stress = expand / (s.ringR * 0.7);      // 1.0 is the failure point

      /* SHIELD IS THE SLIDER, in every mode. What still moves it is not the mode but what is happening TO it: a
       * pulse knocks it down, the core pushing against the ring stresses it, a vent floods it. */
      const shPulse = Math.min(1, Math.abs(pulse) * 2.4);
      const shStress = 1 - Math.min(0.6, stress * 0.45);
      let shieldLvl = (s.ringGlow || 0) * (1 - Math.min(0.5, shPulse * 0.5));
      shieldLvl *= shStress;
      shieldLvl += vent * 1.15;

      // ARMED WHEN INTACT, so one break is one event. Without the re-arm a held BREAK at 100% would re-trigger the
      // fly-apart every frame and the pieces would never get home.
      if ((effBreak < 0.999 || effSpd <= 0.001) && stress < 1.0) scatArm = true;
      if (scatArm && ((effBreak >= 0.999 && effSpd > 0.001) || stress >= 1.0) && !scatActive) {
        scatActive = true; scatEl = 0; scatArm = false; burstT = 0; burstOn = true;
        scatMaxD = 4.5 + Math.max(effSpd, 1.0) * 3.5;
      }
      let dist = 0;
      if (scatActive) {
        scatEl += dt;
        const outT = 3.0, holdT = 13.0, home = 16.0, maxD = scatMaxD || 3.0;
        if (scatEl < outT) dist = maxD * (scatEl / outT);                       // fly apart
        else if (scatEl < holdT) dist = maxD;                                   // sit broken
        else dist = maxD * (1 - (scatEl - holdT) / (home - holdT));             // return
        if (scatEl >= home) { scatActive = false; dist = 0; }
      }
      scatterT = dist;

      // THE SHIELD IS GONE FOR THE WHOLE BREAK and grows back over a second once the ring is whole.
      if (scatActive || scatterT > 0.001) shieldT = 0; else shieldT += dt;
      const shieldFac = Math.min(1, shieldT / 1.0);

      if (burstOn) { burstT += dt; if (burstT > 0.25) burstOn = false; }

      out.inst = inst;
      out.pulse = pulse; out.vent = vent; out.ventBurst = ventBurst; out.ventSwell = ventSwell;
      out.phSpin = P.spin; out.phOrbitX = P.orbitX; out.phOrbitZ = P.orbitZ;
      out.phWobX = P.wobX; out.phWobZ = P.wobZ; out.phCam = P.cam;
      out.phCoreY = P.coreY; out.phCoreX = P.coreX; out.phRate = P.rate;
      out.wobbleX = s.wobbleX; out.wobbleZ = s.wobbleZ;
      out.ringGlow = Math.max(0, Math.min(1.6, shieldLvl)) * shieldFac;
      out.shieldExpand = scatterT * 1.3;
      out.scatter = scatterT;
      out.breakBurst = burstOn ? burstT : 999;
      out.ringSpin = s.orbit;    // already RPM — the HUD prints it as stored

      /* A Fibonacci sphere pushed outward by the pulse, jittered per index and drifting on its own sines.
       * Computed here rather than in the shader because the inner loop would otherwise hash and call trig twenty
       * times per march step, seventy steps deep, plus four more per normal. dropN is 0 at rest so the caller
       * uploads nothing. */
      if (pulse > 0.002) {
        const N = s.dropN | 0, sd = pulseSeed, dsz = s.dropSize != null ? s.dropSize : 1;
        const pdc = Math.max(0, Math.min(2.5, pulse));
        const R = baseR;
        const fft = Math.max(0, Math.min(1, (s.pulseAmp - 10) / 11)), ff = fft * fft * (3 - 2 * fft);
        const ss = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
        const tm = sec;
        for (let i = 0; i < N; i++) {
          let gy = 1 - 2 * (i + 0.5) / N;
          gy += (h(i, 3.3 + sd) - 0.5) * 0.25;
          gy = Math.max(-0.98, Math.min(0.98, gy));
          const gr = Math.sqrt(Math.max(0, 1 - gy * gy)), gth = 2.399963 * i + sd * 6.2831;
          const sp = 0.8 + 0.4 * h(i, 5.5 + sd), reach = R * 0.6 + pdc * sp * R * (0.45 + ff * ff * 0.34);
          let cx = Math.cos(gth) * gr * reach + Math.sin(tm * 2.4 + i) * 0.03 * R * pdc;
          let cy = gy * reach + Math.cos(tm * 2.1 + i * 1.7) * 0.03 * R * pdc;
          const cz = Math.sin(gth) * gr * reach + Math.sin(tm * 1.8 + i) * 0.03 * R * pdc;
          if (s.shape > 3.5) cy *= 0.12;                       // the disk has no room for droplets off its plane
          /* SUB-CORE SIZE scales the radius and nothing else, which is what makes it worth its own control: how
           * far a droplet travels is FORCE's job, and the two together decide whether it pinches off or stays
           * bridged. Smaller sub-cores at the same force separate; larger ones at the same force stretch. */
          const grow = 1 + h(i, 9.1) * pdc * 0.9;
          const rr = R * (0.15 + 0.15 * h(i, 2.2)) * ss(0, 0.25, pdc) * grow * dsz;
          dropData[i * 4] = cx; dropData[i * 4 + 1] = cy; dropData[i * 4 + 2] = cz; dropData[i * 4 + 3] = rr;
        }
        out.dropN = N;
      } else {
        out.dropN = 0;
      }

      return out;
    },
  };
}
