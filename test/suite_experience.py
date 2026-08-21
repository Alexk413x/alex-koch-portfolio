# The role viewer, on the page it is parked on.
#
# It used to live in the middle of the home page and these checks lived in suite_layout with it. The markup moved
# to experience.html unchanged and the checks moved with it, so the suite that covers a thing is the suite that
# loads the page it is on -- a check left behind measures whatever happens to be at that selector next.
#
# TEMPORARY, the same way the page is. When the section that replaces the viewer lands on the home page, this
# file goes with experience.html; until then it is the only thing asserting that the full role text still works.
NAME = 'experience'

# One role showing, the strip agreeing with it, and which one it is. Read together in ONE evaluate: the deck
# holds no state of its own, so a second call could land either side of a scroll frame.
SHOWING = ("(()=>{const all=[...document.querySelectorAll('.exp-deck .role')];"
           "const lit=all.filter(e=>+getComputedStyle(e).opacity>0.05);"
           "const here=document.querySelector('.exp-deck .role.here');"
           "return JSON.stringify({lit:lit.length,who:here?here.dataset.label:'',"
           "tab:(document.querySelector('.exp-strip button[aria-selected]')||{}).textContent})})()")


def run(page, r):
    page.goto('experience.html')
    page.viewport(1600, 1000)
    page.settle(0.4)

    # THE PAGE EXISTS AND CARRIES THE FULL TEXT. It is the only place the roles are written out, so an empty deck
    # here is a silent loss of every detail the shelf's summaries are drawn from.
    n = page.js("document.querySelectorAll('.exp-deck .role').length")
    r.ok('the reference page holds every role', n >= 8, '%d roles' % n)
    r.check('and the strip names one per role',
            page.js("document.querySelectorAll('.exp-strip button').length"), n)
    r.ok('the mark leads back to the site',
         page.js("(document.querySelector('#nav .mark')||{}).getAttribute"
                 " ? document.querySelector('#nav .mark').getAttribute('href') : ''") == 'index.html')
    r.ok('no sideways scroll', not page.js('document.documentElement.scrollWidth > innerWidth'))

    # THE ROLES ARE A VIEWER, ONE AT A TIME. The mechanism, not the copy: exactly one role showing at any position
    # in the pin, the strip agreeing with it, and every role reachable -- including the last, which is the one a
    # floor()'d index is most likely to strand.
    # top is MEASURED, not read off offsetTop -- a positioned ancestor makes offsetTop report the distance from
    # that ancestor rather than from the top of the document, and every beat then lands on role one.
    geo = page.json("(()=>{const s=document.getElementById('exp-scroll'),g=document.getElementById('exp-stage');"
                    "return JSON.stringify({top:Math.round(s.getBoundingClientRect().top+scrollY),"
                    "run:s.offsetHeight-g.offsetHeight,"
                    "n:document.querySelectorAll('.exp-deck .role').length})})()")
    r.ok('the viewer is pinned', geo['run'] > 0, 'run %dpx' % geo['run'])

    seen, alone = [], True
    for i in range(geo['n']):
        page.scroll(geo['top'] + round(geo['run'] * ((i + 0.5) / geo['n'])), pause=0.55)
        d = page.json(SHOWING)
        if d['lit'] != 1:
            alone = False
        seen.append((d['who'], d['tab']))
    r.ok('exactly one role is showing at every beat', alone, 'saw %s' % [x for x in seen][:3])
    r.check('every role gets a beat of its own', len(set(w for w, _ in seen)), geo['n'])
    r.ok('and the strip agrees with the deck', all(w == t for w, t in seen),
         ' | '.join('%s/%s' % (w, t) for w, t in seen if w != t)[:80])

    # The strip jumps the PAGE to that role's beat, since the deck holds no state of its own.
    page.click_at('.exp-strip button:nth-child(6)', pause=1.3)
    r.check('a jump shows the role it names', page.json(SHOWING)['who'],
            page.js("document.querySelectorAll('.exp-deck .role')[5].dataset.label"))

    # THE PIN HAS TO SEAT ITS TALLEST ROLE, at every window it still claims to pin at. The content is fixed and
    # the window is not, so this is the invariant the whole design rests on: 730 is one pixel above the height
    # where the section gives up and becomes a stack, and 860 is where the body type steps down to keep it true.
    for w, h in [(1600, 1000), (1440, 860), (1366, 768), (1280, 730), (860, 730)]:
        page.viewport(w, h)
        page.settle(0.5)
        d = page.json("(()=>{const g=document.getElementById('exp-stage');"
                      "const v=document.querySelector('.exp-view').getBoundingClientRect();"
                      "const deck=document.querySelector('.exp-deck').getBoundingClientRect();"
                      "const tall=Math.max(...[...document.querySelectorAll('.exp-deck .role')].map(e=>{"
                      "const p=e.style.position;e.style.position='static';"
                      "const n=e.offsetHeight;e.style.position=p;return n}));"
                      "return JSON.stringify({pinned:getComputedStyle(g).position==='sticky',"
                      "over:Math.round(v.height-g.getBoundingClientRect().height),"
                      "slack:Math.round(deck.height-tall)})})()")
        r.ok('the pin is still a pin at %dx%d' % (w, h), d['pinned'])
        r.ok('and it seats its tallest role at %dx%d' % (w, h), d['over'] <= 0 and d['slack'] >= 0,
             'view over by %dpx, deck slack %dpx' % (d['over'], d['slack']))

    # The strip sits a FIXED distance under the bar at every height. Centring the whole view in the stage made
    # that gap 160px at 1080 and 30px at 820 -- one design that looked like several.
    gaps = []
    for h in (1080, 1000, 900):
        page.viewport(1600, h)
        page.settle(0.4)
        # Re-derived every time: resizing changes the page's height, so a scroll position that was inside the pin
        # at the previous size is not necessarily inside it at this one.
        page.scroll(page.js("Math.round(document.getElementById('exp-scroll')"
                            ".getBoundingClientRect().top+scrollY)+80"), pause=0.4)
        gaps.append(page.js("(()=>{const s=document.querySelector('.exp-strip').getBoundingClientRect();"
                            "const n=document.getElementById('nav').getBoundingClientRect();"
                            "return Math.round(s.top-n.bottom)})()"))
    r.ok('the strip holds one distance under the bar at any height', len(set(gaps)) == 1, str(gaps))

    # THE RUNWAY DOES NOT OUTLAST ITS CONTENT. On the home page the viewer released into the section below it;
    # here it is the last thing on the page, so the equivalent claim is that the pin's final beat IS the bottom.
    # Scrolling that ends on a role nobody can leave is the same fault either way: a page that looks stuck.
    page.viewport(1600, 1000)
    page.settle(0.4)
    geo = page.json("(()=>{const s=document.getElementById('exp-scroll'),g=document.getElementById('exp-stage');"
                    "return JSON.stringify({top:Math.round(s.getBoundingClientRect().top+scrollY),"
                    "run:s.offsetHeight-g.offsetHeight,"
                    "max:Math.round(document.documentElement.scrollHeight-innerHeight)})})()")
    page.scroll(geo['top'] + geo['run'], pause=0.6)
    r.check('the last role is the one at the end of the pin', page.json(SHOWING)['who'],
            page.js("[...document.querySelectorAll('.exp-deck .role')].pop().dataset.label"))
    r.near('and the pin ends where the page does', geo['top'] + geo['run'], geo['max'], 8)

    # AND IT GIVES UP THE PIN ON A PHONE. Pinned at 393px the deck is taller than the stage, the stage clips, and
    # the reader gets a role's first two lines with no way to reach the rest -- a phone on its side passes every
    # width-only test while doing exactly that. Unpinned it is a plain stack, so the check is that every role is
    # on the page at once and none of them is cut off.
    for w, h, label in [(852, 393, 'landscape phone'), (430, 900, 'portrait phone')]:
        page.viewport(w, h, mobile=True, dpr=2)
        page.settle(0.4)
        d = page.json("(()=>{const g=document.getElementById('exp-stage');"
                      "const all=[...document.querySelectorAll('.exp-deck .role')];"
                      "const lit=all.filter(e=>+getComputedStyle(e).opacity>0.05);"
                      "const cut=all.some(e=>e.scrollHeight-e.clientHeight>2);"
                      "return JSON.stringify({sticky:getComputedStyle(g).position==='sticky',"
                      "n:all.length,lit:lit.length,cut:cut})})()")
        r.ok('the role viewer stops pinning on %s' % label, not d['sticky'])
        r.check('and shows every role at once on %s' % label, d['lit'], d['n'])
        r.ok('with none of them clipped on %s' % label, not d['cut'])
    page.reset_viewport()
