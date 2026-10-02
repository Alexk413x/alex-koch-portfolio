"""maproom.py -- refreshes the static snapshot of cartographer's maproom viewer under maproom/.

    python maproom.py ui      copy the viewer from the newest installed cartographer plugin
    python maproom.py ui --checkout <repo>
                              copy it from a cartographer repository at its current commit instead
    python maproom.py data    copy the RPN Dominator Calculator baseline and runs, trim them, and
                              pre-generate the two JSON files serve.py answers dynamically

maproom's serve.py answers /k/<id>/index.json and /k/<id>/runs/<run>/view.json by walking the
cartographer folder. Pages serves static files only, so `data` writes both files to those paths,
computed by serve.py's own code: the slug rules live in cartographer, and a second implementation
would drift from them.

`data` only reads the source folder, and never reads baseline.db.new. Each run is copied without its
trace, its view.json is computed, and then every file that neither run.db nor view.json names is
deleted. A run folder with no run.db, or whose run has not ended, is skipped.
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
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'maproom'
PLUGIN = Path.home() / '.claude' / 'plugins' / 'cache' / 'cartographer' / 'cartographer'
SOURCE = Path(os.environ.get('MAPROOM_SOURCE', r'C:\Android\RPNDominatorCalculator\knowledge\cartographer'))
SOURCE_ID = 'RPNDominatorCalculator'
SOURCE_NAME = 'RPN Dominator Calculator'

UI_DIRS = ('screens', 'css', 'js', 'vendor')
# The viewer fetches its source list from the server root. Under a subfolder of a site that resolves
# to the site's root, so the one absolute URL is made relative to the pages in screens/.
PATCHES = [('js/data/sources.js', "getJson('/sources.json')", "getJson('../sources.json')")]

# Read by nothing in the viewer; the Perfetto link needs a local trace_processor that Pages cannot run.
SKIP_COPY = ('trace.pftrace',)
KEEP_ALWAYS = ('run.db', 'config.json', 'logcat.txt', 'calls.jsonl',
               'post/map.db', 'post/analysis/warnings.json', 'post/states/index.json')

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


def load_serve(plugin):
    spec = importlib.util.spec_from_file_location('maproom_serve', plugin / 'maproom' / 'serve.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def checkout_viewer(repo):
    repo = Path(repo).resolve()
    git = ['git', '-C', str(repo)]
    if subprocess.run(git + ['status', '--porcelain', '--', 'maproom'], capture_output=True, text=True, check=True).stdout:
        sys.exit('%s has uncommitted changes under maproom/' % repo)
    commit = subprocess.run(git + ['rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    version = json.loads((repo / '.claude-plugin' / 'plugin.json').read_text(encoding='utf-8'))['version']
    return repo, version, commit


def ui(args):
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
    stage = DEST / 'k' / (SOURCE_ID + '.new')
    final = DEST / 'k' / SOURCE_ID
    viewer = None
    if (DEST / 'sources.json').is_file():
        viewer = json.loads((DEST / 'sources.json').read_text(encoding='utf-8')).get('viewer')
    serve = load_serve(plugin_dir(viewer))

    if stage.exists():
        sys.exit('%s exists: another data run is in progress, or one failed. Delete it once no run is going.'
                 % stage.relative_to(ROOT))
    (stage / 'baselines').mkdir(parents=True)
    screens = copy_baseline(source / 'baselines' / 'baseline.db', stage / 'baselines' / 'baseline.db')
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

    views = {r: serve.run_view(stage, r) for r in runs}
    for run_id in runs:
        trimmed = trim_run(stage / 'runs' / run_id, run_id, views[run_id])
        print('%s: trimmed %.1f MB' % (run_id, trimmed / 2**20))

    manifest = serve.Source(SOURCE_ID, stage, SOURCE_NAME).manifest()
    # Opening a trace needs serve.py's /trace endpoint and a local trace_processor; a null trace
    # makes the runs page say "no trace recorded" instead of offering a link that cannot work.
    for run in manifest['runs']:
        run['trace'] = None
    write_json(stage / 'index.json', manifest)
    for run_id, view in views.items():
        write_json(stage / 'runs' / run_id / 'view.json', view)

    old = DEST / 'k' / (SOURCE_ID + '.old')
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
    p = sub.add_parser('data', help='copy, trim and index the baseline and runs')
    p.add_argument('--source', default=str(SOURCE), help='the knowledge/cartographer folder to snapshot')
    args = parser.parse_args()
    sys.exit({'ui': ui, 'data': data}[args.mode](args) or 0)


if __name__ == '__main__':
    main()
