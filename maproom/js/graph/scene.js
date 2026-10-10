/* The map scene: tiers, layout and every drawn route, ported from
   docs/report-design/gen-map.py.

   This is a PORT of that artboard's `tiers`, `layout` and route builder. The
   geometry, the constants and the class names are the canvas's; what changed is
   only the data it reads -- a cartographer baseline instead of the sample file.

   It returns the same shapes the artboard's markup consumes: `paths`, `pulses`,
   `anims`, `tops`, `costs`, `boxes` and `dividers`. */

import { along, contains, crosses, detour, midpoint, normalize, segsPath, trail } from './route.js';

export const BOX_W = 92;
export const BOX_W_L = 150;
export const GAP_X = 56;
export const GAP_Y = 200;
export const EXT_H = 96;
const CORNER_PAD = 10;
const CHIP_MARGIN = 3;
const CHIP_AT = [0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8];

/* An arrowhead whose apex is at p, pointing along the unit direction. */
export function headTo(p, ux, uy) {
  const bx = p.x - ux * 6;
  const by = p.y - uy * 6;
  const px = -uy * 3.5;
  const py = ux * 3.5;
  return `M${bx + px} ${by + py} L${p.x} ${p.y} L${bx - px} ${by - py} z`;
}

function bez(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/* The screen the map starts from.

   `meta.launch_state` when it resolves. It does not on every baseline -- this
   fixture's names a screen deleted two generations ago -- so the fallback is
   the screen the most routes lead to, which is what an index looks like from
   inside the graph. */
export function launchScreen(model) {
  const declared = model.meta.launch_state;
  if (declared) {
    const r = model.byRendition.get(declared);
    const s = model.byScreen.get(declared) || (r && r.screen);
    if (s && !s.isExternal) return s;
  }
  let best = null;
  for (const s of model.appScreens) if (!best || s.routesIn.length > best.routesIn.length) best = s;
  return best;
}

/* Screen-level routes, folded to one entry per ordered pair.
   A rendition-level edge is a route between two screens unless both ends sit on
   one screen, which is either a condition change or an affordance that changed
   nothing -- two different facts, kept apart. */
function screenRoutes(model, drawnAs = new Map(), anchorOf = null) {
  const out = new Map();
  const within = new Map();
  const noChange = new Map();
  for (const e of model.edges) {
    const src = e.srcRendition && e.srcRendition.screen;
    const dst = e.dstRendition && e.dstRendition.screen;
    if (!src || !dst) continue;
    const fromBox = drawnAs.get(src.id) || src.id;
    const toBox = drawnAs.get(dst.id) || dst.id;
    if (fromBox === toBox) {
      if (fromBox === OUTSIDE) continue;
      const bucket = e.isSelf ? noChange : within;
      if (!bucket.has(fromBox)) bucket.set(fromBox, []);
      bucket.get(fromBox).push(e);
      continue;
    }
    const from = anchorOf ? anchorOf(e.srcRendition) : fromBox;
    const to = anchorOf ? anchorOf(e.dstRendition) : toBox;
    const key = `${from}>${to}`;
    if (!out.has(key)) out.set(key, { from, to, fromBox, toBox, edges: [] });
    out.get(key).edges.push(e);
  }
  return { pairs: out, within, noChange };
}

const BACK_ACTIONS = new Set(['back', 'edge-swipe-back-gesture']);
const BACK_LABELS = new Set(['back', 'navigate up']);
const LAUNCH_ACTIONS = new Set(['launch', 'launch-app-by-package-activity']);
const DISMISS_ACTION = 'dismiss-transient-view';
const DISMISS_GESTURE = 'gesture:swipe-to-dismiss';

function actionId(e) {
  const own = (e.action || '').split(/[[(:]/, 1)[0];
  if (own) return own;
  const first = (e.steps || [])[0];
  return (first && (first.action_id || first.verb)) || '';
}

function controlLabel(e) {
  const a = e.action || '';
  const cut = a.lastIndexOf(':');
  return cut >= 0 ? a.slice(cut + 1).trim().toLowerCase() : '';
}

/* The screen each screen is drawn with: the one other screen every state of it is a shown
   display child of (VIEW-18), as an overlay over its host; with `hidden`, a hidden one too. */
function parentScreens(model, { hidden = false } = {}) {
  const rows = new Map((model.displays || []).map(r => [r.state, r]));
  const out = new Map();
  for (const s of model.screens) {
    if (s.isExternal || !(s.renditions || []).length) continue;
    const parents = new Set();
    for (const r of s.renditions) {
      const row = rows.get(r.id);
      const p = row && (row.display === 'shown' || hidden) && model.byRendition.get(row.parent);
      if (p && p.screen === s) continue;
      parents.add(p && p.screen && !p.screen.isExternal ? p.screen.id : null);
    }
    const [only] = parents;
    if (parents.size === 1 && only) out.set(s.id, only);
  }
  return out;
}

function topOf(parents, id) {
  const seen = new Set();
  while (parents.has(id) && !seen.has(id)) { seen.add(id); id = parents.get(id); }
  return id;
}

/* The screen an overlay sits over: its display parent's, else `<host>` of an overlay id
   `<host>.<kind>`. */
function hostOf(model, parents, id) {
  if (parents.has(id)) return parents.get(id);
  const cut = id.lastIndexOf('.');
  const host = cut > 0 ? id.slice(0, cut) : '';
  return host && model.byScreen.has(host) ? host : '';
}

/* The screen the launch edges start from, else the launch screen. */
export function launchOrigin(model) {
  const count = new Map();
  for (const e of model.edges) {
    const from = e.srcRendition && e.srcRendition.screen;
    if (from && from.isExternal && LAUNCH_ACTIONS.has(actionId(e))) {
      count.set(from.id, (count.get(from.id) || 0) + 1);
    }
  }
  const [best] = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (best) return best[0];
  const start = launchScreen(model);
  return start ? start.id : null;
}

/* Whether an edge may set its destination's rank. A back, a dismissal and a relaunch return
   to a screen, so they never do. */
function isForward(model, parents, origin, e, from, to) {
  const id = actionId(e);
  if (BACK_ACTIONS.has(id) || BACK_LABELS.has(controlLabel(e))) return false;
  if (id === DISMISS_ACTION || (e.action || '').includes(DISMISS_GESTURE)) return false;
  if (LAUNCH_ACTIONS.has(id) && from !== origin) return false;
  return hostOf(model, parents, from) !== to;
}

/* Rows by rank (VIEW-20): a screen's shortest forward distance from the launch origin, the
   launcher the launch edges start from, else the launch screen. A screen drawn with another
   (an overlay all of whose states are that screen's display children) takes that screen's
   rank and sits right after it. Screens no forward edge reaches go below the reached ones,
   ranked the same way from those of them no other unreached screen reaches forward, in id
   order. A row is ordered by where its screens' forward sources sit in the row above. */
export function tiers(model) {
  const parents = parentScreens(model);
  const top = id => topOf(parents, id);
  const origin = launchOrigin(model);
  const ids = model.screens.map(s => s.id);
  const placed = ids.filter(id => top(id) === id).sort();
  const fwd = new Map(placed.map(id => [id, new Set()]));
  const fwdIn = new Map(placed.map(id => [id, new Set()]));
  const linked = new Set();
  for (const e of model.edges) {
    const from = e.srcRendition && e.srcRendition.screen;
    const to = e.dstRendition && e.dstRendition.screen;
    if (!from || !to || from === to) continue;
    linked.add(from.id);
    linked.add(to.id);
    const a = top(from.id);
    const b = top(to.id);
    if (a === b || !isForward(model, parents, origin, e, from.id, to.id)) continue;
    fwd.get(a).add(b);
    fwdIn.get(b).add(a);
  }

  const rank = new Map();
  const walk = (roots, base) => {
    const queue = [];
    for (const id of roots) if (!rank.has(id)) { rank.set(id, base); queue.push(id); }
    while (queue.length) {
      const id = queue.shift();
      for (const to of [...fwd.get(id)].sort()) {
        if (!rank.has(to)) { rank.set(to, rank.get(id) + 1); queue.push(to); }
      }
    }
  };
  if (origin && fwd.has(top(origin))) walk([top(origin)], 0);
  while (rank.size < placed.length) {
    const base = rank.size ? Math.max(...rank.values()) + 1 : 0;
    const left = placed.filter(id => !rank.has(id));
    const roots = left.filter(id => ![...fwdIn.get(id)].some(from => !rank.has(from)));
    walk(roots.length ? roots : [left[0]], base);
  }

  const byRank = new Map();
  for (const id of placed) {
    const d = rank.get(id);
    if (!byRank.has(d)) byRank.set(d, []);
    byRank.get(d).push(id);
  }
  const out = [...byRank.entries()].sort((a, b) => a[0] - b[0]).map(([d, list]) => ({ d, ids: list }));
  for (let i = 1; i < out.length; i += 1) {
    const above = out[i - 1].ids;
    const key = (id) => {
      const ps = [...fwdIn.get(id)].map(from => above.indexOf(from)).filter(k => k >= 0);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
    };
    out[i].ids.sort((a, b) => key(a) - key(b) || a.localeCompare(b));
  }

  const drawnWith = new Map();
  for (const id of ids.filter(id => top(id) !== id).sort()) {
    if (!drawnWith.has(top(id))) drawnWith.set(top(id), []);
    drawnWith.get(top(id)).push(id);
  }
  const outside = new Set(model.screens.filter(s => s.isExternal).map(s => s.id));
  for (const row of out) {
    row.ids = row.ids.flatMap(id => [id, ...(drawnWith.get(id) || [])]);
    row.externals = new Set(row.ids.filter(id => outside.has(id)));
    row.isolated = row.ids.every(id => !linked.has(id));
  }
  return out;
}

export const OUTSIDE = '@outside';

export function mapRows(model, rows, { grouped = true } = {}) {
  const parents = parentScreens(model, { hidden: true });
  const drawnAs = new Map();
  for (const id of parents.keys()) drawnAs.set(id, topOf(parents, id));
  for (const s of model.screens) if (s.isExternal) drawnAs.set(s.id, OUTSIDE);
  const out = rows.map(r => ({ ...r, ids: r.ids.filter(id => !drawnAs.has(id)), externals: new Set() }))
    .filter(r => r.ids.length);
  if (grouped) out.unshift({ d: -1, ids: [OUTSIDE], externals: new Set(), isolated: false });
  return { rows: out, drawnAs };
}

/* A box's width and capture height in one orientation. */
export function boxDims(orient = 'portrait') {
  const w = orient === 'landscape' ? BOX_W_L : BOX_W;
  const ih = orient === 'landscape' ? Math.round(w * 233 / 520) : Math.round(w * 520 / 233);
  return { w, ih };
}

/* Where every box sits, and the divider above a tier nothing reaches. A box outside the app is a short card, since it holds
   a name, unless `tallExternal` says a run's capture of it is shown. A row
   holding only such cards is as short as they are. A screen in `frames` takes its
   footprint's size (`stackLayout`): its card, its caption and, expanded, its row of display
   states. Every row is laid out again around it, so collapsing puts each box back where it
   was. A footprint's card is `cdx` from its left and `cw` wide. */
export function layout(rows, orient = 'portrait', { tallExternal = false, frames = new Map() } = {}) {
  const { w, ih } = boxDims(orient);
  const pos = new Map();
  const dividers = [];
  let y = 40;
  let worldW = 0;

  for (const row of rows) {
    const external = id => Boolean(row.externals && row.externals.has(id));
    const short = !tallExternal;
    if (row.isolated) dividers.push({ y: y - GAP_Y / 2, text: 'no route to or from the screens above' });
    row.y = y;
    let x = 0;
    let rh = 0;
    for (const id of row.ids) {
      const card = external(id) && short;
      const frame = external(id) ? null : (frames.get(id) || null);
      const box = frame
        ? { x, y, w: frame.w, h: frame.h, ih, external: false, frame: true, cdx: frame.card.x, cw: frame.card.w, ch: frame.card.h }
        : { x, y, w, h: card ? EXT_H : ih, ih: card ? 0 : ih, external: external(id) };
      pos.set(id, box);
      x += box.w + GAP_X;
      rh = Math.max(rh, box.h);
    }
    row.w = row.ids.length ? x - GAP_X : 0;
    worldW = Math.max(worldW, row.w + 80);
    y += rh + GAP_Y;
  }
  // Centre every row on the widest, so the fan reads as a fan.
  for (const row of rows) {
    const off = Math.round((worldW - row.w) / 2);
    row.ids.forEach(id => { pos.get(id).x += off; });
  }
  for (const dv of dividers) { dv.x = 40; dv.w = worldW - 80; }
  return { pos, worldW, worldH: y - GAP_Y + 40, dividers, ih, boxW: w };
}

/* One route as the cost popup draws it: its steps, and what it cost.

   A step row names the action the driver actually ran (`action_id`, the foreign
   key into the driver graph) rather than `edge.action`, which is this map's own
   name for the route. Time is a property of the ROUTE, not of a step -- only
   `edge` carries a measurement -- so it sits on the route and the view prints
   it once. */
export function routeOf(e) {
  const steps = e.steps.length
    ? e.steps.map(st => ({ action: st.action_id || st.verb || e.action || '?', target: st.target || '' }))
    : [{ action: e.action || '(no action)', target: '' }];
  return { name: e.action || '(no action)', src: e.src, dst: e.dst, ms: e.timed ? e.measured_ms : null, steps };
}

/* Every drawn thing for one frame, given what is selected and what is hot. */
export function scene(model, rows, geo, {
  sel = null, hot = null, hover = null, drawnAs = new Map(), names = new Map(), anchorOf = null,
} = {}) {
  const pos = new Map([...(geo.anchors || []), ...geo.pos]);
  const boxOf = id => ((geo.anchors || new Map()).get(id) || { box: id }).box;
  const { pairs, within, noChange } = screenRoutes(model, drawnAs, anchorOf);
  const named = id => names.get(boxOf(id)) || names.get(id) || id;
  const paths = [];
  const costs = [];
  const anims = [];
  const tops = [];
  const pulses = [];

  const focus = hover || sel;
  const lit = new Set();
  if (focus) {
    for (const p of pairs.values()) {
      if (p.fromBox === focus || p.toBox === focus) lit.add(`${p.from}>${p.to}`);
    }
    if (within.has(focus) || noChange.has(focus)) lit.add(focus);
  }

  const tierOf = new Map();
  rows.forEach((row, i) => row.ids.forEach(id => tierOf.set(id, i)));
  for (const id of pos.keys()) if (!tierOf.has(id)) tierOf.set(id, tierOf.get(boxOf(id)));

  // Pass one: one line per pair, and which edge of each box it uses.
  const lines = [];
  for (const p of pairs.values()) {
    const ta = tierOf.get(p.from);
    const tb = tierOf.get(p.to);
    const rev = pairs.get(`${p.to}>${p.from}`) || null;
    // A two-way pair is ONE line with a head at each end; skip the mirror.
    if (rev && (tb < ta || (tb === ta && p.to < p.from))) continue;
    const isLit = lit.has(`${p.from}>${p.to}`) || (rev && lit.has(`${p.to}>${p.from}`));
    const kind = tb > ta ? 'down' : tb === ta ? 'level' : 'up';
    lines.push({
      from: p.from, to: p.to, r: p, rev, isLit, kind,
      srcEdge: kind === 'up' ? 'top' : 'bottom',
      dstEdge: kind === 'down' ? 'top' : 'bottom',
    });
  }

  // Spread the anchors along each edge, ordered by where the other end sits.
  const slots = new Map();
  for (const ln of lines) {
    for (const [id, edge, other, side] of [[ln.from, ln.srcEdge, ln.to, 'src'], [ln.to, ln.dstEdge, ln.from, 'dst']]) {
      const k = `${id}:${edge}`;
      if (!slots.has(k)) slots.set(k, []);
      slots.get(k).push({ ln, other, side });
    }
  }
  for (const [k, list] of slots) {
    const id = k.slice(0, k.lastIndexOf(':'));
    const box = pos.get(id);
    if (!box) continue;
    list.sort((p, q) => (pos.get(p.other).x - pos.get(q.other).x) || p.other.localeCompare(q.other));
    const left = box.x + (box.cdx || 0);
    const span = (box.cw || box.w) - CORNER_PAD * 2;
    list.forEach((e, i) => {
      e.ln[`${e.side}X`] = left + CORNER_PAD + (list.length === 1 ? span / 2 : span * i / (list.length - 1));
    });
  }

  const loops = [];
  for (const s of model.screens) {
    const a = pos.get(s.id);
    if (!a || !(within.has(s.id) || noChange.has(s.id))) continue;
    const y = a.y + (a.ch || a.ih || a.h) * 0.4;
    loops.push({ x: a.x + (a.cdx || 0) + (a.cw || a.w), y: y - 32, w: 40, h: 64 });
  }
  const solids = [...geo.pos.values(), ...(geo.solids || []), ...loops];
  const blocking = (a, b) => solids.filter(o => !contains(o, a) && !contains(o, b) && !contains(a, o) && !contains(b, o));

  // Pass two: geometry.
  const chipAt = [];
  for (const ln of lines) {
    const a = pos.get(ln.from);
    const b = pos.get(ln.to);
    if (!a || !b) continue;
    const A = { t: a.y, b: a.y + a.h };
    const B = { t: b.y, b: b.y + b.h };
    const sx = ln.srcX;
    const ex = ln.dstX;
    const isLit = ln.isLit;
    const isHot = hot === `${ln.from}>${ln.to}` || hot === `${ln.to}>${ln.from}`;
    const gcls = isHot ? 'lit hot' : isLit ? 'lit' : (sel ? 'dim' : '');
    const headCls = `head${isHot || isLit ? ' lit' : (sel ? ' dim' : '')}`;

    let p0;
    let p1;
    let p2;
    let p3;
    let endHead;
    let startHead;
    if (ln.kind === 'down') {
      p0 = { x: sx, y: A.b }; p3 = { x: ex, y: B.t };
      const c = (B.t - A.b) * 0.5;
      p1 = { x: sx, y: A.b + c }; p2 = { x: ex, y: B.t - c };
      endHead = headTo(p3, 0, 1); startHead = headTo(p0, 0, -1);
    } else if (ln.kind === 'level') {
      // A smooth arc through the gap below, dipping deeper the further it travels.
      p0 = { x: sx, y: A.b }; p3 = { x: ex, y: B.b };
      const dip = Math.min(GAP_Y * 0.9, GAP_Y * 0.25 + Math.abs(ex - sx) * 0.22);
      p1 = { x: sx, y: A.b + dip }; p2 = { x: ex, y: B.b + dip };
      endHead = headTo(p3, 0, -1); startHead = headTo(p0, 0, -1);
    } else {
      p0 = { x: sx, y: A.t }; p3 = { x: ex, y: B.b };
      const c = (A.t - B.b) * 0.5;
      p1 = { x: sx, y: A.t - c }; p2 = { x: ex, y: B.b + c };
      endHead = headTo(p3, 0, -1); startHead = headTo(p0, 0, 1);
    }

    let segs = [[p0, p1, p2, p3]];
    const walls = blocking(a, b);
    if (crosses(segs, walls)) {
      const away = (p, box) => (Math.abs(p.y - box.y) < 0.5 ? -1 : 1);
      segs = detour(p0, away(p0, a), p3, away(p3, b), [...walls, a, b]) || segs;
    }
    const same = normalize(segs);
    const d = segsPath(same);
    const dRev = segsPath([...same].reverse().map(q => [...q].reverse()));
    const mid = segs.length === 1 ? bez(p0, p1, p2, p3, 0.5) : midpoint(segs);

    paths.push({
      // The key is what every later class toggle addresses this line by.
      key: `${ln.from}>${ln.to}`,
      from: ln.from, to: ln.to, fromBox: ln.r.fromBox, toBox: ln.r.toBox,
      d, dRev, gcls, head: endHead, headCls,
      head2: ln.rev ? startHead : 'M0 0',
      head2Cls: ln.rev ? `${headCls} start` : 'none',
      twoWay: Boolean(ln.rev),
    });
    // A pulse travels the line in the flow's own direction, forward as drawn.
    pulses.push({
      key: `${ln.from}>${ln.to}`,
      d,
      segs,
      cls: `pulse${isHot || isLit ? ' lit' : (sel ? ' dim' : '')}`,
      delay: -((pulses.length * 0.37) % 2.6),
    });
    const topCls = `head top${isHot ? ' hot' : ''}`;
    if (isLit) {
      // The accent runs AWAY from the focused screen, so direction is readable.
      anims.push({ d: (ln.rev && focus === ln.to) ? dRev : d, cls: `anim${isHot ? ' hot' : ''}` });
      tops.push({ d: endHead, cls: topCls });
      if (ln.rev) tops.push({ d: startHead, cls: topCls });
    }
    if (isHot || isLit || !sel) {
      const fwd = ln.r.edges;
      const back = ln.rev ? ln.rev.edges : [];
      const total = fwd.length + back.length;
      // One group per direction. A two-way pair is one line on the map, so its
      // chip has to answer for both directions or the reverse routes have no
      // popup at all.
      const groups = [{ head: `${named(ln.from)} → ${named(ln.to)}`, routes: fwd.map(routeOf) }];
      if (back.length) groups.push({ head: `${named(ln.to)} → ${named(ln.from)}`, routes: back.map(routeOf) });
      const cost = {
        key: `${ln.from}>${ln.to}`,
        x: mid.x, y: mid.y, text: String(total),
        cls: `cost${isHot || isLit ? ' lit' : ''}`,
        groups,
      };
      costs.push(cost);
      chipAt.push({ cost, segs, walls });
    }
  }

  const trails = new Map(paths.map((p, i) => [p.key, trail(pulses[i].segs)]));
  const placed = [];
  for (const { cost, segs, walls } of chipAt) {
    const w = Math.max(18, 10 + 6.6 * cost.text.length) + 2 * CHIP_MARGIN;
    const room = (p) => {
      const r = { x: p.x - w / 2, y: p.y - 9 - CHIP_MARGIN, w, h: 18 + 2 * CHIP_MARGIN };
      const inside = q => q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h;
      const meets = o => o.x < r.x + r.w && o.x + o.w > r.x && o.y < r.y + r.h && o.y + o.h > r.y;
      return !paths.some(o => o.key !== cost.key && trails.get(o.key).some(inside))
        && !walls.some(meets) && !placed.some(meets) ? r : null;
    };
    let at = { x: cost.x, y: cost.y };
    let r = room(at);
    for (const t of CHIP_AT) {
      if (r) break;
      at = along(segs, t);
      r = room(at);
    }
    if (!r) {
      at = { x: cost.x, y: cost.y };
      r = { x: at.x - w / 2, y: at.y - 9 - CHIP_MARGIN, w, h: 18 + 2 * CHIP_MARGIN };
    }
    cost.x = at.x;
    cost.y = at.y;
    placed.push(r);
  }

  // Self loops, off the right side. Two kinds, and they do not mean the same
  // thing: a condition change is navigation, a no-change route is a dead
  // affordance.
  for (const s of model.screens) {
    const a = pos.get(s.id);
    if (!a) continue;
    const here = (within.get(s.id) || []).concat(noChange.get(s.id) || []);
    if (!here.length) continue;
    const x = a.x + (a.cdx || 0) + (a.cw || a.w);
    const y = a.y + (a.ch || a.ih || a.h) * 0.4;
    const isLit = lit.has(s.id);
    const isHot = hot === `${s.id}>${s.id}`;
    const loop = [{ x, y: y - 14 }, { x: x + 34, y: y - 30 }, { x: x + 34, y: y + 30 }, { x, y: y + 14 }];
    const dSelf = segsPath(normalize([loop]));
    const ux = -34 / Math.hypot(34, 16);
    const uy = -16 / Math.hypot(34, 16);
    const gcls = isHot ? 'lit hot' : isLit ? 'lit' : (sel ? 'dim' : '');
    paths.push({
      key: `${s.id}>${s.id}`,
      from: s.id, to: s.id,
      d: dSelf, dRev: dSelf, gcls,
      head: headTo({ x, y: y + 14 }, ux, uy),
      headCls: `head${isHot || isLit ? ' lit' : (sel ? ' dim' : '')}`,
      head2: 'M0 0', head2Cls: 'none',
      twoWay: false,
    });
    if (isLit) {
      anims.push({ d: dSelf, cls: `anim${isHot ? ' hot' : ''}` });
      tops.push({ d: headTo({ x, y: y + 14 }, ux, uy), cls: `head top${isHot ? ' hot' : ''}` });
    }
    pulses.push({
      key: `${s.id}>${s.id}`,
      d: dSelf,
      segs: [loop],
      cls: `pulse${isHot || isLit ? ' lit' : (sel ? ' dim' : '')}`,
      delay: 0,
    });
    if (isHot || isLit || !sel) {
      // The two kinds get their own heading rather than a suffix per row: a
      // route that changes the screen's condition and an affordance that did
      // nothing are different facts, and grouping says so once.
      const changed = within.get(s.id) || [];
      const inert = noChange.get(s.id) || [];
      const groups = [];
      if (changed.length) groups.push({ head: 'changes this screen', routes: changed.map(routeOf) });
      if (inert.length) groups.push({ head: 'changed nothing', routes: inert.map(routeOf) });
      costs.push({
        key: `${s.id}>${s.id}`,
        x: x + 26, y, text: String(here.length),
        cls: `cost${isHot || isLit ? ' lit' : ''}`,
        groups,
      });
    }
  }

  return {
    paths, pulses, tops, costs,
    anims: anims.map((q, i) => ({ ...q, id: `rv${i}`, mask: `url(#rv${i})` })),
    within, noChange, pairs,
  };
}
