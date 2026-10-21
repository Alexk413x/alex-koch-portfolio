// Pure module: no DOM. The maproom tests import it in node.
import { headTo } from './scene.js';
import { ROUTE_CLEARANCE, SELF_ROUTE_SPACE, along, detour, segsPath, spreadPorts, tooClose, trimArrowEnds, under } from './route.js';
import { controlOf } from '../data/substates.js';

export const CAP_H = 20;
export const ROW_GAP = 96;
export const KID_GAP = 40;
export const FRAME_PAD = 24;
export const SIB_DIP = 28;
export const CHIP_H = 18;
export const LAYER_STEP = 4;
const CHIP_PAD = 4;
const LABEL_T = 0.76;
const LANE_STEP = 14;

const TAP = 'activate-focused-element';

/* The name an arrow carries: the control an edge's action drove, after its verb unless that
   is a tap; else the text it typed, the target its last step names, or the action. */
export function actionLabel(edge) {
  const action = edge.action || '(no action)';
  const control = controlOf(edge.action);
  if (control) {
    const tail = control.slice(control.lastIndexOf(':') + 1) || control;
    const name = tail.slice(tail.lastIndexOf('/') + 1) || tail;
    const verb = action.split(/[[(:]/)[0];
    return verb === TAP ? name : `${verb} ${name}`;
  }
  const last = (edge.steps || []).at(-1);
  const params = (last && last.paramsObj) || {};
  if (params.text) return `"${params.text}"`;
  return last && last.target ? `${action} ${last.target}` : action;
}

const unique = list => [...new Set(list)];

const curve = (p0, p3, start = 0.5, end = 0.5) => {
  const dy = p3.y - p0.y;
  return [p0, { x: p0.x, y: p0.y + dy * start }, { x: p3.x, y: p3.y - dy * end }, p3];
};
const siblingArc = (p0, p3, depth) => [[
  p0,
  { x: p0.x, y: p0.y + depth },
  { x: p3.x, y: p3.y + depth },
  p3,
]];
const at = ([p0, p1, p2, p3], t) => {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: k[0] * p0.x + k[1] * p1.x + k[2] * p2.x + k[3] * p3.x, y: k[0] * p0.y + k[1] * p1.y + k[2] * p2.y + k[3] * p3.y };
};

function pairsOf(spec, kids) {
  const order = new Map([[null, -1], ...kids.map((k, i) => [k.id, i])]);
  const out = new Map(kids.map(k => [`null>${k.id}`, { a: null, b: k.id, ab: null, ba: null }]));
  for (const f of spec.flows || []) {
    if (!order.has(f.from) || !order.has(f.to) || f.from === f.to) continue;
    const fwd = order.get(f.from) < order.get(f.to);
    const [a, b] = fwd ? [f.from, f.to] : [f.to, f.from];
    const key = `${a}>${b}`;
    if (!out.has(key)) out.set(key, { a, b, ab: null, ba: null });
    const p = out.get(key);
    const side = fwd ? 'ab' : 'ba';
    const had = p[side] || { edges: [] };
    p[side] = { edges: unique([...had.edges, ...(f.edges || [])]) };
  }
  return [...out.values()];
}

const span = (p, centre, byId) => Math.abs(centre(byId.get(p.b)) - centre(byId.get(p.a)));

/* The size of the count chip an arrow carries: a number, as a route's chip is. */
export const chipWidth = count => Math.max(CHIP_H, 10 + 7 * String(count).length);

/* A frame is the screenshot with its footer and, below it, one row of substate cards joined by
   arrows that carry the count of the actions between them. */
export function nodeLayout(spec) {
  const { cardW, cardH } = spec;
  const capH = spec.caption ? CAP_H : 0;
  const depth = (spec.layers || 0) * LAYER_STEP;
  const loopSpace = spec.selfRoutes ? SELF_ROUTE_SPACE : 0;
  const base = { id: spec.id, spec, loopSpace, states: spec.states || new Set() };
  const rowOpen = Boolean(spec.open && (spec.children || []).length);
  if (!rowOpen) {
    return {
      ...base, frame: false, w: cardW + loopSpace, h: cardH + capH + depth, depth,
      card: { x: 0, y: 0, w: cardW, h: cardH + capH, shotH: cardH },
      caption: capH ? { x: 0, y: cardH, w: cardW, h: capH } : null,
      children: [], arrows: [],
    };
  }
  const kids = (spec.children || []).map(nodeLayout);
  const gapAfter = k => Math.max(ROUTE_CLEARANCE, KID_GAP - (k.frame ? 0 : k.loopSpace));
  const rowW = kids.reduce((a, k, i) => a + k.w + (i < kids.length - 1 ? gapAfter(k) : 0), 0);
  let W = Math.max(cardW, rowW) + FRAME_PAD * 2;
  let y = FRAME_PAD;
  const card = { x: (W - cardW) / 2, y, w: cardW, h: cardH + capH, shotH: cardH };
  y += card.h + depth;
  const caption = capH ? { x: card.x, y: card.y + cardH, w: cardW, h: capH } : null;
  const arrows = [];
  const from = card.y + card.h + depth;
  y += ROW_GAP;
  let x = (W - rowW) / 2;
  for (const k of kids) {
    k.x = x + (k.frame ? k.card.x : 0);
    k.y = y;
    x += k.w + gapAfter(k);
  }
  if (spec.pin && Number.isFinite(spec.pin.offsetX)) {
    const pinnedIndex = kids.findIndex(k => k.states.has(spec.pin.state));
    if (pinnedIndex >= 0) {
      const pinned = kids[pinnedIndex];
      const cardX = card.x + spec.pin.offsetX;
      const offset = cardOffset(pinned, spec.pin.state) ?? 0;
      pinned.x = cardX - offset - (pinned.frame ? 0 : pinned.card.x);
      const pinnedLeft = pinned.x - (pinned.frame ? pinned.card.x : 0);
      let left = pinnedLeft;
      for (let i = pinnedIndex - 1; i >= 0; i -= 1) {
        left -= gapAfter(kids[i]) + kids[i].w;
        kids[i].x = left + (kids[i].frame ? kids[i].card.x : 0);
      }
      W = Math.max(W, card.x + cardW + loopSpace + FRAME_PAD);
      let right = pinnedLeft + pinned.w + gapAfter(pinned);
      for (let i = pinnedIndex + 1; i < kids.length; i += 1) {
        kids[i].x = right + (kids[i].frame ? kids[i].card.x : 0);
        right += kids[i].w + gapAfter(kids[i]);
      }
      const frameLeft = k => k.x - (k.frame ? k.card.x : 0);
      const minX = Math.min(...kids.map(frameLeft));
      const shift = Math.max(0, FRAME_PAD - minX);
      if (shift) {
        for (const k of kids) k.x += shift;
        card.x += shift;
        if (caption) caption.x += shift;
      }
      W = Math.max(W, ...kids.map(k => frameLeft(k) + k.w + FRAME_PAD), card.x + cardW + FRAME_PAD);
    }
  }
  const byId = new Map(kids.map(k => [k.id, k]));
  const cardX = k => k.x + (k.frame ? 0 : k.card.x);
  const cardY = k => k.y + (k.frame ? 0 : k.card.y);
  const centre = k => cardX(k) + k.card.w / 2;
  const boundsOf = k => k.frame
    ? { x: k.x - k.card.x, y: k.y - k.card.y, w: k.w, h: k.h }
    : { x: k.x + k.card.x, y: k.y + k.card.y, w: k.card.w, h: k.card.h + (k.depth || 0) };
  const rowBottom = y + Math.max(...kids.map(k => k.h));
  const pairs = pairsOf(spec, kids);
  const edgesOf = side => (side ? side.edges : []);
  const down = pairs.filter(p => p.a === null).sort((p, q) => centre(byId.get(p.b)) - centre(byId.get(q.b)));
  const parentPorts = spreadPorts(card.x, card.w, down.map(p => centre(byId.get(p.b))));
  down.forEach((p, i) => {
    const k = byId.get(p.b);
    const p0 = { x: parentPorts[i], y: from };
    const target = boundsOf(k);
    const p3 = { x: target.x + target.w / 2, y: target.y };
    let route = [curve(p0, p3)];
    const obstacles = kids.filter(other => other.id !== k.id).map(other => ({
      id: other.id,
      x: other.x - (other.frame ? other.card.x : 0),
      y: other.y - (other.frame ? other.card.y : 0),
      w: other.w, h: other.h,
    }));
    if (tooClose(route, obstacles)) {
      const arc = [curve(p0, p3, 0.25, 0.75)];
      route = !tooClose(arc, obstacles) ? arc : detour(p0, 1, p3, -1, obstacles) || route;
    }
    const toKid = Boolean(p.ab) || !p.ba;
    const segs = trimArrowEnds(route, p.ba ? { x: 0, y: 6 } : undefined,
      toKid ? { x: 0, y: -6 } : undefined);
    arrows.push({
      id: k.id, from: null, to: k.id, d: segsPath(segs), segs,
      head: toKid ? headTo(p3, 0, 1) : null, head2: p.ba ? headTo(p0, 0, -1) : null,
      forward: edgesOf(p.ab), backward: edgesOf(p.ba),
      label: along(segs, LABEL_T), start: p0, end: p3,
    });
  });
  const side = pairs.filter(p => p.a !== null);
  const feet = new Map();
  for (const p of side) {
    for (const [id, other] of [[p.a, p.b], [p.b, p.a]]) {
      if (!feet.has(id)) feet.set(id, []);
      feet.get(id).push({ p, other });
    }
  }
  const foot = new Map();
  for (const [id, list] of feet) {
    const k = byId.get(id);
    const bounds = boundsOf(k);
    const mid = bounds.x + bounds.w / 2;
    const px = f => centre(byId.get(f.other));
    list.sort((u, v) => (px(u) > mid) - (px(v) > mid) || px(v) - px(u));
    const ports = spreadPorts(bounds.x, bounds.w, list.map(px));
    list.forEach((f, i) => foot.set(`${id}|${f.p.a}>${f.p.b}`, { x: ports[i], y: bounds.y + bounds.h }));
  }
  const parentRect = { id: spec.id, x: card.x, y: card.y, w: card.w, h: card.h };
  const kidRects = kids.flatMap(k => [
    {
      id: k.id,
      x: k.x - (k.frame ? k.card.x : 0),
      y: k.y - (k.frame ? k.card.y : 0),
      w: k.w, h: k.h,
    },
    ...solidRects(k, k.x - (k.frame ? k.card.x : 0), k.y - (k.frame ? k.card.y : 0)).slice(1),
  ]);
  const rects = [parentRect, ...kidRects];
  let deepest = rowBottom;
  const lanes = [];
  for (const p of [...side].sort((u, v) => span(u, centre, byId) - span(v, centre, byId))) {
    const p0 = foot.get(`${p.a}|${p.a}>${p.b}`);
    const p3 = foot.get(`${p.b}|${p.a}>${p.b}`);
    const lo = Math.min(p0.x, p3.x);
    const hi = Math.max(p0.x, p3.x);
    const used = lanes.filter(l => l.lo < hi && l.hi > lo).length;
    const ctrl = Math.max(p0.y, p3.y) + SIB_DIP + Math.abs(p3.x - p0.x) * 0.15 + used * LANE_STEP;
    const obstacles = rects.filter(r => r.id !== p.a && r.id !== p.b);
    const conflict = side.some(other => {
      if (other === p) return false;
      const a = centre(byId.get(other.a)), b = centre(byId.get(other.b));
      return Math.min(a, b) < hi && Math.max(a, b) > lo;
    });
    const direct = siblingArc(p0, p3, ctrl - Math.max(p0.y, p3.y));
    let route = !conflict && !tooClose(direct, obstacles) ? direct : null;
    if (!route) {
      route = under(p0, p3, obstacles, SIB_DIP / 2 + ROUTE_CLEARANCE + used * LANE_STEP, [8, 0])
        || (tooClose(direct, obstacles) ? detour(p0, 1, p3, 1, obstacles) : null) || direct;
    }
    const segs = trimArrowEnds(route, p.ba ? { x: 0, y: 6 } : undefined,
      p.ab ? { x: 0, y: 6 } : undefined);
    lanes.push({ lo, hi });
    arrows.push({
      id: `${p.a}>${p.b}`, from: p.a, to: p.b, d: segsPath(segs), segs,
      head: p.ab ? headTo(p3, 0, -1) : null, head2: p.ba ? headTo(p0, 0, -1) : null,
      forward: edgesOf(p.ab), backward: edgesOf(p.ba),
      label: along(segs, LABEL_T), start: p0, end: p3,
    });
    deepest = Math.max(deepest, ...route.flatMap(q => [0.5, 1].map(t => at(q, t).y)).map(v => v + SIB_DIP / 2));
  }
  y = deepest + FRAME_PAD;
  return { ...base, frame: true, depth, w: W, h: y, boxH: y, card, caption, children: kids, arrows };
}

function cardOffset(node, state) {
  if (node.spec.stateId === state) return 0;
  if (!node.frame) return null;
  const child = node.children.find(k => k.states.has(state));
  if (!child) return null;
  const offset = cardOffset(child, state);
  if (offset === null) return null;
  return child.x + (child.frame ? 0 : child.card.x) - node.card.x + offset;
}

export function solidRects(root, ox = 0, oy = 0, out = []) {
  out.push({ id: root.id, x: ox + root.card.x, y: oy + root.card.y, w: root.card.w, h: root.card.h });
  if (!root.frame) return out;
  for (const k of root.children) {
    solidRects(k, ox + k.x - (k.frame ? k.card.x : 0), oy + k.y - (k.frame ? k.card.y : 0), out);
  }
  return out;
}

/* Where each arrow's count chip sits, as a box the other routes keep clear of. */
export function labelRects(root, ox = 0, oy = 0, out = []) {
  for (const a of root.arrows) {
    const n = a.forward.length + a.backward.length;
    if (!a.label || !n) continue;
    const w = chipWidth(n);
    out.push({ id: `label:${root.id}:${a.id}`, x: ox + a.label.x - w / 2, y: oy + a.label.y - CHIP_H / 2, w, h: CHIP_H, pad: CHIP_PAD });
  }
  for (const k of root.children) {
    labelRects(k, ox + k.x - (k.frame ? k.card.x : 0), oy + k.y - (k.frame ? k.card.y : 0), out);
  }
  return out;
}

function intersects(a, b, pad = 0) {
  const margin = pad + (b.pad || 0);
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x
    && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
}

function arrowLabel(arrow, ox, oy, obstacles) {
  const count = arrow.forward.length + arrow.backward.length;
  if (!count || !arrow.label) return false;
  const width = chipWidth(count);
  const current = arrow.label;
  const candidates = Array.from({ length: 34 }, (_, index) => 0.24 + index * 0.02)
    .sort((a, b) => Math.abs(a - LABEL_T) - Math.abs(b - LABEL_T));

  for (const t of candidates) {
    const point = along(arrow.segs, t);
    const rect = {
      x: ox + point.x - width / 2,
      y: oy + point.y - CHIP_H / 2,
      w: width,
      h: CHIP_H,
    };
    if (obstacles.some(obstacle => intersects(rect, obstacle, CHIP_PAD))) continue;
    if (Math.abs(point.x - current.x) < 0.1 && Math.abs(point.y - current.y) < 0.1) return false;
    arrow.label = point;
    return true;
  }
  return false;
}

export function avoidArrowLabels(root, labels, ox = 0, oy = 0, nx = 0, ny = 0) {
  const moved = new Set();
  let movedLabels = false;
  const obstacles = labels.map(label => ({ ...label }));
  function repositionLabels(frame, x, y) {
    for (const arrow of frame.arrows) {
      movedLabels = arrowLabel(arrow, x, y, obstacles) || movedLabels;
      const count = arrow.forward.length + arrow.backward.length;
      if (count && arrow.label) {
        const width = chipWidth(count);
        obstacles.push({
          x: x + arrow.label.x - width / 2,
          y: y + arrow.label.y - CHIP_H / 2,
          w: width,
          h: CHIP_H,
        });
      }
    }
    for (const child of frame.children) {
      repositionLabels(child, x + child.x - (child.frame ? child.card.x : 0),
        y + child.y - (child.frame ? child.card.y : 0));
    }
  }
  const localLabels = labels.map(label => ({
    x: label.x - ox - nx,
    y: label.y - oy - ny,
    w: label.w,
    h: label.h,
    pad: 4,
  }));
  for (const a of root.arrows) {
    if (a.from !== null) continue;
    const kid = root.children.find(child => child.id === a.to);
    if (!kid || !localLabels.length) continue;
    if (!tooClose(a.segs, localLabels)) continue;
    const p0 = a.start;
    const p3 = a.end;
    const target = kid.frame
      ? { x: kid.x - kid.card.x, y: kid.y - kid.card.y, w: kid.w, h: kid.h }
      : { x: kid.x + kid.card.x, y: kid.y + kid.card.y, w: kid.card.w, h: kid.card.h };
    const center = target.x + target.w / 2;
    const siblings = root.children.filter(child => child.id !== kid.id).map(child => (child.frame
      ? { id: child.id, x: child.x - child.card.x, y: child.y - child.card.y, w: child.w, h: child.h }
      : { id: child.id, x: child.x + child.card.x, y: child.y + child.card.y, w: child.card.w, h: child.card.h }));
    const candidates = [center];
    for (let offset = 4; offset <= target.w / 2; offset += 4) candidates.push(center - offset, center + offset);
    for (const x of candidates) {
      const end = { x, y: target.y };
      const segs = [curve(p0, end)];
      if (tooClose(segs, localLabels) || tooClose(segs, siblings)) continue;
      const shaft = trimArrowEnds(segs,
        a.head2 ? { x: 0, y: 6 } : undefined,
        a.head ? { x: 0, y: -6 } : undefined);
      a.segs = shaft;
      a.d = segsPath(shaft);
      a.label = along(shaft, LABEL_T);
      a.end = end;
      if (a.head) a.head = headTo(end, 0, 1);
      moved.add(a.id);
      break;
    }
  }
  repositionLabels(root, ox, oy);
  for (const child of root.children) {
    if (child.frame) {
      if (avoidArrowLabels(child, labels, ox, oy,
        nx + child.x - child.card.x, ny + child.y - child.card.y)) moved.add(child.id);
    }
  }
  return movedLabels || moved.size > 0;
}

export function anchorRects(root, ox = 0, oy = 0, out = new Map()) {
  for (const k of root.children) {
    const frameX = ox + k.x - (k.frame ? k.card.x : 0);
    const frameY = oy + k.y - (k.frame ? k.card.y : 0);
    const put = (id, rect) => out.set(id, {
      ...rect,
      topPorts: root.arrows.filter(a => a.to === k.id && Math.abs(oy + a.end.y - rect.y) < 0.5)
        .map(a => ox + a.end.x),
    });
    if (k.frame) put(`frame:${k.id}`, { x: frameX, y: frameY, w: k.w, h: k.h, frame: true });
    put(k.id, {
      x: frameX + k.card.x, y: frameY + k.card.y,
      w: k.card.w, h: k.card.h + (k.depth || 0),
    });
    anchorRects(k, frameX, frameY, out);
  }
  return out;
}

export function nestedFrameRects(root, ox = 0, oy = 0, out = []) {
  for (const k of root.children) {
    const x = ox + k.x - (k.frame ? k.card.x : 0);
    const y = oy + k.y - (k.frame ? k.card.y : 0);
    if (k.frame) out.push({ id: `frame:${k.id}`, x, y, w: k.w, h: k.h });
    nestedFrameRects(k, x, y, out);
  }
  return out;
}

export function anchorOf(root, state, { card = false } = {}) {
  let node = root;
  let id = root.id;
  while (node && node.frame) {
    const next = node.children.find(k => k.states.has(state));
    if (!next) break;
    id = !card && next.frame ? `frame:${next.id}` : next.id;
    node = next;
  }
  return id;
}
