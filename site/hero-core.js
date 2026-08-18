/* hero-core.js — the reactor lab's core, alone, behind scene 01.
 *
 * It IS the lab's core, at the lab's own STABLE settings: the same shader, the same simulation, the same state.
 * Changed and no more: the ring assembly is off, the colour comes from --accent, the render scale is its own,
 * and the pulse runs at FORCE 13 with SUB VIS/TRB 0.
 *
 * The pointer does exactly two things, and both are read off its POSITION. The face turns to where it is, and
 * how near it is drives VISCOSITY, which is what makes the surface roil. A click fires the lab's pulse. Nothing
 * else on this canvas reacts to anything.
 */
import { createQuad } from '../labs/kit/glquad.js';
import { runLoop, fitCanvas } from '../labs/kit/lab.js';
import { FRAG, UNIFORMS } from '../labs/reactor/reactor-shader.js';
import { defaultPreset } from '../labs/reactor/reactor-presets.js';
import { createSim } from '../labs/reactor/reactor-sim.js';
import { sendUniforms } from '../labs/reactor/reactor-uniforms.js';

/* Viscosity's two ends: the lab's STABLE at rest, its MELTDOWN at full tilt. The top is reached by SPEED — a
 * pointer thrown across the core takes it all the way — with nearness able to hold it partway up on its own.
 * Nothing else is ramped: a hero with six values chasing the mouse reads as noise, not as a reaction. */
const VISC_REST = 1.8, VISC_LIVE = 5.0;

/* The pulse values this scene does not take from the lab. subVT 0 keeps the pulse OUT of viscosity and
   turbulence: the surface's roil is the pointer's distance and nothing else, so a click near the core does not
   stack on top of it. SUB-CORE SURFACE stays the lab's, which is what keeps the sub-cores lumpy at subVT 0. */
const PULSE = { pulseAmp: 13, subVT: 0 };

const REACH = 0.7;         // how near counts as near, as a fraction of the smaller viewport axis
const FOLLOW = 3.5;        // how fast the nearness reading chases the pointer, per second

/* THE CORE FACES THE POINTER. Its angle is the pointer's POSITION, not its speed: the face turns to where the
 * cursor is and stays there. Driving it off speed instead meant differentiating a bursty event stream and then
 * smoothing the result twice, and it read as janky however the smoothing was tuned — the core moved at a
 * different time from the hand.
 * Radians at the edge of REACH, past which it is pinned. Y is the wider swing because horizontal movement is
 * what a reader does most and the core has more to show around that axis. */
const AIM_Y = 0.95, AIM_X = 0.55;
const AIM_FOLLOW = 5.0;    // how fast the face chases that angle, per second

// A slow drift under it all, so a core nobody is pointing at is not a still image.
const SPIN_IDLE = 3, TILT_IDLE = 1;        // RPM

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
const ease = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };

/* The linear red a lit surface on this core reaches, measured off the rendered frame: the brightest decile came
 * back at 154/255, which is this value through the tone map. It is the operating point the colour below is
 * solved at, and it is a property of the lab's GLOW — re-measure if that setting ever moves. */
const OPERATING = 1.05;

const toneMap = (x) => Math.pow(x / (x + 0.85), 0.85);
const unTone = (v) => { const y = Math.pow(clamp01(v), 1 / 0.85); return 0.85 * y / Math.max(1e-4, 1 - y); };

/* The colour the SHADER must be given for the core to RENDER as `hex`.
 *
 * The last two lines of the shader are a tone map, (x/(x+0.85))^0.85 per channel, and that curve compresses a
 * warm hue's red long before its green — hand it the accent and every lit surface comes back yellow. So each
 * channel is solved backwards through the curve to sit in the ACCENT'S OWN PROPORTIONS once rendered.
 *
 * Solved at the intensity the surface reaches rather than at the top of the curve, and that distinction is the
 * whole of it: inverted as if the core were fully lit, the correction is far too strong and the ember comes out
 * blood red. What is matched is the accent's hue and saturation, at the brightness the core actually has. */
function preTonemap(hex) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const red = toneMap(OPERATING);
  return '#' + ch.map((c) => {
    const want = unTone(red * (c / ch[0])) / OPERATING;
    return Math.round(clamp01(want) * 255).toString(16).padStart(2, '0');
  }).join('');
}

init();

function init() {
  const canvas = document.getElementById('hero-core');
  const stage = document.getElementById('stage');
  if (!canvas || !stage) return;

  // Without WebGL the element simply stays empty. A hero is not worth an error message.
  const R = createQuad(canvas, {
    frag: FRAG, uniforms: UNIFORMS, onRestore: () => fit(true),
  });
  if (!R) return;

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#dd6a20';

  /* THE LAB'S STABLE PRESET, and then two changes. defaultPreset carries it whole, so this scene cannot drift
   * away from the instrument it came from without someone editing the instrument. */
  const state = {
    ...defaultPreset(R.gpu),
    // The whole ring assembly is off: no fragments, no shield, no lamps. ringR keeps the preset's value — the sim
    // measures the core's swell against it, and at 0 the core reads as permanently burst through the ring.
    ringOn: 0, ringGlow: 0, ringLight: 0,
    // With no ring to turn, its three rates would be integrated into phase for nothing.
    orbit: 0, orbitX: 0, orbitZ: 0,
    ...PULSE,
    coreHex: preTonemap(accent),
    // 1 because #hero-core is capped at min(94vh, 900px): the buffer IS the CSS box, and above this is
    // supersampling. Costs 6.8ms/frame of a 16.67ms budget on an Intel UHD 630, at any window size.
    renderScale: 1,
  };

  const sim = createSim();

  /* Its own clock, advanced only while the hero is on screen — uTime drives the noise field, so a clock that ran
   * on through the scrolled-past minutes would hand the surface the whole gap in one frame on the way back. */
  let sec = 0, onScreen = true, held = false;

  // A resized buffer comes back blank, so the held reduced-motion frame has to be drawn again.
  const fit = fitCanvas({ stage: canvas, R, scale: () => state.renderScale, onFit: () => { held = false; } });
  fit(true);

  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }).observe(canvas);

  // ---------------------------------------------------------------- what the pointer is doing
  let target = 0, near = 0;          // how close, wanted and smoothed
  let aimY = 0, aimX = 0;            // the angles the face is turning toward, radians
  let faceY = 0, faceX = 0;          // and where it has got to
  // The preset's own pose is the pointer's zero, so a core nobody is pointing at sits as the lab draws it.
  const restY = state.coreAngle, restX = state.coreAngleX;

  /* THE HANDLER STORES AND DOES NOT MEASURE. getBoundingClientRect forces a synchronous reflow, and a fast mouse
     delivers pointermove far faster than frames — with the scene rig invalidating layout every scroll frame,
     one reflow per event took the page to a crawl. The position is read once per FRAME instead, below, where
     layout has already settled. */
  let ptrX = 0, ptrY = 0, ptrMoved = false;
  addEventListener('pointermove', (e) => { ptrX = e.clientX; ptrY = e.clientY; ptrMoved = true; },
                   { passive: true });

  // Nothing to face and nothing to stir: the core returns to its resting pose and keeps only its idle drift.
  document.addEventListener('pointerleave', () => { ptrMoved = false; target = aimY = aimX = 0; });

  /* Everything the pointer does, from ONE reading of where it is: how near it is, and which way the face turns.
     Both are positions, so both are exact — nothing here differentiates the event stream.
     Only on a frame the pointer actually moved: that keeps the rect read off idle frames, and it leaves what
     HERO.near and HERO.pose set alone, which reading unconditionally would overwrite a frame later. */
  function readPointer() {
    if (!ptrMoved) return;
    ptrMoved = false;
    const b = canvas.getBoundingClientRect();
    const ox = ptrX - (b.left + b.width / 2), oy = ptrY - (b.top + b.height / 2);
    const s = Math.min(innerWidth, innerHeight) * REACH;
    target = ease(1 - Math.hypot(ox, oy) / s);
    aimY = clamp11(ox / s) * AIM_Y;      // measured, not reasoned: +Y carries the near face right,
    aimX = clamp11(oy / s) * AIM_X;      // +X carries it down, which is also where clientY grows
  }

  /* The lab's pulse at the lab's own force: sub-cores tear out of the surface and merge back as the spring
   * decays. Bound to the stage, not the canvas, which is pointer-transparent — the core sits behind the type and
   * must never be the thing that swallowed a click on the call to action. */
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button, input, [role="button"]')) return;
    sim.firePulse(state);
    // A tap has no hover behind it; the next frame reads the press position exactly as it would a hover.
    ptrX = e.clientX; ptrY = e.clientY; ptrMoved = true;
  }, { passive: true });

  // ---------------------------------------------------------------- the loop
  /* Reduced motion gets the object, not the animation: the resting core, drawn once and then held. The query is
   * read per frame rather than at startup because a visitor can turn it on with the page already open, and a
   * hero still roiling after they did is the failure the setting exists to prevent. */
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function draw(dt) {
    if (!onScreen || R.lost) return;
    if (reduced.matches) {
      if (held) return;
      held = true;
      near = target = 0;
      faceY = faceX = aimY = aimX = 0;
    } else {
      held = false;
      sec += dt;
      readPointer();                   // once per frame, not once per event
      const k = Math.min(1, dt * FOLLOW), a = Math.min(1, dt * AIM_FOLLOW);
      near += (target - near) * k;
      faceY += (aimY - faceY) * a;
      faceX += (aimX - faceX) * a;
    }
    /* The idle drift is a RATE the sim integrates; the pointer's contribution is an ANGLE added on top of it, so
       the hand moves the face directly and never has to overcome a rotation already running. */
    state.coreSpin = SPIN_IDLE;
    state.coreSpinX = TILT_IDLE;
    state.coreAngle = restY + faceY;
    state.coreAngleX = restX + faceX;
    state.visc = VISC_REST + (VISC_LIVE - VISC_REST) * near;
    sendUniforms(R, state, sim.step(state, dt, sec), sec);
    R.draw();
  }

  const loop = runLoop({ draw });

  /* The handle, on the same terms as the labs' — a scene with no panel still has to be reachable to be measured
   * or tuned. renderNow draws synchronously, which is the only way to step this in a window that is not
   * front-most: Windows Chrome delivers no animation frames to one that is not. */
  /* `stop` is here for inspection, not for the page: with the loop running, a frame stepped by hand is overwritten
   * before it can be looked at, so a pulse cannot be photographed at its peak. Nothing calls it in normal use. */
  /* `pulse` is the page's, not the inspector's: nav.js fires it when an arrow key steps onto the reactor. It
     fires the pulse and nothing else — nearness is the pointer's, and a keyboard is not one. */
  /* `pose` puts the face at an angle and holds it there. draw() writes coreAngle every frame, so setting that
     on the state directly is overwritten before it can be rendered — anything sweeping the core has to come
     through here. */
  window.HERO = { state, sim, R, renderNow: (dt) => loop.renderNow(dt), stop: () => loop.stop(),
                  pulse: () => { sim.firePulse(state); },
                  pose: (y, x) => { aimY = faceY = y; aimX = faceX = x || 0; },
                  get onScreen() { return onScreen; },
                  get near() { return near; }, set near(v) { target = near = clamp01(v); } };
}
