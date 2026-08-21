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
  let hold = 0, exit = .7, vh = 1, queued = false, loopRun = .9;

  /* Reads the scene runway back off the stylesheet. site.css is the only place --scene-hold and --scene-exit are
     written, so the height the stage stays pinned for and the range the exit is scrubbed across cannot disagree —
     restating either number here is how a rig like this ends up scrubbing past the end of its own container. */
  function measure() {
    const cs = getComputedStyle(document.documentElement);
    hold = parseFloat(cs.getPropertyValue('--scene-hold')) || 0;
    exit = parseFloat(cs.getPropertyValue('--scene-exit')) || 1;
    trip = parseFloat(cs.getPropertyValue('--morph-trip')) || .5;
    /* NOT `|| .9`. Zero is a legitimate pin length — it is the one that leaves no stationary scroll at all — and
       a falsy test reads it as "absent" and substitutes most of a screen of it. */
    const run = parseFloat(cs.getPropertyValue('--loop-run'));
    loopRun = Number.isFinite(run) ? run : .9;
    vh = window.innerHeight || 1;
    shape();
    shapeLoop();
  }

  /* THE PAGE'S GEOMETRY, READ ONCE PER LAYOUT RATHER THAN ONCE PER FRAME.
   *
   * offsetTop and offsetHeight force a synchronous layout when the tree is dirty, and every frame of this rig
   * dirties it: the scrub writes custom properties, then the next frame asks the same elements where they are.
   * Measured on a scroll frame at the hero: 3.75ms of forced layout against 0.03ms of writes — a hundred to one,
   * and most of a fifth of a 60fps budget spent finding out something that had not moved.
   *
   * Refreshed from measure(), which runs on resize, on load, and off a ResizeObserver on the body. All three are
   * needed: fonts land after first paint and reflow every section under the fold, so a measurement taken once at
   * parse time is wrong by a line's height for the rest of the session. Nothing this rig writes is a layout
   * property — opacity, transforms and filters only — so the observer cannot feed itself. */
  let appTop = 0, appRun = 0, loopTop = 0;

  function shape() {
    if (morphScroll && morphStage) {
      appTop = morphScroll.offsetTop;
      appRun = morphScroll.offsetHeight - morphStage.offsetHeight;
    }
    if (loopScroll) loopTop = loopScroll.offsetTop;
  }

  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* THE LIVE WINDOW HEIGHT, for anything that reports a POSITION rather than scrubs one. The scrub reads the
     cached vh, which is what a per-frame loop should do; the exported stops must not, because the order the
     resize handlers run in is not fixed. apply() re-adds this file's listener every time a media query flips,
     which puts it behind nav.js's from then on — and nav.js asks for these positions from its own handler. A
     cached height read one handler too early is a stop measured against the previous window, and the failure
     looks like a nav bug rather than a stale number. */
  const screenH = () => window.innerHeight || vh;

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

  /* How far through the pin a scroll position is. appRun is the scroll the calculator is pinned for, and its
     two ends are the morph's two resting states — so the rail's beats are read off the same measurement the
     trigger is, rather than a second expression for the same length. */
  const morphAt = (y) => (appRun > 0 ? (y - appTop) / appRun : 1);

  function morph(y) {
    if (!morphStage || !morphScroll) return;
    const p = morphAt(y);
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
    mValue = mTarget = mFrom = morphAt(y) >= trip ? 1 : 0;
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
   * THE GRAPH IS TWO SCALARS AND NOTHING ELSE. --gb rises across the approach so the flow extends as the
   * section enters frame; --gf rises again as it leaves, and each element delays off whichever of the two is
   * running. Two rather than one because arriving and leaving are two ORDERS — on a single scalar the last
   * thing in is the first thing out, and the top row cannot lead both.
   * Both are position, not time, so a reader who reverses gets the graph running back from where it actually
   * is, and there is no separate exit description that can disagree with the entrance.
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
  /* Viewport heights either side of the stopping point that still count as whole. The circuit needs a band to
     run in, and that band has to be CENTRED on the position the rail parks the reader at. Gated on the graph's
     own scalars instead, it opened a few pixels before the resting point and closed most of a tenth of a screen
     after it, because those peak past the target rather than on it — so a nudge upward put the circuit out while
     the same nudge downward did nothing. Scroll distance, because that is what the reader is moving. */
  const WHOLE_BAND = .06;

  function loop(y) {
    if (!loopStage || !loopScroll) return;
    // One viewport of arrival, ending where the section is seated: it begins the moment its top edge crosses the
    // bottom of the screen, which is the first frame any of it is visible.
    const top = loopTop;
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
    loopStage.style.setProperty('--gb', built.toFixed(3));
    loopStage.style.setProperty('--gf', struck.toFixed(3));
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
    // Every beat has just moved, so the anchor is a position on the old page. Dropped rather than rescaled.
    anchorY = -1;
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
    if (shortLoop.matches) return loopTop;
    return Math.round(loopTop + screenH() * fallAt);
  }

  /* WHERE THE REACTOR HOLDS THE FRAME ALONE, and the ONLY declaration of it — nav.js reads it back off the
   * handle below rather than recomputing it from the same two properties.
   *
   * The words are clear at the end of the exit, and the ring does not begin to open until RING_START of it, so
   * between those two positions there is a stretch in which nothing at all is in flight. The stop is that
   * stretch's midpoint, for the same reason Cartographer's is its pin's: a window is scrolling during which
   * nothing moves, and a midpoint is a position something can be landed on.
   */
  function heroAloneY() {
    return Math.round((hold + exit * (1 + RING_START) / 2) * screenH());
  }

  /* ---- and the scroll is STOPPED on the beats ----
   *
   * Five positions on this page are worth coming to rest on: the hero with its words up, the reactor holding the
   * frame alone once they have left, Cartographer with its graph whole, and the calculator at each end of its
   * pin. Everything between them is an envelope playing, and a half-faded lockup, a half-built graph or a keypad
   * with half its keys in each keyboard is a frame nobody chose to look at.
   *
   * TWO MECHANISMS, because a gesture has two halves and a script can only see the second. These snap targets
   * arrest the FLING: `scroll-snap-stop: always` refuses to be passed over, from either direction, before any
   * handler could have reacted — by the time one can, the gesture has already carried the reader past the
   * moment, and all a script could do is drag them back. The rail below is the other half.
   *
   * A BARRIER IS FOR ARRIVING, NOT FOR STAYING, and `scroll-snap-stop: always` under the reader is the second
   * thing as well as the first: it does not merely refuse to carry them PAST the beat, it refuses to let them
   * OFF it. Chrome answers each event of a trackpad's decaying stream as a gesture of its own, so every tick is
   * pulled straight back onto the target and the beat becomes a trap. Measured, sitting on the reactor: a 900px
   * flick moved 48px and returned, over and over.
   *
   * So the target UNDER the reader is stood down the moment they touch an input, and armed again when the page
   * next comes to rest. The beat AHEAD is armed throughout, which is the half that does the work — leaving is
   * free, and being carried past the next beat is still refused.
   */
  const loopSnap = document.getElementById('loop-snap');
  const heroSnap = document.getElementById('hero-snap');
  const appOldSnap = document.getElementById('app-snap-old');
  const appAppSnap = document.getElementById('app-snap-app');

  const SNAP_FREE = .12;    // of a viewport: how near a beat still counts as being parked on it.
  let snapOff = -1;         // page position of the target stood down for this gesture, or -1 for none.

  /* THE BEATS, in page order, and the ONE description of them. The rail below walks this list and every barrier
     is placed off the same number, so a stop and the position it guards cannot drift apart. They were two lists
     for one turn of this work, which is exactly the failure this page is organised against.
     `at: null` is a beat that is NOT THERE — its scene has given its runway back, or the rig is disarmed — and
     placeSnap clears the target rather than leaving it arresting a gesture on a section nothing animates.
     The top of the page carries no element: a gesture cannot be carried past a position it is already stopped
     by, so there is nothing for a barrier to do there.
     `base` is the container the target's `top` is measured inside, which is the page for none of them. */
  function beats() {
    const dead = reduced.matches || short.matches;
    const noApp = dead || appRun <= 0;
    return [
      { el: null, base: 0, at: dead ? null : 0 },
      { el: heroSnap, base: 0, at: dead ? null : heroAloneY() },
      { el: loopSnap, base: loopTop,
        at: dead || shortLoop.matches || !loopScroll ? null : loopIdleY() },
      /* THE CALCULATOR IS ITS PIN'S TWO ENDS, which are the morph's two resting states: the faceplate it arrives
         at and the shipped app it leaves as. Nothing between them is a place to be — the mechanism is either
         still or in flight — so the pin carries exactly two beats and the turn happens on the way between. */
      { el: appOldSnap, base: appTop, at: noApp ? null : appTop },
      { el: appAppSnap, base: appTop, at: noApp ? null : appTop + appRun },
    ];
  }

  /* `top` in PIXELS off the same numbers the scrubs run on, so a stop and the position its scene is whole at
     cannot drift apart. A vh here would be a second description of the same position and would disagree with the
     rig the first time dvh and vh differed. */
  function placeSnap() {
    for (const t of beats()) {
      if (!t.el) continue;
      const live = t.at !== null;
      t.el.style.top = live ? (t.at - t.base) + 'px' : '';
      t.el.style.scrollSnapAlign = live && !(snapOff >= 0 && Math.abs(t.at - snapOff) < 1) ? '' : 'none';
    }
  }

  /* Stands down whichever beat the reader is on, for the gesture they have just begun.
     IT ONLY EVER STANDS ONE DOWN. Re-arming is the settle's job, because distance is the wrong test for it: on
     one that re-armed as soon as the reader was a fraction of a screen clear, the target came back mid-gesture
     and pulled them straight onto it again. Measured off the reactor, a twelve-tick stream bounced 742 → 887 →
     795 → 922 → 742 and gave up. A gesture is one decision and it lasts until the page is still. */
  function snapFree(y) {
    if (snapOff >= 0) return;
    const gap = screenH() * SNAP_FREE;
    for (const t of beats()) {
      if (t.el && t.at !== null && Math.abs(t.at - y) < gap) { snapOff = t.at; placeSnap(); return; }
    }
  }

  function snapArm() {
    if (snapOff < 0) return;
    snapOff = -1;
    placeSnap();
  }

  /* ---- and the reader is walked between them ----
   *
   * The snap targets above are BARRIERS: they arrest a gesture that would cross a beat. This is the other half,
   * a RAIL: once the scrolling has stopped, whatever is left of the gap is closed by a glide.
   *
   * IT COMMITS, IT DOES NOT ROUND. A third of the way toward the next beat is a decision to go there, and the
   * rest of the distance is travelled for the reader; under that it is a nudge, and they are put back where they
   * were. So one short scroll off the reactor plays the strike and carries them the whole way to Cartographer,
   * one short scroll off the faceplate turns the calculator into the app, and one short scroll back does either
   * in reverse — which is what makes the beats read as beats rather than as places the page happens to stick.
   * Two lines rather than one, so a reader parked between two beats cannot flap the page back and forth on a
   * pixel of movement.
   *
   * PAST THE LAST BEAT THE RAIL IS SIMPLY GONE. Below that release the reader is looking at the section after
   * this rig, and leaving therefore costs one decisive gesture rather than a pause, which is deliberate.
   *
   * ONE SPEED, not one duration: the glide drives every envelope it crosses, so it has to play at the rate the
   * animation reads best at whether it is correcting forty pixels or most of a screen.
   *
   * ANY INPUT CANCELS IT and re-arms rather than spending it — a wheel's momentum tail lands a stray tick a
   * moment after the glide starts, and treating that as a decision leaves the scene a few pixels short.
   */
  /* ms of stillness before the rail acts. Long enough that a reader who has stopped to look is not immediately
     moved, and that a gesture made of several flicks is treated as one gesture rather than as several stops. */
  const HOLD_WAIT = 500;
  const HOLD_NEAR = 8;      // px. Closer than this there is nothing to correct and a glide is only a jitter.
  const RAIL_COMMIT = .35;  // of the gap to the next beat: past this, the reader is taken the rest of the way.
  const RAIL_PAST = .5;     // viewport heights past the last beat that the rail still holds the reader on it.
  /* The widest gap the rail will carry a reader across, in viewport heights. Two beats further apart than this
     are not a hand-off, they are two places with reading between them — a short window unpins Cartographer and
     the gap from the reactor to the calculator becomes two screens, and driving somebody across that is a
     hijack rather than a finish. Every gap on a roomy window is under a screen. */
  const RAIL_REACH = 1.25;
  /* HOW FAST THE PAGE MOVES ITSELF: px per second, with a floor and a ceiling on the duration that produces.
     A SPEED, NOT A DURATION, because the glide drives every envelope it crosses and has to play at the rate the
     animation reads best at whether it is correcting forty pixels or most of a screen. Slow enough to read as
     the page carrying the reader to the next beat rather than as it correcting itself. The ceiling is above the
     widest gap between two beats, so a full hand-off is never cut short into a lurch; the floor is what stops a
     forty-pixel correction being a twitch.
     THE ONLY DECLARATION OF IT, and nav.js glides too — its arrow keys and space bar step these same beats, and
     a press and a flick that end on the same one must play the scene between at the same rate. It asks glideMs
     below for the duration rather than carrying numbers of its own. No CSS rule wants any of this, so the
     stylesheet is the wrong place for it however many files read it. */
  const HOLD_SPEED = 520;
  const HOLD_MIN = 380, HOLD_MAX = 1700;
  const glideMs = (dist) => Math.max(HOLD_MIN, Math.min(HOLD_MAX, Math.abs(dist) / HOLD_SPEED * 1000));

  let holdWait = 0, holdAnim = 0, anchorY = -1;

  // The positions from that one table, with the beats that are not there dropped.
  function railStops() {
    return beats().filter((b) => b.at !== null).map((b) => b.at);
  }

  /* Compared with slack rather than for equality: the anchor is a beat's position as it was measured when the
     glide landed, and a resize moves every one of them. */
  const atBeat = (a, b) => Math.abs(a - b) < HOLD_NEAR;

  // null means the rail does not apply here at all, which is not the same answer as "stay where you are".
  function railTarget(y) {
    const s = railStops();
    const last = s[s.length - 1];
    if (y > last + screenH() * RAIL_PAST) return null;
    if (y >= last) return last;
    if (y <= s[0]) return s[0];
    let i = 0;
    while (i < s.length - 1 && y >= s[i + 1]) i++;
    const lo = s[i], hi = s[i + 1];
    if (hi - lo > screenH() * RAIL_REACH) return null;
    const f = (y - lo) / Math.max(1, hi - lo);
    if (atBeat(anchorY, lo)) return f < RAIL_COMMIT ? lo : hi;
    if (atBeat(anchorY, hi)) return f > 1 - RAIL_COMMIT ? hi : lo;
    /* No anchor to hold against: an anchor jump from the nav, or a reload part-way down. Nearest, because there
       is no gesture here whose direction could be honoured. */
    return f < .5 ? lo : hi;
  }

  function holdStop() {
    if (holdWait) { clearTimeout(holdWait); holdWait = 0; }
    if (holdAnim) { cancelAnimationFrame(holdAnim); holdAnim = 0; }
  }

  /* Snapping is stood down for the duration. It grabs programmatic scrolls too, so the last frames of a glide
     would be yanked onto the target rather than eased onto it — the same destination, arrived at as a jump.
     The anchor is taken on ARRIVAL only. A glide the reader interrupts leaves them between two beats with the
     anchor still on the one they left, so the commit above reads their position as the decision it was rather
     than as a reversal of a journey that never finished. */
  function holdGlide(to) {
    const from = window.scrollY || window.pageYOffset || 0;
    const dist = to - from;
    const ms = glideMs(dist);
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
      anchorY = to;
      snapArm();
      root.style.scrollSnapType = '';
    };
    holdAnim = requestAnimationFrame(step);
  }

  function holdSettle() {
    holdWait = 0;
    snapArm();
    if (reduced.matches || short.matches) return;
    /* nav.js is moving the page itself — a keyboard step or an anchor jump. Re-armed rather than dropped, so the
       rail still tidies up once the press lands; two glides racing for the same scroll position is a fight the
       reader sees as a stutter. */
    if (window.AKNAV && window.AKNAV.busy && window.AKNAV.busy()) {
      holdWait = setTimeout(holdSettle, HOLD_WAIT);
      return;
    }
    const y = window.scrollY || window.pageYOffset || 0;
    const to = railTarget(y);
    if (to === null) return;
    if (Math.abs(to - y) < HOLD_NEAR) { anchorY = to; return; }
    holdGlide(to);
  }

  function holdArm() {
    if (holdAnim) return;   // the glide scrolls too; arming off it would have the rail chase itself
    holdStop();
    holdWait = setTimeout(holdSettle, HOLD_WAIT);
  }

  function holdRelease() {
    if (holdAnim) document.documentElement.style.scrollSnapType = '';
    snapFree(window.scrollY || window.pageYOffset || 0);
    holdStop();
    holdWait = setTimeout(holdSettle, HOLD_WAIT);
  }

  /* The beats, for anything that needs to know where the page can come to rest under its own steam. nav.js
     reads them rather than restating the geometry: a fraction copied there goes silently wrong the first time a
     pin moves, and the failure looks like a nav bug. */
  window.AKSCENE = {
    cartographerIdleY: loopIdleY,
    heroAloneY: heroAloneY,
    beats: railStops,
    glideMs: glideMs,
  };

  const HOLD_INPUT = ['wheel', 'touchstart', 'keydown'];

  /* Every position this rig runs on is cached, so anything that moves the page has to say so — and a resize is
     only one of the ways. Fonts landing, an image sizing itself, and the shelf and the timeline building all
     change how far down the page a section starts, and none of them fires one. Watching the body catches every
     case with one observer. It is held here rather than installed once because apply() owns every listener: on
     a short window or under reduced motion the rig is stood down, and an observer still calling onResize would
     write the scrub back over the static end states clear() just handed to the stylesheet. */
  const bodyResize = 'ResizeObserver' in window ? new ResizeObserver(onResize) : null;

  function apply() {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('load', onResize);
    for (const ev of HOLD_INPUT) window.removeEventListener(ev, holdRelease);
    if (bodyResize) bodyResize.disconnect();
    holdStop();
    snapOff = -1;
    if (reduced.matches || short.matches) { placeSnap(); clear(); morphFinal(); return; }
    if (shortLoop.matches) loopFinal();
    measure();
    morphInit(window.scrollY || window.pageYOffset || 0);
    frame();
    // After measure(), never before it: both targets are placed in pixels off numbers measure() reads.
    placeSnap();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('load', onResize);
    if (bodyResize) bodyResize.observe(document.body);
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
