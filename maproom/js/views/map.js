/* The map, built as docs/report-design/Main.dc.html builds it.

   The world is built ONCE and then only reclassed. That is not an optimisation
   detail, it is what makes the design work: `.box::after` sweeps its border
   over 300ms and `[data-press]::before` washes from the pointer's entry point,
   and a node replaced on every pointer move is gone before either transition
   can run.

   So `build()` creates the nodes and `paint()` sets classes. The one exception
   is the lit accent layer: those paths are created on selection precisely so
   their mask reveal plays, and there are only ever a handful.

   Highlight rules, from the canvas:
     - selection lights its own routes and DIMS the others; boxes are untouched
     - `hot` is the single route under the pointer. A drawer row sets it and
       also hands the far screen `hov`; a cost chip sets it with no screen
     - `dim` on a BOX comes only from search, never from selection */

import { el, svgEl, setChildren } from '../util/dom.js';
import { icon, platformIcon, phoneIcon } from '../util/icons.js';
import { href, param } from '../page.js';
import { tiers, layout, scene, routeOf, boxDims, mapRows, launchOrigin, OUTSIDE, EXT_H } from '../graph/scene.js';
import { nodeLayout, anchorRects, anchorOf, solidRects, labelRects } from '../graph/frame.js';
import { flow } from '../graph/flow.js';
import { platformOf, variants, screenCapture, hasOrientation, captureIndex } from '../data/sources.js';
import { variantStrip, stateLabel } from './variants.js';
import { shotInfo, setShotInfo, shotFocus, shotLabel } from './shotinfo.js';
import { MODES, modeOf } from '../data/modes.js';
import { ALIGN, pairAlign } from '../data/runmap.js';
import { displayChildren, inheritedCopies, treeDiff, stackVariants, variedFrom } from '../data/substates.js';

/* A fold. One whose count is zero is flat: a plain number, no chevron, and it
   does not open. Counts are bare numbers, never "1 · sample" or "none". */
function fold(label, count, build, open = false) {
  const chev = icon('chevron', 12);
  const head = el('div', { class: 'fold-h' }, chev, label,
    el('span', { class: 'n', text: String(count) }));
  if (!count) return el('div', { class: 'fold flat' }, head);

  const body = el('div', { class: 'fold-b' });
  let built = false;
  const set = (on) => {
    if (on && !built) { body.append(...build()); built = true; }
    body.hidden = !on;
    chev.style.transform = on ? 'rotate(90deg)' : '';
  };
  head.addEventListener('click', () => set(body.hidden));
  set(open);
  return el('div', { class: 'fold' }, head, body);
}

/* The rows inside a cost chip's popup.

   One row per STEP: the action the driver ran, the element it acted on, and
   what the route cost. Time belongs to the route, so a route with several steps
   prints it once on its first row and marks the rest as continuations -- the
   left rule is what says those rows are one route, not three.

   `POP_MAX` bounds a pair that carries an unreasonable number of routes. The
   drawer lists every one of them, so nothing is only reachable here. */
const POP_MAX = 8;

const REFLOW_MS = 300;

function popRows(groups) {
  const out = [];
  for (const g of groups || []) {
    out.push(el('div', { class: 'pl h', text: g.head }));
    const shown = g.routes.slice(0, POP_MAX);
    for (const r of shown) {
      const many = r.steps.length > 1;
      r.steps.forEach((st, i) => {
        out.push(el('div', { class: `pr${many ? ' grp' : ''}${i ? ' cont' : ''}`, 'data-src': r.src, 'data-dst': r.dst, 'data-action': r.name },
          el('span', { class: 'pa', text: st.action }),
          el('span', { class: 'pt', text: st.target || '—' }),
          el('span', { class: 'pm', text: i ? '' : (r.ms == null ? 'untimed' : `${r.ms} ms`) })));
      });
    }
    const rest = g.routes.length - shown.length;
    if (rest > 0) out.push(el('div', { class: 'pl m', text: `+${rest} more` }));
  }
  return out;
}

function runCard(state, run) {
  const view = run.view;
  const basis = view.basis || {};
  const aligned = view.alignment;
  const v = view.verdicts || {};
  const line = (label, text, ink) => el('div', { class: 'rc-l' },
    el('b', { style: ink ? `--c: var(--${ink})` : null, text: label }), el('span', { text }));
  const kids = [
    el('div', { class: 'rc-h' },
      el('a', { href: href('runs.html', { id: run.id }), 'data-tip': 'Open its steps', text: `run ${run.id}` })),
    el('p', { class: `rc-note${['today', 'error', 'unbuilt'].includes(basis.kind) ? ' warn' : ''}`, text: basis.note || '' }),
  ];
  if (aligned) {
    for (const what of ['screens', 'states', 'edges']) {
      const c = aligned.counts[what] || {};
      kids.push(el('div', { class: 'rc-l' }, el('b', { text: what }),
        Object.keys(ALIGN).map(k => el('span', {
          class: 'rc-n', style: `--c: var(--${ALIGN[k].ink})`, 'data-tip': ALIGN[k].label,
        }, String(c[k] || 0), el('i', { text: ALIGN[k].label })))));
    }
  }
  if (v.replay) {
    const r = v.replay;
    const head = [r.test, r.appearance, r.orientation].filter(Boolean).join(' · ');
    kids.push(line('replay', `${head}: ${r.refused ? `refused, ${r.refused}` : r.passed ? 'passed' : `${r.failures.length} failed`}`,
      r.passed ? 'pass' : 'fail'));
    for (const f of r.failures.slice(0, 8)) {
      kids.push(el('div', { class: 'rc-f', text: `ord ${f.path_step}: ${f.why || 'no reason recorded'}` }));
    }
    const differs = r.captures.filter(c => c.verdict !== 'captured');
    if (differs.length) kids.push(line('captures', `${differs.length} not captured as stored`, 'warn'));
  }
  if (v.edge_test) {
    const e = v.edge_test;
    kids.push(line('edge test', `${e.verdict}${e.why ? `: ${e.why}` : ''}`, e.verdict === 'passed' ? 'pass' : 'fail'));
    kids.push(el('div', { class: 'rc-f', text: `${e.edge[0]} → ${e.edge[1]} by ${e.edge[2]}` }));
  }
  for (const c of v.cases || []) {
    kids.push(line(`case ${c.case}`, c.verdict + (c.broke_at != null ? ` at step ${c.broke_at}` : ''),
      c.verdict === 'pass' || c.verdict === 'passed' ? 'pass' : 'fail'));
  }
  const w = v.warnings || {};
  const kinds = Object.entries(w.kinds || {});
  if (kinds.length) kids.push(line('warnings', kinds.map(([k, n]) => `${n} ${k}`).join(' · '), 'warn'));
  if ((w.no_change || []).length) {
    kids.push(line('no_change', `${w.no_change.length} step${w.no_change.length === 1 ? '' : 's'} changed nothing`, 'warn'));
  }
  if ((v.refusals || []).length) {
    kids.push(line('refused', `${v.refusals.length} call${v.refusals.length === 1 ? '' : 's'} refused`, 'warn'));
  }
  return el('div', { class: 'card runcard' }, kids);
}

function openingTone(captures) {
  let dark = 0;
  let light = 0;
  for (const c of captures.values()) {
    for (const leaf of c.leaves) {
      if (leaf.shots.dark) dark += 1;
      if (leaf.shots.light) light += 1;
    }
  }
  return light > dark ? 'light' : 'dark';
}

export function renderMap(input) {
  const state = { ...input };
  const model = state.model;
  const run = state.run || null;
  const ranked = tiers(model);

  /* The modes this map actually has routes for. Hoisted above `ui` because the
     filter starts with every one of them on: the map opens showing everything,
     and turning a mode off is the question "what does this cost a user who
     cannot drive that way". */
  const driven = new Set(model.edges.map(modeOf).filter(Boolean));

  /* The platforms this survey holds profiles for, and the one being shown.

     Platform is a fact about the baseline, not a preference, so the toggle
     picks among what was actually captured: a platform with no profile is
     shown and marked off, the way an undriven mode is. It sits before
     orientation because it decides which handset the orientation pair draws. */
  // Keyed by the brand mark, which is what `platformIcon` returns. The filter
  // shows a logo; the orientation pair beside it shows that platform's handset.
  const PLATFORMS = [
    { value: 'android', label: 'Android' },
    { value: 'apple', label: 'iOS' },
    { value: 'chrome', label: 'Browser' },
  ];
  const havePlatform = new Set((state.manifest.profiles || [])
    .map(pr => platformIcon(platformOf(pr))).filter(v => v !== 'screen'));
  const ownPlatform = (() => {
    const p2 = platformIcon(platformOf(state.profile));
    return p2 === 'screen' ? ([...havePlatform][0] || 'android') : p2;
  })();
  /* Each platform's own profile and captures. A run's map holds one device's captures, so a
     run has only its own platform; a baseline has one profile per platform it was surveyed on. */
  const byPlatform = new Map([[ownPlatform, { profile: state.profile, captures: state.captures }]]);
  if (!run) {
    for (const pr of state.manifest.profiles || []) {
      const brand = platformIcon(platformOf(pr));
      if (brand === 'screen' || byPlatform.has(brand)) continue;
      byPlatform.set(brand, { profile: pr, captures: captureIndex(pr, `${state.source.url}baselines/${pr.key}/`) });
    }
  }

  // `hot` is `{ key, id }`: the route under the pointer, and the screen at its
  // far end when a drawer row is what set it.
  // `hover` is the box under the pointer and lights its routes the same way a
  // selection does. `hot` is one route, from a drawer row or a cost chip.
  // `modes` filters which routes are drawn at all: every driven mode is on, so
  // the map starts whole and the filter only ever subtracts.
  const ui = { sel: null, hover: null, hot: null, query: '', modes: new Set(driven), platform: ownPlatform, tone: openingTone(state.captures), orient: 'portrait', selAnchor: null, hoverAnchor: null, scale: 1, tx: 0, ty: 0 };
  /* Which orientations this baseline actually holds captures for.

     PORTRAIT stays selectable with no captures at all: it is what a reader
     sees on arrival, and marking it off left the toolbar showing no selection
     while the boxes said what was missing. */
  const cellsOf = new Map();
  const readCells = () => {
    cellsOf.clear();
    for (const r of model.renditions) cellsOf.set(r.id, variants(state.captures.get(r.id), state.profile));
  };
  readCells();
  const hasOrient = {
    portrait: true,
    landscape: [...byPlatform.values()].some(p => model.renditions.some(r => variants(p.captures.get(r.id), p.profile)
      .some(c => c.url && c.orientation === 'landscape'))),
  };
  /* What the selected orientation holds. A state belongs to an orientation
     when it has a leaf there; a route belongs when both of its ends do. A
     screen outside the app has no captures by design, so its states count as
     present in every orientation. */
  const isExternal = r => Boolean(r.screen && r.screen.isExternal);
  const inOrient = r => Boolean(r)
    && (isExternal(r) || hasOrientation(state.captures.get(r.id), ui.orient));
  /* A state belongs to a tone when it has a capture in it. The tone, like the orientation and
     the platform, removes the states it leaves out and the routes that touch them. */
  const inScope = r => inOrient(r) && (isExternal(r) || Boolean(shotOf(r)));
  const allKids = displayChildren(model);
  const copies = inheritedCopies(model);
  const modeKept = (e) => {
    const m = modeOf(e);
    return !m || ui.modes.has(m);
  };
  function orientedView() {
    const oriented = model.edges.filter(e => !copies.has(e)
      && inScope(e.srcRendition) && inScope(e.dstRendition));
    const edges = oriented.filter(modeKept);
    return {
      oriented,
      inOrient: model.appRenditions.filter(inOrient),
      states: model.appRenditions.filter(inScope),
      edges,
      edgeSet: new Set(edges),
      statesOf: new Map(model.screens.map(s => [s.id, s.renditions.filter(inScope)])),
      kids: new Map([...allKids].map(([id, list]) => [id, list.filter(k => inScope(k.state))])
        .filter(([, list]) => list.length)),
      model: { ...model, edges },
    };
  }
  let view = orientedView();
  const kidsOf = id => (id === OUTSIDE ? outsideKids : view.kids.get(id) || []);

  /* Which screens are expanded. `?open=a,b` names them for one load; otherwise this viewer's
     last choice, which the page never needs to draw. */
  const openKey = `maproom.open:${param('src')}${run ? `:run:${run.id}` : ''}`;
  function initialOpen() {
    const asked = param('open');
    if (asked) return asked.split(',').filter(Boolean);
    try {
      const kept = JSON.parse(localStorage.getItem(openKey) || '[]');
      return Array.isArray(kept) ? kept.map(String) : [];
    } catch {
      return [];
    }
  }
  function saveOpen() {
    try {
      localStorage.setItem(openKey, JSON.stringify([...ui.open]));
    } catch {
      // Blocked storage keeps the choice for this load only.
    }
  }
  ui.open = new Set(initialOpen());

  const frames = new Map();
  const settingsByState = new Map();
  for (const r of model.settingStates || []) {
    if (!r.state) continue;
    if (!settingsByState.has(r.state)) settingsByState.set(r.state, []);
    settingsByState.get(r.state).push(r.setting_id);
  }
  function itemsOf(id) {
    const kids = kidsOf(id);
    if (id === OUTSIDE) return kids.map(k => ({ ...k, members: [k] }));
    return stackVariants(kids, {
      kidsOfScreen: sid => view.kids.get(sid) || [],
      settingsOf: sid => settingsByState.get(sid) || [],
    });
  }
  const memberStates = it => new Set(it.members.map(m => m.state.id));
  function withFlows(spec) {
    const kids = spec.children || [];
    const groupOf = (sid) => {
      if (!spec.states.has(sid)) return undefined;
      const k = kids.find(c => c.states.has(sid));
      return k ? k.id : null;
    };
    const own = [...spec.states].some(sid => groupOf(sid) === null);
    spec.flows = [];
    for (const e of view.edges) {
      const a = groupOf(e.src);
      const b = groupOf(e.dst);
      if (a === undefined || b === undefined) continue;
      if (a === b && (own || a === null || e.src === e.dst)) continue;
      spec.flows.push(a === b ? { from: null, to: a, edges: [e] } : { from: a, to: b, edges: [e] });
    }
    return spec;
  }
  function itemSpec(box, it) {
    const { w, ih } = boxDims(ui.orient);
    return {
      id: `${box}/${it.state.id}`, item: it, cardW: w, cardH: ih, open: false, states: memberStates(it), children: [],
      layers: Math.min(it.members.length - 1, 3),
    };
  }
  const baseStates = new Set((model.settingStates || []).filter(r => Number(r.original) === 1 && r.state).map(r => r.state));
  /* The states under a screen's card, its base state first. */
  function ownOf(id) {
    const s = model.byScreen.get(id);
    if (!s) return { lead: null, members: [] };
    const drawn = new Set(itemsOf(id).flatMap(it => it.members.map(m => m.state.id)));
    const values = new Map(kidsOf(id).filter(k => variedFrom(k) && !drawn.has(k.state.id)).map(k => [k.state.id, k]));
    const kid = r => values.get(r.id) || {
      kind: 'display', role: 'state', label: r.name, value: '', name: r.name || r.id, state: r, base: null, parent: null,
    };
    const rank = r => (values.has(r.id) ? 2 : baseStates.has(r.id) ? 0 : 1);
    const members = view.statesOf.get(id).filter(r => !drawn.has(r.id)).sort((x, y) => rank(x) - rank(y)).map(kid);
    return { lead: members[0] || null, members };
  }
  function boxSpec(id) {
    const items = itemsOf(id);
    if (!items.length) return null;
    const { w, ih } = boxDims(ui.orient);
    const states = new Set(id === OUTSIDE
      ? outside.flatMap(x => x.renditions.map(r => r.id))
      : model.renditions.filter(r => r.screen && drawnId(r.screen.id) === id).map(r => r.id));
    const rowOpen = items.length > 0 && ui.open.has(id);
    const spec = {
      id, cardW: w, cardH: id === OUTSIDE && !groupTall(ui.orient) ? EXT_H : ih, caption: true,
      open: rowOpen, states, count: items.length, children: rowOpen ? items.map(it => itemSpec(id, it)) : [],
    };
    return rowOpen && id !== OUTSIDE ? withFlows(spec) : spec;
  }
  function frameSizes() {
    frames.clear();
    for (const id of rows.flatMap(r => r.ids)) {
      const spec = boxSpec(id);
      if (spec) frames.set(id, nodeLayout(spec));
    }
    return frames;
  }
  function relayout(orient) {
    const g = layout(rows, orient, { tallExternal: tallExternal(orient), frames: frameSizes() });
    g.anchors = new Map();
    g.solids = [];
    for (const [id, f] of frames) {
      const box = g.pos.get(id);
      if (!box) continue;
      for (const [aid, r] of anchorRects(f, box.x, box.y)) g.anchors.set(aid, { ...r, box: id });
      if (f.frame) g.solids.push(...solidRects(f, box.x, box.y), ...labelRects(f, box.x, box.y));
    }
    return g;
  }
  function anchorFor(r) {
    if (!r || !r.screen) return null;
    const box = drawnId(r.screen.id);
    const f = frames.get(box);
    return f ? anchorOf(f, r.id) : box;
  }
  const edgeKey = e => `${anchorFor(e.srcRendition)}>${anchorFor(e.dstRendition)}`;

  const substatesText = n => `${n} ${n === 1 ? 'substate' : 'substates'}`;
  const rowCards = id => itemsOf(id).length;
  /* A screen's states: its own that no substate card draws, and the setting values of the layers
     drawn over it (the choices of its dialog), the way `map_stats` counts them. */
  const valueRows = new Map((model.displays || []).filter(d => d.parent).map(d => [d.state, d]));
  const valueSet = new Set((model.settingStates || []).filter(r => Number(r.original) !== 1 && r.state).map(r => r.state));
  const isValue = r => {
    const row = valueRows.get(r.id);
    return Boolean(row) && (row.kind === 'setting' || (!row.kind && valueSet.has(r.id)));
  };
  const layerValues = id => view.states.filter(r => r.screen && r.screen.id !== id && drawnId(r.screen.id) === id && isValue(r));
  const statesOfScreen = id => [...ownOf(id).members.map(m => m.state), ...layerValues(id)];
  const standsFor = id => statesOfScreen(id).length;
  /* A card's picture carries its name and state count (`shotInfo`), so a box has no hover title but
     a run's verdict on it. The group outside the app counts the states of the screens it holds. */
  const boxTitle = (id) => {
    const s = model.byScreen.get(id) || null;
    return run && s && s.align ? ALIGN[s.align].label : '';
  };
  const shotCount = id => (id === OUTSIDE ? outside.reduce((n, x) => n + x.renditions.length, 0) : standsFor(id));

  /* A run's own capture of a screen outside the app stands in when the baseline holds no leaf
     of it (PROMO-56): the run view's, or the newest run's from the manifest. */
  const fromRuns = (state.manifest && state.manifest.external_captures) || {};
  function externalShot(s, orient, tone) {
    if (run) {
      const pic = screenCapture(state, s, orient, tone);
      return pic.url ? { url: pic.url, run: run.id } : null;
    }
    const c = fromRuns[s.id];
    if (!c || (c.orientation || 'portrait') !== orient) return null;
    if (c.appearance && c.appearance !== tone) return null;
    return { url: state.source.url + c.screen, run: c.run };
  }
  const tallExternal = orient => model.externalScreens.some(s => ['dark', 'light']
    .some(t => ownShot(s, orient, t)));

  function ownShot(s, orient, tone) {
    const pic = screenCapture(state, s, orient, tone);
    return pic.url ? { url: pic.url } : externalShot(s, orient, tone);
  }
  const touched = new Set(model.edges.flatMap(e => [e.srcRendition, e.dstRendition])
    .filter(r => r && r.screen).map(r => r.screen.id));
  const captured = s => s.renditions.some(r => (state.captures.get(r.id) || { leaves: [] }).leaves.length)
    || Boolean(fromRuns[s.id]);
  const outside = model.externalScreens.filter(s => touched.has(s.id) || captured(s));
  const origin = model.byScreen.get(launchOrigin(model));
  const launcher = (origin && outside.includes(origin) && captured(origin) ? origin : null)
    || outside.find(captured) || null;
  function extShot(s, orient, tone) {
    const own = ownShot(s, orient, tone);
    if (own) return own;
    const stand = launcher && launcher !== s ? ownShot(launcher, orient, tone) : null;
    return stand ? { ...stand, launcher: launcher.name || launcher.id } : null;
  }
  const groupTall = orient => ['dark', 'light'].some(t => outside.some(s => extShot(s, orient, t)));
  const outsideKids = outside.map(s => ({
    kind: 'external', role: 'external', external: s, name: s.name || s.id,
    state: s.renditions[0] || { id: s.id, screen: s }, parent: null, base: null,
  }));
  const { rows, drawnAs } = mapRows(model, ranked, { grouped: outside.length > 0 });
  const drawnId = id => (id && drawnAs.get(id)) || id;
  const names = new Map([[OUTSIDE, 'Outside the app'], ...model.screens.map(s => [s.id, s.name || s.id])]);
  let geo = relayout(ui.orient);
  let sc = scene(view.model, rows, geo, { drawnAs, names, anchorOf: anchorFor });

  const stackLayer = el('div', { class: 'stacks', 'aria-hidden': 'true' });
  const routes = svgEl('svg', { class: 'routes', 'aria-hidden': 'true' });
  const litLayer = svgEl('g', { class: 'litlayer' });
  const pulseCanvas = el('canvas', { class: 'flow', 'aria-hidden': 'true' });
  const frameCanvas = el('canvas', { class: 'flow', 'aria-hidden': 'true' });
  const world = el('div', { class: 'world' }, routes);
  const stage = el('div', { class: 'stage' }, world);
  const insp = el('aside', { class: 'insp' });
  const main = el('div', { class: 'main' }, stage);
  const zoomLabel = el('span', { class: 'ro', text: '100%' });
  const mini = el('div', { class: 'mini' });

  const groups = new Map();   // route key -> <g>
  const boxes = new Map();    // screen id -> .box
  const stacks = new Map();   // screen id -> .bstack
  const chips = new Map();    // route key -> .cost
  const kidCards = new Map(); // screen id -> the display state cards in its frame
  let dividerNodes = [];
  let pulse = null;
  let framePulse = null;
  const accent = new Map();   // route key -> its accent path, heads and reveal
  // What `paint` last lit, so a hover can touch the delta instead of every node.
  let litNow = new Set();

  /* Route keys the mode filter allows through.

     A route whose `requires` names no mode works in any configuration, so it
     stays visible under every filter -- it is usable there even though it is
     credited to no mode and is not evidence ABOUT one. */
  function visibleKeys() {
    if (ui.modes.size === driven.size) return null;
    const ok = new Set();
    for (const e of view.edges) {
      const m = modeOf(e);
      if (m && !ui.modes.has(m)) continue;
      const from = e.srcRendition && e.srcRendition.screen;
      const to = e.dstRendition && e.dstRendition.screen;
      if (!from || !to) continue;
      const [a, b] = edgeKey(e).split('>');
      ok.add(`${a}>${b}`);
      ok.add(`${b}>${a}`);
    }
    return ok;
  }

  function routeAlign(a, b) {
    return pairAlign(view.edges.filter(e => {
      const from = e.srcRendition && e.srcRendition.screen;
      const to = e.dstRendition && e.dstRendition.screen;
      if (!from || !to) return false;
      const key = edgeKey(e);
      return key === `${a}>${b}` || key === `${b}>${a}`;
    }));
  }

  let routeSeq = 0;

  /* The accent nodes exist for every route and stay hidden until it is lit: creating them on each
     hover cost ~80 SVG nodes. */
  function routeNodes(p) {
    const g = svgEl('g', run ? { 'data-route': p.key, 'data-al': routeAlign(p.from, p.to) || '' } : { 'data-route': p.key },
      svgEl('path', { d: p.d }),
      svgEl('path', { d: p.head, class: 'head' }),
      svgEl('path', { d: p.head2, class: p.head2 === 'M0 0' ? 'none' : 'head start' }));
    const id = `rv${routeSeq}`;
    routeSeq += 1;
    const reveal = svgEl('path', { d: p.d, class: 'reveal', pathLength: 1 });
    const mask = svgEl('mask', {
      id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: geo.worldW, height: geo.worldH,
    }, reveal);
    const anim = svgEl('path', { d: p.d, class: 'anim', mask: `url(#${id})` });
    const head = svgEl('path', { d: p.head, class: 'head top' });
    const head2 = p.twoWay ? svgEl('path', { d: p.head2, class: 'head top' }) : null;
    const a = { mask, reveal, anim, head, head2, path: p, shown: false };
    hideAccent(a);
    return { g, a, lit: [mask, anim, head, head2].filter(Boolean) };
  }

  function chipOf(c) {
    const chip = el('div', {
      class: 'cost',
      style: `left:${c.x}px; top:${c.y}px`,
    }, c.text, el('div', { class: 'pop' }, popRows(c.groups)));
    chip.key = c.key;
    // A chip sets `hot` with no screen: nothing gets the `hov` border sweep.
    chip.addEventListener('pointerenter', () => setHot({ key: chip.key, id: null }));
    chip.addEventListener('pointerleave', () => setHot(null));
    return chip;
  }

  /* The moving dots of every arrow inside an open frame, in world coordinates. They sit on a
     canvas above the boxes, because a box paints over the canvas the map's own routes use. */
  function framePulses() {
    const out = [];
    const walk = (box, n, ox, oy) => {
      if (!n.frame) return;
      const move = seg => seg.map(q => ({ x: q.x + ox, y: q.y + oy }));
      for (const a of n.arrows) out.push({ key: markKey(box, n, 'a', a), segs: a.segs.map(move) });
      for (const k of n.children) walk(box, k, ox + k.x, oy + k.y);
    };
    for (const [box, f] of frames) {
      const at = geo.pos.get(box);
      if (at) walk(box, f, at.x, at.y);
    }
    return out.map((u, i) => ({ ...u, delay: -((i * 0.37) % 2.6) }));
  }
  const markKey = (box, n, kind, a) => `${box}|${n.id}|${kind}|${a.id}`;

  function startFlows() {
    if (pulse) pulse.stop();
    if (framePulse) framePulse.stop();
    pulse = flow(pulseCanvas, sc.pulses);
    framePulse = flow(frameCanvas, framePulses());
  }

  /* Create every node once, from a scene computed with nothing selected. */
  function build() {
    sc = scene(view.model, rows, geo, { drawnAs, names, anchorOf: anchorFor });
    groups.clear();
    boxes.clear();
    stacks.clear();
    chips.clear();
    kidCards.clear();

    routes.setAttribute('width', geo.worldW);
    routes.setAttribute('height', geo.worldH);
    routes.setAttribute('viewBox', `0 0 ${geo.worldW} ${geo.worldH}`);

    const svgKids = [];
    const litKids = [];
    accent.clear();
    for (const p of sc.paths) {
      const { g, a, lit } = routeNodes(p);
      groups.set(p.key, g);
      accent.set(p.key, a);
      svgKids.push(g);
      litKids.push(...lit);
    }
    startFlows();
    setChildren(litLayer, litKids);
    svgKids.push(litLayer);
    setChildren(routes, svgKids);

    const overlay = [];
    dividerNodes = geo.dividers.map(dv => el('div', {
      class: dv.over ? 'divider over' : 'divider',
      style: `left:${dv.x}px; top:${dv.y}px; width:${dv.w}px`,
      text: dv.text,
    }));
    overlay.push(...dividerNodes);
    const stackKids = [];
    for (const id of rows.flatMap(r => r.ids)) {
      const s = model.byScreen.get(id) || null;
      if (!geo.pos.get(id)) continue;
      const stacked = id === OUTSIDE ? outside.length : standsFor(id);
      // The farther card comes first so the nearer one paints over it.
      if (!(s && s.isExternal) && stacked >= 2) {
        const stack = el('div', { class: 'bstack', 'data-for': id },
          stacked >= 4 ? el('i', { class: 's3' }) : null, stacked >= 3 ? el('i', { class: 's2' }) : null, el('i', { class: 's1' }));
        stacks.set(id, stack);
        stackKids.push(stack);
      }
      const name = names.get(id) || id;
      const node = el('div', {
        class: `${s && s.isExternal ? 'box ext' : 'box'}${frames.has(id) ? ' stacked' : ''}${id === OUTSIDE ? ' outside' : ''}${run && s && s.align ? ` al-${s.align}` : ''}`,
        'data-screen': id,
      });
      if (boxTitle(id)) node.title = boxTitle(id);
      if (!(s && s.isExternal)) {
        node.face = el('div', { class: 'bface' });
        shotFocus(node.face, shotLabel(name, shotCount(id)), () => { if (s) select(ui.sel === id ? null : id); });
        node.info = shotInfo(name, shotCount(id));
        node.append(node.face, node.info);
        if (itemsOf(id).length) {
          node.cap = el('button', {
            class: 'scap',
            type: 'button',
            'aria-label': `${substatesText(rowCards(id))} of ${name}`,
            text: substatesText(rowCards(id)),
          });
          node.cap.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleOpen(id);
          });
          node.append(node.cap);
        }
      }
      node.addEventListener('click', (e) => {
        if (frames.has(id) && !e.target.closest('.bface')) return;
        if (s) select(ui.sel === id ? null : id);
      });
      node.addEventListener('pointerenter', () => { ui.hover = id; paint(); });
      node.addEventListener('pointerleave', () => { ui.hover = null; paint(); });
      boxes.set(id, node);
      overlay.push(node);
      placeBox(id);
    }
    for (const c of sc.costs) {
      const chip = chipOf(c);
      chips.set(c.key, chip);
      overlay.push(chip);
    }
    setChildren(stackLayer, stackKids);
    setChildren(world, stackLayer, routes, pulseCanvas, overlay, frameCanvas);
    paintCaptures();
    paintKids();
    // The nodes are new, so every route is repainted, including any the mode filter hides.
    paint.lastMode = null;
    paint();
  }

  function paintGroup() {
    const node = boxes.get(OUTSIDE);
    const f = frames.get(OUTSIDE);
    if (!node || !f) return;
    const shot = [launcher, ...outside].filter(Boolean).map(x => extShot(x, ui.orient, ui.tone)).find(Boolean);
    setChildren(node.face, shot && f.card.h > EXT_H
      ? el('img', { class: 'bi', src: shot.url, alt: '', loading: 'lazy' })
      : el('div', { class: 'bx', style: `height:${f.card.h}px` }));
  }

  /* A screen's picture is its base state's. */
  function paintFace(s, node) {
    // No fallback to the other tone. A dark screenshot shown while the
    // toolbar says light is the viewer inventing evidence.
    const pic = screenCapture(state, s, ui.orient, ui.tone, (ownOf(s.id).lead || { state: {} }).state.id);
    setChildren(node.face, pic.url
      ? el('img', { class: 'bi', src: pic.url, alt: '', loading: 'lazy' })
      : el('div', { class: 'bn', text: pic.missing }));
  }

  /* The capture inside each box, swapped when the tone changes. A screen
     outside the app has no capture to swap: its box names the package. */
  function paintCaptures() {
    paintGroup();
    for (const s of model.screens) {
      const node = boxes.get(s.id);
      const box = geo.pos.get(s.id);
      if (!node || !box) continue;
      if (s.isExternal) {
        const shot = box.ih ? ownShot(s, ui.orient, ui.tone) : null;
        setChildren(node, shot
          ? el('img', { class: 'bi', src: shot.url, alt: '', style: `height:${box.ih}px`, loading: 'lazy' })
          : el('div', { class: 'bx', style: `height:${box.h}px` },
            el('span', { class: 'bx-p', text: s.package })));
        continue;
      }
      paintFace(s, node);
      const title = boxTitle(s.id);
      if (title) node.title = title;
      else node.removeAttribute('title');
      setShotInfo(node.info, names.get(s.id) || s.id, standsFor(s.id));
      node.face.setAttribute('aria-label', shotLabel(names.get(s.id) || s.id, standsFor(s.id)));
    }
  }

  function placeBox(id, { animate = false } = {}) {
    const node = boxes.get(id);
    const box = geo.pos.get(id);
    if (!node || !box) return;
    node.style.left = `${box.x}px`;
    node.style.top = `${box.y}px`;
    node.style.width = `${box.w}px`;
    node.style.height = `${box.h}px`;
    const f = frames.get(id) || null;
    const card = f ? f.card : { x: 0, y: 0, w: box.w, h: box.ih || box.h };
    const stack = stacks.get(id);
    if (stack) {
      stack.setAttribute('style', `left:${box.x + card.x}px; top:${box.y + card.y}px; width:${card.w}px; height:${card.h}px`);
    }
    if (!node.face) return;
    node.face.setAttribute('style', `left:${card.x}px; top:${card.y}px; width:${card.w}px; height:${card.h}px`);
    if (node.info) node.info.setAttribute('style', `left:${card.x}px; top:${card.y}px; width:${card.w}px; height:${card.h}px`);
    const open = Boolean(f && f.frame);
    if (node.cap) {
      node.cap.setAttribute('style', `left:${f.caption.x}px; top:${f.caption.y}px; width:${f.caption.w}px; height:${f.caption.h}px`);
      node.cap.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    node.classList.toggle('open', open);
    const sig = n => [n.id, n.frame, n.w, n.h, n.x, n.y, n.children.map(sig)];
    const key = open ? JSON.stringify(sig(f)) : '';
    if (key === (node.rowKey || '')) return;
    node.rowKey = key;
    clearTimeout(node.closing);
    if (node.row) {
      const gone = node.row;
      gone.classList.remove('in');
      kidCards.delete(id);
      node.row = null;
      if (open) gone.remove();
      else node.closing = setTimeout(() => gone.remove(), animate ? REFLOW_MS : 0);
    }
    if (!open) return;
    const cards = [];
    const marks = [];
    node.row = el('div', { class: 'fgraph' }, frameInner(id, f, cards, marks));
    node.row.cards = cards;
    node.row.marks = marks;
    node.append(node.row);
    // A layout read commits the new layer at opacity 0, so `in` fades it in instead of
    // drawing it at once.
    if (animate) void node.row.offsetWidth;
    kidCards.set(id, cards);
    paintKids();
    paintFrames();
    node.row.classList.add('in');
  }

  function toggleOpen(id, anchor = id) {
    if (ui.open.has(id)) ui.open.delete(id);
    else ui.open.add(id);
    saveOpen();
    reflow(anchor);
  }

  /* A route whose end moved to another frame or card takes the node of the route whose edges it
     carries most of, so it morphs instead of fading out and in. */
  function syncRoutes(prev) {
    const next = new Map(sc.paths.map(p => [p.key, p]));
    const gone = [...groups.keys()].filter(k => !next.has(k));
    const born = [...next.keys()].filter(k => !groups.has(k));
    const edgesOf = (pairs, key) => {
      const [a, b] = key.split('>');
      return new Set([key, `${b}>${a}`].flatMap(k => (pairs.get(k) || { edges: [] }).edges));
    };
    const had = new Map(gone.map(k => [k, edgesOf(prev.pairs, k)]));
    const has = new Map(born.map(k => [k, edgesOf(sc.pairs, k)]));
    const ranked = [];
    for (const [g, old] of had) {
      for (const [b, now] of has) {
        const shared = [...old].filter(e => now.has(e)).length;
        if (shared) ranked.push([shared, g, b]);
      }
    }
    ranked.sort((x, y) => y[0] - x[0] || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2]));
    const moved = new Map();
    const taken = new Set();
    for (const [, g, b] of ranked) {
      if (moved.has(g) || taken.has(b)) continue;
      moved.set(g, b);
      taken.add(b);
    }
    for (const [from, to] of moved) {
      const g = groups.get(from);
      groups.delete(from);
      groups.set(to, g);
      g.setAttribute('data-route', to);
      accent.set(to, accent.get(from));
      accent.delete(from);
      const chip = chips.get(from);
      if (chip) {
        chips.delete(from);
        chips.set(to, chip);
        chip.key = to;
      }
    }
    for (const key of gone) {
      if (moved.has(key)) continue;
      const a = accent.get(key);
      for (const node of [a.mask, a.anim, a.head, a.head2]) if (node) node.remove();
      accent.delete(key);
      const leaving = [groups.get(key), chips.get(key)].filter(Boolean);
      groups.delete(key);
      chips.delete(key);
      for (const node of leaving) {
        node.style.pointerEvents = 'none';
        node.style.opacity = '0';
        setTimeout(() => node.remove(), REFLOW_MS);
      }
    }
    const entering = [];
    for (const key of born) {
      if (taken.has(key)) continue;
      const { g, a, lit } = routeNodes(next.get(key));
      g.style.opacity = '0';
      routes.insertBefore(g, litLayer);
      litLayer.append(...lit);
      groups.set(key, g);
      accent.set(key, a);
      entering.push(g);
    }
    return entering;
  }

  /* Lay the map out again around the frames now open and move every node to its new place.
     Under `.reflow` the boxes, chips, route paths and the world's transform share one
     transition, and the toggled screen's top centre stays where it was on the stage. */
  let reflowDone = 0;
  function reflow(anchor) {
    const selBefore = ui.sel ? selectedRect() : null;
    let before = cardRect(anchor);
    const prev = sc;
    geo = relayout(ui.orient);
    sc = scene(view.model, rows, geo, { drawnAs, names, anchorOf: anchorFor });
    const selAfter = selBefore ? selectedRect() : null;
    let after = cardRect(anchor);
    if (selBefore && selAfter) {
      before = selBefore;
      after = selAfter;
    }
    if (before && after) {
      ui.tx += ((before.x + before.w / 2) - (after.x + after.w / 2)) * ui.scale;
      ui.ty += (before.y - after.y) * ui.scale;
    }
    stage.classList.add('reflow');
    pulse.hold(true);
    framePulse.hold(true);
    const entering = syncRoutes(prev);

    routes.setAttribute('width', geo.worldW);
    routes.setAttribute('height', geo.worldH);
    routes.setAttribute('viewBox', `0 0 ${geo.worldW} ${geo.worldH}`);
    const focus = drawnId(ui.sel || ui.hover);
    for (const p of sc.paths) {
      const g = groups.get(p.key);
      const [line, head, head2] = g.children;
      line.setAttribute('d', p.d);
      head.setAttribute('d', p.head);
      head2.setAttribute('d', p.head2);
      head2.setAttribute('class', p.head2 === 'M0 0' ? 'none' : 'head start');
      if (run) g.setAttribute('data-al', routeAlign(p.from, p.to) || '');
      const a = accent.get(p.key);
      a.path = p;
      a.mask.setAttribute('width', geo.worldW);
      a.mask.setAttribute('height', geo.worldH);
      a.d = accentPath(a, focus);
      a.anim.setAttribute('d', a.d);
      a.reveal.setAttribute('d', a.d);
      a.head.setAttribute('d', p.head);
      if (a.head2) a.head2.setAttribute('d', p.head2);
    }
    for (const c of sc.costs) {
      const chip = chips.get(c.key);
      if (chip) {
        chip.setAttribute('style', `left:${c.x}px; top:${c.y}px`);
        chip.replaceChildren(c.text, el('div', { class: 'pop' }, popRows(c.groups)));
      } else {
        const made = chipOf(c);
        made.style.opacity = '0';
        world.append(made);
        chips.set(c.key, made);
        entering.push(made);
      }
    }
    // A layout read commits the new nodes at opacity 0, so clearing it fades them in.
    if (entering.length) void world.offsetWidth;
    for (const node of entering) node.style.opacity = '';
    paint.lastMode = null;
    paint();
    geo.dividers.forEach((dv, i) => {
      if (dividerNodes[i]) dividerNodes[i].setAttribute('style', `left:${dv.x}px; top:${dv.y}px; width:${dv.w}px`);
    });
    for (const id of boxes.keys()) placeBox(id, { animate: id === anchor });
    applyTransform();

    clearTimeout(reflowDone);
    reflowDone = setTimeout(() => {
      stage.classList.remove('reflow');
      startFlows();
      placePulse();
      paint.lastMode = null;
      paint();
    }, REFLOW_MS + 40);
  }

  /* An arrow inside a frame is drawn as a map route is: the same grey line and heads, and when
     it touches the selected or hovered card the same accent line that draws in, the same heads
     and the same moving dots. `marks` collects each arrow's nodes for `paintFrames`. */
  let maskId = 0;
  function frameInner(box, n, cards, marks) {
    const lines = [];
    const chips = [];
    const lit = [];
    const mark = (a, g, chip, touch) => {
      maskId += 1;
      const id = `fm${maskId}`;
      const reveal = svgEl('path', { d: a.d, class: 'reveal', pathLength: 1 });
      const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: -4000, y: -4000, width: n.w + 8000, height: n.h + 8000 }, reveal);
      const anim = svgEl('path', { d: a.d, class: 'anim', mask: `url(#${id})` });
      const head = svgEl('path', { d: a.head || 'M0 0', class: 'head top' });
      const head2 = a.head2 ? svgEl('path', { d: a.head2, class: 'head top' }) : null;
      const accent = { mask, reveal, anim, head, head2, path: { d: a.d, twoWay: false }, shown: false };
      hideAccent(accent);
      lit.push(mask, anim, head, head2);
      marks.push({ key: markKey(box, n, 'a', a), g, label: chip, touch, accent, lit: false, dim: false });
    };
    const nameOf = (id) => {
      const k = n.children.find(c => c.id === id);
      return k ? kidName(k.spec.item) : names.get(box) || box;
    };
    for (const a of n.arrows) {
      const g = svgEl('g', { class: a.from === null ? 'froute' : 'froute fside', 'data-from': a.from || '', 'data-to': a.to },
        svgEl('path', { class: 'fline', d: a.d }),
        svgEl('path', { class: a.head ? 'head fhead' : 'none', d: a.head || 'M0 0' }),
        a.head2 ? svgEl('path', { class: 'head fhead start', d: a.head2 }) : null);
      lines.push(g);
      const count = a.forward.length + a.backward.length;
      let chip = null;
      if (a.label && count) {
        const from = nameOf(a.from);
        const to = nameOf(a.to);
        const groups = [{ head: `${from} → ${to}`, routes: a.forward.map(routeOf) }];
        if (a.backward.length) groups.push({ head: `${to} → ${from}`, routes: a.backward.map(routeOf) });
        chip = el('div', { class: 'cost', 'data-from': a.from || '', 'data-to': a.to, style: `left:${a.label.x}px; top:${a.label.y}px` },
          String(count), el('div', { class: 'pop' }, popRows(groups)));
        chips.push(chip);
      }
      mark(a, g, chip, [a.to, a.from === null ? n.id : a.from]);
    }
    const svg = svgEl('svg', {
      class: 'routes fbracket', width: n.w, height: n.h, viewBox: `0 0 ${n.w} ${n.h}`, 'aria-hidden': 'true',
    }, lines, svgEl('g', { class: 'litlayer' }, lit));
    const kids = n.children.map(k => cardOf(box, k, k.x + k.card.x, k.y + k.card.y, cards));
    // The arrows draw over the cards, so a card's stacked layers never hide where an arrow ends.
    return [kids, svg, chips];
  }

  function cardOf(box, k, x, y, cards) {
    const kid = k.spec.item || k.spec.kid;
    const many = Boolean(k.spec.item && k.spec.item.members.length >= 2);
    const count = many ? kid.members.length : 1;
    const card = el('div', {
      class: `kid${many ? ` many layers-${Math.min(count - 1, 3)}` : ''}${kid.external ? ' xkid' : ''}`,
      'data-anchor': k.id,
      'data-kid': kid.state.id,
      'data-parent': kid.parent ? kid.parent.id : '',
      'data-role': kid.role || '',
      'data-count': many ? String(count) : null,
      style: `left:${x}px; top:${y}px; width:${k.card.w}px; height:${k.card.h}px; --sh:${k.card.h}px`,
    }, el('div', { class: 'kshot' }), shotInfo(kidName(kid), count));
    card.kid = kid;
    const press = () => {
      if (kid.external) select(kid.external.id);
      else select(box, kid, k.id);
    };
    shotFocus(card.firstChild, shotLabel(kidName(kid), count), press);
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      press();
    });
    card.addEventListener('pointerenter', () => { ui.hoverAnchor = k.id; paint(); });
    card.addEventListener('pointerleave', () => { ui.hoverAnchor = null; paint(); });
    cards.push(card);
    return card;
  }

  function paintKids() {
    for (const paintShot of panelShots) paintShot();
    for (const cards of kidCards.values()) {
      for (const card of cards) {
        if (!card.kid) continue;
        const ext = card.kid.external;
        if (ext) {
          const shot = extShot(ext, ui.orient, ui.tone);
          setChildren(card.firstChild, shot
            ? el('img', { src: shot.url, alt: '', loading: 'lazy' })
            : el('span', { class: 'kpkg', text: ext.package }));
          continue;
        }
        const url = shotOf(card.kid.state);
        setChildren(card.firstChild, url
          ? el('img', { src: url, alt: '', loading: 'lazy' })
          : el('span', { text: `no ${ui.tone}` }));
      }
    }
  }

  const kidName = kid => kid.name;

  function shotOf(r) {
    const cell = (cellsOf.get(r.id) || []).find(c => c.orientation === ui.orient && c.appearance === ui.tone);
    return cell ? cell.url : null;
  }

  function treeOf(r) {
    const leaves = (state.captures.get(r.id) || { leaves: [] }).leaves;
    const leaf = leaves.find(l => l.orientation === ui.orient)
      || (ui.orient === 'portrait' && leaves.find(l => l.orientation === 'default')) || null;
    if (!leaf) return null;
    return leaf.fromRun ? (leaf.uistate || leaf.tree || null) : `${leaf.url}state.uistate.txt`;
  }

  const trees = new Map();
  function fetchTree(url) {
    if (!trees.has(url)) {
      trees.set(url, fetch(url, { cache: 'no-cache' }).then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
        return res.text();
      }));
    }
    return trees.get(url);
  }

  function diffOf(kid) {
    const a = kid.base && treeOf(kid.base);
    const b = treeOf(kid.state);
    if (!a || !b) return Promise.reject(new Error(`No stored ${ui.orient} tree for ${a ? 'this value' : 'the base state'}.`));
    return Promise.all([fetchTree(a), fetchTree(b)]).then(([before, after]) => treeDiff(before, after));
  }

  const DIFF = {
    added: { sign: '+', ink: 'accent-text', label: 'added' },
    changed: { sign: '~', ink: 'warn', label: 'changed' },
    removed: { sign: '−', ink: 'skip', label: 'removed' },
  };
  const DIFF_MAX = 40;

  function diffCounts(d) {
    if (!d.rows.length) return el('i', { text: 'same tree' });
    return Object.keys(DIFF).filter(op => d[op]).map(op => el('b', {
      style: `--c: var(--${DIFF[op].ink})`, 'data-tip': `${d[op]} ${DIFF[op].label}`, text: `${DIFF[op].sign}${d[op]}`,
    }));
  }

  const panelShots = new Set();
  function kidPanel(screen, kid) {
    const figure = (r, caption) => {
      const shot = el('div', {});
      const paintShot = () => {
        const url = r && shotOf(r);
        setChildren(shot, url
          ? el('a', { href: url, target: '_blank', rel: 'noopener' }, el('img', { src: url, alt: `${screen.name || screen.id}, ${caption}` }))
          : el('div', { class: 'kc-none', text: `no ${ui.tone} ${ui.orient} capture` }));
      };
      paintShot();
      panelShots.add(paintShot);
      return el('figure', { class: 'kc-f' }, shot, el('figcaption', { text: caption }));
    };
    const list = el('div', { class: 'kd' }, el('p', { class: 'kd-note', text: 'Reading the stored trees…' }));
    diffOf(kid).then((d) => {
      const head = el('p', { class: 'kd-note' }, d.rows.length
        ? [kid.kind === 'display' ? 'Against its parent state: ' : 'Against the base state: ', diffCounts(d)]
        : 'The stored trees are the same.');
      const shown = d.rows.slice(0, DIFF_MAX).map(r => el('div', { class: 'kd-r', style: `--c: var(--${DIFF[r.op].ink})` },
        el('b', { 'data-tip': DIFF[r.op].label, text: DIFF[r.op].sign }),
        el('span', {}, r.from ? el('s', { text: r.from }) : null, el('span', { text: r.text }))));
      const rest = d.rows.length - shown.length;
      setChildren(list, head, shown, rest > 0 ? el('p', { class: 'kd-note', text: `+${rest} more` }) : null,
        el('p', { class: 'kd-note' },
          el('a', { href: treeOf(kid.base), target: '_blank', rel: 'noopener', text: 'base tree' }), ' · ',
          el('a', { href: treeOf(kid.state), target: '_blank', rel: 'noopener', text: 'this tree' })));
    }, err => setChildren(list, el('p', { class: 'kd-note', text: err.message })));
    return el('div', { class: 'kc' },
      el('div', { class: 'kc-h' },
        el('span', { class: 'mono', text: kidName(kid) }),
        el('span', { class: 'stamp', style: '--c: var(--skip)', text: kid.kind })),
      el('div', { class: 'kc-shots' },
        figure(kid.base, kid.base ? `${kid.kind === 'display' ? 'parent' : 'base'} · ${stateLabel(kid.base)}` : 'no base state'),
        figure(kid.state, kidName(kid))),
      list);
  }

  /* Classes only. Nothing here creates or destroys a node except the lit
     accent layer, whose paths exist to play their reveal. */
  function paint() {
    const sel = ui.sel;
    const hotKey = ui.hot ? ui.hot.key : null;
    const q = ui.query.trim().toLowerCase();

    // Both the selected screen and the one under the pointer light their own
    // routes. Only a SELECTION dims the rest -- hovering adds light, it never
    // takes any away.
    const lit = new Set();
    for (const focus of [drawnId(sel), drawnId(ui.hover)]) {
      if (!focus) continue;
      for (const p of sc.pairs.values()) {
        if (p.fromBox === focus || p.toBox === focus) {
          lit.add(`${p.from}>${p.to}`);
          lit.add(`${p.to}>${p.from}`);
        }
      }
      lit.add(`${focus}>${focus}`);
    }

    // Only the routes whose state actually changed are touched.
    const changed = new Set([...lit, ...litNow]);
    // A Set is compared by identity, so the filter is keyed by its contents.
    const modeKey = [...ui.modes].sort().join(',');
    if (sel !== paint.lastSel || hotKey !== paint.lastHot || modeKey !== paint.lastMode) {
      for (const key of groups.keys()) changed.add(key);
    }
    const allowed = visibleKeys();

    for (const key of changed) {
      const shown = !allowed || allowed.has(key);
      const isLit = shown && lit.has(key);
      const isHot = shown && (hotKey === key || (hotKey && key === reverseKey(hotKey)));
      const g = groups.get(key);
      if (g) {
        g.setAttribute('class', isHot ? 'lit hot' : isLit ? 'lit' : (sel ? 'dim' : ''));
        g.style.display = shown ? '' : 'none';
      }
      pulse.set(key, !shown ? 'hidden' : (isLit || isHot) ? 'lit' : sel ? 'dim' : 'rest');
      const chip = chips.get(key);
      if (chip) {
        chip.classList.toggle('lit', isLit || isHot);
        // A chip for a route nothing has selected is hidden rather than dimmed,
        // which is what the artboard does.
        chip.hidden = !shown || (Boolean(sel) && !isLit && !isHot);
      }
    }
    paint.lastSel = sel;
    paint.lastHot = hotKey;
    paint.lastMode = modeKey;
    litNow = lit;
    paintFrames();

    // A screen the filtered routes no longer touch is dimmed: that IS the
    // finding a mode filter exists to show.
    const stranded = new Set();
    if (allowed) {
      for (const id of boxes.keys()) stranded.add(id);
      for (const key of allowed) {
        const [a2, b2] = key.split('>');
        stranded.delete(a2);
        stranded.delete(b2);
      }
    }

    for (const [id, node] of boxes) {
      const screen = model.byScreen.get(id) || {};
      const hit = q && [id, names.get(id), screen.summary, screen.package].some(t => (t || '').toLowerCase().includes(q));
      node.classList.toggle('sel', id === drawnId(sel));
      // `hov` comes only from a drawer row: it brightens the whole border at
      // once, since there is no pointer entry point to sweep from.
      node.classList.toggle('hov', Boolean(ui.hot && drawnId(ui.hot.id) === id));
      node.classList.toggle('hit', Boolean(hit));
      // Search and the mode filter dim a box. Selection never does; it dims
      // routes instead.
      node.classList.toggle('dim', (Boolean(q) && !hit) || stranded.has(id));
      const stack = stacks.get(id);
      if (stack) stack.classList.toggle('dim', node.classList.contains('dim'));
    }

    const focus = drawnId(sel || ui.hover);
    for (const key of changed) {
      const a = accent.get(key);
      if (!a) continue;
      if (lit.has(key) && (!allowed || allowed.has(key))) {
        showAccent(a, hotKey === key || (hotKey && key === reverseKey(hotKey)), focus);
      } else {
        hideAccent(a);
      }
    }
    // The minimap only moves when the viewport does, so it is not redrawn here.
    // Rebuilding its 29 nodes on every pointer move was pure waste.
  }

  /* Light the arrows inside open frames. The selected or hovered card lights the arrows that
     touch it; a screen's box with no card under the pointer lights all of its own. With a
     selection, the rest dim as the map's routes do. */
  function paintFrames() {
    const selBox = drawnId(ui.sel);
    const hovBox = drawnId(ui.hover);
    const anchors = new Set([ui.selAnchor, ui.hoverAnchor].filter(Boolean));
    for (const [box, node] of boxes) {
      if (!node.row || !node.row.marks) continue;
      const wholeBox = (box === selBox && !ui.selAnchor) || (box === hovBox && !ui.hoverAnchor);
      for (const m of node.row.marks) {
        const isLit = wholeBox || m.touch.some(id => anchors.has(id));
        const isDim = !isLit && Boolean(ui.sel);
        framePulse.set(m.key, isLit ? 'lit' : isDim ? 'dim' : 'rest');
        if (isLit === m.lit && isDim === m.dim) continue;
        m.lit = isLit;
        m.dim = isDim;
        m.g.classList.toggle('lit', isLit);
        m.g.classList.toggle('dim', isDim);
        if (isLit) showAccent(m.accent, false, null);
        else hideAccent(m.accent);
        if (m.label) {
          m.label.classList.toggle('lit', isLit);
          m.label.hidden = isDim;
        }
      }
    }
  }

  function reverseKey(key) {
    const [a, b] = key.split('>');
    return `${b}>${a}`;
  }

  /* Hide one route's accent nodes. */
  function hideAccent(a) {
    a.shown = false;
    a.reveal.style.strokeDashoffset = '1';
    a.anim.style.display = 'none';
    a.head.style.display = 'none';
    if (a.head2) a.head2.style.display = 'none';
  }

  /* Show a route's accent, drawing its line in along its length.

     The reveal is a TRANSITION on `stroke-dashoffset`, not an animation, so it
     replays every time the value changes and needs no restart trick at all.
     Both usual tricks were measured here and both are worse: removing and
     re-adding the class needs a synchronous layout read, which is 27 forced
     layouts of a 3000px SVG per hover (~5ms); `getAnimations().cancel()/play()`
     forces a style recalc per element and measured far worse again (~34ms). */
  // The accent runs AWAY from the focused screen, so direction is readable.
  function accentPath(a, focus) {
    return (a.path.twoWay && focus === a.path.to) ? a.path.dRev : a.path.d;
  }

  function showAccent(a, isHot, focus) {
    const d = accentPath(a, focus);
    if (a.d !== d) {
      a.anim.setAttribute('d', d);
      a.reveal.setAttribute('d', d);
      a.d = d;
    }
    a.anim.style.display = '';
    a.head.style.display = '';
    if (a.head2) a.head2.style.display = '';
    a.anim.classList.toggle('hot', isHot);
    a.head.classList.toggle('hot', isHot);
    if (a.head2) a.head2.classList.toggle('hot', isHot);
    if (!a.shown) {
      a.reveal.style.strokeDashoffset = '0';
      a.shown = true;
    }
  }

  function setHot(hot) {
    ui.hot = hot;
    paint();
  }

  /* True from the moment the inspector is added or removed until the stage's resize has been
     handled, so the resize handler can tell it from a window resize. */
  let inspMoved = false;
  function markInspMoved() {
    inspMoved = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { inspMoved = false; }));
  }

  function select(id, kid = null, anchor = null) {
    ui.sel = id;
    ui.selAnchor = anchor;
    ui.hot = null;
    paint();
    drawMini();
    drawer(id ? model.byScreen.get(id) : null, kid);
  }

  /* The inspector, node for node as the artboard has it: the view buttons with
     close at the far right, then the id, its stamp and a chevron as one press
     surface, then THREE folds -- routes in, routes out, runs. */
  function drawer(screen, focusKid = null) {
    panelShots.clear();
    // The drawer is not an empty panel waiting for a selection -- it is not
    // there at all. The artboard gates the whole `.insp` on having one, and a
    // permanently present column costs 360px of map for a sentence.
    if (!screen) {
      if (insp.parentNode) {
        insp.remove();
        markInspMoved();
      }
      return;
    }
    if (!insp.parentNode) {
      main.append(insp);
      markInspMoved();
    }

    const routeRow = (e, far) => {
      // The line's key is always src-screen to dst-screen, whichever fold the
      // row sits in.
      const key = edgeKey(e);
      const row = el('div', { class: 'rl' },
        el('span', { class: 'verb', text: e.action || '(no action)' }),
        el('span', { class: 'rn', text: far }),
        run && e.align ? el('span', { class: 'stamp', style: `--c: var(--${ALIGN[e.align].ink})`, text: ALIGN[e.align].label }) : null,
        // The cost pill carried a bare number that meant milliseconds when the
        // route was timed and a step COUNT when it was not -- two quantities in
        // one column with no unit to tell them apart.
        el('span', { class: 'cost', text: e.timed ? `${e.measured_ms} ms` : 'untimed' }));
      // A drawer row hands the far screen `hov` as well as lighting the route.
      row.addEventListener('pointerenter', () => setHot({ key, id: far }));
      row.addEventListener('pointerleave', () => setHot(null));
      // Picking a row walks the map to that screen rather than leaving the page.
      row.addEventListener('click', () => select(far));
      return row;
    };

    const chev = icon('chevron', 14);
    // `setAttribute('class', ...)` REPLACES the list and dropped `msym`, so the
    // icon font never applied and the ligature name rendered as literal text.
    // It was harmless when icons were inline SVG; it is not now.
    chev.classList.add('ih-go');
    const states = view.statesOf.get(screen.id);
    const listed = screen.isExternal ? [] : statesOfScreen(screen.id);
    const routesIn = screen.routesIn.filter(e => view.edgeSet.has(e));
    const routesOut = screen.routesOut.filter(e => view.edgeSet.has(e));
    const captured = states.length > 0 && states.every(r => r.uistate_digest);
    const stamp = run && screen.align
      ? { c: ALIGN[screen.align].ink, text: ALIGN[screen.align].label }
      : screen.isExternal
        ? { c: 'skip', text: 'outside the app' }
        : { c: captured ? 'pass' : 'warn', text: captured ? 'captured' : 'incomplete' };
    const capStep = (() => {
      if (!run) return null;
      const r = states.find(x => !x.ghost && state.captures.get(x.id));
      const leaf = r && state.captures.get(r.id).leaves[0];
      return leaf && leaf.capture ? leaf.capture.step : null;
    })();
    const open = run
      ? () => { location.href = `${href('runs.html', { id: run.id })}${capStep != null ? `#step-${String(capStep).padStart(3, '0')}` : ''}`; }
      : () => { location.href = href('screen.html', { id: screen.id }); };

    setChildren(insp,
      el('div', { class: 'ih' },
        el('div', { class: 'ih-top' },
          el('div', { class: 'ih-view' },
            el('button', {
              class: 'x',
              'data-tip': 'Center Screenshot',
              onclick: () => centerOn(drawnId(screen.id)),
            }, icon('brightness', 13)),
            el('button', {
              class: 'x',
              'data-tip': 'Fit Flow',
              onclick: () => fitOn(drawnId(screen.id)),
            }, icon('fit', 13))),
          el('button', {
            class: 'x',
            style: 'margin-left:auto',
            'data-tip': 'Close',
            onclick: () => select(null),
          }, icon('close', 12))),
        el('div', {
          class: 'ih-name',
          'data-tip': run ? 'Open the step that captured it' : 'Open Screen',
          onclick: open,
        },
          el('h2', { text: screen.name || screen.id }),
          el('span', { class: 'stamp', style: `--c: var(--${stamp.c})`, text: stamp.text }),
          chev)),
      el('div', { class: 'ib' },
        listed.length && !screen.isExternal ? el('div', { class: 'vstates' }, listed.map(r => el('a', {
          class: 'vstate',
          href: run ? stateHref(r) : href('screen.html', { id: screen.id, state: r.id }),
          target: run ? '_blank' : null,
        }, el('span', { class: 'mono', text: stateLabel(r) }),
        run && r.align ? el('span', { class: 'stamp', style: `--c: var(--${ALIGN[r.align].ink})`, 'data-tip': r.alignAs ? `as ${r.alignAs}` : null, text: ALIGN[r.align].label }) : null,
        variantStrip(cellsOf.get(r.id).filter(c => c.orientation === ui.orient))))) : null,
        kidsOf(screen.id).length ? fold('Children', kidsOf(screen.id).length, () => kidsOf(screen.id).map((kid) => {
          const panel = kidPanel(screen, kid);
          if (kid === focusKid) requestAnimationFrame(() => panel.scrollIntoView({ block: 'start' }));
          return panel;
        }), Boolean(focusKid)) : null,
        fold('Routes in', routesIn.length,
          () => routesIn.map(e => routeRow(e, e.srcRendition.screen.id))),
        fold('Routes out', routesOut.length,
          () => routesOut.map(e => routeRow(e, e.dstRendition.screen.id))),
        // Nothing joins a run to a screen: the driver's step digests match none
        // of this map's, so this is 0 rather than a number nobody can defend.
        fold('Runs', 0, () => [])));
  }

  function stateHref(r) {
    const leaf = (state.captures.get(r.id) || { leaves: [] }).leaves[0];
    if (!leaf) return '#';
    return leaf.fromRun ? (leaf.uistate || leaf.tree || '#') : `${leaf.url}state.uistate.txt`;
  }

  /* The minimap: one rect per box, plus the viewport rectangle. */
  function drawMini() {
    const r = stage.getBoundingClientRect();
    const kids = [...geo.pos].map(([id, b]) => svgEl('rect', {
      x: b.x, y: b.y, width: b.w, height: b.h, rx: 6,
      fill: drawnId(ui.sel) === id ? 'var(--accent)' : 'var(--rule)',
    }));
    kids.push(svgEl('rect', {
      x: -ui.tx / ui.scale, y: -ui.ty / ui.scale,
      width: r.width / ui.scale, height: r.height / ui.scale,
      fill: 'color-mix(in oklab, var(--accent) 8%, transparent)', stroke: 'var(--accent)',
      'stroke-width': String(Math.max(2, 2 / ui.scale)),
    }));
    setChildren(mini, svgEl('svg', {
      viewBox: `0 0 ${geo.worldW} ${geo.worldH}`,
      preserveAspectRatio: 'xMidYMid meet',
      'aria-hidden': 'true',
    }, kids));
  }

  function stageSize() {
    const r = stage.getBoundingClientRect();
    return { w: r.width || 1200, h: r.height || 700 };
  }
  function placePulse() {
    const { w, h } = stageSize();
    pulse.view(ui.tx, ui.ty, ui.scale, w, h);
    framePulse.view(ui.tx, ui.ty, ui.scale, w, h);
  }

  /* A promoted layer keeps the scale it was rastered at, so once a zoom settles
     `.reraster` drops the world's promotion for a frame to re-raster it sharp. */
  let rasterScale = null;
  let settle = 0;
  function moving() {
    pulse.hold(true);
    framePulse.hold(true);
    clearTimeout(settle);
    settle = setTimeout(() => {
      pulse.hold(false);
      framePulse.hold(false);
      const was = rasterScale;
      rasterScale = ui.scale;
      if (was === null || was === ui.scale) return;
      stage.classList.add('reraster');
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('reraster')));
    }, 200);
  }

  /* The transform alone, for pan and zoom. */
  function applyTransform() {
    world.style.transform = `translate(${ui.tx}px, ${ui.ty}px) scale(${ui.scale})`;
    world.style.setProperty('--inv', String(1 / ui.scale));
    zoomLabel.textContent = `${Math.round(ui.scale * 100)}%`;
    placePulse();
    moving();
    drawMini();
  }
  /* The scale at which the whole map just fits the stage. */
  function fitScale() {
    const { w, h } = stageSize();
    return Math.min(w / geo.worldW, (h - 80) / geo.worldH);
  }

  /* Clamp a scale to what is worth looking at.

     The floor follows the map rather than being a constant: a little further
     out than "everything fits" is useful for orientation, and anything beyond
     that is a page of empty ground with the survey shrinking in the middle of
     it. The old 0.05 floor let a reader zoom to where the whole map was a
     smudge and then have to hunt their way back.

     The ceiling is generous, because zooming in is how a capture is actually
     read -- a box is 92px wide, so 8x is where its text becomes legible. */
  const OUT_PAST_FIT = 0.75;
  const MAX_SCALE = 8;
  function clampScale(v) {
    return Math.min(MAX_SCALE, Math.max(fitScale() * OUT_PAST_FIT, v));
  }

  /* Fit never opens above 1:1. A survey with two screens in it would otherwise
     land at several hundred percent, which is a capture blown up past its own
     resolution before the reader has asked for anything. Zooming in by hand
     still goes to MAX_SCALE. */
  const MAX_FIT = 1;
  function fitView() {
    const { w, h } = stageSize();
    ui.scale = Math.min(MAX_FIT, fitScale() * 0.96);
    ui.tx = (w - geo.worldW * ui.scale) / 2;
    ui.ty = 40 + (h - 80 - geo.worldH * ui.scale) / 2;
    applyTransform();
  }
  function centerView() {
    const { w, h } = stageSize();
    ui.tx = (w - geo.worldW * ui.scale) / 2;
    ui.ty = 40 + (h - 80 - geo.worldH * ui.scale) / 2;
    applyTransform();
  }
  function zoomAt(factor, cx, cy) {
    const next = clampScale(ui.scale * factor);
    ui.tx = cx - (cx - ui.tx) * (next / ui.scale);
    ui.ty = cy - (cy - ui.ty) * (next / ui.scale);
    ui.scale = next;
    applyTransform();
  }
  function centerOn(id) {
    const b = geo.pos.get(id);
    if (!b) return;
    const { w, h } = stageSize();
    ui.tx = w / 2 - (b.x + b.w / 2) * ui.scale;
    ui.ty = h / 2 - (b.y + b.h / 2) * ui.scale;
    applyTransform();
  }
  /* The screen card's rectangle in world coordinates: the whole box when the screen is
     closed, the card at the top of its frame when it is open. */
  function cardRect(id) {
    const box = geo.pos.get(id);
    if (!box) return null;
    const f = frames.get(id);
    const card = f ? f.card : { x: 0, y: 0, w: box.w, h: box.ih || box.h };
    return { x: box.x + card.x, y: box.y + card.y, w: card.w, h: card.h };
  }
  function kidRect(id, anchor) {
    const box = geo.pos.get(id);
    const f = frames.get(id);
    if (!box || !f) return null;
    const find = (n, ox, oy) => {
      if (n.id === anchor) return { x: ox + n.card.x, y: oy + n.card.y, w: n.card.w, h: n.card.h };
      for (const k of n.children || []) {
        const hit = find(k, ox + k.x, oy + k.y);
        if (hit) return hit;
      }
      return null;
    };
    return find(f, box.x, box.y);
  }
  const selectedRect = () => (ui.selAnchor ? kidRect(drawnId(ui.sel), ui.selAnchor) : cardRect(drawnId(ui.sel)));
  function keepCardOnStage() {
    const c = cardRect(drawnId(ui.sel));
    if (!c) return;
    const { w, h } = stageSize();
    const left = ui.tx + c.x * ui.scale;
    const top = ui.ty + c.y * ui.scale;
    if (left >= 0 && top >= 0 && left + c.w * ui.scale <= w && top + c.h * ui.scale <= h) return;
    ui.tx = w / 2 - (c.x + c.w / 2) * ui.scale;
    ui.ty = h / 2 - (c.y + c.h / 2) * ui.scale;
    applyTransform();
  }
  function fitOn(id) {
    const ids = new Set([id]);
    for (const p of sc.pairs.values()) {
      if (p.fromBox === id) ids.add(p.toBox);
      if (p.toBox === id) ids.add(p.fromBox);
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const sid of ids) {
      const b = geo.pos.get(sid);
      if (!b) continue;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    if (!Number.isFinite(x0)) return;
    const pad = 60;
    const { w, h } = stageSize();
    ui.scale = clampScale(Math.min(w / (x1 - x0 + pad * 2), h / (y1 - y0 + pad * 2)));
    ui.tx = w / 2 - ((x0 + x1) / 2) * ui.scale;
    ui.ty = h / 2 - ((y0 + y1) / 2) * ui.scale;
    applyTransform();
  }

  // Native and non-passive, so a trackpad pinch (ctrl + wheel) cannot zoom the
  // page and a two-finger scroll pans instead of scrolling.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      ui.tx -= e.deltaX * k;
      ui.ty -= e.deltaY * k;
      applyTransform();
    }
  }, { passive: false });

  /* The same guard for the rest of the page.

     The bar and the toolbar are siblings of the stage, not children of it, so a
     pinch over either fell through to the browser and zoomed the chrome on its
     own -- the header, the toolbar and the map's overlays scaling independently
     of the diagram they sit on. On this page a pinch means one thing: zoom the
     map. Anywhere outside the stage it zooms about the stage's centre, since
     there is no meaningful point under the pointer.

     Capture phase, so it runs before anything else can claim the event, and
     only `ctrl`/`meta` is taken -- a plain wheel outside the stage still scrolls
     the inspector. Registered on `window` by this view alone, so the other
     pages keep the browser's own zoom, which some readers rely on. */
  window.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (stage.contains(e.target)) return;
    e.preventDefault();
    const { w, h } = stageSize();
    zoomAt(Math.exp(-e.deltaY * 0.01), w / 2, h / 2);
  }, { passive: false, capture: true });

  /* A mouse pans from empty ground only, so a press on a box stays a click. A
     finger pans from anywhere, because at phone width the boxes cover most of
     the stage; two fingers pinch. A touch that moved past the slop swallows the
     click that follows it, so a pan that started on a box does not select it.
     Capture waits for that slop too: a captured pointer retargets its click to
     the stage, which would stop a plain tap reaching the box. */
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let swallowClick = false;
  const SLOP = 6;
  const pinchOf = () => {
    const [a, b] = [...pointers.values()];
    const r = stage.getBoundingClientRect();
    return {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      cx: (a.x + b.x) / 2 - r.left,
      cy: (a.y + b.y) / 2 - r.top,
    };
  };
  stage.addEventListener('pointerdown', (e) => {
    const touch = e.pointerType !== 'mouse';
    if (e.target.closest('.card')) return;
    if (!touch && e.target.closest('.box, .kid, .cost')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      pinch = pinchOf();
      drag = null;
      swallowClick = true;
      for (const id of pointers.keys()) stage.setPointerCapture(id);
      return;
    }
    if (pointers.size > 2) return;
    drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, captured: false };
    swallowClick = false;
    stage.classList.add('drag');
  });
  stage.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch && pointers.size === 2) {
      const now = pinchOf();
      ui.tx += now.cx - pinch.cx;
      ui.ty += now.cy - pinch.cy;
      zoomAt(now.d / pinch.d, now.cx, now.cy);
      pinch = now;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    ui.tx += e.clientX - drag.x;
    ui.ty += e.clientY - drag.y;
    drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.moved >= SLOP && !drag.captured) {
      drag.captured = true;
      swallowClick = true;
      stage.setPointerCapture(e.pointerId);
    }
    applyTransform();
  });
  const release = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    if (pinch) {
      if (pointers.size >= 2) return;
      pinch = null;
      // The finger still down carries on as a pan, already past the slop.
      const [rest] = [...pointers.entries()];
      if (rest) drag = { x: rest[1].x, y: rest[1].y, moved: SLOP, id: rest[0], captured: true };
      else stage.classList.remove('drag');
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const { moved } = drag;
    drag = null;
    stage.classList.remove('drag');
    if (e.type === 'pointerup' && moved < SLOP && ui.sel && !e.target.closest('.box, .kid, .cost')) select(null);
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  const tallyCaptured = el('div', { style: '--c: var(--pass)', 'data-tip': 'Captured' });
  const tallyDraft = el('div', { style: '--c: var(--warn)', 'data-tip': 'Draft' });
  const tallyDead = el('div', { style: '--c: var(--fail)', 'data-tip': 'Dead ends' });
  const panel = el('div', { class: 'card panel' },
    el('div', { class: 'tally' }, tallyCaptured, tallyDraft, tallyDead),
    mini,
    el('div', { class: 'hud' },
      el('button', { 'data-tip': 'Center Map', onclick: () => centerView() }, icon('brightness', 13)),
      el('div', { class: 'zoom' },
        el('button', { 'data-tip': 'Zoom Out', onclick: () => { const { w, h } = stageSize(); zoomAt(0.8, w / 2, h / 2); } }, icon('minus', 13)),
        zoomLabel,
        el('button', { 'data-tip': 'Zoom In', onclick: () => { const { w, h } = stageSize(); zoomAt(1.25, w / 2, h / 2); } }, icon('plus', 13))),
      el('button', { 'data-tip': 'Fit Map', onclick: () => fitView() }, icon('fit', 13))));
  stage.append(panel);

  const seg = (options, get, onPick) => {
    const box = el('div', { class: 'seg', 'data-scope': 'group' });
    box.append(...options.map(o => {
      const b = el('button', {
        class: o.off ? 'off' : (o.value === get() ? 'on' : ''),
        'data-tip': o.title,
        onclick: o.off ? null : () => {
          onPick(o.value);
          for (const sib of box.children) sib.classList.toggle('on', sib === b);
        },
      }, icon(o.icon, 12, '', o.rot));
      return b;
    }));
    return box;
  };

  /* A `seg` whose buttons toggle independently rather than picking one.
     Same markup and same styling, so the mode filter reads as one of the
     toolbar's toggles and not as a control of its own kind. */
  const multi = (options, has, onToggle) => {
    const box = el('div', { class: 'seg', 'data-scope': 'group' });
    box.append(...options.map(o => {
      const b = el('button', {
        class: o.off ? 'off' : (has(o.value) ? 'on' : ''),
        'data-tip': o.title,
        onclick: o.off ? null : () => {
          onToggle(o.value);
          b.classList.toggle('on', has(o.value));
        },
      }, icon(o.icon, 12));
      return b;
    }));
    return box;
  };

  /* The mode filter.

     Not on the artboard -- modes live on its coverage page -- but a map of
     every route at once is the wrong picture when the question is "what can a
     screen-reader user actually reach". Every driven mode starts on, so the
     map opens whole and the filter subtracts; there is no "all modes" button
     because turning the last one back on is the same gesture.

     A mode nobody has driven is offered and marked, rather than hidden: an
     absent option says the mode does not exist, which is a different claim
     from nothing having been recorded under it. The tooltip names the mode,
     because these icons are the toolbar's only ones a reader cannot guess. */
  // The tooltip is count first, then the mode: "68 - Touch". A mode nothing
  // has driven reads "0 - Keyboard". `paintCounts` fills it per orientation.
  const modeItems = MODES.map(m => ({
    value: m.name,
    icon: m.name,
    off: !driven.has(m.name),
  }));

  function refilter() {
    view = orientedView();
    geo = relayout(ui.orient);
    build();
    applyTransform();
    paintCounts();
    paintTone();
    if (ui.sel) drawer(model.byScreen.get(drawnId(ui.sel)) || null);
  }

  const modeSeg = multi(modeItems, v => ui.modes.has(v), (v) => {
    if (ui.modes.has(v)) ui.modes.delete(v);
    else ui.modes.add(v);
    refilter();
  });

  function paintCounts() {
    const dead = view.edges.filter(e => e.isSelf).length;
    tallyCaptured.textContent = String(view.states.filter(r => r.uistate_digest).length);
    tallyDraft.textContent = String(view.states.filter(r => r.status === 'draft').length);
    tallyDead.textContent = String(dead);
    tallyDead.classList.toggle('zero', !dead);
    MODES.forEach((m, i) => {
      const n = view.oriented.filter(e => modeOf(e) === m.name).length;
      modeSeg.children[i].setAttribute('data-tip', `${n} - ${m.label}`);
    });
  }

  const orientSeg = seg([
    { value: 'portrait', icon: phoneIcon(ui.platform), off: !hasOrient.portrait,
      title: 'Portrait' },
    { value: 'landscape', icon: phoneIcon(ui.platform), rot: true, off: !hasOrient.landscape,
      title: 'Landscape' },
  ], () => ui.orient, (v) => {
    ui.orient = v;
    view = orientedView();
    geo = relayout(v);
    build();
    fitView();
    paintCounts();
    paintTone();
    drawer(ui.sel ? model.byScreen.get(ui.sel) : null);
  });

  /* Switching platform redraws the orientation pair, because that pair is the
     platform's own handset at two angles. The glyph is replaced rather than the
     button, so the selected state and the listeners survive. */
  const platformSeg = seg(PLATFORMS.map(p2 => ({
    value: p2.value,
    icon: p2.value,
    off: !havePlatform.has(p2.value),
    title: p2.label,
  })), () => ui.platform, (v) => {
    ui.platform = v;
    const own = byPlatform.get(v);
    state.profile = own.profile;
    state.captures = own.captures;
    readCells();
    [...orientSeg.children].forEach((b, i) => b.replaceChild(icon(phoneIcon(v), 12, '', i === 1), b.firstChild));
    refilter();
  });

  /* The capture tone is the screenshots' appearance, not this site's theme. When the
     map holds no capture in the chosen one, the toolbar says so in words. */
  const toneSeg = seg([
    { value: 'light', icon: 'sun', title: 'Light captures' },
    { value: 'dark', icon: 'moon', title: 'Dark captures' },
  ], () => ui.tone, (v) => { ui.tone = v; refilter(); });
  const toneNote = el('span', { class: 'tnote', role: 'status' });
  function paintTone() {
    const whose = run ? 'this run' : 'this baseline';
    const have = t => view.inOrient.some(r => cellsOf.get(r.id)
      .some(c => c.url && c.orientation === ui.orient && c.appearance === t));
    toneNote.textContent = have(ui.tone) ? '' : `No ${ui.tone} ${ui.orient} captures in ${whose}`;
    toneNote.hidden = !toneNote.textContent;
    ['light', 'dark'].forEach((t, i) => {
      toneSeg.children[i].setAttribute('data-tip', `${t === 'light' ? 'Light' : 'Dark'} captures${have(t) ? '' : ' (none)'}`);
    });
  }

  const toolbar = el('div', { class: 'tools' },
    el('div', { class: 'search' }, icon('search', 13),
      el('input', {
        placeholder: 'find a screen',
        oninput: (e) => { ui.query = e.target.value; paint(); },
      })),
    // One phone, two angles. The glyph is the survey's own platform, so an iOS
    // baseline shows an iPhone body and an Android one shows a handset.
    platformSeg,
    orientSeg,
    toneSeg,
    toneNote,
    modeSeg);

  /* Keep the view steady when the stage resizes. The inspector sits at the stage's right, so
     opening or closing it keeps the stage's left and top fixed and leaves the graph where it
     is, then centres the selected card if the narrower stage would cut it off. Any other
     resize keeps the world point under the stage centre fixed. */
  let last = null;
  new ResizeObserver(() => {
    const now = stageSize();
    if (!last) { last = now; fitView(); return; }
    const byInspector = inspMoved;
    if (!byInspector) {
      ui.tx += (now.w - last.w) / 2;
      ui.ty += (now.h - last.h) / 2;
    }
    last = now;
    // A narrower stage raises the floor, so a scale that was legal before the
    // resize can be below it after. `zoomAt(1, ...)` clamps it about the pinned point.
    zoomAt(1, byInspector ? 0 : now.w / 2, byInspector ? 0 : now.h / 2);
    if (byInspector && insp.parentNode) keepCardOnStage();
  }).observe(stage);

  build();
  paintCounts();
  paintTone();
  drawer(null);
  if (run) stage.append(runCard(state, run));

  // A fragment, not a wrapper: the artboard has `.tools` and `.main` as direct
  // children of `.root`, and `.main { flex:1 }` only fills if it stays one.
  const out = document.createDocumentFragment();
  out.append(toolbar, main);
  return out;
}
