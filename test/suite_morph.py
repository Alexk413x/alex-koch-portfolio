# The calculator morph: its pin, its dead zones, and the two states it has to actually rest in.
#
# The invariants here are the ones that have broken before. A key whose start plus span exceeded 1 sat stranded
# mid-flight in what is meant to be a still state, and it looked like a layout bug rather than a timing one.
import json
import time

NAME = 'morph'

# Measured with the phone's own 3D turn temporarily removed.
#
# Neither raw box works on its own. getBoundingClientRect returns the axis-aligned box of the projected quad,
# so a 15-degree turn makes neighboring keys appear to overlap when nothing is wrong. offsetLeft/offsetTop are
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

    def at(fraction, pause=0.15):
        """Scrolls, then waits for the morph to reach a PURE state.

        A stop part-way through the turn glides the page on to one end, so the value right after a move is still
        changing. Polling for the state the mechanism is guaranteed to reach returns as soon as it is true."""
        page.scroll(top + int(run_px * fraction), pause=pause)
        return page.until_morphed()

    def y():
        return float(page.js('window.scrollY'))

    r.ok('the pin carries no dead runway', run_px < vh * 1.2, '%dpx against a %dpx viewport' % (run_px, vh))

    r.near('the faceplate is where the pin starts', at(0.0), 0.0, 0.001)
    # A reader arrives and rests before scrolling on; resting is what stands the end they are on down.
    time.sleep(0.7)

    # THE SCROLL DRIVES IT. Real wheel input, not scrollTo: a programmatic scroll near an armed snap target is
    # snapped straight back onto it, which a reader's gesture is not (the rig stands the origin beat down).
    # Read inside the stillness window, before the settle glide starts.
    TRACK = ("(()=>{const g=document.getElementById('app-stage');"
             "return JSON.stringify({m:+(g.style.getPropertyValue('--m')||0),"
             "p:(scrollY-%d)/%d})})()" % (top, run_px))
    page.wheel(int(run_px * 0.4), pause=0.08)
    t = page.json(TRACK)
    r.ok('mid-scroll the turn is part-played', 0.001 < t['m'] < 0.999, 'm=%.3f' % t['m'])
    r.near('and it sits where the scroll is', t['m'], min(1, max(0, t['p'])), 0.06)

    # A STOP PART-WAY FINISHES IN THE DIRECTION OF TRAVEL, by moving the page, not by a clock of its own.
    r.near('stopping part-way down finishes the turn', page.until_morphed(), 1.0, 0.001)
    page.until_still()
    r.near('and the page glided to the end of the pin', y(), top + run_px, 8)

    page.wheel(-int(run_px * 0.4), pause=0.08)
    t = page.json(TRACK)
    r.ok('scrolling back up reverses it', 0.001 < t['m'] < 0.999, 'm=%.3f' % t['m'])
    r.near('stopping part-way up finishes it back to the faceplate', page.until_morphed(), 0.0, 0.001)
    page.until_still()
    r.near('and the page glided to the top of the pin', y(), top, 8)

    # A GESTURE THAT BEGAN OUTSIDE THE PIN IS NOT CARRIED ON. Coming up out of the section below, momentum that
    # coasts part-way into the turn settles back to the app end it entered by, not on through to the faceplate.
    page.scroll(top + run_px + int(vh * 0.4), pause=0.9)
    page.wheel(-int(vh * 0.4 + run_px * 0.35), pause=0.08)
    r.near('coasting up into the pin settles back to the app', page.until_morphed(), 1.0, 0.001)
    page.until_still()
    r.near('and the page rests on the end it entered by', y(), top + run_px, 8)

    impure = []
    for f in (0.05, 0.3, 0.55, 0.8, 1.0):
        m = at(f)
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

    # Keys are inert while plates are in flight, live at both resting states. Caught inside the stillness
    # window, before the settle glide lands it.
    at(1.0)
    page.click_at('#rpn .rpn-pad [data-key="CA"]')
    at(0.0)
    before = page.js("document.querySelector('#rpn .rpn-in .v').textContent")
    page.scroll(top + int(run_px * 0.5), pause=0.02)
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
