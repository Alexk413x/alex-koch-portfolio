import hashlib
import json
import re
import sqlite3
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import maproom

NAME = 'maproom'
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'maproom' / 'k' / maproom.SOURCE_ID


def playback(page, r, manifest):
    class QuietHandler(maproom.SnapshotHandler):
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    origin = 'http://127.0.0.1:%d' % server.server_port
    try:
        media = next(DATA.glob('runs/*/*.mp4'))
        media_url = origin + '/' + media.relative_to(ROOT / 'maproom').as_posix()
        size = media.stat().st_size
        for header, start, end in [('bytes=10-19', 10, 19), ('bytes=-4', size - 4, size - 1),
                                   ('bytes=%d-' % (size - 8), size - 8, size - 1),
                                   ('bytes=0-%d' % (size + 10), 0, size - 1)]:
            with urlopen(Request(media_url, headers={'Range': header})) as response:
                r.check('video range %s status' % header, response.status, 206)
                r.check('video range %s header' % header, response.headers['Content-Range'],
                        'bytes %d-%d/%d' % (start, end, size))
                with media.open('rb') as expected:
                    expected.seek(start)
                    r.check('video range %s bytes' % header,
                            hashlib.sha256(response.read()).hexdigest(),
                            hashlib.sha256(expected.read(end - start + 1)).hexdigest())
        for header in ['bytes=%d-' % size, 'bytes=20-10', 'bytes=-0', 'bytes=a-b',
                       'bytes=0-1,3-4']:
            try:
                urlopen(Request(media_url, headers={'Range': header}))
            except HTTPError as error:
                r.check('invalid video range %s' % header, error.code, 416)
                r.check('invalid video range reports size', error.headers['Content-Range'],
                        'bytes */%d' % size)
            else:
                r.ok('invalid video range rejected', False, header)
        for path in ['/../maproom.py', '/%2e%2e/maproom.py', '/k/', '/sources.json/../../AGENTS.md']:
            try:
                urlopen(origin + path)
            except HTTPError as error:
                r.ok('preview refuses %s' % path, error.code in (403, 404))
            else:
                r.ok('preview refuses %s' % path, False)

        page.cdp.call('Page.navigate', {'url': origin + '/screens/runs.html?' +
                      urlencode({'src': maproom.SOURCE_ID, 'id': manifest['runs'][0]['id']})})
        page.settle()
        timing = page.json("""(async()=>{
          const {offsetAt,runVideoSegments}=await import('/js/data/run.js');
          const video={url:'kept.mp4',started_at:100,ended_at:140,cuts:[{at:120,gap_s:5}]};
          return JSON.stringify({
            offsets:[110,117,125].map(at=>offsetAt(video,at)),
            segments:runVideoSegments({startedAt:105,endedAt:135,
              steps:[{started_at:105,ended_at:135}],videos:[video,{...video,url:null}]}),
            legacy:runVideoSegments({base:'runs/legacy/',startedAt:100,endedAt:140,
              steps:[{started_at:101,ended_at:139}],videos:[]})
          });})()""")
        r.check('video offsets account for time before, within and after a cut', timing['offsets'], [10, 15, 20])
        r.check('only kept video segments play', len(timing['segments']), 1)
        r.check('segments trim to run timestamps',
                [timing['segments'][0][k] for k in ('startAt', 'endAt', 'startOffset', 'endOffset')],
                [105, 135, 5, 30])
        r.check('legacy runs retain video.mp4 fallback', timing['legacy'][0]['url'], 'runs/legacy/video.mp4')

        for listed in manifest['runs']:
            run_id = listed['id']
            page.cdp.call('Page.navigate', {'url': origin + '/screens/runs.html?' +
                          urlencode({'src': maproom.SOURCE_ID, 'id': run_id})})
            page.settle()
            if run_id == manifest['runs'][0]['id']:
                page.viewport(390, 844)
                page.js("document.querySelector('.run-picker > button').click()")
                picker = page.json("""JSON.stringify((()=>{
                  const option=document.querySelector('.run-picker .picker-option');
                  const label=option.querySelector('.picker-option-label');
                  const metadata=option.querySelector('.picker-option-note');
                  const metadataGroup=option.querySelector('.run-picker-metadata');
                  const row=option.getBoundingClientRect();
                  const metadataRect=metadata.getBoundingClientRect();
                  const metadataGroupRect=metadataGroup.getBoundingClientRect();
                  const drop=document.querySelector('.run-picker .drop');
                  return {
                    direction:getComputedStyle(option).flexDirection,
                    whiteSpace:getComputedStyle(option).whiteSpace,
                    label:label?.textContent,
                    labelAlign:getComputedStyle(label).textAlign,
                    metadataJustify:getComputedStyle(metadata).justifyContent,
                    metadataDisplay:getComputedStyle(metadataGroup).display,
                    metadataAlign:getComputedStyle(metadataGroup).alignItems,
                    metadataGap:getComputedStyle(metadataGroup).gap,
                    metadataCenterOffset:Math.abs((metadataGroupRect.top+metadataGroupRect.bottom)/2
                      -(row.top+row.bottom)/2),
                    rowPadding:getComputedStyle(option).padding,
                    dropWidth:drop.getBoundingClientRect().width,
                    iconCount:metadata.querySelectorAll('.brand,.msym,.run-picker-help').length,
                    symbolFont:getComputedStyle(metadata.querySelector('.msym')).fontFamily,
                    help:option.querySelectorAll('.run-picker-help').length,
                    accessibleName:option.getAttribute('aria-label'),
                    overflows:option.scrollWidth>option.clientWidth,
                    metadataRightInset:row.right-metadataRect.right,
                  };
                })())""")
                r.check('run picker keeps the date and icons on one row',
                        (picker['direction'], picker['whiteSpace']), ('row', 'nowrap'))
                r.check('run picker aligns the date left and metadata right',
                        (picker['labelAlign'], picker['metadataJustify']),
                        ('left', 'flex-end'))
                r.check('run picker centers and spaces metadata icons',
                        (picker['metadataDisplay'], picker['metadataAlign'], picker['metadataGap']),
                        ('flex', 'center', '8px'))
                r.ok('run picker metadata is centered with row padding',
                     picker['metadataCenterOffset'] < 1 and picker['rowPadding'] == '10px 12px')
                r.ok('run picker dropdown stays compact',
                     picker['dropWidth'] <= 320)
                r.check('run picker shows platform, orientation, appearance and locale marks',
                        (picker['iconCount'], picker['help']), (4, 1))
                r.ok('run picker symbols use the local icon font',
                     'Material Symbols Rounded' in picker['symbolFont'])
                r.ok('run picker metadata stays inside the mobile option',
                     not picker['overflows'] and 8 <= picker['metadataRightInset'] <= 20)
                r.check('unrecorded locale has a question-mark help icon',
                        (picker['help'], 'Locale not recorded' in picker['accessibleName']),
                        (1, True))
                page.reset_viewport()
            ready = page.until("document.querySelector('video')?.readyState >= 2", timeout=25)
            r.ok('%s decodes a real video frame' % run_id, ready)
            if not ready:
                continue
            r.ok('%s play control is initially paused' % run_id,
                 page.js("document.querySelector('video').paused"))
            frame = page.json("JSON.stringify(document.querySelector('.run-video-frame')"
                              ".getBoundingClientRect().toJSON())")
            page.cdp.call('Input.dispatchMouseEvent',
                          {'type': 'mouseMoved', 'x': frame['x'] + frame['width'] / 2,
                           'y': frame['y'] + frame['height'] / 2})
            page.until("getComputedStyle(document.querySelector('.run-video-overlay')).opacity === '1'")
            page.click_at('button[aria-label="Play Video"]')
            r.ok('%s video playback advances' % run_id,
                 page.until("!document.querySelector('video').paused && "
                            "document.querySelector('video').currentTime > 0.25", timeout=8))
            page.js("document.querySelector('.run-video-frame').focus()")
            page.key(' ', pause=0.1)
            r.ok('%s pause control pauses playback' % run_id,
                 page.js("document.querySelector('video').paused"))
            segments = page.js("Number(document.querySelector('.run-player-layout').dataset.segments)")
            for index in range(1, segments):
                page.js("document.querySelector('.run-video-marker[data-segment-index=\"%d\"]').focus()"
                        % index)
                page.cdp.call('Input.dispatchKeyEvent', {
                    'type': 'keyDown', 'key': 'Enter', 'code': 'Enter',
                    'windowsVirtualKeyCode': 13, 'text': '\r',
                })
                page.cdp.call('Input.dispatchKeyEvent', {
                    'type': 'keyUp', 'key': 'Enter', 'code': 'Enter',
                    'windowsVirtualKeyCode': 13,
                })
                r.ok('%s switches to video segment %d' % (run_id, index + 1),
                     page.until("document.querySelector('.run-video-frame').dataset.segment === '%d' && "
                                "document.querySelector('video').readyState >= 2 && "
                                "!document.querySelector('video').seeking" % index, timeout=20))
            for width, height in [(1500, 1000), (390, 844)]:
                page.viewport(width, height)
                r.ok('%s player stays within viewport at %dpx' % (run_id, width),
                     page.js("document.documentElement.scrollWidth <= innerWidth + 1 && "
                             "document.querySelector('.run-video-frame').getBoundingClientRect().width > 0"))
            page.reset_viewport()
            if run_id == manifest['runs'][-1]['id']:
                page.js("document.querySelector('.run-step-scroll > .run-step:not(.run-session-event)')"
                        ".focus()")
                page.key('Enter', pause=0.6)
                r.ok('step details include a capture inspector control',
                     page.until("!!document.querySelector('.run-step-capture')"))
                page.js("document.querySelector('.run-step-capture').scrollIntoView({block:'center'})")
                page.click_at('.run-step-capture')
                r.ok('capture inspector loads published UI hierarchy',
                     page.until("document.querySelector('dialog.capture-preview')?.open && "
                                "document.querySelectorAll('.element-box').length > 0", timeout=10))
                page.key('Escape', pause=0.1)
                r.ok('capture inspector closes with Escape',
                     page.js("!document.querySelector('dialog.capture-preview').open"))
    finally:
        page.reset_viewport()
        server.shutdown()
        worker.join()
        server.server_close()


def run(page, r):
    demo = (ROOT / 'cartographer-demo.html').read_text(encoding='utf-8')
    r.ok('Cartographer demo keeps playback within the Maproom navigation',
         'PLAY RECORDED RUNS' not in demo and 'maproom/screens/index.html' in demo)
    r.ok('raw staging stays outside the published snapshot',
         maproom.STAGING.is_relative_to(ROOT / '.claude') and
         not maproom.STAGING.is_relative_to(ROOT / 'maproom'))
    r.check('missing run config leaves picker axes unrecorded',
            maproom.run_picker_axes(DATA / 'runs' / 'missing-config'),
            {'orientation': '', 'appearance': '', 'mode': '', 'locale': '', 'platform': ''})
    sources = json.loads((ROOT / 'maproom' / 'sources.json').read_text(encoding='utf-8'))
    if 'run_details' in sources:
        r.check('focused run player records its upstream revision',
                sources['run_details']['viewer_commit'], maproom.RUN_DETAILS_COMMIT)
        r.check('focused run player records its generated files',
                sources['run_details']['files'], list(maproom.RUN_DETAILS_FILES))
    source = next(s for s in sources['sources'] if s['id'] == maproom.SOURCE_ID)
    r.check('viewer points at the published source', source['url'],
            '../k/%s/' % maproom.SOURCE_ID)
    r.check('viewer uses the published baseline', source['graph'], 'baselines/baseline.db')
    manifest = json.loads((DATA / 'index.json').read_text(encoding='utf-8'))
    picker_axes = {
        '20261009T224110225Z': ('android', 'portrait', 'Dark'),
        '20261009T225904319Z': ('android', 'portrait', 'Light'),
        '20261009T231621629Z': ('android', 'landscape', 'Dark'),
        '20261009T234836786Z': ('android', 'landscape', 'Light'),
    }
    r.check('published runs include recorded platform, orientation and theme',
            {run['id']: (run.get('platform'), run.get('orientation'), run.get('appearance'))
             for run in manifest['runs']}, picker_axes)
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

    playback(page, r, manifest)
