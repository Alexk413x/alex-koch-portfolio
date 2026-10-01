/* The map scene: tiers, layout and every drawn route, ported from
   docs/report-design/gen-map.py.

   This is a PORT of that artboard's `tiers`, `layout` and route builder. The
   geometry, the constants and the class names are the canvas's; what changed is
   only the data it reads -- a cartographer baseline instead of the sample file.

   It returns the same shapes the artboard's markup consumes: `paths`, `pulses`,
   `anims`, `tops`, `costs`, `boxes` and `dividers`. */

export const BOX_W = 92;
export const BOX_W_L = 150;
export const GAP_X = 56;
export const GAP_Y = 200;
export const EXT_H = 96;
const CORNER_PAD = 10;

/* An arrowhead whose apex is at p, pointing along the unit direction. */
function headTo(p, ux, uy) {
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
function screenRoutes(model) {
  const out = new Map();
  const within = new Map();
  const noChange = new Map();
  for (const e of model.edges) {
    const from = e.srcRendition && e.srcRendition.screen;
    const to = e.dstRendition && e.dstRendition.screen;
    if (!from || !to) continue;
    if (from === to) {
      const bucket = e.isSelf ? noChange : within;
      if (!bucket.has(from.id)) bucket.set(from.id, []);
      bucket.get(from.id).push(e);
      continue;
    }
    const key = `${from.id}>${to.id}`;
    if (!out.has(key)) out.set(key, { from: from.id, to: to.id, edges: [] });
    out.get(key).edges.push(e);
  }
  return { pairs: out, within, noChange };
}

/* Tiers by hops from the launch screen, so a screen sits below the screen that
   reaches it. Rows are then ordered by where their parents sit in the row
   above, so routes fan out without crossing.

   Screens outside the app take no tier. They form one band above the launch
   row, and a route through them does not deepen an app screen: an app screen
   the launcher opens is an entry point, so it starts at depth 0. */
export function tiers(model) {
  const start = launchScreen(model);
  const { pairs } = screenRoutes(model);
  const outOf = new Map(model.screens.map(s => [s.id, []]));
  const inTo = new Map(model.screens.map(s => [s.id, []]));
  for (const p of pairs.values()) {
    outOf.get(p.from).push(p.to);
    inTo.get(p.to).push(p.from);
  }
  const outside = new Set(model.externalScreens.map(s => s.id));

  const depth = new Map();
  const queue = [];
  const enter = (id) => {
    if (depth.has(id) || outside.has(id)) return;
    depth.set(id, 0);
    queue.push(id);
  };
  if (start) enter(start.id);
  for (const id of outside) for (const to of outOf.get(id)) enter(to);
  while (queue.length) {
    const id = queue.shift();
    for (const to of outOf.get(id) || []) {
      if (!depth.has(to) && !outside.has(to)) { depth.set(to, depth.get(id) + 1); queue.push(to); }
    }
  }
  // A screen no forward route reaches sits just above the shallowest screen it
  // feeds, rather than at the top as if it were an entry point.
  for (const s of model.appScreens) {
    if (depth.has(s.id)) continue;
    const feeds = (outOf.get(s.id) || []).map(id => depth.get(id)).filter(d => d !== undefined);
    depth.set(s.id, feeds.length ? Math.max(0, Math.min(...feeds) - 1) : Infinity);
  }
  const finite = [...depth.values()].filter(Number.isFinite);
  const deepest = finite.length ? Math.max(...finite) : 0;
  for (const [id, d] of depth) if (d === Infinity) depth.set(id, deepest + 1);

  const rows = new Map();
  for (const s of model.appScreens) {
    const d = depth.get(s.id);
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d).push(s.id);
  }
  const isolated = new Set(model.appScreens
    .filter(s => !(inTo.get(s.id) || []).length && !(outOf.get(s.id) || []).length)
    .map(s => s.id));

  const out = [...rows.entries()].sort((a, b) => a[0] - b[0])
    .map(([d, ids]) => ({ d, ids: ids.sort(), isolated: ids.every(id => isolated.has(id)) }));

  for (let i = 1; i < out.length; i += 1) {
    const above = out[i - 1].ids;
    const key = (id) => {
      const ps = (inTo.get(id) || []).map(from => above.indexOf(from)).filter(k => k >= 0);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
    };
    out[i].ids.sort((a, b) => key(a) - key(b) || a.localeCompare(b));
  }
  if (outside.size) out.unshift({ d: -1, ids: [...outside].sort(), isolated: false, external: true });
  return out;
}

/* Where every box sits, and the dividers: one above a tier nothing reaches,
   and one under the band of screens outside the app. A box outside the app is
   a short card, since it holds a name, unless `tallExternal` says a run's
   capture of it is shown. */
export function layout(rows, orient = 'portrait', { tallExternal = false } = {}) {
  const land = orient === 'landscape';
  const w = land ? BOX_W_L : BOX_W;
  const ih = land ? Math.round(w * 233 / 520) : Math.round(w * 520 / 233);
  const h = ih;
  const pos = new Map();
  const dividers = [];
  let y = 40;
  let worldW = 0;

  for (const row of rows) {
    const rowW = row.ids.length * w + (row.ids.length - 1) * GAP_X;
    const short = row.external && !tallExternal;
    const rh = short ? EXT_H : h;
    worldW = Math.max(worldW, rowW + 80);
    if (row.isolated) dividers.push({ y: y - GAP_Y / 2, text: 'no route to or from the screens above' });
    row.y = y;
    row.w = rowW;
    row.ids.forEach((id, i) => pos.set(id, { x: i * (w + GAP_X), y, w, h: rh, ih: short ? 0 : ih, external: Boolean(row.external) }));
    if (row.external) dividers.push({ y: y + rh + GAP_Y / 2, text: 'outside the app', over: true });
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
function routeOf(e) {
  const steps = e.steps.length
    ? e.steps.map(st => ({ action: st.action_id || st.verb || e.action || '?', target: st.target || '' }))
    : [{ action: e.action || '(no action)', target: '' }];
  return { name: e.action || '(no action)', ms: e.timed ? e.measured_ms : null, steps };
}

/* Every drawn thing for one frame, given what is selected and what is hot. */
export function scene(model, rows, geo, { sel = null, hot = null, hover = null } = {}) {
  const { pos } = geo;
  const { pairs, within, noChange } = screenRoutes(model);
  const paths = [];
  const costs = [];
  const anims = [];
  const tops = [];
  const pulses = [];

  const focus = hover || sel;
  const lit = new Set();
  if (focus) {
    for (const p of pairs.values()) {
      if (p.from === focus || p.to === focus) lit.add(`${p.from}>${p.to}`);
    }
    if (within.has(focus) || noChange.has(focus)) lit.add(focus);
  }

  const tierOf = new Map();
  rows.forEach((row, i) => row.ids.forEach(id => tierOf.set(id, i)));

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
    const id = k.split(':')[0];
    const box = pos.get(id);
    if (!box) continue;
    list.sort((p, q) => (pos.get(p.other).x - pos.get(q.other).x) || p.other.localeCompare(q.other));
    const span = box.w - CORNER_PAD * 2;
    list.forEach((e, i) => {
      e.ln[`${e.side}X`] = box.x + CORNER_PAD + (list.length === 1 ? span / 2 : span * i / (list.length - 1));
    });
  }

  // Pass two: geometry.
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

    const d = `M${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
    const dRev = `M${p3.x} ${p3.y} C ${p2.x} ${p2.y}, ${p1.x} ${p1.y}, ${p0.x} ${p0.y}`;
    const mid = bez(p0, p1, p2, p3, 0.5);

    paths.push({
      // The key is what every later class toggle addresses this line by.
      key: `${ln.from}>${ln.to}`,
      from: ln.from, to: ln.to,
      d, dRev, gcls, head: endHead, headCls,
      head2: ln.rev ? startHead : 'M0 0',
      head2Cls: ln.rev ? `${headCls} start` : 'none',
      twoWay: Boolean(ln.rev),
    });
    // A pulse travels the line in the flow's own direction, forward as drawn.
    pulses.push({
      key: `${ln.from}>${ln.to}`,
      d,
      pts: [p0, p1, p2, p3],
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
      const groups = [{ head: `${ln.from} → ${ln.to}`, routes: fwd.map(routeOf) }];
      if (back.length) groups.push({ head: `${ln.to} → ${ln.from}`, routes: back.map(routeOf) });
      costs.push({
        key: `${ln.from}>${ln.to}`,
        x: mid.x, y: mid.y, text: String(total),
        cls: `cost${isHot || isLit ? ' lit' : ''}`,
        groups,
      });
    }
  }

  // Self loops, off the right side. Two kinds, and they do not mean the same
  // thing: a condition change is navigation, a no-change route is a dead
  // affordance.
  for (const s of model.screens) {
    const a = pos.get(s.id);
    if (!a) continue;
    const here = (within.get(s.id) || []).concat(noChange.get(s.id) || []);
    if (!here.length) continue;
    const x = a.x + a.w;
    const y = a.y + a.h * 0.4;
    const isLit = lit.has(s.id);
    const isHot = hot === `${s.id}>${s.id}`;
    const dSelf = `M${x} ${y - 14} C ${x + 34} ${y - 30}, ${x + 34} ${y + 30}, ${x} ${y + 14}`;
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
      pts: [{ x, y: y - 14 }, { x: x + 34, y: y - 30 }, { x: x + 34, y: y + 30 }, { x, y: y + 14 }],
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
