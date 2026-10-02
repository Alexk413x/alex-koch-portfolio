/* The runs page, built as docs/report-design/Main.dc.html builds it.

   `.rhead` carries the run dropdown, the headline verdict with its mix, and the
   meta line. Below it the artboard has Cases, each expanding into attempts.

   THIS APP HAS NO CASES. A case is a test-suite construct and lives in
   `test_case`, which nothing writes yet; a cartographer run is one sequence of
   steps with no grouping above it. So the case level is reported as absent by
   name and the run's steps are drawn as the single attempt they are, in the
   artboard's own `.try` / `.steps` / `.step` components. Inventing a case per
   run would put a structure in front of the reader that the data does not have.

   A step's claim is shown as an `.anote`: what was expected, or that nothing
   was declared -- which is what makes `unchecked` honest rather than a guess. */

import { el } from '../util/dom.js';
import { icon } from '../util/icons.js';
import { href } from '../page.js';
import { loadRun, runMinutes, videoAt, fileName, verdict, OUTCOMES } from '../data/run.js';

// The order the mix reads in is the order `OUTCOMES` declares, which is the
// schema's. A second copy of the same four strings here drifted the moment
// either list changed.
const INK = { held: 'pass', already: 'skip', unchecked: 'skip', failed: 'fail' };

/* Seconds, in the artboard's own format. */
/* Every video file the run kept, in recording order, each with its turn and the stretch of
   the run it covers. A run recorded before the `video` table lists `video.mp4` alone. */
function videoFiles(run) {
  if (!run.videos || !run.videos.length) {
    return [el('span', {}, el('a', { href: `${run.base}video.mp4`, target: '_blank', text: 'video.mp4' }))];
  }
  const from = run.startedAt || (run.videos[0].started_at || 0);
  const clock = t => (t == null ? '?' : `${Math.floor((t - from) / 60)}:${String(Math.floor((t - from) % 60)).padStart(2, '0')}`);
  return run.videos.map(v => el('span', {},
    v.url ? el('a', { href: v.url, target: '_blank', text: fileName(v.url) }) : `${v.source} (not kept)`,
    ` rotation ${v.rotation ?? '?'} · ${clock(v.started_at)}–${clock(v.ended_at)}`
    + (v.cuts.length ? ` · ${v.cuts.length} cut${v.cuts.length === 1 ? '' : 's'}` : '')));
}

function secs(v) {
  return v >= 60 ? `${Math.floor(v / 60)}m ${Math.round(v % 60)}s` : `${v.toFixed(1)}s`;
}

/* How long ago a run started, from its id's timestamp.
   The id is `<YYYYMMDD>T<HHMMSS>[mmm]Z`, optionally with a `-<short>` suffix,
   which is the only clock a run folder carries before its database is opened. */
function ago(id) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\d{3})?Z/.exec(id);
  if (!m) return '';
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const mins = (Date.now() - t) / 60000;
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

/* The run dropdown, in `.rhead-top`.

   A survey accumulates runs without bound -- this fixture already holds 40 --
   so the menu is a scrolling list with a filter above it rather than a column
   as tall as the folder. A run id is a timestamp and a short hash, which is
   exactly the kind of name nobody scans for by eye, so the filter matches the
   id and the "how long ago" text together: `212` finds a time, `ff37` finds a
   hash, `d ago` finds the older ones. */
function runPicker(runs, current, onPick) {
  const rows = runs.map((r) => {
    const when = r.has_db ? ago(r.id) : 'no run.db';
    const row = el('div', {
      class: r.id === current ? 'on' : '',
      onclick: () => onPick(r.id),
    }, r.id, el('span', { text: when }));
    row.dataset.find = `${r.id} ${when}`.toLowerCase();
    return row;
  });

  const none = el('div', { class: 'dnone', text: 'no run matches' });
  none.hidden = true;
  const list = el('div', { class: 'dlist' }, rows, none);

  const find = el('input', {
    class: 'dsearch',
    type: 'search',
    placeholder: 'find a run',
    // A menu is not a form; Enter picking the only visible run is what makes
    // typing three characters a complete gesture.
    onkeydown: (ev) => {
      if (ev.key === 'Escape') { close(); return; }
      if (ev.key !== 'Enter') return;
      const hit = rows.find(row => !row.hidden);
      if (hit) hit.click();
    },
  });
  find.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      row.hidden = Boolean(q) && !row.dataset.find.includes(q);
      if (!row.hidden) shown += 1;
    }
    none.hidden = shown > 0;
  });

  const drop = el('div', { class: 'drop', 'data-scope': 'group' }, find, list);
  drop.hidden = true;

  const dd = el('div', { class: 'dd' });
  function close() {
    drop.hidden = true;
    dd.className = 'dd';
  }
  const button = el('button', {
    'data-tip': 'Run',
    onclick: () => {
      const open = drop.hidden;
      drop.hidden = !open;
      dd.className = open ? 'dd open' : 'dd';
      if (!open) return;
      // Opening starts from the whole list, not from whatever was typed last
      // time: a menu that opens already filtered looks like it lost its runs.
      find.value = '';
      find.dispatchEvent(new Event('input'));
      list.scrollTop = 0;
      find.focus();
    },
  }, el('span', { class: 'k', text: 'run' }), current || 'none', icon('caret', 12));
  dd.append(button, drop);
  return dd;
}

const pad = ord => String(ord).padStart(3, '0');

function quote(v) {
  return v == null ? 'not read' : `“${v}”`;
}

function settleText(step) {
  if (step.settle_ended_by == null && step.settle_elapsed_ms == null) return null;
  return [
    step.settle_ended_by ? `ended by ${step.settle_ended_by}` : 'end not recorded',
    step.settle_waited_for && `waited for ${step.settle_waited_for}`,
    step.settle_elapsed_ms == null ? 'elapsed not recorded' : `spent ${step.settle_elapsed_ms} ms`,
    step.settle_wait_ms != null && `quiet window ${step.settle_wait_ms} ms`,
    step.settle_ceiling_hit ? 'ceiling hit' : null,
  ].filter(Boolean).join(' · ');
}

function windowSyncText(w) {
  const took = w.returned_at && w.requested_at ? ` in ${Math.round((w.returned_at - w.requested_at) * 1000)} ms` : '';
  return [
    `${w.ended_by || 'no end'}${took}`,
    w.bound_ms != null && `bound ${w.bound_ms} ms`,
    (w.bounds_windows || []).length ? `windows ${w.bounds_windows.join(', ')}` : null,
    w.trail_ms != null && `trail ${w.trail_ms} ms`,
    w.reason,
  ].filter(Boolean).join(' · ');
}

function transientText(t) {
  const took = t.ended_at && t.detected_at ? ` in ${Math.round((t.ended_at - t.detected_at) * 1000)} ms` : '';
  return [
    `${t.transient || 'transient'} · ${t.ended_by || 'no end'}${took}`,
    t.pause_ms != null && `pause ${t.pause_ms} ms`,
    t.frames != null && `${t.frames} frames${t.frame_stats ? ` (${t.frame_stats})` : ''}`,
  ].filter(Boolean).join(' · ');
}

function toastText(step, toast) {
  const at = v => `${(v - step.started_at).toFixed(1)}s`;
  return `${toast.name || 'toast'} appeared ${toast.appeared_at ? at(toast.appeared_at) : '?'}, `
    + (toast.gone_at ? `gone ${at(toast.gone_at)}` : 'still showing');
}

/* A claim with no check only echoes `expect`, which the expected note shows. */
function claimText(step) {
  const c = step.claimObj;
  if (!c || (!c.check && c.expected_text == null && c.prior_text == null && c.actual == null)) return null;
  return [
    c.check || 'claim',
    `expected ${quote(c.expected_text)}`,
    `prior ${quote(c.prior_text)}`,
    `actual ${quote(c.actual)}`,
    c.replace == null ? null : (c.replace ? 'replaced' : 'appended'),
  ].filter(Boolean).join(' · ');
}

function warningNote(w, source) {
  const facts = Object.entries(w).filter(([k]) => k !== 'warning' && k !== 'step')
    .map(([k, v]) => `${k} ${v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : v}`);
  return el('div', { class: 'anote' },
    el('b', { style: '--c: var(--warn)', text: source === 'build' ? 'warning' : 'recorded warning' }),
    el('span', {}, el('em', { text: w.warning || 'unnamed' }), facts.length ? `  ${facts.join(' · ')}` : ''));
}

function thumbs(step) {
  const n = pad(step.ord);
  const shots = [
    step.before && { ...step.before, label: 'before', alt: `Step ${n}, the screen before its input` },
    step.screenshot && { screenshot: step.screenshot, screenstate: step.screenstate, label: 'captured', alt: `Step ${n}, the screen as the step captured it` },
    step.final && { ...step.final, label: 'ended', alt: `Step ${n}, the screen as the step ended` },
  ].filter(Boolean);
  if (!shots.length) return null;
  return el('div', { class: 'sthumbs' }, shots.map(sh => el('figure', {},
    el('a', { href: sh.screenshot, target: '_blank' },
      el('img', { src: sh.screenshot, alt: sh.alt, loading: 'lazy' })),
    el('figcaption', {}, sh.label,
      sh.screenstate ? el('a', { href: sh.screenstate, target: '_blank', text: 'tree' }) : null))));
}

/* One step's claim and its evidence, shown under the step row. */
function stepNotes(run, step) {
  const notes = [];
  notes.push(thumbs(step));
  for (const w of step.warningList) notes.push(warningNote(w, run.warningSource));
  if (step.message) {
    notes.push(el('div', { class: 'anote' },
      el('b', { style: `--c: var(--${step.failed ? 'fail' : 'muted'})`, text: step.outcome || 'message' }),
      el('span', { text: step.message })));
  }
  if (step.expectObj) {
    const e = step.expectObj;
    const text = `${e.kind}${e.selector ? ` ${e.selector}` : ''}${e.expected ? ` = ${e.expected}` : ''}`;
    notes.push(el('div', { class: 'anote said' },
      el('b', { text: 'expected' }), el('span', { text })));
  } else if (step.outcome === 'unchecked' && !step.message) {
    notes.push(el('div', { class: 'anote' },
      el('b', { text: 'expected' }),
      el('span', { text: 'nothing was declared, so this step is unchecked' })));
  }
  const claim = claimText(step);
  if (claim) {
    notes.push(el('div', { class: 'anote said' }, el('b', { text: 'claim' }), el('span', { text: claim })));
  }
  if (step.input_accepted === 0 || (claim && step.input_accepted != null)) {
    notes.push(el('div', { class: 'anote' },
      el('b', { style: `--c: var(--${step.input_accepted ? 'muted' : 'fail'})`, text: 'input' }),
      el('span', { text: step.input_accepted ? 'accepted' : 'refused' })));
  }
  if (step.event) {
    notes.push(el('div', { class: 'anote' },
      el('b', { style: `--c: var(--${step.timedOut ? 'fail' : 'muted'})`, text: 'event' }),
      el('span', { text: step.event })));
  }
  const settle = settleText(step);
  if (settle) {
    notes.push(el('div', { class: 'anote' },
      el('b', { style: `--c: var(--${step.settle_ceiling_hit ? 'fail' : 'muted'})`, text: 'settle' }),
      el('span', { text: settle })));
  }
  if (step.windowSync) {
    notes.push(el('div', { class: 'anote' }, el('b', { text: 'window sync' }), el('span', { text: windowSyncText(step.windowSync) })));
  }
  if (step.transientSettle) {
    notes.push(el('div', { class: 'anote' }, el('b', { text: 'transient' }), el('span', { text: transientText(step.transientSettle) })));
  }
  for (const toast of step.toasts) {
    notes.push(el('div', { class: 'anote' }, el('b', { text: 'toast window' }), el('span', { text: toastText(step, toast) })));
  }
  const target = [step.control_key && `key ${step.control_key}`,
    !step.control_key && step.target_id && `id ${step.target_id}`,
    step.target_label && `“${step.target_label}”`, step.target_class, step.target_bounds]
    .filter(Boolean).join('  ');
  if (target) {
    notes.push(el('div', { class: 'anote' }, el('b', { text: 'hit' }), el('span', { text: target })));
  }
  if (step.screen_name || step.screen_identity_to) {
    notes.push(el('div', { class: 'anote' }, el('b', { text: 'screen' }),
      el('span', { text: [step.screen_name, step.screen_identity_to && `identity ${step.screen_identity_to}`]
        .filter(Boolean).join('  ') })));
  }
  const files = [step.screenshot, step.screenstate].filter(Boolean)
    .flatMap(url => ['  ', el('a', { href: url, target: '_blank', text: fileName(url) })]);
  if (!files.length) files.push('  ', el('span', { text: 'no screenshot or tree was returned for this step' }));
  const shown = videoAt(run, step);
  const clip = !shown ? el('span', { text: 'no kept video covers this step' })
    : shown.offset == null ? el('a', { href: shown.url, target: '_blank', text: `${fileName(shown.url)}, offset unknown` })
    : el('a', { href: `${shown.url}#t=${shown.offset.toFixed(1)}`, target: '_blank',
      text: `${fileName(shown.url)} ${shown.offset.toFixed(1)}s${shown.inGap ? ' (recorder stopped here)' : ''}` });
  notes.push(el('div', { class: 'anote' },
    el('b', { text: 'video at' }),
    el('span', {}, clip, ...files)));
  if (step.read) {
    const r = step.read;
    notes.push(el('div', { class: 'anote' },
      el('b', { text: 'list read' }),
      el('span', {},
        `${r.outcome} · ${r.mergedRows.length} rows · ${r.views.length} views · `
        + `${r.return_confirmed ? 'return confirmed' : 'return not confirmed'}  `,
        ...r.views.flatMap(v => v.screen_path
          ? [el('a', { href: run.base + v.screen_path, target: '_blank', text: fileName(v.screen_path) }), ' ']
          : [el('span', { text: 'view without its pair ' })]))));
  }
  return el('div', { class: 'note' }, notes);
}

function stepRow(run, step) {
  let notes = null;
  const toggle = () => {
    if (!notes) { notes = stepNotes(run, step); row.after(notes); } else notes.hidden = !notes.hidden;
    row.setAttribute('aria-expanded', String(!notes.hidden));
  };
  const flags = [
    step.warningList.length && `${step.warningList.length} warning${step.warningList.length === 1 ? '' : 's'}`,
    step.settle_ceiling_hit ? 'ceiling' : null,
  ].filter(Boolean);
  const row = el('div', {
    // `.unrun` strikes the row through, which says the step never happened.
    // `unchecked` means it ran and carried no claim, so it must not get that
    // class -- it was striking out 17 of this run's 18 real steps.
    class: `step${step.failed ? ' bad' : ''}`,
    id: `step-${pad(step.ord)}`,
    role: 'button',
    tabindex: '0',
    'aria-expanded': 'false',
    'data-tip': 'Step claims',
    onclick: toggle,
    onkeydown: (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      toggle();
    },
  },
    el('span', { class: 'ix', text: pad(step.ord) }),
    el('span', { class: 'vb', text: step.action }),
    el('span', { class: 'sc', text: step.target_label || step.control_key || step.target || '—' }),
    el('span', { class: 'wt' }, step.timedOut ? 'timed out' : (step.mask || step.outcome || ''),
      flags.length ? el('i', { class: 'wn', text: ` · ${flags.join(' · ')}` }) : null),
    el('span', { class: 'el', text: `${Math.round((step.ended_at - step.started_at) * 1000)} ms` }));
  row.openNotes = () => { if (!notes || notes.hidden) toggle(); };
  return row;
}

/* The run's driven steps, as the artboard's one `.try`. */
function attempt(run, steps) {
  const ctx = run.context || {};
  const incoming = ctx.incoming || {};
  const failed = steps.filter(s => s.failed);

  return el('div', { class: 'try' },
    el('div', { class: 'try-h' },
      el('span', { class: 'stamp', style: `--c: var(--${failed.length ? 'fail' : 'pass'})`, text: failed.length ? `${failed.length} failed` : 'held' }),
      el('span', { class: 'rid', text: run.id }),
      el('span', { text: run.endedAt ? secs(runMinutes(run) * 60) : 'unfinished' })),
    ctx.bound_after_s !== undefined
      ? el('div', { class: 'rcfg', text: `engine bound after ${Number(ctx.bound_after_s).toFixed(2)}s · ${run.device}` })
      : null,
    el('div', { class: 'steps' }, steps.map(step => stepRow(run, step))),
    Object.keys(incoming).length
      ? el('div', { class: 'rbag' },
        el('div', { class: 'bagrow' }, el('b', { text: 'device on entry' }),
          Object.entries(incoming).map(([k, v]) => el('span', {}, el('i', { text: k }), String(v)))))
      : null);
}

/* Steps the driver's session took on its own at open or close, kept out of the
   driven list so its first row is the first step the run chose. */
function lifecycleSection(run, title, steps) {
  if (!steps.length) return null;
  return el('div', { class: 'psec' },
    el('div', { class: 'psec-h' },
      el('span', { class: 'h2', text: title }),
      el('span', { class: 'cap', text: String(steps.length) })),
    el('div', { class: 'cases' }, el('div', { class: 'case' },
      el('div', { class: 'case-b', style: 'padding:14px' },
        el('div', { class: 'steps' }, steps.map(step => stepRow(run, step)))))));
}

function tally(items) {
  const out = new Map();
  for (const k of items) out.set(k, (out.get(k) || 0) + 1);
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

function bag(label, entries, ink = null) {
  return el('div', { class: 'bagrow' }, el('b', { text: label }),
    entries.length
      ? entries.map(([k, v]) => el('span', { style: ink && v ? `color: var(--${ink})` : null }, el('i', { text: k }), String(v)))
      : el('span', { text: 'none' }));
}

/* How the recording was taken: how each step settled, what it flagged, and
   which captures bracket a change. A row appears only when run.db has its column. */
function recording(run, has) {
  const steps = run.steps;
  const rows = [];
  if (has('lifecycle')) {
    rows.push(bag('steps', [
      ['driven', steps.filter(s => !s.lifecycle).length],
      ...tally(steps.filter(s => s.lifecycle).map(s => s.lifecycle)),
    ]));
  }
  if (has('settle_ended_by')) {
    const settling = steps.filter(s => s.settle_ended_by && s.settle_ended_by !== 'none');
    rows.push(bag('settle ended by', tally(steps.map(s => s.settle_ended_by || 'not recorded'))));
    const hits = steps.filter(s => s.settle_ceiling_hit).length;
    const unfilled = settling.filter(s => s.settle_elapsed_ms == null || s.settle_ceiling_hit == null).length;
    rows.push(el('div', { class: 'bagrow' }, el('b', { text: 'settle' }),
      el('span', { style: hits ? 'color: var(--fail)' : null }, el('i', { text: 'ceiling hits' }), String(hits)),
      el('span', { style: unfilled ? 'color: var(--warn)' : null }, el('i', { text: 'settling steps missing elapsed or ceiling' }), String(unfilled))));
  }
  if (run.warningSource === 'build' || has('warnings')) {
    rows.push(bag(
      run.warningSource === 'build' ? 'warnings, from the build' : 'warnings, as recorded, before the build',
      tally(run.warnings.map(w => w.warning || 'unnamed')), 'warn'));
  }
  if (has('before_screen_path') || has('final_screen_path')) {
    rows.push(bag('change captures', [
      ['before', steps.filter(s => s.before).length],
      ['ended', steps.filter(s => s.final).length],
    ]));
  }
  if (has('claim')) rows.push(bag('claims', [['checked', steps.filter(s => claimText(s)).length]]));
  if (has('input_accepted')) rows.push(bag('input', [['refused', steps.filter(s => s.input_accepted === 0).length]], 'fail'));
  if (!rows.length) return null;
  return el('div', { class: 'psec' },
    el('div', { class: 'psec-h' }, el('span', { class: 'h2', text: 'Recording' })),
    el('div', { class: 'rbag rrec' }, rows));
}

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

function table(caption, head, body) {
  return el('div', { class: 'rscroll' }, el('table', { class: 'rtab' },
    el('caption', { class: 'sr', text: caption }),
    el('thead', {}, el('tr', {}, head.map(h => el('th', { scope: 'col', text: h })))),
    el('tbody', {}, body)));
}

function fold(title, count, content, open = false) {
  return el('details', { class: 'rfold', open },
    el('summary', {}, el('span', { text: title }), el('span', { class: 'cap', text: String(count) })),
    content);
}

const PHASES = ['open', 'close_before_restore', 'close'];

/* Android stores an animation scale nobody has set as null and runs it at 1.0. */
function axisText(key, value) {
  const unset = value === undefined || value === null || value === 'null';
  if (unset && key.startsWith('animation_scale.')) return 'unset (1.0)';
  return unset ? '—' : String(value);
}

/* A value that differs from the `open` snapshot is marked: the session either
   changed it and restored it, or failed to. */
function device(run) {
  const rank = phase => (PHASES.includes(phase) ? PHASES.indexOf(phase) : PHASES.length);
  const snaps = [...run.snapshots].sort((a, b) => rank(a.phase) - rank(b.phase));
  const parts = [];
  if (snaps.length) {
    const flat = snaps.map(sn => flatten(sn.axes));
    const keys = [...new Set(flat.flatMap(f => Object.keys(f)))].sort();
    const first = flat[0];
    parts.push(fold('Device axes', keys.length, table('Device axes by snapshot phase', ['axis', ...snaps.map(sn => sn.phase)],
      keys.map(k => el('tr', {},
        el('th', { scope: 'row', text: k }),
        flat.map((f, i) => el('td', {
          class: i && String(f[k]) !== String(first[k]) ? 'moved' : null,
          text: axisText(k, f[k]),
        }))))), true));
  }
  if (run.settingsAtOpen.length) {
    parts.push(fold('Settings found at open', run.settingsAtOpen.length, table('App settings as found at open',
      ['step', 'screen', 'control', 'at open', 'now'],
      run.settingsAtOpen.map(r => el('tr', {},
        el('td', { text: pad(r.step ?? 0) }),
        el('td', { text: r.screen || r.screen_identity || '' }),
        el('td', { text: r.label || r.control_key || '' }),
        el('td', { text: r.value ?? '' }),
        el('td', { class: String(r.value_now) !== String(r.value) ? 'moved' : null, text: r.value_now ?? '' }))))));
  }
  if (run.controlNotes.length) {
    parts.push(fold('Control notes', run.controlNotes.length, table('Notes the run filed against controls',
      ['step', 'kind', 'screen', 'control', 'reason'],
      run.controlNotes.map(r => el('tr', {},
        el('td', { text: pad(r.step ?? 0) }),
        el('td', { text: r.kind || '' }),
        el('td', { text: r.screen_identity || '' }),
        el('td', { class: 'wrap', text: r.control_key || '—' }),
        el('td', { class: 'why', text: r.reason || '' }))))));
  }
  if (!parts.length) return null;
  return el('div', { class: 'psec' },
    el('div', { class: 'psec-h' }, el('span', { class: 'h2', text: 'Device and settings' })),
    parts);
}

/* The whole page. One run at a time, picked from the dropdown. */
/* The trace opens in the Perfetto UI through a trace_processor this machine runs: the UI talks to
   that server over its RPC port, so the trace never leaves the machine. A permalink would upload
   it, which is why this is the only link offered. */
function traceLink(listed, sourceUrl) {
  if (!listed.trace) return el('span', { text: 'no trace recorded' });
  const note = el('span', { text: '' });
  const source = (sourceUrl || '').split('/').filter(Boolean)[1];
  const open = el('a', {
    href: '#',
    text: `open ${listed.trace} in perfetto`,
    onclick: async (event) => {
      event.preventDefault();
      note.textContent = ' starting a local trace_processor…';
      let answer;
      try {
        answer = await (await fetch(`/trace/${source}/${listed.id}/open`, { cache: 'no-cache' })).json();
      } catch (error) {
        answer = { ok: false, reason: String(error) };
      }
      if (!answer.ok) { note.textContent = ` ${answer.reason}`; return; }
      note.textContent = ` serving on 127.0.0.1:${answer.port}`;
      window.open(`https://ui.perfetto.dev/#!/?rpc_port=${answer.port}`, '_blank', 'noopener');
    },
  });
  return el('span', {}, open, note);
}

export async function renderRuns(state, wanted) {
  const stepHash = /^#step-\d+$/.test(location.hash) ? location.hash : '';
  const runs = (state.manifest.runs || []).filter(r => r.has_db);
  const page = el('div', { class: 'page' });

  if (!runs.length) {
    page.append(el('div', { class: 'rhead' },
      el('div', { class: 'rhead-top' }, el('h1', { style: 'margin:0; font:700 22px/1.1 var(--display)', text: 'Runs' }))),
      el('p', { class: 'empty-run', text: 'No run folder under runs/ holds a run.db. Nothing has driven this app yet.' }));
    return page;
  }

  let current = runs.some(r => r.id === wanted) ? wanted : runs[0].id;

  async function show(id) {
    current = id;
    // The URL carries the run, so a reload and a shared link both land here.
    history.replaceState(null, '', href('runs.html', { id }));
    page.replaceChildren(el('p', { class: 'empty-run', text: `Reading ${id}…` }));

    let run;
    try {
      run = await loadRun(state.source.url, id, { built: Boolean((runs.find(r => r.id === id) || {}).has_post_map) });
    } catch (err) {
      page.replaceChildren(el('p', { class: 'empty-run', text: `Could not read ${id}: ${err.message || err}` }));
      return;
    }

    const v = verdict(run);
    const mix = OUTCOMES.filter(k => run.counts[k]).map(k =>
      el('span', { style: `--c: var(--${INK[k]})` }, String(run.counts[k]), el('i', { text: k })));
    const has = c => run.columns.has(c);
    const setup = has('lifecycle') ? run.steps.filter(s => s.lifecycle === 'setup') : [];
    const teardown = has('lifecycle') ? run.steps.filter(s => s.lifecycle === 'teardown') : [];
    const driven = run.steps.filter(s => !setup.includes(s) && !teardown.includes(s));
    const jump = step => el('a', {
      href: `#step-${pad(step.ord)}`,
      text: `${pad(step.ord)} ${step.action}${step.control_key ? ` ${step.control_key}` : ''}`,
      onclick: (ev) => {
        ev.preventDefault();
        const row = page.querySelector(`#step-${pad(step.ord)}`);
        if (!row) return;
        row.openNotes();
        row.scrollIntoView({ block: 'center' });
        row.focus({ preventScroll: true });
      },
    });

    page.replaceChildren(
      el('div', { class: 'rhead' },
        el('div', { class: 'rhead-top' }, runPicker(runs, current, show)),
        el('div', { class: 'verdict' },
          el('b', { style: `--c: var(--${v.ink})`, text: v.text }),
          el('div', { class: 'mix' }, mix)),
        el('div', { class: 'rmeta-line' },
          `${run.label || '(no label)'} · ${run.device} · `
          + `${run.endedAt ? secs(runMinutes(run) * 60) : 'no end recorded'} · ${run.steps.length} steps`,
          v.failed.length
            ? el('span', { class: 'rfailed' }, 'failed', v.failed.map(jump))
            : null),
        el('div', { class: 'rfiles' },
          videoFiles(run),
          (run.paired ? ['logcat.txt', 'config.json'] : ['logcat.txt', 'calls.jsonl']).map(f =>
            el('span', {}, el('a', { href: run.base + f, target: '_blank', text: f }))),
          run.found ? el('span', {}, el('a', { href: run.found, target: '_blank', text: 'device as found' })) : null,
          !run.paired ? null : (runs.find(r => r.id === run.id) || {}).has_post_map
            ? el('span', {},
              el('a', { href: href('map.html', { run: run.id }), text: 'map of this run' }), ' · ',
              el('a', { href: `${run.base}post/map.db`, target: '_blank', text: 'post/map.db' }))
            : el('span', { text: 'map not built yet (map_build_run)' }),
          traceLink(runs.find(r => r.id === run.id) || {}, state.source.url))),

      recording(run, has),
      device(run),

      el('div', { class: 'psec' },
        el('div', { class: 'psec-h' },
          el('span', { class: 'h2', text: 'Cases' }),
          el('span', { class: 'cap', text: '0' })),
        // Named rather than hidden: an empty section a reader cannot explain
        // looks like a broken view.
        el('p', { class: 'empty-run', text: 'Nothing has written test_case, so this run has no cases above its steps. What follows is the run itself, in the order it happened.' })),

      lifecycleSection(run, 'Session setup', setup),

      el('div', { class: 'psec' },
        el('div', { class: 'psec-h' },
          el('span', { class: 'h2', text: 'Steps' }),
          el('span', { class: 'cap', text: String(driven.length) })),
        el('div', { class: 'cases' }, el('div', { class: 'case' },
          el('div', { class: 'case-b', style: 'padding:14px' }, attempt(run, driven))))),

      lifecycleSection(run, 'Session teardown', teardown));
  }

  await show(current);
  const target = stepHash ? page.querySelector(stepHash) : null;
  if (target) requestAnimationFrame(() => { target.openNotes(); target.scrollIntoView({ block: 'center' }); });
  return page;
}
