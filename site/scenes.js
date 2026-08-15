/* scenes.js — the home page's scroll timeline.
 *
 * Scroll position is the clock: one tall container, one sticky stage, one passive listener that writes a single
 * block of custom properties onto the stage. Every scene reads those properties from a static rule, so a scroll
 * frame touches one element instead of re-rendering a tree, and nothing animates on a wall clock.
 *
 * Scene 01 owns the whole runway today. A scene is added by giving it its own envelope here and its own --oN /
 * --yN / --bN properties in site.css; the shape of the loop does not change.
 */
(function () {
  const stage = document.getElementById('stage');
  if (!stage) return;

  /* THE TEXT LEAVES, THE INSTRUMENT STAYS AND THEN GOES. Two envelopes off one scroll, deliberately out of
     phase: the words climb out of the top of the frame under their own blur while the core and the ring hold,
     and only once the words are gone do those fade, across the handover to the next section. One envelope for
     both made the whole scene dissolve in place, which reads as a cross-fade rather than as an exit. */
  const TRAVEL = 1;         // viewport heights the words rise. A fraction of the frame only fades in place;
                            // clearing the top is what makes it read as leaving.
  const BLUR = 8;           // px of defocus at full exit
  const TEXT_HOLD = .45;    // fraction of the exit the words stay opaque for, so they are seen to leave
  const CUE_OUT = .22;      // fraction of the words' exit over which the scroll arrow is simply gone. It is an
                            // invitation, and an invitation that blurs and rides off the top competes with the
                            // instrument for the eye at exactly the wrong moment.
  const CORE_SHRINK = .88;  // how far the core collapses into itself as it leaves
  const HALO_SPREAD = 420;  // viewBox units each edge of the ring travels OUTWARD. The band opens and clears the
                            // frame sideways rather than dimming in place, so the scene is struck, not dissolved.
  /* In units of the WORDS' exit, and over one: the instrument does not begin to leave until they are gone and
     a stop has been made on it. That stop is the whole point — the hero resolves to the reactor alone, with
     nothing else in the frame, and the next press is what strikes it. */
  const RING_START = 1.12;
  const RING_SPAN = .8;     // viewport heights it takes to go, finishing before the next section arrives

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let hold = .5, exit = .7, vh = 1, queued = false;

  /* Reads the scene runway back off the stylesheet. site.css is the only place --scene-hold and --scene-exit are
     written, so the height the stage stays pinned for and the range the exit is scrubbed across cannot disagree —
     restating either number here is how a rig like this ends up scrubbing past the end of its own container. */
  function measure() {
    const cs = getComputedStyle(document.documentElement);
    hold = parseFloat(cs.getPropertyValue('--scene-hold')) || 0;
    exit = parseFloat(cs.getPropertyValue('--scene-exit')) || 1;
    trip = parseFloat(cs.getPropertyValue('--morph-trip')) || .14;
    vh = window.innerHeight || 1;
  }

  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Smoothstep. The scrub is eased exactly once, here — nothing this writes carries a CSS transition as well.
  const ease = (t) => { const x = clamp(t); return x * x * (3 - 2 * x); };

  /* ---- the calculator morph ----
   *
   * ONE DOM tree and ONE written property. Each key carries the rectangle it occupies on the HP faceplate and
   * the rectangle it occupies in the shipped app; site.css interpolates both, and every colour, from the single
   * --m scalar written here. That is the whole reason to do it this way: a scroll frame touches one attribute
   * on one element, and the transition has exactly one description rather than half in CSS and half in JS.
   */
  const morphStage = document.getElementById('app-stage');
  const morphScroll = document.getElementById('app-scroll');

  /* ONE SCROLL PLAYS IT, THE NEXT ONE LEAVES.
   *
   * The morph used to be scrubbed: --m tracked the scroll position across 1.8 viewport heights, with a dead
   * zone at each end so the two pure states were wide enough to stop on. That is 40% of the runway spent moving
   * nothing, and the mechanism could still be left stranded halfway through by a reader who simply stopped.
   *
   * Now the scroll chooses only a DIRECTION. Crossing the trigger commits the morph and it runs to completion on
   * its own clock, so it always lands on a pure state and cannot be held part-played — the holds are not needed,
   * because there is no longer a position that means "halfway". The remaining pin is the way out.
   */
  const MORPH_MS = 900;
  const RELEASE = .57;    // where scrolling back up releases it, as a fraction of the commit point. Two lines
                          // rather than one, so a reader parked on the trigger cannot flap the mechanism back
                          // and forth on a pixel of movement.
  let trip = .14;         // read from the stylesheet in measure(); nav.js reads the same declaration

  let mValue = 0, mTarget = 0, mFrom = 0, mStart = 0, mAnim = 0;

  function writeMorph(v) {
    morphStage.style.setProperty('--m', v.toFixed(4));
    morphStage.classList.toggle('is-new', v > .5);
    /* BOTH calculators are usable, each at its own resting state. Keys are inert only while plates are in
       flight, so a scroll-past cannot half-press one; the faceplate is as clickable as the app is. */
    const atOld = v < .04, atApp = v > .96;
    morphStage.classList.toggle('is-live', atOld || atApp);
    morphStage.classList.toggle('is-old', atOld);
    morphStage.classList.toggle('is-app', atApp);
  }

  function tick(ts) {
    if (!mStart) mStart = ts;
    const p = clamp((ts - mStart) / MORPH_MS);
    mValue = mFrom + (mTarget - mFrom) * ease(p);
    writeMorph(mValue);
    mAnim = p < 1 ? requestAnimationFrame(tick) : 0;
  }

  /* Re-based rather than resumed when the target flips, so a reader who reverses mid-flight gets the morph
     running back from where it actually is instead of jumping to where it would have been. */
  function setMorph(target) {
    if (target === mTarget) return;
    mTarget = target;
    mFrom = mValue;
    mStart = 0;
    if (!mAnim) mAnim = requestAnimationFrame(tick);
  }

  function morph(y) {
    if (!morphStage || !morphScroll) return;
    const run = morphScroll.offsetHeight - morphStage.offsetHeight;
    const p = run > 0 ? (y - morphScroll.offsetTop) / run : 1;
    if (p >= trip) setMorph(1);
    else if (p <= trip * RELEASE) setMorph(0);
  }

  // Everything reaches its shipped state and stays there: no pin, no trigger.
  function morphFinal() {
    if (!morphStage) return;
    if (mAnim) { cancelAnimationFrame(mAnim); mAnim = 0; }
    mValue = mTarget = mFrom = 1;
    writeMorph(1);
  }

  /* ---- the loop ----
   *
   * TWO BEATS, COMMITTED, because the argument is the CONTRAST. A green run walks 02, 03, 04 and never reaches a
   * model stage; a flagged one wakes 05 and 06. Told rather than shown, that is a sentence under a grid; shown,
   * the reader watches the accent stay away and then arrive.
   *
   * Same rig as the calculator and for the same reason: the scroll picks a beat, the beat plays to completion on
   * its own clock. There is no scroll position that means "halfway through stage 3", so there is nothing to hold
   * still for and no dead runway to hold it in.
   */
  const loopStage = document.getElementById('loop-stage');
  const loopScroll = document.getElementById('loop-scroll');
  const stages = Array.prototype.slice.call(document.querySelectorAll('#loop .stage'));
  const runOut = document.getElementById('loop-run');
  const aiOut = document.getElementById('loop-ai');
  const aiCell = document.getElementById('loop-ai-cell');
  const costOut = document.getElementById('loop-cost');

  const BEAT_MS = 260;      // per stage, so a run reads as a run rather than as a state change
  const GREEN = [1, 2, 3];  // 01 already happened when the test was authored
  const FLAG = [1, 2, 3, 4, 5];

  let beat = -1, beatAnim = 0, beatT0 = 0;

  function paint(path, reached, label) {
    let touched = 0;
    stages.forEach((el, i) => {
      const at = path.indexOf(i);
      const lit = i === 0 ? true : (at !== -1 && at < reached);
      el.classList.toggle('lit', lit);
      el.classList.toggle('done', i === 0);
      if (lit && i !== 0 && el.classList.contains('ai')) touched++;
    });
    if (runOut) runOut.textContent = label;
    if (aiOut) aiOut.textContent = touched + ' of 3';
    if (aiCell) aiCell.classList.toggle('hot', touched > 0);
    if (costOut) costOut.textContent = touched ? 'Per flag' : 'Nothing';
  }

  function playBeat(n) {
    if (n === beat) return;
    beat = n;
    if (beatAnim) { cancelAnimationFrame(beatAnim); beatAnim = 0; }
    const path = n >= 2 ? FLAG : GREEN;
    const label = n <= 0 ? 'Ready' : (n === 1 ? 'Green' : 'Flagged');
    if (n <= 0) { paint(path, 0, label); return; }
    beatT0 = 0;
    const step = (ts) => {
      if (!beatT0) beatT0 = ts;
      const reached = Math.min(path.length, Math.floor((ts - beatT0) / BEAT_MS) + 1);
      paint(path, reached, label);
      beatAnim = reached < path.length ? requestAnimationFrame(step) : 0;
    };
    beatAnim = requestAnimationFrame(step);
  }

  function loop(y) {
    if (!loopStage || !loopScroll || !stages.length) return;
    const run = loopScroll.offsetHeight - loopStage.offsetHeight;
    const p = run > 0 ? (y - loopScroll.offsetTop) / run : 1;
    playBeat(p >= trip * 3 ? 2 : (p >= trip ? 1 : 0));
  }

  // Reduced motion and short viewports get the flagged run whole: every stage lit, the model ones in accent.
  function loopFinal() {
    if (!stages.length) return;
    if (beatAnim) { cancelAnimationFrame(beatAnim); beatAnim = 0; }
    beat = 2;
    paint(FLAG, FLAG.length, 'Flagged');
  }

  function frame() {
    queued = false;
    const y = window.scrollY || window.pageYOffset || 0;
    morph(y);
    loop(y);
    const e = ease((y - hold * vh) / (exit * vh));

    /* Opaque while it climbs, fading only once it is most of the way out. Fading from the first pixel would
       make it disappear before it had visibly gone anywhere, which is the whole thing this avoids. */
    stage.style.setProperty('--o1', (1 - ease((e - TEXT_HOLD) / (1 - TEXT_HOLD))).toFixed(3));
    stage.style.setProperty('--y1', (-TRAVEL * vh * e).toFixed(1) + 'px');
    stage.style.setProperty('--b1', (BLUR * e).toFixed(2) + 'px');
    stage.style.setProperty('--e1', e > .5 ? 'none' : 'auto');
    stage.style.setProperty('--cue-o', (1 - ease(e / CUE_OUT)).toFixed(3));

    /* The core and the ring are SIBLINGS of the scene, not children, so they do not inherit its fade and can be
       given a curve of their own. It starts only once the words are clear, which leaves a stop where the
       reactor holds the frame by itself, and runs on past the end of the pin so the stage carries them off
       still lit instead of sliding away already dark. */
    const r = ease((y - (hold + exit * RING_START) * vh) / (RING_SPAN * vh));
    stage.style.setProperty('--core-s', (1 - CORE_SHRINK * r).toFixed(4));
    stage.style.setProperty('--halo-x', (HALO_SPREAD * r).toFixed(1) + 'px');
    stage.style.setProperty('--ring-o', (1 - r).toFixed(3));
  }

  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  }

  function onResize() {
    measure();
    frame();
  }

  // Hands the stage back to the stylesheet's static end state, which is what the reduced-motion rules expect.
  function clear() {
    for (const p of ['--o1', '--y1', '--b1', '--e1', '--cue-o', '--core-s', '--halo-x', '--ring-o']) {
      stage.style.removeProperty(p);
    }
  }

  /* A pinned, scrubbed morph needs a viewport tall enough to hold the scene. A landscape phone is 393px tall, so
     below that the section is a plain block showing the finished calculator. Matches the stylesheet's short query. */
  const short = window.matchMedia('(max-height: 620px)');

  function apply() {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    if (reduced.matches || short.matches) { clear(); morphFinal(); loopFinal(); return; }
    measure();
    frame();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
  }

  apply();
  // addListener is the pre-2021 Safari spelling; without it the fallback is simply that the rig never re-arms.
  for (const q of [reduced, short]) {
    if (q.addEventListener) q.addEventListener('change', apply);
    else if (q.addListener) q.addListener(apply);
  }

  /* Sections below the stage rise in once, on arrival. An observer rather than the scroll handler above: that
     one has to run every frame to scrub, this only has to fire once per element, and unobserving after the
     first hit means a long page costs nothing to scroll back up. */
  const marked = document.querySelectorAll('[data-reveal]');
  if (!marked.length) return;

  if (reduced.matches || !('IntersectionObserver' in window)) {
    marked.forEach((el) => el.classList.add('shown'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('shown');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });

  marked.forEach((el) => io.observe(el));
})();
