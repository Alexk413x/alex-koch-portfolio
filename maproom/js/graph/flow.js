/* The map's ambient pulse: rotate a bounded set of beads through visible routes. */

const MIN_SPEED = 60;
const MAX_SPEED = 80;
const pause = () => 1 + Math.random() * 9;
const RADIUS = 1;
const GLOW_RADIUS = 2;
const SPRITE_SIZE = 16;
const MAX_BEADS = 6;
const SAMPLES = 48;

const ALPHA = {
  rest: 1,
  lit: 1,
  dim: 0.08,
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
  return { xs, ys, at, n, length: at[n], box: [x0, y0, x1, y1] };
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

function channels(color, fallback) {
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const value = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return rgb ? rgb.slice(1, 4).map(Number) : fallback;
}

function makeSprite(glowColour, coreColour) {
  const sprite = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(SPRITE_SIZE, SPRITE_SIZE)
    : Object.assign(document.createElement('canvas'), { width: SPRITE_SIZE, height: SPRITE_SIZE });
  const paint = sprite.getContext('2d');
  const [r, g, b] = channels(glowColour, [14, 112, 200]);
  const gradient = paint.createRadialGradient(8, 8, 0, 8, 8, 8);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, .3)`);
  gradient.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, .12)`);
  gradient.addColorStop(0.72, `rgba(${r}, ${g}, ${b}, .04)`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  paint.fillStyle = gradient;
  paint.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  paint.beginPath();
  paint.arc(8, 8, RADIUS * SPRITE_SIZE / (GLOW_RADIUS * 2), 0, Math.PI * 2);
  const core = channels(coreColour, [90, 169, 239]).map(c => Math.round(c + (255 - c) * .45));
  paint.fillStyle = `rgb(${core.join(', ')})`;
  paint.fill();
  return sprite;
}

export function flow(canvas, pulses, labels = []) {
  const ctx = canvas.getContext('2d');
  const routes = pulses.map(u => ({ key: u.key, track: track(u.segs), state: 'rest' }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const byKey = new Map(routes.map(r => [r.key, r]));
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const view = { x0: 0, y0: 0, x1: 0, y1: 0, k: 1, scale: 1 };
  let shown = [];
  let active = [];
  let cursor = 0;
  let glowColour = '';
  let coreColour = '';
  let sprite = null;
  let frame = 0;
  let held = 0;
  let heldFor = 0;
  let alive = true;

  const clock = () => ((held || performance.now()) - heldFor) / 1000;
  let lastTime = clock();

  function nextRoute(exclude = null) {
    for (let i = 0; i < shown.length; i += 1) {
      const route = shown[cursor % shown.length];
      cursor = (cursor + 1) % shown.length;
      if (!active.some(slot => slot !== exclude && slot.route === route)) return route;
    }
    return null;
  }

  function refreshShown() {
    const radius = GLOW_RADIUS / view.scale;
    shown = routes.filter(r => r.state !== 'hidden' && r.track.length > 0
      && r.track.box[2] + radius >= view.x0 && r.track.box[0] - radius <= view.x1
      && r.track.box[3] + radius >= view.y0 && r.track.box[1] - radius <= view.y1);
    active = active.filter(slot => shown.includes(slot.route));
    while (active.length < Math.min(MAX_BEADS, shown.length)) {
      active.push({ route: nextRoute(), distance: 0,
        speed: MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED), wait: pause() });
    }
  }

  function advance() {
    const t = clock();
    const elapsed = Math.max(0, t - lastTime);
    lastTime = t;
    for (const slot of active) {
      let remaining = elapsed;
      while (remaining > 0) {
        const waiting = Math.min(remaining, slot.wait);
        slot.wait -= waiting;
        remaining -= waiting;
        if (!remaining) break;
        const travel = (slot.route.track.length - slot.distance) * view.scale / slot.speed;
        if (remaining < travel) {
          slot.distance += remaining * slot.speed / view.scale;
          break;
        }
        remaining -= travel;
        slot.distance = 0;
        slot.route = nextRoute(slot);
        slot.wait = pause();
      }
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    advance();
    if (still.matches) return;
    ctx.setTransform(view.k, 0, 0, view.k, -view.x0 * view.k, -view.y0 * view.k);
    if (!glowColour) {
      const style = getComputedStyle(canvas);
      glowColour = style.getPropertyValue('--accent').trim() || '#0e70c8';
      coreColour = style.getPropertyValue('--accent-text').trim() || '#5aa9ef';
      sprite = makeSprite(glowColour, coreColour);
    }
    const radius = GLOW_RADIUS / view.scale;
    for (const slot of active) {
      if (slot.wait > 0) continue;
      const r = slot.route;
      const [x, y] = pointAt(r.track, slot.distance);
      const covers = labels.filter(label => x + radius > label.x && x - radius < label.x + label.w
        && y + radius > label.y && y - radius < label.y + label.h);
      if (covers.length) {
        ctx.save();
        for (const label of covers) {
          ctx.beginPath();
          ctx.rect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
          ctx.rect(label.x, label.y, label.w, label.h);
          ctx.clip('evenodd');
        }
      }
      ctx.globalAlpha = ALPHA[r.state];
      ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
      if (covers.length) ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function tick() {
    frame = 0;
    if (!alive) return;
    draw();
    if (!held && !still.matches && shown.length) frame = requestAnimationFrame(tick);
  }

  function kick() {
    if (!frame && alive) frame = requestAnimationFrame(tick);
  }

  still.addEventListener('change', kick);

  return {
    set(key, state) {
      const r = byKey.get(key);
      if (r && r.state !== state) { r.state = state; refreshShown(); kick(); }
    },

    // The canvas covers only the visible part of the world: sized to the world,
    // it would outgrow any GPU texture at 8x zoom.
    view(tx, ty, scale, w, h) {
      advance();
      const dpr = window.devicePixelRatio || 1;
      view.x0 = -tx / scale;
      view.y0 = -ty / scale;
      view.x1 = view.x0 + w / scale;
      view.y1 = view.y0 + h / scale;
      view.k = scale * dpr;
      view.scale = scale;
      refreshShown();
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
