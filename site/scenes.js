/* scenes.js — the home page's scroll timeline.
 * Scroll position is the clock: a passive listener writes one block of custom properties onto the sticky
 * stage each frame, and every scene reads them from a static CSS rule instead of re-rendering.
 */
(function () {
  const stage = document.getElementById('stage');
  if (!stage) return;

  /* Two envelopes off one scroll, deliberately out of phase: the words climb out under their own blur while
     the core and ring hold, and only once the words are gone do those fade. One envelope for both reads as a
     cross-fade instead of an exit. */
  const TRAVEL = 1;         // viewport heights the words rise
  const BLUR = 8;           // px of defocus at full exit
  const TEXT_HOLD = .45;    // fraction of the exit the words stay opaque, so they are seen to leave
  const CUE_OUT = .22;      // fraction of the words' exit over which the scroll arrow disappears, rather than
                            // blurring off with them and competing for the eye
  const CORE_SHRINK = .88;  // how far the core collapses into itself as it leaves
  const HALO_SPREAD = 420;  // viewBox units each edge of the ring travels outward, clearing the frame sideways
  // Fraction of the words' exit: the ring doesn't start leaving until the words are gone and the hero has held
  // alone for a beat.
  const RING_START = 1.12;
  const RING_SPAN = .8;     // viewport heights the ring takes to go, finishing before the next section arrives

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let hold = 0, exit = .7, vh = 1, loopRun = .9;

  // Reads the scroll runway from site.css, the only place these are written, so the pin length and the exit
  // range can't disagree with the stylesheet.
  function measure() {
    const cs = getComputedStyle(document.documentElement);
    hold = parseFloat(cs.getPropertyValue('--scene-hold')) || 0;
    exit = parseFloat(cs.getPropertyValue('--scene-exit')) || 1;
    trip = parseFloat(cs.getPropertyValue('--morph-trip')) || .5;
    // Not `|| .9`: 0 is a legitimate --loop-run (no stationary scroll at all), and `||` would treat it as absent.
    const run = parseFloat(cs.getPropertyValue('--loop-run'));
    loopRun = Number.isFinite(run) ? run : .9;
    // The probe's height, not innerHeight, for the same reason screenH reads it: the scrubs this sizes run over
    // runways declared in svh, and innerHeight is the one number on a phone that disagrees with them.
    vh = screenH();
    shape();
    shapeLoop();
  }

  // Page geometry, read once per layout instead of once per scroll frame: offsetTop/offsetHeight force a
  // synchronous layout, and every scroll frame would otherwise ask again where something already measured is.
  let appTop = 0, appRun = 0, loopTop = 0;

  /* HOW FAR THE CALCULATOR SECTION SCROLLS BEFORE IT PINS, on a portrait phone.
   *
   * The section is taller than the screen at --m 1, so it cannot pin at the top with everything visible. It
   * pins LOW instead: the stylesheet sticks it at a negative top of this distance, which is exactly how far
   * #app's own top sits above .then-now once the header's clearance is taken off. The reader gets ordinary
   * scroll through the title and the lede, and the pin catches at the moment THEN/NOW reaches the bar — which
   * is the block the scrub actually drives, so it is the one that has to stay in frame.
   *
   * MEASURED, NOT DECLARED. It is the height of two text blocks at whatever width and font the reader got: at
   * 393px the lede runs five lines and at 360px it runs six, and a constant would put THEN/NOW under the bar
   * on one and behind it on the other. Zero on anything but a portrait phone, where the stylesheet's own
   * fallback (0px) is already the desktop behavior.
   */
  const APP_TRIP_AFTER = 40;    // px past the pin at which the morph commits, so it fires pinned and not before
  const portrait = window.matchMedia('(max-width: 820px) and (orientation: portrait)');
  let appLiftPx = 0;

  function appLift() {
    const then = document.querySelector('.then-now');
    if (!portrait.matches || !then) {
      appLiftPx = 0;
      morphStage.style.removeProperty('--app-lift');
      return;
    }
    const app = document.getElementById('app');
    // The clearance is #app's OWN padding-top, read rather than restated: that padding is what holds the title
    // off the bar before the pin, and THEN/NOW has to land in the same place the title just left.
    const clear = parseFloat(getComputedStyle(app).paddingTop) || 0;
    appLiftPx = Math.max(0, Math.round(
      then.getBoundingClientRect().top - app.getBoundingClientRect().top - clear));
    morphStage.style.setProperty('--app-lift', appLiftPx + 'px');
  }

  // Caches every section's layout, refreshed by measure() off resize/load/a body ResizeObserver — all three are
  // needed since fonts landing after first paint reflows sections under the fold.
  function shape() {
    if (morphScroll && morphStage) {
      appLift();
      appTop = morphScroll.offsetTop;
      appRun = morphScroll.offsetHeight - morphStage.offsetHeight;
    }
    if (loopScroll) loopTop = loopScroll.offsetTop;
    // The graph's own page box, which is what loopFlat times against. Read here rather than per frame: a rect
    // read forces layout, and this only moves when something above it reflows — which is what shape() is for.
    if (loopFlow) {
      const r = loopFlow.getBoundingClientRect();
      flowTop = Math.round(r.top + (window.scrollY || window.pageYOffset || 0));
      flowH = Math.round(r.height);
    }
    // The plain sections don't animate; their beat is just the section top.
    if (expSec) expTop = expSec.offsetTop;
    if (labsSec) labsTop = labsSec.offsetTop;
    if (contactSec) contactTop = contactSec.offsetTop;
  }

  const K = window.AKKIT;
  const clamp = K.clamp01;

  /* A SCREEN IS WHAT THE STYLESHEET SAYS IT IS, measured off #screen-probe rather than taken from innerHeight.
     The runways are svh, which does not move when a phone's URL bar does; innerHeight is dvh, which does. Read
     from innerHeight, every position derived here would be calibrated against a different number than the
     runway it runs on, and would drift by the height of that bar for as long as it was hidden.
     Falls back to innerHeight where the element or the unit is missing. */
  const probe = document.getElementById('screen-probe');
  // Live, for anything reporting a position rather than scrubbing one. Exported stops must read this instead of
  // the cached vh: apply() re-adds this file's resize listener behind nav.js's, so a cached height there would
  // be one handler stale.
  const screenH = () => (probe && probe.offsetHeight) || window.innerHeight || vh;

  // Smoothstep, applied exactly once per scrub — nothing this writes also carries a CSS transition.
  const ease = (t) => { const x = clamp(t); return x * x * (3 - 2 * x); };

  // ease's inverse: the input that lands on a given output. Needed since the graph is called whole at --gb .91,
  // not 1, and that position is a question about the easing curve, not the runway.
  const unease = (v) => .5 - Math.sin(Math.asin(1 - 2 * clamp(v)) / 3);

  // ---- the calculator morph ----
  // One DOM tree, one written property: site.css interpolates each key's faceplate/app rects and colors from
  // the single --m scalar written here.
  const morphStage = document.getElementById('app-stage');
  const morphScroll = document.getElementById('app-scroll');

  // Crossing the trigger commits the morph to a direction; it then runs to completion on its own clock so it
  // always lands on a pure state instead of being held part-played. Back is faster than forward because leaving
  // upward only has the space to the pin's top to finish in — at 900ms it was still turning when the section
  // slid off screen.
  const MORPH_MS = 900;
  const MORPH_BACK_MS = 460;
  const RELEASE = .57;    // fraction of the commit point where scrolling back up releases it (two-line hysteresis
                          // so a reader parked on the trigger can't flap it back and forth)
  let trip = .14;         // read from the stylesheet in measure(); nav.js reads the same declaration

  let mValue = 0, mTarget = 0, mFrom = 0, mStart = 0, mAnim = 0, mSettle = 0;

  // Lands the morph even if requestAnimationFrame stalls (Chrome runs zero rAF frames in a background tab),
  // since a frozen part-played morph leaves the keypad pointer-events: none. A normal run clears this timer.
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

  // Writes the morph scalar and the resting-state classes that make each calculator clickable at its own end.
  function writeMorph(v) {
    morphStage.style.setProperty('--m', v.toFixed(4));
    morphStage.classList.toggle('is-new', v > .5);
    const atOld = v < .04, atApp = v > .96;
    morphStage.classList.toggle('is-live', atOld || atApp);
    morphStage.classList.toggle('is-old', atOld);
    morphStage.classList.toggle('is-app', atApp);
  }

  // Drives the morph scalar from mFrom to mTarget over MORPH_MS/MORPH_BACK_MS, one rAF at a time.
  function tick(ts) {
    if (!mStart) mStart = ts;
    const p = clamp((ts - mStart) / (mTarget ? MORPH_MS : MORPH_BACK_MS));
    mValue = mFrom + (mTarget - mFrom) * ease(p);
    writeMorph(mValue);
    if (p < 1) { mAnim = requestAnimationFrame(tick); return; }
    mAnim = 0;
    clearTimeout(mSettle); mSettle = 0;
  }

  // Retargets the morph. Rebased from the current value rather than resumed, so a reader who reverses mid-flight
  // gets it running back from where it actually is instead of jumping to where it would have been.
  function setMorph(target) {
    if (target === mTarget) return;
    mTarget = target;
    mFrom = mValue;
    mStart = 0;
    settleSoon();
    if (!mAnim) mAnim = requestAnimationFrame(tick);
  }

  // How far through the pin a scroll position is; the rail's calculator beats are read off this same measurement.
  const morphAt = (y) => (appRun > 0 ? (y - appTop) / appRun : 1);

  /* Where the morph commits, as a fraction of the pin's runway.
   *
   * The stylesheet's --morph-trip is a fraction of a runway that assumes the stage pins with its top at the
   * viewport's top. On a portrait phone it does not: it pins LOW, at appLiftPx into the section, so a fraction
   * chosen against the old geometry fires the morph while the reader is still scrolling the title past. The
   * trigger is therefore derived from the pin itself — just past where it catches — rather than restated.
   */
  const tripAt = () =>
    (appLiftPx > 0 && appRun > 0 ? Math.min(.9, (appLiftPx + APP_TRIP_AFTER) / appRun) : trip);

  /* Viewport heights of pinned scroll the turn is spread over, where it is scrubbed. Under the 644px the pin
     holds for on a 393x852 phone, so it lands with travel to spare. */
  const MORPH_SCRUB = .7;

  // Whether the reader drives the turn directly. Only where the pin is long enough to be worth scrubbing, which
  // is the portrait phone that measures a lift; everywhere else appLiftPx is 0.
  const scrubbing = () => appLiftPx > 0;

  // --m straight off the scroll: 0 until the pin catches, then the turn over MORPH_SCRUB of pinned travel.
  const scrubAt = (y) => clamp((y - appTop - appLiftPx) / Math.max(1, vh * MORPH_SCRUB));

  /* Commits the morph to a direction once the scroll crosses the trigger — or, where the pin is long enough,
   * hands the turn to the scroll outright.
   *
   * THE THRESHOLD AND ITS 900ms CLOCK EXIST FOR A SHORT PIN. Committing and playing out guarantees a pure end
   * state on a runway too short to hold a part-played one, which is what the desktop's .7 gives. A portrait
   * phone now pins for 644px, and over that distance a fixed clock is the wrong instrument: it fires at a line
   * the reader cannot see and then ignores them for 900ms, so scrolling back mid-turn does nothing and the two
   * states are a switch rather than the two ends of a gesture.
   */
  function morph(y) {
    if (!morphStage || !morphScroll) return;
    if (scrubbing()) {
      // The tween and its safety timer are the other mode's; left running they would fight the scrub for --m.
      if (mAnim) { cancelAnimationFrame(mAnim); mAnim = 0; }
      if (mSettle) { clearTimeout(mSettle); mSettle = 0; }
      const m = scrubAt(y);
      mValue = mTarget = mFrom = m;
      writeMorph(m);
      return;
    }
    const p = morphAt(y), t = tripAt();
    if (p >= t) setMorph(1);
    else if (p <= t * RELEASE) setMorph(0);
  }

  // Sets the pad's resting state from the actual scroll position on load — without this, a page loaded past
  // the trigger showed the app layout until crossing the trigger snapped it back to the faceplate first.
  function morphInit(y) {
    if (!morphStage || !morphScroll) return;
    mValue = mTarget = mFrom = scrubbing() ? scrubAt(y) : (morphAt(y) >= tripAt() ? 1 : 0);
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

  // ---- Cartographer's arrival ----
  // The section rises behind the hero over a whole viewport, trailing the scroll by LOOP_LIFT (never exactly
  // scroll speed). Only the section and the flow graph beside it animate. The graph is two position-driven
  // scalars, --gb (build) and --gf (collapse-on-exit) — two because arriving and leaving are different orders,
  // and one scalar can't have the top row lead both.
  const loopStage = document.getElementById('loop-stage');
  const loopScroll = document.getElementById('loop-scroll');
  const loopFlow = document.querySelector('.flow');
  let flowTop = 0, flowH = 0;

  const LOOP_LIFT = 80;   // px the section trails the scroll by when its arrival begins
  const LOOP_IN = .8;     // fraction of the arrival it's up to full strength over, so it isn't still fading in
                          // right as the section comes to rest

  // Both envelopes are timed against where the graph actually is, not the section's whole runway — timed
  // against the runway, most of the build fell below the fold and most of the collapse fell above it.
  // Fraction into the approach where half the graph clears the bottom of the window; the build ends exactly
  // where the section seats, so scrolling back up un-builds the graph without moving the section.
  const BUILD_AT = .45;
  // The position the LAST element is actually home, not where --gb reaches 1 — it delays to .75 of the scalar,
  // so every screen lands by --gb .91 and the rest is dead scroll. --gf is timed off this same threshold so the
  // graph is whole at exactly one position.
  const WHOLE = .91;

  // fallAt is derived as the pin's midpoint (not a separate constant) so the stationary scroll either side of it
  // is equal by construction, and --loop-run in site.css stays the one place the runway is declared.
  let fallAt = .03, buildSpan = .71;

  function shapeLoop() {
    fallAt = loopRun / 2;
    buildSpan = (1 + fallAt - BUILD_AT) / unease(WHOLE);
  }
  // Position the last element has actually left: the markup's largest --df (.46) plus the strike's .145 window.
  // Wrong the moment a --d, --df, or the --p rate in the stylesheet moves without this following.
  const STRUCK = .605;
  // Viewport heights either side of the rail's resting point that still count as "whole" — in scroll distance,
  // since gating on --gb/--gf instead opened the band early and closed it a tenth of a screen late.
  const WHOLE_BAND = .06;

  function loop(y) {
    if (!loopStage || !loopScroll) return;
    // One viewport of arrival, ending where the section seats: begins the moment its top edge crosses the
    // bottom of the screen, the first frame any of it is visible.
    const top = loopTop;
    const q = ease((y - (top - vh)) / vh);
    loopStage.style.setProperty('--o2', clamp(q / LOOP_IN).toFixed(3));
    loopStage.style.setProperty('--y2', ((1 - q) * LOOP_LIFT).toFixed(1) + 'px');

    const built = ease((y - (top - vh * (1 - BUILD_AT))) / (vh * buildSpan));
    // The collapse begins where the build lands and is spanned (divided by STRUCK) so the last element's exit
    // lands exactly where the section clears the top of the window. Linear, not eased: the section's departure
    // is already linear in scroll, so easing this on top would ease the same motion twice.
    const struck = clamp((y - (top + vh * fallAt)) / (vh * (loopRun + 1 - fallAt) / STRUCK));
    loopStage.style.setProperty('--gb', built.toFixed(3));
    loopStage.style.setProperty('--gf', struck.toFixed(3));
    loopStage.classList.toggle('is-drawing', Math.abs(y - (top + vh * fallAt)) > vh * WHOLE_BAND);
  }

  // Writes every per-scroll-frame custom property: the words' exit, the cue's fade, and the core/ring's own
  // curve, which starts once the words are clear and runs past the pin's end so they leave the stage still lit.
  /* THE GRAPH STILL RUNS WHEN THE SECTION IS NOT PINNED.
   *
   * Below shortLoop the section gives its pin back and simply passes, and the build and strike envelopes went
   * with it — the graph sat fully drawn and motionless while the one section whose whole point is a mechanism
   * scrolled by. Same two scalars, driven off a plain section's own travel instead of a pin's runway: assembled
   * as it rises into the screen, whole while it is seated, struck as it climbs out the top.
   *
   * --o2/--y2 are deliberately not written. Unpinned there is no arrival to trail, and the stylesheet's own
   * defaults on #loop-stage are the seated values.
   */
  /* BOTH ENVELOPES RUN OFF THE GRAPH, NOT THE SECTION. The graph sits at the bottom of a screen-tall section,
     under all of the copy, so a strike timed against the SECTION's travel began while the graph was still in the
     middle of the screen — measured, it started 422px down. Timed against the graph's own box instead it draws
     as it rises into view and does not begin to leave until it is near the top edge. */
  function loopFlat(y) {
    if (!loopStage || !loopScroll || !flowH) return;
    // Whole once it is entirely on screen, which for a box shorter than the viewport is its own height of travel.
    const built = ease((y - (flowTop - vh)) / flowH);
    /* NOTHING COLLAPSES WHILE THE GRAPH IS STILL WHOLLY BELOW THE TOP EDGE. The strike opens exactly as its own
       top crosses that edge (in practice, slides under the bar) and finishes as its bottom follows — so the
       collapse is the graph LEAVING rather than something that happens to it in the middle of the screen. An
       earlier start is the same animation begun too soon, not a longer one: leading it by .12vh had the first
       elements going while two thirds of the graph was still comfortably in frame.
       Linear and spanned by STRUCK, for the same reason the pinned envelope is. */
    const struck = clamp((y - flowTop) / (flowH / STRUCK));
    loopStage.style.setProperty('--gb', built.toFixed(3));
    loopStage.style.setProperty('--gf', struck.toFixed(3));
    // The idle circuit runs only while the graph is standing whole; drawing or striking, it is paused.
    loopStage.classList.toggle('is-drawing', built < .999 || struck > .001);
  }

  function frame() {
    const y = K.scrollY();
    morph(y);
    if (shortLoop.matches) loopFlat(y);
    else loop(y);
    const e = ease((y - hold * vh) / (exit * vh));

    // Opaque while climbing, fading only once mostly out — fading from pixel one would hide it before it had
    // visibly gone anywhere.
    stage.style.setProperty('--o1', (1 - ease((e - TEXT_HOLD) / (1 - TEXT_HOLD))).toFixed(3));
    stage.style.setProperty('--y1', (-TRAVEL * vh * e).toFixed(1) + 'px');
    stage.style.setProperty('--b1', (BLUR * e).toFixed(2) + 'px');
    stage.style.setProperty('--e1', e > .5 ? 'none' : 'auto');
    stage.style.setProperty('--cue-o', (1 - ease(e / CUE_OUT)).toFixed(3));

    const r = ease((y - (hold + exit * RING_START) * vh) / (RING_SPAN * vh));
    stage.style.setProperty('--core-s', (1 - CORE_SHRINK * r).toFixed(4));
    stage.style.setProperty('--halo-x', (HALO_SPREAD * r).toFixed(1) + 'px');
    stage.style.setProperty('--ring-o', (1 - r).toFixed(3));
  }

  function onScroll() {
    holdArm();
    frame();
  }

  // Re-measures on resize/layout change and drops the rail's anchor rather than rescaling it, since every
  // beat's position has just moved.
  function onResize() {
    measure();
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

  // The seated section with its graph fully drawn, by removing the writes back to the stylesheet's defaults;
  // reduced motion has its own rule to stop the idle circuit rather than a second flag to keep in sync.
  function loopFinal() {
    if (!loopStage) return;
    loopStage.style.removeProperty('--o2');
    loopStage.style.removeProperty('--y2');
    loopStage.style.removeProperty('--gb');
    loopStage.style.removeProperty('--gf');
    loopStage.classList.remove('is-drawing');
  }

  // Below this height a landscape phone (393px tall) can't hold the pinned morph, so the section falls back to
  // a plain block. Matches the stylesheet's own short query.
  const short = window.matchMedia('(max-height: 620px)');

  // Matches the stylesheet's query for when Cartographer gives its pin back, so the script stops driving the
  // section exactly when the stylesheet stops pinning it.
  const shortLoop = window.matchMedia('(max-height: 760px), (max-width: 1080px) and (max-height: 900px)');

  // The rail is off on a phone: scrolling is the reader's own gesture there and the content needs more of the
  // screen than a beat leaves it, so a glide they didn't ask for takes the page off them mid-read. Every scrub
  // and pin above this stays running. The stylesheet drops scroll-snap-type on the same pair — 820/500, the one
  // the labs use — so the barriers go with it.
  const phone = window.matchMedia('(max-width: 820px), (max-height: 500px)');

  // The position to aim at when showing Cartographer: the pin's midpoint, where the graph is whole, rather than
  // the top where nothing is drawn yet. Falls back to the section top once the scene has given its pin back.
  function loopIdleY() {
    if (!loopScroll) return 0;
    if (shortLoop.matches) return loopTop;
    return Math.round(loopTop + screenH() * fallAt);
  }

  // The position where the reactor holds the frame alone (words gone, ring not yet opening); the only
  // declaration of it, so the page stops moving the instant the reader's own gesture finishes carrying words off.
  function heroAloneY() {
    return Math.round((hold + exit) * screenH());
  }

  // ---- and the scroll is stopped on the beats ----
  // Five beats are worth resting on: hero, reactor-alone, Cartographer, and each end of the calculator's pin.
  // Snap targets below arrest the fling (`scroll-snap-stop: always`); the rail further down closes whatever gap
  // is left once scrolling stops. A barrier is for arriving, not staying: a trackpad's decaying stream fires as
  // many small gestures, so a target under the reader would pull every tick back and trap them — it's stood
  // down the moment they touch an input and re-armed once the page rests, while the beat ahead stays armed.
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

  // The beats, in page order — the one description the rail and every barrier below read, so a stop and its
  // guarded position can't drift apart. `at: null` means the beat isn't there right now.
  function beats() {
    const dead = reduced.matches || short.matches;
    const noApp = dead || appRun <= 0;
    return [
      { el: null, base: 0, at: dead ? null : 0, sec: 'alex', fill: .5 },
      { el: heroSnap, base: 0, at: dead ? null : heroAloneY(), sec: 'alex', fill: 1 },
      { el: loopSnap, base: loopTop, sec: 'cartographer', fill: 1,
        at: dead || shortLoop.matches || !loopScroll ? null : loopIdleY() },
      // The calculator's pin carries exactly its two resting states (faceplate, shipped app) — nothing between
      // them is a place to be, so the turn happens on the way between.
      { el: appOldSnap, base: appTop, at: noApp ? null : appTop, sec: 'app', fill: .5 },
      { el: appAppSnap, base: appTop, at: noApp ? null : appTop + appRun, sec: 'app', fill: 1 },
      { el: expSnap, base: expTop, at: dead ? null : expTop, sec: 'experience', fill: 1 },
      // With contact at 100dvh there's 965px under labs for the rail's RAIL_PAST release region; at contact's
      // old 325px height that region didn't exist and every scroll below labs got dragged back up to it.
      { el: labsSnap, base: labsTop, at: dead ? null : labsTop, sec: 'labs', fill: 1 },
      // Contact is the last beat and sits at max scroll, so the rail has no released region past it — with
      // nothing below, there's nothing to drag a reader back from.
      { el: contactSnap, base: contactTop, at: dead ? null : contactTop, sec: 'contact', fill: 1 },
    ];
  }

  // Places each snap target in pixels off the same numbers the scrubs run on (not vh, which would disagree
  // with the rig the first time dvh and vh differed), and disables snapping on whichever beat is stood down.
  function placeSnap() {
    for (const t of beats()) {
      if (!t.el) continue;
      const live = t.at !== null;
      t.el.style.top = live ? (t.at - t.base) + 'px' : '';
      t.el.style.scrollSnapAlign = live && !(snapOff >= 0 && Math.abs(t.at - snapOff) < 1) ? '' : 'none';
    }
  }

  // Stands down whichever beat the reader is on. Only ever stands one down — re-arming by distance instead of
  // by the settle bounced a real scroll 742 -> 887 -> 795 -> 922 -> 742 and gave up.
  function snapFree(y) {
    if (snapOff >= 0) return;
    const gap = screenH() * SNAP_FREE;
    for (const t of beats()) {
      if (t.el && t.at !== null && Math.abs(t.at - y) < gap) { snapOff = t.at; placeSnap(); return; }
    }
  }

  // Re-arms the beat snapFree stood down.
  function snapArm() {
    if (snapOff < 0) return;
    snapOff = -1;
    placeSnap();
  }

  // ---- and the reader is walked between them ----
  // The snap targets above are barriers, arresting a gesture that would cross a beat; this rail closes whatever
  // gap is left once scrolling stops. It commits rather than rounds: past RAIL_COMMIT of the way to the next
  // beat, the reader is carried the rest of the way. Past the last beat the rail is simply gone. One speed, not
  // one duration, since the glide drives every envelope it crosses at whatever rate reads best regardless of
  // distance. Any input cancels and re-arms it rather than spending it.
  const HOLD_WAIT = 500;    // ms of stillness before the rail acts, so several flicks count as one gesture
  const HOLD_NEAR = 8;      // px; closer than this there's nothing to correct and a glide is only a jitter
  const RAIL_COMMIT = .35;  // of the gap to the next beat: past this, the reader is taken the rest of the way
  const RAIL_PAST = .5;     // viewport heights past the last beat the rail still holds the reader on it
  // Widest gap the rail will carry a reader across, in viewport heights — beyond this two beats are two places
  // with reading between them, not a hand-off. Every gap on a roomy window is under one screen.
  const RAIL_REACH = 1.25;
  // px/second, not a duration, since the glide drives every envelope it crosses. Also nav.js's speed, for its
  // arrow-key/space-bar steps.
  const HOLD_SPEED = 520;
  const HOLD_MIN = 380, HOLD_MAX = 1700;
  const glideMs = (dist) => Math.max(HOLD_MIN, Math.min(HOLD_MAX, Math.abs(dist) / HOLD_SPEED * 1000));

  let holdWait = 0, anchorY = -1;

  // The beats' positions, with the ones not currently there dropped.
  function railStops() {
    return beats().filter((b) => b.at !== null).map((b) => b.at);
  }

  // The same table for the header's meter: `sec` is the section a beat's bar belongs to, `fill` how much of it
  // the beat earns (e.g. hero seated is half of ALEX, the reactor the other half).
  function railMeter() {
    return beats().filter((b) => b.at !== null && b.sec).map((b) => ({ at: b.at, sec: b.sec, fill: b.fill }));
  }

  // Compared with slack, not equality: the anchor is a beat's position as measured when the last glide landed,
  // and a resize moves every beat.
  const atBeat = (a, b) => Math.abs(a - b) < HOLD_NEAR;

  // Where the rail would carry the reader from y, or null if the rail doesn't apply here at all.
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
    // No anchor to hold against (a nav anchor jump, or a reload part-way down): nearest, since there's no
    // gesture direction to honor.
    return f < .5 ? lo : hi;
  }

  // Cancels a pending settle and any in-flight rail glide, restoring snapping via K.stopGlide — canceling
  // without it left snapping off for the rest of the session when the rig stood itself down mid-glide.
  function holdStop() {
    if (holdWait) { clearTimeout(holdWait); holdWait = 0; }
    if (railGliding()) K.stopGlide();
  }

  const railGliding = () => K.glideOwner() === 'rail';

  // Glides the page to a beat, standing down snapping (it grabs programmatic scrolls too). The anchor updates
  // only on arrival, so a glide the reader interrupts leaves it on the beat they left.
  function holdGlide(to) {
    K.glideTo(to, {
      ms: glideMs(to - K.scrollY()),
      // Smoothstep, not the kit's default: this is a correction the reader didn't ask for, so it eases in as
      // well as out. A nav anchor jump they did ask for starts at speed.
      ease: ease,
      owner: 'rail',
      onArrive: (y) => { anchorY = y; snapArm(); },
    });
  }

  // Fires HOLD_WAIT after the last scroll input; re-arms snapping and glides to the rail target.
  function holdSettle() {
    holdWait = 0;
    snapArm();
    if (reduced.matches || short.matches || phone.matches) return;
    // nav.js is moving the page itself (a keyboard step or anchor jump): re-armed rather than dropped, so the
    // rail still tidies up once the press lands instead of leaving two glides racing for the same position.
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

  // Exposes the beats to nav.js, which reads them rather than restating the geometry.
  window.AKSCENE = {
    cartographerIdleY: loopIdleY,
    heroAloneY: heroAloneY,
    beats: railStops,
    meter: railMeter,
    glideMs: glideMs,
  };

  const HOLD_INPUT = ['wheel', 'touchstart', 'keydown'];

  let unsub = [];

  // (Re-)wires the rig for the current media-query state; re-run on every reduced-motion/short/shortLoop change.
  function apply() {
    unsub.forEach((off) => off());
    unsub = [];
    for (const ev of HOLD_INPUT) window.removeEventListener(ev, holdRelease);
    holdStop();
    snapOff = -1;
    if (reduced.matches || short.matches) { placeSnap(); clear(); morphFinal(); return; }
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
  for (const q of [reduced, short, shortLoop, phone]) {
    if (q.addEventListener) q.addEventListener('change', apply);
    else if (q.addListener) q.addListener(apply);
  }

  // Sections below the stage rise in once, on arrival, via IntersectionObserver rather than the scroll handler
  // above.
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
