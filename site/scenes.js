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
    if (libSec) libTop = libSec.offsetTop;
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

  /* THE SCROLL DRIVES THE TURN, AND A STOP PART-WAY FINISHES IT.
   *
   * --m is the scroll position through the turn, so the calculator moves exactly as fast as the page does. When
   * scrolling stops with the turn part-played, the page itself glides on in the direction it was last going
   * until the turn lands, and the scrub follows the glide. A part-played calculator is never left at rest: its
   * keypad only takes input at either end.
   *
   * Only a gesture that began at or inside the pin gets carried on. One that began outside it and coasted in,
   * a fling's momentum carrying up out of Experience, settles back to the end it entered by, so arriving from
   * either side always lands on that side's calculator first.
   *
   * This glide runs on touch screens too, where the rail is off. It stays inside the pin.
   */
  const MORPH_MS = 900;     // glide time for a whole turn; a part-turn gets its share
  const MORPH_WAIT = 120;   // ms of stillness that counts as the reader letting go
  const MORPH_SCRUB = .7;   // viewport heights the turn spans on a portrait phone, under its 644px pin

  let mValue = 0, morphDir = 1, morphLastY = 0, morphWait = 0, morphTouch = false;
  let morphRestY = 0;       // where the page last came to rest, which says where the current gesture began

  // A finger resting on the screen is holding the page, not letting go of it, so no glide until it lifts.
  window.addEventListener('touchstart', () => { morphTouch = true; }, { passive: true });
  for (const ev of ['touchend', 'touchcancel']) {
    window.addEventListener(ev, () => {
      morphTouch = false;
      if (!morphWait) morphWait = setTimeout(morphSettle, MORPH_WAIT);
    }, { passive: true });
  }

  // Writes the morph scalar and the resting-state classes that make each calculator clickable at its own end.
  function writeMorph(v) {
    mValue = v;
    morphStage.style.setProperty('--m', v.toFixed(4));
    morphStage.classList.toggle('is-new', v > .5);
    const atOld = v < .04, atApp = v > .96;
    morphStage.classList.toggle('is-live', atOld || atApp);
    morphStage.classList.toggle('is-old', atOld);
    morphStage.classList.toggle('is-app', atApp);
  }

  // Where the turn runs, in page pixels. The whole pin on a desktop, so its two rail beats are its two ends. A
  // portrait phone pins LOW (see appLift), so there the turn starts where the pin catches and spans MORPH_SCRUB.
  function morphSpan() {
    if (appLiftPx > 0) {
      return { from: appTop + appLiftPx, len: Math.max(1, Math.min(vh * MORPH_SCRUB, appRun - appLiftPx)) };
    }
    return { from: appTop, len: Math.max(1, appRun) };
  }

  const morphAtY = (y) => { const s = morphSpan(); return clamp((y - s.from) / s.len); };

  function morph(y) {
    if (!morphStage || !morphScroll) return;
    if (Math.abs(y - morphLastY) >= 1) { morphDir = y > morphLastY ? 1 : -1; morphLastY = y; }
    writeMorph(morphAtY(y));
    if (K.glideOwner() === 'morph') return;
    clearTimeout(morphWait);
    morphWait = setTimeout(morphSettle, MORPH_WAIT);
  }

  function morphSettle() {
    morphWait = 0;
    if (morphTouch) return;
    // Someone else is already moving the page; their glide ends somewhere this will be asked about again.
    if (K.busy()) { morphWait = setTimeout(morphSettle, MORPH_WAIT); return; }
    const y = K.scrollY();
    const m = morphAtY(y);
    if (m <= 0 || m >= 1) { morphRestY = y; return; }
    const s = morphSpan(), end = s.from + s.len;
    let down = morphDir > 0;
    if (morphRestY < s.from - HOLD_NEAR) down = false;
    else if (morphRestY > end + HOLD_NEAR) down = true;
    const to = Math.round(down ? end : s.from);
    K.glideTo(to, {
      ms: Math.max(180, MORPH_MS * (down ? 1 - m : m)),
      owner: 'morph',
      // Lands on a rail beat on a desktop, so the rail treats it as parked there rather than correcting it.
      onArrive: (at) => { morphRestY = at; anchorY = at; snapArm(); snapRest(at); },
    });
  }

  function morphStop() {
    clearTimeout(morphWait); morphWait = 0;
    if (K.glideOwner() === 'morph') K.stopGlide();
  }

  // Sets the pad's resting state from the actual scroll position on load.
  function morphInit(y) {
    if (!morphStage || !morphScroll) return;
    morphLastY = morphRestY = y;
    writeMorph(morphAtY(y));
  }

  // Everything reaches its shipped state and stays there: no pin, no scrub.
  function morphFinal() {
    if (!morphStage) return;
    morphStop();
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
    stage.style.setProperty('--cue-v', e < CUE_OUT ? 'visible' : 'hidden');

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
    for (const p of ['--o1', '--y1', '--b1', '--e1', '--cue-o', '--cue-v', '--core-s', '--halo-x', '--ring-o']) {
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

  // The rail is off on a phone and on every touch-first screen: scrolling is the reader's own gesture there, so a
  // glide they didn't ask for takes the page off them mid-read. Every scrub and pin above this stays running. The
  // stylesheet drops scroll-snap-type on the same query, so the barriers go with it; the two must match.
  const touchScroll = window.matchMedia('(max-width: 820px), (max-height: 500px), (hover: none) and (pointer: coarse)');

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
  const libSnap = document.getElementById('library-snap');
  const libSec = document.getElementById('library');
  const expSec = document.getElementById('experience');
  const labsSec = document.getElementById('labs');
  const contactSnap = document.getElementById('contact-snap');
  const contactSec = document.getElementById('contact');

  const SNAP_FREE = .12;    // of a viewport: how near a beat still counts as being parked on it.
  let snapOff = -1;         // page position of the target stood down for this gesture, or -1 for none.
  let expTop = 0, labsTop = 0, libTop = 0, contactTop = 0;

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
      { el: libSnap, base: libTop, at: dead ? null : libTop, sec: 'library', fill: 1 },
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
    const root = document.documentElement;
    let rearmed = false;
    for (const t of beats()) {
      if (!t.el) continue;
      const live = t.at !== null;
      t.el.style.top = live ? (t.at - t.base) + 'px' : '';
      const align = live && !(snapOff >= 0 && Math.abs(t.at - snapOff) < 1) ? '' : 'none';
      if (align === '' && t.el.style.scrollSnapAlign === 'none') rearmed = true;
      t.el.style.scrollSnapAlign = align;
    }
    // Safari re-snaps to the last target it snapped to when that target's alignment comes back, so re-arming the
    // reactor's beat from Cartographer threw the reader back up to it. Re-arming with snapping off, flushing
    // layout, then restoring it makes Safari pick the nearest target instead; Chrome and Firefox are unaffected.
    if (rearmed) {
      const prev = root.style.scrollSnapType;
      root.style.scrollSnapType = 'none';
      root.getBoundingClientRect();
      root.style.scrollSnapType = prev;
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

  /* Resting on either end of the calculator's pin keeps that end stood down; the far end stays armed.
   * Standing it down on input is too late there: Chrome settles a wheel gesture against the snap targets it had
   * when the gesture began, so a notch away from an armed end is pulled back onto it and the turn reverses
   * against the reader. Every other beat still re-arms at rest.
   */
  function snapRest(y) {
    if (appRun <= 0 || snapOff >= 0) return;
    for (const at of [appTop, appTop + appRun]) {
      if (Math.abs(y - at) < HOLD_NEAR) { snapOff = at; placeSnap(); return; }
    }
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
  // Leaving the calculator by either end commits almost at once. Its turn already carries on in the direction of
  // travel, so a rail that pulled the next notch back would be the one place the page disagreed with itself.
  const RAIL_EXIT = .05;
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
    // Off the calculator's app end going down, or off its faceplate going up, is leaving it.
    const offApp = appRun > 0 && atBeat(lo, appTop + appRun), offFace = appRun > 0 && atBeat(hi, appTop);
    if (atBeat(anchorY, lo)) return f < (offApp ? RAIL_EXIT : RAIL_COMMIT) ? lo : hi;
    if (atBeat(anchorY, hi)) return f > 1 - (offFace ? RAIL_EXIT : RAIL_COMMIT) ? hi : lo;
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
    // nav.js is moving the page itself (a keyboard step or anchor jump): re-armed rather than dropped, so the
    // rail still tidies up once the press lands instead of leaving two glides racing for the same position.
    // Checked BEFORE snapArm: a tap's touchstart stands the origin beat down, and re-arming it mid-glide lets
    // Safari re-snap to it the moment the glide restores snapping, throwing an iPad reader back from the link.
    if (K.glideOwner() === 'nav' || K.glideOwner() === 'morph') {
      holdWait = setTimeout(holdSettle, HOLD_WAIT);
      return;
    }
    snapArm();
    snapRest(K.scrollY());
    if (reduced.matches || short.matches || touchScroll.matches) return;
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
    morphStop();
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
  for (const q of [reduced, short, shortLoop, touchScroll]) {
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
