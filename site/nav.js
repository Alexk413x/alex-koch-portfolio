/* nav.js — where the reader is, and the two things that read it.
 *
 * ONE reading line and ONE written property. --k is the playhead in section units, so 2.37 reads as "37% through
 * the third section"; every bar, and the current item's colour, is a static rule off that one number. A scroll
 * frame therefore writes a single attribute on a single element, which is the same discipline scenes.js runs on.
 *
 * The carry lives here for the same reason rather than in a file of its own: it needs to know which section the
 * reader is in, and a second measurement of that is a second thing that can disagree about the answer.
 *
 * Its own listener rather than a hook into scenes.js, deliberately: the readout has to keep working when the
 * scene rig is disarmed under reduced motion or a short viewport, and that is exactly when scenes.js is not
 * running a frame loop at all.
 */
(function () {
  'use strict';

  const nav = document.getElementById('nav');
  if (!nav) return;

  const links = Array.prototype.slice.call(nav.querySelectorAll('.links a[href^="#"]'));
  if (!links.length) return;

  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* The range a link owns is declared in the markup, not restated here. Scene 01 and the calculator are
     absolutely positioned inside sticky stages, so their own tops are not page positions at all; the scroll each
     one occupies is its [data-range] container. */
  const items = links.map((a, i) => {
    a.style.setProperty('--i', i);
    const target = document.querySelector(a.getAttribute('href'));
    return { a, el: target && (target.closest('[data-range]') || target) };
  }).filter((it) => it.el);

  if (!items.length) return;

  let spans = [];
  let stops = [];
  let current = -1;
  let queued = false;

  /* ---- the carry ----
   *
   * Crossing a boundary hands the reader to the top of the section they landed in. Inside a section the scroll
   * is theirs again, so a scrubbed scene stays playable — this only ever finishes a move the reader already
   * started, and only once per crossing.
   */
  const SETTLE = 140;   // ms of stillness before it acts. Trackpad momentum keeps firing wheel events long after
                        // the finger lifts; starting on the crossing itself means fighting that inertia.
  const GLIDE = 620;    // ms of travel. Long enough to read as a hand-off, short enough not to feel taken over.

  /* Fine pointers, on a window with room. Touch momentum arrives in a stream the page cannot cancel, so on a
   * phone the carry and the flick fight each other. The pair matches the breakpoints the stylesheet already uses.
   */
  const roomy = window.matchMedia('(min-width: 821px) and (min-height: 501px)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  let parked = -1;      // the section the reader was last handed to; re-entry into it must not re-fire
  let glide = 0;        // the running rAF, and the flag that says this scrolling is ours rather than theirs
  let settleTimer = 0;
  let quietUntil = 0;   // an anchor jump is already a deliberate destination; do not follow it with a second move
  let lastInput = -1e9; // when the reader last drove the page themselves
  let stopIndex = -1;   // the stop we are at or gliding toward, so a second flick mid-flight advances by one
  let orbY = 0;         // the stop where the reactor holds the frame alone

  /* Section BOUNDARIES, not section boxes: each span runs to the next section's top, so the gaps between them
     belong to somebody. A playhead landing in a margin would otherwise report no section at all. */
  function measure() {
    const y = window.scrollY || window.pageYOffset || 0;
    const tops = items.map((it) => it.el.getBoundingClientRect().top + y);
    const end = items[items.length - 1].el.getBoundingClientRect().bottom + y;
    spans = tops.map((t, i) => [t, i + 1 < tops.length ? tops[i + 1] : end]);
    stops = buildStops();
  }

  /* ---- the stops ----
   *
   * Everywhere worth being, in page order: the top of each section and each committed state of the two scenes
   * that have them. The arrow keys step this list, so a press is always a whole beat rather than a fixed number
   * of pixels — the reader chooses when it moves, and never lands halfway through anything.
   *
   * Built in the same pass as the section spans, from the same DOM, so the stepper and the meter cannot end up
   * with different ideas of where a thing is.
   */
  function buildStops() {
    const y = window.scrollY || window.pageYOffset || 0;
    const at = (el, pad) => Math.max(0, Math.min(maxScroll(),
      Math.round(el.getBoundingClientRect().top + y - (pad || 0))));
    const list = [0];

    /* THE HERO IS TWO STOPS. The first is the scene; the second is the point where the words have finished
       leaving and the reactor holds the frame on its own, with nothing else in it. Read off the same two
       properties scenes.js scrubs the exit against, so the stop cannot land somewhere the envelope disagrees
       with. The next press from there is what strikes the instrument. */
    const cs = getComputedStyle(document.documentElement);
    const sceneRun = (parseFloat(cs.getPropertyValue('--scene-hold')) || 0)
      + (parseFloat(cs.getPropertyValue('--scene-exit')) || 0);
    orbY = Math.round(sceneRun * (window.innerHeight || 0));
    if (orbY > 24) list.push(orbY);
    const heroCount = list.length;

    /* Two stops, like the calculator: the suite at rest, and the suite having run. Its trigger is
       --morph-trip, the one declaration both files read, so a change there cannot strand the stop short of
       the beat it is meant to land on. */
    const loopScroll = document.getElementById('loop-scroll');
    const loopStage = document.getElementById('loop-stage');
    const trip = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--morph-trip')) || .14;
    if (loopScroll && loopStage) {
      const pinTop = at(loopScroll);
      const run = loopScroll.offsetHeight - loopStage.offsetHeight;
      list.push(pinTop);
      if (run > 0) list.push(Math.min(maxScroll(), pinTop + Math.round(run * trip) + 24));
    } else {
      const cart = document.getElementById('cartographer');
      if (cart) list.push(at(cart));
    }

    /* The calculator is two stops, not one: the faceplate it is pinned at, and just past the trigger, which
       commits the morph and lets it play out on its own clock. The trigger fraction is read from the
       stylesheet, the same declaration scenes.js triggers on. */
    const appScroll = document.getElementById('app-scroll');
    const appStage = document.getElementById('app-stage');
    if (appScroll && appStage) {
      const pinTop = at(appScroll);
      const run = appScroll.offsetHeight - appStage.offsetHeight;
      list.push(pinTop);
      if (run > 0) list.push(Math.min(maxScroll(), pinTop + Math.round(run * trip) + 24));
    }

    /* ONE STOP PER ROLE, back again and meaningful this time. The roles are beats of a pinned viewer now, so a
       press both moves the page and changes what is showing — which is what a stop is for. Placed mid-beat
       rather than on its edge, so a pixel of rounding cannot land on the neighbour. */
    const exp = document.getElementById('experience');
    if (exp) list.push(at(exp));

    const expScroll = document.getElementById('exp-scroll');
    const expStage = document.getElementById('exp-stage');
    if (expScroll && expStage) {
      const pinTop = at(expScroll);
      const run = expScroll.offsetHeight - expStage.offsetHeight;
      const n = document.querySelectorAll('.exp-deck .role').length;
      for (let i = 0; i < n && run > 0; i++) {
        list.push(Math.min(maxScroll(), pinTop + Math.round(run * ((i + .5) / n))));
      }
    }

    const bg = document.getElementById('background');
    if (bg) list.push(at(bg));

    const labs = document.getElementById('labs');
    if (labs) list.push(at(labs));
    list.push(maxScroll());

    // Sorted, and near-duplicates dropped: two stops a few pixels apart make one arrow press appear to do nothing.
    const sorted = list.sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 24);

    /* NO GAP WIDER THAN A SCREEN. The wheel steps between stops rather than scrolling, so anything sitting
       between two stops further apart than the viewport could never be reached at all — Cartographer and Labs
       both run a little over one screen.
       THE WHOLE HERO IS EXEMPT. Its gaps hold the scene LEAVING and nothing to read, and the second of them —
       the reactor alone to the next section — measures exactly one viewport by construction, since the stage's
       runway and the stop are both derived from --scene-exit. A pixel of rounding at some window heights tips
       that over the threshold and drops a stop into the middle of the strike, which halts the core and the ring
       halfway out. Counted rather than hard-coded, so it still holds if the orb stop is ever dropped. */
    const screen = window.innerHeight || 1;
    const out = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1];
      if (i > heroCount && gap > screen) {
        const n = Math.ceil(gap / screen);
        for (let s = 1; s < n; s++) out.push(Math.round(sorted[i - 1] + gap * s / n));
      }
      out.push(sorted[i]);
    }
    return out;
  }

  /* Down from between two stops goes to the one ahead, not two ahead; up goes to the one behind. Sitting ON a
     stop, it moves by one. Without the distinction, an arrow press from anywhere but a stop skips a beat. */
  function stepTo(dir) {
    if (!stops.length) return;
    let t;
    if (glide && stopIndex >= 0) {
      // Mid-flight, step from where we are HEADED. Measuring scrollY here would read a position between two
      // stops and round back to the one we just left.
      t = stopIndex + dir;
    } else {
      const y = window.scrollY || window.pageYOffset || 0;
      let i = 0;
      for (let n = 0; n < stops.length; n++) if (Math.abs(stops[n] - y) < Math.abs(stops[i] - y)) i = n;
      const onIt = Math.abs(stops[i] - y) < 24;
      if (onIt) t = i + dir;
      else if (dir > 0) t = stops[i] > y ? i : i + 1;
      else t = stops[i] < y ? i : i - 1;
    }
    t = Math.max(0, Math.min(stops.length - 1, t));
    stopIndex = t;
    /* A step onto the reactor strikes it, the same way a click does. Only where it is actually on screen: a
       pulse fired into a scene that has already left is spent on nobody. */
    if (stops[t] <= orbY + 4 && window.HERO && window.HERO.pulse) window.HERO.pulse();
    /* The carry watches for boundary crossings; a step is already a deliberate destination, so it must not be
       followed by a second, unasked-for move once this one lands. */
    quietUntil = performance.now() + GLIDE + 300;
    glideTo(stops[t]);
  }

  function frame() {
    queued = false;
    const y = window.scrollY || window.pageYOffset || 0;
    const vh = window.innerHeight || 1;
    const runway = Math.max(1, document.documentElement.scrollHeight - vh);
    /* 42% down the viewport at rest, 92% at the bottom. Contact is ~350px tall and the page bottoms out several
       hundred px above it, so a line fixed inside the viewport can never reach the last section and CONTACT
       would never light. This is the kind of thing that looks like a bug for a week if it is not written down. */
    const line = y + vh * (.42 + .5 * clamp(y / runway));

    let k = spans.length;
    for (let i = 0; i < spans.length; i++) {
      const top = spans[i][0], bottom = spans[i][1];
      if (line < top) { k = i; break; }
      if (line < bottom) { k = i + (line - top) / Math.max(1, bottom - top); break; }
    }

    nav.style.setProperty('--k', k.toFixed(4));

    /* Semantics carry the current item too, and the CSS keys off the attribute rather than a class, so there is
       one description of "current" instead of two that can disagree. */
    const i = Math.min(items.length - 1, Math.max(0, Math.floor(k)));
    if (i === current) return;
    if (current >= 0) items[current].a.removeAttribute('aria-current');
    items[i].a.setAttribute('aria-current', 'true');
    current = i;
  }

  const maxScroll = () =>
    Math.max(0, document.documentElement.scrollHeight - (window.innerHeight || 1));

  /* A section rests at its TOP, so the reader gets all of it and scrubs the rest themselves. Centring was the
     obvious first answer and it is wrong for anything long: it drops the reader halfway down a 4,955px section
     with half of it already behind them, and it lands the calculator mid-morph instead of on the faceplate.
     The two ends need no special case. Section 0's top IS the top of the page, and contact's top sits below the
     furthest the page can scroll, so the clamp parks it at the bottom on its own. */
  function restFor(i) {
    return Math.min(maxScroll(), Math.max(0, spans[i][0]));
  }

  function stopGlide() {
    if (!glide) return;
    cancelAnimationFrame(glide);
    glide = 0;
  }

  function glideTo(y) {
    stopGlide();
    const from = window.scrollY || window.pageYOffset || 0;
    const dist = y - from;
    if (Math.abs(dist) < 8) return;
    let t0 = 0;
    const step = (ts) => {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / GLIDE);
      const e = 1 - Math.pow(1 - p, 3);
      /* instant, per frame. The stylesheet sets scroll-behavior: smooth for anchor jumps, and letting each of
         these 60 steps run its own smooth scroll makes the two easings compound into a crawl. */
      window.scrollTo({ top: Math.round(from + dist * e), behavior: 'instant' });
      glide = p < 1 ? requestAnimationFrame(step) : 0;
      if (!glide) parked = current;
    };
    glide = requestAnimationFrame(step);
  }

  /* Fires once the scrolling stops, not on the crossing itself. By then the reader has landed somewhere, so the
     section they are carried into is the one they actually chose rather than the one they passed through. */
  function park() {
    settleTimer = 0;
    if (glide || current < 0) return;
    if (!roomy.matches || reduced.matches) { parked = current; return; }
    if (performance.now() < quietUntil) { parked = current; return; }
    /* ONLY EVER FINISH A MOVE THE READER MADE. A scroll the page did to itself — an anchor jump, a position
       restored on reload, find-in-page, a script driving it — dispatches no wheel, touch or key, so it is left
       exactly where it put itself. Without this the assist fights the browser, and it silently relocated the
       page under four checks that had positioned it deliberately. */
    if (performance.now() - lastInput > 2000) { parked = current; return; }
    if (current === parked) return;
    parked = current;
    /* The stepper's index is only meaningful while the stepper is what is moving the page. A carry moves it for
       a different reason, so the index is dropped and the next press re-reads the position — otherwise a press
       arriving mid-carry steps from wherever the reader was BEFORE the carry, which is a stop away and possibly
       most of the page away. */
    stopIndex = -1;
    glideTo(restFor(current));
  }

  function onScroll() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(frame);
    }
    // Our own scrolling must not restart its own settle timer, or the carry can never finish.
    if (glide) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(park, SETTLE);
  }

  function remeasure() {
    measure();
    frame();
  }

  /* The stop list, for anything that needs to know where the page can come to rest. The measurements are all
     derived — section spans, the morph trigger, the roles, the gap filling — so restating them anywhere else is
     a second description that can drift. The harness reads this rather than recomputing the geometry. */
  /* `busy` is the page still DECIDING: either gliding, or counting down the settle before it decides whether to
     carry. A reader cannot see the difference between that and a page at rest, but anything measuring one can
     be fooled by it — a scroll that has stopped is not the same as a scroll that has finished. */
  window.AKNAV = {
    stops: () => stops.slice(),
    index: () => stopIndex,
    section: () => current,
    busy: () => glide !== 0 || settleTimer !== 0,
  };

  remeasure();
  parked = current;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', remeasure);
  // Web fonts land after this runs and reflow every section under the fold, so the first measurement is stale.
  window.addEventListener('load', remeasure);

  /* The reader's own hands, recorded and answered in one place: the timestamp is what tells park() the movement
     was theirs to finish, and cancelling any carry in flight is the difference between an assist and having the
     page taken off them. Capture, so nothing further down can swallow it. */
  function noteInput() {
    lastInput = performance.now();
    stopGlide();
  }
  /* THE WHEEL IS THE READER'S, MOMENTUM AND ALL. Reading it as discrete gestures — one flick, one stop — was
     tried and reverted: it is exact, but a wheel that answers only the first event of a gesture and ignores the
     rest feels unresponsive, because the page stops moving while the hand is still moving. The scroll stays
     native and the carry tidies up where it lands, which overshoots sometimes and always feels alive.
     The keyboard keeps the discrete stepping. A key press IS one discrete decision, so nothing is being
     inferred there. */
  for (const ev of ['wheel', 'touchmove', 'pointerdown']) {
    window.addEventListener(ev, noteInput, { passive: true, capture: true });
  }

  /* ---- the arrow keys ----
   *
   * One press, one stop. Arrows only: PageUp/PageDown, Home/End and the space bar keep their native behaviour,
   * so a reader who navigates by keyboard has not had the page taken away, only given a better default.
   */
  // 'Spacebar' is the pre-2017 Edge spelling; without it that browser simply keeps the native page scroll.
  const STEP_KEYS = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, ' ': 1, Spacebar: 1 };

  /* Never steal a key from something that wants it: a field, the calculator, or a BUTTON — space is how a button
     is pressed, and the QR trigger is a button. */
  function busy(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('input, textarea, select, button, [contenteditable="true"], #rpn');
  }

  window.addEventListener('keydown', (e) => {
    lastInput = performance.now();
    const space = e.key === ' ' || e.key === 'Spacebar';
    // Shift+Space is the browser's own "back a page", so it keeps that meaning here.
    const dir = space && e.shiftKey ? -1 : STEP_KEYS[e.key];
    if (!dir || e.metaKey || e.ctrlKey || e.altKey || (e.shiftKey && !space)) { stopGlide(); return; }
    if (e.repeat || busy(e.target)) return;   // held down, it would race through the page a stop per frame
    if (!roomy.matches || reduced.matches) return;
    e.preventDefault();
    stopGlide();
    stepTo(dir);
  });

  /* An anchor click already names a destination, so the carry must not follow it with a second, unasked-for
     move. And for the two pinned scenes it has to name a different destination than the browser would.
     A SCENE INSIDE A STICKY STAGE HAS NO PAGE POSITION OF ITS OWN. #alex resolves to where the stage comes to
     rest, which is the END of the hero's runway — the words have already climbed out and the frame is empty, so
     the browser's own jump lands on nothing. #app has the same shape. The page position is the RANGE's, which
     is the mapping the meter and the stops already run on. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    quietUntil = performance.now() + 1400;

    const hash = a.getAttribute('href');
    if (!hash || hash.length < 2) return;
    const target = document.querySelector(hash);
    const range = target && target.closest('[data-range]');
    if (!range) return;

    e.preventDefault();
    stopIndex = -1;
    glideTo(Math.max(0, Math.min(maxScroll(),
      Math.round(range.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0)))));
    if (history.replaceState) history.replaceState(null, '', hash);
  }, true);
})();
