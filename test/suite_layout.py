# Page-level invariants: the things that look right on one screen and break on another.
import urllib.request

NAME = 'layout'

# 830 is the last width before the 820px rule hides every link but the external one, so it is where a nav that
# has grown an item too many wraps first. Anything narrower is testing the collapsed nav, not this one.
WIDTHS = [1600, 1400, 1280, 1150, 1024, 900, 860, 830]
SECTIONS = ['cartographer', 'experience', 'labs', 'contact']


def run(page, r):
    page.goto('index.html')

    # The nav must be ONE row at every desktop width. A two-word label without nowrap breaks inside its own box,
    # grows taller than its neighbours, and reads as a two-line nav even though the row never wrapped.
    for w in WIDTHS:
        page.viewport(w, 950)
        d = page.json("(()=>{const l=[...document.querySelectorAll('#nav .links a')];"
                      "const tops=new Set(l.map(a=>Math.round(a.getBoundingClientRect().top)));"
                      "const mark=document.querySelector('#nav .mark').getBoundingClientRect();"
                      "return JSON.stringify({rows:tops.size,"
                      "h:Math.round(document.getElementById('nav').getBoundingClientRect().height),"
                      "gap:Math.round(l[0].getBoundingClientRect().left-mark.right)})})()")
        r.check('nav is one row at %d' % w, d['rows'], 1)
        r.ok('nav stays under 80px at %d' % w, d['h'] <= 80, '%dpx' % d['h'])
        r.ok('nav clears the wordmark at %d' % w, d['gap'] > 0, '%dpx' % d['gap'])

    # Every section shares one left rail. The container rule lived only under #labs and #contact once, so every
    # section written later ran the full viewport width and started 60px further left: a kink on the way down.
    page.viewport(1600, 950)
    rails = page.json('JSON.stringify(%s.map(id=>Math.round('
                      "document.querySelector('#'+id+' .sec-title').getBoundingClientRect().left)))"
                      % str(SECTIONS).replace("'", '"'))
    r.ok('all sections share a left rail', len(set(rails)) == 1, str(dict(zip(SECTIONS, rails))))

    # No horizontal overflow at any of the shapes that matter.
    for w, h, mobile, label in [(1600, 950, False, 'desktop'), (1024, 800, False, 'small laptop'),
                                (852, 393, True, 'landscape phone'), (430, 900, True, 'portrait phone')]:
        page.viewport(w, h, mobile=mobile, dpr=2 if mobile else 1)
        r.ok('no sideways scroll on %s' % label,
             not page.js('document.documentElement.scrollWidth > innerWidth'))

    # The hero has to fit. Narrow and short are different faults: a landscape phone is 852x393, wide enough to
    # pass any width-only test and nowhere near tall enough to seat a lockup sized off the width.
    for w, h, label in [(852, 393, 'landscape phone'), (430, 900, 'portrait phone')]:
        page.viewport(w, h, mobile=True, dpr=2)
        page.scroll(0)
        gap = page.js("(()=>{const c=document.querySelector('.aside').getBoundingClientRect();"
                      "const f=document.querySelector('.hero-foot .inner').getBoundingClientRect();"
                      "return Math.round(f.top-c.bottom)})()")
        r.ok('hero fits on %s' % label, gap > 0, 'gap %dpx' % gap)

        # The aside and the lockup must not INTERSECT, which is the invariant both hero layouts share: beside
        # each other at 852 where three columns still fit, stacked at 430 where they do not. Pinned to
        # grid-column 3 against a single-column template, the aside opens an implicit third column and lands
        # on top of the name instead, and a vertical-only test reads that as correct at one of the two widths.
        hit = page.js("(()=>{const l=document.querySelector('.lockup').getBoundingClientRect();"
                      "const a=document.querySelector('.aside').getBoundingClientRect();"
                      "return !(a.top>=l.bottom||a.bottom<=l.top||a.left>=l.right||a.right<=l.left)})()")
        r.ok('aside never overlaps the lockup on %s' % label, not hit)
    page.reset_viewport()

    # Reduced motion collapses both rigs rather than pinning a scene nothing is driving.
    page.cdp.call('Emulation.setEmulatedMedia',
                  {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]})
    page.settle()
    r.check('hero stage is static under reduced motion',
            page.js("getComputedStyle(document.getElementById('stage')).position"), 'static')
    r.check('morph stage is static under reduced motion',
            page.js("getComputedStyle(document.getElementById('app-stage')).position"), 'static')
    r.check('the live dot stops pulsing',
            page.js("getComputedStyle(document.querySelector('.live-dot'),'::after').animationName"), 'none')
    page.cdp.call('Emulation.setEmulatedMedia', {'features': []})
    page.settle()

    # The lockup must measure the same at a given width however it got there. align() corrects tracking by a
    # DELTA on what it reads, so a pass that measures the previous pass's output compounds: the two lines stay
    # matched to each other while the pair keeps widening. A round trip through 430 grew this 21px, permanently,
    # and the only visible symptom was the hero's ring suddenly crowding the name.
    page.viewport(1600, 1000)
    page.reload()
    before = page.json("JSON.stringify([...document.querySelectorAll('.lockup span')]"
                       '.map(s=>Math.round(s.getBoundingClientRect().right)))')
    for w, h in [(430, 900), (1600, 1000)]:
        page.viewport(w, h)
    page.settle()
    after = page.json("JSON.stringify([...document.querySelectorAll('.lockup span')]"
                      '.map(s=>Math.round(s.getBoundingClientRect().right)))')
    r.check('the lockup survives a resize round trip', after, before)

    # The hero's ring. Two properties of the pair are worth holding, because both were wrong once and only
    # looking at it caught them: the band has to run TRUE VERTICAL where it leaves the top, which means each
    # curve's last control point shares its end point's x, and the two edges have to be exact mirrors about the
    # centre line or the band is a wedge. Read off the path data, since that is where both live.
    halo = page.json("""(()=>{const ps=[...document.querySelectorAll('#hero-halo path')].map(p=>
      p.getAttribute('d').replace(/[A-Za-z,]/g,' ').trim().split(/\\s+/).map(Number));
      const pair=(a,i)=>({x:a[i*2],y:a[i*2+1]});
      const L=ps[0], R=ps[1];
      return JSON.stringify({
        n:ps.length,
        vertical:[L,R].every(a=>pair(a,2).x===pair(a,3).x),
        topped:[L,R].every(a=>pair(a,3).y===0),
        mirrored:[0,1,2,3].every(i=>pair(R,i).x===1000-pair(L,i).x && pair(R,i).y===pair(L,i).y)})})()""")
    r.check('the ring is two curves', halo['n'], 2)
    r.ok('the ring leaves the top vertically', halo['vertical'])
    r.ok('the ring reaches the top of the stage', halo['topped'])
    r.ok('the ring is an exact mirror about the centre', halo['mirrored'])

    # And it has to stay off the name. The curve rises out of the corner the lockup occupies, so a control point
    # nudged for the look of the top can crowd KOCH without anything else changing. Measured as clear air, at the
    # name's own height, against the real rendered curve rather than against the numbers in the path.
    page.viewport(1600, 1000)
    page.scroll(0)
    air = page.js("""(()=>{const k=document.querySelector('.lockup .l2').getBoundingClientRect();
      const p=document.querySelector('#hero-halo path'), L=p.getTotalLength();
      let best=1e9;
      for(let i=0;i<=600;i++){const q=p.getPointAtLength(L*i/600);
        const x=q.x/1000*innerWidth, y=q.y/1000*innerHeight;
        if(y>=k.top && y<=k.bottom) best=Math.min(best, x-k.right);}
      return Math.round(best)})()""")
    r.ok('the ring clears the lockup', air >= 40, '%dpx of clear air' % air)

    # The header's chapter meter. One written property drives five bars and the current item, so the failure
    # worth catching is a section that never lights: with the ranges measured off the wrong elements, or a
    # reading line fixed inside the viewport, the last item can be unreachable at every scroll position there is.
    page.viewport(1600, 1000)
    page.scroll(0)
    # The walk drives the page by scrollTo, and a carry mid-walk would fight it for the scroll position and pin
    # it at a section top -- which reads as the meter failing to reach the last two sections. The carry ignores
    # a programmatic scroll once the reader's last real input is two seconds old, so waiting that out disarms it
    # deterministically rather than relying on each step being quicker than the settle.
    page.quiesce()
    seen, order, last_k = [], True, -1
    maxy = page.js('document.documentElement.scrollHeight - innerHeight')
    for i in range(41):
        page.scroll(round(maxy * i / 40), pause=0.06)
        d = page.json("(()=>{const n=document.getElementById('nav');"
                      "const a=n.querySelector('.links a[aria-current]');"
                      "return JSON.stringify({k:parseFloat(n.style.getPropertyValue('--k')),"
                      "cur:a?a.textContent:''})})()")
        if d['k'] < last_k - 1e-6:
            order = False
        last_k = d['k']
        if d['cur'] and (not seen or seen[-1] != d['cur']):
            seen.append(d['cur'])
    r.check('every nav item lights, in page order', seen,
            ['ALEX', 'CARTOGRAPHER', 'APP', 'EXPERIENCE', 'LABS', 'CONTACT'])
    r.ok('the playhead only ever moves forward', order)

    # ONE bar at every scroll position. A ground or a rule appearing partway down was tried and rejected: the
    # bar is meant to read the same over the document as it does over the stage.
    for y, where in [(0, 'over the stage'), (page.js("document.getElementById('cartographer').offsetTop"),
                                             'over the document')]:
        page.scroll(y)
        cs = page.json("(()=>{const s=getComputedStyle(document.getElementById('nav'));"
                       "return JSON.stringify({border:s.borderBottomWidth,filter:s.backdropFilter})})()")
        r.check('the bar keeps no rule %s' % where, cs['border'], '0px')
        r.ok('the bar keeps no ground %s' % where, cs['filter'] in ('none', ''), cs['filter'])

    # The carry. Crossing a boundary hands the reader to the TOP of the section they landed in; staying inside
    # one must leave the scroll alone, or a scrubbed scene cannot be played with. It answers to input and not to
    # scrollTo, so this arrives by wheel — which is also what keeps it from relocating the page under every
    # other check in this file.
    page.viewport(1600, 1000)
    page.scroll(0, pause=0.4)
    # Read the stop list off the page rather than restating its geometry here. It is derived from the section
    # spans, the morph trigger, the roles and the gap filling, and a copy of that in the tests is a second
    # description that drifts the moment any of them moves.
    stops = page.json('JSON.stringify(window.AKNAV.stops())')
    end = page.js('Math.round(document.documentElement.scrollHeight - innerHeight)')
    r.ok('the page has a stop list', len(stops) > 12, '%d stops' % len(stops))
    r.check('the first stop is the top', stops[0], 0)
    r.check('the last stop is the bottom', stops[-1], end)
    r.ok('no two stops are within a nudge of each other',
         all(b - a > 24 for a, b in zip(stops, stops[1:])))
    r.ok('and none is more than a screen from the last',
         all(b - a <= 1010 for a, b in zip(stops[1:], stops[2:])),
         'widest gap below the hero is %d' % max([b - a for a, b in zip(stops[1:], stops[2:])] or [0]))

    r.ok('a programmatic scroll is not carried', abs(page.js('Math.round(scrollY)')) < 6)

    # THE WHEEL IS THE READER'S. Momentum is allowed to overshoot a boundary -- taking the wheel away to make it
    # exact was tried and reverted, because a page that stops moving while the hand is still moving feels dead.
    # What the carry guarantees is where the reader ENDS UP once the scrolling stops.
    # Resolved through [data-range], not off the section itself. A section inside a pinned stage has no page
    # position of its own -- #cartographer now lives in one, and its own offset is where that stage comes to
    # rest, which is 200px past where the carry correctly puts the reader.
    sections = page.json("(()=>{const y=scrollY;return JSON.stringify(['cartographer','experience','labs']"
                         ".map(i=>{const e=document.getElementById(i);"
                         "return Math.round((e.closest('[data-range]')||e).getBoundingClientRect().top+y)}))})()")
    cart = sections[0]

    page.scroll(cart - 500, pause=0.4)
    page.flick(700, pause=0)
    r.near('a real gesture past a boundary is carried to the section top', page.until_still(), cart, 8)

    # Inside the section it stays theirs: a nudge that crosses nothing must not be undone.
    at = page.js('Math.round(scrollY)')
    page.wheel(200, pause=0)
    after = page.until_still()
    r.ok('scrolling inside a section is left alone', after > at + 100, 'moved from %d to %d' % (at, after))

    # Contact's top is below the furthest the page can scroll, so the clamp parks the last section at the bottom.
    page.scroll(end - 400, pause=0.4)
    page.flick(600, pause=0)
    r.near('the last section rests at the bottom', page.until_still(), end, 8)

    # The arrow keys step the page a whole beat at a time rather than a fixed number of pixels. The stops are
    # built from the same DOM as the section spans, so a press has to land exactly on one.
    page.scroll(0, pause=0.4)
    page.js('document.body.focus();1')
    page.key('ArrowDown', pause=0.05)
    r.near('an arrow press lands on the next stop', page.until_still(), stops[1], 8)
    page.key('ArrowDown', pause=0.05)
    r.near('and the one after that', page.until_still(), stops[2], 8)
    page.key('ArrowUp', pause=0.05)
    r.near('and it steps back the same way', page.until_still(), stops[1], 8)

    # THE HERO RESOLVES TO THE REACTOR ALONE. Its second stop is the point where the words have finished leaving
    # and nothing else is in the frame; the instrument's own exit has not started. Both halves matter: a stop
    # placed where the core had already begun to go would have nothing to hold.
    page.scroll(0, pause=0.4)
    page.key('ArrowDown', pause=0.05)
    page.until_still()
    hero = page.json("(()=>{const s=document.getElementById('stage');"
                     "return JSON.stringify({text:+s.style.getPropertyValue('--o1'),"
                     "cue:+s.style.getPropertyValue('--cue-o'),"
                     "core:+s.style.getPropertyValue('--ring-o'),"
                     "scale:+s.style.getPropertyValue('--core-s')})})()")
    r.near('the words are gone at the reactor stop', hero['text'], 0.0, 0.01)
    r.near('and so is the scroll cue', hero['cue'], 0.0, 0.01)
    r.near('the reactor is still at full', hero['core'], 1.0, 0.01)
    r.near('and has not begun to collapse', hero['scale'], 1.0, 0.01)

    # A step onto it strikes it, the same way a click does. The spring is at rest until something drives it.
    # Relative, not absolute: the spring decays rather than snapping back, so an earlier strike can still be
    # ringing. What has to be true is that the press DROVE it, not that it started at exactly nothing.
    pulse = 'Math.abs(window.HERO.sim.step(window.HERO.state, 0, 0).pulse)'
    page.scroll(0, pause=1.6)
    before = page.js(pulse)
    page.key(' ', pause=0.18)
    after = page.js(pulse)
    r.ok('the space bar strikes the reactor', after > before + 0.25, 'spring %.3f -> %.3f' % (before, after))
    r.near('and steps with it', page.until_still(), stops[1], 400)

    # Every role is its own stop, so the timeline can be walked rather than scrolled past.
    roles = page.js("document.querySelectorAll('#experience .role').length")
    steps = 0
    at = page.js('Math.round(scrollY)')
    while steps < 30:
        page.key('ArrowDown', pause=0.05)
        now = page.until_still()
        steps += 1
        if now == at:
            break
        at = now
    r.ok('the page steps to the bottom in one beat per stop', 12 <= steps <= 24,
         '%d presses for %d roles' % (steps, roles))
    r.near('the last press rests at the bottom', page.until_still(), end, 8)

    # A NAV LINK INTO A PINNED SCENE MUST GO TO ITS RANGE, NOT TO THE ELEMENT. #alex is absolutely positioned
    # inside a sticky stage, so its own page position is where that stage comes to REST -- the far end of the
    # hero's runway, with the words already climbed out. The browser's own jump landed on an empty frame.
    page.scroll(6000, pause=0.4)
    page.click_at('#nav .links a[href="#alex"]', pause=0.05)
    r.near('the ALEX link goes to the top of the page', page.until_still(), 0, 8)
    r.near('and the hero is showing when it lands',
           float(page.js("document.getElementById('stage').style.getPropertyValue('--o1') || '1'")), 1.0, 0.02)

    # Same shape for the calculator: its range's top is the faceplate, its element's is somewhere mid-morph.
    page.scroll(6000, pause=0.4)
    page.click_at('#nav .links a[href="#app"]', pause=0.05)
    page.until_still()
    r.near('the APP link lands on the faceplate', page.until_morphed(), 0.0, 0.001)

    # An arrow inside the calculator belongs to the calculator. The key is left un-prevented there, so the
    # browser's own 40px scroll happens and the page does NOT step -- which is the thing being asserted.
    page.scroll(0, pause=0.4)
    page.js("document.getElementById('rpn').focus();1")
    page.key('ArrowDown', pause=0.05)
    moved = page.until_still()
    r.ok('an arrow in the calculator does not step the page', moved < 200,
         'moved %dpx, a stop is %d' % (moved, stops[1]))

    # The QR dialog has two triggers and one description. share.js binds every [data-qr-open], so a header
    # button that opens nothing means the binding went back to a single id.
    page.scroll(0)
    page.click_at('#nav .tools button', pause=0.5)
    r.ok('the header QR mark opens the one dialog',
         page.js("!document.getElementById('qr-dialog').hidden"))
    page.js("document.getElementById('qr-close').click();1")

    # THE LOOP SCENE IS THE CLAIM, OPERATED. Its whole argument is the contrast: a green run reaches none of the
    # three model stages, and a flagged one wakes two. Both halves are asserted, because a scene that lights
    # everything makes the same picture as one that lights nothing.
    page.viewport(1600, 1000)
    loop_top = page.js("Math.round(document.getElementById('loop-scroll').getBoundingClientRect().top+scrollY)")
    run = page.js("document.getElementById('loop-scroll').offsetHeight"
                  " - document.getElementById('loop-stage').offsetHeight")
    trip = page.js("parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--morph-trip'))")

    LOOP = ("(()=>{const s=[...document.querySelectorAll('#loop .stage')];"
            "return JSON.stringify({run:document.getElementById('loop-run').textContent,"
            "ai:document.getElementById('loop-ai').textContent,"
            "lit:s.map(e=>e.classList.contains('lit')?1:0),"
            "hotModel:s.filter(e=>e.classList.contains('ai')&&e.classList.contains('lit')).length})})()")

    page.scroll(loop_top, pause=1.1)
    d = page.json(LOOP)
    r.check('the loop rests with only the authoring stage lit', sum(d['lit']), 1)

    page.scroll(loop_top + round(run * trip) + 24, pause=1.4)
    d = page.json(LOOP)
    r.check('a green run walks four stages', sum(d['lit']), 4)
    r.check('and reaches no model stage after the first', d['ai'], '0 of 3')
    r.check('the readout says green', d['run'], 'Green')

    page.scroll(loop_top + round(run * trip * 3) + 24, pause=1.6)
    d = page.json(LOOP)
    r.check('a flagged run walks all six', sum(d['lit']), 6)
    r.check('and wakes two model stages', d['ai'], '2 of 3')
    r.check('the readout says flagged', d['run'], 'Flagged')

    # Nine equal blurbs became three clusters. The count matters: the ninth was the claim, and it is the scene now.
    r.check('the capabilities read as three clusters',
            page.js("document.querySelectorAll('#capabilities .cluster').length"), 3)
    r.check('carrying eight between them',
            page.js("document.querySelectorAll('#capabilities .cap').length"), 8)

    # NO EM DASH REACHES A READER. Retired as a rule on 2026-08-14, and the character with it. Read from the
    # rendered text rather than the source, so entities and literals are the same thing and code comments -- which
    # are explicitly out of scope -- cannot register. En dashes stay: they are ranges, which is what they are for.
    dashes = page.json("JSON.stringify((document.body.innerText.match(/[^.]{0,44}\\u2014[^.]{0,44}/g)||[]))")
    r.ok('no em dash reaches a reader', not dashes, ' | '.join(dashes[:3]))
    r.ok('and the ranges kept their en dashes',
         page.js("(document.body.innerText.match(/\\u2013/g)||[]).length") >= 15,
         '%d en dashes' % page.js("(document.body.innerText.match(/\\u2013/g)||[]).length"))

    # Every internal link resolves to something actually on disk.
    hrefs = page.json("JSON.stringify([...new Set([...document.querySelectorAll('a[href]')]"
                      '.map(a=>a.getAttribute("href"))'
                      '.filter(h=>h && !/^(https?:|mailto:|#)/.test(h)))])')
    for href in hrefs:
        url = 'http://127.0.0.1:%d/%s' % (page.port, href.split('#')[0])
        try:
            code = urllib.request.urlopen(url, timeout=5).getcode()
        except Exception as exc:
            code = getattr(exc, 'code', 0)
        r.check('internal link resolves: %s' % href, code, 200)
