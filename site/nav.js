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
     one occupies is its [data-range] container.
     `sec` is the section ITSELF and is a different question: the range says how much scroll a link owns, the
     section says how much of it is on screen right now, and the carry needs the second one. */
  const items = links.map((a, i) => {
    a.style.setProperty('--i', i);
    const target = document.querySelector(a.getAttribute('href'));
    return { a, sec: target, el: target && (target.closest('[data-range]') || target) };
  }).filter((it) => it.el);

  if (!items.length) return;

  let spans = [];
  let stops = [];
  let current = -1;
  let queued = false;

  /* THE SCROLL POSITION IS THE SCROLL POSITION. Nothing waits for the reader to stop and then moves the page for
     them; every scene is scrubbed, so scrolling through one already plays it. The keyboard keeps its stepping —
     a press is one discrete decision with no position of its own. */
  const GLIDE = 620;    // ms of travel for a keyboard step or an anchor jump. Long enough to read as a hand-off,
                        // short enough not to feel taken over.
  const NUDGE = 24;     // px. Two stops closer together than this are one stop as far as a press is concerned,
                        // and a reader this close to a mark is on it. The stop list uses it both ways round.

  // Keyboard stepping is a fine-pointer, roomy-window affordance; the same pair the stylesheet already uses.
  const roomy = window.matchMedia('(min-width: 821px) and (min-height: 501px)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  let glide = 0;        // the running rAF, and the flag that says this scrolling is ours rather than theirs
  let stopIndex = -1;   // the stop we are at or gliding toward, so a second press mid-flight advances by one
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
    const sorted = list.sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > NUDGE);

    /* A scene's exit runway is not content — nothing in it to be stranded short of — so gaps are measured from
       where the [data-range] ENDS. From its last beat instead, real content after the scene goes uncovered. */
    const scenes = Array.prototype.slice.call(document.querySelectorAll('[data-range]')).map((el) => {
      const t = el.getBoundingClientRect().top + y;
      return [t, t + el.offsetHeight];
    });
    function afterScene(a) {
      let end = a;
      for (const s of scenes) if (a >= s[0] - NUDGE && a < s[1]) end = Math.max(end, s[1]);
      return end;
    }

    /* No gap wider than a screen, so nothing sits where no press can reach it. Plus a NUDGE of slack: a section
       exactly 100dvh tall rounds to a gap of screen + 1, and filling that drops a stop mid-hand-off. */
    const screen = window.innerHeight || 1;
    const out = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const from = Math.min(afterScene(sorted[i - 1]), sorted[i]);
      const gap = sorted[i] - from;
      if (gap > screen + NUDGE) {
        const n = Math.ceil(gap / screen);
        for (let s = 1; s < n; s++) out.push(Math.round(from + gap * s / n));
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
    };
    glide = requestAnimationFrame(step);
  }

  /* A scroll updates the readout and NOTHING ELSE. No settle timer, no decision about where the reader ought to
     have stopped. The stepper's index is dropped, though: once the page has been scrolled by hand, the stop it
     was last heading for says nothing about where the next press should start from. */
  function onScroll() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(frame);
    }
    if (!glide) stopIndex = -1;
  }

  function remeasure() {
    measure();
    frame();
  }

  /* The stop list, for anything that needs to know where the page can come to rest. The measurements are all
     derived — section spans, the morph trigger, the roles, the gap filling — so restating them anywhere else is
     a second description that can drift. The harness reads this rather than recomputing the geometry. */
  /* `busy` is the page moving itself — a keyboard step or an anchor jump still in flight. A reader cannot see
     the difference between that and a page at rest, but anything measuring one can be fooled by it. */
  window.AKNAV = {
    stops: () => stops.slice(),
    index: () => stopIndex,
    section: () => current,
    busy: () => glide !== 0,
  };

  remeasure();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', remeasure);
  // Web fonts land after this runs and reflow every section under the fold, so the first measurement is stale.
  window.addEventListener('load', remeasure);

  /* THE WHEEL IS THE READER'S, MOMENTUM AND ALL, and it is now the only thing that decides where they end up.
     The one job left here is to get out of the way: a hand on the wheel while a keyboard step is still gliding
     cancels the glide, which is the difference between an assist and having the page taken off you.
     Capture, so nothing further down can swallow it. */
  for (const ev of ['wheel', 'touchmove', 'pointerdown']) {
    window.addEventListener(ev, stopGlide, { passive: true, capture: true });
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

  /* An anchor click names a destination the browser would get wrong for the pinned scenes.
     A SCENE INSIDE A STICKY STAGE HAS NO PAGE POSITION OF ITS OWN. #alex resolves to where the stage comes to
     rest, which is the END of the hero's runway — the words have already climbed out and the frame is empty, so
     the browser's own jump lands on nothing. #app has the same shape. The page position is the RANGE's, which
     is the mapping the meter and the stops already run on. */
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;

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
