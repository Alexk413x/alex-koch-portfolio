/* The map's ambient pulse: every route's nine trailing dots, drawn on one canvas
   by one animation loop. */

const PERIOD = 2.6;
const SPACING = 3;
const RADIUS = 1.5;
const SAMPLES = 48;

// The same tier opacities as the `.routes circle.pulse` block in app.css, which
// is the canvas port and stays the reference for how the pulse looks.
const ALPHA = {
  rest: [0.50, 0.44, 0.39, 0.33, 0.28, 0.22, 0.17, 0.11, 0.06],
  lit: [0.95, 0.84, 0.74, 0.63, 0.53, 0.42, 0.32, 0.21, 0.11],
  dim: Array(9).fill(0.08),
};

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y];
}

function track(segs) {
  const n = SAMPLES * segs.length;
  const xs = new Float32Array(n + 1);
  const ys = new Float32Array(n + 1);
  const at = new Float32Array(n + 1);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i <= n; i += 1) {
    const s = Math.min(segs.length - 1, Math.floor(i / SAMPLES));
    const [x, y] = bez(...segs[s], (i - s * SAMPLES) / SAMPLES);
    xs[i] = x;
    ys[i] = y;
    at[i] = i ? at[i - 1] + Math.hypot(x - xs[i - 1], y - ys[i - 1]) : 0;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { xs, ys, at, n, length: at[n], box: [x0 - RADIUS, y0 - RADIUS, x1 + RADIUS, y1 + RADIUS] };
}

function pointAt(tr, dist) {
  const { xs, ys, at } = tr;
  let lo = 0;
  let hi = tr.n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] < dist) lo = mid; else hi = mid;
  }
  const span = at[hi] - at[lo];
  const f = span > 0 ? (dist - at[lo]) / span : 0;
  return [xs[lo] + (xs[hi] - xs[lo]) * f, ys[lo] + (ys[hi] - ys[lo]) * f];
}

export function flow(canvas, pulses) {
  const ctx = canvas.getContext('2d');
  const routes = pulses.map(u => ({ key: u.key, track: track(u.segs), delay: u.delay, state: 'rest' }));
  const byKey = new Map(routes.map(r => [r.key, r]));
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const view = { x0: 0, y0: 0, x1: 0, y1: 0, k: 1 };
  let colour = '';
  let frame = 0;
  let held = 0;
  let heldFor = 0;
  let alive = true;

  const clock = () => ((held || performance.now()) - heldFor) / 1000;

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (still.matches) return;
    ctx.setTransform(view.k, 0, 0, view.k, -view.x0 * view.k, -view.y0 * view.k);
    if (!colour) colour = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#0e70c8';
    ctx.fillStyle = colour;
    const t = clock();
    const shown = routes.filter(r => r.state !== 'hidden'
      && r.track.box[2] >= view.x0 && r.track.box[0] <= view.x1
      && r.track.box[3] >= view.y0 && r.track.box[1] <= view.y1);
    for (const state of ['rest', 'dim', 'lit']) {
      const mine = shown.filter(r => r.state === state);
      if (!mine.length) continue;
      for (let tier = 0; tier < 9; tier += 1) {
        ctx.globalAlpha = ALPHA[state][tier];
        ctx.beginPath();
        for (const r of mine) {
          const p = (((t - r.delay) / PERIOD) % 1 + 1) % 1;
          const d = Math.min(r.track.length, Math.max(0, p * r.track.length - tier * SPACING));
          const [x, y] = pointAt(r.track, d);
          ctx.moveTo(x + RADIUS, y);
          ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function tick() {
    frame = 0;
    if (!alive) return;
    draw();
    if (!held && !still.matches) frame = requestAnimationFrame(tick);
  }

  function kick() {
    if (!frame && alive) frame = requestAnimationFrame(tick);
  }

  still.addEventListener('change', kick);

  return {
    set(key, state) {
      const r = byKey.get(key);
      if (r && r.state !== state) { r.state = state; kick(); }
    },

    // The canvas covers only the visible part of the world: sized to the world,
    // it would outgrow any GPU texture at 8x zoom.
    view(tx, ty, scale, w, h) {
      const dpr = window.devicePixelRatio || 1;
      view.x0 = -tx / scale;
      view.y0 = -ty / scale;
      view.x1 = view.x0 + w / scale;
      view.y1 = view.y0 + h / scale;
      view.k = scale * dpr;
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pw) canvas.width = pw;
      if (canvas.height !== ph) canvas.height = ph;
      canvas.style.transform = `translate(${view.x0}px, ${view.y0}px)`;
      const cw = `${w / scale}px`;
      const ch = `${h / scale}px`;
      if (canvas.style.width !== cw) canvas.style.width = cw;
      if (canvas.style.height !== ch) canvas.style.height = ch;
      kick();
    },

    hold(on) {
      if (on && !held) held = performance.now();
      if (!on && held) { heldFor += performance.now() - held; held = 0; }
      kick();
    },

    stop() {
      alive = false;
      still.removeEventListener('change', kick);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
