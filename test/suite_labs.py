# The labs boot, and every module in the repo parses.
#
# WHY THIS EXISTS. A backtick written inside a block comment that sits inside a GLSL template literal closes the
# string early, and the file becomes a SyntaxError. Nothing on the home page imports it, so every suite passed
# while CRT Lab was a blank screen -- the labs had no coverage at all, and a 200 on the HTML says only that the
# document was served.
#
# Two checks, and the first is the cheap one that would have caught it: import every module and fail on a
# SyntaxError. A module that throws for want of a DOM is fine; one that cannot be parsed is not.
#
# THE CACHE IS THE OTHER HALF. The browser will serve a stale module against fresh HTML, which looks exactly like
# a maths bug and is how the broken file was verified as working. Every fetch here carries a cache-buster.
import json
import os

NAME = 'labs'

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Each lab, and the handle it publishes once it has finished wiring itself up.
LABS = [
    ('labs/crt/CRT Lab.html', 'CRTGL'),
    ('labs/reactor/Reactor.html', None),
    ('labs/wormhole/Wormhole.html', None),
    ('labs/shell/Shell.html', None),
]


def _modules():
    """Every ES module the site ships, repo-relative with forward slashes."""
    out = []
    for base in ('labs', 'site'):
        for dirpath, _, names in os.walk(os.path.join(ROOT, base)):
            for n in names:
                if n.endswith('.js'):
                    p = os.path.relpath(os.path.join(dirpath, n), ROOT)
                    out.append(p.replace(os.sep, '/'))
    return sorted(out)


def run(page, r):
    mods = _modules()
    r.ok('there are modules to check', len(mods) > 20, '%d found' % len(mods))

    # ---- every module parses ----
    page.goto('index.html')
    page.settle(0.3)
    bad = page.json(
        "(async()=>{const ms=%s,bad=[];"
        "for(const m of ms){try{await import('/'+m+'?v='+Date.now());}"
        "catch(e){if(/SyntaxError/.test(String(e.name)+String(e)))bad.push(m+' :: '+(e.message||e));}}"
        "return JSON.stringify(bad)})()" % json.dumps(mods))
    r.check('every module parses', bad, [])

    # ---- and each lab actually boots ----
    #
    # A lab that fails to wire itself leaves its panel empty, which is what a SyntaxError in any module it
    # imports looks like from the outside.
    for path, handle in LABS:
        page.goto(path.replace(' ', '%20') + '?bust=1')
        page.settle(0.9)
        page.until("document.querySelectorAll('#controls .row').length > 0", timeout=8.0)
        rows = page.js("document.querySelectorAll('#controls .row').length")
        r.ok('%s builds its control panel' % os.path.basename(path), rows > 0, '%d rows' % rows)

        canvas = page.js("(()=>{const c=document.querySelector('#stage canvas');"
                         "return c?c.width+'x'+c.height:'none'})()")
        r.ok('%s sizes its canvas' % os.path.basename(path), canvas not in ('none', '300x150'), canvas)

        gl = page.js("(document.getElementById('glstate')||{}).textContent||''")
        r.check('%s reports no GL fault' % os.path.basename(path), gl.strip(), '')

        if handle:
            r.check('%s publishes %s' % (os.path.basename(path), handle),
                    page.js('typeof window.%s' % handle), 'object')

    # ---- and the loading ring is gone once a lab has drawn ----
    r.ok('the loader is dismissed after the first frame',
         page.until('!document.querySelector(".kit-load")', timeout=6.0),
         'the ring is still over the stage')
