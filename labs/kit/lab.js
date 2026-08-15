/* lab.js — the parts of a lab page that are not about the lab: settings, canvas sizing, the frame loop.
 *
 * Four composable helpers rather than one createLab(), because the labs do not share a control flow — Reactor has
 * a preset strip, an action strip, five gauges and a scripted vent; Wormhole has a mode row. Each lab calls what
 * it wants and keeps its own main().
 */

// Sets an element's text only when it changed, so a per-frame readout costs a string compare instead of a DOM write.
export function textOut(el, txt) {
  if (!el || el._labLast === txt) return;
  el._labLast = txt;
  el.textContent = txt;
}

/* Settings that survive a reload, keyed per lab.
 *
 *   const store = persist({ key: 'reactor', version: 1, state, sections: SECTIONS, extra: ['coreHex'] });
 *   store.restore();            // before the panel is built
 *   store.queueSave();          // from onChange
 *
 * Ranges are derived from the panel layout rather than declared again, so bounds cannot disagree with the
 * sliders. `extra` names keys the layout cannot describe: colour rows have no range, section masters are not rows.
 */
export function persist({ key, version = 1, state, sections = [], extra = [], delay = 400 }) {
  const ranges = {}, choices = {};
  sections.forEach(([, rows]) => (rows || []).forEach(([k, , lo, hi]) => {
    if (typeof lo === 'number') ranges[k] = [lo, hi];
    else if (Array.isArray(lo)) choices[k] = lo.length;
  }));
  const uniq = [...new Set(Object.keys(ranges).concat(Object.keys(choices), extra, ['secClosed']))];
  let timer = 0;

  const save = () => {
    const out = { v: version };
    uniq.forEach((k) => { out[k] = state[k]; });
    try { localStorage.setItem(key, JSON.stringify(out)); } catch (_) {}
  };

  const api = {
    ranges, choices,
    /* Restores only declared keys, clamped into each control's current range, and ignores a blob whose version
     * does not match. Without the clamp, narrowing a range leaves a value the slider cannot represent — the thumb
     * pins at one end while the readout shows the old number. */
    restore() {
      let blob = null;
      try { blob = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
      if (!blob || blob.v !== version) return false;
      uniq.forEach((k) => {
        const v = blob[k];
        if (v == null) return;
        if (k === 'secClosed') { if (v && typeof v === 'object') state.secClosed = v; return; }
        if (typeof state[k] === 'string') { if (typeof v === 'string') state[k] = v; return; }
        if (typeof v !== 'number' || !isFinite(v)) return;
        const r = ranges[k];
        if (r) state[k] = Math.max(r[0], Math.min(r[1], v));
        else if (choices[k]) state[k] = Math.max(0, Math.min(choices[k] - 1, Math.round(v)));
        else state[k] = v;
      });
      return true;
    },
    save,
    // Debounced: called from a change handler, an undebounced save is one stringify and one synchronous write per
    // input event, which during a drag is sixty a second.
    queueSave() { clearTimeout(timer); timer = setTimeout(save, delay); },
  };

  // The visibility flush covers a tab switched away from and never returned to, which is how most mobile sessions
  // end; pagehide alone does not fire reliably there.
  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  return api;
}

/* Keeps the render buffer matched to the stage at a chosen scale, and returns the function that re-applies it.
 *
 *   const fit = fitCanvas({ stage, R, scale: () => state.renderScale, onFit: (w, h) => ... });
 *
 * Sizing from the stage rather than the window is load-bearing: the panel is a flex sibling, so hiding it grows
 * the stage while the window is unchanged, and a window-sized buffer would stretch. Pass `force` when the CSS box
 * has not moved but the buffer must be rebuilt anyway — a render-scale change, or a restored GL context.
 */
export function fitCanvas({ stage, R, scale, onFit, settle = 60 }) {
  const apply = (force) => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return false;
    if (force) { R.w = R.h = -1; }
    if (!R.resize(w, h, scale())) return false;
    if (onFit) onFit(R.w, R.h);
    return true;
  };
  let t = 0;
  // Debounced: a ResizeObserver fires every frame of a window drag and each one would reallocate the buffer.
  new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => apply(false), settle); }).observe(stage);
  return apply;
}

/* The animation loop, with a clock that survives being paused.
 *
 *   const loop = runLoop({ draw: (dt, sec) => {...}, onTick: (fps) => {...} });
 *   loop.renderNow(1 / 60, 8);
 *
 * `renderNow` draws synchronously at a caller-chosen time, which reaches a tab that is not front-most.
 */
export function runLoop({ draw, onTick, tickMs = 500, maxDt = 0.05 }) {
  let t0 = performance.now(), last = t0, sec = 0, raf = 0;
  let frames = 0, tickT = t0, pausedAt = 0;

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    /* Clamped BOTH WAYS. Above, because a stalled frame integrated as one step throws a spring across its whole
     * range. Below, because the first rAF timestamp can PRECEDE the performance.now() this loop was built with —
     * measured here at 451ms against 19501ms — and a negative delta runs every phase and every spring backwards
     * for one frame. Reactor's INSTABILITY gauge read -224% on load until this clamp existed. */
    const dt = Math.max(0, Math.min(maxDt, (now - last) / 1000));
    last = now;
    sec = (now - t0) / 1000;
    draw(dt, sec);
    frames++;
    if (onTick && now - tickT >= tickMs) {
      onTick(Math.round(frames * 1000 / (now - tickT)), dt, sec);
      frames = 0; tickT = now;
    }
  };

  /* Windows Chrome delivers ZERO animation frames to an occluded tab, not merely throttled ones, so the loop is
   * stopped rather than left spinning. t0 is advanced by the whole pause on resume — otherwise a noise field
   * driven by uTime jumps the entire gap in one frame. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      pausedAt = performance.now();
    } else if (!raf) {
      const gap = performance.now() - (pausedAt || performance.now());
      t0 += gap; last = performance.now(); tickT = last; frames = 0;
      raf = requestAnimationFrame(frame);
    }
  });

  raf = requestAnimationFrame(frame);
  return {
    get time() { return sec; },
    stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    renderNow(dt, at) { draw(dt == null ? 1 / 60 : dt, at == null ? sec : at); },
  };
}

/* Escape leaves the instrument, the way the back button does.
 *
 * A lab is a full-screen app with no chrome, reached by a click from somewhere else, and the way out of one is
 * otherwise not obvious. Called explicitly by each lab rather than run as a side effect of importing this
 * module, because site/hero-core.js imports it too — the home page must not grow a key that navigates away from
 * itself.
 *
 * defaultPrevented is the guard that matters: the panel's numeric fields already take Escape to cancel a typed
 * value, and cancelling an edit must not also leave the page.
 */
export function escapeLeaves(fallback = '../../index.html') {
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && el.closest && el.closest('input, textarea, select, [contenteditable="true"]')) return;
    // Opened in a new tab there is nothing to go back to, so it goes home rather than nowhere.
    if (history.length > 1 && document.referrer) history.back();
    else location.href = fallback;
  });
}

// Puts the reason on screen when a renderer could not be built, so the page is not merely black.
export function reportNoGL(msg = 'NO WEBGL') {
  const el = document.getElementById('glstate');
  if (el) el.textContent = msg;
  return false;
}
