/* hero-core.js — the reactor lab's core, alone, behind scene 01.
 *
 * It IS the lab's core, at the lab's own STABLE settings: the same shader, the same simulation, the same state.
 * Changed and no more: the ring assembly is off, the color comes from --accent, the render scale is its own,
 * and the pulse runs at FORCE 13 with SUB VIS/TRB 0.
 *
 * The pointer does exactly two things, and both are read off its POSITION. The face turns to where it is, and
 * how near it is drives VISCOSITY, which is what makes the surface roil. A click fires the lab's pulse. Nothing
 * else on this canvas reacts to anything. A finger counts as a pointer here, including while it is scrolling.
 */
import { createQuad } from '../labs/kit/glquad.js';
import { runLoop, fitCanvas } from '../labs/kit/lab.js';
import { fragFor, UNIFORMS } from '../labs/reactor/reactor-shader.js';
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

/* ---- what the scroll does to it ----
 *
 * SCROLL IS A RATE HERE, NOT A POSITION. Driving the pose from scrollY would tie the core's angle to where the
 * page happens to be, so it would sit still whenever the reader did and snap when they jumped — and it would
 * fight the rail, which moves the page on its own. Reading how FAST the page is moving instead makes the core
 * something the scroll stirs: it spins up under a flick, keeps turning after the page has stopped, and settles
 * back to its idle drift on its own.
 * Fed through the same shape the pointer's nearness uses — a value that chases a target and decays — because it
 * is the same kind of thing and the core already knows how to be driven that way. */
const SCROLL_SPIN = .045;  // RPM of extra spin per pixel-per-frame of scroll
const SCROLL_STIR = .022;  // and how much of the roil it reaches, per the same
const SCROLL_DECAY = 2.4;  // per second, back to idle once the page stops
const SCROLL_MAX = 26;     // ceiling in RPM, so a flung trackpad cannot put it into a blur

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
const ease = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };

/* The linear red a lit surface on this core reaches, measured off the rendered frame: the brightest decile came
 * back at 154/255, which is this value through the tone map. It is the operating point the color below is
 * solved at, and it is a property of the lab's GLOW — re-measure if that setting ever moves. */
const OPERATING = 1.05;

const toneMap = (x) => Math.pow(x / (x + 0.85), 0.85);
const unTone = (v) => { const y = Math.pow(clamp01(v), 1 / 0.85); return 0.85 * y / Math.max(1e-4, 1 - y); };

/* The color the SHADER must be given for the core to RENDER as `hex`.
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
  /* deferLink: THE PAGE DOES NOT WAIT FOR THE SHADER. Linking the reactor's superset blocks the main thread —
     13.3 seconds on an Intel UHD 630 with a cold shader cache, measured, and DOMContentLoaded sat behind all of
     it. The labs still link the old way: they are the whole page and have nothing to show without it. Here the
     rest of the page is the point, so the core arrives when it arrives. */
  /* THE BASE PROGRAM IS THE ONE WITHOUT THE RING, and that is what makes the core arrive at all.
   *
   * A fragment program links whole, so this page was paying to compile the ring, its shield and their machined
   * relief in order to draw a scene that switches every one of them off. Measured on an Intel UHD 630: 39.3s
   * cold and 24.2s warm before ready() came true, against 7.5s cold without them. For all of that time the
   * halo arcs sit in the loading animation the stylesheet hangs on :not(.core-lit) and there is no core.
   *
   * `variant` KEEPS THE RING REACHABLE rather than compiling it away for good. Ask for it and glquad builds the
   * full program in the background and swaps it in when it lands, holding this one on screen meanwhile -- so a
   * later scene can switch the ring on at runtime and pay the compile once, instead of every load paying it for
   * a ring nobody asked for. Note the usual `frag` must be the superset; here it deliberately is not, because
   * the fallback only has to draw what THIS page asks for. */
  const R = createQuad(canvas, {
    frag: fragFor('core'), variant: fragFor, uniforms: UNIFORMS,
    onRestore: () => fit(true), deferLink: true,
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
    // 1 because #hero-core is capped by its CSS box — min(94vh, 900px), or --hero-lane on a portrait phone: the
    // buffer IS that box, and above this is supersampling. Costs 6.8ms/frame of a 16.67ms budget on an Intel
    // UHD 630, at any window size.
    renderScale: 1,
  };

  // The state this scene starts in, kept whole so a director that has driven the core can put it back.
  const HOME = { ...state };

  /* THE CAMERA IS THE STYLESHEET'S, NOT THIS FILE'S. On a portrait phone site.css stands the core in a band
   * between the name and the paragraph and sizes the buffer to 1.7x that band; at zoom 1 the shader draws the
   * core across about a third of whatever buffer it is given, so the camera has to come in to fill the band.
   * Both numbers, and the ground under the core that is derived from them, are declared together in --core-canvas
   * / --core-zoom / --core-shade — three views of one object, which is why this reads the value back instead of
   * carrying its own copy and its own idea of where the breakpoint is. */
  const setZoom = () => {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--core-zoom'));
    state.zoom = Number.isFinite(v) && v > 0 ? v : 1;
  };
  setZoom();
  // The same channel every other measurement on this page re-reads on: resize, load, and a body observer, which
  // is what catches the breakpoint being crossed without this file knowing where the breakpoint is.
  if (window.AKKIT && window.AKKIT.onResize) window.AKKIT.onResize(setZoom);

  // Whether the shader has landed. One-way: a lost context rebuilds through onRestore, not through here.
  let lit = false;
  /* TAKEN: a director owns the state. draw() still steps the sim and draws, but writes nothing of its own --
     spin, tilt, angle and viscosity are the director's to set until it releases the core. The pointer and the
     scroll keep being read so that the moment it lets go, the core is already where the hand is. */
  let driven = false;

  let sim = createSim();

  /* Its own clock, advanced only while the hero is on screen — uTime drives the noise field, so a clock that ran
   * on through the scrolled-past minutes would hand the surface the whole gap in one frame on the way back. */
  let sec = 0, onScreen = true, held = false;
  // How hard the page is being moved, in the core's own units. Decays to 0 whenever it is not being fed.
  let churn = 0, lastY = window.scrollY || 0;

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

  /* A FINGER IS TRACKED THROUGH touchmove, NOT pointermove. The moment the browser claims a drag for scrolling
     it fires pointercancel and delivers no further pointermove, so on a phone the core stopped reading the
     finger exactly when it started moving. Passive touchmove keeps arriving for the whole scroll. */
  addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!t) return;
    ptrX = t.clientX; ptrY = t.clientY; ptrMoved = true;
  }, { passive: true });

  // Nothing to face and nothing to stir: the core returns to its resting pose and keeps only its idle drift.
  const rest = () => { ptrMoved = false; target = aimY = aimX = 0; };
  /* Touch is exempt: the scroll takeover's pointercancel is followed by pointerleave, so honoring it here would
     undo the touchmove tracking above on the first frame of every swipe. A finger leaves on touchend instead. */
  document.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') rest(); });
  addEventListener('touchend', (e) => { if (!e.touches.length) rest(); }, { passive: true });
  addEventListener('touchcancel', (e) => { if (!e.touches.length) rest(); }, { passive: true });

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
    /* NOTHING TO DRAW UNTIL THE PROGRAM LANDS. ready() is a poll and not a wait, so this costs one extension
       query a frame while the driver works, and the page stays live throughout.
       The class is what the stylesheet hangs the stand-in ring and the title's fade on, and it is set once. */
    if (!lit) {
      if (!R.ready()) return;
      lit = true;
      document.documentElement.classList.add('core-lit');
    }
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
    /* THE SCROLL'S CONTRIBUTION, read as a speed rather than a place. scrollY costs no layout, so this is a
       subtraction per frame and nothing more. Its SIGN is dropped: the core spins up whichever way the page is
       driven, because it is being stirred, not steered. */
    const y = window.scrollY || 0;
    if (!reduced.matches) {
      churn = Math.min(SCROLL_MAX, churn + Math.abs(y - lastY) * SCROLL_SPIN);
      churn -= churn * Math.min(1, dt * SCROLL_DECAY);
    } else {
      churn = 0;
    }
    lastY = y;

    /* The idle drift is a RATE the sim integrates; the pointer's contribution is an ANGLE added on top of it, so
       the hand moves the face directly and never has to overcome a rotation already running. The scroll joins
       the RATE, which is why it keeps turning after the page has stopped instead of snapping back. */
    if (!driven) {
      state.coreSpin = SPIN_IDLE + churn;
      state.coreSpinX = TILT_IDLE + churn * .35;
      state.coreAngle = restY + faceY;
      state.coreAngleX = restX + faceX;
      /* And it roils on top of whatever the pointer is already asking for, never below it — a reader who is
         both hovering and scrolling should not get a calmer core than one who is only hovering. */
      const stir = Math.min(1, near + churn * SCROLL_STIR);
      state.visc = VISC_REST + (VISC_LIVE - VISC_REST) * stir;
    }
    /* BEFORE THE UNIFORMS, because a switch lands on a program whose uniforms are all zero and it is the sends
       below that fill it in. Asking for 'core' every frame is a map lookup once it is current. */
    R.use(state.ringOn ? 'full' : 'core');
    sendUniforms(R, state, sim.step(state, dt, sec), sec);
    R.draw();
  }

  const loop = runLoop({ draw });

  /* An on-screen readout of what the pointer path is actually doing, for a phone with no console attached.
     Off unless the URL carries ?debug, so it costs nothing in normal use. */
  if (/[?&]debug\b/.test(location.search)) {
    let moves = 0, cancels = 0, leaves = 0;
    addEventListener('touchmove', () => { moves++; }, { passive: true });
    addEventListener('pointercancel', () => { cancels++; }, { passive: true });
    document.addEventListener('pointerleave', () => { leaves++; });
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99999;margin:0;padding:6px 8px;' +
      'font:11px/1.4 monospace;color:#0f0;background:rgba(0,0,0,.82);pointer-events:none';
    document.body.appendChild(box);
    setInterval(() => {
      const b = canvas.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const reach = Math.min(innerWidth, innerHeight) * REACH;
      box.textContent = [
        'vp     ' + innerWidth + 'x' + innerHeight + '   reach ' + reach.toFixed(0),
        'finger ' + ptrX.toFixed(0) + ',' + ptrY.toFixed(0),
        'core   ' + cx.toFixed(0) + ',' + cy.toFixed(0) + '   box ' + b.width.toFixed(0),
        'dist   ' + Math.hypot(ptrX - cx, ptrY - cy).toFixed(0),
        'target ' + target.toFixed(3) + '   near ' + near.toFixed(3),
        'churn  ' + churn.toFixed(2) + '   visc ' + state.visc.toFixed(2),
        'ring-o ' + (getComputedStyle(stage).getPropertyValue('--ring-o').trim() || 'unset'),
        'onScr  ' + onScreen + '  reduced ' + reduced.matches + '  lit ' + lit,
        'events move ' + moves + ' cancel ' + cancels + ' leave ' + leaves,
      ].join(String.fromCharCode(10));
    }, 100);
  }

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
  /* renderNow FORCES THE LINK. The frame loop is happy to wait for the shader and draw nothing meanwhile, but a
     synchronous frame has no next frame to be drawn on: whatever asked for it reads the buffer immediately. */
  /* `take` / `release` hand the state to a director and back -- the intro plays the reactor's whole
     sequence on this canvas and ends in this scene's own state, so there is no handoff to see. `full` is
     whether the ring's program is the one drawing, which only the loop's own use() can answer. `heroHex` is
     the color this scene renders at rest, for a director tweening toward it. */
  window.HERO = { state, get sim() { return sim; }, R,
                  renderNow: (dt) => { R.ready(true); return loop.renderNow(dt); },
                  stop: () => loop.stop(),
                  start: () => loop.start(),
                  start: () => loop.start(),
                  pulse: () => { sim.firePulse(state); },
                  pose: (y, x) => { aimY = faceY = y; aimX = faceX = x || 0; },
                  take: () => { driven = true; },
                  release: () => { driven = false; churn = 0; lastY = window.scrollY || 0; },
                  // Everything back to this scene's own state, with a fresh sim: what a skipped intro lands on.
                  home: () => { Object.assign(state, HOME); sim = createSim(); setZoom(); fit(true); },
                  // Rebuilds the buffer at the current renderScale; a director lowering it for the ring pays here.
                  refit: () => fit(true),
                  // Puts the camera back at the stylesheet's zoom after a director has moved it.
                  resetZoom: setZoom,
                  get driven() { return driven; },
                  get lit() { return lit; },
                  get full() { return !!state.ringOn && R.use('full'); },
                  heroHex: preTonemap(accent),
                  rest: { SPIN_IDLE, TILT_IDLE, VISC_REST, ...PULSE, restY, restX, dropN: state.dropN },
                  get onScreen() { return onScreen; },
                  get near() { return near; }, set near(v) { target = near = clamp01(v); } };
}
