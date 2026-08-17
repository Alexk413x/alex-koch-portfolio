/* scenes.js — the home page's scroll timeline.
 *
 * Scroll position is the clock: one tall container, one sticky stage, one passive listener that writes a single
 * block of custom properties onto the stage. Every scene reads those properties from a static rule, so a scroll
 * frame touches one element instead of re-rendering a tree, and nothing animates on a wall clock.
 *
 * A scene is added by giving it its own envelope here and its own --oN / --yN / --bN properties in site.css; the
 * shape of the loop does not change. Scene 01 is the hero's exit; scene 02 is Cartographer arriving under it.
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

  /* ---- Cartographer's arrival ----
   *
   * THE SECTION ARRIVES, it does not merely slide up. Its stage is already rising behind the hero for a whole
   * viewport before it is seated, and none of that was read: it moved at exactly the speed of the scroll, which
   * is the one motion the eye discounts entirely. It now trails the scroll by a few dozen pixels and comes up to
   * strength across the same range the reactor is struck over, so the strike and the arrival read as one
   * hand-off rather than as two things that happen to overlap.
   *
   * The checks themselves are NOT part of this. They used to sit at a third opacity and light in turn as the pin
   * was scrubbed, and a list that cannot be read until it has been scrolled through is worse than no animation
   * at all. What moves is the section arriving; once it is here, nothing does.
   */
  const loopStage = document.getElementById('loop-stage');
  const loopScroll = document.getElementById('loop-scroll');

  const LOOP_LIFT = 80;   // px the section trails the scroll by when its arrival begins
  const LOOP_IN = .8;     // fraction of the arrival it is up to full strength over. Reaching 1 exactly as it
                          // seats would leave it still fading at the position it comes to rest in.

  function loop(y) {
    if (!loopStage || !loopScroll) return;
    // One viewport of arrival, ending where the section is seated: it begins the moment its top edge crosses the
    // bottom of the screen, which is the first frame any of it is visible.
    const q = ease((y - (loopScroll.offsetTop - vh)) / vh);
    loopStage.style.setProperty('--o2', clamp(q / LOOP_IN).toFixed(3));
    loopStage.style.setProperty('--y2', ((1 - q) * LOOP_LIFT).toFixed(1) + 'px');
  }

  function frame() {
    queued = false;
    const y = window.scrollY || window.pageYOffset || 0;
    morph(y);
    if (!shortLoop.matches) loop(y);
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

  // Hands both stages back to the stylesheet's static end states, which is what the reduced-motion rules expect.
  function clear() {
    for (const p of ['--o1', '--y1', '--b1', '--e1', '--cue-o', '--core-s', '--halo-x', '--ring-o']) {
      stage.style.removeProperty(p);
    }
    loopFinal();
  }

  // The seated section: full strength, no offset. The stylesheet's defaults, handed back by removing the writes.
  function loopFinal() {
    if (!loopStage) return;
    loopStage.style.removeProperty('--o2');
    loopStage.style.removeProperty('--y2');
  }

  /* A pinned, scrubbed morph needs a viewport tall enough to hold the scene. A landscape phone is 393px tall, so
     below that the section is a plain block showing the finished calculator. Matches the stylesheet's short query. */
  const short = window.matchMedia('(max-height: 620px)');

  /* Cartographer gives its pin back on a short or narrow window, and an arrival measured against a pin that is
     not there lands nowhere. Its own query, matching the stylesheet's, so the script stops driving the section
     exactly when the stylesheet stops pinning it. */
  const shortLoop = window.matchMedia('(max-height: 760px), (max-width: 1080px) and (max-height: 900px)');

  function apply() {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    if (reduced.matches || short.matches) { clear(); morphFinal(); return; }
    if (shortLoop.matches) loopFinal();
    measure();
    frame();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
  }

  apply();
  // addListener is the pre-2021 Safari spelling; without it the fallback is simply that the rig never re-arms.
  for (const q of [reduced, short, shortLoop]) {
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
