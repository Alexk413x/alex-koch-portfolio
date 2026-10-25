"""maproom.py -- refreshes the static snapshot of cartographer's maproom viewer under maproom/.

    python maproom.py ui      copy the viewer from the newest installed cartographer plugin
    python maproom.py ui --checkout <repo>
                              copy it from a cartographer repository at its current commit instead
    python maproom.py ui --checkout <repo> --run-details
                              copy only PR #94's run player, details and required shared assets
    python maproom.py serve   preview the published snapshot with byte-range video seeking
    python maproom.py data    copy the RPN Dominator Calculator baseline and runs, trim them, and
                              pre-generate the two JSON files serve.py answers dynamically
    python maproom.py data --baseline <file>
                              use a baseline file other than source/baselines/baseline.db
    python maproom.py data --checkout <repo>
                              use that cartographer checkout's serve.py to generate the JSON

maproom's serve.py answers /k/<id>/index.json and /k/<id>/runs/<run>/view.json by walking the
cartographer folder. Pages serves static files only, so `data` writes both files to those paths,
computed by serve.py's own code: the slug rules live in cartographer, and a second implementation
would drift from them.

`data` only reads the source folder, and never reads baseline.db.new. Each run is copied without its
trace, its view.json is computed, and then every file that neither run.db nor view.json names is
deleted. Cartographer's public_export.py sanitizes the copy and validates it before publication.
A run folder with no run.db, or whose run has not ended, is skipped.
"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'maproom'
STAGING = ROOT / '.claude' / 'maproom-staging'
PLUGIN = Path.home() / '.claude' / 'plugins' / 'cache' / 'cartographer' / 'cartographer'
SOURCE = Path(os.environ.get('MAPROOM_SOURCE', r'C:\Android\RPNDominatorCalculator\knowledge\cartographer'))
SOURCE_ID = 'RPNDominatorCalculator'
SOURCE_NAME = 'RPN Dominator Calculator'

UI_DIRS = ('screens', 'css', 'js', 'vendor')
RUN_DETAILS_COMMIT = 'ac0e99a28dcc5f413a42af11e6a6522428977a1f'
RUN_DETAILS_FILES = (
    'js/data/run.js', 'js/views/runs.js', 'js/views/elements.js',
    'js/util/icons.js', 'js/util/picker.js', 'js/util/press.js',
    'css/app.css', 'css/fonts.css', 'vendor/fonts/material-symbols-playback.ttf',
)
RUN_DETAILS_PATCHES = (
    ('js/views/runs.js', """function runPicker(runs, current, onPick) {
  const control = picker('Run', runs.map(r => ({
    value: r.id,
    label: readableDate(r),
    note: `${r.orientation || 'Orientation Not Recorded'}`
      + ` · ${r.locale || 'Locale Not Recorded'}`
      + ` · ${r.mode ? `${r.mode} Mode` : 'Mode Not Recorded'}`
      + (r.has_db ? '' : ' · no run.db'),
    searchText: `${r.id} ${r.orientation || ''} ${r.locale || ''} ${r.mode || ''} ${r.platform || ''}`,
  })), current, onPick, { search: 'Find A Run' });
  control.classList.add('run-picker');
  return control;
}""", """function runPickerMetadata(run) {
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
  return String(value).replace(/[-_]+/g, ' ').replace(/\\b\\w/g, char => char.toUpperCase());
}

function runPicker(runs, current, onPick) {
  const control = picker('Run', runs.map(r => ({
    value: r.id,
    label: readableDate(r),
    ...runPickerMetadata(r),
  })), current, onPick, { search: 'Find A Run' });
  control.classList.add('run-picker');
  return control;
}"""),
    ('js/views/runs.js', """import { icon, platformIcon } from '../util/icons.js';""", """import { icon, phoneIcon, platformIcon } from '../util/icons.js';"""),
    ('js/util/icons.js', """  'phone-web': 'computer',""", """  'phone-web': 'computer',
  language: 'language',"""),
    ('js/util/picker.js', """  const rows = options.map(option => {
    const row = el('button', {
      type: 'button', role: 'option', class: `picker-option${option.value === current ? ' on' : ''}`,
      'aria-selected': String(option.value === current),
      tabindex: -1,
      onclick: () => {
        close(true);
        onPick(option.value);
      },
    }, option.label, option.note ? el('span', { text: option.note }) : null);
    row.dataset.find = `${option.label} ${option.note || ''} ${option.searchText || ''}`.toLowerCase();
    return row;
  });""", """  const rows = options.map(option => {
    const noteText = typeof option.note === 'string' ? option.note : option.note?.textContent || '';
    const row = el('button', {
      type: 'button', role: 'option', class: `picker-option${option.value === current ? ' on' : ''}`,
      'aria-selected': String(option.value === current),
      'aria-label': option.ariaLabel,
      tabindex: -1,
      onclick: () => {
        close(true);
        onPick(option.value);
      },
    }, el('span', { class: 'picker-option-label', text: option.label }),
    option.note ? el('span', { class: 'picker-option-note' }, option.note) : null);
    row.dataset.find = `${option.label} ${noteText} ${option.searchText || ''}`.toLowerCase();
    return row;
  });"""),
    ('css/app.css', """    .drop .picker-option span { color:var(--muted); font-family:var(--mono); font-size:11.5px; }""", """    .drop .picker-option > .picker-option-note { color:var(--muted); font-family:var(--mono); font-size:11.5px; }
    .run-picker .picker-option { align-items:center; flex-direction:row; justify-content:space-between; gap:12px; white-space:nowrap; }
    .run-picker .picker-option > .picker-option-label { flex:1; min-width:0; overflow:hidden; color:var(--text); font:500 13px/1.25 var(--sans); text-align:left; text-overflow:ellipsis; white-space:nowrap; }
    .run-picker .picker-option > .picker-option-note { display:flex; flex:none; align-items:center; justify-content:flex-end; flex-wrap:nowrap; gap:8px; color:var(--muted); font:400 11.5px/1.35 var(--mono); white-space:nowrap; }
    .run-picker .run-picker-metadata { display:flex; align-items:center; gap:8px; line-height:1; }
    .run-picker .drop .picker-option .msym { font-family:"Material Symbols Rounded"; }
    .run-picker .picker-option-note .brand { cursor:inherit; }
    .run-picker-help { box-sizing:border-box; display:inline-flex; flex:none; align-items:center; justify-content:center; width:16px; height:16px; border:1px solid currentColor; border-radius:50%; color:var(--muted); font:600 9px/1 var(--sans) !important; }"""),
    ('css/app.css', """    .run-picker .drop .picker-option { min-height:44px; align-items:center; padding:10px 12px; font-size:14px; line-height:1.25; white-space:normal; }
    .run-picker .drop .picker-option span { flex:none; font-size:12px; line-height:1.2; text-align:right; }""", """    .run-picker .drop .picker-option { min-height:44px; align-items:center; flex-direction:row; justify-content:space-between; gap:12px; padding:10px 12px; font-size:14px; line-height:1.25; white-space:nowrap; }
    .run-picker .drop .picker-option > .picker-option-label { flex:1; min-width:0; text-align:left; }
    .run-picker .drop .picker-option > .picker-option-note { display:flex; flex:none; align-items:center; justify-content:flex-end; flex-wrap:nowrap; gap:8px; white-space:nowrap; }
    .run-picker .drop .picker-option-note > * { flex:none; }"""),
    ('css/app.css', """    .run-picker .drop { width:min(440px, calc(100vw - 32px)); min-width:min(320px, calc(100vw - 32px)); max-width:calc(100vw - 32px); }""",
     """    .run-picker .drop { width:min(320px, calc(100vw - 32px)); min-width:min(280px, calc(100vw - 32px)); max-width:calc(100vw - 32px); }"""),
)
# The viewer fetches its source list from the server root. Under a subfolder of a site that resolves
# to the site's root, so the one absolute URL is made relative to the pages in screens/.
PATCHES = [('js/data/sources.js', "getJson('/sources.json')", "getJson('../sources.json')")]

# Read by nothing in the viewer; the Perfetto link needs a local trace_processor that Pages cannot run.
SKIP_COPY = ('trace.pftrace',)
KEEP_ALWAYS = ('run.db', 'config.json', 'logcat.txt', 'calls.jsonl',
               'suite.json', 'post/map.db', 'post/analysis/warnings.json',
               'post/a11y-audit.json', 'post/states/index.json')

# The home folder in any spelling a run records it: C:\Users\x, C:\\Users\\x (JSON), C:/Users/x, /c/Users/x.
HOME_PATH = re.compile(r'(?:[A-Za-z]:|/[a-z])(?:\\\\|\\|/)Users(?:\\\\|\\|/)[^\\/"\s]+', re.IGNORECASE)

FILE_LIMIT = 100 * 1024 * 1024
SITE_LIMIT = 1024 * 1024 * 1024
# Mirrors the rm in .github/workflows/pages.yml: these never reach the artifact.
NOT_PUBLISHED = {'.git', '.github', 'bench.py', 'site-url.py', 'maproom.py', 'test', '.githooks',
                 'knowledge', '.claude', 'CLAUDE.md', 'AGENTS.md'}


def versions():
    found = []
    for d in PLUGIN.iterdir() if PLUGIN.is_dir() else []:
        try:
            found.append((tuple(int(p) for p in d.name.split('.')), d))
        except ValueError:
            pass
    if not found:
        sys.exit('no cartographer plugin under %s' % PLUGIN)
    return [d for _, d in sorted(found)]


def plugin_dir(version=None):
    dirs = versions()
    if version:
        match = [d for d in dirs if d.name == version]
        if match:
            return match[0]
        print('viewer %s is not installed; using %s' % (version, dirs[-1].name))
    return dirs[-1]


def load_viewer_module(plugin, name):
    path = plugin / 'maproom' / (name + '.py')
    if not path.is_file():
        sys.exit('%s is missing; use a Cartographer checkout with public-export support' % path)
    spec = importlib.util.spec_from_file_location('maproom_' + name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_serve(plugin):
    return load_viewer_module(plugin, 'serve')


def checkout_viewer(repo):
    repo = Path(repo).resolve()
    git = ['git', '-C', str(repo)]
    if subprocess.run(git + ['status', '--porcelain', '--', 'maproom'], capture_output=True, text=True, check=True).stdout:
        sys.exit('%s has uncommitted changes under maproom/' % repo)
    commit = subprocess.run(git + ['rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    version = json.loads((repo / '.claude-plugin' / 'plugin.json').read_text(encoding='utf-8'))['version']
    return repo, version, commit


def ui(args):
    if args.run_details:
        return run_details_ui(args.checkout)
    if args.checkout:
        plugin, version, commit = checkout_viewer(args.checkout)
    else:
        plugin = plugin_dir()
        version, commit = plugin.name, None
    src = plugin / 'maproom'
    DEST.mkdir(exist_ok=True)
    for name in UI_DIRS:
        shutil.rmtree(DEST / name, ignore_errors=True)
        shutil.copytree(src / name, DEST / name)
    for rel, old, new in PATCHES:
        path = DEST / rel
        text = path.read_text(encoding='utf-8')
        if text.count(old) != 1:
            sys.exit('%s: expected one %r to patch, found %d' % (rel, old, text.count(old)))
        path.write_text(text.replace(old, new), encoding='utf-8', newline='\n')
    sources = {'viewer': version, 'sources': [{
        'id': SOURCE_ID, 'name': SOURCE_NAME,
        'path': '%s/knowledge/cartographer' % SOURCE_ID,
        'url': '../k/%s/' % SOURCE_ID, 'graph': 'baselines/baseline.db', 'has_graph': True}]}
    if commit:
        sources['viewer_commit'] = commit
    (DEST / 'sources.json').write_text(json.dumps(sources, indent=1) + '\n', encoding='utf-8', newline='\n')
    print('viewer %s%s copied to %s' % (version, ' at %s' % commit[:12] if commit else '', DEST.relative_to(ROOT)))
    return report()


def run_details_ui(checkout):
    """Copy the pinned run surface without changing survey pages or export provenance."""
    if not checkout:
        sys.exit('--run-details requires --checkout')
    repo = Path(checkout).resolve()
    manifest_path = DEST / 'sources.json'
    if not manifest_path.is_file():
        sys.exit('--run-details needs an installed viewer; run a full ui refresh first')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    git = ['git', '-C', str(repo), 'show']
    # Read committed bytes, not the checkout's working files or an unrelated current branch.
    files = {rel: subprocess.run(
        git + ['%s:maproom/%s' % (RUN_DETAILS_COMMIT, rel)],
        capture_output=True, check=True).stdout for rel in RUN_DETAILS_FILES}
    plugin = subprocess.run(git + [RUN_DETAILS_COMMIT + ':.claude-plugin/plugin.json'],
                            capture_output=True, check=True).stdout
    version = json.loads(plugin)['version']
    for rel, old, new in RUN_DETAILS_PATCHES:
        text = files[rel].decode('utf-8')
        if text.count(old) != 1:
            sys.exit('%s: expected one run-picker source block to patch, found %d'
                     % (rel, text.count(old)))
        files[rel] = text.replace(old, new).encode('utf-8')
    for rel, content in files.items():
        path = DEST / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    manifest['run_details'] = {
        'viewer': version, 'viewer_commit': RUN_DETAILS_COMMIT,
        'files': list(RUN_DETAILS_FILES),
    }
    write_json(manifest_path, manifest)
    print('run player and details copied at %s; baseline and runs unchanged'
          % RUN_DETAILS_COMMIT[:12])
    return report()


class SnapshotHandler(SimpleHTTPRequestHandler):
    """Serve only published Maproom files, with single-range media responses."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DEST), **kwargs)

    def list_directory(self, path):
        self.send_error(403, 'Directory listings are disabled')
        return None

    def send_head(self):
        self._byte_range = None
        raw = unquote(urlsplit(self.path).path)
        path = Path(self.translate_path(self.path)).resolve()
        if ('\\' in raw or '..' in raw.split('/') or
                not path.is_relative_to(DEST.resolve())):
            self.send_error(403, 'Only published snapshot files are served')
            return None
        if not path.is_file():
            self.send_error(404, 'Published file not found')
            return None
        if path.suffix.lower() != '.mp4':
            return super().send_head()
        size = path.stat().st_size
        requested = self.headers.get('Range')
        if requested is None:
            return super().send_head()
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested.strip())
        start, end = 0, size - 1
        valid = bool(match and any(match.groups()) and size)
        if valid:
            first, last = match.groups()
            try:
                if first:
                    start = int(first)
                    end = min(int(last), size - 1) if last else size - 1
                    valid = start < size and end >= start
                else:
                    suffix = int(last)
                    valid = suffix > 0
                    start = max(0, size - suffix)
            except ValueError:
                valid = False
        if not valid:
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */%d' % size)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        source = path.open('rb')
        self._byte_range = start, end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', 'video/mp4')
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        return source

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Accept-Ranges', 'bytes' if
                         urlsplit(self.path).path.lower().endswith('.mp4') else 'none')
        super().end_headers()

    def copyfile(self, source, outputfile):
        try:
            if self._byte_range is None:
                return super().copyfile(source, outputfile)
            start, remaining = self._byte_range
            source.seek(start)
            while remaining:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            self.log_message('Client disconnected during file transfer: %s', self.path)


def serve(args):
    with ThreadingHTTPServer(('127.0.0.1', args.port), SnapshotHandler) as server:
        print('Published Maproom: http://127.0.0.1:%d/screens/index.html' % args.port,
              flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


def copy_baseline(src, dst, attempts=6, wait=10):
    """Copy the bytes, so the copy's sha256 matches what each run recorded, and retry when a write lands mid-copy."""
    for attempt in range(1, attempts + 1):
        before = src.stat()
        shutil.copy2(src, dst)
        after = src.stat()
        try:
            con = sqlite3.connect('file:%s?mode=ro' % dst.as_posix(), uri=True)
            try:
                check = con.execute('PRAGMA integrity_check').fetchone()[0]
                screens = con.execute('SELECT count(*) FROM screen').fetchone()[0]
            finally:
                con.close()
        except sqlite3.Error as e:
            check, screens = str(e), 0
        stable = (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns)
        if stable and check == 'ok' and screens:
            return screens
        print('baseline copy %d: stable=%s integrity=%r screens=%d; retrying' % (attempt, stable, check, screens))
        time.sleep(wait)
    sys.exit('could not take a clean copy of %s' % src)


def run_finished(db):
    try:
        con = sqlite3.connect('file:%s?mode=ro' % db.as_posix(), uri=True)
        try:
            return all(row[0] for row in con.execute('SELECT ended_at FROM run'))
        finally:
            con.close()
    except sqlite3.Error:
        return False


def run_picker_axes(run_dir):
    """Expose the run's recorded platform, orientation, appearance, and locale."""
    config_path = run_dir / 'config.json'
    config = json.loads(config_path.read_text(encoding='utf-8')) if config_path.is_file() else {}
    axes = config.get('axes') or {}
    orientation = axes.get('orientation')
    if orientation not in ('portrait', 'landscape'):
        try:
            rotation = int(axes.get('rotation'))
        except (TypeError, ValueError):
            rotation = None
        orientation = ('landscape' if rotation % 2 else 'portrait') if rotation is not None else ''

    appearance = axes.get('appearance') or axes.get('night-mode') \
        or axes.get('dark-mode') or axes.get('mode')
    if appearance is not None:
        value = str(appearance).strip().lower()
        if value in ('off', 'false', '0', 'light'):
            appearance = 'Light'
        elif value in ('on', 'true', '1', 'dark'):
            appearance = 'Dark'
        else:
            appearance = str(appearance).strip()
    else:
        appearance = ''

    locale = axes.get('locale') or axes.get('language') or config.get('locale') or ''
    platform = axes.get('platform') or config.get('platform')
    if not platform and any(key in axes for key in ('rotation', 'night-mode', 'dark-mode')):
        platform = 'android'
    return {
        'orientation': orientation or '',
        'appearance': appearance,
        'mode': appearance,
        'locale': str(locale).strip(),
        'platform': str(platform).strip().lower() if platform else '',
    }


def referenced_paths(db):
    """Every file a run.db row points at, from any column named like a path."""
    out = set()
    con = sqlite3.connect('file:%s?mode=ro' % db.as_posix(), uri=True)
    try:
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        for table in tables:
            cols = [r[1] for r in con.execute('PRAGMA table_info("%s")' % table)]
            for col in cols:
                if col == 'path' or col.endswith('_path'):
                    out.update(r[0] for r in con.execute('SELECT "%s" FROM "%s"' % (col, table))
                               if isinstance(r[0], str) and r[0])
        legacy = 'step' in tables and 'screen_path' not in [
            r[1] for r in con.execute('PRAGMA table_info(step)')]
    finally:
        con.close()
    return out, legacy


def json_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from json_strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from json_strings(v)


def copy_run(src, dst):
    shutil.copytree(src, dst, ignore=lambda _d, names: [n for n in names if n.startswith(SKIP_COPY)])


def trim_run(run_dir, run_id, view):
    db_paths, legacy = referenced_paths(run_dir / 'run.db')
    keep = set(KEEP_ALWAYS) | db_paths
    cases = run_dir / 'cases'
    if cases.is_dir():
        keep.update(p.relative_to(run_dir).as_posix() for p in cases.rglob('*') if p.is_file())
    prefix = 'runs/%s/' % run_id
    for s in json_strings(view):
        keep.add(s[len(prefix):] if s.startswith(prefix) else s)
    if not any(p.startswith('video') for p in db_paths):
        keep.add('video.mp4')
    removed = 0
    for path in sorted(run_dir.rglob('*')):
        if not path.is_file():
            continue
        rel = path.relative_to(run_dir).as_posix()
        if rel in keep or (legacy and rel.split('/')[0] in ('screens', 'screenstates')):
            continue
        removed += path.stat().st_size
        path.unlink()
    for path in sorted(run_dir.rglob('*'), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    return removed


def data(args):
    source = Path(args.source)
    baseline = Path(args.baseline) if args.baseline else source / 'baselines' / 'baseline.db'
    stage = STAGING / (SOURCE_ID + '.new')
    final = DEST / 'k' / SOURCE_ID
    viewer_doc = {}
    if (DEST / 'sources.json').is_file():
        viewer_doc = json.loads((DEST / 'sources.json').read_text(encoding='utf-8'))
    viewer = viewer_doc.get('viewer')
    if args.checkout:
        plugin, version, commit = checkout_viewer(args.checkout)
        if viewer and version != viewer:
            sys.exit('viewer version %s does not match checkout version %s; run ui --checkout first'
                     % (viewer, version))
        expected_commit = viewer_doc.get('viewer_commit')
        if expected_commit and expected_commit != commit:
            sys.exit('viewer commit %s does not match checkout commit %s; run ui --checkout first'
                     % (expected_commit, commit))
    else:
        plugin = plugin_dir(viewer)
    serve = load_serve(plugin)
    public_export = load_viewer_module(plugin, 'public_export')

    if stage.exists():
        sys.exit('%s exists: another data run is in progress, or one failed. Delete it once no run is going.'
                 % stage.relative_to(ROOT))
    (stage / 'baselines').mkdir(parents=True)
    screens = copy_baseline(baseline, stage / 'baselines' / 'baseline.db')
    print('baseline.db: %d screens' % screens)
    for profile in sorted((source / 'baselines').iterdir()):
        if profile.is_dir() and (profile / 'device.json').is_file():
            shutil.copytree(profile, stage / 'baselines' / profile.name)

    runs = []
    for run in sorted((source / 'runs').iterdir()):
        if not (run / 'run.db').is_file():
            print('skip %s: no run.db' % run.name)
        elif not run_finished(run / 'run.db'):
            print('skip %s: run has not ended' % run.name)
        else:
            copy_run(run, stage / 'runs' / run.name)
            scrubbed = scrub_run(stage / 'runs' / run.name)
            if scrubbed:
                print('%s: scrubbed %d local paths' % (run.name, scrubbed))
            runs.append(run.name)

    sanitized = public_export.sanitize_snapshot(stage)
    print('public export: sanitized %d database values in %d files'
          % (sanitized['redacted_values'], sanitized['changed_files']))
    views = {r: serve.run_view(stage, r) for r in runs}
    for run_id in runs:
        trimmed = trim_run(stage / 'runs' / run_id, run_id, views[run_id])
        print('%s: trimmed %.1f MB' % (run_id, trimmed / 2**20))

    manifest = serve.Source(SOURCE_ID, stage, SOURCE_NAME).manifest()
    for run in manifest['runs']:
        run.update(run_picker_axes(stage / 'runs' / run['id']))
    # Opening a trace needs serve.py's /trace endpoint and a local trace_processor; a null trace
    # makes the runs page say "no trace recorded" instead of offering a link that cannot work.
    for run in manifest['runs']:
        run['trace'] = None
    write_json(stage / 'index.json', manifest)
    for run_id, view in views.items():
        write_json(stage / 'runs' / run_id / 'view.json', view)
    public_export.sanitize_snapshot(stage)
    validated = public_export.validate_snapshot(stage)
    print('public export: validated %d files and %d databases'
          % (validated['files'], validated['databases']))

    old = STAGING / (SOURCE_ID + '.old')
    shutil.rmtree(old, ignore_errors=True)
    if final.exists():
        retry_rename(final, old)
    try:
        retry_rename(stage, final)
    except OSError:
        if old.exists():
            retry_rename(old, final)
        raise
    shutil.rmtree(old, ignore_errors=True)
    local = [str(source), source.as_posix(), str(Path.home())]
    for path in [final / 'index.json', *final.glob('runs/*/view.json')]:
        text = path.read_text(encoding='utf-8')
        for needle in local:
            if needle in text or needle.replace('\\', '\\\\') in text:
                print('warning: %s names the local path %s' % (path.relative_to(ROOT), needle))
    print('%d runs, viewer %s' % (len(runs), serve.APP_DIR.parent.name))
    return report()


def scrub(text):
    return HOME_PATH.subn('~', text)


def scrub_run(run_dir):
    """Replace the user's home folder with ~ in the copied run's text files and run.db."""
    count = 0
    for name in ('config.json', 'path-replay.json', 'logcat.txt', 'calls.jsonl'):
        path = run_dir / name
        if path.is_file():
            text, n = scrub(path.read_text(encoding='utf-8', errors='surrogateescape'))
            if n:
                path.write_text(text, encoding='utf-8', errors='surrogateescape', newline='')
                count += n
    for path in [run_dir / 'suite.json', run_dir / 'post' / 'a11y-audit.json',
                 *(run_dir / 'cases').glob('*.json')]:
        if path.is_file():
            text, n = scrub(path.read_text(encoding='utf-8', errors='surrogateescape'))
            if n:
                path.write_text(text, encoding='utf-8', errors='surrogateescape', newline='')
                count += n
    con = sqlite3.connect(run_dir / 'run.db')
    try:
        con.create_function('scrub', 1, lambda v: scrub(v)[0] if isinstance(v, str) else v,
                            deterministic=True)
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        for table in tables:
            for col in [r[1] for r in con.execute('PRAGMA table_info("%s")' % table)]:
                count += con.execute(
                    'UPDATE "%s" SET "%s" = scrub("%s") WHERE typeof("%s") = \'text\' AND scrub("%s") != "%s"'
                    % ((table,) + (col,) * 5)).rowcount
        con.commit()
    finally:
        con.close()
    return count


def retry_rename(src, dst):
    # Windows refuses a rename while any process holds a handle in the tree: the indexer or antivirus
    # after a large copy, or a local server reading the snapshot.
    for attempt in range(10):
        try:
            src.rename(dst)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(3)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=1) + '\n', encoding='utf-8', newline='\n')


def report():
    site = 0
    big = []
    maproom = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        if Path(dirpath) == ROOT:
            dirnames[:] = [d for d in dirnames if d not in NOT_PUBLISHED and d != '__pycache__']
            filenames = [f for f in filenames if f not in NOT_PUBLISHED]
        dirnames[:] = [d for d in dirnames if d != '__pycache__']
        for name in filenames:
            path = Path(dirpath) / name
            size = path.stat().st_size
            site += size
            if DEST in path.parents:
                maproom += size
            if size > FILE_LIMIT / 2:
                big.append((size, path.relative_to(ROOT).as_posix()))
    mb = 2 ** 20
    print('maproom/: %.1f MB' % (maproom / mb))
    print('site:     %.1f MB of %.0f MB' % (site / mb, SITE_LIMIT / mb))
    for size, rel in sorted(big, reverse=True):
        print('  %s %.1f MB of %.0f MB' % ('OVER' if size > FILE_LIMIT else 'near', size / mb, FILE_LIMIT / mb), rel)
    over = site > SITE_LIMIT or any(size > FILE_LIMIT for size, _ in big)
    if over:
        print('OVER LIMIT: GitHub or Pages will refuse this snapshot')
    return 1 if over else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='mode', required=True)
    p = sub.add_parser('ui', help='copy the viewer from the newest installed cartographer plugin')
    p.add_argument('--checkout', help='copy from this cartographer repository instead, at its current commit')
    p.add_argument('--run-details', action='store_true',
                   help='copy only the pinned PR #94 run surface and its required shared assets')
    p = sub.add_parser('serve', help='preview only the published snapshot with video range support')
    p.add_argument('--port', type=int, default=8742)
    p = sub.add_parser('data', help='copy, trim and index the baseline and runs')
    p.add_argument('--source', default=str(SOURCE), help='the knowledge/cartographer folder to snapshot')
    p.add_argument('--baseline', help='baseline database to snapshot instead of source/baselines/baseline.db')
    p.add_argument('--checkout', help='use this cartographer checkout for serve.py, matching ui --checkout')
    args = parser.parse_args()
    sys.exit({'ui': ui, 'data': data, 'serve': serve}[args.mode](args) or 0)


if __name__ == '__main__':
    main()
