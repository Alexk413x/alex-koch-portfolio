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
import { segmentedGroup } from '../util/segmented.js';
import { href, param } from '../page.js';
import { tiers, layout, scene, routeOf, boxDims, mapRows, launchOrigin, OUTSIDE, EXT_H } from '../graph/scene.js';
import { segsPath } from '../graph/route.js';
import { CAP_H, nodeLayout, anchorRects, anchorOf, solidRects, labelRects, nestedFrameRects, chipWidth, avoidArrowLabels } from '../graph/frame.js';
import { flow } from '../graph/flow.js';
import { platformOf, variants, screenCapture, hasOrientation, captureIndex } from '../data/sources.js';
import { shotSurface, setShotChildren, setShotInfo, shotLabel } from './shotinfo.js';
import { MODES, modeOf } from '../data/modes.js';
import { ALIGN, pairAlign } from '../data/runmap.js';
import { displayChildren, inheritedCopies, stackVariants, variedFrom } from '../data/substates.js';
import { routeActionLabel, routeStepLabel } from './route-options.js';
import { mapHealth } from '../data/health.js';
import { healthContext, rememberHealthScope } from '../data/health-scope.js';
import { renderHealth } from './health.js';

const REFLOW_MS = 420;
const FRAME_DEAL_MS = 560;
const FRAME_DEAL_STEP_MS = 110;
const FRAME_ROUTE_FADE_MS = 220;
const FRAME_PATH_FADE_MS = 240;
const FRAME_OUTLINE_MS = 300;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function frameMotionDuration(cardCount) {
  return FRAME_OUTLINE_MS + FRAME_DEAL_MS + FRAME_DEAL_STEP_MS * Math.max(0, cardCount - 1)
    + FRAME_ROUTE_FADE_MS;
}

function routeReveal(element, from, to, delay, reverseCurrent = false) {
  if (reverseCurrent && delay > FRAME_ROUTE_FADE_MS) {
    const duration = delay + FRAME_ROUTE_FADE_MS;
    return element.animate([
      { opacity: from, offset: 0 },
      { opacity: '0', offset: FRAME_ROUTE_FADE_MS / duration },
      { opacity: '0', offset: delay / duration },
      { opacity: to, offset: 1 },
    ], { duration, easing: 'ease', fill: 'both' });
  }
  return element.animate([{ opacity: from }, { opacity: to }], {
    duration: FRAME_ROUTE_FADE_MS,
    delay,
    easing: 'ease',
    fill: 'both',
  });
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

export function renderMap(input) {
  const mobile = window.matchMedia('(max-width: 760px)');
  const state = { ...input };
  const model = state.model;
  const run = state.run || null;
  const initialHealth = healthContext(state, { remember: !run });
  state.profile = initialHealth.profile;
  state.captures = initialHealth.captures;
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
  /* Remember the selected device baseline for each platform. Runs keep their own device. */
  const byPlatform = new Map([[ownPlatform, { profile: state.profile, captures: state.captures }]]);
  if (!run) {
    for (const pr of state.manifest.profiles || []) {
      const brand = platformIcon(platformOf(pr));
      if (brand === 'screen' || byPlatform.has(brand)) continue;
      byPlatform.set(brand, { profile: pr, captures: captureIndex(pr, `${state.source.url}baselines/${pr.key}/`) });
    }
  }

  function cancelFrameMotion(id, { preserveFinishedReturns = false } = {}) {
    const node = boxes.get(id);
    if (node) {
      for (const row of [node.row, node.closingRow]) {
        if (!row) continue;
        for (const card of row.cards || []) {
          const fade = card.getAnimations().some(animation =>
            animation.effect?.getKeyframes().some(frame => Object.hasOwn(frame, 'opacity')));
          const opacity = fade ? getComputedStyle(card).opacity : null;
          for (const animation of card.getAnimations()) {
            if (preserveFinishedReturns && animation.playState === 'finished'
              && animation.effect?.getKeyframes().some(frame => Object.hasOwn(frame, 'transform'))) {
              continue;
            }
            if (animation.transitionProperty === 'transform'
              || animation.effect?.getKeyframes().some(frame =>
                Object.hasOwn(frame, 'transform') || Object.hasOwn(frame, 'opacity'))) {
              animation.cancel();
            }
          }
          if (fade) card.style.opacity = opacity;
        }
        for (const [element, opacity] of row.fadeStarts || []) {
          element.style.opacity = opacity;
          for (const animation of element.getAnimations()) {
            if (animation.transitionProperty === 'opacity'
              || animation.effect?.getKeyframes().some(frame => Object.hasOwn(frame, 'opacity'))) {
              animation.cancel();
            }
          }
        }
      }
    }
  }

  // `hot` is `{ key, id }`: the route under the pointer, and the screen at its
  // far end when a drawer row is what set it.
  // `hover` is the box under the pointer and lights its routes the same way a
  // selection does. `hot` is one route, from a drawer row or a cost chip.
  // `modes` filters which routes are drawn at all: every driven mode is on, so
  // the map starts whole and the filter only ever subtracts.
  const availableLocales = () => [...new Set([...state.captures.values()]
    .flatMap(capture => capture.leaves.map(leaf => leaf.locale)).filter(Boolean))].sort();
  const ui = { sel: null, hover: null, hot: null, frameHot: null, routeDetails: null, query: '', modes: new Set(initialHealth.scope.modes), platform: ownPlatform, tone: initialHealth.scope.appearance, locale: initialHealth.scope.locale, orient: initialHealth.scope.orientation, selAnchor: null, hoverAnchor: null, scale: 1, tx: 0, ty: 0, nestedPin: [] };
  /* Which orientations this baseline actually holds captures for.

     PORTRAIT stays selectable with no captures at all: it is what a reader
     sees on arrival, and marking it off left the toolbar showing no selection
     while the boxes said what was missing. */
  const cellsOf = new Map();
  const readCells = () => {
    cellsOf.clear();
    for (const r of model.renditions) cellsOf.set(r.id, variants(state.captures.get(r.id), state.profile, ui.locale));
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
    const recorded = model.edges.filter(e => inScope(e.srcRendition) && inScope(e.dstRendition));
    const oriented = recorded.filter(e => !copies.has(e));
    const edges = oriented.filter(modeKept);
    return {
      oriented,
      inOrient: model.appRenditions.filter(inOrient),
      states: model.appRenditions.filter(inScope),
      edges,
      recordedEdges: recorded.filter(modeKept),
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
  const nestedOpenKey = `${openKey}:nested-open`;
  function initialOpen() {
    const asked = param('open');
    if (asked) return { open: asked.split(',').filter(Boolean), nestedOpen: [] };
    try {
      const kept = JSON.parse(localStorage.getItem(openKey) || '[]');
      const nestedOpen = JSON.parse(localStorage.getItem(nestedOpenKey) || '[]');
      if (Array.isArray(kept)) return {
        open: kept.map(String),
        nestedOpen: Array.isArray(nestedOpen) ? nestedOpen.map(String) : [],
      };
      return {
        open: Array.isArray(kept.open) ? kept.open.map(String) : [],
        nestedOpen: Array.isArray(kept.nestedOpen) ? kept.nestedOpen.map(String) : [],
      };
    } catch {
      return { open: [], nestedOpen: [] };
    }
  }
  function saveOpen() {
    try {
      localStorage.setItem(openKey, JSON.stringify([...ui.open]));
      localStorage.setItem(nestedOpenKey, JSON.stringify([...ui.openFrames]));
    } catch {
      // Blocked storage keeps the choice for this load only.
    }
  }
  const savedOpen = initialOpen();
  ui.open = new Set(savedOpen.open);
  ui.openFrames = new Set(savedOpen.nestedOpen);

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
  function childrenOf(it) {
    const parents = memberStates(it);
    const screens = new Set(it.members.flatMap(m => [m.state.screen, m.parent?.screen, m.base?.screen])
      .filter(Boolean).map(screen => screen.id));
    const seen = new Set();
    return [...screens].flatMap(itemsOf).filter((child) => {
      if (parents.has(child.state.id)) return false;
      if (seen.has(child.state.id)) return false;
      seen.add(child.state.id);
      return child.members.some(m => parents.has((m.parent || m.base)?.id));
    });
  }
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
  function itemSpec(box, it, ancestors = new Set()) {
    const { w, ih } = boxDims(ui.orient);
    const own = memberStates(it);
    const path = new Set([...ancestors, ...own]);
    const children = childrenOf(it).filter(child =>
      !child.members.some(m => path.has(m.state.id)));
    const nested = children.map(child => itemSpec(box, child, path));
    const states = new Set(own);
    for (const child of nested) for (const state of child.states) states.add(state);
    const open = children.length > 0 && ui.openFrames.has(it.state.id);
    const spec = {
      id: `${box}/${it.state.id}`, item: it, cardW: w, cardH: ih,
      stateId: it.state.id, caption: children.length > 0, open, states, children: open ? nested : [],
      hasChildren: children.length > 0, childCount: children.length,
      layers: Math.min(it.members.length - 1, 3),
    };
    const pin = ui.nestedPin.find(item => item.screen === box && item.parent === it.state.id);
    if (pin) spec.pin = pin;
    return open ? withFlows(spec) : spec;
  }
  function rootItemsOf(id) {
    const items = itemsOf(id);
    const roots = new Set(ownOf(id).members.map(m => m.state.id));
    if (!roots.size) return items;
    return items.filter(it => it.members.some(m => roots.has((m.parent || m.base)?.id)));
  }
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
  const baseStates = new Set((model.settingStates || []).filter(r => Number(r.original) === 1 && r.state).map(r => r.state));
  function boxSpec(id) {
    const items = rootItemsOf(id);
    const { w, ih } = boxDims(ui.orient);
    const states = new Set(id === OUTSIDE
      ? outside.flatMap(x => x.renditions.map(r => r.id))
      : model.renditions.filter(r => r.screen && drawnId(r.screen.id) === id).map(r => r.id));
    const rowOpen = items.length > 0 && ui.open.has(id);
    const children = rowOpen ? items.map(it => itemSpec(id, it)) : [];
    const spec = {
      id, cardW: w, cardH: id === OUTSIDE && !groupTall(ui.orient) ? EXT_H : ih, caption: items.length > 0,
      open: rowOpen, states, count: items.length, children,
    };
    const pin = ui.nestedPin.find(item => item.screen === id && item.parent === null);
    if (pin) spec.pin = pin;
    return rowOpen && id !== OUTSIDE ? withFlows(spec) : spec;
  }
  function frameSizes() {
    frames.clear();
    for (const id of rows.flatMap(r => r.ids)) {
      const spec = boxSpec(id);
      const owners = new Map();
      const index = node => {
        for (const state of node.states) owners.set(state, node);
        for (const child of node.children || []) index(child);
      };
      index(spec);
      for (const edge of view.edges) {
        const owner = owners.get(edge.src);
        if (owner && owner === owners.get(edge.dst) && id !== OUTSIDE) {
          owner.selfRoutes = true;
        }
      }
      frames.set(id, nodeLayout(spec));
    }
    return frames;
  }
  function relayout(orient) {
    const g = layout(rows, orient, { tallExternal: tallExternal(orient), frames: frameSizes() });
    return indexFrameGeometry(g);
  }
  function indexFrameGeometry(g) {
    g.anchors = new Map();
    g.solids = [];
    for (const [id, f] of frames) {
      const box = g.pos.get(id);
      if (!box) continue;
      for (const [aid, r] of anchorRects(f, box.x, box.y)) g.anchors.set(aid, { ...r, box: id });
      if (f.frame) g.solids.push(
        ...solidRects(f, box.x, box.y),
        ...labelRects(f, box.x, box.y),
        ...nestedFrameRects(f, box.x, box.y),
      );
    }
    return g;
  }
  function refreshScene() {
    for (let pass = 0; pass < 2; pass += 1) {
      sc = scene(view.model, rows, geo, { drawnAs, names, anchorOf: anchorFor, stateAnchorOf: stateAnchorFor });
      const labels = sc.costs.map(cost => {
        const chip = chips.get(cost.key);
        if (chip?.isConnected) {
          const width = chipWidth(chip.firstChild.textContent);
          return {
            x: parseFloat(chip.style.left) - width / 2,
            y: parseFloat(chip.style.top) - 9,
            w: width,
            h: 18,
          };
        }
        const width = chipWidth(cost.text);
        return { x: cost.x - width / 2, y: cost.y - 9, w: width, h: 18 };
      });
      let adjusted = false;
      for (const [id, frame] of frames) {
        const box = geo.pos.get(id);
        if (box && frame.frame) adjusted = avoidArrowLabels(frame, labels, box.x, box.y) || adjusted;
      }
      if (!adjusted) break;
      indexFrameGeometry(geo);
    }
    sc = scene(view.model, rows, geo, { drawnAs, names, anchorOf: anchorFor, stateAnchorOf: stateAnchorFor });
  }
  function pinExpandedFrame(g, id, card, previous) {
    const frame = frames.get(id);
    const box = g.pos.get(id);
    if (!frame || !frame.frame || !box || !card) return false;
    const parentRow = rows.findIndex(row => row.ids.includes(id));
    box.x = card.x - frame.card.x;
    box.y = card.y - frame.card.y;
    for (const [other, old] of previous) {
      if (other === id) continue;
      const unchanged = g.pos.get(other);
      if (!unchanged) continue;
      const row = rows.findIndex(item => item.ids.includes(other));
      if (parentRow >= 0 && row > parentRow) {
        unchanged.x = old.x;
      } else if (old.y + old.h <= card.y) {
        unchanged.x = old.x;
        unchanged.y = old.y;
      }
    }
    indexFrameGeometry(g);
    return true;
  }
  function initialGeometry() {
    const topLevel = new Set(rows.flatMap(row => row.ids));
    const requested = [...ui.open];
    ui.open = new Set(requested.filter(id => !topLevel.has(id)));
    let g = relayout(ui.orient);
    for (const id of requested) {
      if (!topLevel.has(id)) continue;
      const box = g.pos.get(id);
      if (!box) continue;
      const frame = frames.get(id);
      const card = {
        x: box.x + (frame?.card.x || 0),
        y: box.y + (frame?.card.y || 0),
      };
      const previous = new Map([...g.pos].map(([key, pos]) => [key, { ...pos }]));
      ui.open.add(id);
      const next = relayout(ui.orient);
      pinExpandedFrame(next, id, card, previous);
      g = next;
    }
    return g;
  }
  function anchorFor(r, card = false) {
    if (!r || !r.screen) return null;
    const box = drawnId(r.screen.id);
    const f = frames.get(box);
    return f ? anchorOf(f, r.id, { card }) : box;
  }
  function stateAnchorFor(r) { return anchorFor(r, true); }
  const edgeKey = e => {
    const sameBox = drawnId(e.srcRendition?.screen.id) === drawnId(e.dstRendition?.screen.id);
    const anchor = sameBox ? stateAnchorFor : anchorFor;
    return `${anchor(e.srcRendition)}>${anchor(e.dstRendition)}`;
  };

  const substatesText = n => `${n} ${n === 1 ? 'substate' : 'substates'}`;
  const rowCards = id => rootItemsOf(id).length;
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
      const pic = screenCapture(state, s, orient, tone, '', ui.locale);
      return pic.url ? { url: pic.url, run: run.id } : null;
    }
    const c = fromRuns[s.id];
    if (!c || (c.orientation || 'portrait') !== orient) return null;
    if (c.appearance && c.appearance !== tone) return null;
    if (ui.locale && c.locale && c.locale !== ui.locale) return null;
    return { url: state.source.url + c.screen, run: c.run };
  }
  const tallExternal = orient => model.externalScreens.some(s => ['dark', 'light']
    .some(t => ownShot(s, orient, t)));

  function ownShot(s, orient, tone) {
    const pic = screenCapture(state, s, orient, tone, '', ui.locale);
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
  function groupPreview(orient, tone) {
    return [launcher, ...outside].filter(Boolean)
      .map(screen => ({ screen, shot: extShot(screen, orient, tone) }))
      .find(item => item.shot) || null;
  }
  const groupTall = orient => ['dark', 'light'].some(t => outside.some(s => extShot(s, orient, t)));
  const outsideKids = outside.map(s => ({
    kind: 'external', role: 'external', external: s, name: s.name || s.id,
    state: s.renditions[0] || { id: s.id, screen: s }, parent: null, base: null,
  }));
  const { rows, drawnAs } = mapRows(model, ranked, {
    grouped: outside.length > 1,
    externalIds: outside.map(s => s.id),
  });
  const drawnId = id => (id && drawnAs.get(id)) || id;
  const names = new Map([[OUTSIDE, 'Outside the app'], ...model.screens.map(s => [s.id, s.name || s.id])]);
  if (outside.length === 1) names.set(outside[0].id, 'Outside the app');
  let geo = initialGeometry();
  let sc;

  const stackLayer = el('div', { class: 'stacks', 'aria-hidden': 'true' });
  const routes = svgEl('svg', { class: 'routes', 'aria-hidden': 'true' });
  const litLayer = svgEl('g', { class: 'litlayer' });
  const pulseCanvas = el('canvas', { class: 'flow', 'aria-hidden': 'true' });
  const frameCanvas = el('canvas', { class: 'flow', 'aria-hidden': 'true' });
  const hitLayer = el('div', { class: 'route-hits', 'aria-hidden': 'true' });
  const world = el('div', { class: 'world' }, routes);
  const stage = el('div', { class: 'stage' }, world);
  let worldMotion = null;
  const insp = el('aside', { class: 'insp' });
  let inspectorClose = null;
  const dock = el('div', { class: 'map-dock' });
  const main = el('div', { class: 'main' }, stage, dock);
  const zoomLabel = el('span', { class: 'ro', text: '100%' });
  const mini = el('div', { class: 'mini' });

  const groups = new Map();   // route key -> <g>
  const routeExits = new Map(); // route key -> outgoing transition copies
  const boxes = new Map();    // screen id -> .box
  const stacks = new Map();   // screen id -> .bstack
  const chips = new Map();    // route key -> .cost
  const hits = new Map();     // route key -> transparent self-loop hit target
  const kidCards = new Map(); // screen id -> the display state cards in its frame
  let dividerNodes = [];
  let pulse = null;
  let framePulse = null;
  let framePulsePaths = [];
  const accent = new Map();   // route key -> its accent path, heads and reveal
  // What `paint` last lit, so a hover can touch the delta instead of every node.
  let litNow = new Set();
  refreshScene();

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
  let routeTransitionSeq = 0;

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
    const anim = svgEl('path', {
      d: p.d, class: 'anim', mask: `url(#${id})`, 'data-accent-route': p.key,
    });
    const head = svgEl('path', {
      d: p.head, class: 'head top', 'data-accent-route': p.key,
    });
    const head2 = p.twoWay ? svgEl('path', {
      d: p.head2, class: 'head top', 'data-accent-route': p.key,
    }) : null;
    const a = { mask, reveal, anim, head, head2, path: p, shown: false };
    hideAccent(a);
    return { g, a, lit: [mask, anim, head, head2].filter(Boolean) };
  }

  function chipOf(c) {
    const chip = el('div', {
      class: 'cost',
      'data-route': c.key,
      style: `left:${c.x}px; top:${c.y}px`,
    }, c.text);
    chip.key = c.key;
    bindRouteChip(chip, c.key, c.groups, c.text);
    // A chip sets `hot` with no screen: nothing gets the `hov` border sweep.
    chip.addEventListener('pointerenter', () => setHot({ key: chip.key, id: null }));
    chip.addEventListener('pointerleave', () => setHot(null));
    return chip;
  }

  function bindRouteChip(chip, key, groups, count) {
    chip.dataset.routeDetail = key;
    chip.routeDetailKey = key;
    chip.routeGroups = groups;
    chip.setAttribute('role', 'button');
    chip.tabIndex = 0;
    const label = `Show all ${count} actions for this route`;
    chip.setAttribute('aria-label', label);
    chip.setAttribute('data-tip', 'Show Actions');
    const open = (event) => {
      event.stopPropagation();
      openRouteDetails(chip.routeDetailKey, chip.routeGroups);
    };
    chip.addEventListener('click', open);
    chip.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open(event);
    });
  }

  function syncHits() {
    const active = new Set();
    for (const c of sc.costs) {
      if (!c.hit) continue;
      active.add(c.key);
      let hit = hits.get(c.key);
      if (!hit) {
        hit = el('div', { class: 'route-hit-loop', 'data-route': c.key, 'aria-hidden': 'true' });
        hit.addEventListener('pointerenter', () => setHot({ key: c.key, id: null }));
        hit.addEventListener('pointerleave', () => {
          if (!chips.get(c.key)?.matches(':hover')) setHot(null);
        });
        hits.set(c.key, hit);
        hitLayer.append(hit);
      }
      hit.style.cssText = `left:${c.hit.x}px; top:${c.hit.y}px; width:${c.hit.w}px; height:${c.hit.h}px`;
      hit.hidden = chips.get(c.key)?.hidden ?? true;
    }
    for (const [key, hit] of hits) if (!active.has(key)) {
      hit.remove();
      hits.delete(key);
    }
  }

  /* The moving dots of every arrow inside an open frame, in world coordinates. They sit on a
     canvas above the boxes, because a box paints over the canvas the map's own routes use. */
  let frameBorder = null;
  function frameBorderInset() {
    const dpr = window.devicePixelRatio || 1;
    if (frameBorder?.dpr !== dpr) {
      const probe = el('div', { style: 'position:absolute; visibility:hidden; border:1px solid;' });
      document.body.append(probe);
      frameBorder = { dpr, width: parseFloat(getComputedStyle(probe).borderLeftWidth) };
      probe.remove();
    }
    return frameBorder.width;
  }
  function framePulses() {
    const out = [];
    const walk = (box, n, ox, oy) => {
      if (!n.frame) return;
      const move = seg => seg.map(q => ({ x: q.x + ox, y: q.y + oy }));
      for (const a of n.arrows) out.push({ key: markKey(box, n, 'a', a), segs: a.segs.map(move) });
      for (const k of n.children) walk(box, k,
        ox + k.x - (k.frame ? k.card.x : 0),
        oy + k.y - (k.frame ? k.card.y : 0));
    };
    for (const [box, f] of frames) {
      const at = geo.pos.get(box);
      const node = boxes.get(box);
      const style = node && getComputedStyle(node);
      const border = frameBorderInset();
      if (at) walk(box, f, at.x + (parseFloat(style?.borderLeftWidth) || border),
        at.y + (parseFloat(style?.borderTopWidth) || border));
    }
    return out.map((u, i) => ({ ...u, delay: -((i * 0.37) % 2.6) }));
  }
  const markKey = (box, n, kind, a) => `${box}|${n.id}|${kind}|${a.id}`;

  function startFlows() {
    if (pulse) pulse.stop();
    if (framePulse) framePulse.stop();
    const labels = [...frames].flatMap(([id, frame]) => {
      const at = geo.pos.get(id);
      const node = boxes.get(id);
      const style = node && getComputedStyle(node);
      return at ? labelRects(frame,
        at.x + (parseFloat(style?.borderLeftWidth) || frameBorderInset()),
        at.y + (parseFloat(style?.borderTopWidth) || frameBorderInset())) : [];
    });
    pulse = flow(pulseCanvas, sc.pulses, labels);
    framePulsePaths = framePulses();
    framePulse = flow(frameCanvas, framePulsePaths, labels);
  }

  function hideFrameBeads(prefix) {
    for (const { key } of framePulsePaths) {
      if (key.startsWith(prefix)) framePulse?.set(key, 'hidden');
    }
  }

  function hideMovingBeads(previousScene) {
    const currentPaths = new Map(sc.paths.map(path => [path.key, path.d]));
    for (const path of previousScene.paths) {
      if (currentPaths.get(path.key) !== path.d) pulse?.set(path.key, 'hidden');
    }
    const currentFramePaths = new Map(framePulses().map(path => [path.key, JSON.stringify(path.segs)]));
    for (const path of framePulsePaths) {
      if (currentFramePaths.get(path.key) !== JSON.stringify(path.segs)) {
        framePulse?.set(path.key, 'hidden');
      }
    }
  }

  /* Create every node once, from a scene computed with nothing selected. */
  function build() {
    refreshScene();
    groups.clear();
    boxes.clear();
    stacks.clear();
    chips.clear();
    hits.clear();
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
      const selectable = id === OUTSIDE
        ? groupPreview(ui.orient, ui.tone)?.screen || launcher || outside[0] || null
        : s;
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
      if (boxTitle(id)) node.setAttribute('data-tip', boxTitle(id));
      if (!(s && s.isExternal) || outside.length === 1) {
        const surface = shotSurface('bface', name, shotCount(id), () => {
          if (selectable) select(ui.sel === selectable.id ? null : selectable.id);
        });
        node.face = surface.picture;
        node.info = surface.info;
        node.append(node.face, node.info);
        if (rootItemsOf(id).length) {
          node.cap = el('button', {
            class: 'scap',
            type: 'button',
            'aria-label': `Expand ${substatesText(rowCards(id))} of ${name}`,
            'data-tip': `Expand ${substatesText(rowCards(id))}`,
          }, substatesText(rowCards(id)), icon('expand', 14));
          node.cap.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleOpen(id);
          });
          node.insertBefore(node.cap, node.info);
        }
      }
      node.addEventListener('click', (e) => {
        if (frames.has(id) && !e.target.closest('.bface')) return;
        if (selectable) select(ui.sel === selectable.id ? null : selectable.id);
      });
      if (node.face) {
        node.face.addEventListener('pointerenter', () => { ui.hover = id; paint(); });
        node.face.addEventListener('pointerleave', () => { ui.hover = null; paint(); });
      }
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
    setChildren(hitLayer);
    syncHits();
    setChildren(world, stackLayer, routes, pulseCanvas, overlay, hitLayer, frameCanvas);
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
    const preview = groupPreview(ui.orient, ui.tone);
    setShotChildren(node.face, preview && f.card.h > EXT_H
      ? el('img', { class: 'bi', src: preview.shot.url, alt: '', loading: 'lazy' })
      : el('div', { class: 'bx', style: `height:${f.card.h}px` }));
  }

  /* A screen's picture is its base state's. */
  function paintFace(s, node) {
    // No fallback to the other tone. A dark screenshot shown while the
    // toolbar says light is the viewer inventing evidence.
    const pic = screenCapture(state, s, ui.orient, ui.tone, (ownOf(s.id).lead || { state: {} }).state.id, ui.locale);
    setShotChildren(node.face, pic.url
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
        const picture = shot
          ? el('img', { class: 'bi', src: shot.url, alt: '', loading: 'lazy' })
          : el('div', { class: 'bx', style: `height:${box.h}px` },
            el('span', { class: 'bx-p', text: s.package }));
        if (node.face) {
          setShotChildren(node.face, picture);
          setShotInfo(node.info, names.get(s.id) || s.id, standsFor(s.id));
          node.face.setAttribute('aria-label', shotLabel(names.get(s.id) || s.id, standsFor(s.id)));
        } else {
          setChildren(node, picture);
        }
        continue;
      }
      paintFace(s, node);
      const title = boxTitle(s.id);
      if (title) node.setAttribute('data-tip', title);
      else node.removeAttribute('data-tip');
      setShotInfo(node.info, names.get(s.id) || s.id, standsFor(s.id));
      node.face.setAttribute('aria-label', shotLabel(names.get(s.id) || s.id, standsFor(s.id)));
    }
  }

  function frameFadeElements(row) {
    return [
      ...row.querySelectorAll('.frame-outline, .fbracket, .cost, .frame-close'),
    ].filter(Boolean);
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
    node.face.setAttribute('style', `left:${card.x}px; top:${card.y}px; width:${card.w}px; height:${card.shotH ?? card.h}px`);
    if (node.info) node.info.setAttribute('style', `left:${card.x}px; top:${card.y}px; width:${card.w}px; height:${card.shotH ?? card.h}px`);
    const open = Boolean(f && f.frame);
    if (node.cap) {
      node.cap.setAttribute('style', `left:${f.caption.x}px; top:${f.caption.y}px; width:${f.caption.w}px; height:${f.caption.h}px`);
      node.cap.setAttribute('aria-expanded', open ? 'true' : 'false');
      node.cap.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${substatesText(rowCards(id))} of ${names.get(id) || id}`);
      node.cap.setAttribute('data-tip', `${open ? 'Collapse' : 'Expand'} ${substatesText(rowCards(id))}`);
      node.cap.replaceChildren(substatesText(rowCards(id)), icon(open ? 'contract' : 'expand', 14));
    }
    node.classList.toggle('open', open);
    const sig = n => [n.id, n.frame, n.w, n.h, n.x, n.y, n.children.map(sig)];
    const key = open ? JSON.stringify(sig(f)) : '';
    const previousKey = node.rowKey || '';
    const rowChanged = key !== previousKey;
    const reuseClosingRow = open && node.closingRow && node.closingRowKey === key;
    if (rowChanged) {
      clearTimeout(node.closing);
      clearTimeout(node.dealing);
    }
    if (open) {
      if (rowChanged) {
        node.classList.remove('closing');
        if (animate && !reducedMotion()) {
          node.classList.add('dealing');
          node.dealing = setTimeout(() => node.classList.remove('dealing'),
            frameMotionDuration(frameCardCount(f)));
        } else {
          node.classList.remove('dealing');
        }
      }
      if (node.closingRow && !reuseClosingRow) {
        for (const card of node.closingRow.cards || []) {
          for (const animation of card.getAnimations()) {
            if (animation.effect?.getKeyframes().some(frame => Object.hasOwn(frame, 'transform'))) {
              animation.cancel();
            }
          }
        }
        node.closingRow.remove();
        node.closingRow = null;
        node.closingRowKey = null;
      }
      if (!node.close) {
        node.close = el('button', {
          class: 'frame-close',
          type: 'button',
          'aria-label': `Collapse substates of ${names.get(id) || id}`,
          'data-tip': 'Collapse substates',
          style: animate && !reducedMotion() ? 'opacity:0' : null,
        }, icon('contract', 14));
        node.close.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleOpen(id);
        });
        node.append(node.close);
      }
    } else if (node.close && (!animate || (!node.row && !node.closingRow))) {
      node.close.remove();
      node.close = null;
    }
    if (!rowChanged) return;
    if (reuseClosingRow) {
      node.row = node.closingRow;
      node.closingRow = null;
      node.closingRowKey = null;
      node.row.classList.remove('contracting');
      node.row.classList.add('in');
      node.row.reopening = true;
      for (const [element, opacity] of node.row.fadeStarts || []) element.style.opacity = opacity;
      node.row.style.removeProperty('left');
      node.row.style.removeProperty('top');
      node.row.append(node.close);
      node.rowKey = key;
      kidCards.set(id, node.row.cards);
      node.openingRow = node.row;
      paintKids();
      paintFrames();
      return;
    }
    node.rowKey = key;
    if (node.row) {
      const gone = node.row;
      gone.fadeStarts ||= new Map(
        frameFadeElements(gone)
          .map(element => [element, getComputedStyle(element).opacity]),
      );
      gone.classList.remove('in');
      kidCards.delete(id);
      node.row = null;
      if (open) gone.remove();
      else if (animate && (!node.finishCloseImmediately || node.finishCloseTransition)) {
        node.classList.add('closing');
        if (!reducedMotion()) node.classList.add('dealing');
        if (node.finishCloseTransition) gone.classList.add('contracting');
        node.closingRow = gone;
        node.closingRowKey = previousKey;
        node.closing = setTimeout(() => {
          if (node.closingRow !== gone) return;
          gone.remove();
          node.closingRow = null;
          node.closingRowKey = null;
          node.classList.remove('closing');
          node.classList.remove('dealing');
          if (!node.classList.contains('open') && node.close) {
            node.close.remove();
            node.close = null;
          }
        }, reducedMotion() ? 0 : node.finishCloseTransition
          ? REFLOW_MS : frameMotionDuration(gone.cards?.length || 0));
      } else {
        gone.remove();
        node.closingRowKey = null;
        node.classList.remove('closing');
        node.classList.remove('dealing');
        if (node.finishCloseImmediately && node.close) {
          node.close.remove();
          node.close = null;
        }
        node.finishCloseImmediately = false;
      }
    }
    if (!open) return;
    const cards = [];
    const marks = [];
    node.row = el('div', {
      class: 'fgraph in',
      style: `width:${f.w}px; height:${f.h}px; right:auto; bottom:auto`,
    }, frameInner(id, f, cards, marks, animate, node.face, frameCardCount(f)));
    if (node.close) node.row.append(node.close);
    node.row.cards = cards;
    node.row.marks = marks;
    if (animate && !reducedMotion()) {
      for (const element of frameFadeElements(node.row)) {
        if (element) element.style.opacity = '0';
      }
    }
    node.append(node.row);
    kidCards.set(id, cards);
    paintKids();
    paintFrames();
    if (animate) node.openingRow = node.row;
  }

  function routeGeometryWithoutFrame(id, nestedState = null) {
    const previousGeo = geo;
    const previousScene = sc;
    const previousFrames = new Map(frames);
    const rootWasOpen = ui.open.delete(id);
    const nestedWasOpen = nestedState !== null && ui.openFrames.delete(nestedState);
    try {
      geo = relayout(ui.orient);
      refreshScene();
      return new Map(sc.paths.map(path => [path.key, path.d]));
    } finally {
      if (rootWasOpen) ui.open.add(id);
      if (nestedWasOpen) ui.openFrames.add(nestedState);
      frames.clear();
      for (const [frameId, frame] of previousFrames) frames.set(frameId, frame);
      geo = previousGeo;
      sc = previousScene;
    }
  }

  function routeKeysForFrameTransition(paths, id, nestedState = null) {
    const anchors = frameTransitionAnchors(id, nestedState);
    return new Set(paths.filter(path => anchors.has(path.from) || anchors.has(path.to))
      .map(path => path.key));
  }

  function frameTransitionAnchors(id, nestedState = null) {
    const roots = rootItemsOf(id);
    const stateIds = new Set();
    const seen = new Set();
    const collect = item => {
      if (seen.has(item.state.id)) return;
      seen.add(item.state.id);
      for (const member of item.members || [item]) {
        if (member.state?.id) stateIds.add(member.state.id);
      }
      for (const child of childrenOf(item)) collect(child);
    };
    const find = items => {
      for (const item of items) {
        if (memberStates(item).has(nestedState)) return item;
        const child = find(childrenOf(item));
        if (child) return child;
      }
      return null;
    };
    if (nestedState === null) {
      roots.forEach(collect);
    } else {
      const owner = find(roots);
      if (owner) collect(owner);
      stateIds.add(nestedState);
    }
    const anchors = new Set(stateIds);
    for (const stateId of stateIds) {
      anchors.add(`${id}/${stateId}`);
      anchors.add(`frame:${id}/${stateId}`);
    }
    if (nestedState === null) anchors.add(id);
    return anchors;
  }

  function frameMarksForTransition(node, nestedState, includeClosingRows = false) {
    if (!node) return [];
    const anchors = frameTransitionAnchors(node.dataset.screen, nestedState);
    const rows = [node.row, ...(includeClosingRows ? [node.closingRow] : [])].filter(Boolean);
    return [...new Set(rows.flatMap(row => row.marks || []))]
      .filter(mark => mark.touch.some(id => anchors.has(id))
        && (nestedState === null || mark.frameId !== `${node.dataset.screen}/${nestedState}`));
  }

  function animateFrameMark(mark, opacity, delay = 0) {
    clearTimeout(mark.frameRouteTimer);
    mark.frameRouteTimer = null;
    if (delay > 0) {
      const timer = setTimeout(() => {
        if (mark.frameRouteTimer !== timer) return;
        mark.frameRouteTimer = null;
        animateFrameMark(mark, opacity);
      }, delay);
      mark.frameRouteTimer = timer;
      return;
    }
    const elements = [mark.g, mark.label,
      mark.accent.anim, mark.accent.head, mark.accent.head2]
      .filter(element => element?.isConnected
        && (!element.hidden || element === mark.g)
        && (element === mark.g || element === mark.label
          || getComputedStyle(element).display !== 'none'));
    for (const element of elements) {
      const from = getComputedStyle(element).opacity;
      element.frameRouteFade?.cancel();
      const animation = element.animate([{ opacity: from }, { opacity }], {
        duration: FRAME_ROUTE_FADE_MS,
        delay,
        easing: 'ease',
        fill: 'both',
      });
      element.frameRouteFade = animation;
      animation.finished.then(() => {
        if (element.frameRouteFade !== animation) return;
        element.frameRouteFade = null;
        element.style.removeProperty('opacity');
        animation.cancel();
      }).catch(() => {});
    }
    if (opacity === '0') framePulse?.set(mark.key, 'hidden');
  }

  function transitionFrameMarks(node, nestedState, opacity, delay = 0, includeClosingRows = false) {
    for (const mark of frameMarksForTransition(node, nestedState, includeClosingRows)) {
      animateFrameMark(mark, opacity, delay);
    }
  }

  function restoreClosingRouteFades(node, animate = false, routeDelay = 0) {
    const entries = node.routeFadeEntries || [];
    if (!entries.length) return;
    for (const entry of entries) {
      const from = getComputedStyle(entry.element).opacity;
      for (const animation of entry.element.getAnimations()) {
        if (animation.transitionProperty === 'opacity'
          || animation.effect?.getKeyframes().some(frame => Object.hasOwn(frame, 'opacity'))) {
          animation.cancel();
        }
      }
      for (const [property, value, priority] of entry.styles) {
        if (animate && property === 'opacity') continue;
        if (value) entry.element.style.setProperty(property, value, priority);
        else entry.element.style.removeProperty(property);
      }
      if (!animate) continue;
      entry.element.style.setProperty('transition', 'none');
      entry.element.style.setProperty('opacity', from);
      const animation = routeReveal(entry.element, from, entry.opacity, routeDelay, animate);
      entry.restoreAnimation = animation;
      animation.finished.then(() => {
        if (entry.restoreAnimation !== animation) return;
        entry.restoreAnimation = null;
        for (const [property, value, priority] of entry.styles) {
          if (value) entry.element.style.setProperty(property, value, priority);
          else entry.element.style.removeProperty(property);
        }
        animation.cancel();
        if (node.routeFadeEntries === entries
          && entries.every(item => !item.restoreAnimation)) node.routeFadeEntries = null;
      }).catch(() => {
        if (entry.restoreAnimation === animation) entry.restoreAnimation = null;
      });
    }
    if (!animate) node.routeFadeEntries = null;
  }

  function fadeRoutesLeavingFrame(id, node, nestedState = null, framePath = null) {
    restoreClosingRouteFades(node);
    const remaining = routeGeometryWithoutFrame(id, nestedState);
    const connected = routeKeysForFrameTransition(sc.paths, id, nestedState);
    for (const path of sc.paths) {
      if (connected.has(path.key) || remaining.get(path.key) !== path.d) {
        pulse?.set(path.key, 'hidden');
      }
    }
    hideFrameBeads(framePath ? `${id}|${framePath}|` : `${id}|`);
    const entries = [];
    for (const path of sc.paths) {
      if (!connected.has(path.key) && remaining.get(path.key) === path.d) continue;
      const a = accent.get(path.key);
      const accentElements = a?.shown
        ? [a.anim, a.head, a.head2].filter(element => element
          && getComputedStyle(element).display !== 'none')
        : [];
      for (const element of [groups.get(path.key), chips.get(path.key), ...accentElements]
        .filter(Boolean)) {
        const styles = ['opacity', 'transition', 'pointer-events'].map(property => [
          property,
          element.style.getPropertyValue(property),
          element.style.getPropertyPriority(property),
        ]);
        const opacity = getComputedStyle(element).opacity;
        element.style.setProperty('transition', `opacity ${FRAME_ROUTE_FADE_MS}ms ease`);
        element.style.setProperty('opacity', opacity);
        void getComputedStyle(element).opacity;
        element.style.setProperty('opacity', '0');
        element.style.setProperty('pointer-events', 'none');
        entries.push({ element, styles, opacity, key: path.key });
      }
    }
    node.routeFadeEntries = entries;
  }

  function cancelNestedClosures(node) {
    for (const closing of node.nestedClosing?.values() || []) clearTimeout(closing.timer);
    node.nestedClosing?.clear();
    for (const mark of [...(node.row?.marks || []), ...(node.closingRow?.marks || [])]) {
      clearTimeout(mark.frameRouteTimer);
      mark.frameRouteTimer = null;
    }
    for (const frame of node.row?.querySelectorAll('.nested-frame') || []) {
      restoreClosingRouteFades(frame);
    }
  }

  function collapseNestedFrames(id) {
    const seen = new Set();
    const visit = item => {
      const stateId = item.state.id;
      if (seen.has(stateId)) return;
      seen.add(stateId);
      ui.openFrames.delete(stateId);
      for (const child of childrenOf(item)) visit(child);
    };
    for (const item of rootItemsOf(id)) visit(item);
  }

  function toggleOpen(id, anchor = id) {
    const node = boxes.get(id);
    if (node?.pendingClose && node.row && !reducedMotion()) {
      cancelNestedClosures(node);
      clearTimeout(node.closing);
      clearTimeout(node.dealing);
      node.pendingClose = false;
      node.classList.remove('closing', 'dealing');
      node.row.reopening = true;
      node.row.fadeStarts = new Map(
        frameFadeElements(node.row).map(element => [element, getComputedStyle(element).opacity]),
      );
      node.row.classList.add('in');
      const plan = prepareFrameCards(node, node.row, false);
      animateFrameCards(plan);
      restoreClosingRouteFades(node, true, plan.routeDelay);
      return;
    }
    if (ui.open.has(id) && node?.row && !reducedMotion()) {
      cancelNestedClosures(node);
      node.pendingClose = true;
      clearTimeout(node.dealing);
      node.classList.add('closing', 'dealing');
      node.row.fadeStarts = new Map(
        frameFadeElements(node.row).map(element => [element, getComputedStyle(element).opacity]),
      );
      node.row.classList.remove('in');
      fadeRoutesLeavingFrame(id, node);
      const duration = animateFrameCards(
        prepareFrameCards(node, node.row, true),
        'return',
      );
      node.closing = setTimeout(() => {
        if (!node.pendingClose) return;
        node.pendingClose = false;
        node.finishCloseTransition = true;
        ui.open.delete(id);
        saveOpen();
        reflow(anchor);
        node.finishCloseTransition = false;
      }, duration);
      return;
    }
    if (ui.open.has(id)) ui.open.delete(id);
    else {
      collapseNestedFrames(id);
      ui.open.add(id);
      if (node) node.routeTransition = { nestedState: null };
    }
    saveOpen();
    reflow(anchor);
  }

  function toggleNested(id, anchor) {
    const node = boxes.get(anchor);
    const frameId = `${anchor}/${id}`;
    const pinOwner = () => {
      const card = node?.row?.cards?.find(item => item.dataset.kid === id);
      if (!card || !node.face) return [];
      const cardLeft = card.getBoundingClientRect().left;
      const pins = [{
        screen: anchor,
        state: id,
        parent: null,
        offsetX: (cardLeft - node.face.getBoundingClientRect().left) / ui.scale,
      }];
      let parentFrame = card.closest('.nested-frame');
      if (parentFrame?.querySelector(':scope > .kid') === card) {
        parentFrame = parentFrame.parentElement?.closest('.nested-frame') || null;
      }
      while (parentFrame) {
        const parentCard = parentFrame.querySelector(':scope > .kid');
        const prefix = `${anchor}/`;
        if (parentCard && parentFrame.dataset.frame.startsWith(prefix)) {
          pins.push({
            screen: anchor,
            state: id,
            parent: parentFrame.dataset.frame.slice(prefix.length),
            offsetX: (cardLeft - parentCard.getBoundingClientRect().left) / ui.scale,
          });
        }
        parentFrame = parentFrame.parentElement?.closest('.nested-frame') || null;
      }
      return pins;
    };
    const closing = node?.nestedClosing?.get(id);
    if (closing) {
      clearTimeout(closing.timer);
      node.nestedClosing.delete(id);
      ui.nestedPin = [];
      closing.frame.reopening = true;
      closing.frame.fadeStarts = new Map(
        frameFadeElements(closing.frame)
          .map(element => [element, getComputedStyle(element).opacity]),
      );
      const plan = prepareFrameCards(node, closing.frame, false);
      animateFrameCards(plan);
      transitionFrameMarks(node, id, '1', plan.routeDelay);
      restoreClosingRouteFades(closing.frame, true, plan.routeDelay);
      return;
    }
    if (ui.openFrames.has(id)) {
      const frame = [...(node?.row?.querySelectorAll('.nested-frame') || [])]
        .find(candidate => candidate.dataset.frame === frameId);
      if (!frame) return;
      frame.frameStateId = id;
      transitionFrameMarks(node, id, '0', 0, true);
      const nestedPin = pinOwner();
      const ownerCard = frame.querySelector(':scope > .kid');
      frame.cards = (node.row.cards || []).filter(card => frame.contains(card) && card !== ownerCard);
      frame.fadeStarts = new Map(
        frameFadeElements(frame).map(element => [element, getComputedStyle(element).opacity]),
      );
      fadeRoutesLeavingFrame(anchor, frame, id, frameId);
      const plan = prepareFrameCards(node, frame, true);
      const duration = animateFrameCards(plan);
      node.nestedClosing ||= new Map();
      const timer = setTimeout(() => {
        node.nestedClosing.delete(id);
        ui.openFrames.delete(id);
        ui.nestedPin = nestedPin;
        saveOpen();
        reflow(anchor, { animateFrame: false, closingNestedFrame: frame });
      }, duration + 20);
      node.nestedClosing.set(id, { frame, timer });
      return;
    }
    ui.nestedPin = pinOwner();
    ui.openFrames.add(id);
    saveOpen();
    node.openingNestedFrame = id;
    node.routeTransition = { nestedState: id };
    reflow(anchor, { animateFrame: false });
  }

  /* A route whose end moved to another frame or card keeps its node, then fades at its final
     geometry instead of interpolating the SVG path. */
  function syncRoutes(prev) {
    ui.hot = null;
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
    }
    for (const key of gone) {
      if (moved.has(key)) {
        const chip = chips.get(key);
        if (chip) {
          chips.delete(key);
          chip.style.transition = `opacity ${FRAME_PATH_FADE_MS}ms ease`;
          chip.style.pointerEvents = 'none';
          chip.style.opacity = '0';
          setTimeout(() => chip.remove(), FRAME_PATH_FADE_MS);
        }
        continue;
      }
      const a = accent.get(key);
      for (const node of [a.mask, a.anim, a.head, a.head2]) if (node) node.remove();
      accent.delete(key);
      const leaving = [groups.get(key), chips.get(key)].filter(Boolean);
      groups.delete(key);
      chips.delete(key);
      for (const node of leaving) {
        node.style.removeProperty('transition');
        node.style.pointerEvents = 'none';
        node.style.opacity = '0';
        setTimeout(() => node.remove(), FRAME_PATH_FADE_MS);
      }
    }
    const entering = [];
    for (const key of born) {
      if (taken.has(key)) continue;
      const { g, a, lit } = routeNodes(next.get(key));
      routes.insertBefore(g, litLayer);
      litLayer.append(...lit);
      groups.set(key, g);
      accent.set(key, a);
      entering.push(g);
    }
    return entering;
  }

  function changedRouteKeys(previousPaths, nextPaths) {
    const previous = new Map(previousPaths.map(path => [path.key, path.d]));
    const next = new Map(nextPaths.map(path => [path.key, path.d]));
    return new Set([
      ...[...previous].filter(([key, d]) => !next.has(key) || next.get(key) !== d).map(([key]) => key),
      ...[...next].filter(([key, d]) => !previous.has(key) || previous.get(key) !== d).map(([key]) => key),
    ]);
  }

  function routeTransitionSnapshots(keys) {
    return new Map([...keys].flatMap(key => {
      const group = groups.get(key);
      if (!group) return [];
      const chip = chips.get(key);
      const a = accent.get(key);
      const accentMask = a?.shown ? a.mask.cloneNode(true) : null;
      const accentMaskId = accentMask ? `rvt${routeTransitionSeq++}` : null;
      if (accentMask) {
        accentMask.setAttribute('id', accentMaskId);
        const reveal = accentMask.querySelector('.reveal');
        if (reveal) reveal.style.strokeDashoffset = getComputedStyle(a.reveal).strokeDashoffset;
      }
      const visibleAccent = a?.shown
        ? [a.anim, a.head, a.head2].filter(node => node
          && getComputedStyle(node).display !== 'none'
          && Number(getComputedStyle(node).opacity) > 0).map(node => {
          const clone = node.cloneNode(true);
          if (node === a.anim) clone.setAttribute('mask', `url(#${accentMaskId})`);
          clone.removeAttribute('data-accent-route');
          clone.style.removeProperty('transition');
          clone.style.removeProperty('pointer-events');
          clone.style.opacity = getComputedStyle(node).opacity;
          return clone;
        })
        : [];
      const accentGroup = visibleAccent.length
        ? svgEl('g', {
          class: 'route-transition-out route-transition-accent-out',
          'data-route': key,
          'aria-hidden': 'true',
        }, accentMask, ...visibleAccent)
        : null;
      return [[key, {
        opacity: getComputedStyle(group).opacity,
        group: group.cloneNode(true),
        chip: chip?.cloneNode(true) || null,
        chipOpacity: chip ? getComputedStyle(chip).opacity : null,
        accent: accentGroup,
      }]];
    }));
  }

  function fadeRouteChanges(snapshots, changed, nextPaths, targetOpacity, minDelay = 0) {
    const next = new Map(nextPaths.map(path => [path.key, path.d]));
    if (!changed.size) return 0;

    const clearRouteExits = key => {
      for (const element of routeExits.get(key) || []) {
        element.routeOpacityAnimation?.cancel();
        element.remove();
      }
      routeExits.delete(key);
    };
    const cancelOpacityFades = element => {
      for (const animation of element.getAnimations()) {
        if (animation.effect?.getKeyframes().some(frame => Object.hasOwn(frame, 'opacity'))) {
          if (element.routeOpacityAnimation === animation) element.routeOpacityAnimation = null;
          animation.cancel();
        }
      }
    };
    const fadingOut = [];
    for (const key of changed) {
      clearRouteExits(key);
      const snapshot = snapshots.get(key);
      if (!snapshot) continue;
      const group = snapshot.group;
      group.classList.add('route-transition-out');
      group.dataset.routeTransitionKey = key;
      group.removeAttribute('data-route');
      group.setAttribute('aria-hidden', 'true');
      group.style.opacity = snapshot.opacity;
      group.style.pointerEvents = 'none';
      routes.insertBefore(group, litLayer);
      fadingOut.push({ element: group, opacity: snapshot.opacity, key });
      if (snapshot.chip) {
        const chip = snapshot.chip;
        chip.classList.add('route-transition-out');
        chip.dataset.routeTransitionKey = key;
        chip.removeAttribute('data-route');
        chip.setAttribute('aria-hidden', 'true');
        chip.style.opacity = snapshot.chipOpacity;
        chip.style.pointerEvents = 'none';
        world.append(chip);
        fadingOut.push({ element: chip, opacity: snapshot.chipOpacity, key });
      }
      if (snapshot.accent) {
        snapshot.accent.dataset.routeTransitionKey = key;
        snapshot.accent.style.opacity = '1';
        litLayer.append(snapshot.accent);
        fadingOut.push({ element: snapshot.accent, opacity: '1', key });
      }
    }

    const incoming = [];
    for (const key of changed) {
      if (!next.has(key)) continue;
      const group = groups.get(key);
      const chip = chips.get(key);
      for (const element of [group, chip].filter(Boolean)) {
        cancelOpacityFades(element);
        element.style.removeProperty('opacity');
        element.style.removeProperty('transition');
        const opacity = targetOpacity.get(element) ?? getComputedStyle(element).opacity;
        element.style.opacity = '0';
        element.style.transition = 'none';
        incoming.push({ element, opacity });
      }
      const a = accent.get(key);
      for (const element of [a?.anim, a?.head, a?.head2].filter(node => node
        && getComputedStyle(node).display !== 'none')) {
        cancelOpacityFades(element);
        element.style.removeProperty('opacity');
        element.style.removeProperty('transition');
        const opacity = getComputedStyle(element).opacity;
        element.style.opacity = '0';
        element.style.transition = 'none';
        incoming.push({ element, opacity });
      }
    }

    const reduced = reducedMotion();
    const fade = (element, from, to, duration, delay, key = null) => {
      cancelOpacityFades(element);
      const animation = element.animate([{ opacity: from }, { opacity: to }], {
        duration, delay, easing: 'ease', fill: 'both',
      });
      element.routeOpacityAnimation = animation;
      if (key) {
        const exits = routeExits.get(key) || new Set();
        exits.add(element);
        routeExits.set(key, exits);
      }
      animation.finished.then(() => {
        if (element.routeOpacityAnimation !== animation) return;
        element.routeOpacityAnimation = null;
        if (element.classList.contains('route-transition-out')) {
          element.remove();
          const exits = routeExits.get(key);
          exits?.delete(element);
          if (exits?.size === 0) routeExits.delete(key);
        }
        else {
          element.style.removeProperty('opacity');
          element.style.removeProperty('transition');
          element.style.removeProperty('pointer-events');
        }
        animation.cancel();
      }).catch(() => {});
    };
    if (reduced) {
      for (const { element } of fadingOut) element.remove();
      for (const { element } of incoming) {
        element.style.removeProperty('opacity');
        element.style.removeProperty('transition');
      }
      return 0;
    }
    for (const { element, opacity, key } of fadingOut) {
      fade(element, opacity, '0', FRAME_ROUTE_FADE_MS, 0, key);
    }
    const delay = Math.max(fadingOut.length ? FRAME_ROUTE_FADE_MS : 0, minDelay);
    for (const { element, opacity } of incoming) {
      fade(element, '0', opacity, FRAME_ROUTE_FADE_MS, delay);
    }
    return delay + FRAME_ROUTE_FADE_MS;
  }

  function movingMapNodes() {
    // Route chips track scene midpoints; reflow does not measure or transform them with boxes.
    return [...new Set([...boxes.values(), ...stacks.values(), ...dividerNodes])];
  }

  function captureMapRects(nodes) {
    return new Map(nodes.map(node => [node, node.getBoundingClientRect()]));
  }

  function cancelMapMotion(nodes) {
    for (const node of nodes) {
      for (const animation of node.getAnimations()) {
        if (animation.transitionProperty === 'transform'
          || animation.effect?.getKeyframes().some(frame => Object.hasOwn(frame, 'transform'))) {
          animation.cancel();
        }
      }
      node.style.transition = 'none';
      node.style.removeProperty('transform');
    }
  }

  function measureMapMoves(before, anchor) {
    const held = new Set([boxes.get(anchor), stacks.get(anchor)]);
    const moves = [];
    for (const [node] of before) {
      if (!node.isConnected || held.has(node)) continue;
      moves.push({ node, from: before.get(node), to: node.getBoundingClientRect(),
        leaving: node.style.opacity === '0' });
    }
    return moves;
  }

  function animateMapMoves(moves, viewDelta = { x: 0, y: 0 }) {
    const moving = [];
    const animate = !reducedMotion();
    for (const { node, from, to, leaving } of moves) {
      const x = (from.left - to.left - viewDelta.x) / ui.scale;
      const y = (from.top - to.top - viewDelta.y) / ui.scale;
      if (Math.abs(x) < .25 && Math.abs(y) < .25) {
        node.style.removeProperty('transform');
        if (!leaving) node.style.removeProperty('transition');
        continue;
      }
      if (!leaving) node.style.removeProperty('transition');
      if (!leaving && animate) {
        node.animate([
          { transform: `translate(${x}px, ${y}px)` },
          { transform: 'translate(0, 0)' },
        ], { duration: REFLOW_MS, easing: 'cubic-bezier(.2, .8, .2, 1)' });
        moving.push(node);
      }
    }
    return moving;
  }

  function animateClosingScreen(elements, startRects, viewDelta = { x: 0, y: 0 }) {
    if (reducedMotion()) return 0;
    let moved = false;
    for (const element of elements) {
      if (!element?.isConnected) continue;
      const start = startRects.get(element);
      if (!start) continue;
      const target = element.getBoundingClientRect();
      const x = (start.left - target.left - viewDelta.x) / ui.scale;
      const y = (start.top - target.top - viewDelta.y) / ui.scale;
      if (Math.abs(x) < .25 && Math.abs(y) < .25) continue;
      const animation = element.animate([
        { transform: `translate(${x}px, ${y}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration: REFLOW_MS, easing: 'cubic-bezier(.16, 1, .3, 1)', fill: 'both' });
      animation.finished.then(() => animation.cancel()).catch(() => {});
      moved = true;
    }
    return moved ? REFLOW_MS : 0;
  }

  function prepareFrameCards(node, row, closing = false, startRects = null) {
    if (!row) return null;
    const reopening = Boolean(row.reopening);
    const parentPicture = card => card === node.face ? card : card.querySelector('.kshot') || card;
    const frameCards = row.cards || [];
    const cards = frameCards.map((card, order) => {
      const rect = card.getBoundingClientRect();
      const picture = parentPicture(card);
      const pictureRect = picture.getBoundingClientRect();
      const parentRect = parentPicture(card.deal.parentCard || node.face).getBoundingClientRect();
      const start = startRects?.get(card);
      const targetX = parentRect.left + parentRect.width / 2;
      const targetY = parentRect.top + parentRect.height / 2;
      const x = (targetX - (pictureRect.left + pictureRect.width / 2)) / ui.scale;
      const y = (targetY - (pictureRect.top + pictureRect.height / 2)) / ui.scale;
      const stagger = order * FRAME_DEAL_STEP_MS;
      const reverseStagger = (frameCards.length - order - 1) * FRAME_DEAL_STEP_MS;
      const delay = closing ? FRAME_ROUTE_FADE_MS + reverseStagger : stagger;
      const from = (closing || reopening) && start
        ? `translate(${(start.left - rect.left) / ui.scale}px, ${(start.top - rect.top) / ui.scale}px)`
        : closing || reopening ? getComputedStyle(card).transform : `translate(${x}px, ${y}px)`;
      const to = closing ? `translate(${x}px, ${y}px)` : 'translate(0, 0)';
      return { card, delay, from, to };
    });
    const routes = [...row.querySelectorAll('.fbracket, .cost, .frame-close')].map(element => ({
        element,
        from: row.fadeStarts?.get(element) ?? (closing || reopening
          ? getComputedStyle(element).opacity : '0'),
      }));
    const outlines = [...row.querySelectorAll('.frame-outline')].map(element => {
      const container = element.parentElement;
      const owner = container.closest('.nested-frame')?.querySelector(':scope > .kid') || node.face;
      const rect = container.getBoundingClientRect();
      const card = owner.getBoundingClientRect();
      const contracted = `${(card.top - rect.top) / ui.scale}px ${(rect.right - card.right) / ui.scale}px `
        + `${(rect.bottom - card.bottom) / ui.scale}px ${(card.left - rect.left) / ui.scale}px`;
      return { element, contracted,
        from: closing || reopening ? getComputedStyle(element).inset : contracted };
    });
    return {
      row, closing, reopening, cards, routes, outlines,
    };
  }

  function animateFrameCards(plan, phase = plan?.closing ? 'close' : 'open') {
    if (!plan) return 0;
    const { row, reopening, cards, routes, outlines } = plan;
    row.motionGeneration = (row.motionGeneration || 0) + 1;
    const motionGeneration = row.motionGeneration;
    if (phase === 'open' || phase === 'return') {
      for (const { card } of cards) card.classList.remove('returned');
    }
    if (reducedMotion()) {
      row.reopening = false;
      row.fadeStarts = null;
      return 0;
    }
    const animations = [];
    for (const { card, delay, from, to } of (phase === 'contract' ? [] : cards)) {
      for (const animation of card.getAnimations()) {
        if (animation.transitionProperty === 'transform'
          || animation.effect?.getKeyframes().some(frame =>
            Object.hasOwn(frame, 'transform') || Object.hasOwn(frame, 'opacity'))) {
          animation.cancel();
        }
      }
      animations.push(card.animate([{ transform: from }, { transform: to }], {
        duration: FRAME_DEAL_MS,
        delay: delay + (phase === 'open' ? FRAME_OUTLINE_MS : 0),
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      }));
    }
    const cardEnd = Math.max(0, ...animations.map(animation =>
      animation.effect.getComputedTiming().endTime));
    plan.cardEnd = cardEnd;
    if (phase === 'close' || phase === 'return') {
      Promise.all(animations.map(animation => animation.finished)).then(() => {
        if (row.motionGeneration !== motionGeneration) return;
        for (const { card } of cards) card.classList.add('returned');
      }).catch(() => {});
    }
    const routeDelay = phase === 'open' ? cardEnd : 0;
    plan.routeDelay = routeDelay;
    const routeEnd = phase === 'contract' ? 0 : routeDelay + FRAME_ROUTE_FADE_MS;
    const outlineDelay = phase === 'open' || phase === 'contract' ? 0
      : phase === 'close' ? cardEnd : null;
    const outlineDuration = phase === 'contract' ? REFLOW_MS : FRAME_OUTLINE_MS;
    const outlineEnd = outlineDelay === null ? 0 : outlineDelay + outlineDuration;
    const fade = ({ element, from }, delay) => {
      for (const animation of element.getAnimations()) {
        if (animation.effect?.getKeyframes().some(frame => Object.hasOwn(frame, 'opacity'))) animation.cancel();
      }
      element.style.opacity = from;
      const animation = routeReveal(
        element, from, phase === 'open' ? '1' : '0', delay,
        phase === 'open' && reopening,
      );
      element.frameFade = animation;
      animation.finished.then(() => {
        if (element.frameFade !== animation) return;
        element.frameFade = null;
        if (phase !== 'open') element.style.opacity = '0';
        else element.style.removeProperty('opacity');
        animation.cancel();
      }).catch(() => {});
    };
    if (phase !== 'contract') {
      for (const route of routes) {
        fade(route, routeDelay);
      }
    }
    if (outlineDelay !== null) {
      for (const { element, contracted, from } of outlines) {
        for (const animation of element.getAnimations()) animation.cancel();
        element.style.opacity = '1';
        element.animate([{ inset: from }, { inset: phase === 'open' ? '0px' : contracted }], {
          duration: outlineDuration,
          delay: outlineDelay,
          easing: 'cubic-bezier(.16, 1, .3, 1)',
          fill: 'both',
        });
      }
    }
    row.reopening = false;
    row.fadeStarts = null;
    if (phase === 'return') return cardEnd;
    if (phase === 'contract') return REFLOW_MS;
    return Math.max(cardEnd, routeEnd, outlineEnd);
  }

  /* Lay out at final sizes, then move the existing map nodes with transforms. This avoids
     animating width and height while preserving the toggled screen's position. */
  let reflowDone = 0;
  function reflow(anchor, { animateFrame = true, closingNestedFrame = null } = {}) {
    cancelWorldMotion();
    const viewBefore = { tx: ui.tx, ty: ui.ty, scale: ui.scale };
    const closingFrameTransition = Boolean(boxes.get(anchor)?.finishCloseTransition);
    const frameCloseTransition = closingFrameTransition || Boolean(closingNestedFrame);
    const closingRouteOwner = closingFrameTransition ? boxes.get(anchor) : closingNestedFrame;
    const centerNestedCollapse = closingFrameTransition
      && [...ui.openFrames].some(state => frameTransitionAnchors(anchor).has(state));
    const frameGraphTransitions = [];
    for (const [id, node] of boxes) {
      if (node.routeTransition) {
        if (node.routeTransition.nestedState !== null) {
          frameGraphTransitions.push([node, node.routeTransition.nestedState]);
          transitionFrameMarks(node, node.routeTransition.nestedState, '0', 0, true);
        }
      }
    }
    if (closingNestedFrame?.frameStateId) {
      frameGraphTransitions.push([boxes.get(anchor), closingNestedFrame.frameStateId]);
    }
    const closingScreenElements = closingFrameTransition
      ? [...new Set([boxes.get(anchor)?.face, boxes.get(anchor)?.info,
        boxes.get(anchor)?.cap, stacks.get(anchor)].filter(Boolean))]
      : [];
    const closingScreenRects = new Map(closingScreenElements.map(element =>
      [element, element.getBoundingClientRect()]));
    const frameCardRects = new Map();
    for (const [id, node] of boxes) {
      for (const row of [node.row, node.closingRow]) {
        if (!row) continue;
        for (const card of row.cards || []) frameCardRects.set(card, card.getBoundingClientRect());
        row.fadeStarts = new Map(
          frameFadeElements(row)
            .map(element => [element, getComputedStyle(element).opacity]),
        );
      }
    }
    const nodes = movingMapNodes();
    const beforeRects = captureMapRects(nodes);
    const previousPositions = new Map([...geo.pos].map(([id, box]) => [id, { ...box }]));
    const selBefore = ui.sel ? selectedRect() : null;
    let before = cardRect(anchor);
    const prev = sc;
    clearTimeout(reflowDone);
    cancelMapMotion(nodes);
    cancelFrameMotion(anchor, { preserveFinishedReturns: closingFrameTransition });
    geo = initialGeometry();
    ui.nestedPin = [];
    const preserveFrame = (!selBefore || (!ui.selAnchor && drawnId(ui.sel) === anchor))
      && pinExpandedFrame(geo, anchor, before, previousPositions);
    refreshScene();
    if (centerNestedCollapse) {
      const bounds = flowBounds();
      const { w, h } = mapSize();
      ui.tx = w / 2 - (bounds.x + bounds.w / 2) * ui.scale;
      ui.ty = h / 2 - (bounds.y + bounds.h / 2) * ui.scale;
    }
    hideMovingBeads(prev);
    const selAfter = selBefore ? selectedRect() : null;
    let after = cardRect(anchor);
    if (!closingFrameTransition && selBefore && selAfter) {
      before = selBefore;
      after = selAfter;
    }
    if (closingFrameTransition && !centerNestedCollapse && before && after) {
      ui.tx += ((before.x + before.w / 2) - (after.x + after.w / 2)) * ui.scale;
      ui.ty += (before.y - after.y) * ui.scale;
    } else if (!closingFrameTransition && !preserveFrame && before && after) {
      ui.tx += ((before.x + before.w / 2) - (after.x + after.w / 2)) * ui.scale;
      ui.ty += (before.y - after.y) * ui.scale;
    }
    const viewDelta = { x: viewBefore.tx - ui.tx, y: viewBefore.ty - ui.ty };
    stage.classList.add('reflow');
    pulse.hold(true);
    framePulse.hold(true);
    const routeChanges = new Set(changedRouteKeys(prev.paths, sc.paths));
    const frameTransitions = [];
    for (const [id, node] of boxes) {
      if (node.routeTransition) {
        frameTransitions.push([id, node.routeTransition.nestedState]);
        node.routeTransition = null;
      }
      if (node.openingRow || node.closingRow
        || (closingFrameTransition && id === anchor)) {
        frameTransitions.push([id, null]);
      }
      if (node.openingNestedFrame) frameTransitions.push([id, node.openingNestedFrame]);
    }
    if (closingNestedFrame?.frameStateId) {
      frameTransitions.push([anchor, closingNestedFrame.frameStateId]);
    }
    const transitionPaths = [...prev.paths, ...sc.paths];
    for (const [id, nestedState] of frameTransitions) {
      for (const key of routeKeysForFrameTransition(transitionPaths, id, nestedState)) {
        routeChanges.add(key);
      }
    }
    for (const entry of closingRouteOwner?.routeFadeEntries || []) {
      routeChanges.add(entry.key);
    }
    const routeSnapshots = reducedMotion() ? new Map() : routeTransitionSnapshots(routeChanges);
    const entering = syncRoutes(prev);
    const enteringSet = new Set(entering);
    const changedGeometry = [];
    for (const p of sc.paths) {
      const g = groups.get(p.key);
      const line = g && g.children[0];
      if (g && !enteringSet.has(g) && line.getAttribute('d') !== p.d) {
        changedGeometry.push({ group: g, opacity: getComputedStyle(g).opacity });
      }
    }

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
        chip.style.left = `${c.x}px`;
        chip.style.top = `${c.y}px`;
        chip.replaceChildren(document.createTextNode(c.text));
        chip.routeGroups = c.groups;
        const label = `Show all ${c.text} actions for this route`;
        chip.setAttribute('aria-label', label);
        chip.setAttribute('data-tip', 'Show Actions');
        const hit = hits.get(c.key);
        if (hit && c.hit) {
          hit.style.left = `${c.hit.x}px`;
          hit.style.top = `${c.hit.y}px`;
          hit.style.width = `${c.hit.w}px`;
          hit.style.height = `${c.hit.h}px`;
          hit.hidden = chip.hidden;
        }
      } else {
        const made = chipOf(c);
        world.append(made);
        chips.set(c.key, made);
        entering.push(made);
      }
    }
    const enteringOpacity = new Map(entering.map(node => [node, getComputedStyle(node).opacity]));
    for (const entry of closingRouteOwner?.routeFadeEntries || []) {
      enteringOpacity.set(entry.element, entry.opacity);
    }
    if (closingRouteOwner) closingRouteOwner.routeFadeEntries = null;
    syncHits();
    for (const node of entering) {
      node.style.opacity = '0';
      node.style.transition = 'none';
    }
    paint.lastMode = null;
    paint();
    refreshRouteDetails();
    geo.dividers.forEach((dv, i) => {
      if (dividerNodes[i]) dividerNodes[i].setAttribute('style', `left:${dv.x}px; top:${dv.y}px; width:${dv.w}px`);
    });
    for (const id of boxes.keys()) {
      placeBox(id, {
        animate: animateFrame && id === anchor,
      });
    }
    applyTransform();
    if (closingFrameTransition) {
      animateClosingScreen(closingScreenElements, closingScreenRects, viewDelta);
    }
    const closingRow = boxes.get(anchor)?.closingRow;
    const previousBox = previousPositions.get(anchor);
    const nextBox = geo.pos.get(anchor);
    if (closingRow && previousBox && nextBox) {
      closingRow.style.left = `${previousBox.x - nextBox.x}px`;
      closingRow.style.top = `${previousBox.y - nextBox.y}px`;
    }
    const mapMoves = measureMapMoves(beforeRects, anchor);
    const framePlans = [];
    for (const node of boxes.values()) {
      if (node.openingRow) {
        framePlans.push({
          plan: prepareFrameCards(node, node.openingRow, false, frameCardRects),
          phase: 'open',
        });
        node.openingRow = null;
      }
      if (node.closingRow) {
        framePlans.push({
          plan: prepareFrameCards(node, node.closingRow, true, frameCardRects),
          phase: closingFrameTransition && node === boxes.get(anchor) ? 'contract' : 'close',
        });
      }
    }
    const nestedOpeningNode = boxes.get(anchor);
    if (nestedOpeningNode?.openingNestedFrame) {
      const stateId = nestedOpeningNode.openingNestedFrame;
      const frameId = `${anchor}/${stateId}`;
      const frame = [...(nestedOpeningNode.row?.querySelectorAll('.nested-frame') || [])]
        .find(candidate => candidate.dataset.frame === frameId);
      if (!frame) throw new Error(`Nested frame ${frameId} was not rendered during reflow`);
      const ownerCard = frame.querySelector(':scope > .kid');
      frame.cards = (nestedOpeningNode.row.cards || [])
        .filter(card => frame.contains(card) && card !== ownerCard);
      frame.fadeStarts = new Map(frameFadeElements(frame).map(element => {
        element.style.opacity = '0';
        return [element, '0'];
      }));
      framePlans.push({
        plan: prepareFrameCards(nestedOpeningNode, frame),
        phase: 'open',
      });
      nestedOpeningNode.openingNestedFrame = null;
    }
    const worldMotionDuration = closingFrameTransition ? animateWorldMotion(viewBefore) : 0;
    const moving = animateMapMoves(mapMoves, viewDelta);
    const frameMotion = framePlans.reduce((duration, { plan, phase }) =>
      Math.max(duration, animateFrameCards(plan, phase)), 0);
    const frameGraphRouteDelay = reducedMotion() ? 0 : closingNestedFrame || closingFrameTransition
      ? REFLOW_MS
      : framePlans.reduce((delay, { plan }) => {
        if (!plan || plan.closing) return delay;
        const cardEnd = Math.max(0, ...plan.cards.map(card =>
          card.delay + FRAME_OUTLINE_MS + FRAME_DEAL_MS));
        return Math.max(delay, cardEnd);
      }, 0);
    for (const [node, nestedState] of frameGraphTransitions) {
      transitionFrameMarks(node, nestedState, '0');
    }
    for (const [node, nestedState] of frameGraphTransitions) {
      transitionFrameMarks(node, nestedState, '1', frameGraphRouteDelay);
    }
    const transitionRoutesWithFrame = frameCloseTransition
      || framePlans.some(({ plan }) => plan?.cards?.length);
    const incomingRouteDelay = reducedMotion() ? 0 : frameCloseTransition
      ? REFLOW_MS
      : framePlans.reduce((delay, { plan }) => {
        if (!plan || plan.closing) return delay;
        const cardEnd = Math.max(0, ...plan.cards.map(card =>
          card.delay + FRAME_OUTLINE_MS + FRAME_DEAL_MS));
        return Math.max(delay, cardEnd);
      }, 0);
    let routeMotion = 0;
    if (transitionRoutesWithFrame) {
      routeMotion = fadeRouteChanges(
        routeSnapshots, routeChanges, sc.paths, enteringOpacity, incomingRouteDelay,
      );
    } else if (!reducedMotion()) {
      entering.forEach(node => {
        const animation = node.animate([{ opacity: 0 }, { opacity: enteringOpacity.get(node) }], {
          duration: FRAME_PATH_FADE_MS,
          easing: 'ease',
          fill: 'both',
        });
        animation.finished.then(() => {
          node.style.removeProperty('opacity');
          node.style.removeProperty('transition');
          animation.cancel();
        }).catch(() => {});
      });
      for (const { group, opacity } of changedGeometry) {
        for (const animation of group.getAnimations()) {
          if (animation.transitionProperty === 'opacity'
            || animation.effect?.getKeyframes().some(frame => Object.hasOwn(frame, 'opacity'))) {
            animation.cancel();
          }
        }
        group.animate([{ opacity: 0 }, { opacity }], { duration: FRAME_PATH_FADE_MS, easing: 'ease' });
      }
    } else {
      for (const node of entering) {
        node.style.removeProperty('opacity');
        node.style.removeProperty('transition');
      }
    }

    clearTimeout(reflowDone);
    reflowDone = setTimeout(() => {
      stage.classList.remove('reflow');
      for (const node of moving) {
        node.style.removeProperty('transform');
        node.style.removeProperty('transition');
      }
      startFlows();
      placePulse();
      paint.lastMode = null;
      paint();
    }, reducedMotion() ? 0
      : Math.max(REFLOW_MS, worldMotionDuration, frameMotion, routeMotion) + 40);
  }

  /* An arrow inside a frame is drawn as a map route is: the same grey line and heads, and when
     it touches the selected or hovered card the same accent line that draws in, the same heads
     and the same moving dots. `marks` collects each arrow's nodes for `paintFrames`. */
  let maskId = 0;
  function frameCardCount(n) {
    return n.children.reduce((total, child) => total + 1 + frameCardCount(child), 0);
  }
  function frameInner(box, n, cards, marks, animate, parentCard, totalCards) {
    const lines = [];
    const chips = [];
    const lit = [];
    const outline = el('div', {
      class: 'frame-outline',
      style: animate && !reducedMotion() ? 'opacity:0' : null,
    });
    const mark = (a, g, chip, touch) => {
      maskId += 1;
      const id = `fm${maskId}`;
      const key = markKey(box, n, 'a', a);
      const reveal = svgEl('path', { d: a.d, class: 'reveal', pathLength: 1 });
      const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: -4000, y: -4000, width: n.w + 8000, height: n.h + 8000 }, reveal);
      const anim = svgEl('path', {
        d: a.d, class: 'anim', mask: `url(#${id})`, 'data-accent-route': key,
      });
      const head = svgEl('path', { d: a.head || 'M0 0', class: 'head top' });
      const head2 = a.head2 ? svgEl('path', { d: a.head2, class: 'head top' }) : null;
      const dRev = a.segs
        ? segsPath([...a.segs].reverse().map(segment => [...segment].reverse()))
        : a.d;
      const accent = {
        mask, reveal, anim, head, head2,
        path: { d: a.d, dRev, from: a.from === null ? n.id : a.from, to: a.to },
        shown: false,
      };
      hideAccent(accent);
      lit.push(mask, anim, head, head2);
      g.setAttribute('data-accent-route', key);
      marks.push({
        key, g, label: chip, touch, accent, frameId: n.id,
        lit: false, hot: false, dim: false,
      });
      if (chip) {
        bindRouteChip(chip, key, chip.routeGroups, chip.textContent);
        chip.addEventListener('pointerenter', () => {
          ui.frameHot = key;
          paintFrames();
        });
        chip.addEventListener('pointerleave', () => {
          if (ui.frameHot === key) {
            ui.frameHot = null;
            paintFrames();
          }
        });
      }
    };
    const nameOf = (id) => {
      if (id === null) return n.spec.item ? kidName(n.spec.item) : names.get(box) || box;
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
          String(count));
        chip.routeGroups = groups;
        chips.push(chip);
      }
      mark(a, g, chip, [a.to, a.from === null ? n.id : a.from]);
    }
    const svg = svgEl('svg', {
      class: 'routes fbracket', width: n.w, height: n.h, viewBox: `0 0 ${n.w} ${n.h}`, 'aria-hidden': 'true',
    }, lines, svgEl('g', { class: 'litlayer' }, lit));
    const kids = n.children.map((k, i) => {
      const order = cards.length;
      if (!k.frame) {
        return cardOf(box, k, k.x + k.card.x, k.y + k.card.y,
          cards, animate, parentCard, order, totalCards);
      }
      const card = cardOf(box, k, k.card.x, k.card.y,
        cards, animate, parentCard, order, totalCards);
      const close = el('button', {
        class: 'frame-close',
        type: 'button',
        'aria-label': `Collapse substates of ${kidName(k.spec.item)}`,
        'data-tip': 'Collapse substates',
        style: animate && !reducedMotion() ? 'opacity:0' : null,
      }, icon('contract', 14));
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNested(k.spec.item.state.id, box);
      });
      return el('div', {
        class: 'fgraph nested-frame in',
        'data-frame': k.id,
        style: `left:${k.x - k.card.x}px; top:${k.y - k.card.y}px; width:${k.w}px; height:${k.h}px; right:auto; bottom:auto`,
      }, card, frameInner(box, k, cards, marks, animate, card, totalCards), close);
    });
    // The arrows draw over the cards, so a card's stacked layers never hide where an arrow ends.
    return [outline, kids, svg, chips];
  }

  function cardOf(box, k, x, y, cards, animate, parentCard, order, total) {
    const kid = k.spec.item || k.spec.kid;
    const many = Boolean(k.spec.item && k.spec.item.members.length >= 2);
    const count = many ? kid.members.length : 1;
    const expanded = Boolean(k.spec.open);
    const delay = order * FRAME_DEAL_STEP_MS;
    const closeDelay = (total - order - 1) * FRAME_DEAL_STEP_MS;
    const press = () => {
      if (kid.external) select(kid.external.id);
      else if (kid.state.screen) {
        const selected = ui.sel === kid.state.screen.id && ui.selAnchor === k.id;
        select(selected ? null : kid.state.screen.id, selected ? null : k.id);
      }
    };
    const surface = shotSurface('kshot', kidName(kid), count, press);
    const cap = k.spec.hasChildren ? el('button', {
      class: 'kcap',
      type: 'button',
      'aria-expanded': expanded ? 'true' : 'false',
      'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${substatesText(k.spec.childCount)} of ${kid.name}`,
      'data-tip': `${expanded ? 'Collapse' : 'Expand'} ${substatesText(k.spec.childCount)}`,
      style: `left:0; top:${k.card.shotH - 2}px; width:${k.card.w - 2}px; height:${CAP_H}px`,
    }, substatesText(k.spec.childCount), icon(expanded ? 'contract' : 'expand', 14)) : null;
    const card = el('div', {
      class: `kid${many ? ` many layers-${Math.min(count - 1, 3)}` : ''}${kid.external ? ' xkid' : ''}${animate ? ' deal' : ''}`,
      'data-anchor': k.id,
      'data-kid': kid.state.id,
      'data-parent': kid.parent ? kid.parent.id : '',
      'data-role': kid.role || '',
      'data-count': many ? String(count) : null,
      style: `left:${x}px; top:${y}px; width:${k.card.w}px; height:${k.card.h}px; --sh:${Math.max(0, k.card.shotH - 2)}px`,
    }, surface.picture, cap, surface.info);
    card.kid = kid;
    card.deal = { delay, closeDelay, parentCard };
    if (cap) cap.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNested(kid.state.id, box);
    });
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
    for (const cards of kidCards.values()) {
      for (const card of cards) {
        if (!card.kid) continue;
        const ext = card.kid.external;
        if (ext) {
          const shot = extShot(ext, ui.orient, ui.tone);
          setShotChildren(card.firstChild, shot
            ? el('img', { src: shot.url, alt: '', loading: 'lazy' })
            : el('span', { class: 'kpkg', text: ext.package }));
          continue;
        }
        const url = shotOf(card.kid.state);
        setShotChildren(card.firstChild, url
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

  /* Classes only. Nothing here creates or destroys a node except the lit
     accent layer, whose paths exist to play their reveal. */
  function paint() {
    const sel = ui.sel;
    const hotKey = ui.hot ? ui.hot.key : null;
    const selectedRoute = ui.routeDetails?.key;
    const routeIsHot = key => [hotKey, selectedRoute]
      .some(active => active && (active === key || reverseKey(active) === key));
    const q = ui.query.trim().toLowerCase();

    // A collapsed screenshot lights its screen routes. An expanded screenshot
    // lights only its frame connections; its substate cards light their own.
    // Only a SELECTION dims the rest -- hovering adds light, it never takes any away.
    const lit = new Set();
    for (const [selected, focus] of [
      [true, ui.selAnchor || drawnId(sel)],
      [false, ui.hoverAnchor || drawnId(ui.hover)],
    ]) {
      if (!focus) continue;
      const expandedScreenshot = !selected && !ui.hoverAnchor && ui.hover === focus && ui.open.has(focus);
      for (const p of sc.pairs.values()) {
        if (expandedScreenshot && !(p.fromBox === focus && p.toBox === focus)) continue;
        if (p.edges.some(e => stateAnchorFor(e.srcRendition) === focus
          || stateAnchorFor(e.dstRendition) === focus)) {
          lit.add(`${p.from}>${p.to}`);
          lit.add(`${p.to}>${p.from}`);
        }
      }
      lit.add(`${focus}>${focus}`);
    }
    for (const id of [ui.selAnchor, ui.hoverAnchor, ui.hover && !ui.hoverAnchor ? drawnId(ui.hover) : null]) {
      if (id) lit.add(`${id}>${id}`);
    }

    // Only the routes whose state actually changed are touched.
    const changed = new Set([...lit, ...litNow]);
    // A Set is compared by identity, so the filter is keyed by its contents.
    const modeKey = [...ui.modes].sort().join(',');
    if (sel !== paint.lastSel || hotKey !== paint.lastHot || selectedRoute !== paint.lastRoute || modeKey !== paint.lastMode) {
      for (const key of groups.keys()) changed.add(key);
    }
    const allowed = visibleKeys();

    for (const key of changed) {
      const shown = !allowed || allowed.has(key);
      const isLit = shown && lit.has(key);
      const isHot = shown && routeIsHot(key);
      const g = groups.get(key);
      if (g) {
        g.setAttribute('class', isHot ? 'lit hot' : isLit ? 'lit' : (sel ? 'dim' : ''));
        g.style.display = shown ? '' : 'none';
      }
      pulse.set(key, !shown ? 'hidden' : (isLit || isHot) ? 'lit' : sel ? 'dim' : 'rest');
      const chip = chips.get(key);
      if (chip) {
        chip.classList.toggle('lit', isLit || isHot);
        chip.classList.toggle('hot', isHot);
        // A chip for a route nothing has selected is hidden rather than dimmed,
        // which is what the artboard does.
        chip.hidden = !shown || (Boolean(sel) && !isLit && !isHot);
        const hit = hits.get(key);
        if (hit) hit.hidden = chip.hidden;
      }
    }
    paint.lastSel = sel;
    paint.lastHot = hotKey;
    paint.lastRoute = selectedRoute;
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
      if ((lit.has(key) || routeIsHot(key)) && (!allowed || allowed.has(key))) {
        showAccent(a, routeIsHot(key), routeFocus(a, focus));
      } else {
        hideAccent(a);
      }
    }
    // The minimap only moves when the viewport does, so it is not redrawn here.
    // Rebuilding its 29 nodes on every pointer move was pure waste.
  }

  /* Hovering or selecting a screen lights its frame connections. A substate lights only
     its own connections, and empty frame space never sets a hover target. */
  function paintFrames() {
    const hovBox = drawnId(ui.hover);
    const anchors = new Set([
      ui.selAnchor || drawnId(ui.sel), ui.hoverAnchor || hovBox,
    ].filter(Boolean));
    for (const cards of kidCards.values()) {
      for (const card of cards) card.classList.toggle('sel', card.dataset.anchor === ui.selAnchor);
    }
    for (const [box, node] of boxes) {
      if (!node.row || !node.row.marks) continue;
      for (const m of node.row.marks) {
        const isHot = m.key === ui.frameHot || m.key === ui.routeDetails?.key;
        const isLit = isHot
          || m.touch.some(id => anchors.has(id));
        const isDim = !isLit && Boolean(ui.sel);
        framePulse.set(m.key, isLit ? 'lit' : isDim ? 'dim' : 'rest');
        if (isLit === m.lit && isHot === m.hot && isDim === m.dim) continue;
        m.lit = isLit;
        m.hot = isHot;
        m.dim = isDim;
        m.g.classList.toggle('lit', isLit);
        m.g.classList.toggle('hot', isHot);
        m.g.classList.toggle('dim', isDim);
        if (isLit) showAccent(m.accent, isHot, frameFocus(m));
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
  function routeFocus(a, preferred) {
    const path = a.path;
    const focuses = [ui.hoverAnchor || drawnId(ui.hover), ui.selAnchor || drawnId(ui.sel), preferred];
    const pairs = [
      sc.pairs.get(`${path.from}>${path.to}`),
      sc.pairs.get(`${path.to}>${path.from}`),
    ];
    for (const focus of focuses) {
      if (!focus) continue;
      if (focus === path.from || focus === path.to) return focus;
      for (const pair of pairs) {
        for (const edge of pair?.edges || []) {
          for (const rendition of [edge.srcRendition, edge.dstRendition]) {
            if (stateAnchorFor(rendition) !== focus) continue;
            const endpoint = [anchorFor(rendition), stateAnchorFor(rendition)]
              .find(id => id === path.from || id === path.to);
            if (endpoint) return endpoint;
          }
        }
      }
    }
    return null;
  }

  function frameFocus(mark) {
    const path = mark.accent.path;
    for (const focus of [ui.hoverAnchor || drawnId(ui.hover), ui.selAnchor || drawnId(ui.sel)]) {
      if (!focus || !mark.touch.includes(focus)) continue;
      if (focus === path.from || focus === path.to) return focus;
    }
    return null;
  }

  function accentPath(a, focus) {
    return a.path.from !== a.path.to && focus === a.path.to && a.path.dRev
      ? a.path.dRev : a.path.d;
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

  function select(id, anchor = null) {
    ui.sel = id;
    ui.selAnchor = anchor;
    ui.hot = null;
    ui.routeDetails = null;
    paint();
    drawMini();
    drawer(id ? model.byScreen.get(id) : null);
  }

  function openRouteDetails(key, groups) {
    ui.routeDetails = { key, groups };
    paint();
    drawer(ui.sel ? model.byScreen.get(ui.sel) : null);
  }

  function refreshRouteDetails() {
    if (!ui.routeDetails) return;
    const chip = [...world.querySelectorAll('.cost')].find(
      item => item.dataset.routeDetail === ui.routeDetails.key,
    );
    ui.routeDetails.groups = chip?.routeGroups || [];
    drawer(ui.sel ? model.byScreen.get(ui.sel) : null);
  }

  function routeDetailContent(groups) {
    const total = (groups || []).reduce((sum, group) => sum + group.routes
      .reduce((count, route) => count + route.steps.length, 0), 0);
    if (!total) {
      return el('p', { class: 'route-details-empty', text: 'No actions match the current filters.' });
    }
    const sections = groups.map(group => {
      const routes = group.routes.map(route => {
        const stepCount = route.steps.length;
        const elapsed = route.ms == null
          ? 'Time not recorded'
          : `${route.ms} ms`;
        const summary = el('div', { class: 'route-detail-summary' },
          el('div', {
            class: 'route-detail-name',
            text: routeActionLabel(route.name, route.src === route.dst ? '·' : '→'),
          }),
          el('div', {
            class: 'route-detail-metrics',
            role: 'group',
            'aria-label': `${stepCount} step${stepCount === 1 ? '' : 's'}; ${elapsed}`,
          },
            el('span', { class: 'route-detail-count' },
              el('span', { class: 'route-detail-value', text: String(stepCount) }),
              ` STEP${stepCount === 1 ? '' : 'S'}`),
            el('span', { class: 'route-detail-time' },
              route.ms == null
                ? elapsed
                : [el('span', { class: 'route-detail-value', text: String(route.ms) }), ' MS'])));
        const steps = stepCount > 1
          ? route.steps.map((step, index) => el('div', {
            class: 'route-detail-step',
            text: routeStepLabel({ action_id: step.action, target: step.target }, index),
          }))
          : [];
        return el('article', { class: 'route-detail-route' }, summary, steps);
      });
      return el('section', { class: 'route-detail-group' },
        el('h3', { text: group.head }), routes);
    });
    return el('div', { class: 'route-details' }, sections);
  }

  /* The inspector summarizes the selected screen. Its header opens the full details page. */
  function drawer(screen) {
    if (screen || ui.routeDetails) {
      inspectorClose?.cancel();
      inspectorClose = null;
      insp.inert = false;
    }
    if (ui.routeDetails) {
      if (!insp.parentNode) {
        dock.append(insp);
        markInspMoved();
      }
      setChildren(insp,
        el('div', { class: 'ih' },
          el('div', { class: 'ih-top' },
            el('h2', { text: 'Route actions' }),
            el('button', {
              class: 'x',
              style: 'margin-left:auto',
              'data-tip': 'Close',
              'aria-label': 'Close route details',
              onclick: () => {
                ui.routeDetails = null;
                paint();
                drawer(ui.sel ? model.byScreen.get(ui.sel) : null);
              },
            }, icon('close', 12)))),
        el('div', { class: 'ib route-details-body' }, routeDetailContent(ui.routeDetails.groups)));
      placeHealthSummary();
      return;
    }
    // Keep the inspector absent until a screen is selected.
    if (!screen) {
      if (insp.parentNode && mobile.matches
          && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (!inspectorClose) {
          insp.inert = true;
          inspectorClose = insp.animate(
            [{ translate: getComputedStyle(insp).translate }, { translate: '0 100%' }],
            { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
          );
          inspectorClose.onfinish = () => {
            insp.remove();
            inspectorClose.cancel();
            inspectorClose = null;
            insp.inert = false;
            markInspMoved();
            placeHealthSummary();
          };
        }
        return;
      }
      if (insp.parentNode) {
        insp.remove();
        markInspMoved();
      }
      placeHealthSummary();
      return;
    }
    if (!insp.parentNode) {
      dock.append(insp);
      markInspMoved();
    }

    const chev = icon('chevron', 14);
    chev.classList.add('ih-go');
    const selectedKid = ui.selAnchor
      ? [...kidCards.values()].flat().find(card => card.dataset.anchor === ui.selAnchor)?.kid
      : null;
    const states = selectedKid
      ? selectedKid.members ? selectedKid.members.map(member => member.state) : [selectedKid.state]
      : ownOf(screen.id).members.map(member => member.state);
    const stateIds = new Set(states.map(item => item.id));
    const children = selectedKid ? childrenOf(selectedKid) : rootItemsOf(screen.id);
    const includeChildren = items => {
      for (const item of items) {
        const ids = memberStates(item);
        if ([...ids].every(id => stateIds.has(id))) continue;
        for (const id of ids) stateIds.add(id);
        includeChildren(childrenOf(item));
      }
    };
    includeChildren(children);
    const routes = view.edges;
    const routesIn = routes.filter(e => stateIds.has(e.dst) && !stateIds.has(e.src));
    const routesOut = routes.filter(e => stateIds.has(e.src) && !stateIds.has(e.dst));
    const selfRoutes = routes.filter(e => stateIds.has(e.src) && stateIds.has(e.dst));
    const latest = (state.manifest.runs || []).find(r => r.screen_results && r.screen_results[screen.id]);
    const result = latest && latest.screen_results[screen.id];
    const CASE_STATUS = {
      pass: { ink: 'pass', label: 'Passed' },
      flaky: { ink: 'warn', label: 'Flaky' },
      fail: { ink: 'fail', label: 'Failed' },
      'not-settled': { ink: 'warn', label: 'Not settled' },
      'needs-review': { ink: 'warn', label: 'Needs review' },
      'baseline-missing': { ink: 'warn', label: 'No baseline' },
      'skipped-unsupported': { ink: 'skip', label: 'Unsupported' },
      'not-run': { ink: 'skip', label: 'Not run' },
    };
    const check = result ? CASE_STATUS[result.verdict] || CASE_STATUS['needs-review'] : null;
    const capStep = (() => {
      if (!run) return null;
      const r = states.find(x => !x.ghost && state.captures.get(x.id));
      const leaf = r && state.captures.get(r.id).leaves[0];
      return leaf && leaf.capture ? leaf.capture.step : null;
    })();
    const openHref = run
      ? `${href('runs.html', { id: run.id })}${capStep != null ? `#step-${String(capStep).padStart(3, '0')}` : ''}`
      : href('screen.html', { id: screen.id, ...(selectedKid ? { state: selectedKid.state.id } : {}) });
    const summaryRow = (label, value) => el('div', { class: 'summary-row' },
      el('dt', { text: label }), el('dd', { text: String(value) }));

    setChildren(insp,
      el('div', { class: 'ih' },
        el('div', { class: 'ih-top' },
          el('div', { class: 'ih-view' },
            el('button', {
              class: 'x',
              'data-tip': 'Center Screenshot',
              'aria-label': 'Center Screenshot',
              onclick: () => {
                const b = selectedRect();
                if (!b) return;
                const { w, h } = mapSize();
                ui.tx = w / 2 - (b.x + b.w / 2) * ui.scale;
                ui.ty = h / 2 - (b.y + b.h / 2) * ui.scale;
                applyTransform();
                if (mobile.matches) select(null);
              },
            }, icon('brightness', 13)),
            el('button', {
              class: 'x',
              'data-tip': 'Fit Flow',
              'aria-label': 'Fit Flow',
              onclick: () => {
                fitOn(drawnId(screen.id));
                if (mobile.matches) select(null);
              },
            }, icon('fit', 13))),
          el('button', {
            class: 'x',
            style: 'margin-left:auto',
            'data-tip': 'Close',
            'aria-label': 'Close screen details',
            onclick: () => select(null),
          }, icon('close', 12))),
        el('a', {
          class: 'ih-name',
          href: openHref,
          'aria-label': `Open details for ${screen.name || screen.id}`,
        },
          el('h2', { text: selectedKid ? kidName(selectedKid) : screen.name || screen.id }),
          check ? el('span', {
            class: 'stamp', style: `--c: var(--${check.ink})`,
            title: latest ? `Latest text run ${latest.id}` : null,
            text: check.label,
          }) : null,
          chev)),
      el('div', { class: 'ib' },
        el('div', { class: 'screen-summary', 'aria-label': 'Screen summary' },
          el('h3', { class: 'summary-title', text: 'Overview' }),
          el('dl', { class: 'summary-list' },
            summaryRow('States', states.length),
            summaryRow('Substates', children.length),
            summaryRow('Routes in', routesIn.length),
            summaryRow('Routes out', routesOut.length),
            summaryRow('Self routes', selfRoutes.length))),
        latest ? el('a', {
          class: 'screen-check',
          href: href('runs.html', { id: latest.id }),
          title: `Open text run ${latest.id}`,
        },
        el('span', { text: 'Latest text run' }),
        el('span', { class: 'mono', text: latest.id }),
        el('span', { class: 'screen-check-count', text: `${result.cases} ${result.cases === 1 ? 'case' : 'cases'}` }),
        icon('chevron', 13)) : null));
    placeHealthSummary();
  }

  /* Mirror visible cards and frame outlines without filling their groups. */
  function drawMini() {
    const r = stage.getBoundingClientRect();
    const kids = [];
    const card = (b, label) => {
      const node = svgEl('g', { class: 'mini-screen', role: 'button', tabindex: 0,
        'aria-label': `Center ${label}` },
      svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h,
        fill: '#5f6870', stroke: 'var(--route-rest)',
        'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
      const center = () => {
        const { w, h } = mapSize();
        ui.tx = w / 2 - (b.x + b.w / 2) * ui.scale;
        ui.ty = h / 2 - (b.y + b.h / 2) * ui.scale;
        applyTransform();
      };
      node.addEventListener('click', center);
      node.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        center();
      });
      kids.push(node);
    };
    const walk = (n, x, y, root) => {
      if (n.frame) kids.push(svgEl('rect', { class: 'mini-frame',
        x, y, width: n.w, height: n.h, fill: 'none', stroke: '#b8bec4',
        'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
      card({ x: x + n.card.x, y: y + n.card.y, w: n.card.w, h: n.card.h },
        n.spec.item ? kidName(n.spec.item) : names.get(root.dataset.screen));
      for (const child of n.children || []) walk(child,
        x + child.x - (child.frame ? child.card.x : 0),
        y + child.y - (child.frame ? child.card.y : 0), root);
    };
    for (const [id, b] of geo.pos) {
      const root = boxes.get(id);
      const frame = frames.get(id);
      if (frame) walk(frame, b.x, b.y, root);
      else card(cardRect(id), names.get(id) || id);
    }
    kids.push(svgEl('rect', {
      x: -ui.tx / ui.scale, y: -ui.ty / ui.scale,
      width: mapSize().w / ui.scale, height: r.height / ui.scale,
      fill: 'color-mix(in oklab, var(--accent) 8%, transparent)', stroke: 'var(--accent-text)',
      'stroke-width': 2, 'vector-effect': 'non-scaling-stroke',
      'pointer-events': 'none',
    }));
    setChildren(mini, svgEl('svg', {
      viewBox: `0 0 ${geo.worldW} ${geo.worldH}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'group', 'aria-label': 'Map radar',
    }, kids));
  }

  function stageSize() {
    const r = stage.getBoundingClientRect();
    return { w: r.width || 1200, h: r.height || 700 };
  }
  function mapSize() {
    const size = stageSize();
    if (mobile.matches) {
      return { w: size.w, h: Math.max(40, size.h - 76) };
    }
    const bounds = stage.getBoundingClientRect();
    const panel = dock.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(dock).right) || 0;
    return { w: panel.width && panel.left > bounds.left
      ? Math.min(size.w, panel.left - bounds.left - gap) : size.w, h: size.h };
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
  let borderDpr = null;
  function applyTransform() {
    const dpr = window.devicePixelRatio || 1;
    if (borderDpr !== dpr) {
      const box = boxes.values().next().value;
      if (box) {
        // Fractional display scales round CSS borders before the map transform.
        world.style.setProperty('--map-layout-border', getComputedStyle(box).borderTopWidth);
        borderDpr = dpr;
      }
    }
    world.style.transform = `translate(${ui.tx}px, ${ui.ty}px) scale(${ui.scale})`;
    world.style.setProperty('--inv', String(1 / ui.scale));
    zoomLabel.textContent = `${Math.round(ui.scale * 100)}%`;
    placePulse();
    moving();
    drawMini();
  }
  function cancelWorldMotion() {
    if (!worldMotion) return;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    ui.tx = matrix.e;
    ui.ty = matrix.f;
    ui.scale = matrix.a;
    worldMotion.cancel();
    worldMotion = null;
    world.style.transform = `translate(${ui.tx}px, ${ui.ty}px) scale(${ui.scale})`;
    placePulse();
    drawMini();
  }
  function animateWorldMotion(from) {
    const to = { tx: ui.tx, ty: ui.ty, scale: ui.scale };
    if (reducedMotion() || (from.tx === to.tx && from.ty === to.ty)) return 0;
    const transform = view => `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    const animation = world.animate([
      { transform: transform(from) },
      { transform: transform(to) },
    ], { duration: REFLOW_MS, easing: 'cubic-bezier(.2, .8, .2, 1)', fill: 'both' });
    worldMotion = animation;
    animation.finished.then(() => {
      if (worldMotion !== animation) return;
      worldMotion = null;
      animation.cancel();
    }).catch(() => {
      if (worldMotion === animation) worldMotion = null;
    });
    return REFLOW_MS;
  }
  let transformFrame = 0;
  function scheduleTransform() {
    if (transformFrame) return;
    transformFrame = requestAnimationFrame(() => {
      transformFrame = 0;
      applyTransform();
    });
  }
  /* The scale at which the whole map just fits the stage. */
  function fitScale() {
    const { w, h } = mapSize();
    const b = flowBounds();
    return Math.min(w / (b.w + 80), (h - 80) / (b.h + 80));
  }
  function flowBounds() {
    const boxes = [...geo.pos.values()];
    if (!boxes.length) return { x: 0, y: 0, w: geo.worldW, h: geo.worldH };
    const x = Math.min(...boxes.map(b => b.x));
    const y = Math.min(...boxes.map(b => b.y));
    return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x,
      h: Math.max(...boxes.map(b => b.y + b.h)) - y };
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
    cancelWorldMotion();
    const { w, h } = mapSize();
    const b = flowBounds();
    ui.scale = Math.min(MAX_FIT, fitScale() * 0.96);
    ui.tx = w / 2 - (b.x + b.w / 2) * ui.scale;
    ui.ty = h / 2 - (b.y + b.h / 2) * ui.scale;
    applyTransform();
  }
  function centerView() {
    cancelWorldMotion();
    const { w, h } = mapSize();
    const b = flowBounds();
    ui.tx = w / 2 - (b.x + b.w / 2) * ui.scale;
    ui.ty = h / 2 - (b.y + b.h / 2) * ui.scale;
    applyTransform();
  }
  function zoomAt(factor, cx, cy, render = true) {
    cancelWorldMotion();
    const next = clampScale(ui.scale * factor);
    ui.tx = cx - (cx - ui.tx) * (next / ui.scale);
    ui.ty = cy - (cy - ui.ty) * (next / ui.scale);
    ui.scale = next;
    if (render) applyTransform();
  }
  function centerOn(id) {
    cancelWorldMotion();
    const b = geo.pos.get(id);
    if (!b) return;
    const { w, h } = mapSize();
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
        const hit = find(k, ox + k.x - (k.frame ? k.card.x : 0),
          oy + k.y - (k.frame ? k.card.y : 0));
        if (hit) return hit;
      }
      return null;
    };
    return find(f, box.x, box.y);
  }
  const selectedRect = () => (ui.selAnchor ? kidRect(drawnId(ui.sel), ui.selAnchor) : cardRect(drawnId(ui.sel)));
  function keepCardOnStage() {
    cancelWorldMotion();
    const c = ui.selAnchor ? kidRect(drawnId(ui.sel), ui.selAnchor) : cardRect(drawnId(ui.sel));
    if (!c) return;
    const { w, h } = mapSize();
    if (mobile.matches) ui.scale = Math.min(ui.scale, (w - 32) / c.w, (h - 32) / c.h);
    const left = ui.tx + c.x * ui.scale;
    const top = ui.ty + c.y * ui.scale;
    if (left >= 0 && top >= 0 && left + c.w * ui.scale <= w && top + c.h * ui.scale <= h) return;
    ui.tx = w / 2 - (c.x + c.w / 2) * ui.scale;
    ui.ty = h / 2 - (c.y + c.h / 2) * ui.scale;
    applyTransform();
  }
  function fitOn(id) {
    cancelWorldMotion();
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
    const { w, h } = mapSize();
    ui.scale = clampScale(Math.min(w / (x1 - x0 + pad * 2), h / (y1 - y0 + pad * 2)));
    ui.tx = w / 2 - ((x0 + x1) / 2) * ui.scale;
    ui.ty = h / 2 - ((y0 + y1) / 2) * ui.scale;
    applyTransform();
  }

  // Native and non-passive, so a trackpad pinch (ctrl + wheel) cannot zoom the
  // page and a two-finger scroll pans instead of scrolling.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelWorldMotion();
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top, false);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      ui.tx -= e.deltaX * k;
      ui.ty -= e.deltaY * k;
    }
    scheduleTransform();
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
    cancelWorldMotion();
    const { w, h } = mapSize();
    zoomAt(Math.exp(-e.deltaY * 0.01), w / 2, h / 2, false);
    scheduleTransform();
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
    if (!touch && e.target.closest('.map-shot, .kid, .cost, button, .box:not(.open)')) return;
    cancelWorldMotion();
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
      zoomAt(now.d / pinch.d, now.cx, now.cy, false);
      pinch = now;
      scheduleTransform();
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
    scheduleTransform();
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

  const healthSummary = renderHealth(state, initialHealth, {
    title: run ? 'Run health' : 'Baseline health', configure: false, compact: true,
  });
  const panel = el('div', { class: 'card panel' },
    healthSummary,
    mini,
    el('div', { class: 'hud' },
      el('button', { 'data-tip': 'Center Map', 'aria-label': 'Center Map', onclick: () => {
        centerView();
        if (mobile.matches) select(null);
      } }, icon('brightness', 13)),
      el('div', { class: 'zoom' },
        el('button', { 'data-tip': 'Zoom Out', 'aria-label': 'Zoom Out', onclick: () => { const { w, h } = mapSize(); zoomAt(0.8, w / 2, h / 2); } }, icon('minus', 13)),
        zoomLabel,
        el('button', { 'data-tip': 'Zoom In', 'aria-label': 'Zoom In', onclick: () => { const { w, h } = mapSize(); zoomAt(1.25, w / 2, h / 2); } }, icon('plus', 13))),
      el('button', { 'data-tip': 'Fit Map', 'aria-label': 'Fit Map', onclick: () => {
        fitView();
        if (mobile.matches) select(null);
      } }, icon('fit', 13))));
  dock.prepend(panel);
  function placeHealthSummary() {
    const host = mobile.matches && insp.parentNode ? insp : panel;
    if (host === insp) host.append(healthSummary);
    else if (healthSummary.parentNode !== host) host.prepend(healthSummary);
  }

  const seg = (options, get, onPick, label = '') => segmentedGroup(
    options.map(option => ({
      ...option,
      content: icon(option.icon, 12, '', option.rot),
    })),
    {
      isSelected: value => value === get(),
      onChange: onPick,
      label,
    },
  );
  const multi = (options, has, onToggle, label = '') => segmentedGroup(
    options.map(option => ({
      ...option,
      content: icon(option.icon, 12),
    })),
    {
      isSelected: has,
      onChange: onToggle,
      multiple: true,
      label,
    },
  );

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
    if (ui.routeDetails) refreshRouteDetails();
    else if (ui.sel) drawer(model.byScreen.get(ui.sel) || null);
  }

  const modeSeg = multi(modeItems, v => ui.modes.has(v), (v) => {
    if (ui.modes.has(v)) ui.modes.delete(v);
    else ui.modes.add(v);
    refilter();
  }, 'Navigation modes');

  function paintCounts() {
    const health = mapHealth({
      model, states: view.states, edges: view.recordedEdges, captures: state.captures,
      runs: state.manifest.runs, run, orientation: ui.orient, appearance: ui.tone,
      locale: ui.locale, modes: ui.modes, profile: state.profile, platform: platformOf(state.profile),
    });
    const scope = { profile: state.profile?.key || '', orientation: ui.orient,
      appearance: ui.tone, locale: ui.locale, modes: [...ui.modes] };
    if (!run) rememberHealthScope(state, scope);
    healthSummary.update({ health, scope });
    MODES.forEach((m, i) => {
      const n = view.oriented.filter(e => modeOf(e) === m.name).length;
      const label = `${n} - ${m.label}`;
      modeSeg.children[i].setAttribute('data-tip', label);
      modeSeg.children[i].setAttribute('aria-label', label);
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
  }, 'Orientation');

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
    paintProfiles();
    paintLocales();
    readCells();
    [...orientSeg.children].forEach((b, i) => b.replaceChild(icon(phoneIcon(v), 12, '', i === 1), b.firstChild));
    refilter();
  }, 'Platform');

  /* The capture tone is the screenshots' appearance, not this site's theme. When the
     map holds no capture in the chosen one, the toolbar says so in words. */
  const toneSeg = seg([
    { value: 'light', icon: 'sun', title: 'Light captures' },
    { value: 'dark', icon: 'moon', title: 'Dark captures' },
  ], () => ui.tone, (v) => { ui.tone = v; refilter(); }, 'Capture appearance');
  const toneNote = el('span', { class: 'tnote', role: 'status' });
  function paintTone() {
    const whose = run ? 'this run' : 'this baseline';
    const have = t => view.inOrient.some(r => cellsOf.get(r.id)
      .some(c => c.url && c.orientation === ui.orient && c.appearance === t));
    toneNote.textContent = have(ui.tone) ? '' : `No ${ui.tone} ${ui.orient} captures in ${whose}`;
    toneNote.hidden = !toneNote.textContent;
    ['light', 'dark'].forEach((t, i) => {
      const label = `${t === 'light' ? 'Light' : 'Dark'} captures${have(t) ? '' : ' (none)'}`;
      toneSeg.children[i].setAttribute('data-tip', label);
      toneSeg.children[i].setAttribute('aria-label', label);
    });
  }

  const localeSelect = el('select', {
    'aria-label': 'App language and locale',
    'data-tip': 'App language and locale',
    onchange: e => { ui.locale = e.target.value; readCells(); refilter(); },
  });
  function paintLocales() {
    const locales = availableLocales();
    if (!locales.includes(ui.locale)) ui.locale = locales[0] || '';
    setChildren(localeSelect, locales.length
      ? locales.map(locale => el('option', { value: locale, text: locale }))
      : el('option', { value: '', text: 'No recorded locales' }));
    localeSelect.value = ui.locale;
    localeSelect.disabled = !locales.length;
  }
  paintLocales();
  const profileName = profile => {
    const device = profile.device || {};
    return device.avd || device.profile?.avd || profile.name || profile.key;
  };
  const profileSelect = el('select', {
    'aria-label': 'Device baseline',
    'data-tip': 'Device baseline',
    onchange: e => {
      const profile = (state.manifest.profiles || []).find(p => p.key === e.target.value
        && platformIcon(platformOf(p)) === ui.platform);
      if (!profile) return;
      state.profile = profile;
      state.captures = captureIndex(profile, `${state.source.url}baselines/${profile.key}/`);
      byPlatform.set(ui.platform, { profile, captures: state.captures });
      paintLocales();
      readCells();
      refilter();
    },
  });
  function paintProfiles() {
    const profiles = run ? [state.profile].filter(Boolean)
      : (state.manifest.profiles || []).filter(p => platformIcon(platformOf(p)) === ui.platform);
    setChildren(profileSelect, profiles.length
      ? profiles.map(profile => el('option', { value: profile.key, text: profileName(profile) }))
      : el('option', { value: '', text: 'No device baseline' }));
    profileSelect.value = state.profile?.key || '';
    profileSelect.disabled = Boolean(run) || !profiles.length;
  }
  paintProfiles();
  const deviceDialog = el('dialog', { class: 'device-dialog', 'aria-labelledby': 'device-dialog-title' });
  function showDeviceInfo() {
    const labels = {
      abi: 'CPU ABI', avd: 'Emulator name', codename: 'Device codename', density: 'Density (dpi)',
      emulator: 'Emulator', fingerprint: 'Build fingerprint', make: 'Manufacturer', model: 'Model',
      os: 'OS version', platform: 'Platform', resolution: 'Resolution (pixels)', sdk: 'SDK version',
    };
    const fields = (data, prefix = '') => Object.entries(data).flatMap(([key, value]) => {
      const label = `${prefix}${labels[key] || key.replaceAll('_', ' ')}`;
      if (value !== null && typeof value === 'object') return fields(value, `${label} / `);
      return [el('div', { class: 'device-detail' },
        el('dt', { text: label }),
        el('dd', { text: value === null ? 'Not recorded'
          : key === 'emulator' ? (String(value) === '1' || value === true ? 'Yes' : 'No') : String(value) }))];
    });
    const section = (title, rows) => el('section', { class: 'device-section' },
      el('h3', { text: title }), el('dl', { class: 'device-details' }, rows));
    const device = state.profile?.device || {};
    setChildren(deviceDialog,
      el('div', { class: 'device-dialog-head' },
        el('h2', { id: 'device-dialog-title', text: state.profile ? profileName(state.profile) : 'Device information' }),
        el('button', { type: 'button', class: 'x', 'aria-label': 'Close device information',
          autofocus: true, onclick: () => deviceDialog.close() }, icon('close', 18))),
      el('div', { class: 'device-dialog-body' },
        section('Map configuration', fields({
          Baseline: state.profile?.key || 'Not recorded',
          Orientation: ui.orient, Appearance: ui.tone,
          Locale: ui.locale || 'Not recorded',
          'Navigation modes': MODES.filter(mode => ui.modes.has(mode.name)).map(mode => mode.label).join(', ') || 'None',
          ...(run ? { Run: run.id } : {}),
        })),
        section('Device', Object.keys(device).length ? fields(device)
          : fields({ Device: 'No device information recorded' }))));
    deviceDialog.showModal();
  }
  const profileControl = el('div', { class: 'profile-control' },
    el('button', { type: 'button', class: 'x', 'aria-label': 'Device information',
      'data-tip': 'Device information', onclick: showDeviceInfo }, icon('info', 16)),
    el('div', { class: 'select-surface' }, profileSelect));
  const filterControls = el('div', { class: 'map-filters', id: 'map-filters' },
    platformSeg, profileControl,
    el('div', { class: 'locale-control select-surface' }, localeSelect),
    orientSeg, toneSeg, toneNote, modeSeg);
  const filterToggle = el('button', {
    type: 'button', class: 'map-filter-toggle', 'aria-controls': 'map-filters',
    'aria-label': 'Filters', 'data-tip': 'Filters',
    'aria-expanded': 'false', onclick: () => setFilters(!toolbar.classList.contains('filters-open')),
  }, icon('filters', 20));
  function setFilters(open) {
    toolbar.classList.toggle('filters-open', open);
    filterToggle.setAttribute('aria-expanded', String(open));
    filterControls.inert = mobile.matches && !open;
  }
  const toolbar = el('div', { class: 'tools' },
    el('div', { class: 'search' }, icon('search', 13),
      el('input', {
        placeholder: 'find a screen',
        'aria-label': 'Find a screen',
        oninput: (e) => { ui.query = e.target.value; paint(); },
      })),
    filterToggle, filterControls);
  setFilters(false);
  mobile.addEventListener('change', () => {
    setFilters(false);
    placeHealthSummary();
  });
  toolbar.addEventListener('keydown', e => {
    if (e.key === 'Escape' && toolbar.classList.contains('filters-open')) {
      setFilters(false);
      filterToggle.focus();
    }
  });
  main.addEventListener('pointerdown', () => {
    if (mobile.matches) setFilters(false);
  }, true);

  /* Keep the view steady when the stage resizes. The inspector sits at the stage's right, so
     opening or closing it keeps the stage's left and top fixed and leaves the graph where it
     is, then centres the selected card if the narrower stage would cut it off. Any other
     resize keeps the world point under the stage centre fixed. */
  let last = null;
  new ResizeObserver(() => {
    const now = stageSize();
    if (!last) {
      last = now;
      fitView();
      if (mobile.matches) {
        const launch = model.byRendition.get(model.meta.launch_state)?.screen_id || model.appScreens[0]?.id;
        if (launch && geo.pos.has(drawnId(launch))) {
          ui.scale = clampScale(1);
          centerOn(drawnId(launch));
        }
      }
      return;
    }
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
  out.append(toolbar, main, deviceDialog);
  return out;
}
