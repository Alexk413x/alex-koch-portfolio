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
    top, run_px, vh = pin['top'], pin['run'], pin['vh']
    r.ok('the scene pins', run_px > 0, 'run=%s' % run_px)

    M = "document.getElementById('app-stage').style.getPropertyValue('--m')"

    def at(fraction, pause=1.25):
        """Scrolls, then waits out the morph's own clock. It is no longer tracked to the scroll, so the value
        after a move is a function of TIME, not of where the move stopped."""
        page.scroll(top + int(run_px * fraction), pause=pause)
        return float(page.js(M) or 0)

    # The dead zones are gone with the scrub, and the runway shrank with them. 1.8 viewport heights, 40% of it
    # moving nothing, is the thing this replaced.
    r.ok('the pin carries no dead runway', run_px < vh * 1.2, '%dpx against a %dpx viewport' % (run_px, vh))

    r.near('the faceplate is where the pin starts', at(0.0), 0.0, 0.001)

    # ONE NUDGE PLAYS THE WHOLE THING. Barely past the trigger is enough; the morph owns its own clock from
    # there, so how far the reader scrolled has no bearing on where it stops.
    nudge = int(run_px * 0.14) + 20
    page.scroll(top, pause=1.25)
    page.scroll(top + nudge, pause=1.25)
    r.near('one nudge past the trigger plays it to completion', float(page.js(M) or 0), 1.0, 0.001)
    r.ok('and the nudge really was small', nudge < vh * 0.2, '%dpx' % nudge)

    # It is played, not jumped: a moment after the trigger it must be part way through.
    page.scroll(top, pause=1.25)
    page.scroll(top + nudge, pause=0.2)
    mid = float(page.js(M) or 0)
    r.ok('the morph is animated, not switched', 0.001 < mid < 0.999, 'm=%.3f a fifth of a second in' % mid)

    # Scrolling back releases it, to completion, the same way.
    r.near('scrolling back releases it', at(0.0), 0.0, 0.001)

    # AND IT ALWAYS RESTS ON A PURE STATE. With the scrub gone there is no scroll position that means "halfway",
    # so wherever the reader stops, the mechanism finishes what it started.
    impure = []
    for f in (0.05, 0.3, 0.55, 0.8, 1.0):
        m = at(f, pause=1.15)
        if 0.001 < m < 0.999:
            impure.append('%.2f->%.3f' % (f, m))
    r.ok('it comes to rest on a pure state everywhere in the pin', not impure, ', '.join(impure))

    # NO KEY MAY BE MID-FLIGHT AT REST. This is the failure that shipped once.
    at(0.0)
    face = page.json(GRID)
    r.check('faceplate shows all 39 keys', face['visible'], 39)
    r.check('faceplate keys do not overlap', face['overlaps'], 0)
    r.check('faceplate is 10 columns', face['cols'], 10)
    r.check('faceplate is 4 rows', face['rows'], 4)

    at(1.0)
    app = page.json(GRID)
    r.check('app shows all 28 keys', app['visible'], 28)
    r.check('app keys do not overlap', app['overlaps'], 0)
    r.check('app is 4 columns', app['cols'], 4)
    r.check('app is 7 rows', app['rows'], 7)

    # Keys are inert while plates are in flight, live at both resting states. Mid-flight is no longer a scroll
    # position, so it has to be caught in TIME: trigger the morph, then click while it is still running.
    at(1.0)
    page.click_at('#rpn .rpn-pad [data-key="CA"]')
    at(0.0)
    before = page.js("document.querySelector('#rpn .rpn-in .v').textContent")
    page.scroll(top + nudge, pause=0.25)
    page.click_at('#rpn .rpn-pad [data-key="7"]')
    r.check('a key mid-morph does nothing', page.js("document.querySelector('#rpn .rpn-in .v').textContent"), before)

    at(1.0)
    page.click_at('#rpn .rpn-pad [data-key="7"]')
    r.check('the app keypad is live at rest', page.js("document.querySelector('#rpn .rpn-in .v').textContent"), '7')

    # The faceplate is a working calculator too, reached by a real click through the 3D transform. Cleared from
    # the app state first: the faceplate has no CA, and the app's is hidden while the faceplate is showing.
    page.click_at('#rpn .rpn-pad [data-key="CA"]')
    at(0.0)
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
