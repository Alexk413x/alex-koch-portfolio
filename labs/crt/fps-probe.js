/* fps-probe.js — the true frame rate of the CRT lab, and what each layer costs to get it.
 *
 * NOT PART OF THE LAB. Nothing in CRT Lab.dc.html loads this and nothing should: it is a measuring instrument that
 * attaches from the console, so it costs exactly nothing when it is not being used.
 *
 *     <script src="/fps-probe.js"></script>        or paste this file into the console
 *
 * WHY IT EXISTS. Every frame number this project has been quoted came from the FPS readout in the corner, and that
 * readout is driven by requestAnimationFrame -- which Chrome DOES NOT RUN in a tab that is not visible. A backgrounded
 * tab is not rendering slowly, it is not rendering at all, so the readout goes to 0-1 and means nothing. Worse, taking
 * a screenshot over CDP forces a single frame, so the number moves just enough to look alive. Every measurement here
 * is therefore gated on document.visibilityState and REFUSES to report from a hidden tab rather than reporting a lie.
 *
 * THE RESULT SURVIVES THE SESSION. Recording writes to localStorage under 'crtfps.report', so the window can be
 * brought to the front, left alone to record, and read back afterwards from anywhere -- including a tool driving the
 * tab, which cannot itself make the tab visible.
 *
 *   CRTFPS.live()            a live readout in the corner: instantaneous, p50, p95, worst, dropped
 *   CRTFPS.record(seconds)   record a window and store the result   (default 10)
 *   CRTFPS.stress()          turn ON everything that animates, so "worst case" is a state and not an opinion
 *   CRTFPS.attribute()       the important one -- see below
 *   CRTFPS.report()          read back the last stored result
 *   CRTFPS.stop()            detach everything
 */
(function () {
  'use strict';

  var W = window;
  var KEY = 'crtfps.report';
  var TARGET = 1000 / 60;                                  // 16.667ms

  /* THE COMPONENT, FOUND THE SAME WAY A DEBUGGER WOULD. The lab's logic class is not on window -- it lives on a React
   * fiber -- so walk up from a known element until something with setState turns up, then take its .logic. Done once
   * and cached; if the tree remounts, call CRTFPS.rebind(). */
  var L = null;
  function bind() {
    var host = document.getElementById('crt_monitor');
    if (!host) return null;
    var k = Object.keys(host).filter(function (s) { return s.indexOf('__reactFiber$') === 0; })[0];
    if (!k) return null;
    var f = host[k];
    while (f && !(f.stateNode && f.stateNode.setState)) f = f.return;
    return (f && f.stateNode && f.stateNode.logic) || null;
  }
  function logic() { return L || (L = bind()); }

  /* RESULTS GO TO STORAGE **AND** TO THE SERVER, because the only trustworthy measurement is one taken in a browser
   * that is doing nothing else. Once a session has opened a dozen tabs each running a full lab, absolute frame times
   * drift by 2-3x and cross-run comparisons become worthless -- measured exactly that way here: one unchanged build
   * read 33ms early in a session and 71ms late in it.
   *
   * So a run belongs in a THROWAWAY Chrome profile (--user-data-dir) with one tab and no extensions, which shares no
   * localStorage with anything. POSTing the result to the server that served the page is how it gets back out.
   * Beacon first because it survives the tab closing; fetch as the fallback. Both are fire-and-forget and neither is
   * on the measured path -- publish() is only ever called after a recording has ended. */
  function publish(rec) {
    try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) {}
    try {
      var body = JSON.stringify(rec);
      if (navigator.sendBeacon) { navigator.sendBeacon('/fps', new Blob([body], { type: 'application/json' })); return; }
      fetch('/fps', { method: 'POST', body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  function pct(a, p) {
    if (!a.length) return 0;
    var b = a.slice().sort(function (x, y) { return x - y; });
    return b[Math.min(b.length - 1, Math.floor(b.length * p))];
  }

  /* ---- the sampler -------------------------------------------------------------------------------------------- */
  var raf = 0, last = 0, dts = [], running = false, onTick = null;

  function step(now) {
    if (!running) return;
    if (last) dts.push(now - last);
    last = now;
    if (onTick) onTick(now);
    raf = requestAnimationFrame(step);
  }
  function start() { if (running) return; running = true; last = 0; dts = []; raf = requestAnimationFrame(step); }
  function halt() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  /* A frame is DROPPED if it took longer than one and a half vsyncs. Not "longer than 16.7" -- at 60Hz the intervals
   * scatter either side of the target by a millisecond or so and counting those as drops reports 40% dropped on a
   * page that is visibly perfect. 1.5x is the threshold at which a frame was genuinely missed. */
  function summarise(a) {
    if (!a.length) return null;
    var sum = 0, dropped = 0, i;
    for (i = 0; i < a.length; i++) { sum += a[i]; if (a[i] > TARGET * 1.5) dropped++; }
    return {
      frames: a.length,
      fps: +(1000 / (sum / a.length)).toFixed(1),
      /* meanMs IS THE ONE TO COMPARE BUILDS WITH, and medianMs is the one that was, and was wrong.
       *
       * rAF is delivered on the vsync, so an individual interval can only BE a multiple of 16.67ms. The median of
       * a set of vsync multiples is a vsync multiple -- 16.7 or 33.3 or 50, never 41. So a change worth a few ms
       * moves the median not at all, and then a whole step at once, and its sign depends on which side of the step
       * the two windows happened to land. attribute() scored deltas that way and duly reported the screen flicker
       * SAVING 33.1ms and the vignette saving 16.4ms -- negative costs, i.e. a staircase read as a ruler.
       *
       * The mean is continuous, because a page over budget does not sit on one step: it mixes 33.3s and 50s and the
       * RATIO moves smoothly with cost. Measured with the mean on the same page, the additive ladder resolves every
       * static layer at 0.00ms and separates the three animated ones cleanly.
       *
       * medianMs stays because it is the honest answer to a different question -- what a TYPICAL frame took, which
       * is what the user sees -- and because the p95/dropped pair either side of it are read the same way.
       */
      meanMs: +(sum / a.length).toFixed(2),
      medianMs: +pct(a, 0.5).toFixed(2),
      p95Ms: +pct(a, 0.95).toFixed(2),
      worstMs: +Math.max.apply(null, a).toFixed(2),
      droppedPct: +(dropped * 100 / a.length).toFixed(1),
      locked60: pct(a, 0.95) <= TARGET * 1.25             // 95% of frames within a quarter-vsync of target
    };
  }

  function visible() {
    if (document.visibilityState === 'visible') return true;
    console.warn('[CRTFPS] tab is HIDDEN — Chrome runs no animation frames here, so there is nothing to measure. ' +
                 'Bring the window to the front and run again.');
    return false;
  }

  /* ---- the layer roster ---------------------------------------------------------------------------------------
   * Everything that animates or repaints, each with the state that switches it OFF and a label. Ordered roughly by
   * suspected cost. `off` is applied with setState; `restore` is captured live so nothing is guessed. */
  var LAYERS = [
    { id: 'lightfixture', label: 'light fixture (3D + 2 SVG warps)', off: { lightOn: false } },
    { id: 'sweeps',       label: 'beam sweeps (replotted per frame)', off: { scanOn: false } },
    { id: 'screenflicker',label: 'screen flicker',                    off: { flick: 0 } },
    { id: 'lampflicker',  label: 'lamp flicker (17 var writes/tick)', off: { lflickA: 0, lflickB: 0 } },
    { id: 'phosglow',     label: 'phosphor glow (full-stage blur)',   off: { pglow: 0 } },
    { id: 'phoswash',     label: 'phosphor wash',                     off: { phos: 0 } },
    { id: 'bloom',        label: 'bloom (drop-shadow)',               off: { bloom: 0 } },
    { id: 'scanlines',    label: 'scanlines + grille',                off: { scanop: 0, grilleop: 0 } },
    { id: 'vignette',     label: 'inner vignette (blur)',             off: { vig: 0 } },
    { id: 'matte',        label: 'matte (reflection blur)',           off: { matte: 0 } },
    { id: 'sheen',        label: 'sheen',                             off: { sheen: 0 } },
    { id: 'glare',        label: 'glare',                             off: { glare: 0 } },
    { id: 'frame',        label: 'frame moulding (feTurbulence)',     off: { frameOn: false } },
    { id: 'warp',         label: 'FACE warp (all plotted geometry)',  off: { fcurve: 0 } }
  ];

  /* EVERYTHING ON. The worst case has to be a STATE, reproducible on demand, or "with everything running" means
   * whatever happened to be switched on when someone looked. Values are the lab's own full-strength settings. */
  var STRESS = {
    power: 'on', lightOn: true, scanOn: true, frameOn: true,
    flick: 6, fstr: 0.5, lflickA: 0.5, lflickB: 0.5, lfjit: 0.4, lfchaos: 0.35,
    pglow: 100, phos: 1, bloom: 8, scanop: 50, grilleop: 40,
    vig: 30, matte: 0.3, sheen: 0.3, glare: 1, sweep: 0.8, hsweep: 0.6, fcurve: 90
  };

  function snapshot(keys) {
    var l = logic(), out = {};
    if (!l) return out;
    for (var i = 0; i < keys.length; i++) out[keys[i]] = l.state[keys[i]];
    return out;
  }
  function apply(patch) { var l = logic(); if (l) l.setState(patch); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Collect for `ms`, discarding a settle period first -- a setState lands a render, and measuring the frame that
   * carries it measures the state CHANGE rather than the state. */
  function collect(ms, settle) {
    dts = []; last = 0;
    return wait(settle == null ? 400 : settle).then(function () {
      dts = []; last = 0;
      return wait(ms).then(function () { return summarise(dts.slice()); });
    });
  }

  var API = {
    rebind: function () { L = null; return !!logic(); },

    stress: function () {
      var l = logic(); if (!l) return console.warn('[CRTFPS] lab not found');
      API._preStress = snapshot(Object.keys(STRESS));
      apply(STRESS);
      console.log('[CRTFPS] everything animated is ON. CRTFPS.unstress() to put it back.');
      return STRESS;
    },
    unstress: function () { if (API._preStress) apply(API._preStress); },

    /* SET AN EXACT STATE, so two environments can be compared on the SAME configuration.
     *
     * stress() answers "how slow is the worst case". It does NOT answer "why is MY tab slow", because a real
     * saved config is not a subset of STRESS -- a user running LAMP FLICKER at 0.9 is heavier on that axis than
     * STRESS's 0.5, and that axis is the one this project's history says drives frame cost. Comparing a stress()
     * run against somebody's tab and concluding "the environment differs" is not a controlled comparison; it is
     * two different pages measured once each.
     *
     * Applied on top of whatever is already set, so `set({lflickA: 0.9})` after stress() changes exactly one
     * variable and leaves the rest of the worst case intact. That is what makes a bisect possible. */
    set: function (patch) {
      var l = logic(); if (!l) return console.warn('[CRTFPS] lab not found');
      apply(patch);
      return patch;
    },

    /* THE SERIES, NOT JUST THE SUMMARY. A median hides the shape, and the shape is the finding: this page does not
     * sit at one frame rate, it QUANTISES to 60/n (16.7 / 33.3 / 50 / 66.7ms — one, two, three, four vsyncs) and
     * walks between those steps over tens of seconds. A summary of that reads as "20fps" and tells you nothing about
     * whether you are looking at steady-state cost or at something that settles. Second-by-second medians are enough
     * to see it and small enough to keep in localStorage. */
    record: function (seconds) {
      if (!visible()) return Promise.resolve(null);
      var secs = seconds || 10;
      /* PROGRESS IS WRITTEN AS IT GOES, not only at the end. A recording needs a focused window for its whole length,
       * and focus is not something the code can hold — one alt-tab and the run stalls with nothing to show for it.
       * Flushing a partial result every second means an interrupted run still reports what it saw, and a stalled one
       * says WHERE it stalled instead of looking identical to one that never started. */
      var t0 = 0, flushed = 0;
      start();
      onTick = function (now) {
        if (!t0) t0 = now;
        var el = now - t0;
        if (el - flushed < 1000) return;
        flushed = el;
        try {
          localStorage.setItem(KEY, JSON.stringify({ kind: 'record-progress', at: new Date().toISOString(),
            elapsedMs: Math.round(el), of: secs * 1000, frames: dts.length, partial: summarise(dts.slice()) }));
        } catch (e) {}
      };
      console.log('[CRTFPS] recording ' + secs + 's — leave the window in front...');
      return collect(secs * 1000, 300).then(function (r) {
        var all = dts.slice();
        halt(); onTick = null;
        // per-second median frame time, so the settle curve is visible
        var perSec = [], i = 0, acc = [], elapsed = 0;
        for (i = 0; i < all.length; i++) {
          acc.push(all[i]); elapsed += all[i];
          if (elapsed >= 1000) { perSec.push(+pct(acc, 0.5).toFixed(1)); acc = []; elapsed = 0; }
        }
        var rec = { kind: 'record', at: new Date().toISOString(), seconds: secs, result: r,
                    perSecondMedianMs: perSec,
                    size: [innerWidth, innerHeight], dpr: devicePixelRatio };
        publish(rec);
        console.log('[CRTFPS]', r, perSec);
        return rec;
      });
    },

    /* THE ONE THAT ANSWERS THE QUESTION. Measure everything-on, then switch ONE layer off at a time and measure
     * again: the difference is what that layer costs per frame, in milliseconds, measured rather than reasoned
     * about. Restores each layer before moving to the next, so the deltas are independent and not cumulative.
     *
     * Cost is reported in MS PER FRAME, not in fps: fps deltas are not additive and mislead badly near the target
     * (a layer costing 2ms looks like "-25 fps" at 60 and "-3 fps" at 20, for the same work). */
    /* INTERLEAVED, AND THAT IS NOT A REFINEMENT -- the first version of this was WRONG and the numbers it produced
     * were a warm-up curve wearing a costume. It measured one baseline at the start and then each layer once, in
     * order. The page needs tens of seconds to settle (glyph typing, the glow-field settle loop, filter caches), so
     * the frame times fell 433ms -> 50ms -> 16.7ms straight down the list, and every "saving" was really just
     * elapsed time. The layer measured first looked catastrophic and the layer measured last looked free.
     *
     * So the baseline is re-measured immediately BEFORE every layer, and the delta is taken against ITS OWN
     * neighbouring baseline. Drift cancels: whatever the page is doing slowly over a minute affects the pair
     * equally. It costs twice the wall clock and it is the difference between a measurement and a story.
     *
     * WARM_MS up front for the same reason -- nothing is recorded until the page has stopped settling. */
    attribute: function (perLayerSeconds) {
      if (!visible()) return Promise.resolve(null);
      var l = logic(); if (!l) return Promise.resolve(console.warn('[CRTFPS] lab not found'));
      var secs = perLayerSeconds || 3;
      /* 15s, MEASURED not guessed: a 60s single-state recording shows the page arriving on its plateau at about the
       * eighth second (50 -> 66 -> 33.3ms and then flat to the end). Anything recorded before that is measuring the
       * boot -- the typewriter, the glow settle loop and the power-on animation -- rather than the steady state the
       * budget is about. */
      var WARM_MS = 15000;
      var total = WARM_MS / 1000 + LAYERS.length * 2 * (secs + 1.2);
      console.log('[CRTFPS] warming ' + (WARM_MS / 1000) + 's, then ' + LAYERS.length +
                  ' interleaved pairs — about ' + Math.round(total) + 's total. Leave the window in front.');
      API.stress();
      start();
      var out = [], bases = [];
      var chain = wait(WARM_MS);
      LAYERS.forEach(function (layer) {
        chain = chain.then(function () {
          return collect(secs * 1000, 1200).then(function (b) {          // baseline, all on
            bases.push(b);
            var keys = Object.keys(layer.off), was = snapshot(keys);
            apply(layer.off);
            return collect(secs * 1000, 1200).then(function (r) {        // same window, this layer off
              apply(was);
              // THE MEAN, for the reason recorded on meanMs above: a delta of medians is a delta of vsync steps.
              var saved = (r && b) ? +(b.meanMs - r.meanMs).toFixed(2) : null;
              out.push({ layer: layer.id, label: layer.label,
                         baseMs: b && b.meanMs, withoutMs: r && r.meanMs,
                         baseFps: b && b.fps, fpsWithout: r && r.fps,
                         baseDropped: b && b.droppedPct, droppedWithout: r && r.droppedPct,
                         savesMsPerFrame: saved });
              console.log('[CRTFPS]  ' + layer.id + ': ' + (b && b.meanMs) + 'ms -> ' + (r && r.meanMs) +
                          'ms  (saves ' + saved + ' ms/frame)');
              return wait(200);
            });
          });
        });
      });
      return chain.then(function () {
        halt(); API.unstress();
        out.sort(function (a, b) { return (b.savesMsPerFrame || 0) - (a.savesMsPerFrame || 0); });
        var med = bases.map(function (b) { return b && b.meanMs; }).filter(function (v) { return v != null; });
        var settled = med.length ? +pct(med, 0.5).toFixed(2) : null;
        var rec = { kind: 'attribute', at: new Date().toISOString(),
                    settledBaselineMs: settled, baselineSpread: med.length ? [Math.min.apply(null, med), Math.max.apply(null, med)] : null,
                    layers: out, size: [innerWidth, innerHeight], dpr: devicePixelRatio,
                    budgetMs: +TARGET.toFixed(2), overBudgetMs: settled ? +(settled - TARGET).toFixed(2) : null };
        publish(rec);
        console.log('[CRTFPS] done. settled baseline ' + settled + 'ms; ranked cost per frame:');
        console.table(out);
        return rec;
      });
    },

    /* ARM AND WALK AWAY. The measurement needs a visible tab and the person who can make it visible is not the
     * person reading the result -- so arm it, bring the window to the front, and it fires itself the moment frames
     * start arriving, then parks the answer in localStorage. `what` is 'attribute' (default) or 'record'.
     *
     * It waits for a few REAL frames rather than for the visibilitychange event alone: the event lands before the
     * compositor is running at rate, and a measurement that starts on the first frame after a tab switch measures
     * the tab switch. */
    arm: function (what, seconds) {
      var job = what || 'attribute';
      var run = function () {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', run);
        var seen = 0, warm = function () {
          if (++seen < 30) return requestAnimationFrame(warm);
          console.log('[CRTFPS] armed run starting (' + job + ')');
          API[job](seconds);
        };
        requestAnimationFrame(warm);
      };
      document.addEventListener('visibilitychange', run);
      run();
      try { localStorage.setItem(KEY, JSON.stringify({ kind: 'armed', job: job, at: new Date().toISOString() })); } catch (e) {}
      console.log('[CRTFPS] armed: bring this window to the front and leave it alone.');
      return 'armed';
    },

    report: function () {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
    },

    live: function () {
      var el = document.getElementById('__crtfps');
      if (!el) {
        el = document.createElement('div');
        el.id = '__crtfps';
        el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:11px/1.5 monospace;' +
          'background:rgba(0,0,0,.82);color:#7fd0ff;padding:7px 10px;border-radius:5px;pointer-events:none;white-space:pre';
        document.body.appendChild(el);
      }
      start();
      onTick = function () {
        if (dts.length > 180) dts = dts.slice(-180);            // a rolling three seconds
        var s = summarise(dts);
        if (!s) return;
        el.style.color = s.locked60 ? '#7cff3f' : (s.fps > 45 ? '#ffd60a' : '#ff6a00');
        el.textContent = s.fps.toFixed(1) + ' fps' + (s.locked60 ? '  LOCKED' : '') +
          '\nmed ' + s.medianMs + 'ms  p95 ' + s.p95Ms + 'ms' +
          '\nworst ' + s.worstMs + 'ms  dropped ' + s.droppedPct + '%' +
          (document.visibilityState === 'visible' ? '' : '\n[HIDDEN — not rendering]');
      };
      return 'live readout on';
    },

    stop: function () {
      halt(); onTick = null;
      var el = document.getElementById('__crtfps'); if (el) el.remove();
      return 'detached';
    },

    LAYERS: LAYERS, STRESS: STRESS
  };

  W.CRTFPS = API;
  console.log('[CRTFPS] ready — CRTFPS.live() / .record(10) / .stress() / .attribute() / .report()');

  /* SELF-ARMING FROM THE URL: ?fps=attribute | record | live | stress.
   *
   * This is the whole reason the probe can be used at all from a driven session. A tab opened by `window.open` or by
   * a person clicking a link is ACTIVE, and therefore rendering; the tab a tool is holding usually is not. So the
   * measurement travels in the URL: open the page focused, it measures itself, and the answer goes to localStorage,
   * which is shared across every tab on this origin — including the hidden one doing the asking.
   *
   * Waits for the lab to exist before arming, because module scripts are deferred and the component mounts after
   * this file has run. It gives up after ~8s rather than polling forever.
   */
  var q = /[?&]fps=([a-z]+)/.exec(location.search);
  if (q) {
    /* 60 SECONDS OF PATIENCE, NOT EIGHT. The first budget here was 8s and it silently lost every run in a throwaway
     * Chrome profile: a fresh profile has an empty HTTP cache, so the lab has to pull React, Babel and the fonts off
     * the network before it mounts, which is comfortably longer than eight seconds. The probe gave up, posted
     * nothing, and looked identical to a run that had never been launched -- which is exactly the state a benchmark
     * harness must never be in, because an isolated profile is the ONLY clean environment to measure in.
     * It also says so out loud now instead of failing quietly. */
    var job = q[1], tries = 0;
    var go = function () {
      if (!logic() && ++tries < 600) {
        if (tries % 50 === 0) console.log('[CRTFPS] waiting for the lab to mount… ' + (tries / 10) + 's');
        return setTimeout(go, 100);
      }
      if (!logic()) { publish({ kind: 'error', at: new Date().toISOString(), why: 'lab never mounted', waitedMs: tries * 100, url: location.href }); return console.warn('[CRTFPS] lab never appeared — not arming'); }
      if (job === 'live') return API.live();
      if (job === 'stress') return API.stress();
      API.live();
      /* `?fps=curve` — the one that answers "does it settle, or is it just slow?": everything animated ON, ONE state
       * for sixty seconds, no toggling at all, and the per-second medians kept. Any state change during a recording
       * costs a rebuild, so a run that toggles cannot tell a warm-up curve from a transition cost. */
      if (job === 'curve') { API.stress(); return API.arm('record', 60); }
      API.arm(job === 'record' ? 'record' : 'attribute', 3);
    };
    setTimeout(go, 300);
  }
})();
