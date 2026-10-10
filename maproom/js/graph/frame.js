// Pure module: no DOM. The maproom tests import it in node.
import { headTo } from './scene.js';
import { crosses, detour, segsPath, under } from './route.js';
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
const CORNER_PAD = 10;
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

const curve = (p0, p3) => {
  const c = (p3.y - p0.y) / 2;
  return [p0, { x: p0.x, y: p0.y + c }, { x: p3.x, y: p3.y - c }, p3];
};
const pathOf = ([p0, p1, p2, p3]) => `M${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
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

function spread(left, width, n, i) {
  const span = width - CORNER_PAD * 2;
  return left + CORNER_PAD + (n === 1 ? span / 2 : span * i / (n - 1));
}

/* The size of the count chip an arrow carries: a number, as a route's chip is. */
export const chipWidth = count => Math.max(CHIP_H, 10 + 7 * String(count).length);

/* A frame is the card on top and, below it, one row of its substate cards each joined to it by an
   arrow that carries the count of the actions between them. */
export function nodeLayout(spec) {
  const { cardW, cardH } = spec;
  const capH = spec.caption ? CAP_H : 0;
  const depth = (spec.layers || 0) * LAYER_STEP;
  const base = { id: spec.id, spec, states: spec.states || new Set() };
  const rowOpen = Boolean(spec.open && (spec.children || []).length);
  if (!rowOpen) {
    return {
      ...base, frame: false, w: cardW, h: cardH + capH + depth, depth,
      card: { x: 0, y: 0, w: cardW, h: cardH },
      caption: capH ? { x: 0, y: cardH, w: cardW, h: capH } : null,
      children: [], arrows: [],
    };
  }
  const kids = (spec.children || []).map(nodeLayout);
  const rowW = kids.reduce((a, k) => a + k.w, 0) + Math.max(0, kids.length - 1) * KID_GAP;
  const W = Math.max(cardW, rowW) + FRAME_PAD * 2;
  let y = FRAME_PAD;
  const card = { x: (W - cardW) / 2, y, w: cardW, h: cardH };
  y += card.h;
  const caption = capH ? { x: (W - cardW) / 2, y, w: cardW, h: capH } : null;
  y += capH;
  const arrows = [];
  const from = card.y + card.h;
  y += ROW_GAP;
  let x = (W - rowW) / 2;
  for (const k of kids) {
    k.x = x;
    k.y = y;
    x += k.w + KID_GAP;
  }
  const byId = new Map(kids.map(k => [k.id, k]));
  const centre = k => k.x + k.card.x + k.card.w / 2;
  const rowBottom = y + Math.max(...kids.map(k => k.h));
  const pairs = pairsOf(spec, kids);
  const edgesOf = side => (side ? side.edges : []);
  const down = pairs.filter(p => p.a === null).sort((p, q) => centre(byId.get(p.b)) - centre(byId.get(q.b)));
  down.forEach((p, i) => {
    const k = byId.get(p.b);
    const p0 = { x: spread(card.x, card.w, down.length, i), y: from };
    const p3 = { x: centre(k), y: k.y };
    const pts = curve(p0, p3);
    const toKid = Boolean(p.ab) || !p.ba;
    arrows.push({
      id: k.id, from: null, to: k.id, d: pathOf(pts), segs: [pts],
      head: toKid ? headTo(p3, 0, 1) : null, head2: p.ba ? headTo(p0, 0, -1) : null,
      forward: edgesOf(p.ab), backward: edgesOf(p.ba),
      label: at(pts, LABEL_T), end: p3,
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
    const mid = centre(k);
    const px = f => centre(byId.get(f.other));
    list.sort((u, v) => (px(u) > mid) - (px(v) > mid) || px(v) - px(u));
    list.forEach((f, i) => foot.set(`${id}|${f.p.a}>${f.p.b}`, { x: spread(k.x + k.card.x, k.card.w, list.length, i), y: k.y + k.h }));
  }
  const rects = [{ x: card.x, y: card.y, w: card.w, h: card.h + capH },
    ...kids.map(k => ({ x: k.x + k.card.x, y: k.y + k.card.y, w: k.card.w, h: k.h }))];
  let deepest = rowBottom;
  const lanes = [];
  for (const p of [...side].sort((u, v) => span(u, centre, byId) - span(v, centre, byId))) {
    const p0 = foot.get(`${p.a}|${p.a}>${p.b}`);
    const p3 = foot.get(`${p.b}|${p.a}>${p.b}`);
    const ctrl = Math.max(p0.y, p3.y) + SIB_DIP + Math.abs(p3.x - p0.x) * 0.15;
    let segs = [[p0, { x: p0.x, y: ctrl }, { x: p3.x, y: ctrl }, p3]];
    if (crosses(segs, rects)) {
      const lo = Math.min(p0.x, p3.x);
      const hi = Math.max(p0.x, p3.x);
      const used = lanes.filter(l => l.lo < hi && l.hi > lo).length;
      segs = under(p0, p3, rects, SIB_DIP / 2 + used * LANE_STEP) || detour(p0, 1, p3, 1, rects) || segs;
      lanes.push({ lo, hi });
    }
    arrows.push({
      id: `${p.a}>${p.b}`, from: p.a, to: p.b, d: segsPath(segs), segs,
      head: p.ab ? headTo(p3, 0, -1) : null, head2: p.ba ? headTo(p0, 0, -1) : null,
      forward: edgesOf(p.ab), backward: edgesOf(p.ba),
      label: at(segs[Math.floor(segs.length / 2)], segs.length % 2 ? 0.5 : 0), end: p.ab ? p3 : p0,
    });
    deepest = Math.max(deepest, ...segs.flatMap(q => [0.5, 1].map(t => at(q, t).y)).map(v => v + SIB_DIP / 2));
  }
  y = deepest + FRAME_PAD;
  return { ...base, frame: true, w: W, h: y, boxH: y, card, caption, children: kids, arrows };
}

export function solidRects(root, ox = 0, oy = 0, out = []) {
  const cap = root.caption ? root.caption.h : 0;
  out.push({ id: root.id, x: ox + root.card.x, y: oy + root.card.y, w: root.card.w, h: root.card.h + cap });
  if (!root.frame) return out;
  for (const k of root.children) solidRects(k, ox + k.x, oy + k.y, out);
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
  for (const k of root.children) labelRects(k, ox + k.x, oy + k.y, out);
  return out;
}

export function anchorRects(root, ox = 0, oy = 0, out = new Map()) {
  for (const k of root.children) {
    const x = ox + k.x;
    const y = oy + k.y;
    out.set(k.id, { x: x + k.card.x, y: y + k.card.y, w: k.card.w, h: k.card.h + (k.caption ? k.caption.h : 0) + (k.depth || 0) });
    anchorRects(k, x, y, out);
  }
  return out;
}

export function anchorOf(root, state) {
  let node = root;
  let id = root.id;
  while (node && node.frame) {
    const next = node.children.find(k => k.states.has(state));
    if (!next) break;
    id = next.id;
    node = next;
  }
  return id;
}
