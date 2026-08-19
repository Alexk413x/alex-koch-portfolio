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
  let hold = .5, exit = .7, vh = 1, queued = false, loopRun = .9;

  /* Reads the scene runway back off the stylesheet. site.css is the only place --scene-hold and --scene-exit are
     written, so the height the stage stays pinned for and the range the exit is scrubbed across cannot disagree —
     restating either number here is how a rig like this ends up scrubbing past the end of its own container. */
  function measure() {
    const cs = getComputedStyle(document.documentElement);
    hold = parseFloat(cs.getPropertyValue('--scene-hold')) || 0;
    exit = parseFloat(cs.getPropertyValue('--scene-exit')) || 1;
    trip = parseFloat(cs.getPropertyValue('--morph-trip')) || .14;
    /* NOT `|| .9`. Zero is a legitimate pin length — it is the one that leaves no stationary scroll at all — and
       a falsy test reads it as "absent" and substitutes most of a screen of it. */
    const run = parseFloat(cs.getPropertyValue('--loop-run'));
    loopRun = Number.isFinite(run) ? run : .9;
    vh = window.innerHeight || 1;
    shapeLoop();
  }

  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Smoothstep. The scrub is eased exactly once, here — nothing this writes carries a CSS transition as well.
  const ease = (t) => { const x = clamp(t); return x * x * (3 - 2 * x); };

  /* Its inverse: the input that produces a given output. Needed because the graph is finished at --gb .91 rather
     than at 1, and the position that corresponds to is a question about the easing, not about the runway. */
  const unease = (v) => .5 - Math.sin(Math.asin(1 - 2 * clamp(v)) / 3);

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
  /* FORWARD AND BACK ARE NOT THE SAME LENGTH, because they are not the same act. Arriving, the reader is coming
     to a stop and the calculator has the whole pin below it to turn in. Leaving upward, they are already going,
     and the reverse has only the space between the release and the pin's top to finish in — at 900ms it was
     still turning while the section slid off, or never started. Half the time is what fits that space. */
  const MORPH_MS = 900;
  const MORPH_BACK_MS = 460;
  const RELEASE = .57;    // where scrolling back up releases it, as a fraction of the commit point. Two lines
                          // rather than one, so a reader parked on the trigger cannot flap the mechanism back
                          // and forth on a pixel of movement.
  let trip = .14;         // read from the stylesheet in measure(); nav.js reads the same declaration

  let mValue = 0, mTarget = 0, mFrom = 0, mStart = 0, mAnim = 0, mSettle = 0;

  /* THE MORPH IS GUARANTEED TO LAND, on a timer as well as on frames.
     It plays on requestAnimationFrame, and Chrome runs NO frames in a window that is not visible — so a reader
     who switches away mid-morph comes back to it frozen part-played. That is not just an unfinished animation:
     the keypad is pointer-events: none until writeMorph sets is-live, which only happens at a settled value, so
     a stalled morph leaves every key on the calculator dead to hover and to clicks.
     Timers keep running where frames do not, so one set a little past the morph's own length finishes the job
     whatever the frame loop did. It is a backstop, not the mechanism: a morph that ran normally clears it. */
  function settleSoon() {
    clearTimeout(mSettle);
    mSettle = setTimeout(() => {
      mSettle = 0;
      if (mValue === mTarget) return;
      if (mAnim) { cancelAnimationFrame(mAnim); mAnim = 0; }
      mValue = mFrom = mTarget;
      writeMorph(mValue);
    }, MORPH_MS + 250);
  }

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
    const p = clamp((ts - mStart) / (mTarget ? MORPH_MS : MORPH_BACK_MS));
    mValue = mFrom + (mTarget - mFrom) * ease(p);
    writeMorph(mValue);
    if (p < 1) { mAnim = requestAnimationFrame(tick); return; }
    mAnim = 0;
    clearTimeout(mSettle); mSettle = 0;
  }

  /* Re-based rather than resumed when the target flips, so a reader who reverses mid-flight gets the morph
     running back from where it actually is instead of jumping to where it would have been. */
  function setMorph(target) {
    if (target === mTarget) return;
    mTarget = target;
    mFrom = mValue;
    mStart = 0;
    settleSoon();
    if (!mAnim) mAnim = requestAnimationFrame(tick);
  }

  function morph(y) {
    if (!morphStage || !morphScroll) return;
    const run = morphScroll.offsetHeight - morphStage.offsetHeight;
    const p = run > 0 ? (y - morphScroll.offsetTop) / run : 1;
    if (p >= trip) setMorph(1);
    else if (p <= trip * RELEASE) setMorph(0);
  }

  /* THE PAD'S STATE IS ESTABLISHED, not inherited. --m defaults to 1 in the stylesheet so that no-JS and reduced
     motion get the shipped app, and setMorph() early-returns when the target is unchanged — so on a normal load
     the first write never happened and the CSS default stood. The pad sat in the APP layout while every other
     signal said faceplate, and crossing the trigger then snapped it back to the faceplate before morphing it
     forward again. Reading the scroll position once, here, is what makes the resting state agree with itself. */
  function morphInit(y) {
    if (!morphStage || !morphScroll) return;
    const run = morphScroll.offsetHeight - morphStage.offsetHeight;
    const p = run > 0 ? (y - morphScroll.offsetTop) / run : 1;
    mValue = mTarget = mFrom = p >= trip ? 1 : 0;
    writeMorph(mValue);
  }

  // Everything reaches its shipped state and stays there: no pin, no trigger.
  function morphFinal() {
    if (!morphStage) return;
    clearTimeout(mSettle); mSettle = 0;
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
   * The WORDS are not part of this. They used to sit at a third opacity and light in turn as the pin was
   * scrubbed, and a list that cannot be read until it has been scrolled through is worse than no animation at
   * all. What moves is the section arriving, and the flow graph beside it building.
   *
   * THE GRAPH IS ONE SCALAR, AND IT COMES BACK DOWN. --g rises across the approach so the flow extends as the
   * section enters frame, holds while it is seated, then falls again as it leaves — which plays the same build
   * backwards into a collapse. There is no separate exit description that can disagree with the entrance, and a
   * reader who reverses gets the graph running back from where it actually is, because position is the clock.
   */
  const loopStage = document.getElementById('loop-stage');
  const loopScroll = document.getElementById('loop-scroll');

  const LOOP_LIFT = 80;   // px the section trails the scroll by when its arrival begins
  const LOOP_IN = .8;     // fraction of the arrival it is up to full strength over. Reaching 1 exactly as it
                          // seats would leave it still fading at the position it comes to rest in.

  /* IN VIEWPORT HEIGHTS, AND TIMED AGAINST WHERE THE GRAPH ACTUALLY IS, not against the section's runway. The
     section is a screen tall and the graph sits in the middle of it, so its top edge does not cross the bottom
     of the window until the approach is nearly half over and it has left through the top again half a screen
     after the section seats. Run either envelope across the whole runway instead and most of the build happens
     below the fold and most of the collapse above it — which was the first shape of this and it read as a graph
     that was simply already there and then simply gone. */
  /* STARTS LATE AND ENDS ON THE SEAT. It still waits until half the graph is above the fold — the graph's top
     edge does not cross the bottom of the window until .31 of the approach, and a build beginning before that
     spends its first third where nobody can see it.
     What changed is the other end. The build used to run a fifth of a screen PAST the seated position, which put
     the whole of that inside the pin: scrolling back UP out of the section, the graph un-built for most of a
     third of a screen while the section itself did not move at all. That is the same two-beat shape the
     departure had, on the entering side, and it only shows going up.
     Ending the build where the section seats means every frame of it happens while the section is travelling, in
     both directions. The cost is real and is the point: the build now fits in .57 of a screen rather than .98,
     so it plays about 1.7x faster against the same scroll. */
  const BUILD_AT = .45;     // into the approach, where half the graph is above the bottom of the window
  /* WHEN THE LAST SCREEN LANDS, WHICH IS NOT WHEN --gb REACHES 1. The furthest element delays by .75 of the
     scalar and animates over a .16 window, so every screen is home at --gb .91 and the rest of the envelope is
     scrolling during which nothing on the graph moves. Smoothstep is flattest exactly there, so that tail was
     most of a fifth of a screen.
     Timing the strike off the same threshold closes it: the first element leaves as the last one arrives, and
     the graph is whole at ONE position instead of across a window that reads as the page having stopped
     responding. The settle below aims at that position, and the gate reads the same constant. */
  const WHOLE = .91;

  /* THE STOPPING POINT IS THE PIN'S MIDPOINT, and the build's length is whatever it takes to land there.
     Both of these used to be written down, and the stationary scroll either side of the point came out unequal
     because nothing made them agree — 20px above and 36px below, for no reason other than two constants having
     been chosen separately. Deriving the span from the pin makes the point central by construction, so the
     scroll stands still for the same distance whichever way the reader leaves, and --loop-run stays the one
     place the runway is declared. */
  let fallAt = .03, buildSpan = .71;

  function shapeLoop() {
    fallAt = loopRun / 2;
    buildSpan = (1 + fallAt - BUILD_AT) / unease(WHOLE);
  }
  /* And the value at which the last one has GONE: the largest --df in the markup, .46, plus the STRIKE's window
     of .145. It is not WHOLE, on two counts — the collapse is ordered back to front and packed tighter, and each
     element goes in a shorter window than it arrived in. Both numbers are the stylesheet's, and both are wrong
     the moment a --d, a --df or either rate in the --p expression moves without this following. */
  const STRUCK = .605;
  /* Viewport heights either side of the stopping point that still count as whole. The circuit needs a band to run in, and
     that band has to be CENTRED on the position the settle parks the reader at — read off --g instead it opened
     a few pixels before the resting point and closed most of a tenth of a screen after it, so a nudge upward put
     the circuit out while the same nudge downward did nothing. Scroll distance, because that is what the reader
     is moving; --g peaks after the target rather than on it. */
  const WHOLE_BAND = .06;

  function loop(y) {
    if (!loopStage || !loopScroll) return;
    // One viewport of arrival, ending where the section is seated: it begins the moment its top edge crosses the
    // bottom of the screen, which is the first frame any of it is visible.
    const top = loopScroll.offsetTop;
    const q = ease((y - (top - vh)) / vh);
    loopStage.style.setProperty('--o2', clamp(q / LOOP_IN).toFixed(3));
    loopStage.style.setProperty('--y2', ((1 - q) * LOOP_LIFT).toFixed(1) + 'px');

    const built = ease((y - (top - vh * (1 - BUILD_AT))) / (vh * buildSpan));
    /* THE COLLAPSE IS THE DEPARTURE. It begins where the build lands, which is a hair before the pin lets go, and
       is spanned so the LAST element leaves exactly as the section clears the top of the window — the section
       finishes going and the graph finishes collapsing on the same frame, instead of the graph fading out over
       pinned scroll and the section only then starting to move.
       The clear point is the pin's release plus one viewport, because the stage is a viewport tall. Divided by
       STRUCK so that it is the LAST ELEMENT'S EXIT that lands there, not the envelope's end — the source phone
       is still visibly going as the section leaves, rather than starting its exit off the top of the window and
       finishing where nobody can see it.
       LINEAR, where the build is eased. The section's departure is already linear in scroll, so easing this on
       top of it eases the same motion twice: the scalar crawled through its first third, which stretched the
       gap between the first two ranks to four times the gap between the last two and made the collapse read as
       slow at exactly the moment it should be quickest. Each element now takes the same distance as every
       other. */
    const struck = clamp((y - (top + vh * fallAt)) / (vh * (loopRun + 1 - fallAt) / STRUCK));
    /* TWO SCALARS, because arriving and leaving are two orders. Each element delays off --gb for the one and
       --gf for the other, so the top row can lead both — on one scalar the last thing in is the first thing out.
       --g is still written for the gate below: it is the pair combined, which is what "is the graph whole" means. */
    loopStage.style.setProperty('--gb', built.toFixed(3));
    loopStage.style.setProperty('--gf', struck.toFixed(3));
    const g = built * (1 - struck);
    loopStage.style.setProperty('--g', g.toFixed(3));
    loopStage.classList.toggle('is-drawing', Math.abs(y - (top + vh * fallAt)) > vh * WHOLE_BAND);
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
    holdArm();
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  }

  function onResize() {
    measure();
    placeSnap();
    frame();
  }

  // Hands both stages back to the stylesheet's static end states, which is what the reduced-motion rules expect.
  function clear() {
    for (const p of ['--o1', '--y1', '--b1', '--e1', '--cue-o', '--core-s', '--halo-x', '--ring-o']) {
      stage.style.removeProperty(p);
    }
    loopFinal();
  }

  /* The seated section with its graph fully drawn: the stylesheet's defaults, handed back by removing the writes.
     The class goes with them, so the idle circuit runs — and reduced motion, which also lands here, has its own
     rule turning that off rather than a second flag to keep in step. */
  function loopFinal() {
    if (!loopStage) return;
    loopStage.style.removeProperty('--o2');
    loopStage.style.removeProperty('--y2');
    loopStage.style.removeProperty('--g');
    loopStage.style.removeProperty('--gb');
    loopStage.style.removeProperty('--gf');
    loopStage.classList.remove('is-drawing');
  }

  /* A pinned, scrubbed morph needs a viewport tall enough to hold the scene. A landscape phone is 393px tall, so
     below that the section is a plain block showing the finished calculator. Matches the stylesheet's short query. */
  const short = window.matchMedia('(max-height: 620px)');

  /* Cartographer gives its pin back on a short or narrow window, and an arrival measured against a pin that is
     not there lands nowhere. Its own query, matching the stylesheet's, so the script stops driving the section
     exactly when the stylesheet stops pinning it. */
  const shortLoop = window.matchMedia('(max-height: 760px), (max-width: 1080px) and (max-height: 900px)');

  /* WHERE THE GRAPH IS WHOLE AND THE CIRCUIT IS RUNNING — the position anything that wants to SHOW somebody
   * Cartographer should aim at, rather than the top of a pin where nothing has been drawn yet.
   *
   * It is the pin's midpoint: the last screen lands there and the first one begins to leave there, so it is the
   * position at which the graph is whole and nothing is in flight. A window would be a stretch of scrolling in
   * which nothing moved; a position is something the settle below can land on.
   *
   * DERIVED FROM THE SAME CONSTANTS the scrub runs on, and exported rather than restated, for the reason every
   * measurement on this page is: a fraction copied into nav.js would go silently wrong the first time the pin
   * moved, and the failure would look like a nav bug rather than a stale number.
   *
   * On a short or narrow window the scene has given its pin back and there is nothing to find — the graph is
   * simply drawn — so the honest answer there is the top of the section. */
  function loopIdleY() {
    if (!loopScroll) return 0;
    const top = loopScroll.offsetTop;
    if (shortLoop.matches) return top;
    return Math.round(top + vh * fallAt);
  }

  /* ---- and the scroll is STOPPED on it ----
   *
   * The stop is a snap target in the stylesheet, not a settle here, because a script cannot arrest a fling: by
   * the time any handler can react the gesture has already carried the reader past the one moment this section
   * is worth seeing, and all a script can do is drag them back. `scroll-snap-stop: always` refuses to be passed
   * over in the first place, from either direction, and lets the next gesture straight through.
   *
   * All this has to do is put the target in the right place. It is set in PIXELS off the same midpoint the scrub
   * runs on, so the stop and the position the graph is whole at cannot drift apart — and it is cleared on a short
   * window and under reduced motion, where the scene has given its pin back and there is no moment to stop on. */
  const loopSnap = document.getElementById('loop-snap');

  function placeSnap() {
    if (!loopSnap) return;
    const off = shortLoop.matches || reduced.matches ? null : Math.round(vh * fallAt);
    loopSnap.style.top = off === null ? '' : off + 'px';
    loopSnap.style.scrollSnapAlign = off === null ? 'none' : '';
  }

  /* ---- and the section keeps hold of the reader until they leave it ----
   *
   * The snap target above is a BARRIER: it arrests a gesture that would cross the point. This is the other half,
   * a RETURN: while the section still fills half the window, a scroll that comes to rest anywhere else is walked
   * back to the point. Between them the scene is reached whichever way the reader arrives at it — a short flick
   * is stopped on it, and a long one that overshoots is brought back.
   *
   * COVERAGE IS THE RELEASE, not a count of how many times this has fired. Once the section is under half the
   * window the reader is looking at something else and the hold is simply gone; above it, the section is what is
   * on screen and putting it at the one position worth seeing is the whole point of the scene. Leaving therefore
   * costs a decisive gesture rather than a pause, which is deliberate.
   *
   * ONE SPEED, not one duration: the glide drives the build, so it has to play at the rate the animation reads
   * best at whether it is correcting forty pixels or most of a screen.
   *
   * ANY INPUT CANCELS IT and re-arms rather than spending it — a wheel's momentum tail lands a stray tick a
   * moment after the glide starts, and treating that as a decision leaves the scene a few pixels short. */
  /* ms of stillness before the return. Long enough that a reader who has stopped to look is not immediately
     moved, and that a gesture made of several flicks is treated as one gesture rather than as several stops. */
  const HOLD_WAIT = 500;
  const HOLD_NEAR = 8;      // px. Closer than this there is nothing to correct and a glide is only a jitter.
  const HOLD_COVER = .5;    // of the window the section must still fill for the hold to apply at all.
  /* px per second, with a floor and a ceiling on the resulting duration. Slow enough to read as the section
     drawing the reader back to it rather than as the page correcting itself, and the ceiling is above the widest
     pull the band allows so a long return is not cut short into a lurch. */
  const HOLD_SPEED = 520;
  const HOLD_MIN = 380, HOLD_MAX = 1700;
  let holdWait = 0, holdAnim = 0;

  /* The band where the section covers at least HOLD_COVER of the window, computed rather than measured: the
     stage is exactly a viewport tall and sticks for --loop-run of one, so it is still covering half a screen for
     half a screen of scrolling either side of the pin. */
  function holdBand() {
    const top = loopScroll.offsetTop;
    return [top - vh * HOLD_COVER, top + vh * (loopRun + HOLD_COVER)];
  }

  function holdStop() {
    if (holdWait) { clearTimeout(holdWait); holdWait = 0; }
    if (holdAnim) { cancelAnimationFrame(holdAnim); holdAnim = 0; }
  }

  /* Snapping is stood down for the duration. It grabs programmatic scrolls too, so the last frames of a glide
     would be yanked onto the target rather than eased onto it — the same destination, arrived at as a jump. */
  function holdGlide(to) {
    const from = window.scrollY || window.pageYOffset || 0;
    const dist = to - from;
    const ms = Math.max(HOLD_MIN, Math.min(HOLD_MAX, Math.abs(dist) / HOLD_SPEED * 1000));
    const root = document.documentElement;
    root.style.scrollSnapType = 'none';
    let t0 = 0;
    const step = (ts) => {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / ms);
      // 'instant' per frame: the stylesheet sets scroll-behavior: smooth, and a smooth scrollTo on every frame
      // of a glide compounds the two easings into a crawl.
      window.scrollTo({ top: Math.round(from + dist * ease(p)), behavior: 'instant' });
      if (p < 1) { holdAnim = requestAnimationFrame(step); return; }
      holdAnim = 0;
      root.style.scrollSnapType = '';
    };
    holdAnim = requestAnimationFrame(step);
  }

  function holdSettle() {
    holdWait = 0;
    if (!loopScroll || shortLoop.matches || reduced.matches) return;
    const y = window.scrollY || window.pageYOffset || 0;
    const band = holdBand();
    if (y < band[0] || y > band[1]) return;
    const to = loopIdleY();
    if (Math.abs(to - y) >= HOLD_NEAR) holdGlide(to);
  }

  function holdArm() {
    if (holdAnim) return;   // the glide scrolls too; arming off it would have the hold chase itself
    holdStop();
    holdWait = setTimeout(holdSettle, HOLD_WAIT);
  }

  function holdRelease() {
    if (holdAnim) document.documentElement.style.scrollSnapType = '';
    holdStop();
    holdWait = setTimeout(holdSettle, HOLD_WAIT);
  }

  window.AKSCENE = { cartographerIdleY: loopIdleY };

  const HOLD_INPUT = ['wheel', 'touchstart', 'keydown'];

  function apply() {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    for (const ev of HOLD_INPUT) window.removeEventListener(ev, holdRelease);
    holdStop();
    placeSnap();
    if (reduced.matches || short.matches) { clear(); morphFinal(); return; }
    if (shortLoop.matches) loopFinal();
    measure();
    morphInit(window.scrollY || window.pageYOffset || 0);
    frame();
    placeSnap();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    for (const ev of HOLD_INPUT) window.addEventListener(ev, holdRelease, { passive: true });
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
