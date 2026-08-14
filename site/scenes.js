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

  const TRAVEL = 130;       // px a scene rises as it leaves — generous, still readable
  const BLUR = 8;           // px of defocus at full exit
  const RING_SWELL = .14;   // the ring inflates as the scene leaves, so the exit is not a flat fade
  const RING_LAG = .25;     // fraction of the exit the ring holds for after the text has started going

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let hold = .5, exit = .7, vh = 1, queued = false;

  /* Reads the scene runway back off the stylesheet. site.css is the only place --scene-hold and --scene-exit are
     written, so the height the stage stays pinned for and the range the exit is scrubbed across cannot disagree —
     restating either number here is how a rig like this ends up scrubbing past the end of its own container. */
  function measure() {
    const cs = getComputedStyle(document.documentElement);
    hold = parseFloat(cs.getPropertyValue('--scene-hold')) || 0;
    exit = parseFloat(cs.getPropertyValue('--scene-exit')) || 1;
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
  const SCRUB = .85;   // fraction of the pin spent morphing; the rest holds the finished state before unpinning

  function morph(y) {
    if (!morphStage || !morphScroll) return;
    const run = morphScroll.offsetHeight - morphStage.offsetHeight;
    const t = run > 0 ? ease(((y - morphScroll.offsetTop) / run) / SCRUB) : 1;
    morphStage.style.setProperty('--m', t.toFixed(4));
    morphStage.classList.toggle('is-new', t > .5);
    // Keys stay inert until the shipped state is essentially reached, so a scroll-past cannot half-press one.
    morphStage.classList.toggle('is-live', t > .96);
  }

  // Everything reaches its shipped state and stays there: no pin, no scrub.
  function morphFinal() {
    if (!morphStage) return;
    morphStage.style.setProperty('--m', '1');
    morphStage.classList.add('is-new', 'is-live');
  }

  function frame() {
    queued = false;
    const y = window.scrollY || window.pageYOffset || 0;
    morph(y);
    const e = ease((y - hold * vh) / (exit * vh));

    stage.style.setProperty('--o1', (1 - e).toFixed(3));
    stage.style.setProperty('--y1', (-TRAVEL * e).toFixed(1) + 'px');
    stage.style.setProperty('--b1', (BLUR * e).toFixed(2) + 'px');
    stage.style.setProperty('--e1', e > .5 ? 'none' : 'auto');
    stage.style.setProperty('--ring', (1 + RING_SWELL * e).toFixed(4));
    /* The ring is a sibling of the scene, not a child, so it does not inherit the scene's fade — it is the
       persistent device and later scenes pass in front of it. On its own curve it must still be gone before the
       stage unpins, or the last of the runway is a bare ring holding the screen. Lagged: the text leaves, then
       the instrument powers down. */
    stage.style.setProperty('--ring-o', (1 - ease((e - RING_LAG) / (1 - RING_LAG))).toFixed(3));
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
    for (const p of ['--o1', '--y1', '--b1', '--e1', '--ring', '--ring-o']) stage.style.removeProperty(p);
  }

  /* A pinned, scrubbed morph needs a viewport tall enough to hold the scene. A landscape phone is 393px tall, so
     below that the section is a plain block showing the finished calculator. Matches the stylesheet's short query. */
  const short = window.matchMedia('(max-height: 620px)');

  function apply() {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    if (reduced.matches || short.matches) { clear(); morphFinal(); return; }
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
