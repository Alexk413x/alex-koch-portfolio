/* Coverage: which screens were captured under which axis value, and what this
   map cannot answer.

   Markup follows docs/report-design/Main.dc.html's coverage page: `.cpage` with
   `.tiles` > `.tile` across the top, then `.axg` > `.axv` rows per axis, then
   the `.mtx` grid of `.mc` cells.

   Built from `rendition_axis`, not `screen_axis`. The latter DECLARES what a
   screen is meant to vary under, and on this fixture it is empty -- so an empty
   cell can only mean "no capture exists" and can never mean "this combination
   is impossible". With no declared set there is no denominator, so no
   percentage on this page would be true. Counts only. */

import { el } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { href } from '../page.js';
import { modeCoverage } from '../data/modes.js';
import { launchScreen } from '../graph/scene.js';

/* Every axis in this map, with the values seen on it. */
function axesSeen(model) {
  const axes = new Map();
  for (const r of model.renditions) {
    for (const { axis, value } of r.axisValues) {
      if (!axes.has(axis)) axes.set(axis, new Map());
      const values = axes.get(axis);
      values.set(value, (values.get(value) || 0) + 1);
    }
  }
  return [...axes.entries()]
    .map(([axis, values]) => ({ axis, values: [...values.entries()].sort((a, b) => a[0].localeCompare(b[0])) }))
    .sort((a, b) => a.axis.localeCompare(b.axis));
}

/* One mode's row: a bar, its counts, and the screens behind them.

   Modes are NOT an axis. An axis is a condition a screen is captured under; a
   mode is a way of driving the app, and the question it answers is reachability
   rather than appearance. They share the `.axv` component and nothing else.

   A mode nobody has driven gets no bar and no counts, only the sentence. That
   is the whole point of the group: `unmeasured` is a different report from
   `unreachable`, and collapsing them lets an undriven mode read as a mode with
   no problems. */
function modeRow(row) {
  const gaps = row.cells.filter(c => c.status === 'expensive' || c.status === 'unreachable');

  if (!row.measured) {
    return el('div', {},
      el('div', { class: 'axv none' },
        el('span', { class: 'axn', 'data-tip': row.mode.note },
          icon(row.mode.name, 14), row.mode.label),
        el('span', { class: 'axnone', text: 'no route has ever been recorded under this mode, so nothing here is a finding about it' })));
  }

  const total = row.total || 1;
  const pct = n => `${(100 * n / total).toFixed(1)}%`;
  const body = el('div', { class: 'gaps' }, gaps.map(c => el('div', { class: 'gap' },
    el('span', { class: 'gk', style: `--c: var(--${c.status === 'expensive' ? 'warn' : 'skip'})`, text: c.screen }),
    el('span', { text: c.why }))));
  body.hidden = true;

  const head = el('div', { class: 'axv' },
    el('span', { class: 'axn', 'data-tip': row.mode.note },
      icon(row.mode.name, 14), row.mode.label),
    el('div', { class: 'meter' },
      row.reached ? el('i', { class: 'p', style: `width:${pct(row.reached)}` }) : null,
      row.expensive ? el('i', { class: 'w', style: `width:${pct(row.expensive)}` }) : null,
      el('i', { class: 'r' })),
    el('span', { class: 'vs' },
      el('span', { class: `v ${row.reached ? 'v-p' : 'v-n'}`, text: String(row.reached) }),
      el('span', { class: `v ${row.expensive ? 'v-w' : 'v-n'}`, text: String(row.expensive) }),
      el('span', { class: `v ${row.unreachable ? 'v-r' : 'v-n'}`, text: String(row.unreachable) })),
    el('span', { class: 'ftot', text: String(row.total) }));

  if (gaps.length) {
    head.style.cursor = 'pointer';
    head.title = 'show the screens behind these counts';
    head.addEventListener('click', () => { body.hidden = !body.hidden; });
  }
  return el('div', {}, head, body);
}

function tile(n, label, ink) {
  return el('div', { class: 'tile', style: `--c: var(--${ink || 'text'})` },
    el('b', { text: String(n) }),
    el('span', { text: label }));
}

export function renderCoverage(state) {
  const model = state.model;
  const axes = axesSeen(model);
  const withAxes = model.appScreens.filter(s => s.renditions.some(r => r.axisValues.length));
  const coreOnly = model.appScreens.filter(s => !s.renditions.some(r => r.axisValues.length));
  const captured = model.appRenditions.filter(r => r.uistate_digest).length;

  const columns = axes.flatMap(a => a.values.map(([v]) => ({ axis: a.axis, value: v, key: `${a.axis}=${v}` })));
  const start = launchScreen(model);
  const modes = modeCoverage(model, start && start.id);

  const covered = new Map();
  for (const r of model.renditions) {
    for (const { axis, value } of r.axisValues) {
      covered.set(`${r.screen_id}|${axis}=${value}`, true);
    }
  }

  // The matrix. One column of screen names plus one per axis value, laid out by
  // an explicit template so the grid and the header can never disagree.
  const matrix = columns.length
    ? el('div', {
      class: 'mtx',
      style: `grid-template-columns: minmax(160px, auto) repeat(${columns.length}, minmax(90px, 1fr))`,
    },
      el('div', { class: 'mc mh' }, el('b', { text: 'screen' })),
      columns.map(c => el('div', { class: 'mc mh' }, el('b', { text: c.key }))),
      withAxes.map(s => [
        el('div', { class: 'mc mn' },
          el('b', {}, el('a', { href: href('screen.html', { id: s.id }), text: s.id }))),
        columns.map(c => {
          const hit = covered.get(`${s.id}|${c.key}`);
          return el('div', { class: 'mc', style: `--c: var(--${hit ? 'pass' : 'skip'})` },
            el('b', { text: hit ? 'captured' : '—' }));
        }),
      ]))
    : null;

  return el('div', { class: 'page cpage' },
    el('div', { class: 'phead' },
      el('div', { class: 'phead-top' }, el('h1', { text: 'Coverage' })),
      el('p', { text: 'Which screens have a capture under which axis value, read from the captures themselves.' })),

    el('div', { class: 'tiles' },
      tile(model.appScreens.length, model.externalScreens.length
        ? `screens, not counting ${model.externalScreens.length} outside the app` : 'screens', 'text'),
      tile(model.appRenditions.length, 'conditions', 'text'),
      tile(captured, 'with a capture', captured === model.appRenditions.length ? 'pass' : 'warn'),
      tile(coreOnly.length, 'core condition only', 'skip')),

    el('div', { class: 'psec' },
      el('div', { class: 'psec-h' }, el('span', { class: 'h2', text: 'Axes seen' })),
      axes.length
        ? el('div', { class: 'axg' }, axes.map(a => el('div', { class: 'axv' },
          el('span', { class: 'axn' }, icon('screen', 14), a.axis),
          el('div', { class: 'nchips' }, a.values.map(([v, n]) =>
            el('span', { class: 'nchip', text: `${v} · ${n}` }))),
          el('span', { class: 'ftot', text: String(a.values.length) }),
          el('span', {}))))
        : el('p', { class: 'axnone', text: 'No condition carries an axis value. Every capture is a core condition.' })),

    el('div', { class: 'psec' },
      el('div', { class: 'psec-h' },
        el('span', { class: 'h2', text: 'Modes' }),
        el('span', { class: 'cap', text: `${modes.measured.length} of ${modes.rows.length} driven` })),
      el('p', { class: 'covnote', text: 'How the app can be driven, and how much of it each way reaches. Reachable is not the same as usable: a route counts as expensive when it costs several times what the same screen costs by touch.' }),
      el('div', { class: 'axg' }, modes.rows.map(modeRow))),

    el('div', { class: 'psec' },
      el('div', { class: 'psec-h' }, el('span', { class: 'h2', text: 'What this page cannot tell you' })),
      model.screenAxes.length
        ? el('p', { class: 'covnote', text: `${model.screenAxes.length} screen_axis rows declare what should vary, so gaps below are measured against a real denominator.` })
        : el('p', { class: 'covnote', text: 'screen_axis is empty, so nothing declares which axis values a screen is meant to have. An empty cell below means no capture exists — it can never mean the combination is impossible. With no declared set there is no denominator, so no percentage here would be true.' })),

    matrix
      ? el('div', { class: 'psec' },
        el('div', { class: 'psec-h' },
          el('span', { class: 'h2', text: 'Axis values by screen' }),
          el('span', { class: 'cap', text: String(withAxes.length) })),
        matrix)
      : null,

    el('div', { class: 'psec' },
      el('div', { class: 'psec-h' },
        el('span', { class: 'h2', text: 'Captured in one condition only' }),
        el('span', { class: 'cap', text: String(coreOnly.length) })),
      el('div', { class: 'nchips' }, coreOnly.map(s =>
        el('a', { class: 'nchip', href: href('screen.html', { id: s.id }), text: s.id }))),
      el('p', { class: 'covnote', text: 'These screens have a core capture and nothing else. Whether that is complete depends on what they are meant to vary under, which this map does not record.' })));
}
