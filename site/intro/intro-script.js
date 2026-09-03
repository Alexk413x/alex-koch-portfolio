/* intro-script.js — the intro, as a table of beats.
 *
 * Pure data plus small functions of `ctx`, the handles the director hands in. Nothing here touches the DOM or
 * owns a clock: a beat says what to do on entry, what to do per frame at `t` seconds in, and when it is over.
 * Every length that decides the cut is a number in this file.
 *
 * A beat: { id, scene, enter(ctx), tick(ctx, t), done(ctx, t) -> boolean, max, exit(ctx) }
 *   `done` is polled per frame; `max` is the longest it may wait, in seconds, after which it ends anyway.
 *   `scene` names which handle has to exist for the beat to run, and is where `?from=` can start.
 */
import { PRESETS } from '../../labs/reactor/reactor-presets.js';

// Lengths, in seconds. The cut is here.
export const LENGTH = {
  autoAdvance: 20,  // idle at the prompt before it advances by itself
  surge: 2.9,       // the fault's flash peaks at 2.7 to 2.83s; the light dies on it and the power is cut on its end
  off: 0.85,        // the collapse, at the tube's own pace; the tunnel is already opening under it
  open: 4.7,        // wormhole-moves' OPEN_SEC: the depth brings the hole in, a slow tilt, the walls come up and it backs off
  cruise: 5.5,      // the flight, bend at full swing; elastic, holds until the ring's program has linked
  run: 3.6,         // wormhole-moves' RUN_SEC: straighten, then the tube's end comes up to the eye
  cross: 1.0,       // the tunnel fades over the reactor once its end is reached, the core coming in after
  stage: 4.0,       // each of the three states: STABLE, CRITICAL, MELTDOWN
  meltdown: 2.2,    // the last stage runs short: the vent fires at once and its boom is at 2.0s
  toStage: 1.4,     // how long a state takes to become the next
  break: 1.0,       // the ring flies apart, the camera pulling back to keep the pieces in frame
  stabilize: 1.0,   // red to the hero's orange, STABLE motion, ring off, the camera home; 2.0s from the boom
};

// Cheap smoothstep, the same curve wormhole-moves uses for a beat.
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v) => { const x = clamp01(v); return x * x * (3 - 2 * x); };
const seg = (t, a, b) => ease((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;

// Mixes two hex colors in sRGB. Both ends are shader inputs, so the space they mix in is the shader's own.
export function mixHex(a, b, k) {
  const A = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const B = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * clamp01(k)).toString(16).padStart(2, '0')).join('');
}

/* THE THREE STATES ARE THE LAB'S OWN PRESETS, tweened key by key: what the reactor does at each stage of
 * criticality is the instrument's description of it, not this file's. The camera keys are left out -- the
 * intro drives the camera itself -- and so is the pose, which the hero owns. */
const STAGE_KEYS = ['size', 'visc', 'turb', 'rate', 'amp', 'glow', 'orbit', 'orbitX', 'orbitZ',
                    'wobbleX', 'wobSpdX', 'wobbleZ', 'wobSpdZ', 'ringLight', 'ringGlow',
                    'coreSpin', 'coreSpinX', 'pulseAmp', 'pulseBright', 'pulseDur', 'ventSize', 'ventBright', 'ventDur'];
const [STABLE, CRITICAL, MELTDOWN] = PRESETS;

// A partial state `k` of the way from `from` to `to`, over the stage keys and the color.
function blend(from, to, k) {
  const o = {};
  for (const key of STAGE_KEYS) o[key] = lerp(from[key], to[key], k);
  o.coreHex = mixHex(from.coreHex, to.coreHex, k);
  return o;
}

// The reactor as it first appears under the tunnel: STABLE, the ring lit, close.
const REACTOR_ON = {
  renderScale: 0.7, dropN: 6,
  ringOn: 1, ringBreak: 0, breakSpd: 0, scatSec: 6,
  // Kept under 1 so the vent's swell never breaks the ring by itself; the script does.
  subVT: 1, ventVT: 1, ventSwellPct: 0.75, pulseSize: 0.3,
  ...Object.fromEntries(STAGE_KEYS.map((k) => [k, STABLE[k]])),
  coreHex: STABLE.coreHex,
  ringLight: 1.0, ringGlow: 0.5,
};

// The camera through the reactor leg. Close is inside the core, its surface past every edge of the frame, so
// the tunnel's hole opens onto it rather than fading onto a shape. From there ONE curve runs across all three
// stages, its clock starting as the tunnel begins to fade so the camera is already leaving the core under it.
const ZOOM = { close: 9, home: 1.0, broken: 0.72 };
const CAM_TAU = 0.45;    // seconds; the pull-out's time constant. Small leaves the core faster.
// Exponential out of the core, then blended onto home over the leg's last third so it lands exactly.
const camAt = (sec) => {
  const T = LENGTH.cross + 2 * LENGTH.stage + LENGTH.meltdown;
  const z = ZOOM.home + (ZOOM.close - ZOOM.home) * Math.exp(-sec / CAM_TAU);
  return lerp(z, ZOOM.home, seg(sec, T * 0.66, T));
};

/* THE RING'S SPEED AND THE COLOR LEAD THE STATE. A stage holds at its preset through its first half, then
   these keys move toward the NEXT preset over the second half, so the next stage begins with its ring already
   at speed and its color already there and only the core's motion has to change. Tweening everything at the
   stage boundary read as a cut with a slow fade after it. */
const LEAD_KEYS = ['orbit', 'orbitX', 'orbitZ'];

// A stage beat: becomes `preset` over LENGTH.toStage, pulses when told, carries the camera's curve at its
// place in the leg, `n` stages in, and, given `next`, leads the ring and the color into it.
function stage(id, preset, n, pulses, extra, len = LENGTH.stage, next = null) {
  let from = null;
  return {
    id, scene: 'hero',
    enter: (c) => { from = c.hero.snapshot(STAGE_KEYS.concat(['coreHex'])); },
    tick: (c, t) => {
      const k = seg(t, 0, LENGTH.toStage);
      const state = blend(from, preset, k);
      const lead = next ? seg(t, len / 2, len) : 0;
      if (lead > 0) {
        for (const key of LEAD_KEYS) state[key] = lerp(preset[key], next[key], lead);
        state.coreHex = mixHex(preset.coreHex, next.coreHex, lead);
      }
      c.hero.set(state);
      c.hero.set({ zoom: camAt(LENGTH.cross + n * LENGTH.stage + t) });
      for (const [at, amp] of pulses) if (c.once(id + at, t >= at)) c.hero.pulse(amp);
      if (extra) extra(c, t);
    },
    done: (c, t) => t >= len,
  };
}

export const SCRIPTS = {
  v1: [
    { id: 'boot', scene: 'crt',
      enter: (c) => { c.crt.mount(); },
      done: (c) => c.crt.ready(), max: 40,
      exit: (c) => { c.crt.show(); c.crt.powerOn(); } },

    { id: 'strike', scene: 'crt',
      // The fitting strikes with the tube: dark, then flickering hard as it comes up to the preset's level over a
      // second, the flicker settling as it gets there.
      enter: (c) => { c.crt.light(true); },
      tick: (c, t) => {
        const k = seg(t, 0, 1.0);
        c.crt.set({ lightA: 0.8 * (0.15 + 0.85 * k), lightB: 0.8 * (0.15 + 0.85 * k),
                    lflickA: 30 - 19 * k, lflickB: 26 - 19 * k,
                    lfstrA: 1.0 - 0.25 * k, lfstrB: 1.0 - 0.1 * k });
      },
      done: (c, t) => t >= 1.0 },

    { id: 'type', scene: 'crt',
      // The tunnel's shader links in the background while the tube types.
      enter: (c) => { c.worm.mount(); },
      done: (c) => c.crt.typedDone(), max: 24 },

    { id: 'prompt', scene: 'crt',
      // And the ring's program, once the type is up: three links at once would starve the one on screen. At
      // the ring's cheaper scale from here, so the covered frames cost what the visible ones will.
      enter: (c) => { c.hero.take(); c.hero.set({ ringOn: 1, renderScale: REACTOR_ON.renderScale, dropN: REACTOR_ON.dropN });
                      c.hero.refit(); c.input.arm(); },
      done: (c) => c.input.advanced, max: LENGTH.autoAdvance,
      // Answered or timed out, the sequence is the reader's now and the skip control leaves.
      exit: (c) => { c.going(); } },

    { id: 'surge', scene: 'crt',
      enter: (c) => { c.crt.surge(); c.crt.warp(); },
      // The whole tube builds over the last two seconds: the phosphors brighter, the wash and the glow coming up
      // across the face, the fitting glaring on the glass; then it all drops just before the cut.
      tick: (c, t) => {
        const k = seg(t, LENGTH.surge - 2.2, LENGTH.surge - 0.15);
        const drop = 1 - 0.45 * seg(t, LENGTH.surge - 0.15, LENGTH.surge);
        c.crt.set({ bright: (0.7 + 1.5 * k) * drop, glare: 1.2 * k * drop,
                    phos: (0.07 + 0.55 * k) * drop, glow: (1 + 2.5 * k) * drop });
      },
      done: (c, t) => t >= LENGTH.surge },

    { id: 'off', scene: 'crt',
      // The tunnel opens under the tube as it collapses. The tube fades as its picture closes to a line, so the
      // line it leaves is the disc's edge coming up under it.
      // The room's light goes out with the power, so the collapse is the only thing moving.
      enter: (c) => { c.crt.set({ bright: 0.7, glare: 0, phos: 0.07, glow: 1 }); c.crt.light(false); c.crt.powerOff(); c.worm.show(); c.worm.open(); c.hero.stop(); },
      tick: (c, t) => { if (c.once('crtfade', t >= 0.55)) c.crt.drop(0.3); },
      done: (c, t) => t >= LENGTH.off },

    { id: 'open', scene: 'worm',
      done: (c, t) => t >= LENGTH.open - LENGTH.off },

    { id: 'cruise', scene: 'worm',
      // Elastic: holds until the ring's program has linked, so the core can arrive with its ring.
      // The lab's own burst, once, as the push that carries the flight.
      tick: (c, t) => {
        if (c.once('burst1', t >= 1.6)) c.worm.burst();
      },
      done: (c, t) => t >= LENGTH.cruise && c.hero.full(), max: 45 },

    { id: 'run', scene: 'worm',
      // The hero comes back under the tunnel, close on its ring, so the hole's ring hands to it.
      enter: (c) => { c.worm.run(); c.hero.start(); c.hero.set({ ...REACTOR_ON, zoom: ZOOM.close }); c.hero.refit(); },
      tick: (c, t) => {
        if (c.once('cross', t >= LENGTH.run - LENGTH.cross)) { c.clear(); c.worm.drop(LENGTH.cross); }
        if (t >= LENGTH.run - LENGTH.cross) c.hero.set({ zoom: camAt(t - (LENGTH.run - LENGTH.cross)) });
      },
      done: (c, t) => t >= LENGTH.run },

    stage('stable', STABLE, 0, [[0.6, 8], [2.4, 12]], null, LENGTH.stage, CRITICAL),
    stage('critical', CRITICAL, 1, [[1.6, 15], [3.4, 15]], null, LENGTH.stage, MELTDOWN),
    // The vent fires at once, held at a shorter DURATION than MELTDOWN's so the boom lands at 2.0s. Its two
    // building pulses each stretch the ring further, with a hard core pulse on each so they read as the
    // explosions; the boom is the shatter. The stretch stays near half because the sim scatters on ring stress,
    // not only on the break.
    stage('meltdown', MELTDOWN, 2, [[0.1, 12], [0.75, 14], [2.0, 26]],
          (c, t) => {
            c.hero.set({ ventDur: 3.2 });
            if (c.once('vent', t >= 0.1)) c.hero.vent();
            const stretch = 0.25 * seg(t, 0.1, 0.6) + 0.18 * seg(t, 0.75, 1.4) + 0.10 * seg(t, 1.5, 1.95);
            c.hero.set({ ringBreak: t < 2.0 ? stretch : 1 });
            if (c.once('shatter', t >= 2.0)) c.hero.set({ breakSpd: 1 });
          }, LENGTH.meltdown),

    { id: 'break', scene: 'hero',
      // The break has already happened, on the vent's boom in the meltdown. This beat is the camera pulling
      // back with the pieces so they are seen to go, not lost at the edge of the frame.
      tick: (c, t) => { c.hero.set({ zoom: lerp(ZOOM.home, ZOOM.broken, seg(t, 0.2, LENGTH.break)) }); },
      done: (c, t) => t >= LENGTH.break },

    { id: 'stabilize', scene: 'hero',
      enter: (c) => { c.from = c.hero.snapshot(STAGE_KEYS.concat(['coreHex', 'zoom'])); },
      tick: (c, t) => {
        const L = LENGTH.stabilize;
        // Fast out of the broken state, easing into the hero's own, with no hold at the start.
        const k = 1 - Math.pow(1 - clamp01(t / L), 3);
        const r = c.hero.rest();
        // STABLE motion, the hero's own idle rates, and the hero's color: what a returning visitor sees.
        const to = { ...STABLE, coreSpin: r.SPIN_IDLE, coreSpinX: r.TILT_IDLE, visc: r.VISC_REST,
                     ringLight: 0, ringGlow: 0, coreHex: c.hero.heroHex() };
        const st = blend(c.from, to, k);
        // THE VENT KEYS HOLD. The sim maps the vent's clock onto its phases by DURATION, so tweening ventDur
        // from the meltdown's 3.2 toward STABLE's 6 while the vent was still fading put its clock back in the
        // boom: a second explosion, a beat after the ring broke. They take STABLE's values with the ring-off.
        st.ventDur = c.from.ventDur; st.ventSize = c.from.ventSize; st.ventBright = c.from.ventBright;
        c.hero.set(st);
        // The page's camera, scaled by the box the intro gave the canvas over the box the page gives it.
        c.hero.set({ zoom: lerp(c.from.zoom, c.hero.cssZoom() * c.hero.homeSize() / c.hero.boxSize(), k) });
        // The program drop and the refit are left to the last frame, where the picture is already the hero's,
        // so the resample is not seen mid-settle.
        if (c.once('ringoff', t >= L - 0.02)) {
          c.hero.set({ ringOn: 0, ringBreak: 0, breakSpd: 0, orbit: 0, orbitX: 0, orbitZ: 0,
                       ventDur: STABLE.ventDur, ventSize: STABLE.ventSize, ventBright: STABLE.ventBright,
                       renderScale: 1, dropN: r.dropN });
          c.hero.refit();
        }
      },
      done: (c, t) => t >= LENGTH.stabilize,
      exit: (c) => {
        c.hero.set({ coreHex: c.hero.heroHex(), orbit: 0, orbitX: 0, orbitZ: 0, ...c.hero.restPulse() });
        c.hero.resetZoom();
        c.hero.release();
      } },

    { id: 'reveal', scene: 'hero',
      enter: (c) => { c.reveal(); },
      done: () => true },
  ],
};

/* Preparation for starting part-way in, behind ?from=: what an earlier beat would have set up. Each returns
 * when the scene's handle is ready. */
export const PREP = {
  crt: null,
  worm: { enter: (c) => { c.worm.mount(); c.hero.take(); c.hero.set({ ringOn: 1, renderScale: REACTOR_ON.renderScale }); c.hero.refit(); },
          done: (c) => c.worm.ready(), max: 40,
          exit: (c) => { c.worm.show(); c.worm.open(); c.hero.stop(); } },
  hero: { enter: (c) => { c.hero.take(); c.hero.set({ ringOn: 1, renderScale: REACTOR_ON.renderScale }); c.hero.refit(); },
          done: (c) => c.hero.full(), max: 45,
          exit: (c) => { c.hero.set({ ...REACTOR_ON, zoom: ZOOM.close }); c.clear(); } },
};
