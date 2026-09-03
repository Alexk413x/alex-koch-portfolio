/* intro.js — the director.
 *
 * Runs the beats in intro-script.js over the three scenes: the CRT and the wormhole in same-origin frames of
 * their own lab pages (loaded with ?intro, which strips their chrome and their stored settings), and the
 * reactor on the hero's own canvas through window.HERO. It owns the clock, the input, the crossfades and the
 * skip, and it never draws anything itself. When it is done the page is exactly what a returning visitor sees,
 * and this element is gone from the DOM.
 *
 * ?intro forces it. ?intro&from=worm|hero starts part-way in. ?intro&hud shows the HUD (see intro-debug.js).
 * ?intro&panel keeps each lab's control panel in its frame, for tuning values live.
 */
import { SCRIPTS, PREP } from './intro-script.js';
import { mountLoader, labReady } from '../../labs/kit/lab.js';

const root = document.getElementById('intro');
const q = location.search;
const DEBUG = /[?&]hud\b/.test(q);
const PANEL = /[?&]panel\b/.test(q);
const FROM = (q.match(/[?&]from=(crt|worm|hero)\b/) || [])[1] || 'crt';
const VERSION = (q.match(/[?&]v=(\w+)\b/) || [])[1] || 'v1';

if (!window.AK_INTRO || !root || !SCRIPTS[VERSION]) {
  if (root) root.remove();
} else {
  run(SCRIPTS[VERSION]);
}

function run(script) {
  window.AK_INTRO_RUNNING = true;
  // The sheet plays over whatever scroll position the browser restored; the reveal must land on the hero, not there.
  window.scrollTo(0, 0);
  const html = document.documentElement;
  // The labs' ring, while the tube's shaders compile. The page carries its markup so it is up from the first
  // paint; mountLoader is the fallback for a sheet that arrived empty, and returns the filled one otherwise.
  const load = mountLoader('Warming up', root.querySelector('.kit-load'));
  if (load) load.querySelector('.kit-load-name').textContent = 'ALEXK413X';
  // Whichever scene shows first lifts the ring: the tube on a full run, the tunnel or the core behind ?from=.
  const lift = () => labReady(load);
  if (PANEL) root.classList.add('is-panel');
  const skipBtn = document.getElementById('intro-skip');

  // ---------------------------------------------------------------- the frames
  /* A frame per lab, same origin, so the lab's own handle is reachable directly. pointer-events stay off so the
     parent keeps every key and click. `ready` is the lab's first drawn frame, which is what the black sheet
     was covering for. */
  function frame(src, layer) {
    let el = null, win = null;
    const api = {
      mount() {
        if (el) return;
        el = document.createElement('iframe');
        el.src = src + '?intro' + (PANEL ? '&panel' : '');
        el.setAttribute('aria-hidden', 'true');
        el.tabIndex = -1;
        // The tube stacks over the tunnel: the tunnel opens under the collapse and is uncovered by it.
        el.style.zIndex = String(layer);
        // With the panel up the frame takes the pointer, so its keys have to reach the director too.
        if (PANEL) el.addEventListener('load', () => { el.contentWindow.addEventListener('keydown', onKey); });
        root.appendChild(el);
        win = null;
      },
      get win() { if (!win && el && el.contentWindow) win = el.contentWindow; return win; },
      show() { if (el) el.classList.add('is-on'); },
      // Fades over `sec` and then leaves the DOM. The default is the stylesheet's crossfade.
      drop(sec) {
        if (!el) return;
        const gone = el;
        el = null; win = null;
        if (sec) gone.style.transitionDuration = sec + 's';
        gone.classList.remove('is-on');
        setTimeout(() => gone.remove(), (sec || 0.35) * 1000 + 100);
      },
      get el() { return el; },
    };
    return api;
  }

  const crtF = frame('labs/crt/CRT%20Lab.html', 2);
  const wormF = frame('labs/wormhole/Wormhole.html', 1);

  const crt = {
    mount: crtF.mount, drop: crtF.drop,
    // The ring leaves as the tube arrives: labReady removes it rather than fading it to nothing.
    show() { crtF.show(); lift(); },
    G() { const w = crtF.win; return w && w.CRTGL ? w.CRTGL : null; },
    ready() { const g = this.G(); return !!(g && g.shown); },
    typedDone() { const g = this.G(); return !!(g && g.typedDone); },
    // The tube's own clock: its triggers stamp its window's performance.now(), not this one's.
    now() { return crtF.win.performance.now(); },
    powerOn() { const g = this.G(); if (g) g.powerOn(); },
    powerOff() { const g = this.G(); if (g) g.powerOff(); },
    surge() { const g = this.G(); if (g) g.triggerSurge(this.now()); },
    // The fixture's lamp. Off a beat before the power, so the collapse is the only thing moving.
    light(on) { const g = this.G(); if (g) g.state.lightOn = on ? 1 : 0; },
    set(vals) { const g = this.G(); if (g) Object.assign(g.state, vals); },
    warp() { const g = this.G(); if (g) g.triggerWarp(this.now()); },
  };

  const worm = {
    mount: wormF.mount, drop: wormF.drop,
    show() { wormF.show(); lift(); },
    W() { const w = wormF.win; return w && w.WORMHOLE ? w.WORMHOLE : null; },
    ready() { const w = this.W(); return !!(w && w.R && w.R.ready()); },
    open() { const w = this.W(); if (w) w.moves.fireOpen(); },
    run() { const w = this.W(); if (w) w.moves.fireRun(); },
    burst() { const w = this.W(); if (w) w.moves.fireBurst(); },
  };

  const hero = {
    H() { return window.HERO || null; },
    take() { const h = this.H(); if (h) h.take(); },
    // The hero's loop, while it is covered: a ring nobody can see still costs its frame on the same thread.
    stop() { const h = this.H(); if (h && h.stop) h.stop(); },
    start() { const h = this.H(); if (h && h.start) h.start(); },
    release() { const h = this.H(); if (h) h.release(); },
    set(vals) { const h = this.H(); if (h) Object.assign(h.state, vals); },
    refit() { const h = this.H(); if (h && h.refit) h.refit(); },
    resetZoom() { const h = this.H(); if (h && h.resetZoom) h.resetZoom(); },
    get(key) { const h = this.H(); return h ? h.state[key] : undefined; },
    // A copy of the named keys, for a beat that tweens away from wherever the last one left the core.
    snapshot(keys) { const h = this.H(); const o = {}; if (h) for (const k of keys) o[k] = h.state[k]; return o; },
    // The stylesheet's camera, which is where the hero's zoom has to end up.
    cssZoom() { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--core-zoom')); return Number.isFinite(v) && v > 0 ? v : 1; },
    // The canvas's height now, and the height the stylesheet gives it outside the intro: the shader scales its
    // picture by the buffer's height, so the camera at the end is scaled by their ratio to land on the page's.
    boxSize() { const c = document.getElementById('hero-core'); return c ? c.clientHeight : 1; },
    homeSize() {
      const stage = document.getElementById('stage');
      if (!stage) return this.boxSize();
      const probe = document.createElement('i');
      probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--core-canvas)';
      stage.appendChild(probe);
      const h = probe.offsetHeight || this.boxSize();
      probe.remove();
      return h;
    },
    // The camera and the buffer back to the page's, in one frame, for the moment the sheet's sizing leaves.
    settle() { const h = this.H(); if (!h) return; h.resetZoom(); if (h.refit) h.refit(); },
    // The whole scene back to its own state, for a skip from anywhere in the sequence.
    home() { const h = this.H(); if (!h) return; if (h.home) h.home(); else this.settle(); },
    full() { const h = this.H(); return !h || h.full; },
    pulse(amp) { const h = this.H(); if (!h) return; h.state.pulseAmp = amp; h.sim.firePulse(h.state); },
    vent() { const h = this.H(); if (h) h.sim.fireVent(); },
    heroHex() { const h = this.H(); return h ? h.heroHex : '#dd6a20'; },
    rest() { const h = this.H(); return h ? h.rest : { SPIN_IDLE: 3, TILT_IDLE: 1, VISC_REST: 1.8, dropN: 10 }; },
    restPulse() { const r = this.rest(); return { pulseAmp: r.pulseAmp, subVT: r.subVT, coreAngle: r.restY, coreAngleX: r.restX }; },
  };

  // ---------------------------------------------------------------- input
  const input = {
    armed: false, advanced: false,
    arm() { this.armed = true; this.advanced = false; },
    // Once the reader has answered the prompt the skip control leaves: the sequence is theirs now.
    advance() { if (this.armed) this.advanced = true; },
  };
  const isAdvanceKey = (e) => e.key === 'Enter' || e.key === ' ';
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); skip(); return; }
    if (isAdvanceKey(e)) { e.preventDefault(); input.advance(); }
    if (DEBUG && hud) hud.key(e.key);
  };
  addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', (e) => { if (!e.target.closest('#intro-skip')) input.advance(); });
  skipBtn.addEventListener('click', skip);

  // ---------------------------------------------------------------- the clock
  /* Beat-local seconds, from frame deltas rather than timestamps, so a paused HUD or a hidden tab holds the
     beat where it is. Speed is the HUD's slow-motion; the labs' own loops run at their own rate regardless, so
     slow motion changes when the director acts, not how fast the scenes play. */
  let speed = 1, paused = false, t = 0, last = 0, raf = 0;
  let idx = -1, beat = null, ended = false;
  const fired = new Set();
  const once = (key, cond) => { if (!cond || fired.has(key)) return false; fired.add(key); return true; };

  // ---------------------------------------------------------------- what beats can ask for
  const ctx = {
    crt, worm, hero, input, once,
    clear: () => { root.classList.add('is-clear'); lift(); },
    going: () => { root.classList.add('is-going'); },
    reveal,
  };

  function reveal() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey);
    // Both stores: localStorage is what makes it once per browser, sessionStorage is what the harness marks.
    try { sessionStorage.setItem('intro-seen', '1'); localStorage.setItem('intro-seen', '1'); } catch (e) {}
    // ?intro forces a play; left in the address it would force the next refresh too.
    if (/[?&]intro\b/.test(location.search)) {
      const u = new URL(location.href);
      u.searchParams.delete('intro');
      try { history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
    }
    // Not when the address names a section: the browser has already put the page there under the sheet, and
    // this scroll runs smooth under the page's scroll-behavior, so it would glide back to the top over the
    // jump landOnHash() asks for.
    if (!location.hash) window.scrollTo(0, 0);
    html.classList.remove('intro-live');
    html.classList.add('intro-done');
    hero.settle();
    if (window.AK_REVEAL) window.AK_REVEAL();
    if (hud) hud.stop();
    root.remove();
    landOnHash();
  }

  /* A hash normally skips the intro, so this only matters when ?intro forces it: the reveal has just put the
     page on the hero, and the address still names a section. The nav's own link handler knows where each
     section actually lands (a sticky scene's range, CONTACT at the page's end), so the jump goes through it. */
  function landOnHash() {
    const hash = location.hash;
    if (!hash || hash.length < 2) return;
    const link = document.querySelector('#nav .links a[href="' + hash + '"]');
    if (link) link.click();
    else { const t = document.querySelector(hash); if (t) t.scrollIntoView(); }
  }

  /* Skip goes to the hero's own state in one call, so nothing is left half-driven: the frames are dropped,
     the hero is put back at home and released, and the page reveals. */
  function skip() {
    if (ended) return;
    crt.drop(); worm.drop();
    hero.home();
    hero.release();
    reveal();
  }

  // ---------------------------------------------------------------- the sequence
  const beats = script.slice(script.findIndex((b) => b.scene === FROM));
  const prep = FROM === 'crt' ? null : PREP[FROM];
  const list = prep ? [{ id: 'prep', scene: FROM, ...prep }].concat(beats) : beats;

  function enter(i) {
    idx = i;
    beat = list[i] || null;
    t = 0;
    if (!beat) { reveal(); return; }
    if (beat.enter) beat.enter(ctx);
  }

  function step(now) {
    raf = requestAnimationFrame(step);
    const dt = paused ? 0 : Math.min(0.1, (now - last) / 1000) * speed;
    last = now;
    if (!beat || ended) return;
    t += dt;
    if (beat.tick) beat.tick(ctx, t);
    const over = beat.done(ctx, t) || (beat.max != null && t >= beat.max);
    if (over) {
      // A scene that never came up is a page that must not be held: a failed boot skips to the hero.
      if (beat.id === 'boot' && !crt.ready()) { skip(); return; }
      if (beat.id === 'prep' && beat.scene === 'worm' && !worm.ready()) { skip(); return; }
      if (beat.exit) beat.exit(ctx);
      enter(idx + 1);
    }
    if (hud) hud.update({ beat: beat ? beat.id : '-', t, idx, n: list.length, speed, paused,
                          crt: crt.ready(), worm: worm.ready(), full: hero.full() });
  }

  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  let hud = null;
  if (DEBUG) {
    import('./intro-debug.js').then((m) => {
      hud = m.mountHud(root, {
        pause: () => { paused = !paused; },
        speed: (k) => { speed = Math.max(0.25, Math.min(2, speed * k)); },
        next: () => { if (beat) { if (beat.exit) beat.exit(ctx); enter(idx + 1); } },
        restart: () => { location.reload(); },
        skip,
      });
    });
  }

  last = performance.now();
  enter(0);
  raf = requestAnimationFrame(step);
}
