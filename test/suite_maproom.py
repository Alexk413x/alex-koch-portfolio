import hashlib
import json
import re
import sqlite3
from pathlib import Path
from urllib.parse import urlencode

import maproom

NAME = 'maproom'
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'maproom' / 'k' / maproom.SOURCE_ID


def run(page, r):
    r.ok('raw staging stays outside the published snapshot',
         maproom.STAGING.is_relative_to(ROOT / '.claude') and
         not maproom.STAGING.is_relative_to(ROOT / 'maproom'))
    sources = json.loads((ROOT / 'maproom' / 'sources.json').read_text(encoding='utf-8'))
    source = next(s for s in sources['sources'] if s['id'] == maproom.SOURCE_ID)
    r.check('viewer points at the published source', source['url'],
            '../k/%s/' % maproom.SOURCE_ID)
    r.check('viewer uses the published baseline', source['graph'], 'baselines/baseline.db')
    manifest = json.loads((DATA / 'index.json').read_text(encoding='utf-8'))
    missing = []
    for profile in manifest['profiles']:
        base = DATA / 'baselines' / profile['key']
        if not (base / 'device.json').is_file():
            missing.append(str(base / 'device.json'))
        for rendition in profile['renditions']:
            for leaf in rendition['leaves']:
                missing.extend(str(base / leaf['path'] / name) for name in leaf['files']
                               if not (base / leaf['path'] / name).is_file())
    r.check('every manifest capture exists', missing, [])

    for path in sorted(DATA.rglob('*.db')):
        with sqlite3.connect('file:%s?mode=ro' % path.as_posix(), uri=True) as con:
            r.check('%s SQLite integrity' % path.relative_to(DATA),
                    con.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'capability' in tables:
                notes = con.execute(
                    "SELECT count(*) FROM capability WHERE coalesce(note, '') NOT IN ('', ?)",
                    ('[omitted from public export: implementation diagnostics]',)
                ).fetchone()[0]
                r.check('%s omits internal capability documentation' % path.relative_to(DATA), notes, 0)
            if 'step' in tables:
                columns = {row[1] for row in con.execute('PRAGMA table_info(step)')}
                if 'resolved' in columns:
                    recipes = con.execute(
                        "SELECT count(*) FROM step WHERE coalesce(resolved, '[]') NOT IN ('', '[]')"
                    ).fetchone()[0]
                    r.check('%s omits resolved execution recipes' % path.parent.name, recipes, 0)
        if path.name == 'run.db':
            refs, _ = maproom.referenced_paths(path)
            missing = sorted(p for p in refs if not (path.parent / p).is_file())
            r.check('%s evidence references resolve' % path.parent.name, missing, [])

    private = re.compile(rb'librarian serve|librarian-dex\.jar|watch_settle\.py|clearPrimaryClip|'
                         rb'librarian:inject|librarian said:|/data/local/tmp/librarian', re.IGNORECASE)
    exposed = [str(p.relative_to(DATA)) for p in DATA.rglob('*')
               if p.suffix in {'.db', '.json', '.jsonl', '.txt', '.xml'} and private.search(p.read_bytes())]
    r.check('published bytes omit known internal command disclosures', exposed, [])

    with sqlite3.connect(DATA / 'baselines' / 'baseline.db') as con:
        expected = {
            'screens': con.execute('SELECT count(*) FROM screen').fetchone()[0],
            'renditions': con.execute('SELECT count(*) FROM rendition').fetchone()[0],
            'edges': con.execute('SELECT count(*) FROM edge').fetchone()[0],
            'steps': con.execute('SELECT count(*) FROM edge_step').fetchone()[0],
        }
        screen = con.execute("SELECT id FROM screen WHERE kind != 'external' ORDER BY id").fetchone()[0]
    baseline_bytes = (DATA / 'baselines' / 'baseline.db').read_bytes()
    baseline_hash = hashlib.sha256(baseline_bytes).hexdigest()
    for listed in manifest['runs']:
        view = json.loads((DATA / 'runs' / listed['id'] / 'view.json').read_text(encoding='utf-8'))
        today = view['basis']['today']
        r.check('%s comparison uses the published baseline' % listed['id'],
                (today['sha256'], today['bytes']), (baseline_hash, len(baseline_bytes)))

    query = urlencode({'src': maproom.SOURCE_ID})
    page.goto('maproom/screens/map.html?' + query)
    loaded = page.until("!!document.querySelector('.bar') && "
                        "!document.body.innerText.includes('Reading the map')", timeout=20)
    r.ok('baseline map finishes loading', loaded)
    actual = page.json(
        "(async()=>{const {loadBaseline}=await import('/maproom/js/data/baseline.js');"
        "const m=await loadBaseline('../k/%s/baselines/baseline.db');"
        "return JSON.stringify({screens:m.screens.length,renditions:m.renditions.length,"
        "edges:m.edges.length,steps:m.edges.reduce((n,e)=>n+e.steps.length,0)});})()"
        % maproom.SOURCE_ID)
    r.check('browser model matches published database', actual, expected)

    for listed in manifest['runs']:
        run_id = listed['id']
        with sqlite3.connect(DATA / 'runs' / run_id / 'run.db') as con:
            count = con.execute('SELECT count(*) FROM step').fetchone()[0]
            outcomes = dict(con.execute('SELECT outcome, count(*) FROM step GROUP BY outcome'))
        actual = page.json(
            "(async()=>{const {loadRun}=await import('/maproom/js/data/run.js');"
            "const r=await loadRun('../k/%s/',%s);"
            "return JSON.stringify({steps:r.steps.length,outcomes:r.counts});})()"
            % (maproom.SOURCE_ID, json.dumps(run_id)))
        r.check('%s browser retains all steps and outcomes' % run_id, actual,
                {'steps': count, 'outcomes': outcomes})

    routes = ['index.html', 'coverage.html?' + query,
              'screen.html?' + query + '&' + urlencode({'id': screen})]
    for listed in manifest['runs']:
        routes.extend([
            'runs.html?' + query + '&' + urlencode({'id': listed['id']}),
            'map.html?' + query + '&' + urlencode({'run': listed['id']}),
        ])
    for route in routes:
        page.goto('maproom/screens/' + route)
        loaded = page.until("!!document.querySelector('.bar') && "
                            "!document.body.innerText.includes('Reading the map') && "
                            "!document.body.innerText.includes('Reading the run')", timeout=20)
        text = page.js('document.body.innerText')
        r.ok('%s renders' % route, loaded and bool(text.strip()))
        errors = ['This page failed to draw', 'Could not read', 'Map schema not supported']
        r.ok('%s has no load error' % route, not any(e in text for e in errors), text[:300])
        broken = page.js("[...document.images].filter(i=>i.getAttribute('src') && "
                         "i.complete && !i.naturalWidth).length")
        r.check('%s has no broken loaded images' % route, broken, 0)
