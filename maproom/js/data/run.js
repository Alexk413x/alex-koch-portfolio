/* One run folder's run.db, opened on demand. Runs are never merged, so each is a
   separate file and a separate fetch, loaded only when a reader opens that run. */

import { openDatabase, rows, tableNames, readTable } from './db.js';

/* Read by name and intersected with the table's real columns, so a run written
   before the record-then-map layout (blobs, no paths) still opens. `xml` and `png`
   are never selected: an old run holds its screenshots inside the database. */
const STEP_COLUMNS = [
  'ord', 'action', 'args', 'mode', 'ok', 'outcome', 'message', 'event',
  'target', 'target_id', 'target_label', 'target_class', 'target_bounds', 'control_key',
  'from_digest', 'to_digest', 'screen_identity_from', 'screen_identity_to', 'screen_name',
  'started_at', 'ended_at', 'captured_at', 'activity',
  'screen_path', 'tree_path', 'list_read_id', 'transport', 'mask', 'expect',
  'lifecycle', 'warnings', 'claim', 'input_accepted',
  'settle_wait_ms', 'settle_waited_for', 'settle_elapsed_ms', 'settle_ceiling_hit', 'settle_ended_by',
  'transient_settle', 'window_sync', 'toast_windows',
  'before_screen_path', 'before_tree_path', 'final_screen_path', 'final_tree_path',
];

const SNAPSHOT_COLUMNS = ['phase', 'captured_at', 'axes'];

/* `unchecked` is driven but not verified, and is never reported as a success. */
export const OUTCOMES = ['held', 'already', 'unchecked', 'failed'];

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function byStep(list) {
  return list.sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
}

function columns(db, table) {
  return new Set(rows(db, `pragma table_info(${table})`).map(r => r.name));
}

/* The build's warnings, which reclassify the recorder's raw `step.warnings`
   (a mismatch a timed-out transient explains becomes `surface-expired`) and add
   kinds only the build can see. Null when the run has no build. Rows without a
   `warning` are no_change steps the build checked and found consistent. */
async function builtWarnings(base) {
  try {
    const res = await fetch(`${base}post/analysis/warnings.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) ? list.filter(w => w && w.warning) : null;
  } catch {
    return null;
  }
}

export async function loadRun(baseUrl, runId, { built = true } = {}) {
  const base = `${baseUrl}runs/${runId}/`;
  const analysis = built ? builtWarnings(base) : Promise.resolve(null);
  const db = await openDatabase(`${base}run.db`);
  const warnings = await analysis;
  try {
    const present = tableNames(db);
    if (!present.has('run') || !present.has('step')) {
      throw new Error(`${runId}/run.db has no run or step table`);
    }
    const have = columns(db, 'step');
    const paired = have.has('screen_path') && have.has('tree_path');
    const wanted = STEP_COLUMNS.filter(c => have.has(c)).join(', ');
    const head = rows(db, 'select * from run limit 1')[0] || {};
    const steps = rows(db, `select ${wanted} from step order by ord`);
    const snapHave = present.has('device_snapshot') ? columns(db, 'device_snapshot') : new Set();
    const snapshots = snapHave.has('phase')
      ? rows(db, `select ${SNAPSHOT_COLUMNS.filter(c => snapHave.has(c)).join(', ')} from device_snapshot`)
        .map(r => ({ phase: r.phase, capturedAt: r.captured_at || 0, axes: parseJson(r.axes) || {} }))
      : [];

    const reads = new Map();
    if (present.has('list_read')) {
      for (const r of rows(db, 'select * from list_read order by id')) {
        reads.set(r.id, { ...r, views: parseJson(r.views) || [], mergedRows: parseJson(r.merged_rows) || [] });
      }
    }

    for (const s of steps) {
      s.argsObj = parseJson(s.args) || {};
      s.expectObj = parseJson(s.expect);
      s.activityObj = parseJson(s.activity) || {};
      s.warningList = warnings
        ? warnings.filter(w => w.step === s.ord)
        : parseJson(s.warnings) || [];
      s.claimObj = parseJson(s.claim);
      s.windowSync = parseJson(s.window_sync);
      s.transientSettle = parseJson(s.transient_settle);
      s.toasts = parseJson(s.toast_windows) || [];
      s.before = s.before_screen_path ? { screenshot: base + s.before_screen_path, screenstate: s.before_tree_path ? base + s.before_tree_path : null } : null;
      s.final = s.final_screen_path ? { screenshot: base + s.final_screen_path, screenstate: s.final_tree_path ? base + s.final_tree_path : null } : null;
      if (paired) {
        // NULL paths mean the driver returned no screenshot or no tree for this step.
        s.screenshot = s.screen_path ? base + s.screen_path : null;
        s.screenstate = s.tree_path ? base + s.tree_path : null;
      } else {
        const stem = String(s.ord).padStart(4, '0');
        s.screenshot = `${base}screens/${stem}.png`;
        s.screenstate = `${base}screenstates/${stem}.xml`;
      }
      s.read = s.list_read_id != null ? reads.get(s.list_read_id) || null : null;
      s.failed = s.outcome === 'failed' || s.ok === 0;
      s.timedOut = /timed out|^timeout/.test(s.event || '');
    }

    const counts = {};
    for (const s of steps) counts[s.outcome] = (counts[s.outcome] || 0) + 1;
    const first = steps.find(s => s.ord === 0);

    return {
      id: runId,
      base,
      label: head.label || '',
      device: head.device || '',
      package: head.package || '',
      parentRun: head.parent_run || '',
      startedAt: head.started_at || 0,
      endedAt: head.ended_at || 0,
      context: parseJson(head.context) || {},
      close: parseJson(head.close) || {},
      paired,
      columns: have,
      warningSource: warnings ? 'build' : 'recorded',
      warnings: warnings || steps.flatMap(s => s.warningList),
      steps,
      counts,
      snapshots,
      settingsAtOpen: byStep(readTable(db, present, 'setting_at_open')),
      controlNotes: byStep(readTable(db, present, 'control_note')),
      videos: readTable(db, present, 'video', 'ord')
        .map(v => ({ ...v, url: v.path ? base + v.path : null, cuts: parseJson(v.cuts) || [] })),
      // An old run keeps the device as found at ordinal zero with no step row.
      found: paired ? (first && first.screenshot) : `${base}screens/0000.png`,
    };
  } finally {
    db.close();
  }
}

/* The headline, from what the record can show. A failed step reads as the run
   breaking only when nothing was driven after it or the run never closed; a run
   that carried on past a refused action and closed is not broken by it. Which
   failures a project designed in is not recorded in run.db, so none is excused. */
export function verdict(run) {
  const failed = run.steps.filter(s => s.failed);
  const crashes = Number(run.close.crash_count) || 0;
  const driven = run.steps.filter(s => !s.lifecycle);
  const lastDriven = driven.length ? driven[driven.length - 1].ord : -1;
  const brokeAt = failed.find(s => !s.lifecycle && (s.ord === lastDriven || !run.endedAt));
  if (crashes) return { ink: 'fail', text: `${crashes} crash${crashes === 1 ? '' : 'es'}`, failed, brokeAt };
  if (brokeAt) return { ink: 'fail', text: `broke at step ${String(brokeAt.ord).padStart(3, '0')}`, failed, brokeAt };
  if (!run.endedAt) return { ink: 'warn', text: 'unfinished', failed, brokeAt: null };
  if (failed.length) {
    return { ink: 'text', text: `ran to close · ${failed.length} failed step${failed.length === 1 ? '' : 's'}`, failed, brokeAt: null };
  }
  return { ink: 'pass', text: 'every claim held', failed, brokeAt: null };
}

/* From the run's own timestamps, never a sum of step durations: the gaps between
   steps are in no column. */
export function runMinutes(run) {
  if (!run.endedAt || !run.startedAt) return 0;
  return (run.endedAt - run.startedAt) / 60;
}

/* The kept file showing `step` and the offset into it, as runfolder.video_at maps it: a
   file's start, less the gap of each cut before the moment. A run recorded before the
   `video` table has one file, where recording starts before the first step and the
   container is padded one second. Null when no kept file covers the step. */
export function videoAt(run, step) {
  if (!run.videos || !run.videos.length) {
    return { url: `${run.base}video.mp4`, offset: videoOffset(run, step), inGap: false };
  }
  const at = step.started_at;
  if (!at) return null;
  for (const v of run.videos) {
    if (v.started_at == null || v.ended_at == null || at < v.started_at || at > v.ended_at) continue;
    let skipped = 0;
    let inGap = false;
    for (const cut of [...v.cuts].sort((a, b) => (a.at || 0) - (b.at || 0))) {
      if (cut.at == null || cut.at - (cut.gap_s || 0) >= at) break;
      if (cut.gap_s == null) return { url: v.url, offset: null, inGap: false };
      if (at >= cut.at) skipped += cut.gap_s;
      else { inGap = true; skipped += at - (cut.at - cut.gap_s); }
    }
    return { url: v.url, offset: at - v.started_at - skipped, inGap };
  }
  return null;
}

function videoOffset(run, step) {
  const first = run.steps.length ? run.steps[0].started_at : 0;
  if (!first || !step.started_at) return 0;
  return Math.max(0, step.started_at - first + 1);
}

export function fileName(url) {
  return url ? url.slice(url.lastIndexOf('/') + 1) : '';
}
