/* The map scene: tiers, layout and every drawn route, ported from
   docs/report-design/gen-map.py.

   This is a PORT of that artboard's `tiers`, `layout` and route builder. The
   geometry, the constants and the class names are the canvas's; what changed is
   only the data it reads -- a cartographer baseline instead of the sample file.

   It returns the same shapes the artboard's markup consumes: `paths`, `pulses`,
   `anims`, `tops`, `costs`, `boxes` and `dividers`. */

import { ROUTE_CLEARANCE, ROUTE_TURN_DEPTH, SELF_ROUTE_WIDTH, along, contains, detour, midpoint, normalize, segsPath, spreadPorts, tooClose, trimArrowEnds, under } from './route.js';

export const BOX_W = 92;
export const BOX_W_L = 150;
export const GAP_X = 56;
export const GAP_Y = 200;
export const EXT_H = 96;
const ROUTE_CORNER_CLEARANCE = 8;
const ROUTE_LANE_STEP = 14;

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
function screenRoutes(model, drawnAs = new Map(), anchorOf = null, stateAnchorOf = anchorOf) {
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
      const from = stateAnchorOf ? stateAnchorOf(e.srcRendition) : fromBox;
      const to = stateAnchorOf ? stateAnchorOf(e.dstRendition) : toBox;
      if (from !== to) continue;
      const bucket = e.isSelf ? noChange : within;
      if (!bucket.has(from)) bucket.set(from, []);
      bucket.get(from).push(e);
      continue;
    }
    const fromAnchor = anchorOf ? anchorOf(e.srcRendition) : fromBox;
    const toAnchor = anchorOf ? anchorOf(e.dstRendition) : toBox;
    const from = fromAnchor;
    const to = toAnchor;
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

export function mapRows(model, rows, { grouped = true, externalIds = null } = {}) {
  const parents = parentScreens(model, { hidden: true });
  const drawnAs = new Map();
  for (const id of parents.keys()) drawnAs.set(id, topOf(parents, id));
  const shownExternal = new Set(externalIds || model.screens.filter(s => s.isExternal).map(s => s.id));
  const directExternal = new Set(
    grouped ? [] : model.screens.filter(s => s.isExternal && shownExternal.has(s.id)).map(s => s.id),
  );
  for (const s of model.screens) {
    if (s.isExternal && (!shownExternal.has(s.id) || grouped)) drawnAs.set(s.id, OUTSIDE);
  }
  const out = rows.map(r => {
    const ids = r.ids.filter(id => !drawnAs.has(id));
    return { ...r, ids, externals: new Set(ids.filter(id => directExternal.has(id))) };
  })
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
        ? { x, y, w: frame.w, h: frame.h, ih, external: false, frame: frame.frame,
          cdx: frame.card.x, cdy: frame.card.y, cw: frame.card.w, ch: frame.card.h }
        : { x, y, w, h: card ? EXT_H : ih, ih: card ? 0 : ih, external: external(id) };
      pos.set(id, box);
      const loopSpace = frame && !frame.frame ? frame.loopSpace || 0 : 0;
      box.loopSpace = loopSpace;
      x += box.w + Math.max(ROUTE_CLEARANCE, GAP_X - loopSpace);
      rh = Math.max(rh, box.h);
    }
    const last = pos.get(row.ids.at(-1));
    row.w = last ? last.x + last.w : 0;
    worldW = Math.max(worldW, row.w + 80);
    y += rh + GAP_Y;
  }
  // Centre every row on the widest, so the fan reads as a fan.
  for (const row of rows) {
    const tail = row.ids.length === 1 ? pos.get(row.ids[0]).loopSpace : 0;
    const off = Math.round((worldW - row.w + tail) / 2);
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
  stateAnchorOf = anchorOf,
} = {}, lanePorts = null, turnDepths = null) {
  const pos = new Map([...(geo.anchors || []), ...geo.pos]);
  const boxOf = id => ((geo.anchors || new Map()).get(id) || { box: id }).box;
  const { pairs, within, noChange } = screenRoutes(
    model, drawnAs, anchorOf, stateAnchorOf,
  );
  const stateNamed = rendition => rendition?.name || rendition?.leafName || rendition?.id || 'unknown state';
  const anchorNames = new Map();
  for (const e of model.edges) for (const r of [e.srcRendition, e.dstRendition]) {
    if (!r) continue;
    for (const id of [anchorOf?.(r), stateAnchorOf?.(r)]) {
      if (id?.endsWith(`/${r.id}`)) anchorNames.set(id, stateNamed(r));
    }
  }
  const named = id => anchorNames.get(id) || names.get(id) || names.get(boxOf(id)) || id;
  const selfGroups = (edges, label) => {
    const byStatePair = new Map();
    for (const edge of edges) {
      const key = `${edge.src}\0${edge.dst}`;
      if (!byStatePair.has(key)) {
        const from = stateNamed(edge.srcRendition);
        const to = stateNamed(edge.dstRendition);
        const transition = edge.src === edge.dst ? from : `${from} → ${to}`;
        byStatePair.set(key, { head: `${label} · ${transition}`, routes: [] });
      }
      byStatePair.get(key).routes.push(routeOf(edge));
    }
    return [...byStatePair.values()];
  };
  const directionGroups = (edges, from, to) => {
    const byName = new Map();
    for (const edge of edges) {
      const label = r => r.screen.isExternal ? named(drawnAs.get(r.screen.id) || r.screen.id) : stateNamed(r);
      const head = edge.srcRendition.screen.isExternal || edge.dstRendition.screen.isExternal
        ? `${label(edge.srcRendition)} → ${label(edge.dstRendition)}`
        : `${named(from)} → ${named(to)}`;
      if (!byName.has(head)) byName.set(head, { head, routes: [] });
      byName.get(head).routes.push(routeOf(edge));
    }
    return [...byName.values()];
  };
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
    for (const id of new Set([...within.keys(), ...noChange.keys()])) if (boxOf(id) === focus) lit.add(id);
  }

  const tierOf = new Map();
  rows.forEach((row, i) => row.ids.forEach(id => tierOf.set(id, i)));
  for (const id of pos.keys()) if (!tierOf.has(id)) tierOf.set(id, tierOf.get(boxOf(id)));
  const cardBounds = rect => {
    const left = rect.x + (rect.cdx || 0);
    const top = rect.y + (rect.cdy || 0);
    return {
      left,
      right: left + (rect.cw || rect.w),
      top,
      bottom: top + (rect.ch || rect.ih || rect.h),
    };
  };
  const portBounds = target => {
    const rect = pos.get(target);
    const owner = geo.pos.get(boxOf(target));
    if (target === boxOf(target) && owner && owner.frame) {
      return { left: owner.x, right: owner.x + owner.w, top: owner.y, bottom: owner.y + owner.h };
    }
    return cardBounds(rect);
  };

  // Pass one: one line per pair, and which edge of each box it uses.
  const lines = [];
  for (const p of pairs.values()) {
    const ta = tierOf.get(p.from);
    const tb = tierOf.get(p.to);
    const rev = pairs.get(`${p.to}>${p.from}`) || null;
    // A two-way pair is ONE line with a head at each end; skip the mirror.
    if (rev && (tb < ta || (tb === ta && p.to < p.from))) continue;
    const isLit = lit.has(`${p.from}>${p.to}`) || (rev && lit.has(`${p.to}>${p.from}`));
    const boundsA = portBounds(p.from);
    const boundsB = portBounds(p.to);
    const centerA = (boundsA.top + boundsA.bottom) / 2;
    const centerB = (boundsB.top + boundsB.bottom) / 2;
    const kind = tb > ta ? 'down' : tb < ta ? 'up'
      : centerB > centerA + 0.5 ? 'down'
        : centerB < centerA - 0.5 ? 'up' : 'level';
    const upper = kind === 'down' ? boundsA.bottom : boundsB.bottom;
    const lower = kind === 'down' ? boundsB.top : boundsA.top;
    const spansRows = kind !== 'level' && (Math.abs(tb - ta) > 1
      || [...geo.pos.values(), ...(geo.solids || [])].some(rect => {
        const card = cardBounds(rect);
        return card.top > upper + 1 && card.bottom < lower - 1;
      }));
    lines.push({
      from: p.from, to: p.to, r: p, rev, isLit, kind,
      spansRows,
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
    const screen = geo.pos.get(boxOf(id));
    const frameRoot = id === boxOf(id) && screen && screen.frame;
    const centerX = other => {
      const bounds = portBounds(other);
      return (bounds.left + bounds.right) / 2;
    };
    const centerY = other => {
      const bounds = portBounds(other);
      return (bounds.top + bounds.bottom) / 2;
    };
    const ownY = centerY(id);
    list.sort((a, b) => centerX(a.other) - centerX(b.other)
      || Math.abs(centerY(a.other) - ownY) - Math.abs(centerY(b.other) - ownY)
      || a.other.localeCompare(b.other));
    const left = frameRoot ? screen.x : box.x + (box.cdx || 0);
    const width = frameRoot ? screen.w : box.cw || box.w;
    const ports = spreadPorts(left, width, list.map(e => centerX(e.other)));
    const occupied = [...(k.endsWith(':top') ? box.topPorts || [] : [])];
    const bounds = portBounds(id);
    const approachY = k.endsWith(':top') ? bounds.top - ROUTE_CLEARANCE : bounds.bottom + ROUTE_CLEARANCE;
    const blockedPort = x => (geo.solids || []).some(o => {
      if (contains(o, box)) return false;
      const pad = (o.pad ?? ROUTE_CLEARANCE) + ROUTE_CORNER_CLEARANCE;
      return x > o.x - pad && x < o.x + o.w + pad
        && approachY > o.y - pad && approachY < o.y + o.h + pad;
    });
    list.forEach((e, i) => {
      let x = ports[i];
      const gap = ROUTE_CLEARANCE;
      if (blockedPort(x) || occupied.some(p => Math.abs(p - x) < gap)) {
        const candidates = [];
        for (let offset = gap; offset < width; offset += 4) candidates.push(x + offset, x - offset);
        x = candidates.find(p => p >= left + 8 && p <= left + width - 8
          && !blockedPort(p) && occupied.every(other => Math.abs(p - other) >= gap)) ?? x;
      }
      occupied.push(x);
      e.ln[`${e.side}X`] = x;
    });
    const ordered = lanePorts?.get(k);
    if (ordered) for (const e of list) {
      e.ln[`${e.side}X`] = ordered.get(`${e.ln.from}>${e.ln.to}`);
    }
    for (const e of list) {
      const turn = turnDepths?.get(k)?.get(`${e.ln.from}>${e.ln.to}`);
      e.ln[`${e.side}Depth`] = turn?.depth ?? ROUTE_TURN_DEPTH;
      e.ln[`${e.side}LaneOffset`] = turn?.offset ?? 0;
    }
  }

  const loops = [];
  const loopIds = new Set([...within.keys(), ...noChange.keys()]);
  for (const id of loopIds) {
    const a = pos.get(id);
    if (!a) continue;
    const top = a.y + (a.cdy || 0);
    const left = a.x + (a.cdx || 0);
    const width = a.cw || a.w;
    const height = a.ch || a.ih || a.h;
    const y = top + height * 0.4;
    loops.push({ x: left + width, y: y - 32, w: SELF_ROUTE_WIDTH, h: 64 });
  }
  const solids = [...geo.pos.values(), ...(geo.solids || []), ...loops];
  const sameRect = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
    && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
  const blocking = (a, b, cardA, cardB) => solids.filter(o => !sameRect(o, a) && !sameRect(o, b)
    && !sameRect(o, cardA) && !sameRect(o, cardB) && !contains(o, a) && !contains(o, b));

  // Pass two: geometry.
  const spanOf = ln => Math.abs(ln.srcX - ln.dstX);
  lines.sort((a, b) => {
    if (a.spansRows !== b.spansRows) return Number(b.spansRows) - Number(a.spansRows);
    if (a.spansRows && b.spansRows) {
      const center = ln => {
        const bounds = portBounds(ln.from);
        return (bounds.left + bounds.right) / 2;
      };
      const outward = Math.abs(b.dstX - center(b)) - Math.abs(a.dstX - center(a));
      if (outward) return outward;
    }
    if (a.kind === 'level' && b.kind === 'level') {
      return spanOf(a) - spanOf(b)
        || Math.min(a.srcX, a.dstX) - Math.min(b.srcX, b.dstX)
        || `${a.from}>${a.to}`.localeCompare(`${b.from}>${b.to}`);
    }
    return `${a.kind}:${a.from}>${a.to}`.localeCompare(`${b.kind}:${b.from}>${b.to}`);
  });
  const levelLanes = [];
  for (const ln of lines) {
    const a = pos.get(ln.from);
    const b = pos.get(ln.to);
    if (!a || !b) continue;
    const boundsA = portBounds(ln.from);
    const boundsB = portBounds(ln.to);
    const A = { t: boundsA.top, b: boundsA.bottom };
    const B = { t: boundsB.top, b: boundsB.bottom };
    const cardA = { x: boundsA.left, y: A.t, w: boundsA.right - boundsA.left, h: A.b - A.t };
    const cardB = { x: boundsB.left, y: B.t, w: boundsB.right - boundsB.left, h: B.b - B.t };
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
    let startOffset = { x: 0, y: 0 };
    let endOffset;
    let levelLane = null;
    let levelDepth = 0;
    if (ln.kind === 'down') {
      p0 = { x: sx, y: A.b }; p3 = { x: ex, y: B.t };
      const c = (B.t - A.b) * 0.5;
      p1 = { x: sx, y: A.b + c }; p2 = { x: ex, y: B.t - c };
      endHead = headTo(p3, 0, 1); startHead = headTo(p0, 0, -1);
      startOffset = ln.rev ? { x: 0, y: 6 } : startOffset;
      endOffset = { x: 0, y: -6 };
    } else if (ln.kind === 'level') {
      // Short hops stay close to the row; long, overlapping hops take lower lanes.
      const lo = Math.min(sx, ex);
      const hi = Math.max(sx, ex);
      const used = levelLanes.filter(lane => lane.lo < hi && lane.hi > lo).length;
      levelDepth = Math.min(GAP_Y * 0.9,
        GAP_Y * 0.25 + Math.abs(ex - sx) * 0.22 + used * ROUTE_LANE_STEP);
      levelLane = { lo, hi };
      p0 = { x: sx, y: A.b }; p3 = { x: ex, y: B.b };
      p1 = { x: sx, y: A.b + levelDepth }; p2 = { x: ex, y: B.b + levelDepth };
      endHead = headTo(p3, 0, -1); startHead = headTo(p0, 0, -1);
      startOffset = ln.rev ? { x: 0, y: 6 } : startOffset;
      endOffset = { x: 0, y: 6 };
    } else {
      p0 = { x: sx, y: A.t }; p3 = { x: ex, y: B.b };
      const c = (A.t - B.b) * 0.5;
      p1 = { x: sx, y: A.t - c }; p2 = { x: ex, y: B.b + c };
      endHead = headTo(p3, 0, -1); startHead = headTo(p0, 0, 1);
      startOffset = ln.rev ? { x: 0, y: -6 } : startOffset;
      endOffset = { x: 0, y: 6 };
    }

    let segs = [[p0, p1, p2, p3]];
    const targetLabel = `label:${boxOf(ln.to)}:${ln.to}`;
    const walls = blocking(a, b, cardA, cardB).map(o => o.id === targetLabel ? { ...o, pad: 0 } : o);
    const levelConflict = levelLane && lines.some(other => {
      if (other === ln || other.kind !== 'level') return false;
      const otherLo = Math.min(other.srcX, other.dstX);
      const otherHi = Math.max(other.srcX, other.dstX);
      return otherLo < levelLane.hi && otherHi > levelLane.lo;
    });
    if (levelLane && (levelConflict || tooClose(segs, walls))) {
      segs = under(p0, p3, walls, levelDepth, [8, 0]) || segs;
    }
    if (ln.spansRows || tooClose(segs, walls)) {
      const away = (p, box) => (Math.abs(p.y - box.y) < 0.5 ? -1 : 1);
      const clearWalls = walls.map(o => {
        const pad = o.pad ?? ROUTE_CLEARANCE;
        return {
          ...o, x: o.x - pad, y: o.y - pad, w: o.w + pad * 2, h: o.h + pad * 2,
          pad: o.id === targetLabel ? 0 : ROUTE_CORNER_CLEARANCE,
        };
      });
      let laneX = null;
      if (ln.spansRows && (lanePorts || !tooClose(segs, walls))) {
        const center = (boundsA.left + boundsA.right) / 2;
        const left = sx < center || (sx === center && ex < center);
        const between = clearWalls.filter(o => o.y + o.h > Math.min(p0.y, p3.y)
          && o.y < Math.max(p0.y, p3.y));
        laneX = left
          ? Math.min(boundsA.left, boundsB.left, ...between.map(o => o.x - (o.pad ?? ROUTE_CLEARANCE))) - ROUTE_CLEARANCE
          : Math.max(boundsA.right, boundsB.right, ...between.map(o => o.x + o.w + (o.pad ?? ROUTE_CLEARANCE))) + ROUTE_CLEARANCE;
        laneX += (left ? -1 : 1) * Math.max(ln.srcLaneOffset, ln.dstLaneOffset);
      }
      segs = detour(p0, away(p0, cardA), p3, away(p3, cardB), [...clearWalls, cardA, cardB],
        { start: ln.srcDepth, end: ln.dstDepth, laneX }) || segs;
    }
    if (levelLane) levelLanes.push(levelLane);
    ln.detoured = segs.length > 1;
    const same = normalize(segs);
    const shaft = trimArrowEnds(same, startOffset, endOffset);
    const d = segsPath(shaft);
    const dRev = segsPath([...shaft].reverse().map(q => [...q].reverse()));
    const mid = midpoint(shaft);

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
      segs: shaft,
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
      const groups = directionGroups(fwd, ln.from, ln.to);
      groups.push(...directionGroups(back, ln.to, ln.from));
      const cost = {
        key: `${ln.from}>${ln.to}`,
        x: mid.x, y: mid.y, text: String(total),
        cls: `cost${isHot || isLit ? ' lit' : ''}`,
        groups,
      };
      costs.push(cost);
    }
  }

  // Self loops, off the right side. Two kinds, and they do not mean the same
  // thing: a condition change is navigation, a no-change route is a dead
  // affordance.
  for (const id of loopIds) {
    const a = pos.get(id);
    if (!a) continue;
    const here = (within.get(id) || []).concat(noChange.get(id) || []);
    if (!here.length) continue;
    const x = a.x + (a.cdx || 0) + (a.cw || a.w);
    const y = a.y + (a.cdy || 0) + (a.ch || a.ih || a.h) * 0.4;
    const isLit = lit.has(id);
    const isHot = hot === `${id}>${id}`;
    const loop = [{ x, y: y - 14 }, { x: x + 34, y: y - 30 }, { x: x + 34, y: y + 30 }, { x, y: y + 14 }];
    const selfTip = { x, y: y + 14 };
    const ux = -34 / Math.hypot(34, 16);
    const uy = -16 / Math.hypot(34, 16);
    const selfShaft = trimArrowEnds(normalize([loop]), undefined, { x: -ux * 6, y: -uy * 6 });
    const dSelf = segsPath(selfShaft);
    const gcls = isHot ? 'lit hot' : isLit ? 'lit' : (sel ? 'dim' : '');
    paths.push({
      key: `${id}>${id}`,
      from: id, to: id, fromBox: boxOf(id), toBox: boxOf(id),
      selfLoop: true,
      d: dSelf, dRev: dSelf, gcls,
      head: headTo(selfTip, ux, uy),
      headCls: `head${isHot || isLit ? ' lit' : (sel ? ' dim' : '')}`,
      head2: 'M0 0', head2Cls: 'none',
      twoWay: false,
    });
    if (isLit) {
      anims.push({ d: dSelf, cls: `anim${isHot ? ' hot' : ''}` });
      tops.push({ d: headTo(selfTip, ux, uy), cls: `head top${isHot ? ' hot' : ''}` });
    }
    pulses.push({
      key: `${id}>${id}`,
      d: dSelf,
      segs: selfShaft,
      cls: `pulse${isHot || isLit ? ' lit' : (sel ? ' dim' : '')}`,
      delay: 0,
    });
    if (isHot || isLit || !sel) {
      // The two kinds get their own heading rather than a suffix per row: a
      // route that changes the screen's condition and an affordance that did
      // nothing are different facts, and grouping says so once.
      const changed = within.get(id) || [];
      const inert = noChange.get(id) || [];
      const groups = [];
      groups.push(...selfGroups(changed, 'changes this screen'));
      groups.push(...selfGroups(inert, 'changed nothing'));
      costs.push({
        key: `${id}>${id}`,
        x: x + 26, y, text: String(here.length),
        cls: `cost${isHot || isLit ? ' lit' : ''}`,
        groups,
        hit: { x: x - 12, y: y - 34, w: 50, h: 72 },
      });
    }
  }

  if (!lanePorts) {
    // Detours can reverse target order. Reuse the clear ports in lane order once.
    const lanes = new Map(pulses.map(p => [p.key, midpoint(p.segs).x]));
    const ordered = new Map();
    const turns = new Map();
    for (const [key, list] of slots) {
      if (!list.some(e => e.ln.detoured)) continue;
      const routeKey = e => `${e.ln.from}>${e.ln.to}`;
      const byLane = [...list].sort((a, b) => lanes.get(routeKey(a)) - lanes.get(routeKey(b))
        || a.ln[`${a.side}X`] - b.ln[`${b.side}X`]);
      const ports = list.map(e => e.ln[`${e.side}X`]).sort((a, b) => a - b);
      const assigned = new Map(byLane.map((e, i) => [routeKey(e), ports[i]]));
      if (!byLane.every((e, i) => e.ln[`${e.side}X`] === ports[i])) ordered.set(key, assigned);
      const depths = new Map();
      for (const direction of [-1, 1]) {
        const bending = list.filter(e => e.ln.detoured
          && (lanes.get(routeKey(e)) - assigned.get(routeKey(e))) * direction > 1)
          .sort((a, b) => direction * (assigned.get(routeKey(b)) - assigned.get(routeKey(a)))
            || routeKey(a).localeCompare(routeKey(b)));
        bending.forEach((e, i) => depths.set(routeKey(e), {
          depth: ROUTE_TURN_DEPTH + i * ROUTE_LANE_STEP,
          offset: (bending.length - i - 1) * ROUTE_LANE_STEP,
        }));
      }
      if (depths.size) turns.set(key, depths);
    }
    if (ordered.size || turns.size) return scene(model, rows, geo,
      { sel, hot, hover, drawnAs, names, anchorOf, stateAnchorOf }, ordered, turns);
  }
  return {
    paths, pulses, tops, costs,
    anims: anims.map((q, i) => ({ ...q, id: `rv${i}`, mask: `url(#rv${i})` })),
    within, noChange, pairs,
  };
}
