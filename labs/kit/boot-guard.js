/* boot-guard.js — recovers a lab whose module graph never loaded. Deliberately NOT a module.
 *
 * A module body does not run if any of its imports fails to fetch. Every lab calls mountLoader() and runLoop()
 * from its entry module's body, so ONE failed request skips both: the ring is never built and labReady() --
 * the only line that removes the loading sheet -- is never reached. A single 503 on labs/kit/units.js was
 * measured leaving a full-viewport opaque black sheet with no ring, no text and no error on screen, which a
 * viewer cannot tell apart from a slow load. A guard living inside that graph would be skipped with it, which
 * is why this is a classic script and why it is loaded before the module.
 *
 * IT RELOADS ONCE, AND ONLY ONCE. An unguarded retry turns a broken deploy into a reload loop against the
 * server that is already failing. The flag is in sessionStorage so it dies with the tab, and labReady() clears
 * it on success so a later failure still gets its own retry.
 *
 * THE FAILURE IS CAUGHT IN THE CAPTURE PHASE BECAUSE THERE IS NOWHERE ELSE. A static import that 503s fires
 * `error` at the SCRIPT element; it does not bubble and window.onerror never sees it. Measured, not assumed.
 * The timer is only a backstop for a failure that raises nothing at all.
 */
(function () {
  var KEY = 'kit-boot-retry';
  var GRACE_MS = 10000;   // longer than any measured cold start, including a first shader compile
  var acted = false;

  function sheet() { return document.querySelector('.kit-load'); }

  /* Reloads the page, or explains itself if it has already tried. `why` is shown to the viewer on the second
     failure, so a lab that cannot come up says so instead of sitting on a black rectangle. */
  function recover(why) {
    var el = sheet();
    // No sheet, or it is already going: the lab came up and there is nothing to recover.
    if (acted || !el || el.classList.contains('done')) return;
    acted = true;
    var tried;
    try { tried = sessionStorage.getItem(KEY); } catch (e) { tried = '1'; }   // private mode throws
    if (!tried) {
      try { sessionStorage.setItem(KEY, why); } catch (e) {}
      location.reload();
      return;
    }
    el.innerHTML = '<div class="kit-load-name"></div><div class="kit-load-stage"></div>';
    el.querySelector('.kit-load-name').textContent = document.title;
    el.querySelector('.kit-load-stage').textContent = why + ' — reload to try again';
  }

  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window && e.target.tagName === 'SCRIPT') recover('This lab did not load');
  }, true);
  window.addEventListener('unhandledrejection', function () { recover('This lab did not load'); });
  window.addEventListener('load', function () {
    setTimeout(function () { recover('This lab is not responding'); }, GRACE_MS);
  });
})();
