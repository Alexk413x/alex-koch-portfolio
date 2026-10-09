/* library.js — The Library's ring, its text rail and the one clock that drives both.
 *
 * One index is the whole state. The ring's slots, the stack of descriptions and the accent bar all read it, so
 * they cannot disagree about which plugin is selected. Only the model at the front is stepped, and only once the
 * ring has settled: the other three hold the pose they left in.
 */
(function () {
  'use strict';

  const root = document.getElementById('library');
  const L = window.AKLIB;
  if (!root || !L) return;

  const ring = root.querySelector('.lib-ring');
  const slots = Array.prototype.slice.call(ring.querySelectorAll('.lib-slot'));
  const items = Array.prototype.slice.call(root.querySelectorAll('.lib-item'));
  const list = root.querySelector('.lib-list');
  const N = slots.length;

  const PERIOD = 5000;     // ms between automatic turns, measured from the start of one turn to the next
  const TURN = 900;        // ms one quarter turn takes
  const SWIPE = 40;        // px of sideways travel that counts as a swipe

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mod = (n) => ((n % N) + N) % N;
  const ease = (u) => (u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

  const models = ['agentTabs', 'codebaseKG', 'sentinelSwarm', 'theIndex'].map((name, i) => {
    const m = L[name]();
    slots[i].querySelector('.lib-model').appendChild(m.svg);
    return m;
  });

  let pos = 0, goal = 0, tween = null;
  let held = false;          // the reader took over; the clock stays off for the rest of the visit
  let hovered = false, focused = false, inView = false;
  let timer = 0, raf = 0, last = 0;
  let W = 0, H = 0, rx = 0, ry = 0, cy = 0;

  const front = () => mod(goal);

  function measure() {
    W = ring.clientWidth;
    H = ring.clientHeight;
    const cs = getComputedStyle(ring);
    rx = (parseFloat(cs.getPropertyValue('--lib-rx')) || .3) * W;
    ry = (parseFloat(cs.getPropertyValue('--lib-ry')) || .22) * H;
    cy = (parseFloat(cs.getPropertyValue('--lib-cy')) || .48) * H;
    layout();
    placeBar();
    matchLight();
  }

  function layout() {
    for (let i = 0; i < N; i++) {
      const phi = (i - pos) * Math.PI * 2 / N;
      const d = (1 + Math.cos(phi)) / 2;
      const s = slots[i].style;
      const x = Math.sin(phi) * rx, y = cy + Math.cos(phi) * ry;
      s.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%) scale(' +
        (.4 + .6 * Math.pow(d, 1.3)).toFixed(3) + ')';
      s.opacity = (.26 + .74 * Math.pow(d, 2.4)).toFixed(3);
      s.zIndex = Math.round(d * 10);
    }
  }

  /* A bead's width and halo are in drawing units, so the same bead is a different size on screen in a different drawing.
     --wk is set on each model so its bead measures what the Cartographer's nearest one measures in pixels. */
  function matchLight() {
    const ref = document.querySelector('.fg-spark');
    const m = ref && ref.getScreenCTM && ref.getScreenCTM();
    if (!m) return;
    const want = m.a * (parseFloat(getComputedStyle(ref).getPropertyValue('--wk')) || 1);
    const dash = ref.getTotalLength() / 100 * m.a;
    slots.forEach((slot, i) => {
      const unit = slot.clientWidth / 400;
      if (!unit) return;
      const share = parseFloat(getComputedStyle(models[i].svg).getPropertyValue('--wf-bead-share')) || 1;
      models[i].svg.style.setProperty('--wk', (want * share / unit).toFixed(3));
      models[i].svg.style.setProperty('--dash', (dash * share / unit).toFixed(3));
    });
  }

  function placeBar() {
    const on = items[front()];
    if (!on) return;
    list.style.setProperty('--bar-y', on.parentNode.offsetTop + 'px');
    list.style.setProperty('--bar-h', on.parentNode.offsetHeight + 'px');
  }

  function mark() {
    const f = front();
    items.forEach((b, i) => {
      b.parentNode.classList.toggle('is-on', i === f);
      if (i === f) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      slots[i].classList.toggle('is-front', i === f);
      slots[i].setAttribute('aria-hidden', i === f ? 'false' : 'true');
      // Only the front model shows its beads and lit nodes: the others are cleared until they come round again.
      if (i !== f) models[i].rest();
    });
    placeBar();
  }

  function turn(delta) {
    if (!delta) return;
    goal += delta;
    tween = { from: pos, to: goal, t0: performance.now(), ms: reduced.matches ? 0 : TURN * (Math.abs(goal - pos) > 1.5 ? 1.3 : 1) };
    mark();
    run();
  }

  function select(i) {
    let delta = mod(i - goal);
    if (delta > N / 2) delta -= N;
    if (delta === -N / 2) delta = N / 2;
    turn(delta);
  }

  function take() {
    held = true;
    clearTimeout(timer);
  }

  function schedule() {
    clearTimeout(timer);
    if (held || hovered || focused || !inView || reduced.matches || document.hidden) return;
    timer = setTimeout(() => { turn(1); schedule(); }, PERIOD);
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(.1, (now - last) / 1000);
    last = now;

    if (tween) {
      const u = tween.ms ? Math.min(1, (now - tween.t0) / tween.ms) : 1;
      pos = tween.from + (tween.to - tween.from) * ease(u);
      layout();
      if (u >= 1) { pos = tween.to; tween = null; }
    } else if (!reduced.matches) {
      const m = models[front()];
      m.step(dt);
      m.draw();
    }
    if (inView && !document.hidden && (tween || !reduced.matches)) raf = requestAnimationFrame(frame);
  }

  function run() {
    if (raf || !inView || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  items.forEach((b, i) => b.addEventListener('click', () => { take(); select(i); }));

  /* A mouse click leaves focus on the button, and the next arrow key then makes the browser draw its focus box
     around it. Only a keyboard activation (detail 0) keeps focus. */
  root.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('.lib-item, .demo-cta');
    if (t && e.detail > 0) t.blur();
  });

  let swiped = false;
  slots.forEach((s, i) => s.addEventListener('click', () => {
    if (swiped) return;
    take();
    select(i);
  }));

  let down = null;
  ring.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY };
    swiped = false;
  });
  ring.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    swiped = true;
    take();
    turn(dx < 0 ? 1 : -1);
  });
  ring.addEventListener('pointercancel', () => { down = null; });

  root.addEventListener('pointerenter', () => { hovered = true; clearTimeout(timer); });
  root.addEventListener('pointerleave', () => { hovered = false; schedule(); });
  root.addEventListener('focusin', () => { focused = true; clearTimeout(timer); });
  root.addEventListener('focusout', () => { focused = false; schedule(); });

  /* The section owns the left and right arrows while the reader is in it. nav.js asks, the same way it asks the
     catalog, so a press here turns the ring instead of stepping the page. */
  function sideways() {
    const r = root.getBoundingClientRect();
    const mid = (window.innerHeight || 1) / 2;
    return r.top < mid && r.bottom > mid;
  }

  window.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (!sideways()) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], #rpn')) return;
    e.preventDefault();
    take();
    turn(e.key === 'ArrowRight' ? 1 : -1);
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      inView = entries[entries.length - 1].isIntersecting;
      if (inView) { run(); schedule(); } else clearTimeout(timer);
    }, { threshold: .25 }).observe(ring);
  } else {
    inView = true;
  }

  document.addEventListener('visibilitychange', () => { run(); schedule(); });
  reduced.addEventListener('change', () => { measure(); schedule(); });
  window.AKKIT.onResize(measure);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(ring);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeBar);

  window.AKLIB.sideways = sideways;

  mark();
  measure();
  run();
  schedule();
})();
