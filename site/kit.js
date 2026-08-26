/* kit.js — the parts of the home page's scripts that are not about any one section.
 *
 * A classic script and not a module, because every file that needs it is one: the page's scripts are IIFEs that
 * already talk through window.AK* handles, and converting them all to modules is a change to how the page loads
 * rather than to what it does. Loaded first, so AKKIT exists before anything reaches for it.
 *
 * Three things live here, each of which existed two or three times before:
 *
 *   glideTo     ONE programmatic scroll. nav.js and scenes.js each had their own, and because two tweens can
 *               drive window.scrollY at once, scenes.js had to poll AKNAV.busy() to keep out of nav's way.
 *               One tween cannot race itself: starting a glide cancels whatever was gliding.
 *   onScroll    ONE passive scroll listener, coalesced onto one frame and fanned out. nav, scenes and timeline
 *               each ran their own listener and their own rAF gate.
 *   onResize    ONE resize channel: the resize event, the load event, and a ResizeObserver on the body. Fonts
 *               landing and the rack building move every section below them and fire no resize, which is why
 *               the observer is here; three of them were watching the same element.
 */
(function () {
  'use strict';

  const root = document.documentElement;
  const scrollY = () => window.scrollY || window.pageYOffset || 0;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

  /* ---- the one programmatic scroll ---- */

  let anim = 0, owner = null;

  /* Restores snapping as well as canceling the frame. Stopping the tween without restoring it is what left
     scroll snapping switched off for the rest of the session whenever a glide was interrupted by a stand-down
     rather than by the reader. */
  function stopGlide() {
    if (!anim) return;
    cancelAnimationFrame(anim);
    anim = 0; owner = null;
    root.style.scrollSnapType = '';
  }

  /* Eases the page to `to`, standing scroll snapping down for the trip.
   *
   * SNAPPING IS STOOD DOWN OR THE EASING BUYS NOTHING. Snapping grabs programmatic scrolls too, so a glide that
   * crosses a beat is yanked onto it rather than eased onto it. Measured on the step from the top of the page to
   * the reactor: 742px covered between 160ms and 485ms of a 1.4s glide with snapping live, against 1314ms of
   * even travel with it off.
   *
   * `behavior: instant` per frame, because the stylesheet sets scroll-behavior: smooth for anchor jumps and
   * letting each of these sixty steps run its own smooth scroll compounds the two easings into a crawl.
   *
   * `owner` names who asked, so a caller can tell its own glide from someone else's. `onArrive` runs only on a
   * completed trip: a glide the reader interrupts must not commit the arrival it never made.
   *
   * `ease` is a parameter and not a constant because the two callers genuinely differ: an anchor jump eases
   * out of a hand-off, and the rail's settle eases in AND out of a correction the reader did not ask for.
   */
  function glideTo(to, opts) {
    const o = opts || {};
    stopGlide();
    const from = scrollY(), dist = to - from;
    if (Math.abs(dist) < (o.minDist || 0)) return;
    const ms = Math.max(1, o.ms || 600);
    const ease = o.ease || easeOutCubic;
    owner = o.owner || null;
    root.style.scrollSnapType = 'none';
    let t0 = 0;
    const step = (ts) => {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / ms);
      window.scrollTo({ top: Math.round(from + dist * ease(p)), behavior: 'instant' });
      if (p < 1) { anim = requestAnimationFrame(step); return; }
      anim = 0; owner = null;
      root.style.scrollSnapType = '';
      if (o.onArrive) o.onArrive(to);
    };
    anim = requestAnimationFrame(step);
  }

  /* ---- one listener per channel, coalesced onto one frame ---- */

  function channel() {
    const fns = new Set();
    let queued = false;
    const run = () => { queued = false; fns.forEach((f) => f()); };
    return {
      // Coalesced: a scroll fires many times per frame and every subscriber wants the settled position, once.
      fire() { if (!queued && fns.size) { queued = true; requestAnimationFrame(run); } },
      // Uncoalesced, for a subscriber that must see the change before the next paint.
      fireNow: run,
      add(fn) { fns.add(fn); return () => fns.delete(fn); },
      get size() { return fns.size; },
    };
  }

  const scrolls = channel(), resizes = channel();

  window.addEventListener('scroll', scrolls.fire, { passive: true });
  window.addEventListener('resize', resizes.fire);
  window.addEventListener('load', resizes.fire);
  if ('ResizeObserver' in window) new ResizeObserver(resizes.fire).observe(document.body);

  window.AKKIT = {
    scrollY, clamp01, easeOutCubic,
    glideTo, stopGlide,
    // The current glide's owner, or null. `busy()` is "the page is moving itself", whoever started it.
    glideOwner: () => owner,
    busy: () => anim !== 0,
    onScroll: scrolls.add,
    onResize: resizes.add,
  };
})();
