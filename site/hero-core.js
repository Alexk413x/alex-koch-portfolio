/* hero-core.js — the reactor lab's core, alone, behind scene 01.
 *
 * It IS the lab's core, at the lab's own STABLE settings: the same shader, the same simulation, the same state.
 * Two things are changed and no more — the ring assembly is switched off, and the colour comes from --accent.
 *
 * The pointer does exactly two things. Its SPEED drives the two spins, and its speed and nearness together drive
 * VISCOSITY, which is what makes the surface roil. A click fires the lab's pulse at full force. Nothing else on
 * this canvas reacts to anything.
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

/* THE PULSE, and every number in it is measured rather than dialled by eye.
 *
 * A droplet has pinched off when the gap between its inner edge and the core's surface clears the shader's goo
 * blend, which is 0.16 of the core's radius. Between 0.08 and 0.16 the neck is a thread you can barely see;
 * under 0.08 it is a fat visible bridge; below zero the sub-core is still buried in the surface.
 *
 * FORCE moves how far they travel; SUB-CORE SIZE moves how big they are, and because a smaller sub-core's inner
 * edge sits further out, it ALSO clears the surface more readily at the same force. Measured over twelve fires
 * — free / thread / neck / buried:
 *
 *     FORCE 13, SIZE 0.6    0%   0%  13%  87%    shipped
 *     FORCE 13, SIZE 0.5    0%   4%  23%  73%
 *     FORCE 14, SIZE 0.5    0%  10%  35%  56%
 *     FORCE 15, SIZE 0.7    5%  16%  24%  55%    the first one where anything tears off
 *     FORCE 16, SIZE 0.7   23%  29%  28%  20%
 *     FORCE 16.5, SIZE 0.7 41%  31%  15%  13%    most break away
 *
 * Shipped is the one where a click STRAINS the surface: sub-cores swell out of it on fat necks and none get
 * away. The largest is 0.29 of the core's radius and the furthest reaches 1.52 of it.
 *
 * DURATION only stretches the spring in TIME — its peak is set by FORCE alone — so 2.0 makes the whole event a
 * slow strain rather than a snap. It also moves where the peak falls, which is why nothing that measures this
 * pulse may count a fixed number of frames to find it.
 *
 * SUB VIS/TRB IS ZERO ON PURPOSE. It is the term that adds the pulse's magnitude back into viscosity and
 * turbulence, so at anything above zero a click also roughens the surface. The pulse should pulse and nothing
 * else; viscosity belongs to the pointer. */
const PULSE = { pulseAmp: 13, dropSize: 0.6, dropN: 10, pulseSize: 0.06, pulseDur: 2.0, subVT: 0 };

const REACH = 0.7;         // how near counts as near, as a fraction of the smaller viewport axis
const FOLLOW = 3.5;        // how fast the nearness reading chases the pointer, per second
/* The spins take up a throw quickly and give it back slowly, which is the whole feel of the gesture: a flick
 * spins the core and then it runs down. One symmetrical constant makes it either sluggish to start or instantly
 * dead the moment the hand stops. */
const SPIN_GRAB = 6.0, SPIN_COAST = 1.1;

/* A pointer crossing the window in about half a second is the top of the range. Above it the spin is pinned:
 * a mouse can be thrown arbitrarily fast, and a core that answered every one of those would read as a strobe. */
const MAX_SPEED = 1600;    // px/s
/* The idle is deliberately far below the swing. At the lab's own SPIN Y of 10 against a swing of 34 the gesture
 * was not symmetrical: a throw one way added to a rotation already running, and a throw the other way had to
 * cancel it before anything visibly changed, so gentle movement did nothing at all and the core read as
 * ignoring the cursor. Small idle, large swing — the hand wins from the first pixel, in either direction. */
const SPIN_IDLE = 3, SPIN_SWING = 40;      // RPM about Y, from a horizontal throw
const TILT_IDLE = 1, TILT_SWING = 24;      // RPM about X, from a vertical one

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
const ease = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };

// One spin, one frame: grabs a faster throw, runs down out of a slower one.
const chase = (cur, want, dt) =>
  cur + (want - cur) * Math.min(1, dt * (Math.abs(want) > Math.abs(cur) ? SPIN_GRAB : SPIN_COAST));

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
    frag: FRAG, uniforms: UNIFORMS, ext: ['OES_standard_derivatives'], onRestore: () => fit(true),
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
    // Well under the lab's pixel count, and lower again on integrated graphics: this is a seventy-step sphere
    // trace running behind a page, not the instrument it was tuned as.
    renderScale: R.gpu.integrated ? 0.5 : 0.6,
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
  let dx = 0, dy = 0;                // pixels travelled since the last frame
  let spinY = 0, spinX = 0;          // the two smoothed throw rates, -1..1
  let lastX = null, lastY = null;

  /* Movement is ACCUMULATED here and converted to a rate in the frame, rather than differentiated per event.
   * Pointer events arrive in bursts and at their own cadence, so an instantaneous dx/dt off two of them is mostly
   * a measurement of the event queue; and a pointer that stops sends nothing at all, which this decays to zero
   * on its own because the next frame finds no pixels to divide. */
  addEventListener('pointermove', (e) => {
    if (lastX != null) { dx += e.clientX - lastX; dy += e.clientY - lastY; }
    lastX = e.clientX; lastY = e.clientY;
    const b = canvas.getBoundingClientRect();
    const d = Math.hypot(e.clientX - (b.left + b.width / 2), e.clientY - (b.top + b.height / 2));
    target = ease(1 - d / (Math.min(innerWidth, innerHeight) * REACH));
  }, { passive: true });

  document.addEventListener('pointerleave', () => { target = 0; lastX = lastY = null; });

  /* The lab's pulse at the lab's own force: sub-cores tear out of the surface and merge back as the spring
   * decays. Bound to the stage, not the canvas, which is pointer-transparent — the core sits behind the type and
   * must never be the thing that swallowed a click on the call to action. */
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button, input, [role="button"]')) return;
    sim.firePulse(state);
    target = 1;                       // a touch has no hover, so the tap itself is what brings the core up
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
      spinY = spinX = 0;
    } else {
      held = false;
      sec += dt;
      near += (target - near) * Math.min(1, dt * FOLLOW);
      /* GUARD THE DIVISION. runLoop clamps dt at zero from below, and a zero-length frame is not rare on the
       * first one — the first rAF timestamp can precede the performance.now() the loop was built with. Divided
       * by it, a frame that saw no movement gives 0/0, and the NaN does not stay local: it reaches the spin, the
       * simulation integrates it into the rotation phase, and a NaN rotation makes every ray miss the core. The
       * hero then renders its background and nothing else, for the life of the document. */
      const perSec = dt > 1e-6 ? 1 / (dt * MAX_SPEED) : 0;
      spinY = chase(spinY, clamp11(dx * perSec), dt);
      spinX = chase(spinX, clamp11(dy * perSec), dt);
      dx = dy = 0;
    }
    /* Rates, not angles: reactor-sim integrates both into a phase, so the core accelerates into a throw and
     * coasts out of it rather than snapping to wherever that speed's multiple of the elapsed time would put it.
     *
     * BOTH SIGNS ARE PLUS, and that was measured rather than reasoned about. A single sub-core is fired out as a
     * landmark and swept through a whole turn of each angle; the screen motion is averaged weighted by how near
     * the landmark is, because a landmark on the far side travels the opposite way and a single sample cannot
     * tell you which side it was on. That is the trap: an earlier reading off one pair of frames said the
     * opposite, shipped, and the core spun AGAINST the cursor. A positive Y angle carries the near face right; a
     * positive X angle carries it down, which is also where clientY grows. */
    state.coreSpin = SPIN_IDLE + spinY * SPIN_SWING;
    state.coreSpinX = TILT_IDLE + spinX * TILT_SWING;
    // Nearness OR speed, whichever is greater: a pointer parked on the core keeps it roiling, and a pointer
    // thrown past the edge of the screen still stirs it.
    const stir = Math.max(near, Math.abs(spinY), Math.abs(spinX));
    state.visc = VISC_REST + (VISC_LIVE - VISC_REST) * stir;
    sendUniforms(R, state, sim.step(state, dt, sec), sec);
    R.draw();
  }

  const loop = runLoop({ draw });

  /* The handle, on the same terms as the labs' — a scene with no panel still has to be reachable to be measured
   * or tuned. renderNow draws synchronously, which is the only way to step this in a window that is not
   * front-most: Windows Chrome delivers no animation frames to one that is not. */
  /* `stop` is here for inspection, not for the page: with the loop running, a frame stepped by hand is overwritten
   * before it can be looked at, so a pulse cannot be photographed at its peak. Nothing calls it in normal use. */
  window.HERO = { state, sim, R, renderNow: (dt) => loop.renderNow(dt), stop: () => loop.stop(),
                  get onScreen() { return onScreen; },
                  get near() { return near; }, set near(v) { target = near = clamp01(v); } };
}
