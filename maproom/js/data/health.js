/* Health is recorded evidence, not a rendition's authoring status or a self-loop.
   Mapped counts states; warnings and failures count findings, not percentages. */

import { variants } from './sources.js';

const axesOf = text => Object.fromEntries(String(text || '').split(';')
  .filter(part => part.includes('=')).map(part => {
    const at = part.indexOf('=');
    return [part.slice(0, at), part.slice(at + 1)];
  }));
const edgeKey = e => JSON.stringify([e.src, e.dst, e.action, e.requires || '']);
const failed = new Set(['fail', 'failed', 'differs']);
const warned = new Set(['warning', 'review', 'needs-review', 'flaky', 'not-settled', 'baseline-missing', 'mode-differs']);

export function mapHealth({ model, states, edges, captures, runs = [], run = null,
  orientation, appearance, locale, modes, profile, platform }) {
  const ids = new Set(states.map(r => r.id));
  const edgeIds = new Set(edges.map(edgeKey));
  const warnings = [];
  const failures = [];
  const add = (list, text, extra = {}) => list.push({ text, count: 1, ...extra });
  const scoped = (axes = {}) => (!axes.orientation || axes.orientation === orientation)
    && (!axes.appearance || axes.appearance === appearance)
    && (!axes.locale || axes.locale === locale)
    && (!axes.nav || modes.has(axes.nav));

  // A run map reports that run alone, never the baseline's later results.
  if (!run) for (const row of model.coverage || []) {
    if (!scoped({ ...axesOf(row.config), appearance: row.appearance })) continue;
    if (row.kind === 'edge' ? !edgeIds.has(edgeKey(row)) : !ids.has(row.state)) continue;
    const list = failed.has(row.verdict) || row.kind === 'failed-control' ? failures
      : warned.has(row.verdict) ? warnings : null;
    if (list) add(list, `${row.kind}: ${row.detail || row.verdict}`, {
      state: row.state || row.src, run: row.run_id,
    });
  }

  const contributing = new Set();
  for (const id of ids) {
    const leaf = variants(captures.get(id), profile, locale)
      .find(c => c.orientation === orientation && c.appearance === appearance)?.leaf;
    if (!leaf) continue;
    const provenance = leaf.shot_captures?.[appearance] || leaf.capture;
    if (provenance?.run_id) contributing.add(provenance.run_id);
  }
  const sources = run ? runs.filter(r => r.id === run.id) : runs;
  const seenCases = new Set();
  let tests = 0;
  let audits = 0;
  for (const source of sources) {
    const health = source.health || {};
    if (contributing.has(source.id)) {
      for (const w of health.warnings || []) {
        if (w.state && !ids.has(w.state)) continue;
        add(warnings, `${w.warning}${w.reason ? `: ${w.reason}` : ''}`, {
          state: w.state, run: source.id,
        });
      }
      const audit = health.a11y || {};
      if (audit.status === 'written') {
        audits++;
        if (audit.findings > 0) add(warnings, 'Accessibility findings (whole capture run)', {
          count: audit.findings, run: source.id,
        });
      } else if (audit.status === 'failed') {
        add(warnings, `Accessibility audit failed: ${audit.why || 'no results'}`, { run: source.id });
      }
    }
    for (const c of health.cases || []) {
      if (platform && c.platform && c.platform !== platform) continue;
      const key = JSON.stringify([c.case, c.platform,
        ...['nav', 'orientation', 'appearance', 'locale'].map(k => c.config[k] || '')]);
      if (seenCases.has(key)) continue;
      seenCases.add(key);
      if (!scoped(c.config) || (c.states.length && !c.states.some(id => ids.has(id)))) continue;
      tests++;
      const reviewExplained = c.verdict === 'needs-review' && c.warnings?.length;
      const list = failed.has(c.verdict) ? failures
        : warned.has(c.verdict) && !reviewExplained ? warnings : null;
      if (list) add(list, `${c.case}: ${c.verdict}${c.reason ? ` — ${c.reason}` : ''}`, {
        state: c.states.find(id => ids.has(id)), run: source.id,
      });
      for (const w of c.warnings || []) {
        if (w.state && !ids.has(w.state)) continue;
        add(warnings, `${c.case}: ${w.warning}${w.reason ? `: ${w.reason}` : ''}`, {
          state: w.state, run: source.id,
        });
      }
    }
  }
  if (run) {
    const v = run.view?.verdicts || {};
    if (v.edge_test && failed.has(v.edge_test.verdict)) add(failures,
      `Edge test: ${v.edge_test.why || v.edge_test.verdict}`, { run: run.id });
    else if (!v.edge_test && scoped(v.replay)) {
      for (const f of v.replay?.failures || []) add(failures, `Path step ${f.path_step}: ${f.why}`, {
        state: ids.has(f.expected) ? f.expected : null, run: run.id,
      });
    }
  }
  return { mapped: states.filter(r => r.uistate_digest && !r.ghost), warnings, failures, tests, audits };
}

export const findingCount = list => list.reduce((sum, item) => sum + item.count, 0);
