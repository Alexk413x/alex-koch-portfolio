/* One run's built map, read as a baseline is, and aligned to the baseline.

   The server answers `/k/<id>/runs/<run>/view.json`: the run's `post/map.db`, each
   state's capture in the run's own screens/ and screenstates/, the comparison with
   the baseline the run was checked against, and the run's verdicts. The map is
   loaded with the baseline reader, so every baseline view draws it.

   What the baseline holds and the run did not reach is drawn too, from today's
   baseline, marked `missing`. */

import { loadBaseline } from './baseline.js';

export const ALIGN = {
  match: { label: 'matching', ink: 'pass' },
  new: { label: 'new in the run', ink: 'accent-text' },
  changed: { label: 'changed', ink: 'warn' },
  missing: { label: 'not reached', ink: 'skip' },
};

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const edgeKey = e => `${e.src} ${e.dst} ${e.action} ${e.requires}`;

function ghosts(baseline, missing) {
  if (!baseline || !missing) return { screens: [], renditions: [], axes: [], edges: [], steps: [] };
  const screens = missing.screens.map(id => baseline.byScreen.get(id)).filter(Boolean);
  const renditions = missing.states.map(id => baseline.byRendition.get(id)).filter(Boolean);
  const wanted = new Set(missing.edges.map(edgeKey));
  const edges = baseline.edges.filter(e => wanted.has(edgeKey(e)));
  return {
    screens: screens.map(({ renditions: _r, routesIn: _i, routesOut: _o, ...row }) => ({ ...row })),
    renditions: renditions.map(({ screen: _s, axisValues: _a, ...row }) => ({ ...row })),
    axes: renditions.flatMap(r => r.axisValues.map(a => ({ rendition_id: r.id, ...a }))),
    edges: edges.map(({ steps: _st, srcRendition: _s, dstRendition: _d, ...row }) => ({ ...row })),
    steps: edges.flatMap(e => e.steps.map(({ paramsObj: _p, target: _t, ...row }) => ({ ...row }))),
  };
}

function runCapture(sourceUrl, runId, sid, c) {
  if (!c.screen) return null;
  return {
    id: sid,
    leaves: [{
      path: '',
      orientation: c.orientation || 'portrait',
      locale: 'default',
      url: sourceUrl,
      shots: { [c.appearance || 'default']: sourceUrl + c.screen },
      files: [],
      tree: c.tree ? sourceUrl + c.tree : null,
      uistate: c.uistate ? sourceUrl + c.uistate : null,
      capture: { run_id: runId, source: 'run', captured_at: '', step: c.step },
      shot_captures: {},
      fromRun: true,
    }],
  };
}

export async function loadRunMap(state, runId) {
  const src = state.source.url;
  const view = await getJson(`${src}runs/${encodeURIComponent(runId)}/view.json`);
  if (!view.ok) throw new Error(view.error || `no run ${runId}`);
  if (!view.map) return { view, model: null, captures: new Map() };

  const aligned = view.alignment;
  const extra = ghosts(state.model, aligned && aligned.missing);
  const model = await loadBaseline(src + view.map, {
    extend: ({ model: m, axes, steps }) => {
      for (const s of extra.screens) s.ghost = true;
      for (const r of extra.renditions) r.ghost = true;
      for (const e of extra.edges) e.ghost = true;
      const have = new Set(m.screens.map(s => s.id));
      m.screens.push(...extra.screens.filter(s => !have.has(s.id)));
      m.screens.sort((a, b) => a.id.localeCompare(b.id));
      m.renditions.push(...extra.renditions);
      m.edges.push(...extra.edges);
      axes.push(...extra.axes);
      steps.push(...extra.steps);
    },
  });

  const states = (aligned && aligned.states) || {};
  const byEdge = new Map(((aligned && aligned.edges) || []).map(e => [edgeKey(e), e]));
  const screens = (aligned && aligned.screens) || {};
  for (const s of model.screens) s.align = s.ghost ? 'missing' : (screens[s.id] || null);
  for (const r of model.renditions) {
    const a = states[r.id];
    r.align = r.ghost ? 'missing' : (a ? a.status : null);
    r.alignAs = a && a.as ? a.as : '';
  }
  for (const e of model.edges) {
    const a = byEdge.get(edgeKey(e));
    e.align = e.ghost ? 'missing' : (a ? a.status : null);
  }
  const captures = new Map();
  for (const [sid, c] of Object.entries(view.captures || {})) {
    const entry = runCapture(src, runId, sid, c);
    if (entry) captures.set(sid, entry);
  }
  for (const r of model.renditions) {
    if (r.ghost && state.captures.has(r.id)) captures.set(r.id, state.captures.get(r.id));
  }
  return { view, model, captures };
}

export function pairAlign(edges) {
  const seen = new Set(edges.map(e => e.align).filter(Boolean));
  if (!seen.size) return null;
  if (seen.size === 1 && seen.has('missing')) return 'missing';
  for (const k of ['new', 'changed', 'match']) if (seen.has(k)) return k;
  return null;
}
