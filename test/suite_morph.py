# The calculator morph: that it turns on a timer, that the page is never held by it, and the two states it has to
# actually rest in.
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

M = "+(document.getElementById('app-stage').style.getPropertyValue('--m') || 0)"
IN_V = "document.querySelector('#rpn .rpn-in .v').textContent"


def run(page, r):
    page.goto('index.html')
    top = page.js("Math.round(document.getElementById('app-scroll').getBoundingClientRect().top+scrollY)")
    vh = page.js('innerHeight')

    # ONE SCREEN. The calculator used to be a pinned scene with a scroll runway; it is a plain section now.
    height = page.js("document.getElementById('app-scroll').offsetHeight")
    r.near('the section is one screen tall', height, vh, 4)
    r.check('and nothing in it is sticky', page.js("getComputedStyle(document.getElementById('app-stage')).position"), 'relative')

    # IT TURNS BY ITSELF, from the faceplate to the app and back, with no scrolling to drive it.
    page.scroll(top, pause=0.5)
    r.ok('it starts on the faceplate', page.js(M) < 0.04, 'm=%s' % page.js(M))
    r.ok('and turns to the app on its own', page.until('(%s) > 0.96' % M, timeout=9.0))
    r.ok('and back to the faceplate', page.until('(%s) < 0.04' % M, timeout=9.0))

    # A LEFT OR RIGHT ARROW, OR A SIDEWAYS SWIPE, TURNS IT NOW rather than after the rest.
    page.reload()
    page.scroll(top, pause=0.5)
    page.key('ArrowRight', pause=0.2)
    r.ok('an arrow key turns it at once', page.until('(%s) > 0.96' % M, timeout=2.6))
    SWIPE = ("(()=>{const s=document.getElementById('app-stage'),b=s.getBoundingClientRect();"
             "const ev=(t,x)=>s.dispatchEvent(new PointerEvent(t,{pointerId:5,pointerType:'touch',clientX:x,clientY:b.top+b.height/2,bubbles:true}));"
             "ev('pointerdown',b.left+b.width/2);ev('pointerup',b.left+b.width/2-90);return 1})()")
    page.js(SWIPE)
    r.ok('a swipe turns it back at once', page.until('(%s) < 0.04' % M, timeout=2.6))

    # IT DOES NOT TURN WHILE A POINTER IS OVER IT: a reader at the keypad is not turned out from under their hand.
    page.reload()
    page.scroll(top, pause=0.5)
    page.js("document.getElementById('rpn').dispatchEvent(new PointerEvent('pointerenter'));1")
    time.sleep(7.0)
    r.ok('it holds while the pointer is over it', page.js(M) < 0.04, 'm=%s' % page.js(M))
    page.js("document.getElementById('rpn').dispatchEvent(new PointerEvent('pointerleave'));1")
    r.ok('and turns again once the pointer leaves', page.until('(%s) > 0.96' % M, timeout=10.0))

    # IT DOES NOT TURN OFF SCREEN: nothing runs where nobody can see it.
    page.reload()
    page.scroll(0, pause=0.5)
    time.sleep(7.0)
    r.ok('it holds while the section is off screen', page.js(M) < 0.04, 'm=%s' % page.js(M))

    # NO KEY MAY BE MID-FLIGHT AT REST. This is the failure that shipped once.
    page.scroll(top, pause=0.4)
    page.js('AKSCENE.morphSet(0);1')
    time.sleep(0.3)
    face = page.json(GRID)
    r.check('faceplate shows all 39 keys', face['visible'], 39)
    r.check('faceplate keys do not overlap', face['overlaps'], 0)
    r.check('faceplate is 10 columns', face['cols'], 10)
    r.check('faceplate is 4 rows', face['rows'], 4)

    page.js('AKSCENE.morphSet(1);1')
    time.sleep(0.3)
    app = page.json(GRID)
    r.check('app shows all 28 keys', app['visible'], 28)
    r.check('app keys do not overlap', app['overlaps'], 0)
    r.check('app is 4 columns', app['cols'], 4)
    r.check('app is 7 rows', app['rows'], 7)

    # Keys are inert while plates are in flight, live at both resting states.
    page.click_at('#rpn .rpn-pad [data-key="CA"]')
    page.js('AKSCENE.morphSet(0);1')
    time.sleep(0.3)
    before = page.js(IN_V)
    page.js('AKSCENE.morphSet(0.5);1')
    time.sleep(0.2)
    page.click_at('#rpn .rpn-pad [data-key="7"]')
    r.check('a key mid-morph does nothing', page.js(IN_V), before)

    page.js('AKSCENE.morphSet(1);1')
    time.sleep(0.3)
    page.click_at('#rpn .rpn-pad [data-key="7"]')
    r.check('the app keypad is live at rest', page.js(IN_V), '7')

    # The faceplate is a working calculator too, reached by a real click through the 3D transform. Cleared from
    # the app state first: the faceplate has no CA, and the app's is hidden while the faceplate is showing.
    page.click_at('#rpn .rpn-pad [data-key="CA"]')
    page.js('AKSCENE.morphSet(0);1')
    time.sleep(0.3)
    for key in ('9', '√x'):
        page.click_at('#rpn .rpn-pad [data-key="%s"]' % key)
    r.check('the faceplate is live at rest: 9 then sqrt', page.js(IN_V), '3')

    # ON A PHONE THE SECTION DOES NOT CHANGE HEIGHT AS IT TURNS, or everything below it would be pushed down the page
    # and back every few seconds.
    page.viewport(393, 852, mobile=True, dpr=2)
    page.js('window.dispatchEvent(new Event("resize"));1')
    time.sleep(0.5)
    HEIGHT = "document.getElementById('app-scroll').offsetHeight"
    page.js('AKSCENE.morphSet(0);1')
    time.sleep(0.2)
    face_h = page.js(HEIGHT)
    page.js('AKSCENE.morphSet(1);1')
    time.sleep(0.2)
    r.check('the phone section is the same height at both states', page.js(HEIGHT), face_h)
    page.reset_viewport()

    # A short viewport gets the finished calculator as a plain block, never a scene it cannot hold.
    page.viewport(852, 393, mobile=True, dpr=2)
    page.js('window.dispatchEvent(new Event("resize"));1')
    r.check('short viewport does not pin', page.js("getComputedStyle(document.getElementById('app-stage')).position"), 'static')
    r.ok('short viewport shows the shipped state',
         page.js("document.getElementById('app-stage').classList.contains('is-new')"))
    page.reset_viewport()
