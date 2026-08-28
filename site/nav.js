/* nav.js — where the reader is, and the two things that read it.
 *
 * ONE reading line and ONE written property. --k is the playhead in section units, so 2.37 reads as "37% through
 * the third section"; every bar, and the current item's color, is a static rule off that one number. A scroll
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

  const K = window.AKKIT;
  const clamp = K.clamp01;

  /* Cartographer's running-graph position, from the file that owns the envelope. Guarded rather than assumed:
     scenes.js disarms itself under reduced motion and on a short window, and this must not take the nav down
     with it if the handle is ever absent. */
  function loopIdle() {
    const s = window.AKSCENE;
    if (!s || typeof s.cartographerIdleY !== 'function') return null;
    const y = s.cartographerIdleY();
    return y > 0 ? y : null;
  }

  /* The position where the reactor holds the frame alone, from the file that owns the exit envelope. Guarded
     the same way loopIdle() is: scenes.js disarms itself under reduced motion and on a short window, and the
     stepper must keep its beat when it has. */
  function heroAlone() {
    const s = window.AKSCENE;
    if (s && typeof s.heroAloneY === 'function') return s.heroAloneY();
    const cs = getComputedStyle(document.documentElement);
    const run = (parseFloat(cs.getPropertyValue('--scene-hold')) || 0)
      + (parseFloat(cs.getPropertyValue('--scene-exit')) || 0);
    return Math.round(run * (window.innerHeight || 0));
  }

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

  /* WHICH BAR EACH BEAT FEEDS, and how full standing on it makes that bar.
     scenes.js says a beat belongs to `#alex` and is worth half of it; the ORDER of the bars is this file's, and
     the two only ever meet through the href. Neither can be renumbered by a change to the other. */
  const barOf = {};
  items.forEach((it, i) => { barOf[(it.a.getAttribute('href') || '').slice(1)] = i; });

  function meter() {
    const s = window.AKSCENE;
    if (!s || !s.meter) return [];
    const out = [];
    s.meter().forEach((b) => {
      const bar = barOf[b.sec];
      if (bar === undefined) return;
      out.push({ at: b.at, k: bar + b.fill });
    });
    return out;
  }

  /* ---- the phone's two doors ----
   *
   * The bar has room for a wordmark and two buttons at 393px, not for six chapter labels and four marks. Each
   * button is the face of a panel that already exists: .links keeps its per-item progress bars and its
   * aria-current, .tools keeps its marks, and neither is restated as a second list that could disagree.
   *
   * `.js-nav` IS WHAT HIDES THEM. The stylesheet leaves both panels in the bar until this class lands, so a
   * reader with no JS gets the plain row rather than a button that opens nothing.
   */
  const panels = [
    { btn: nav.querySelector('.nav-now'), panel: nav.querySelector('.links') },
    { btn: nav.querySelector('.nav-more'), panel: nav.querySelector('.tools') },
  ].filter((p) => p.btn && p.panel);

  const nowName = nav.querySelector('.nav-now-name');
  // The divisor the collapsed progress rule reads, beside the --k it is measured against, so the two cannot
  // fall out of step with the list they both describe.
  nav.style.setProperty('--n', items.length);

  function openPanel(which) {
    for (const p of panels) {
      const on = p === which;
      p.panel.classList.toggle('is-open', on);
      p.btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
  }
  const closePanels = () => openPanel(null);

  for (const p of panels) {
    p.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPanel(p.panel.classList.contains('is-open') ? null : p);
    });
  }
  if (panels.length) {
    nav.classList.add('js-nav');
    // Anything outside a panel closes it, the anchor handler below included — a menu that survived the jump it
    // asked for would sit over the section it just named.
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#nav .links, #nav .tools')) closePanels();
      else if (e.target.closest('a, button')) closePanels();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanels(); });
  }

  /* Two pixels' worth of a bar, in k. See the current-item note in frame(). */
  const SETTLED = .002;

  let spans = [];
  let stops = [];
  let runway = 1;
  let current = -1;   // the bar the meter is filling
  let here = -1;      // the span the reader is actually inside; see the second reading in frame()

  /* THE SCROLL POSITION IS THE SCROLL POSITION. Nothing waits for the reader to stop and then moves the page for
     them; every scene is scrubbed, so scrolling through one already plays it. The keyboard keeps its stepping —
     a press is one discrete decision with no position of its own. */
  const GLIDE = 620;    // ms of travel for an ANCHOR JUMP. A destination the reader named is a hand-off rather
                        // than a scene to be played, so it keeps a flat duration whatever the distance.
  const NUDGE = 24;     // px. Two stops closer together than this are one stop as far as a press is concerned,
                        // and a reader this close to a mark is on it. The stop list uses it both ways round.

  // Keyboard stepping is a fine-pointer, roomy-window affordance; the same pair the stylesheet already uses.
  const roomy = window.matchMedia('(min-width: 821px) and (min-height: 501px)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* A STEP IS PLAYED, NOT JUMPED. Every beat on this page has a scene scrubbed across the scroll that reaches
     it, so a press has to travel at the rate that scene reads best at — which is the rate the rail in scenes.js
     already carries a gesture at. Taken from the file that owns it rather than restated: a copy of the rate here
     would have the page moving at two speeds depending on which hand the reader used.
     The fallback is the flat anchor duration, not a second set of numbers — the rig disarms itself under reduced
     motion and on a short window, and a fallback that quotes the real values is just a copy waiting to drift. */
  function stepMs(dist) {
    const s = window.AKSCENE;
    return s && typeof s.glideMs === 'function' ? s.glideMs(dist) : GLIDE;
  }

  let stopIndex = -1;   // the stop we are at or gliding toward, so a second press mid-flight advances by one
  let orbY = 0;         // the stop where the reactor holds the frame alone

  /* Section BOUNDARIES, not section boxes: each span runs to the next section's top, so the gaps between them
     belong to somebody. A playhead landing in a margin would otherwise report no section at all. */
  function measure() {
    const y = window.scrollY || window.pageYOffset || 0;
    const tops = items.map((it) => it.el.getBoundingClientRect().top + y);
    /* The last span ends at max scroll, not at the section's own bottom: the page bottoms out above it, so a
       fraction measured against the box could never reach 1 and the last section would read as unfinished
       however far down the reader got. */
    const end = Math.max(maxScroll(), items[items.length - 1].el.getBoundingClientRect().bottom + y);
    spans = tops.map((t, i) => [t, i + 1 < tops.length ? tops[i + 1] : end]);
    stops = buildStops();
    /* CACHED, because scrollHeight forces a synchronous layout and the readout below wanted it on every scroll
       frame — against a tree the scenes have just dirtied with a block of custom properties. Measured at 3.75ms
       of forced layout for a frame's worth of those reads, on a 16.7ms budget. */
    runway = Math.max(1, maxScroll());
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
       leaving and the reactor holds the frame on its own, with nothing else in it. The next press from there is
       what strikes the instrument.
       Taken from scenes.js, which owns the envelope and stops the scroll on the same position: computed here
       instead, an arrow press and a wheel gesture would land a reader on two different frames of one hand-off.
       The fallback is the end of the exit — where the words are gone, but before the ring holds still — for the
       case where the scene rig has disarmed itself and there is no handle to ask. */
    orbY = heroAlone();
    if (orbY > 24) list.push(orbY);

    /* ONE stop, and the graph's running position is deliberately NOT a second one. This section is a viewport
       tall, so anything between its top and the calculator's seats neither of them — suite_layout guards that,
       and it shipped broken once. The anchor click below still lands on the running graph, because a click is
       a destination the reader named rather than a place the page may come to rest on its own. */
    const loopScroll = document.getElementById('loop-scroll');
    if (loopScroll) {
      list.push(at(loopScroll));
    } else {
      const cart = document.getElementById('cartographer');
      if (cart) list.push(at(cart));
    }

    /* The calculator is two stops, not one, and they are the ENDS of its pin: the faceplate it arrives at and
       the shipped app it leaves as. The same two positions scenes.js stops the scroll on, so a press and a
       gesture land a reader on the same frame of one hand-off.
       Not a stop just past the trigger: that is a position the morph has been COMMITTED at rather than one it
       has finished turning at, so a press lands there and the calculator goes on moving for most of a second
       afterwards. */
    const appScroll = document.getElementById('app-scroll');
    const appStage = document.getElementById('app-stage');
    if (appScroll && appStage) {
      const pinTop = at(appScroll);
      const run = appScroll.offsetHeight - appStage.offsetHeight;
      list.push(pinTop);
      if (run > 0) list.push(Math.min(maxScroll(), pinTop + run));
    }

    /* ONE STOP PER ROLE, back again and meaningful this time. The roles are beats of a pinned viewer now, so a
       press both moves the page and changes what is showing — which is what a stop is for. Placed mid-beat
       rather than on its edge, so a pixel of rounding cannot land on the neighbor. */
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
    if (K.glideOwner() === 'nav' && stopIndex >= 0) {
      // Mid-flight, step from where we are HEADED. Measuring scrollY here would read a position between two
      // stops and round back to the one we just left.
      t = stopIndex + dir;
    } else {
      const y = K.scrollY();
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
    glideTo(stops[t], stepMs(stops[t] - K.scrollY()));
  }

  function frame() {
    const y = window.scrollY || window.pageYOffset || 0;
    const vh = window.innerHeight || 1;

    /* THE METER IS THE RAIL, not a line swept through section boxes.
     * Every beat says which bar it belongs to and how much of that bar standing on it earns, so the hero
     * seated is half of ALEX and the reactor fills it, the faceplate is half of CALCULATOR and the shipped app
     * fills it. Between two beats the value runs from one to the other, which is what makes the NEXT section
     * start lighting as the reader moves toward it rather than the moment a box's edge crosses a line.
     * The old sweep could not express any of that: a section was current when a point 42% down the viewport was
     * inside it, so a beat that sat mid-section read as most of a bar and one that sat at a section's top read
     * as none of it. Measured on the labs beat, --k was 4.945 of 5 the instant the reader arrived.
     */
    let k = 0;
    const m = meter();
    if (m.length) {
      if (y <= m[0].at) k = m[0].k;
      else if (y >= m[m.length - 1].at) k = m[m.length - 1].k;
      else {
        let i = 0;
        while (i < m.length - 1 && y >= m[i + 1].at) i++;
        const a = m[i], b = m[i + 1];
        k = a.k + (b.k - a.k) * ((y - a.at) / Math.max(1, b.at - a.at));
      }
    }

    nav.style.setProperty('--k', k.toFixed(4));

    /* Semantics carry the current item too, and the CSS keys off the attribute rather than a class, so there is
       one description of "current" instead of two that can disagree.
       CEIL, not floor: a bar that is part filled is the one being worked on. At k = 1.5 the reader has finished
       ALEX and is on their way into CARTOGRAPHER, and CARTOGRAPHER is what the header should say — floor would
       hold the previous name until the next bar was completely full.
       SETTLED is why the epsilon: the page rests on subpixel positions, so standing exactly on the reactor beat
       measured k = 1.0003 and ceil handed the name to CARTOGRAPHER when the reader had not left ALEX at all.
       A beat is about 950px of page to a whole bar, so two thousandths is two pixels of tolerance. */
    const i = Math.min(items.length - 1, Math.max(0, Math.ceil(k - SETTLED) - 1));
    if (i !== current) {
      if (current >= 0) items[current].a.removeAttribute('aria-current');
      items[i].a.setAttribute('aria-current', 'true');
      current = i;
    }

    /* ---- and the other question ----
     *
     * WHERE THE READER IS, which is not what the meter above answers. The meter is the rail: it names the
     * section being moved TOWARD, so CONTACT lights while the reader is still inside LABS — deliberate for a
     * row of six bars, where the next one filling is the useful signal. Collapsed to a single label on a phone
     * that reads as simply wrong, because one label is being asked "which section am I in".
     *
     * So the phone reads the SPANS instead: which one contains the scroll position, and how far through it the
     * reader has got. Not a second measurement of the same thing — the spans are section boundaries and the
     * meter is the beat rail, and nav.js has always measured both.
     */
    if (!spans.length) return;   // a scroll landing before the first measure() has nothing to read
    /* A READING LINE, NOT THE VIEWPORT'S TOP EDGE. 42% down the screen, dropping to the bottom over the LAST
       viewport of scroll. Both halves are load-bearing, and so is the fact that the drop is confined:
       - the offset, because a section is the one you are IN when it holds the screen, not when its top edge
         crosses zero — at the edge the label flips a third of a screen after the section has taken over;
       - the drop, because the final viewport is never scrolled PAST, so the last section's top always sits
         above max scroll (contact starts at 7044 of a 6467 max on a 393x852 phone) and a line at any fixed
         depth could never enter it. This one reaches the document's bottom exactly at max scroll, which is
         what lets CONTACT light and its rule fill;
       - confined to the last viewport, because ramping across the whole page put the line 73% down at half
         scroll, which named EXPERIENCE while the calculator still filled the screen.
       The same trap the old sweep hit; the note it left behind is why it did not have to be found twice. */
    const line = y + vh * (.42 + .58 * clamp((y - (runway - vh)) / vh));
    let h = 0;
    while (h < spans.length - 1 && line >= spans[h + 1][0]) h++;
    // Measured off the line too, not off `y`: taken from the raw scroll it would sit pinned at 0 for the third
    // of a screen between the label flipping and the section's top arriving.
    const sp = clamp((line - spans[h][0]) / Math.max(1, spans[h][1] - spans[h][0]));
    // Two properties rather than one playhead: the trigger's rule wants the fraction alone and the panel's
    // wants the index added back, and CSS floor() is too new to lean on for splitting one number into both.
    nav.style.setProperty('--h', h);
    nav.style.setProperty('--sp', sp.toFixed(4));
    if (h === here) return;
    if (here >= 0) items[here].a.removeAttribute('data-here');
    items[h].a.setAttribute('data-here', 'true');
    here = h;
    if (nowName) nowName.textContent = items[h].a.textContent.trim();
  }

  const maxScroll = () =>
    Math.max(0, document.documentElement.scrollHeight - (window.innerHeight || 1));

  // Under 8px is not a journey. The kit's tween owns the snap stand-down and the per-frame instant scroll.
  const stopGlide = K.stopGlide;
  const glideTo = (y, ms) => K.glideTo(y, { ms: ms || GLIDE, minDist: 8, owner: 'nav' });

  /* A scroll updates the readout and NOTHING ELSE. No settle timer, no decision about where the reader ought to
     have stopped. The stepper's index is dropped, though: once the page has been scrolled by hand, the stop it
     was last heading for says nothing about where the next press should start from. */
  function onScroll() {
    frame();
    if (!K.busy()) stopIndex = -1;
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
    busy: K.busy,
  };

  remeasure();
  K.onScroll(onScroll);
  /* The kit's resize channel is the resize event, the load event and a ResizeObserver on the body. Fonts landing
     after this runs, an image sizing itself, the rack building and a lab object laying out all move every stop
     below them and none of them fires a resize. */
  K.onResize(remeasure);

  /* THE WHEEL IS THE READER'S, MOMENTUM AND ALL, and it is now the only thing that decides where they end up.
     The one job left here is to get out of the way: a hand on the wheel while a keyboard step is still gliding
     cancels the glide, which is the difference between an assist and having the page taken off you.
     Capture, so nothing further down can swallow it. */
  for (const ev of ['wheel', 'touchmove', 'pointerdown']) {
    window.addEventListener(ev, stopGlide, { passive: true, capture: true });
  }

  /* ---- the arrow keys ----
   *
   * One press, one stop. Arrows only: PageUp/PageDown, Home/End and the space bar keep their native behavior,
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
    /* THE CATALOG OWNS SIDEWAYS ON ITS OWN SCREEN. Left and right step its rack there; up, down and space
       still move the page's rail, so the reader can always leave. Asked rather than assumed, so this file does
       not have to know which section that is or when it is on screen. */
    const side = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    if (side && window.AKCAT && window.AKCAT.sideways && window.AKCAT.sideways()) return;
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
    if (!target) return;
    const range = target.closest('[data-range]');

    e.preventDefault();
    stopIndex = -1;

    const top = (el) => Math.round(el.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0));
    let y;

    if (range) {
      /* CARTOGRAPHER IS THE ONE SCENE WHOSE TOP IS NOT ITS DESTINATION. The top of its range is the section
         arriving with nothing drawn — a reader who asks for Cartographer and is put there sees an empty frame
         and has to scroll to find out what they clicked. Land on the running graph instead, which is what the
         section is FOR. Every other range still goes to its top, because for those the top is the scene. */
      y = top(range);
      if (hash === '#cartographer') y = loopIdle() || y;
    } else {
      /* A PLAIN SECTION, WHICH THIS USED TO HAND BACK TO THE BROWSER. Native anchor scrolling honors
         scroll-margin-top, and that 84px is what stops a section's title landing under the fixed bar — so the
         clearance is read from the stylesheet rather than restated, and applied here instead.
         THE LAST SECTION IS REACHED BY GOING TO THE END. CONTACT's top IS max scroll on a phone, so taking the
         clearance off it left the reader 84px short of the bottom with the page still able to move — which is
         what a tap on CONTACT looked like. Nothing below it needs revealing, so the honest destination is the
         document's own end. */
      const bottom = top(target) + Math.round(target.getBoundingClientRect().height);
      y = bottom >= document.documentElement.scrollHeight - 1
        ? maxScroll()
        : top(target) - (parseFloat(getComputedStyle(target).scrollMarginTop) || 0);
    }

    glideTo(Math.max(0, Math.min(maxScroll(), y)));
    if (history.replaceState) history.replaceState(null, '', hash);
  }, true);
})();
