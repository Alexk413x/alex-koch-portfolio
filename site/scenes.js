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

  function frame() {
    queued = false;
    const y = window.scrollY || window.pageYOffset || 0;
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

  function apply() {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    if (reduced.matches) { clear(); return; }
    measure();
    frame();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
  }

  apply();
  // addListener is the pre-2021 Safari spelling; without it the fallback is simply that the rig never re-arms.
  if (reduced.addEventListener) reduced.addEventListener('change', apply);
  else if (reduced.addListener) reduced.addListener(apply);
})();
