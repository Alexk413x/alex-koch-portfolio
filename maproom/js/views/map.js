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
import { href } from '../page.js';
import { tiers, layout, scene } from '../graph/scene.js';
import { flow } from '../graph/flow.js';
import { platformOf, variants, screenCapture, hasOrientation } from '../data/sources.js';
import { variantStrip, stateLabel } from './variants.js';
import { MODES, modeOf } from '../data/modes.js';
import { ALIGN, pairAlign } from '../data/runmap.js';

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

const BADGE = 30;

function popRows(groups) {
  const out = [];
  for (const g of groups || []) {
    out.push(el('div', { class: 'pl h', text: g.head }));
    const shown = g.routes.slice(0, POP_MAX);
    for (const r of shown) {
      const many = r.steps.length > 1;
      r.steps.forEach((st, i) => {
        out.push(el('div', { class: `pr${many ? ' grp' : ''}${i ? ' cont' : ''}` },
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

export function renderMap(state) {
  const model = state.model;
  const run = state.run || null;
  const rows = tiers(model);

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

  // `hot` is `{ key, id }`: the route under the pointer, and the screen at its
  // far end when a drawer row is what set it.
  // `hover` is the box under the pointer and lights its routes the same way a
  // selection does. `hot` is one route, from a drawer row or a cost chip.
  // `modes` filters which routes are drawn at all: every driven mode is on, so
  // the map starts whole and the filter only ever subtracts.
  const ui = { sel: null, hover: null, hot: null, query: '', modes: new Set(driven), platform: ownPlatform, tone: openingTone(state.captures), orient: 'portrait', scale: 1, tx: 0, ty: 0 };
  /* Which orientations this baseline actually holds captures for.

     PORTRAIT stays selectable with no captures at all: it is what a reader
     sees on arrival, and marking it off left the toolbar showing no selection
     while the boxes said what was missing. */
  const cellsOf = new Map(model.renditions.map(r => [r.id, variants(state.captures.get(r.id), state.profile)]));
  const allCells = [...cellsOf.values()].flat();
  const hasOrient = {
    portrait: true,
    landscape: allCells.some(c => c.url && c.orientation === 'landscape'),
  };
  /* What the selected orientation holds. A state belongs to an orientation
     when it has a leaf there; a route belongs when both of its ends do. A
     screen outside the app has no captures by design, so its states count as
     present in every orientation. */
  const inOrient = r => Boolean(r) && ((r.screen && r.screen.isExternal)
    || hasOrientation(state.captures.get(r.id), ui.orient));
  function orientedView() {
    const edges = model.edges.filter(e => inOrient(e.srcRendition) && inOrient(e.dstRendition));
    return {
      states: model.appRenditions.filter(inOrient),
      edges,
      edgeSet: new Set(edges),
      statesOf: new Map(model.screens.map(s => [s.id, s.renditions.filter(inOrient)])),
      model: { ...model, edges },
    };
  }
  let view = orientedView();

  const captureCount = (screen) => {
    const cells = view.statesOf.get(screen.id)
      .flatMap(r => cellsOf.get(r.id))
      .filter(c => c.orientation === ui.orient);
    return `${cells.filter(c => c.url).length}/${cells.length}`;
  };
  const statesText = n => `${n} ${n === 1 ? 'state' : 'states'}`;

  /* A screen outside the app has no capture in the baseline. A run's own capture of it
     stands in: the run view's, or the newest run's from the manifest. */
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
    .some(t => externalShot(s, orient, t)));
  let geo = layout(rows, ui.orient, { tallExternal: tallExternal(ui.orient) });
  let sc = scene(view.model, rows, geo, {});

  const stackLayer = el('div', { class: 'stacks', 'aria-hidden': 'true' });
  const routes = svgEl('svg', { class: 'routes', 'aria-hidden': 'true' });
  const litLayer = svgEl('g', { class: 'litlayer' });
  const pulseCanvas = el('canvas', { class: 'flow', 'aria-hidden': 'true' });
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
  let pulse = null;
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
      ok.add(`${from.id}>${to.id}`);
      ok.add(`${to.id}>${from.id}`);
    }
    return ok;
  }

  function routeAlign(a, b) {
    return pairAlign(view.edges.filter(e => {
      const from = e.srcRendition && e.srcRendition.screen;
      const to = e.dstRendition && e.dstRendition.screen;
      return from && to && ((from.id === a && to.id === b) || (from.id === b && to.id === a));
    }));
  }

  /* Create every node once, from a scene computed with nothing selected. */
  function build() {
    sc = scene(view.model, rows, geo, {});
    groups.clear();
    boxes.clear();
    stacks.clear();
    chips.clear();

    routes.setAttribute('width', geo.worldW);
    routes.setAttribute('height', geo.worldH);
    routes.setAttribute('viewBox', `0 0 ${geo.worldW} ${geo.worldH}`);

    const svgKids = [];
    for (const p of sc.paths) {
      const g = svgEl('g', run ? { 'data-al': routeAlign(p.from, p.to) || '' } : {},
        svgEl('path', { d: p.d }),
        svgEl('path', { d: p.head, class: 'head' }),
        svgEl('path', { d: p.head2, class: p.head2 === 'M0 0' ? 'none' : 'head start' }));
      groups.set(p.key, g);
      svgKids.push(g);
    }
    if (pulse) pulse.stop();
    pulse = flow(pulseCanvas, sc.pulses);
    // The accent layer, built once per route and hidden. Creating these on
    // every hover cost ~80 SVG nodes a pointer move; the reveal animation is
    // restarted instead, which is what actually has to happen when a route
    // becomes lit.
    accent.clear();
    const litKids = [];
    let n = 0;
    for (const p of sc.paths) {
      const id = `rv${n}`;
      n += 1;
      const reveal = svgEl('path', { d: p.d, class: 'reveal', pathLength: 1 });
      const mask = svgEl('mask', {
        id, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: geo.worldW, height: geo.worldH,
      }, reveal);
      const anim = svgEl('path', { d: p.d, class: 'anim', mask: `url(#${id})` });
      const head = svgEl('path', { d: p.head, class: 'head top' });
      const head2 = p.twoWay ? svgEl('path', { d: p.head2, class: 'head top' }) : null;
      const nodes = [mask, anim, head, head2].filter(Boolean);
      for (const node of nodes) litKids.push(node);
      accent.set(p.key, { reveal, anim, head, head2, path: p, shown: false });
    }
    setChildren(litLayer, litKids);
    svgKids.push(litLayer);
    setChildren(routes, svgKids);
    for (const a of accent.values()) hideAccent(a);

    const overlay = [];
    for (const dv of geo.dividers) {
      overlay.push(el('div', {
        class: dv.over ? 'divider over' : 'divider',
        style: `left:${dv.x}px; top:${dv.y}px; width:${dv.w}px`,
        text: dv.text,
      }));
    }
    const stackKids = [];
    for (const s of model.screens) {
      const box = geo.pos.get(s.id);
      if (!box) continue;
      const n = view.statesOf.get(s.id).length;
      // The farther card comes first so the nearer one paints over it.
      if (!s.isExternal && n >= 2) {
        const stack = el('div', {
          class: 'bstack',
          style: `left:${box.x}px; top:${box.y}px; width:${box.w}px; height:${box.h}px`,
        }, n >= 3 ? el('i', { class: 's2' }) : null, el('i', { class: 's1' }));
        stacks.set(s.id, stack);
        stackKids.push(stack);
      }
      const node = el('div', {
        class: `${s.isExternal ? 'box ext' : 'box'}${run && s.align ? ` al-${s.align}` : ''}`,
        style: `left:${box.x}px; top:${box.y}px; width:${box.w}px`,
        title: [s.isExternal
          ? [s.package, 'outside the app', s.summary].filter(Boolean).join(' · ')
          : `${s.id} · ${statesText(n)} · ${captureCount(s)} captures`,
        run && s.align ? ALIGN[s.align].label : ''].filter(Boolean).join(' · '),
      });
      node.addEventListener('click', () => select(ui.sel === s.id ? null : s.id));
      node.addEventListener('pointerenter', () => { ui.hover = s.id; paint(); });
      node.addEventListener('pointerleave', () => { ui.hover = null; paint(); });
      boxes.set(s.id, node);
      overlay.push(node);
    }
    for (const c of sc.costs) {
      const chip = el('div', {
        class: 'cost',
        style: `left:${c.x}px; top:${c.y}px`,
      }, c.text, el('div', { class: 'pop' }, popRows(c.groups)));
      // A chip sets `hot` with no screen: nothing gets the `hov` border sweep.
      chip.addEventListener('pointerenter', () => setHot({ key: c.key, id: null }));
      chip.addEventListener('pointerleave', () => setHot(null));
      chips.set(c.key, chip);
      overlay.push(chip);
    }
    setChildren(stackLayer, stackKids);
    setChildren(world, stackLayer, routes, pulseCanvas, overlay);
    paintCaptures();
    // The nodes are new, so every route is repainted, including any the mode filter hides.
    paint.lastMode = null;
    paint();
  }

  /* The capture inside each box, swapped when the tone changes. A screen
     outside the app has no capture to swap: its box names the package. */
  function paintCaptures() {
    for (const s of model.screens) {
      const node = boxes.get(s.id);
      const box = geo.pos.get(s.id);
      if (!node || !box) continue;
      if (s.isExternal) {
        const shot = box.ih ? externalShot(s, ui.orient, ui.tone) : null;
        setChildren(node, shot
          ? [el('img', { class: 'bi', src: shot.url, alt: '', style: `height:${box.ih}px`, loading: 'lazy' }),
            el('span', { class: 'bxtag', 'data-tip': `Not stored in the baseline: run ${shot.run}'s capture`, text: 'outside the app' })]
          : el('div', { class: 'bx', style: `height:${box.h}px` },
            el('span', { class: 'bx-k', text: 'outside the app' }),
            el('span', { class: 'bx-p', text: s.package })));
        continue;
      }
      // No fallback to the other tone. A dark screenshot shown while the
      // toolbar says light is the viewer inventing evidence.
      const pic = screenCapture(state, s, ui.orient, ui.tone);
      // `--cap` stops the zoom-compensated badge from outgrowing its box.
      const cap = (0.9 * Math.min(box.w, box.ih)) / BADGE;
      setChildren(node, pic.url
        ? el('img', { class: 'bi', src: pic.url, alt: '', style: `height:${box.ih}px`, loading: 'lazy' })
        : el('div', { class: 'bn', style: `height:${box.ih}px`, text: pic.missing }),
      el('span', { class: 'bcount', style: `width:${BADGE}px; height:${BADGE}px; --cap:${cap.toFixed(3)}`, text: String(view.statesOf.get(s.id).length) }));
    }
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
    for (const focus of [sel, ui.hover]) {
      if (!focus) continue;
      for (const p of sc.pairs.values()) {
        if (p.from === focus || p.to === focus) {
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

    // A screen the filtered routes no longer touch is dimmed: that IS the
    // finding a mode filter exists to show.
    const stranded = new Set();
    if (allowed) {
      for (const s2 of model.screens) stranded.add(s2.id);
      for (const key of allowed) {
        const [a2, b2] = key.split('>');
        stranded.delete(a2);
        stranded.delete(b2);
      }
    }

    for (const [id, node] of boxes) {
      const screen = model.byScreen.get(id);
      const hit = q && [id, screen.summary, screen.package].some(t => (t || '').toLowerCase().includes(q));
      node.classList.toggle('sel', id === sel);
      // `hov` comes only from a drawer row: it brightens the whole border at
      // once, since there is no pointer entry point to sweep from.
      node.classList.toggle('hov', Boolean(ui.hot && ui.hot.id === id));
      node.classList.toggle('hit', Boolean(hit));
      // Search and the mode filter dim a box. Selection never does; it dims
      // routes instead.
      node.classList.toggle('dim', (Boolean(q) && !hit) || stranded.has(id));
      const stack = stacks.get(id);
      if (stack) stack.classList.toggle('dim', node.classList.contains('dim'));
    }

    const focus = sel || ui.hover;
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
  function showAccent(a, isHot, focus) {
    // The accent runs AWAY from the focused screen, so direction is readable.
    const d = (a.path.twoWay && focus === a.path.to) ? a.path.dRev : a.path.d;
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

  function select(id) {
    ui.sel = id;
    ui.hot = null;
    paint();
    drawMini();
    drawer(id ? model.byScreen.get(id) : null);
  }

  /* The inspector, node for node as the artboard has it: the view buttons with
     close at the far right, then the id, its stamp and a chevron as one press
     surface, then THREE folds -- routes in, routes out, runs. */
  function drawer(screen) {
    // The drawer is not an empty panel waiting for a selection -- it is not
    // there at all. The artboard gates the whole `.insp` on having one, and a
    // permanently present column costs 360px of map for a sentence.
    if (!screen) {
      if (insp.parentNode) insp.remove();
      return;
    }
    if (!insp.parentNode) main.append(insp);

    const routeRow = (e, far) => {
      // The line's key is always src-screen to dst-screen, whichever fold the
      // row sits in.
      const key = `${e.srcRendition.screen.id}>${e.dstRendition.screen.id}`;
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
              onclick: () => centerOn(screen.id),
            }, icon('brightness', 13)),
            el('button', {
              class: 'x',
              'data-tip': 'Fit Flow',
              onclick: () => fitOn(screen.id),
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
          el('h2', { text: screen.id }),
          el('span', { class: 'stamp', style: `--c: var(--${stamp.c})`, text: stamp.text }),
          chev)),
      el('div', { class: 'ib' },
        states.length && !screen.isExternal ? el('div', { class: 'vstates' }, states.map(r => el('a', {
          class: 'vstate',
          href: run ? stateHref(r) : href('screen.html', { id: screen.id, state: r.id }),
          target: run ? '_blank' : null,
        }, el('span', { class: 'mono', text: stateLabel(r) }),
        run && r.align ? el('span', { class: 'stamp', style: `--c: var(--${ALIGN[r.align].ink})`, 'data-tip': r.alignAs ? `as ${r.alignAs}` : null, text: ALIGN[r.align].label }) : null,
        variantStrip(cellsOf.get(r.id).filter(c => c.orientation === ui.orient))))) : null,
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
    const kids = model.screens.map(s => {
      const b = geo.pos.get(s.id);
      if (!b) return null;
      return svgEl('rect', {
        x: b.x, y: b.y, width: b.w, height: b.h, rx: 6,
        fill: ui.sel === s.id ? 'var(--accent)' : 'var(--rule)',
      });
    }).filter(Boolean);
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
  }

  /* A promoted layer keeps the scale it was rastered at, so once a zoom settles
     `.reraster` drops the world's promotion for a frame to re-raster it sharp. */
  let rasterScale = null;
  let settle = 0;
  function moving() {
    pulse.hold(true);
    clearTimeout(settle);
    settle = setTimeout(() => {
      pulse.hold(false);
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
  function fitOn(id) {
    const ids = new Set([id]);
    for (const p of sc.pairs.values()) {
      if (p.from === id) ids.add(p.to);
      if (p.to === id) ids.add(p.from);
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
    if (!touch && e.target.closest('.box, .cost')) return;
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
    if (e.type === 'pointerup' && moved < SLOP && ui.sel && !e.target.closest('.box, .cost')) select(null);
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

  const modeSeg = multi(modeItems, v => ui.modes.has(v), (v) => {
    if (ui.modes.has(v)) ui.modes.delete(v);
    else ui.modes.add(v);
    paint();
  });

  function paintCounts() {
    const dead = view.edges.filter(e => e.isSelf).length;
    tallyCaptured.textContent = String(view.states.filter(r => r.uistate_digest).length);
    tallyDraft.textContent = String(view.states.filter(r => r.status === 'draft').length);
    tallyDead.textContent = String(dead);
    tallyDead.classList.toggle('zero', !dead);
    MODES.forEach((m, i) => {
      const n = view.edges.filter(e => modeOf(e) === m.name).length;
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
    geo = layout(rows, v, { tallExternal: tallExternal(v) });
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
    [...orientSeg.children].forEach((b, i) => b.replaceChild(icon(phoneIcon(v), 12, '', i === 1), b.firstChild));
  });

  /* The capture tone is the screenshots' appearance, not this site's theme. When the
     map holds no capture in the chosen one, the toolbar says so in words. */
  const toneSeg = seg([
    { value: 'light', icon: 'sun', title: 'Light captures' },
    { value: 'dark', icon: 'moon', title: 'Dark captures' },
  ], () => ui.tone, (v) => { ui.tone = v; paintCaptures(); paintTone(); });
  const toneNote = el('span', { class: 'tnote', role: 'status' });
  function paintTone() {
    const whose = run ? 'this run' : 'this baseline';
    const have = t => view.states.some(r => cellsOf.get(r.id)
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
    modeSeg,
    toneSeg,
    toneNote,
    // One phone, two angles. The glyph is the survey's own platform, so an iOS
    // baseline shows an iPhone body and an Android one shows a handset.
    platformSeg,
    orientSeg);

  // Keep the world point under the stage centre fixed when the stage resizes.
  let last = null;
  new ResizeObserver(() => {
    const now = stageSize();
    if (!last) { last = now; fitView(); return; }
    ui.tx += (now.w - last.w) / 2;
    ui.ty += (now.h - last.h) / 2;
    last = now;
    // A narrower stage raises the floor, so a scale that was legal before the
    // resize can be below it after.
    ui.scale = clampScale(ui.scale);
    applyTransform();
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
