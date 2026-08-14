# The calculator morph: its pin, its dead zones, and the two states it has to actually rest in.
#
# The invariants here are the ones that have broken before. A key whose start plus span exceeded 1 sat stranded
# mid-flight in what is meant to be a still state, and it looked like a layout bug rather than a timing one.
import json

NAME = 'morph'

# Measured with the phone's own 3D turn temporarily removed.
#
# Neither raw box works on its own. getBoundingClientRect returns the axis-aligned box of the projected quad,
# so a 15-degree turn makes neighbouring keys appear to overlap when nothing is wrong. offsetLeft/offsetTop are
# the LAYOUT box and ignore transforms entirely -- but every key is laid out once at a home rectangle and moved
# by transform, so at the faceplate the shared keys report their app cells and the grid reads as a mix of both
# keyboards. Dropping the phone's rotation for the measurement gives the true 2D rect of each key where it
# actually sits; the keys' own transforms are pure translate and scale at rest, so nothing else is disturbed.
GRID = """(() => {
  const phone = document.querySelector('.phone');
  const saved = phone.style.transform;
  phone.style.transform = 'none';
  const ks = [...document.querySelectorAll('#rpn .rpn-pad .k')]
    .filter(k => +getComputedStyle(k).opacity > 0.5)
    .map(k => { const q = k.getBoundingClientRect();
                return {n: k.dataset.key, l: Math.round(q.left), t: Math.round(q.top),
                        w: Math.round(q.width), h: Math.round(q.height)}; });
  phone.style.transform = saved;
  const over = [];
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = ks[i], b = ks[j];
    const w = Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l);
    const h = Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t);
    if (w > 1 && h > 1) over.push(a.n + '/' + b.n);
  }
  // Column and row counts tolerate a pixel of rounding, or a 10-column grid reads as 20 distinct edges.
  const bucket = (vals) => { const out = [];
    for (const v of vals.sort((x, y) => x - y)) if (!out.length || v - out[out.length - 1] > 3) out.push(v);
    return out.length; };
  return JSON.stringify({
    visible: ks.length, overlaps: over.length, sample: over.slice(0, 4),
    rows: bucket(ks.map(k => k.t)), cols: bucket(ks.map(k => k.l)),
  });
})()"""


def run(page, r):
    page.goto('index.html')
    pin = page.pin('app-scroll', 'app-stage')
    top, run_px = pin['top'], pin['run']
    r.ok('the scene pins', run_px > 0, 'run=%s' % run_px)

    def at(fraction, pause=0.3):
        page.scroll(top + int(run_px * fraction), pause=pause)
        return float(page.js("document.getElementById('app-stage').style.getPropertyValue('--m')") or 0)

    # Both pure states have to be reachable, not exist at a single scroll position.
    zones = {'faceplate': 0, 'morphing': 0, 'app': 0}
    step = max(1, run_px // 40)
    for offset in range(0, run_px + step, step):
        page.scroll(top + offset, pause=0.03)
        m = float(page.js("document.getElementById('app-stage').style.getPropertyValue('--m')") or 0)
        zones['faceplate' if m <= 0.0005 else ('app' if m >= 0.9995 else 'morphing')] += step
    r.ok('the faceplate holds still long enough to stop on', zones['faceplate'] > run_px * 0.10,
         '%dpx of %d' % (zones['faceplate'], run_px))
    r.ok('the finished app holds still too', zones['app'] > run_px * 0.10,
         '%dpx of %d' % (zones['app'], run_px))
    r.ok('and there is a scrub between them', zones['morphing'] > run_px * 0.4,
         '%dpx of %d' % (zones['morphing'], run_px))

    r.near('m is 0 at the start of the pin', at(0.0), 0.0, 0.001)
    r.near('m is 1 by the end', at(1.0), 1.0, 0.001)

    # NO KEY MAY BE MID-FLIGHT AT REST. This is the failure that shipped once.
    at(0.0, pause=0.6)
    face = page.json(GRID)
    r.check('faceplate shows all 39 keys', face['visible'], 39)
    r.check('faceplate keys do not overlap', face['overlaps'], 0)
    r.check('faceplate is 10 columns', face['cols'], 10)
    r.check('faceplate is 4 rows', face['rows'], 4)

    at(1.0, pause=0.6)
    app = page.json(GRID)
    r.check('app shows all 28 keys', app['visible'], 28)
    r.check('app keys do not overlap', app['overlaps'], 0)
    r.check('app is 4 columns', app['cols'], 4)
    r.check('app is 7 rows', app['rows'], 7)

    # Keys are inert while plates are in flight, live at both resting states.
    at(0.45, pause=0.5)
    page.js("document.querySelector('#rpn .rpn-pad [data-key=\\\"CA\\\"]').click();1")
    before = page.js("document.querySelector('#rpn .rpn-in .v').textContent")
    page.click_at('#rpn .rpn-pad [data-key="7"]')
    r.check('a key mid-morph does nothing', page.js("document.querySelector('#rpn .rpn-in .v').textContent"), before)

    at(1.0, pause=0.5)
    page.click_at('#rpn .rpn-pad [data-key="7"]')
    r.check('the app keypad is live at rest', page.js("document.querySelector('#rpn .rpn-in .v').textContent"), '7')

    # The faceplate is a working calculator too, reached by a real click through the 3D transform. Cleared from
    # the app state first: the faceplate has no CA, and the app's is hidden while the faceplate is showing.
    page.click_at('#rpn .rpn-pad [data-key="CA"]')
    at(0.0, pause=0.6)
    for key in ('9', '√x'):
        page.click_at('#rpn .rpn-pad [data-key="%s"]' % key)
    r.check('the faceplate is live at rest: 9 then sqrt', page.js("document.querySelector('#rpn .rpn-in .v').textContent"), '3')

    # A short viewport gets the finished calculator as a plain block, never a pinned scene it cannot hold.
    page.viewport(852, 393, mobile=True, dpr=2)
    page.js('window.dispatchEvent(new Event("resize"));1')
    r.check('short viewport does not pin', page.js("getComputedStyle(document.getElementById('app-stage')).position"), 'static')
    r.ok('short viewport shows the shipped state',
         page.js("document.getElementById('app-stage').classList.contains('is-new')"))
    page.reset_viewport()
