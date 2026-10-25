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

import { el, setChildren } from '../util/dom.js';
import { icon, phoneIcon, platformIcon } from '../util/icons.js';
import { picker } from '../util/picker.js';
import { segmentedGroup } from '../util/segmented.js';
import { href } from '../page.js';
import {
  loadRun, videoAt, runVideoSegments, offsetAt, fileName,
} from '../data/run.js';
import {
  elementFilterIcon,
  elementInspector,
  elementMatchesFilter,
  restackElementOverlay,
  updateActiveOutline,
} from './elements.js';
import { parseUiTree } from '../data/uistate.js';

/* Seconds, in the artboard's own format. */
/* Every video file the run kept, in recording order, each with its turn and the stretch of
   the run it covers. A run recorded before the `video` table lists `video.mp4` alone. */
function videoFiles(run) {
  const videos = run.videos?.length ? run.videos : [{
    source: 'video.mp4', url: `${run.base}video.mp4`, rotation: null,
    started_at: null, ended_at: null, cuts: [],
  }];
  const from = run.startedAt || videos[0].started_at || 0;
  const clock = time => Number.isFinite(time) ? videoTime(Math.max(0, time - from)) : '—';
  return videos.map(video => artifactRow(
    video.url ? fileName(video.url) : video.source,
    video.url ? el('a', { href: video.url, target: '_blank', text: fileName(video.url) })
      : `${video.source} (not kept)`,
    [
      `Rotation ${video.rotation ?? 'not recorded'}`,
      video.started_at == null && video.ended_at == null
        ? 'Run time not recorded' : `${clock(video.started_at)}–${clock(video.ended_at)}`,
      video.cuts?.length ? `${video.cuts.length} cuts` : null,
    ].filter(Boolean).join(' · '),
  ));
}

function artifactRow(name, content, metadata = '') {
  return el('div', { class: 'run-artifact-row', 'data-artifact': name },
    el('span', { class: 'run-artifact-kind', text: name }),
    el('span', { class: 'run-artifact-content' }, content),
    metadata ? el('span', { class: 'run-artifact-meta', text: metadata }) : null);
}

function artifactGroup(title, rows) {
  return rows.length
    ? el('section', { class: 'run-artifact-group' },
      el('h3', { class: 'run-artifact-group-title', text: title }),
      el('div', { class: 'run-artifact-rows' }, rows))
    : null;
}

function issueChips(run) {
  const errors = run.steps.filter(step => step.failed).length;
  return [
    run.warnings.length
      ? el('span', { class: 'recording-issue-chip warn', text: `Warnings ${run.warnings.length}` })
      : null,
    errors
      ? el('span', { class: 'recording-issue-chip fail', text: `Errors ${errors}` })
      : null,
  ].filter(Boolean);
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
function runPickerMetadata(run) {
  const appearance = String(run.appearance || run.mode || '').toLowerCase();
  const fields = [
    ['Platform', run.platform, () =>
      icon(platformIcon(run.platform), 14, `Platform: ${readableValue(run.platform)}`)],
    ['Orientation', run.orientation, () =>
      icon(phoneIcon(run.platform), 14, `Orientation: ${readableValue(run.orientation)}`,
        String(run.orientation).toLowerCase() === 'landscape')],
    ['Theme', appearance, () =>
      icon(appearance === 'light' ? 'sun' : appearance === 'dark' ? 'moon' : 'auto',
        14, `Theme: ${readableValue(appearance)}`)],
    ['Locale', run.locale, () => icon('language', 14, `Locale: ${run.locale}`)],
  ];
  return {
    note: el('span', { class: 'run-picker-metadata' }, fields.map(([name, value, makeIcon]) =>
      value
        ? makeIcon()
        : el('span', { class: 'run-picker-help', title: `${name} not recorded`,
          'data-tip': `${name} not recorded`, 'aria-hidden': 'true', text: '?' })),
      run.has_db ? null : el('span', { class: 'run-picker-help', title: 'Run database not recorded',
        'data-tip': 'Run database not recorded', 'aria-hidden': 'true', text: '?' })),
    ariaLabel: `${readableDate(run)}, ${fields.map(([name, value]) =>
      `${name} ${value ? readableValue(value) : 'not recorded'}`).join(', ')}`
      + (run.has_db ? '' : ', run database not recorded'),
    searchText: `${run.id} ${fields.map(([, value]) => value || '').join(' ')}`,
  };
}

function readableValue(value) {
  return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function runPicker(runs, current, onPick) {
  const control = picker('Run', runs.map(r => ({
    value: r.id,
    label: readableDate(r),
    ...runPickerMetadata(r),
  })), current, onPick, { search: 'Find A Run' });
  control.classList.add('run-picker');
  return control;
}

function timestampAtOffset(video, offset) {
  let skipped = 0;
  for (const cut of [...(video.cuts || [])].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    if (cut.at == null || cut.gap_s == null) continue;
    const cutOffset = cut.at - video.started_at - skipped - cut.gap_s;
    if (offset >= cutOffset) skipped += cut.gap_s;
    else break;
  }
  return video.started_at + offset + skipped;
}

const pad = ord => String(ord).padStart(3, '0');

const ACTION_LABELS = {
  open: 'Start session',
  'launch-app-by-package-activity': 'Open app',
  'activate-focused-element': 'Tap',
  back: 'Go back',
  'rotate-display': 'Rotate screen',
  'read-list': 'Read list',
  'scroll-to-row': 'Scroll list',
  'replace-text': 'Enter text',
  'ime-enter': 'Submit text',
  observe: 'Observe',
  close: 'Close session',
};

function readableStepAction(action) {
  const raw = String(action || '').replace(/[-_]+/g, ' ').trim();
  const label = ACTION_LABELS[action] || raw;
  return label ? label[0].toUpperCase() + label.slice(1) : 'Step';
}

function readableStepTarget(step, run) {
  const raw = step.action === 'launch-app-by-package-activity'
    ? step.target_label || step.argsObj?.label || step.argsObj?.app_name
      || step.argsObj?.package || step.activityObj?.label || step.activityObj?.package
      || run.package
    : step.target_label || step.control_key || step.target;
  const value = String(raw || '').trim();
  const target = step.action === 'launch-app-by-package-activity'
    ? value.split('.').at(-1) : value;
  return target
    .replace(/^android\.view\.[^:@]+:/, '')
    .replace(/^android\.view\.[^@]+@(?:android:)?id\/(.+)$/, '$1')
    .replace(/^.*:id\/(.+)$/, '$1')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function quote(v) {
  return v == null ? 'not read' : `“${v}”`;
}

function settleText(step) {
  if (step.settle_ended_by == null && step.settle_elapsed_ms == null) return null;
  return [
    step.settle_ended_by ? `ended by ${step.settle_ended_by}` : 'end not recorded',
    step.settle_waited_for && `waited for ${step.settle_waited_for}`,
    step.settle_elapsed_ms == null ? 'elapsed not recorded' : `spent ${step.settle_elapsed_ms} ms`,
    step.settle_wait_ms != null && `quiet-window value ${step.settle_wait_ms} ms`,
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

let runCapturePreview = null;
let runCaptureSession = null;

function runCaptureAxes(run) {
  const opening = run.snapshots.find(snapshot => snapshot.phase === 'open')?.axes || {};
  const axes = { ...opening, ...(run.config.axes || {}) };
  if (axes.appearance === undefined && axes['night-mode'] !== undefined) {
    axes.appearance = axes['night-mode'] === 'on' ? 'dark' : 'light';
  }
  if (axes.nav === undefined && axes.navigation_mode !== undefined) {
    axes.nav = axes.navigation_mode;
  }
  return axes;
}

function runCaptureRecord(run, step, shot) {
  const axes = runCaptureAxes(run);
  const capturedAt = step.captured_at;
  const captureTime = shot.label === 'captured' && capturedAt !== null
    && capturedAt !== undefined && capturedAt !== ''
    && Number.isFinite(Number(capturedAt)) && Number(capturedAt) > 0
    ? new Date(Number(capturedAt) * 1000).toISOString()
    : null;
  const appBuild = run.config.app_build && typeof run.config.app_build === 'object'
    ? run.config.app_build : {};
  const timestamp = captureTime ? { captured_at: captureTime } : {};
  return {
    tree: {
      ...appBuild,
      axes: Object.entries(axes).map(([key, value]) => `${key}=${value}`).join(';'),
      source: 'Run record',
      observed: { package: run.package || step.activityObj?.package || '' },
      ...timestamp,
    },
    shot: { source: 'Run record', ...timestamp },
  };
}

function markRunStateElements(tree) {
  for (const node of tree.elements) {
    const attributes = new Map(node.attributes.map(attribute => [attribute.key, attribute.value]));
    node.inState = ['checkable', 'checked', 'selected']
      .some(key => attributes.get(key) === 'true')
      || attributes.get('editable') === 'true'
      || Boolean((attributes.get('state-desc') || '').trim())
      || /^(?:CheckBox|RadioButton|Switch|ToggleButton|Spinner|SeekBar|EditText|AutoCompleteTextView)$/i
        .test(node.type);
  }
  return tree;
}

function getRunCapturePreview() {
  if (runCapturePreview) return runCapturePreview;
  const caption = el('span', { class: 'capture-preview-caption' });
  const metadata = el('div', { class: 'capture-preview-meta' });
  const image = el('img', { class: 'capture-preview-image', alt: '', hidden: true });
  const message = el('p', {
    class: 'capture-info-message',
    text: 'No UI hierarchy is stored for this capture.',
    hidden: true,
  });
  const elements = el('div', { class: 'capture-preview-elements', hidden: true });
  const body = el('div', { class: 'capture-preview-body' }, image, message, elements);
  const filterOptions = [
    { value: 'all', label: 'All elements', title: 'All elements' },
    { value: 'interactive', label: 'Interactive elements', title: 'Interactive elements' },
    { value: 'state', label: 'State elements', title: 'State elements' },
  ];
  const filterGroup = segmentedGroup(filterOptions.map(option => ({
    value: option.value,
    label: option.label,
    title: option.title,
    content: elementFilterIcon(option.value),
    attributes: { 'data-filter': option.value },
  })), {
    isSelected: value => runCaptureSession?.filter === value,
    onChange: setRunCaptureFilter,
    allowNone: true,
    label: 'Element outline filters',
    className: 'element-filter-group',
    buttonClassName: 'element-filter-button',
  });
  const dialog = el('dialog', {
    class: 'capture-preview',
    'aria-label': 'Run capture inspector',
  },
  el('div', { class: 'capture-preview-head' },
    el('div', { class: 'capture-preview-title' }, caption, metadata),
    el('button', {
      class: 'capture-preview-close',
      type: 'button',
      'aria-label': 'Close preview',
      onclick: () => dialog.close(),
    }, icon('close', 18))),
  body);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (runCaptureSession) runCaptureSession.request += 1;
    runCaptureSession = null;
    image.removeAttribute('src');
    setChildren(elements);
  });
  document.body.append(dialog);
  runCapturePreview = { dialog, caption, metadata, image, message, elements, filterGroup };
  return runCapturePreview;
}

function setRunCaptureFilter(filter) {
  const session = runCaptureSession;
  if (!session) return;
  const previousFilter = session.filter;
  session.filter = filter;
  for (const button of session.preview.filterGroup.querySelectorAll('.element-filter-button')) {
    const selected = filter === button.dataset.filter;
    button.classList.toggle('on', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  const root = session.preview.elements;
  for (const node of root.querySelectorAll('.element-box')) {
    const visible = elementMatchesFilter(node, filter);
    node.dataset.visible = String(visible);
    node.setAttribute('stroke-opacity', visible ? '0.5' : '0');
  }
  for (const node of root.querySelectorAll('.element-item')) {
    node.closest('.element-list-row').dataset.visible = String(elementMatchesFilter(node, filter));
  }
  for (const path of root.querySelectorAll('.element-tree-rails path')) {
    const item = [...root.querySelectorAll('.element-item')]
      .find(candidate => candidate.dataset.elementId === path.dataset.railId);
    path.setAttribute('stroke-opacity', item && elementMatchesFilter(item, filter) ? '1' : '0.3');
  }
  root.querySelector('.element-inspector-stage')?.dispatchEvent(
    new CustomEvent('element-filter-change', {
      detail: { filter, previousFilter },
    }),
  );
  const active = session.hovered ?? session.selected;
  restackElementOverlay(root.querySelector('.element-overlay'), session.selected, session.hovered);
  updateActiveOutline(root.querySelector('.element-overlay'), active);
}

function drawRunCapture(session) {
  const { preview } = session;
  const cell = session.cell;
  setChildren(preview.elements, elementInspector({
    cell,
    tree: session.tree,
    filter: session.filter,
    selected: session.selected,
    getSelected: () => runCaptureSession === session ? session.selected : null,
    loading: session.loading,
    error: session.error,
    filterGroup: preview.filterGroup,
    captureInfo: session.captureInfo,
    captureInfoLoaded: true,
    captureInfoOpen: false,
    paneSelection: 'elements',
    device: { name: session.run.device },
    onToggleCaptureInfo: visible => {
      if (!visible) return;
      preview.elements.querySelector('.element-inspector-stage')?.dispatchEvent(
        new CustomEvent('capture-info-update', {
          detail: {
            record: session.captureInfo,
            loaded: true,
            isLoading: false,
            loadError: '',
          },
        }),
      );
    },
    onRetry: () => loadRunCaptureTree(session),
    onSelect: (id, persist = true) => {
      if (runCaptureSession !== session) return;
      if (persist) {
        session.selected = id;
        session.hovered = null;
      } else {
        session.hovered = id;
      }
      const active = session.hovered ?? session.selected;
      for (const node of preview.elements.querySelectorAll('[data-element-id]')) {
        const elementId = node.dataset.elementId;
        const selected = elementId === String(session.selected);
        const isActive = elementId === String(active);
        node.classList.toggle('active', isActive);
        node.classList.toggle('selected', selected);
        if (node.hasAttribute('aria-pressed')) node.setAttribute('aria-pressed', String(selected));
      }
      const overlay = preview.elements.querySelector('.element-overlay');
      restackElementOverlay(overlay, session.selected, session.hovered);
      updateActiveOutline(overlay, active);
    },
  }));
  preview.elements.hidden = false;
}

async function loadRunCaptureTree(session) {
  const request = ++session.request;
  session.loading = true;
  session.error = '';
  session.tree = null;
  drawRunCapture(session);
  try {
    const response = await fetch(session.shot.screenstate, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const tree = markRunStateElements(parseUiTree(await response.text()));
    if (runCaptureSession !== session || request !== session.request) return;
    session.tree = tree;
  } catch (error) {
    if (runCaptureSession !== session || request !== session.request) return;
    session.error = `Could not read this capture's UI hierarchy: ${error.message || error}`;
  }
  session.loading = false;
  drawRunCapture(session);
}

function inspectRunCapture(run, step, shot) {
  const preview = getRunCapturePreview();
  const axes = runCaptureAxes(run);
  const cell = {
    url: shot.screenshot,
    orientation: '',
    appearance: axes.appearance || 'default',
    leaf: axes.locale ? { locale: axes.locale } : null,
  };
  runCaptureSession = {
    run,
    step,
    shot,
    preview,
    cell,
    filter: 'all',
    selected: null,
    hovered: null,
    request: 0,
    tree: null,
    loading: false,
    error: '',
    captureInfo: runCaptureRecord(run, step, shot),
  };
  const session = runCaptureSession;
  preview.caption.textContent = `Step ${pad(step.ord)} · ${shot.label}`;
  setChildren(preview.metadata,
    el('span', { text: `${readableStepAction(step.action)}${readableStepTarget(step, run)
      ? ` · ${readableStepTarget(step, run)}` : ''}` }));
  for (const button of preview.filterGroup.querySelectorAll('.element-filter-button')) {
    const selected = button.dataset.filter === 'all';
    button.classList.toggle('on', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  if (shot.screenstate) {
    preview.image.hidden = true;
    preview.message.hidden = true;
    preview.elements.hidden = false;
    loadRunCaptureTree(session);
  } else {
    preview.elements.hidden = true;
    preview.image.src = shot.screenshot;
    preview.image.alt = `Step ${pad(step.ord)} ${shot.label} capture`;
    preview.image.hidden = false;
    preview.message.hidden = false;
    setChildren(preview.elements);
  }
  if (!preview.dialog.open) preview.dialog.showModal();
}

function warningNote(w, source) {
  const facts = Object.entries(w).filter(([k]) => k !== 'warning' && k !== 'step')
    .map(([k, v]) => `${k} ${v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : v}`);
  return el('div', { class: 'anote' },
    el('span', { class: 'run-step-warning', title: source === 'build' ? 'Build warning' : 'Recorded warning' },
      el('em', { text: w.warning || 'unnamed' }), facts.length ? `  ${facts.join(' · ')}` : ''));
}

function thumbs(step, run) {
  const n = pad(step.ord);
  const shots = [
    step.before && { ...step.before, label: 'before', alt: `Step ${n}, the screen before its input` },
    step.screenshot && { screenshot: step.screenshot, screenstate: step.screenstate, label: 'captured', alt: `Step ${n}, the screen as the step captured it` },
    step.final && { ...step.final, label: 'ended', alt: `Step ${n}, the screen as the step ended` },
  ].filter(Boolean);
  if (!shots.length) return null;
  return el('div', { class: 'sthumbs' }, shots.map(sh => el('figure', {},
    el('button', {
      class: 'run-step-capture',
      type: 'button',
      'aria-label': `Inspect ${sh.label} capture for step ${n}`,
      onclick: () => inspectRunCapture(run, step, sh),
    },
      el('img', { src: sh.screenshot, alt: sh.alt, loading: 'lazy' })))));
}

/* One step's claim and its evidence, shown under the step row. */
function stepNotes(run, step) {
  const notes = [];
  for (const w of step.warningList) notes.push(warningNote(w, run.warningSource));
  if (step.message && !/^no claim was given, so nothing was checked\.?$/i.test(step.message.trim())) {
    notes.push(el('div', { class: 'anote' },
      el('span', { class: step.failed ? 'run-step-failure' : '', text: step.message })));
  }
  if (step.expectObj) {
    const e = step.expectObj;
    const text = `${e.kind}${e.selector ? ` ${e.selector}` : ''}${e.expected ? ` = ${e.expected}` : ''}`;
    notes.push(el('div', { class: 'anote said' },
      el('span', { text })));
  }
  const claim = claimText(step);
  if (claim) notes.push(el('div', { class: 'anote said' }, el('span', { text: claim })));
  if (step.input_accepted === 0 || (claim && step.input_accepted != null)) {
    notes.push(el('div', { class: 'anote' },
      el('span', { class: step.input_accepted ? '' : 'run-step-failure',
        text: step.input_accepted ? 'Input accepted' : 'Input refused' })));
  }
  if (step.event) {
    notes.push(el('div', { class: 'anote' },
      el('span', { class: step.timedOut ? 'run-step-failure' : '', text: step.event })));
  }
  const settle = settleText(step);
  if (settle) notes.push(el('div', { class: 'anote' },
    el('span', { class: step.settle_ceiling_hit ? 'run-step-failure' : '', text: settle })));
  if (step.windowSync)
    notes.push(el('div', { class: 'anote' }, el('span', { text: windowSyncText(step.windowSync) })));
  if (step.transientSettle)
    notes.push(el('div', { class: 'anote' }, el('span', { text: transientText(step.transientSettle) })));
  for (const toast of step.toasts)
    notes.push(el('div', { class: 'anote' }, el('span', { text: toastText(step, toast) })));
  const shownName = step.screen_name && !step.screen_name.includes('+') ? step.screen_name : '';
  if (shownName) notes.push(el('div', { class: 'anote' }, el('span', { text: shownName })));
  if (step.read) {
    const r = step.read;
    notes.push(el('div', { class: 'anote' },
      el('span', {},
        `${r.outcome} · ${r.mergedRows.length} rows · ${r.views.length} views · `
        + `${r.return_confirmed ? 'return confirmed' : 'return not confirmed'}`)));
  }
  const screenshots = thumbs(step, run);
  const runStart = Number.isFinite(run.startedAt) && run.startedAt > 0
    ? run.startedAt : step.started_at;
  const startTime = videoTime(Math.max(0, step.started_at - runStart));
  const endTime = Number.isFinite(step.ended_at)
    ? videoTime(Math.max(0, step.ended_at - runStart)) : '—';
  const videoTimeRange = el('div', {
    class: 'run-step-video-range',
    'aria-label': `${startTime} to ${endTime} on the run video timeline`,
    text: `${startTime}–${endTime}`,
  });
  return el('div', { class: `note run-step-note-layout${screenshots ? ' has-thumbs' : ''}` },
    screenshots,
    el('div', { class: 'run-step-note-details' }, videoTimeRange, notes));
}

function animateStepNotes(notes, open, animationState) {
  const wasHidden = notes.hidden;
  const fromHeight = wasHidden ? 0 : notes.getBoundingClientRect().height;
  const fromOpacity = wasHidden ? 0 : Number.parseFloat(getComputedStyle(notes).opacity) || 1;
  animationState.current?.cancel();
  notes.hidden = false;
  notes.style.overflow = 'hidden';
  notes.style.height = `${fromHeight}px`;
  notes.style.opacity = String(fromOpacity);
  const toHeight = open ? notes.scrollHeight : 0;
  const toOpacity = open ? 1 : 0;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || typeof notes.animate !== 'function') {
    animationState.current = null;
    notes.hidden = !open;
    notes.style.removeProperty('height');
    notes.style.removeProperty('opacity');
    notes.style.removeProperty('overflow');
    return;
  }
  const animation = notes.animate([
    { height: `${fromHeight}px`, opacity: fromOpacity },
    { height: `${toHeight}px`, opacity: toOpacity },
  ], {
    duration: 220,
    easing: 'cubic-bezier(.16, 1, .3, 1)',
  });
  animationState.current = animation;
  animation.onfinish = () => {
    if (animationState.current !== animation) return;
    animationState.current = null;
    notes.hidden = !open;
    animation.cancel();
    notes.style.removeProperty('height');
    notes.style.removeProperty('opacity');
    notes.style.removeProperty('overflow');
  };
}

function stepRow(run, step, onSelect = null, onExpand = null) {
  let notes = null;
  const notesAnimation = { current: null };
  const toggle = (select = true) => {
    if (select) onSelect?.(step);
    if (!notes) {
      notes = stepNotes(run, step);
      notes.hidden = true;
      row.after(notes);
    }
    const open = row.getAttribute('aria-expanded') !== 'true';
    animateStepNotes(notes, open, notesAnimation);
    row.setAttribute('aria-expanded', String(open));
    onExpand?.(row, notes, open);
  };
  const row = el('div', {
    // `.unrun` strikes the row through, which says the step never happened.
    // `unchecked` means it ran and carried no claim, so it must not get that
    // class -- it was striking out 17 of this run's 18 real steps.
    class: `step run-step${step.failed ? ' bad' : ''}`,
    id: `step-${pad(step.ord)}`,
    'data-step': step.ord,
    role: 'button',
    tabindex: '0',
    'aria-expanded': 'false',
    'data-tip': 'Step details',
    onclick: toggle,
    onkeydown: (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      toggle();
    },
  },
    el('span', { class: 'ix', text: pad(step.ord) }),
    el('span', {
      class: 'vb',
      text: `${readableStepAction(step.action)}${readableStepTarget(step, run)
        ? ` · ${readableStepTarget(step, run)}` : ''}`,
    }),
    el('span', { class: 'run-step-time' },
      el('span', {
        class: 'el',
        title: 'Elapsed time between the recorded step start and end',
        text: `${Math.round((step.ended_at - step.started_at) * 1000)} ms`,
      })),
  );
  row.openNotes = (select = true) => { if (!notes || notes.hidden) toggle(select); };
  return row;
}

function orientationOf(video) {
  if (!video || !Number(video.width) || !Number(video.height)) return null;
  return Number(video.width) >= Number(video.height) ? 'landscape' : 'portrait';
}

function imageRotation(run, segment, orientation) {
  if (orientationOf(segment) === orientation) return 0;
  const sourceRotation = Number(segment.rotation);
  if (run.targetRotation != null && segment.rotation != null && Number.isInteger(sourceRotation)) {
    const turns = ((run.targetRotation - sourceRotation) % 4 + 4) % 4;
    if (turns % 2) return turns * 90;
  }
  return 90;
}

function videoTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function runPlayer(run, steps, rows, setup, teardown) {
  let stepScroll = null;
  let currentMarkedRow = null;
  let currentMarkedStep = null;
  const expandedObserver = typeof ResizeObserver === 'undefined' ? null
    : new ResizeObserver(entries => {
      for (const { target } of entries) {
        if (target.closest('.run-lifecycle-teardown')) {
          scrollStepsToBottom();
          continue;
        }
        const row = target.previousElementSibling;
        if (row?.classList.contains('run-step') && row !== currentMarkedRow) {
          if (currentMarkedRow) revealInSteps(currentMarkedRow, true);
          continue;
        }
        revealInSteps(target);
      }
    });
  const segments = runVideoSegments(run);
  const timelineStartAt = Number.isFinite(run.startedAt)
    ? run.startedAt : segments[0]?.startAt || 0;
  const timelineEndAt = Number.isFinite(run.endedAt)
    ? run.endedAt : Math.max(timelineStartAt, ...segments.map(segment => segment.endAt));
  const timelineDuration = Math.max(0, timelineEndAt - timelineStartAt);
  const timelineSegments = segments.map((segment, index) => {
    const startOffset = Number.isFinite(segment.startOffset) ? segment.startOffset : 0;
    const endOffset = Number.isFinite(segment.endOffset)
      ? Math.max(startOffset, segment.endOffset)
      : startOffset;
    const start = Math.max(0, segment.startAt - timelineStartAt);
    const end = Math.max(start, segment.endAt - timelineStartAt);
    const timelineSegment = {
      index, segment, start, end, duration: end - start, startOffset,
    };
    return timelineSegment;
  });
  const orientation = run.targetOrientation || orientationOf(segments[0]) || 'portrait';
  const frame = el('div', {
    class: `run-video-frame ${orientation}`,
    'data-orientation': orientation,
    role: 'group',
    tabindex: '0',
    'aria-label': `Run video player, ${orientation} orientation`,
  });
  const video = el('video', {
    class: 'run-video',
    playsinline: true,
    preload: 'metadata',
    'aria-label': `Run video, ${orientation} orientation`,
  });
  const playIcon = icon('play', 18, 'Play Video');
  const playButton = el('button', {
    type: 'button',
    class: 'run-video-control',
    'aria-label': 'Play Video',
    title: 'Play Video',
    onclick: () => video.paused ? playVideo() : video.pause(),
  }, playIcon);
  const seekControl = el('input', {
    type: 'range',
    class: 'run-video-seek',
    min: 0,
    max: timelineDuration,
    step: 0.1,
    value: 0,
    'aria-label': 'Seek Across All In-Run Video Segments',
    oninput: () => seekToTimeline(Number(seekControl.value), !video.paused),
    onkeydown: event => {
      const direction = event.key === 'ArrowLeft' ? -10
        : event.key === 'ArrowRight' ? 10 : 0;
      if (!direction) return;
      event.preventDefault();
      seekToTimeline(Number(seekControl.value) + direction, !video.paused);
    },
  });
  const timeline = el('div', { class: 'run-video-timeline' }, seekControl);
  const markers = timelineSegments.filter(entry => entry.index > 0).map(entry => {
    const label = `Jump To Segment ${entry.index + 1}, ${fileName(entry.segment.url)}`;
    return el('button', {
      type: 'button',
      class: 'run-video-marker',
      style: `left:${timelineDuration ? entry.start / timelineDuration * 100 : 0}%`,
      'data-segment-index': entry.index,
      'aria-label': label,
      'aria-pressed': false,
      title: label,
      onclick: () => seekToTimeline(entry.start, !video.paused),
    });
  });
  timeline.append(...markers);
  const timeLabel = el('span', {
    class: 'run-video-time',
    text: '0:00 / 0:00',
    title: 'Elapsed run time; gaps without recorded video remain on the timeline',
    'aria-label': 'Elapsed run time on the recorded run timeline',
  });
  const timeRow = el('div', { class: 'run-video-time-row' }, timeLabel);
  const previousStepButton = el('button', {
    type: 'button',
    class: 'run-video-control',
    'aria-label': 'Previous Step',
    title: 'Previous Step',
    onclick: () => seekAdjacentStep(-1),
  }, icon('skip-previous', 18, 'Previous Step'));
  const nextStepButton = el('button', {
    type: 'button',
    class: 'run-video-control',
    'aria-label': 'Next Step',
    title: 'Next Step',
    onclick: () => seekAdjacentStep(1),
  }, icon('skip-next', 18, 'Next Step'));
  const muteIcon = icon('mute', 18, 'Unmute Video');
  const muteButton = el('button', {
    type: 'button',
    class: 'run-video-control',
    'aria-label': 'Unmute Video',
    title: 'Unmute Video',
    onclick: () => { video.muted = !video.muted; updateControls(); },
  }, muteIcon);
  const fullscreenIcon = icon('expand', 18, 'Enter Fullscreen');
  const fullscreenButton = el('button', {
    type: 'button',
    class: 'run-video-control',
    'aria-label': 'Enter Fullscreen',
    title: 'Enter Fullscreen',
    onclick: async () => {
      try {
        if (document.fullscreenElement === frame) await document.exitFullscreen();
        else await frame.requestFullscreen();
      } catch (error) {
        console.error('Run video fullscreen could not start', error);
      }
    },
  }, fullscreenIcon);
  const transport = el('div', { class: 'run-video-transport' },
    previousStepButton, playButton, nextStepButton);
  const utilityControls = el('div', { class: 'run-video-utilities' },
    muteButton, fullscreenButton);
  const controls = el('div', { class: 'run-video-controls', 'aria-label': 'Video controls' },
    transport, utilityControls);
  const overlay = el('div', { class: 'run-video-overlay' }, timeRow, timeline, controls);
  frame.append(video, overlay);
  let active = -1;
  let pendingOffset = 0;
  let shouldPlay = false;
  let switching = false;
  let timelinePositionOverride = null;
  video.muted = true;

  function revealInSteps(target, center = false) {
    if (!stepScroll || !target?.isConnected) return;
    const panel = stepScroll.getBoundingClientRect();
    const bounds = target.getBoundingClientRect();
    let desired = stepScroll.scrollTop;
    if (bounds.height >= panel.height) {
      desired += bounds.top - panel.top;
    } else if (center) {
      desired += bounds.top + bounds.height / 2 - (panel.top + panel.height / 2);
    } else if (bounds.top < panel.top) {
      desired -= panel.top - bounds.top;
    } else if (bounds.bottom > panel.bottom) {
      desired += bounds.bottom - panel.bottom;
    }
    const maxScroll = Math.max(0, stepScroll.scrollHeight - stepScroll.clientHeight);
    desired = Math.max(0, Math.min(maxScroll, desired));
    if (Math.abs(desired - stepScroll.scrollTop) < 1) return;
    stepScroll.scrollTo({
      top: desired,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto' : 'smooth',
    });
  }

  function scrollStepsToBottom() {
    if (!stepScroll) return;
    const maxScroll = Math.max(0, stepScroll.scrollHeight - stepScroll.clientHeight);
    stepScroll.scrollTo({
      top: maxScroll,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto' : 'smooth',
    });
  }

  function revealStepNotes(_row, notes, open) {
    if (open) {
      expandedObserver?.observe(notes);
      requestAnimationFrame(() => revealInSteps(notes));
    } else {
      expandedObserver?.unobserve(notes);
    }
  }

  function playVideo() {
    video.play().catch(error => {
      console.error('Run video playback could not start', error);
    });
  }

  function updateControls() {
    const segment = segments[active];
    const playLabel = video.paused ? 'Play Video' : 'Pause Video';
    playButton.setAttribute('aria-label', playLabel);
    playButton.title = playLabel;
    playButton.replaceChildren(icon(video.paused ? 'play' : 'pause', 18, playLabel));
    const muteLabel = video.muted ? 'Unmute Video' : 'Mute Video';
    muteButton.setAttribute('aria-label', muteLabel);
    muteButton.title = muteLabel;
    muteButton.replaceChildren(icon(video.muted ? 'mute' : 'volume', 18, muteLabel));
    const fullscreenLabel = document.fullscreenElement === frame ? 'Exit Fullscreen' : 'Enter Fullscreen';
    fullscreenButton.setAttribute('aria-label', fullscreenLabel);
    fullscreenButton.title = fullscreenLabel;
    fullscreenButton.replaceChildren(icon(
      document.fullscreenElement === frame ? 'contract' : 'expand', 18, fullscreenLabel));
    const timelineSegment = timelineSegments[active];
    const localTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const globalTime = Number.isFinite(timelinePositionOverride)
      ? timelinePositionOverride
      : timelineSegment
        ? Math.min(timelineSegment.end, Math.max(timelineSegment.start,
          timestampAtOffset(segment, localTime) - timelineStartAt))
        : 0;
    seekControl.value = String(globalTime);
    seekControl.setAttribute('aria-valuetext',
      `${videoTime(globalTime)} of ${videoTime(timelineDuration)}`);
    timeLabel.textContent = `${videoTime(globalTime)} / ${videoTime(timelineDuration)}`;
    for (const marker of markers) {
      marker.setAttribute('aria-pressed', Number(marker.dataset.segmentIndex) === active);
    }
    if (segment) frame.dataset.segment = String(active);
  }

  function seekToTimeline(position, play = false) {
    if (!timelineSegments.length) return;
    const target = Math.max(0, Math.min(timelineDuration, position));
    const lastSegment = timelineSegments.at(-1);
    const afterLastSegment = target > lastSegment.end;
    let entry = timelineSegments.find(item => target >= item.start && target <= item.end);
    if (!entry) entry = timelineSegments.find(item => item.start > target)
      || timelineSegments.at(-1);
    const segmentPosition = afterLastSegment ? entry.end
      : Math.max(entry.start, Math.min(entry.end, target));
    const offset = offsetAt(entry.segment, timelineStartAt + segmentPosition)
      ?? entry.startOffset;
    timelinePositionOverride = afterLastSegment ? target : null;
    if (afterLastSegment && !video.paused) video.pause();
    loadSegment(entry.index, offset, afterLastSegment ? false : play);
    const candidates = steps.filter(step => {
      const match = videoAt(run, step);
      return match?.url === entry.segment.url && Number.isFinite(match.offset)
        && match.offset <= offset;
    });
    markStep(candidates.at(-1) || steps.find(step => videoAt(run, step)?.url === entry.segment.url) || null);
    updateControls();
  }

  function seekAdjacentStep(direction) {
    const currentIndex = steps.findIndex(step =>
      step.ord === Number(currentMarkedRow?.dataset.step));
    const nextIndex = currentIndex < 0
      ? (direction > 0 ? 0 : steps.length - 1)
      : currentIndex + direction;
    const step = steps[nextIndex];
    if (step) {
      const row = stepScroll && [...stepScroll.querySelectorAll('.step')]
        .find(candidate => Number(candidate.dataset.step) === step.ord);
      const lifecycleFold = row?.closest('.run-lifecycle-fold');
      if (lifecycleFold) lifecycleFold.open = true;
      seekToStep(step, !video.paused);
    }
  }

  function handlePlayerKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey
      || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === ' ') {
      if (event.target.closest('button, a, [role="button"]')) return;
      event.preventDefault();
      if (video.paused) playVideo();
      else video.pause();
      return;
    }
    const direction = event.key === 'ArrowLeft' ? -10
      : event.key === 'ArrowRight' ? 10 : 0;
    if (!direction) return;
    event.preventDefault();
    seekToTimeline(Number(seekControl.value) + direction, !video.paused);
  }

  function markStep(step) {
    let nextMarkedRow = null;
    currentMarkedStep = step;
    const stepRows = stepScroll ? [...stepScroll.querySelectorAll('.step')] : rows;
    for (const row of stepRows) {
      const selected = Number(row.dataset.step) === step?.ord;
      row.classList.toggle('is-current', selected);
      if (selected) row.setAttribute('aria-current', 'step');
      else row.removeAttribute('aria-current');
      if (selected) nextMarkedRow = row;
    }
    if (nextMarkedRow && nextMarkedRow !== currentMarkedRow)
      requestAnimationFrame(() => {
        if (nextMarkedRow === currentMarkedRow) revealInSteps(nextMarkedRow, true);
      });
    currentMarkedRow = nextMarkedRow;
  }

  function fitFrame() {
    const segment = segments[active];
    const degrees = segment ? imageRotation(run, segment, orientation) : 0;
    const naturalWidth = video.videoWidth;
    const naturalHeight = video.videoHeight;
    const frameRatio = naturalWidth > 0 && naturalHeight > 0
      ? (degrees ? naturalHeight / naturalWidth : naturalWidth / naturalHeight)
      : orientation === 'portrait' ? 9 / 16 : 16 / 9;
    const availableWidth = frame.parentElement?.clientWidth;
    if (!availableWidth) return;
    const stepPanel = frame.closest('.run-player-layout')?.querySelector('.run-step-panel');
    const stepPanelHeight = stepPanel?.getBoundingClientRect().height;
    if (!stepPanelHeight) return;
    const maxWidth = Math.min(availableWidth, orientation === 'portrait' ? 430 : 900);
    const frameHeight = Math.min(stepPanelHeight, maxWidth / frameRatio);
    const frameWidth = Math.max(0, frameHeight * frameRatio);
    frame.style.width = `${frameWidth}px`;
    frame.style.height = `${frameHeight}px`;
    frame.style.aspectRatio = String(frameRatio);
    if (!degrees) {
      video.style.cssText = '';
      video.dataset.rotated = 'false';
      delete video.dataset.rotation;
      return;
    }
    video.dataset.rotated = 'true';
    video.dataset.rotation = `${degrees}deg`;
    video.style.position = 'absolute';
    video.style.left = '50%';
    video.style.top = '50%';
    video.style.width = `${frame.clientHeight}px`;
    video.style.height = `${frame.clientWidth}px`;
    video.style.maxWidth = 'none';
    video.style.maxHeight = 'none';
    video.style.objectFit = 'contain';
    video.style.transform = `translate(-50%, -50%) rotate(${degrees}deg)`;
  }

  function loadSegment(index, offset, play = false) {
    const segment = segments[index];
    if (!segment) return;
    active = index;
    pendingOffset = Number.isFinite(offset) ? Math.max(0, offset) : (segment.startOffset || 0);
    shouldPlay = play;
    switching = true;
    frame.dataset.segment = String(index);
    if (video.src !== new URL(segment.url, location.href).href) {
      video.src = segment.url;
      video.load();
    } else {
      video.currentTime = pendingOffset;
      switching = false;
      if (shouldPlay) playVideo();
      shouldPlay = false;
      fitFrame();
      updateControls();
    }
  }

  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(video.duration)) pendingOffset = Math.min(pendingOffset, Math.max(0, video.duration - 0.05));
    video.currentTime = pendingOffset;
    switching = false;
    fitFrame();
    updateControls();
    if (shouldPlay) playVideo();
    shouldPlay = false;
  });
  video.addEventListener('timeupdate', () => {
    const segment = segments[active];
    updateControls();
    if (!segment || switching) return;
    const stepCandidates = steps.filter(step => {
      const match = videoAt(run, step);
      return match?.url === segment.url && Number.isFinite(match.offset) && match.offset <= video.currentTime;
    });
    markStep(stepCandidates.at(-1) || null);
    if (Number.isFinite(segment.endOffset) && video.currentTime >= segment.endOffset - 0.12) {
      if (active + 1 < segments.length) {
        loadSegment(active + 1, segments[active + 1].startOffset, !video.paused);
      }
      else video.pause();
    }
  });
  video.addEventListener('click', () => {
    frame.focus({ preventScroll: true });
    if (video.paused) playVideo();
    else video.pause();
  });
  video.addEventListener('ended', () => {
    if (active + 1 < segments.length) loadSegment(active + 1, segments[active + 1].startOffset, true);
  });
  for (const event of ['play', 'pause', 'volumechange']) {
    video.addEventListener(event, updateControls);
  }
  document.addEventListener('fullscreenchange', updateControls);
  video.addEventListener('error', () => {
    if (!segments[active]) return;
    console.error('Could not load run video', {
      file: fileName(segments[active].url),
      mediaError: video.error?.code ?? 'unknown',
    });
  });
  video.addEventListener('loadedmetadata', fitFrame);
  if (typeof ResizeObserver !== 'undefined') {
    const stepPanel = frame.closest('.run-player-layout')?.querySelector('.run-step-panel');
    if (stepPanel) new ResizeObserver(fitFrame).observe(stepPanel);
  }
  window.addEventListener('resize', fitFrame);

  const seekToStep = (step, play = !video.paused) => {
    const match = videoAt(run, step);
    if (!match || !Number.isFinite(match.offset)) {
      console.warn(`No kept video covers step ${pad(step.ord)}.`);
      markStep(step);
      return;
    }
    const index = segments.findIndex(segment => segment.url === match.url);
    if (index < 0) {
      console.warn(`No in-run video segment covers step ${pad(step.ord)}.`);
      markStep(step);
      return;
    }
    markStep(step);
    timelinePositionOverride = null;
    if (!play) video.pause();
    loadSegment(index, match.offset, play);
  };

  const first = segments[0];
  if (first) {
    loadSegment(0, first.startOffset, false);
    markStep(steps.find(step => {
      const match = videoAt(run, step);
      return match?.url === first.url;
    }) || null);
  }
  else console.warn('No kept video is available for this run.');
  stepScroll = el('div', { class: 'run-step-scroll' },
    lifecycleSection(run, 'Setup', setup, revealStepNotes),
    rows,
    lifecycleSection(run, 'Teardown', teardown, revealStepNotes));
  if (currentMarkedStep) markStep(currentMarkedStep);
  for (const fold of stepScroll.querySelectorAll('.run-lifecycle-fold')) {
    const content = fold.lastElementChild;
    fold.addEventListener('toggle', () => {
      if (fold.open) {
        expandedObserver?.observe(content);
        requestAnimationFrame(() => fold.classList.contains('run-lifecycle-teardown')
          ? scrollStepsToBottom() : revealInSteps(content));
      } else {
        expandedObserver?.unobserve(content);
      }
    });
  }
  if (currentMarkedRow) requestAnimationFrame(() => revealInSteps(currentMarkedRow, true));
  const playerLayout = el('section', {
      class: `run-player-layout ${orientation}`,
      'data-orientation': orientation, 'data-segments': segments.length },
    el('div', { class: 'run-player' }, frame),
    el('div', { class: 'run-step-panel' },
      el('div', { class: 'run-step-heading' }, el('span', { class: 'h2', text: 'Steps' }),
        el('span', { class: 'cap', text: String(steps.length) })),
      stepScroll));
  playerLayout.addEventListener('keydown', handlePlayerKeydown);
  return {
    node: playerLayout,
    seekToStep,
    revealStepNotes,
    segmentCount: segments.length,
  };
}

/* The run's driven steps, as the artboard's one `.try`. */
function attempt(run, steps, setup, teardown, sessionEvents, onSelectStep = null) {
  const ctx = run.context || {};
  const incoming = ctx.incoming || {};
  let player = null;
  const orderedSteps = [...steps, ...sessionEvents].sort((a, b) => a.ord - b.ord);
  const rows = orderedSteps.map(step => {
    const row = stepRow(run, step,
      step.lifecycle ? null : selected => player?.seekToStep(selected),
      (_row, notes, open) => player?.revealStepNotes(_row, notes, open));
    if (step.lifecycle) row.classList.add('run-session-event');
    return row;
  });
  const playbackSteps = [...setup, ...orderedSteps, ...teardown]
    .sort((a, b) => a.ord - b.ord);
  player = runPlayer(run, playbackSteps, rows, setup, teardown);
  onSelectStep?.(player.seekToStep);

  return el('div', { class: 'try' },
    ctx.bound_after_s !== undefined
      ? el('div', { class: 'rcfg run-constraint', text: `engine bound after ${Number(ctx.bound_after_s).toFixed(2)}s` })
      : null,
    player.node,
    Object.keys(incoming).length
      ? el('div', { class: 'rbag' },
        el('div', { class: 'bagrow' }, el('b', { text: 'device on entry' }),
          Object.entries(incoming).map(([k, v]) => el('span', {}, el('i', { text: k }), String(v)))))
      : null);
}

/* Steps the driver's session took on its own at open or close, kept out of the
   driven list so its first row is the first step the run chose. */
function lifecycleSection(run, title, steps, onExpand = null) {
  if (!steps.length) return null;
  const ordinals = steps.map(step => Number(step.ord)).filter(Number.isFinite).sort((a, b) => a - b);
  const timedSteps = steps.filter(step => Number.isFinite(step.started_at)
    && Number.isFinite(step.ended_at));
  const elapsed = timedSteps.length
    ? Math.max(0, Math.max(...timedSteps.map(step => step.ended_at))
      - Math.min(...timedSteps.map(step => step.started_at)))
    : null;
  const range = ordinals.length ? `${pad(ordinals[0])}–${pad(ordinals.at(-1))}` : '—';
  const total = elapsed == null ? '—' : `${Math.round(elapsed * 1000)} ms`;
  return el('details', {
    class: `rfold run-lifecycle-fold${title === 'Teardown' ? ' run-lifecycle-teardown' : ''}`,
  },
    el('summary', {},
      el('span', { class: 'run-lifecycle-heading' },
        el('span', { class: 'run-lifecycle-title', text: title }),
        el('span', { class: 'run-lifecycle-range', 'aria-label': `Steps ${range}`, text: range })),
      el('span', {
        class: 'run-lifecycle-total',
        'aria-label': `${title} total elapsed time ${total}`,
        text: total,
      })),
    el('div', { class: 'run-lifecycle-content' },
      el('div', { class: 'steps' },
        steps.map(step => stepRow(run, step, null, onExpand)))));
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
function recording(run, has, jump) {
  const steps = run.steps;
  const failed = steps.filter(step => step.failed);
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
  if (has('before_screen_path') || has('final_screen_path')) {
    rows.push(bag('change captures', [
      ['before', steps.filter(s => s.before).length],
      ['ended', steps.filter(s => s.final).length],
    ]));
  }
  if (has('claim')) rows.push(bag('claims', [['checked', steps.filter(s => claimText(s)).length]]));
  if (has('input_accepted')) rows.push(bag('input', [['refused', steps.filter(s => s.input_accepted === 0).length]], 'fail'));
  if (!rows.length && !failed.length && !run.warnings.length) return null;
  const errors = failed.length ? fold('Errors', failed.length,
    el('div', { class: 'run-issue-list' }, failed.length
      ? failed.map(step => el('div', { class: 'run-error-entry' },
        jump(step),
        el('span', { text: step.message || step.outcome || 'Step failed' })))
      : el('span', { class: 'empty-run', text: 'No errors recorded.' })),
  false, false) : null;
  const warnings = run.warnings.length ? fold('Warnings', run.warnings.length,
    el('div', { class: 'run-issue-list' }, run.warnings.length
      ? run.warnings.map(warning => {
        const step = run.steps.find(item => item.ord === warning.step);
        return el('div', { class: 'run-warning-entry' },
          step ? jump(step) : null,
          warningNote(warning, run.warningSource));
      })
      : el('span', { class: 'empty-run', text: 'No warnings recorded.' })),
  false, false) : null;
  const chips = issueChips(run);
  const issueChipGroup = chips.length
    ? el('span', { class: 'recording-issue-chips' }, chips)
    : null;
  return el('details', { class: 'rfold recording-fold' },
    el('summary', {},
      el('span', { class: 'recording-heading' },
        el('span', { class: 'recording-title', text: 'Recording Details' }),
        issueChipGroup)),
    el('div', { class: 'run-recording-content' },
      rows.length ? el('div', { class: 'psec' }, el('div', { class: 'rbag rrec' }, rows)) : null,
      errors || warnings ? el('div', { class: 'run-issue-folds' }, warnings, errors) : null));
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

function fold(title, count, content, open = false, showCount = false, summaryMeta = null) {
  return el('details', { class: 'rfold', open },
    el('summary', {}, el('span', { text: title }),
      summaryMeta,
      showCount ? el('span', { class: 'cap', text: String(count) }) : null),
    content);
}

/* Android stores an animation scale nobody has set as null and runs it at 1.0. */
function axisText(key, value) {
  const unset = value === undefined || value === null || value === 'null';
  if (unset && key.startsWith('animation_scale.')) return 'unset (1.0)';
  return unset ? '—' : String(value);
}

/* Device axes and app settings describe the run's starting state, not later changes. */
function device(run) {
  const parts = [];
  const openSnapshot = run.snapshots.find(snapshot => snapshot.phase === 'open');
  if (openSnapshot) {
    const axes = flatten(openSnapshot.axes);
    const keys = Object.keys(axes).sort();
    const axisRows = keys.map(key => el('tr', {},
      el('th', { scope: 'row', text: key }),
      el('td', { text: axisText(key, axes[key]) })));
    parts.push(fold('Device Settings', keys.length,
      table('Device Settings At Run Start', ['Setting', 'At Run Start'], axisRows)));
  } else if (run.snapshots.length) {
    parts.push(fold('Device Settings', 0,
      el('div', { class: 'empty-run', text: 'Device settings were not recorded at run start.' })));
  }
  if (run.settingsAtOpen.length) {
    parts.push(fold('App Settings Found At Open', run.settingsAtOpen.length, table('App Settings At Run Start',
      ['Step', 'Screen', 'Control', 'At Run Start'],
      run.settingsAtOpen.map(r => el('tr', {},
        el('td', { text: pad(r.step ?? 0) }),
        el('td', { text: r.screen || r.screen_identity || '' }),
        el('td', { text: r.label || r.control_key || '' }),
        el('td', { text: r.value ?? '' }))))));
  }
  if (run.controlNotes.length) {
    parts.push(fold('Control Notes', run.controlNotes.length, table('Notes The Run Filed Against Controls',
      ['Step', 'Kind', 'Screen', 'Control', 'Reason'],
      run.controlNotes.map(r => el('tr', {},
        el('td', { text: pad(r.step ?? 0) }),
        el('td', { text: r.kind || '' }),
        el('td', { text: r.screen_identity || '' }),
        el('td', { class: 'wrap', text: r.control_key || '—' }),
        el('td', { class: 'why', text: r.reason || '' }))))));
  }
  return fold('Device And Settings', parts.length,
    el('div', { class: 'run-device-sections' },
      parts));
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

function readableDate(run) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z/.exec(run.id || '');
  const fromId = match
    ? Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6], +(match[7] || 0)) / 1000
    : 0;
  const startedAt = run.startedAt || run.started_at || fromId;
  if (!startedAt) return run.id;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(startedAt * 1000));
}

export async function renderRuns(state, wanted) {
  const stepHash = /^#step-\d+$/.test(location.hash) ? location.hash : '';
  const runs = (state.manifest.runs || []).filter(r => r.has_db
    || r.health?.cases?.length || r.health?.warnings?.length || r.health?.a11y?.status);
  const page = el('div', { class: 'run-content' });
  const out = el('div', { class: 'page' }, page);
  const casesSection = listed => {
    const cases = listed.health?.cases || [];
    return fold('Recorded Test Results', cases.length,
      el('section', { class: 'run-case-results' },
      cases.length ? el('ul', {}, cases.map(c => el('li', {},
        el('b', { text: c.case }), `: ${c.verdict}${c.reason ? ` — ${c.reason}` : ''}`)))
        : el('p', { class: 'empty-run', text: 'No test results recorded in this run. This does not mean tests passed.' })));
  };

  if (!runs.length) {
    page.append(el('div', { class: 'rhead' },
      el('div', { class: 'rhead-top' }, el('h1', { style: 'margin:0; font:700 22px/1.1 var(--display)', text: 'Runs' }))),
      el('p', { class: 'empty-run', text: 'No readable run recordings or test results are available.' }));
    return out;
  }

  let current = runs.some(r => r.id === wanted) ? wanted : runs[0].id;

  async function show(id) {
    current = id;
    // The URL carries the run, so a reload and a shared link both land here.
    history.replaceState(null, '', href('runs.html', { id }));
    page.replaceChildren(el('p', { class: 'empty-run', text: `Reading ${id}…` }));
    const listed = runs.find(r => r.id === id);
    if (!listed.has_db) {
      page.replaceChildren(
        el('div', { class: 'rhead' },
          el('h1', { class: 'h2', text: 'Selected Run' }),
          runPicker(runs, current, show)),
        el('p', { class: 'health-note', text: 'This folder has evidence but no run.db step recording.' }),
        casesSection(listed),
        el('p', {}, el('a', { href: `${state.source.url}runs/${encodeURIComponent(id)}/post/analysis/warnings.json`,
          text: 'Recorded warnings', hidden: !listed.health?.warnings?.length })),
        el('p', {}, el('a', { href: `${state.source.url}runs/${encodeURIComponent(id)}/post/a11y-audit.json`,
          text: 'Accessibility audit record', hidden: !listed.health?.a11y?.status })));
      return;
    }

    let run;
    try {
      run = await loadRun(state.source.url, id, { built: Boolean((runs.find(r => r.id === id) || {}).has_post_map) });
    } catch (err) {
      page.replaceChildren(el('p', { class: 'empty-run', text: `Could not read ${id}: ${err.message || err}` }));
      return;
    }

    const has = c => run.columns.has(c);
    const setup = has('lifecycle') ? run.steps.filter(s => s.lifecycle === 'setup') : [];
    const teardown = has('lifecycle') ? run.steps.filter(s => s.lifecycle === 'teardown') : [];
    const driven = run.steps.filter(s => !s.lifecycle);
    const otherLifecycle = run.steps.filter(s => s.lifecycle && !setup.includes(s) && !teardown.includes(s));
    let selectVideoStep = null;
    const jump = step => el('a', {
      href: `#step-${pad(step.ord)}`,
      text: `${pad(step.ord)} ${step.action}${step.control_key ? ` ${step.control_key}` : ''}`,
      onclick: (ev) => {
        ev.preventDefault();
        const row = page.querySelector(`#step-${pad(step.ord)}`);
        if (!row) return;
        const disclosure = row.closest('details');
        if (disclosure) disclosure.open = true;
        selectVideoStep?.(step, false);
        row.openNotes(false);
        row.scrollIntoView({ block: 'center' });
        row.focus({ preventScroll: true });
      },
    });

    const listedRun = runs.find(r => r.id === run.id) || {};
    const orientation = listedRun.orientation || run.targetOrientation;
    const mode = String(listedRun.mode || '');
    const appearanceIcon = /dark/i.test(mode) ? 'moon'
      : /light/i.test(mode) ? 'sun' : 'auto';
    const orientationLabel = orientation
      ? `${orientation[0].toUpperCase()}${orientation.slice(1)} Orientation`
      : 'Orientation Not Recorded';
    const appearanceLabel = mode
      ? `${mode[0].toUpperCase()}${mode.slice(1)} Theme`
      : 'Theme Not Recorded';
    const platform = listedRun.platform || '';
    const platformLabel = platform
      ? `${platform[0].toUpperCase()}${platform.slice(1)} Platform`
      : 'Platform Not Recorded';
    const locale = listedRun.locale || '';
    const localeLabel = locale ? `Locale ${locale}` : 'Locale Not Recorded';
    const deviceName = run.device || 'Unknown Device';
    const runAxisIcons = el('span', { class: 'run-axis-icons' },
      el('span', { class: 'run-axis-icon', role: 'img', 'aria-label': platformLabel },
        icon(platform ? platformIcon(platform) : 'screen', 18, platformLabel)),
      el('span', { class: 'run-device-name', 'aria-label': `Device ${deviceName}`, text: deviceName }),
      el('span', { class: 'run-axis-locale', 'aria-label': localeLabel },
        `Locale ${locale || 'Not Recorded'}`),
      el('span', { class: 'run-axis-icon', role: 'img', 'aria-label': orientationLabel },
        icon('phone-android', 18, orientationLabel, orientation === 'landscape')),
      el('span', { class: 'run-axis-icon', role: 'img', 'aria-label': appearanceLabel },
        icon(appearanceIcon, 18, appearanceLabel)));
    const videoRows = videoFiles(run);
    const fileRows = (run.paired ? ['logcat.txt', 'config.json'] : ['logcat.txt', 'calls.jsonl'])
      .map(file => artifactRow(file,
        el('a', { href: run.base + file, target: '_blank', text: file })));
    const captureRows = run.found
      ? [artifactRow('Device as found',
        el('a', { href: run.found, target: '_blank', text: 'Open capture' }))]
      : [];
    const mapRows = !run.paired ? []
      : listedRun.has_post_map
        ? [artifactRow('Run map',
          el('span', {},
            el('a', { href: href('map.html', { run: run.id }), text: 'Open map' }),
            ' · ',
            el('a', { href: `${run.base}post/map.db`, target: '_blank', text: 'post/map.db' })))]
        : [artifactRow('Run map', 'Map not built yet (map_build_run)')];
    const trace = traceLink(listedRun, state.source.url);
    const traceRows = listedRun.trace ? [artifactRow('Trace', trace)] : [];
    const artifactGroups = [
      artifactGroup('Videos', videoRows),
      artifactGroup('Run files', fileRows),
      artifactGroup('Capture', captureRows),
      artifactGroup('Map', mapRows),
      artifactGroup('Trace', traceRows),
    ].filter(Boolean);
    const artifactCount = [videoRows, fileRows, captureRows, mapRows, traceRows]
      .reduce((total, items) => total + items.length, 0);
    const titleChips = issueChips(run);

    page.replaceChildren(
      el('header', { class: 'rhead run-header' },
          el('div', { class: 'run-title-row' },
            runPicker(runs, current, show),
            runAxisIcons,
            titleChips.length
              ? el('span', { class: 'run-title-issue-chips' }, titleChips) : null),
        ),

        el('div', { class: 'psec' },
          attempt(run, driven, setup, teardown, otherLifecycle,
            select => { selectVideoStep = select; })),

        el('div', { class: 'run-detail-sections' },
          recording(run, has, jump),
          device(run),
          casesSection(listed)),

      fold('Artifacts', artifactCount,
        el('div', { class: 'run-artifacts' }, artifactGroups)));
  }

  await show(current);
  const target = stepHash ? page.querySelector(stepHash) : null;
  if (target) requestAnimationFrame(() => {
    const disclosure = target.closest('details');
    if (disclosure) disclosure.open = true;
    target.openNotes();
    target.scrollIntoView({ block: 'center' });
  });
  return out;
}
