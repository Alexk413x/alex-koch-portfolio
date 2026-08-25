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
  let hold = 0, exit = .7, vh = 1, loopRun = .9;

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

  /* THE PAGE'S GEOMETRY, READ ONCE PER LAYOUT RATHER THAN ONCE PER FRAME. offsetTop and offsetHeight force a
   * synchronous layout when the tree is dirty, and every frame of this rig dirties it: the scrub writes custom
   * properties, then the next frame asks the same elements where they are. That costs a large fraction of the frame
   * budget to find out something that had not moved.
   *
   * Refreshed from measure(), which runs off the kit's resize channel — resize, load and a ResizeObserver on the
   * body. All three are needed: fonts land after first paint and reflow every section under the fold. Nothing this
   * rig writes is a layout property, so the observer cannot feed itself. */
  let appTop = 0, appRun = 0, loopTop = 0;

  function shape() {
    if (morphScroll && morphStage) {
      appTop = morphScroll.offsetTop;
      appRun = morphScroll.offsetHeight - morphStage.offsetHeight;
    }
    if (loopScroll) loopTop = loopScroll.offsetTop;
    /* THE TWO PLAIN SECTIONS. Neither animates, so neither has a runway or an idle position — their beat is
       simply the top of the section, which is where the reader wants to be standing when they arrive. Cached
       here with the rest so a scroll frame never reads offsetTop and forces a layout. */
    if (expSec) expTop = expSec.offsetTop;
    if (labsSec) labsTop = labsSec.offsetTop;
    if (contactSec) contactTop = contactSec.offsetTop;
  }

  const K = window.AKKIT;
  const clamp = K.clamp01;

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
   * the rectangle it occupies in the shipped app; site.css interpolates both, and every color, from the single
   * --m scalar written here. That is the whole reason to do it this way: a scroll frame touches one attribute
   * on one element, and the transition has exactly one description rather than half in CSS and half in JS.
   */
  const morphStage = document.getElementById('app-stage');
  const morphScroll = document.getElementById('app-scroll');

  /* ONE SCROLL PLAYS IT, THE NEXT ONE LEAVES. Scrubbing the morph across a long runway spends most of it moving
   * nothing, and the mechanism can still be left stranded halfway by a reader who simply stops.
   *
   * The scroll chooses only a DIRECTION: crossing the trigger commits the morph and it runs to completion on its own
   * clock, so it always lands on a pure state and cannot be held part-played. The remaining pin is the way out.
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
   * THE SECTION ARRIVES, it does not merely slide up. Its stage rises behind the hero for a whole viewport before it
   * is seated, and moving at exactly the speed of the scroll is the one motion the eye discounts entirely. It trails
   * the scroll by a few dozen pixels and comes up to strength across the same range the reactor is struck over, so
   * the strike and the arrival read as one hand-off.
   *
   * The WORDS are not part of this: a list that cannot be read until it has been scrolled through is worse than no
   * animation at all. What moves is the section arriving, and the flow graph beside it building.
   *
   * THE GRAPH IS TWO SCALARS AND NOTHING ELSE. --gb rises across the approach, --gf rises again as it leaves, and
   * each element delays off whichever is running. Two rather than one because arriving and leaving are two ORDERS —
   * on a single scalar the last thing in is the first thing out, and the top row cannot lead both.
   *
   * Both are position, not time, so a reader who reverses gets the graph running back from where it actually is.
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
  /* STARTS LATE AND ENDS ON THE SEAT. It waits until half the graph is above the fold, because a build beginning
     before that spends its first third where nobody can see it.
     Ending the build where the section SEATS means every frame of it happens while the section is traveling, in
     both directions. Running past the seat puts that overhang inside the pin, so scrolling back up the graph
     un-builds while the section itself does not move. The cost is that the build plays faster against the same
     scroll, and that is the point. */
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
     run in, and that band has to be CENTERD on the position the rail parks the reader at. Gated on the graph's
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
    /* THE COLLAPSE IS THE DEPARTURE. It begins where the build lands, a hair before the pin lets go, and is spanned so
       the LAST element leaves exactly as the section clears the top of the window — the section finishes going and
       the graph finishes collapsing on the same frame.
       The clear point is the pin's release plus one viewport, because the stage is a viewport tall. Divided by
       STRUCK so it is the LAST ELEMENT'S EXIT that lands there, not the envelope's end.
       LINEAR, where the build is eased: the section's departure is already linear in scroll, so easing this on top
       eases the same motion twice and the collapse reads as slow exactly when it should be quickest. */
    const struck = clamp((y - (top + vh * fallAt)) / (vh * (loopRun + 1 - fallAt) / STRUCK));
    loopStage.style.setProperty('--gb', built.toFixed(3));
    loopStage.style.setProperty('--gf', struck.toFixed(3));
    loopStage.classList.toggle('is-drawing', Math.abs(y - (top + vh * fallAt)) > vh * WHOLE_BAND);
  }

  function frame() {
    const y = K.scrollY();
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
    frame();
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
   * It is the pin's midpoint: the last screen lands there and the first begins to leave there, so it is the position
   * at which the graph is whole and nothing is in flight.
   *
   * DERIVED FROM THE SAME CONSTANTS the scrub runs on, and exported rather than restated: a fraction copied into
   * nav.js would go silently wrong the first time the pin moved, and the failure would look like a nav bug.
   *
   * On a short or narrow window the scene has given its pin back, so the honest answer is the top of the section. */
  function loopIdleY() {
    if (!loopScroll) return 0;
    if (shortLoop.matches) return loopTop;
    return Math.round(loopTop + screenH() * fallAt);
  }

  /* WHERE THE REACTOR HOLDS THE FRAME ALONE, and the ONLY declaration of it — nav.js reads it back off the handle
   * below rather than recomputing it.
   *
   * The words are clear at the END OF THE EXIT and the ring does not begin to open until RING_START of it, so
   * between those two positions nothing is in flight. The stop is the START of that stretch rather than its
   * midpoint: the reader's own gesture carries the words off, and the moment they are gone is the moment the scene
   * has arrived. Landing further in means the page keeps moving after the thing they were watching has finished.
   */
  function heroAloneY() {
    return Math.round((hold + exit) * screenH());
  }

  /* ---- and the scroll is STOPPED on the beats ----
   *
   * Five positions are worth coming to rest on: the hero with its words up, the reactor holding the frame alone,
   * Cartographer with its graph whole, and the calculator at each end of its pin. Everything between them is an
   * envelope playing, and a half-faded lockup or a keypad with half its keys in each keyboard is a frame nobody
   * chose to look at.
   *
   * TWO MECHANISMS, because a gesture has two halves and a script can only see the second. These snap targets
   * arrest the FLING: `scroll-snap-stop: always` refuses to be passed over, from either direction, before any
   * handler could have reacted. The rail below is the other half.
   *
   * A BARRIER IS FOR ARRIVING, NOT FOR STAYING. Chrome answers each event of a trackpad's decaying stream as a
   * gesture of its own, so a target under the reader pulls every tick straight back and the beat becomes a trap.
   *
   * So the target UNDER the reader is stood down the moment they touch an input, and armed again when the page next
   * comes to rest. The beat AHEAD is armed throughout, which is the half that does the work — leaving is free, and
   * being carried past the next beat is still refused.
   */
  const loopSnap = document.getElementById('loop-snap');
  const heroSnap = document.getElementById('hero-snap');
  const appOldSnap = document.getElementById('app-snap-old');
  const appAppSnap = document.getElementById('app-snap-app');
  const expSnap = document.getElementById('exp-snap');
  const labsSnap = document.getElementById('labs-snap');
  const expSec = document.getElementById('experience');
  const labsSec = document.getElementById('labs');
  const contactSnap = document.getElementById('contact-snap');
  const contactSec = document.getElementById('contact');

  const SNAP_FREE = .12;    // of a viewport: how near a beat still counts as being parked on it.
  let snapOff = -1;         // page position of the target stood down for this gesture, or -1 for none.
  let expTop = 0, labsTop = 0, contactTop = 0;

  /* THE BEATS, in page order, and the ONE description of them. The rail below walks this list and every barrier
     is placed off the same number, so a stop and the position it guards cannot drift apart. They were two lists
     for one turn of this work, which is exactly the failure this page is organized against.
     `at: null` is a beat that is NOT THERE — its scene has given its runway back, or the rig is disarmed — and
     placeSnap clears the target rather than leaving it arresting a gesture on a section nothing animates.
     The top of the page carries no element: a gesture cannot be carried past a position it is already stopped
     by, so there is nothing for a barrier to do there.
     `base` is the container the target's `top` is measured inside, which is the page for none of them. */
  function beats() {
    const dead = reduced.matches || short.matches;
    const noApp = dead || appRun <= 0;
    return [
      { el: null, base: 0, at: dead ? null : 0, sec: 'alex', fill: .5 },
      { el: heroSnap, base: 0, at: dead ? null : heroAloneY(), sec: 'alex', fill: 1 },
      { el: loopSnap, base: loopTop, sec: 'cartographer', fill: 1,
        at: dead || shortLoop.matches || !loopScroll ? null : loopIdleY() },
      /* THE CALCULATOR IS ITS PIN'S TWO ENDS, which are the morph's two resting states: the faceplate it arrives
         at and the shipped app it leaves as. Nothing between them is a place to be — the mechanism is either
         still or in flight — so the pin carries exactly two beats and the turn happens on the way between. */
      { el: appOldSnap, base: appTop, at: noApp ? null : appTop, sec: 'app', fill: .5 },
      { el: appAppSnap, base: appTop, at: noApp ? null : appTop + appRun, sec: 'app', fill: 1 },
      /* THE CATALOG AND THE LABS, which are beats for the same reason the others are: each is exactly one
         screen and has one right alignment, so arriving half in it is arriving wrong. They carry no scene, so
         there is nothing to scrub and their position never moves within the section — `at` and `base` are the
         same number and the barrier sits at offset 0 inside its own section.
         They stand down with everything else on a short window or with reduced motion, because a barrier on a
         section taller than the viewport is a trap rather than an alignment. */
      { el: expSnap, base: expTop, at: dead ? null : expTop, sec: 'experience', fill: 1 },
      /* LABS IS THE LAST BEAT, and it can only be one because contact is a full screen. The rail releases a
         reader past its last beat at last + RAIL_PAST screens: with contact at 325px labs sat 292px above the
         end of the document, the release position did not exist, and every scroll below labs was dragged back
         to it. Contact at 100dvh puts 965px under labs and the release comfortably inside the page.
         Contact itself carries no beat — it ends where the document does, so the bottom of the page already
         lands it square, and a beat there would be one the rail could never release from. */
      { el: labsSnap, base: labsTop, at: dead ? null : labsTop, sec: 'labs', fill: 1 },
      /* CONTACT IS THE LAST BEAT, AND IT IS THE FOOT OF THE PAGE. It is one screen and it ends where the
         document does, so its beat sits exactly at the maximum scroll — which means the rail now reaches the
         end of the page and there is no released region past it. That is deliberate: with nothing below, there
         is nothing a reader could be dragged back FROM, and the release rule this rig carries exists to stop a
         beat trapping someone above content they wanted. Here the beat IS the bottom. */
      { el: contactSnap, base: contactTop, at: dead ? null : contactTop, sec: 'contact', fill: 1 },
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
   * The snap targets above are BARRIERS: they arrest a gesture that would cross a beat. This is the other half, a
   * RAIL: once the scrolling has stopped, whatever is left of the gap is closed by a glide.
   *
   * IT COMMITS, IT DOES NOT ROUND. A third of the way toward the next beat is a decision to go there, and the rest
   * is traveled for the reader; under that it is a nudge, and they are put back. So one short scroll off the
   * reactor plays the strike and carries them the whole way to Cartographer, and one short scroll back does it in
   * reverse. Two lines rather than one, so a reader parked between two beats cannot flap the page back and forth.
   *
   * PAST THE LAST BEAT THE RAIL IS SIMPLY GONE, so leaving costs one decisive gesture rather than a pause.
   *
   * ONE SPEED, not one duration: the glide drives every envelope it crosses, so it has to play at the rate the
   * animation reads best at whether it is correcting forty pixels or most of a screen.
   *
   * ANY INPUT CANCELS IT and re-arms rather than spending it — a wheel's momentum tail lands a stray tick a moment
   * after the glide starts, and treating that as a decision leaves the scene a few pixels short.
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
     A SPEED, NOT A DURATION, because the glide drives every envelope it crosses. The ceiling is above the widest gap
     between two beats, so a full hand-off is never cut short into a lurch; the floor is what stops a forty-pixel
     correction being a twitch.
     THE ONLY DECLARATION OF IT, and nav.js glides too — its arrow keys and space bar step these same beats, and a
     press and a flick that end on the same one must play the scene between at the same rate. */
  const HOLD_SPEED = 520;
  const HOLD_MIN = 380, HOLD_MAX = 1700;
  const glideMs = (dist) => Math.max(HOLD_MIN, Math.min(HOLD_MAX, Math.abs(dist) / HOLD_SPEED * 1000));

  let holdWait = 0, anchorY = -1;

  // The positions from that one table, with the beats that are not there dropped.
  function railStops() {
    return beats().filter((b) => b.at !== null).map((b) => b.at);
  }

  /* THE SAME TABLE, FOR THE HEADER'S METER. `sec` is the id of the section whose bar a beat belongs to and
     `fill` is how much of that bar standing on it earns — the hero seated is half of ALEX and the reactor is
     the other half, the faceplate is half of CALCULATOR and the shipped app is the rest.
     The nav owns the ORDER of the bars and this owns which beat feeds which; neither restates the other. */
  function railMeter() {
    return beats().filter((b) => b.at !== null && b.sec).map((b) => ({ at: b.at, sec: b.sec, fill: b.fill }));
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
       is no gesture here whose direction could be honored. */
    return f < .5 ? lo : hi;
  }

  /* stopGlide restores scroll snapping as well as canceling the frame. Canceling without restoring is what
     left snapping switched off for the rest of the session when the rig stood itself down mid-glide. */
  function holdStop() {
    if (holdWait) { clearTimeout(holdWait); holdWait = 0; }
    if (railGliding()) K.stopGlide();
  }

  const railGliding = () => K.glideOwner() === 'rail';

  /* Snapping is stood down for the duration. It grabs programmatic scrolls too, so the last frames of a glide
     would be yanked onto the target rather than eased onto it — the same destination, arrived at as a jump.
     The anchor is taken on ARRIVAL only. A glide the reader interrupts leaves them between two beats with the
     anchor still on the one they left, so the commit above reads their position as the decision it was rather
     than as a reversal of a journey that never finished. */
  function holdGlide(to) {
    K.glideTo(to, {
      ms: glideMs(to - K.scrollY()),
      // Smoothstep, not the kit's default: this is a correction the reader did not ask for, so it eases in as
      // well as out. An anchor jump they DID ask for starts at speed.
      ease: ease,
      owner: 'rail',
      onArrive: (y) => { anchorY = y; snapArm(); },
    });
  }

  function holdSettle() {
    holdWait = 0;
    snapArm();
    if (reduced.matches || short.matches) return;
    /* nav.js is moving the page itself — a keyboard step or an anchor jump. Re-armed rather than dropped, so the
       rail still tidies up once the press lands; two glides racing for the same scroll position is a fight the
       reader sees as a stutter. */
    if (K.glideOwner() === 'nav') {
      holdWait = setTimeout(holdSettle, HOLD_WAIT);
      return;
    }
    const y = K.scrollY();
    const to = railTarget(y);
    if (to === null) return;
    if (Math.abs(to - y) < HOLD_NEAR) { anchorY = to; return; }
    holdGlide(to);
  }

  function holdArm() {
    if (railGliding()) return;   // the glide scrolls too; arming off it would have the rail chase itself
    holdStop();
    holdWait = setTimeout(holdSettle, HOLD_WAIT);
  }

  function holdRelease() {
    snapFree(K.scrollY());
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
    meter: railMeter,
    glideMs: glideMs,
  };

  const HOLD_INPUT = ['wheel', 'touchstart', 'keydown'];

  /* Every position this rig runs on is cached, so anything that moves the page has to say so — and a resize is
     only one of the ways. Fonts landing, an image sizing itself, and the shelf and the timeline building all
     change how far down the page a section starts, and none of them fires one. Watching the body catches every
     case with one observer. It is held here rather than installed once because apply() owns every listener: on
     a short window or under reduced motion the rig is stood down, and a resize still reaching onResize would
     write the scrub back over the static end states clear() just handed to the stylesheet. */
  let unsub = [];

  function apply() {
    unsub.forEach((off) => off());
    unsub = [];
    for (const ev of HOLD_INPUT) window.removeEventListener(ev, holdRelease);
    holdStop();
    snapOff = -1;
    if (reduced.matches || short.matches) { placeSnap(); clear(); morphFinal(); return; }
    if (shortLoop.matches) loopFinal();
    measure();
    morphInit(K.scrollY());
    frame();
    // After measure(), never before it: both targets are placed in pixels off numbers measure() reads.
    placeSnap();
    unsub = [K.onScroll(onScroll), K.onResize(onResize)];
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
