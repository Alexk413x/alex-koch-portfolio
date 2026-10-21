// Pure module: no DOM. The maproom tests import it in node.

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

export const ROUTE_CLEARANCE = 20;
export const ROUTE_TURN_DEPTH = 40;
export const SELF_ROUTE_WIDTH = 40;
export const SELF_ROUTE_SPACE = SELF_ROUTE_WIDTH;
const CLEAR = ROUTE_CLEARANCE;
const BEND = 80;
const ROUND = [48, 24, 8, 0];
const SAMPLES = 64;

export function contains(o, r) {
  return o.x <= r.x + 0.5 && o.y <= r.y + 0.5 && o.x + o.w >= r.x + r.w - 0.5 && o.y + o.h >= r.y + r.h - 0.5;
}

export function segsPath(segs) {
  const [s0] = segs;
  return `M${s0[0].x} ${s0[0].y}${segs.map(([, a, b, c]) => ` C ${a.x} ${a.y}, ${b.x} ${b.y}, ${c.x} ${c.y}`).join('')}`;
}

export function trimArrowEnds(segs, start = { x: 0, y: 0 }, end = { x: 0, y: 0 }) {
  const out = segs.map(segment => segment.map(point => ({ ...point })));
  if (start.x || start.y) {
    for (const point of out[0].slice(0, 2)) {
      point.x += start.x;
      point.y += start.y;
    }
  }
  if (end.x || end.y) {
    const last = out.at(-1);
    for (const point of last.slice(2)) {
      point.x += end.x;
      point.y += end.y;
    }
  }
  return out;
}

function samples(segs) {
  const out = [];
  for (const s of segs) for (let i = 0; i <= SAMPLES; i += 1) out.push(bez(...s, i / SAMPLES));
  return out;
}

export function crosses(segs, rects) {
  const pts = samples(segs);
  return rects.some(o => pts.some(p => p.x > o.x + 1 && p.x < o.x + o.w - 1 && p.y > o.y + 1 && p.y < o.y + o.h - 1));
}

export function tooClose(segs, rects) {
  return crosses(segs, rects.map(o => {
    const pad = padOf(o);
    return { x: o.x - pad, y: o.y - pad, w: o.w + pad * 2, h: o.h + pad * 2 };
  }));
}

export function spreadPorts(left, width, targets) {
  if (!targets.length) return [];
  const ordered = targets.map((x, index) => ({ x, index })).sort((a, b) => a.x - b.x || a.index - b.index);
  const ports = new Array(targets.length);
  if (ordered.length % 2) {
    const center = left + width / 2;
    let middle = 0;
    for (let i = 1; i < ordered.length; i += 1) {
      const distance = Math.abs(ordered[i].x - center);
      const nearest = Math.abs(ordered[middle].x - center);
      if (distance < nearest - 1e-6
        || (Math.abs(distance - nearest) <= 1e-6 && ordered[i].x > ordered[middle].x)) middle = i;
    }
    ports[ordered[middle].index] = center;
    ordered.slice(0, middle).forEach((target, i) => {
      ports[target.index] = left + width / 2 * (i + 1) / (middle + 1);
    });
    ordered.slice(middle + 1).forEach((target, i) => {
      ports[target.index] = center + width / 2 * (i + 1) / (ordered.length - middle);
    });
    return ports;
  }
  ordered.forEach((target, i) => {
    ports[target.index] = left + width * (i + 1) / (ordered.length + 1);
  });
  return ports;
}

export function along(segs, t) {
  const pts = samples(segs);
  const at = [0];
  for (let i = 1; i < pts.length; i += 1) at.push(at[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const goal = at[at.length - 1] * t;
  const i = Math.max(1, at.findIndex(v => v >= goal));
  const f = at[i] > at[i - 1] ? (goal - at[i - 1]) / (at[i] - at[i - 1]) : 0;
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
}

export const midpoint = segs => along(segs, 0.5);

export function trail(segs, step = 6) {
  const out = [];
  for (const s of segs) {
    const len = [1, 2, 3].reduce((a, i) => a + Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y), 0);
    const n = Math.min(160, Math.max(4, Math.ceil(len / step)));
    for (let i = 0; i <= n; i += 1) out.push(bez(...s, i / n));
  }
  return out;
}

export const ROUTE_SEGS = 32;

function lengthOf(seg) {
  let len = 0;
  let prev = seg[0];
  for (let i = 1; i <= 8; i += 1) {
    const p = bez(...seg, i / 8);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

function halves([p0, p1, p2, p3], t) {
  const mix = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = mix(p0, p1);
  const b = mix(p1, p2);
  const c = mix(p2, p3);
  const d = mix(a, b);
  const e = mix(b, c);
  const m = mix(d, e);
  return [[p0, a, d, m], [m, e, c, p3]];
}

function cut(seg, n) {
  const out = [];
  let rest = seg;
  for (let i = n; i > 1; i -= 1) {
    const [head, tail] = halves(rest, 1 / i);
    out.push(head);
    rest = tail;
  }
  out.push(rest);
  return out;
}

/* CSS morphs one path into another only when their commands match, so every route has `count`
   segments. A route of more segments stays as it is and snaps. */
export function normalize(segs, count = ROUTE_SEGS) {
  if (segs.length >= count) return segs;
  const len = segs.map(lengthOf);
  const total = len.reduce((a, b) => a + b, 0) || 1;
  const extra = count - segs.length;
  const share = len.map(l => (l / total) * extra);
  const give = share.map(Math.floor);
  const left = extra - give.reduce((a, b) => a + b, 0);
  share.map((s, i) => [s - give[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, left)
    .forEach(([, i]) => { give[i] += 1; });
  return segs.flatMap((s, i) => cut(s, 1 + give[i]));
}

function line(a, b) {
  return [a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 }, b];
}

export function rounded(pts, r) {
  const segs = [];
  let at = pts[0];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const k = Math.min(r, l1 / 2, l2 / 2);
    const p = { x: b.x - (b.x - a.x) / l1 * k, y: b.y - (b.y - a.y) / l1 * k };
    const q = { x: b.x + (c.x - b.x) / l2 * k, y: b.y + (c.y - b.y) / l2 * k };
    if (Math.hypot(p.x - at.x, p.y - at.y) > 0.01) segs.push(line(at, p));
    if (k > 0) {
      segs.push([p, { x: p.x + (b.x - p.x) * 2 / 3, y: p.y + (b.y - p.y) * 2 / 3 },
        { x: q.x + (b.x - q.x) * 2 / 3, y: q.y + (b.y - q.y) * 2 / 3 }, q]);
    }
    at = q;
  }
  segs.push(line(at, pts[pts.length - 1]));
  return segs;
}

function heap() {
  const a = [];
  return {
    size: () => a.length,
    push(v) {
      a.push(v);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p][0] <= a[i][0]) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    },
    pop() {
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top;
    },
  };
}

const padOf = o => o.pad ?? CLEAR;

function channel(s, t, rects, d0) {
  const grow = rects.map(o => ({ l: o.x - padOf(o) + 0.5, r: o.x + o.w + padOf(o) - 0.5, t: o.y - padOf(o) + 0.5, b: o.y + o.h + padOf(o) - 0.5 }));
  const free = (x, y) => !grow.some(g => x > g.l && x < g.r && y > g.t && y < g.b);
  const clearH = (y, x1, x2) => !grow.some(g => y > g.t && y < g.b && Math.max(x1, x2) > g.l && Math.min(x1, x2) < g.r);
  const clearV = (x, y1, y2) => !grow.some(g => x > g.l && x < g.r && Math.max(y1, y2) > g.t && Math.min(y1, y2) < g.b);
  const xs = [...new Set([s.x, t.x, ...rects.flatMap(o => [o.x - padOf(o), o.x + o.w + padOf(o)])])].sort((a, b) => a - b);
  const ys = [...new Set([s.y, t.y, ...rects.flatMap(o => [o.y - padOf(o), o.y + o.h + padOf(o)])])].sort((a, b) => a - b);
  const si = xs.indexOf(s.x);
  const sj = ys.indexOf(s.y);
  const ti = xs.indexOf(t.x);
  const tj = ys.indexOf(t.y);
  if (!free(s.x, s.y) || !free(t.x, t.y)) return null;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const key = (i, j, d) => (i * ys.length + j) * 4 + d;
  const best = new Map();
  const prev = new Map();
  const open = heap();
  const h = (i, j) => Math.abs(xs[i] - t.x) + Math.abs(ys[j] - t.y);
  const start = key(si, sj, d0 > 0 ? 2 : 3);
  best.set(start, 0);
  open.push([h(si, sj), 0, si, sj, d0 > 0 ? 2 : 3]);
  while (open.size()) {
    const [, g, i, j, d] = open.pop();
    const k = key(i, j, d);
    if (g > best.get(k)) continue;
    if (i === ti && j === tj) {
      const out = [];
      let at = k;
      while (at !== undefined) {
        const n = Math.floor(at / 4);
        out.push({ x: xs[Math.floor(n / ys.length)], y: ys[n % ys.length] });
        at = prev.get(at);
      }
      return out.reverse();
    }
    DIRS.forEach(([di, dj], nd) => {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ys.length) return;
      const x = xs[ni];
      const y = ys[nj];
      if (!free(x, y)) return;
      if (di ? !clearH(y, xs[i], x) : !clearV(x, ys[j], y)) return;
      const ng = g + Math.abs(x - xs[i]) + Math.abs(y - ys[j]) + (nd === d ? 0 : BEND);
      const nk = key(ni, nj, nd);
      if (best.has(nk) && best.get(nk) <= ng) return;
      best.set(nk, ng);
      prev.set(nk, k);
      open.push([ng + h(ni, nj), ng, ni, nj, nd]);
    });
  }
  return null;
}

function simplify(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    const last = out[out.length - 1];
    if (Math.abs(p.x - last.x) < 0.01 && Math.abs(p.y - last.y) < 0.01) continue;
    const before = out[out.length - 2];
    if (before && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

export function under(p0, p3, rects, depth = CLEAR, rounds = ROUND) {
  const lo = Math.min(p0.x, p3.x);
  const hi = Math.max(p0.x, p3.x);
  const lane = Math.max(p0.y, p3.y, ...rects.filter(o => o.x < hi && o.x + o.w > lo).map(o => o.y + o.h)) + depth;
  const pts = [p0, { x: p0.x, y: lane }, { x: p3.x, y: lane }, p3];
  for (const r of rounds) {
    const segs = rounded(pts, r);
    if (!crosses(segs, rects)) return segs;
  }
  return null;
}

export function detour(p0, d0, p3, d3, rects, { start = ROUTE_TURN_DEPTH, end = ROUTE_TURN_DEPTH, laneX = null } = {}) {
  const s = { x: p0.x, y: p0.y + d0 * start };
  const t = { x: p3.x, y: p3.y + d3 * end };
  let mid = null;
  if (laneX !== null) {
    const preferred = [p0, s, { x: laneX, y: s.y }, { x: laneX, y: t.y }, t, p3];
    if (!crosses(rounded(preferred, 0), rects)) mid = preferred.slice(1, -1);
  }
  mid ||= channel(s, t, rects, d0);
  if (!mid) return null;
  let pts = simplify([p0, ...mid, p3]);
  const compact = (points, near) => {
    if (points.length < 4 || points[0].x !== points[1].x
      || points[1].y !== points[2].y || points[2].x !== points[3].x) return points;
    const candidates = [...new Set([near.y, ...rects.flatMap(o =>
      [o.y - padOf(o), o.y + o.h + padOf(o)]), points[1].y])]
      .filter(y => y >= Math.min(near.y, points[1].y) && y <= Math.max(near.y, points[1].y))
      .sort((a, b) => Math.abs(a - near.y) - Math.abs(b - near.y));
    for (const y of candidates) {
      const next = points.map((p, i) => i === 1 || i === 2 ? { ...p, y } : p);
      if (!crosses(rounded(next, 0), rects)) return next;
    }
    return points;
  };
  pts = compact(pts, s);
  pts = compact([...pts].reverse(), t).reverse();
  for (const r of ROUND) {
    const segs = rounded(pts, r);
    if (!crosses(segs, rects)) return segs;
  }
  return rounded(pts, 0);
}
