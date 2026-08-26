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
    # grows taller than its neighbors, and reads as a two-line nav even though the row never wrapped.
    # The clearance is measured off the LEFT ZONE's right edge, not the mark's: the zone holds the mark and
    # whatever is parked beside it, and it is the zone that can collide with the center links.
    for w in WIDTHS:
        page.viewport(w, 950)
        d = page.json("(()=>{const l=[...document.querySelectorAll('#nav .links a')];"
                      "const tops=new Set(l.map(a=>Math.round(a.getBoundingClientRect().top)));"
                      "const brand=document.querySelector('#nav .brand').getBoundingClientRect();"
                      "return JSON.stringify({rows:tops.size,"
                      "h:Math.round(document.getElementById('nav').getBoundingClientRect().height),"
                      "gap:Math.round(l[0].getBoundingClientRect().left-brand.right)})})()")
        r.check('nav is one row at %d' % w, d['rows'], 1)
        r.ok('nav stays under 80px at %d' % w, d['h'] <= 80, '%dpx' % d['h'])
        r.ok('nav clears the wordmark at %d' % w, d['gap'] > 0, '%dpx' % d['gap'])

    # Every section shares one left rail. The container rule lived only under #labs and #contact once, so every
    # section written later ran the full viewport width and started 60px further left: a kink on the way down.
    # THE SECTION'S VISIBLE HEADING, whichever element carries it. #experience authors its records under a
    # .sec-title that catalog.js hides once it has built the rack, and a hidden element measures 0 on every
    # axis -- which read as the rail breaking when it had not moved at all.
    page.viewport(1600, 950)
    rails = page.json('JSON.stringify(%s.map(id=>{'
                      "const h=[...document.querySelectorAll('#'+id+' h2')]"
                      '.find(n=>n.getBoundingClientRect().height>0);'
                      'return h?Math.round(h.getBoundingClientRect().left):-1;}))'
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
    # center line or the band is a wedge. Read off the path data, since that is where both live.
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
    r.ok('the ring is an exact mirror about the center', halo['mirrored'])

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
    # The walk samples every 300px and CONTACT is current for only the last 272 of a 12,000px page -- it sits
    # 648px BELOW the furthest the page can scroll, so its window is narrower than one sample. The order the
    # walk sees is asserted as a prefix; whether the last item is reachable at all is its own check below,
    # taken where it actually happens rather than hoped for in a sweep.
    # The expected order is READ OFF THE NAV, not written down here: this check is about the playhead lighting
    # sections in page order, and a copy of the labels would fail the next time one is renamed while testing
    # nothing the nav does not already say.
    labels = page.json("JSON.stringify([...document.querySelectorAll('#nav .links a')].map(a=>a.textContent))")
    r.check('the nav lights in page order on the way down', seen, labels[:len(seen)])
    r.ok('and it reaches the second to last of them', len(seen) >= 5, ' -> '.join(seen))
    r.ok('the playhead only ever moves forward', order)

    # The last section is the one a fixed reading line could never reach, which is why the line slides to 92%.
    page.scroll(maxy, pause=0.5)
    r.check('the last section lights at the bottom of the page',
            page.js("(document.querySelector('#nav .links a[aria-current]')||{}).textContent"), 'CONTACT')

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
    # A LOWER BOUND, not a count. It was 12 while the ten roles were each a stop and they now live on their
    # own page, so the number this guards against is a list that failed to build at all: the five beats, a stop
    # per section, and the bottom.
    r.ok('the page has a stop list', len(stops) >= 8, '%d stops' % len(stops))
    r.check('the first stop is the top', stops[0], 0)
    r.check('the last stop is the bottom', stops[-1], end)
    r.ok('no two stops are within a nudge of each other',
         all(b - a > 24 for a, b in zip(stops, stops[1:])))
    # A gap wider than a screen is allowed in exactly one place: beginning inside a pinned scene, where it is the
    # scene LEAVING and holds nothing a reader could be stranded short of. Anywhere else it steps over content
    # that can never be reached, which is the whole reason nav.js fills gaps at all.
    # A screen plus a nudge, not a screen: a section whose height IS one viewport rounds to a gap of screen + 1.
    ranges = page.json("JSON.stringify([...document.querySelectorAll('[data-range]')].map(e=>{"
                       "const t=e.getBoundingClientRect().top+scrollY;"
                       "return [Math.round(t), Math.round(t+e.offsetHeight)]}))")
    wide = [(a, b) for a, b in zip(stops, stops[1:]) if b - a > 1024]
    stray = [g for g in wide if not any(lo <= g[0] < hi for lo, hi in ranges)]
    r.ok('and every gap wider than a screen is a scene leaving', not stray,
         'gaps starting outside any scene: %s' % stray)

    # THE RAIL, AND WHAT IS OUTSIDE IT.
    #
    # Five positions on this page are worth resting on -- the hero with its words up, the reactor holding the
    # frame alone once they have left, Cartographer with its graph whole, and the calculator at each end of its
    # pin -- and everything between them is an envelope playing. A gesture that comes to rest between two beats
    # is carried onto one; a gesture that stops anywhere else is left exactly where it stopped.
    #
    # That second half is not a detail. Four carries covering the WHOLE page were built and removed before this
    # was settled -- on a boundary crossing, past the end of a pin, onto the beat a gesture reached, and one beat
    # per push -- and every one of them felt the same from the seat: you stop, the page sits, and then it takes
    # over. What is different here is that the rail covers named positions and then releases, so a reader below
    # it keeps their own scroll.
    #
    # The beats are read off the rig rather than restated, for the reason every measurement in these suites is:
    # a fraction copied in here goes silently wrong the first time an envelope moves.
    M = "document.getElementById('app-stage').style.getPropertyValue('--m')"
    beats = page.json('JSON.stringify(AKSCENE.beats())')
    vh = page.js('innerHeight')
    # The count is asserted against the rail's own table rather than a number written here: beats are added and
    # stood down as sections change shape, and a literal would fail the next such change while testing nothing
    # the rig does not already say. What matters is that every LIVE beat is a real position, in order.
    r.ok('the rig reports at least the four scene beats', len(beats) >= 4, str(beats))
    r.ok('and they are in page order', all(a < b for a, b in zip(beats, beats[1:])), str(beats))
    r.check('the first beat is the top of the page', beats[0], 0)
    r.ok('and every beat is also an arrow stop',
         all(any(abs(b - s) <= 8 for s in stops) for b in beats), '%s against %s' % (beats, stops[:6]))
    # Nothing wider than the rail's reach, or a carry becomes a haul across a screen of unread content rather
    # than the finish of a hand-off. The rig refuses those gaps; this is the check that the page has none.
    gaps = [b - a for a, b in zip(beats, beats[1:])]
    r.ok('and no two beats are more than a screen and a quarter apart',
         all(g <= vh * 1.25 for g in gaps), '%s against a %dpx viewport' % (gaps, vh))

    # A flick that stops short of a beat is carried onto it: the hero's exit is FINISHED for the reader rather
    # than left with the lockup half faded off the top.
    page.scroll(0, pause=0.6)
    page.flick(300, pause=0.4)
    r.near('a flick off the hero lands on the reactor', page.until_still(quiet=0.5), beats[1], 8)

    # And one that commits carries the whole way to the next beat, striking the reactor on the way past.
    page.scroll(beats[1], pause=0.9)
    page.flick(900, pause=0.4)
    r.near('and a flick off the reactor lands on Cartographer', page.until_still(quiet=0.5), beats[2], 8)

    # A NUDGE IS A NUDGE, and on the rail that means it is UNDONE rather than kept: under a third of the way to
    # the next beat is not a decision to leave, so the reader is put back on the one they were on.
    page.scroll(beats[1], pause=0.9)
    page.wheel(200, pause=0)
    r.near('a nudge off a beat is put back on it', page.until_still(quiet=0.5), beats[1], 8)

    # UPWARD IS THE SAME LIST, BACKWARDS. Going back, the checkpoint is the beat behind rather than wherever the
    # gesture happened to run out.
    page.scroll(beats[2], pause=0.9)
    page.flick(-900, pause=0.4)
    r.near('and it walks back up the same beats', page.until_still(quiet=0.5), beats[1], 8)
    page.flick(-900, pause=0.4)
    r.near('all the way to the hero', page.until_still(quiet=0.5), beats[0], 8)

    # THE CALCULATOR IS ITS PIN'S TWO ENDS, and both of them are PURE states of the morph: the faceplate the
    # section arrives at, and the shipped app it leaves as. Nothing between them is a place to be -- the
    # mechanism is either still or in flight -- so the rail stops on both, from both directions, and the turn
    # happens on the way between. A reader could be left mid-morph before this, with half a keypad in each
    # keyboard, which is the one frame of that scene nobody chose to look at.
    page.scroll(beats[2], pause=0.9)
    page.flick(900, pause=0.4)
    r.near('a flick off Cartographer lands on the faceplate', page.until_still(quiet=0.5), beats[3], 8)
    r.near('and the faceplate beat is a pure state', page.until_morphed(), 0.0, 0.001)

    page.flick(500, pause=0.4)
    r.near('a flick off the faceplate lands on the app', page.until_still(quiet=0.5), beats[4], 8)
    r.near('and the app beat is the other pure state', page.until_morphed(), 1.0, 0.001)

    # Under a third of the way down the pin is not a decision to turn it, so the reader is put back AND the
    # calculator is still the faceplate. Both halves: the rail's threshold sits below the morph's trigger by
    # design, so a gesture the rail is about to undo can never have committed the mechanism.
    page.scroll(beats[3], pause=0.9)
    page.wheel(160, pause=0)
    r.near('a nudge inside the pin is put back on the faceplate', page.until_still(quiet=0.5), beats[3], 8)
    r.near('and the calculator never started turning', page.until_morphed(), 0.0, 0.001)

    # ...and it plays backwards the same way, which is the half that used to have nowhere to land.
    page.scroll(beats[4], pause=0.9)
    page.flick(-500, pause=0.4)
    r.near('back up from the app lands on the faceplate', page.until_still(quiet=0.5), beats[3], 8)
    r.near('and the calculator turned back', page.until_morphed(), 0.0, 0.001)

    # LEAVING IS FREE, and this is the check that caught the worst version of it. `scroll-snap-stop: always`
    # under the reader does not merely refuse to carry them PAST a beat, it refuses to let them OFF it: Chrome
    # answers each event of a trackpad's decaying stream as its own gesture and pulls every tick straight back
    # onto the target. Measured before the fix, a 900px flick off the reactor moved 48px and returned, every time.
    # TAKEN ON THE LAST BEAT THAT HAS PAGE UNDER IT, which is no longer the last beat at all: contact is a screen
    # of its own ending where the document does, so its beat sits exactly at the maximum scroll and there is
    # nowhere below it to leave TO. The fault this catches is a beat that will not release, and that can only be
    # observed where releasing is possible.
    r.near('the rail reaches the foot of the page', beats[-1], end, 8)
    page.scroll(beats[-2], pause=0.9)
    page.flick(1400, pause=0.4)
    left = page.until_still(quiet=0.5)
    r.ok('a decisive gesture leaves a beat', left > beats[-2] + 600,
         'landed %d, beat %d' % (left, beats[-2]))

    # AT THE FOOT, EVERY GESTURE RESTS AT THE FOOT. The rail now covers the page to its end, so the old
    # "past the release the scroll position is the scroll position" cannot be sampled -- there is no past. The
    # equivalent fault is the bottom oscillating: a flick into the clamp that bounces, or a nudge that walks.
    # Asserted at four strengths because a gentle flick and a hard one must settle identically.
    for strength in (300, 700, 1400, 2600):
        page.scroll(end - 300, pause=0.4)
        page.flick(strength, pause=0.5)
        r.near('a flick of %d into the foot rests there' % strength,
               page.until_still(quiet=0.5), end, 8)

    page.scroll(end, pause=0.4)
    page.wheel(200, pause=0)
    r.near('a nudge at the foot does not move the page', page.until_still(quiet=0.5), end, 8)

    # Contact's top is below the furthest the page can scroll, so the clamp parks the last section at the bottom.
    # A generous flick, so the clamp at the bottom is certain rather than a question of how much of the gesture
    # the browser delivered.
    page.scroll(end - 400, pause=0.4)
    page.flick(1400, pause=0)
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

    # A STEP IS PLAYED, NOT JUMPED, and it was neither for a while. Scroll snapping grabs PROGRAMMATIC scrolls
    # too, so a glide crossing a beat was yanked onto it rather than eased onto it: measured, 742px covered
    # between 160ms and 485ms of a 1.4-second travel, which reads as a teleport with a stutter at each end.
    # The duration is not observable from here and the position is -- so this samples a quarter of a second in
    # and asks to find the page somewhere in between rather than already arrived.
    page.scroll(0, pause=1.2)
    page.key('ArrowDown', pause=0.25)
    part = page.js('Math.round(scrollY)')
    r.ok('and it glides there rather than jumping', 0 < part < stops[1] - 40,
         'at %d of %d a quarter of a second in' % (part, stops[1]))
    r.near('...and still lands on the stop', page.until_still(), stops[1], 8)

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
    # POLLED, not sampled at a moment. The pulse is a spring: it is kicked, swings, and decays, so reading it a
    # fixed fraction of a second after the press catches it wherever it happens to be in that swing -- 0.79 once
    # and 0.19 the next run, for the same working strike.
    pulse = 'Math.abs(window.HERO.sim.step(window.HERO.state, 0, 0).pulse)'
    page.scroll(0, pause=1.6)
    r.ok('the reactor is near rest before the press', page.js(pulse) < 0.15, '%.3f' % page.js(pulse))
    page.key(' ', pause=0.02)
    r.ok('the space bar strikes the reactor', page.until('(%s) > 0.3' % pulse, timeout=1.5),
         'peak %.3f' % page.js(pulse))
    r.near('and steps with it', page.until_still(), stops[1], 400)

    # THE ARROWS REACH THE BOTTOM, one beat per press. A stop that cannot be left is invisible until the list is
    # walked end to end, which is what this does. The bound is the stop list's own LENGTH rather than a number:
    # it was 12-24 while the ten roles were each a stop, and they now live on their own page.
    steps = 0
    at = page.js('Math.round(scrollY)')
    while steps < len(stops) + 4:
        page.key('ArrowDown', pause=0.05)
        now = page.until_still()
        steps += 1
        if now == at:
            break
        at = now
    r.ok('the page steps to the bottom in one beat per stop', steps <= len(stops),
         '%d presses for %d stops' % (steps, len(stops)))
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
    # The overlay is its own close control; share.js binds the click to the dialog, not to a button.
    page.js("document.getElementById('qr-dialog').click();1")

    # Cartographer ARRIVES and then holds still. Two separate claims, and both have been broken here before:
    # the section is scrubbed in across the viewport it rises through, and once it is seated NOTHING inside it is
    # dimmed or waiting on a further scroll. The progressive light-up this used to assert is gone -- evidence a
    # reader has to scroll through before they can read it is not evidence.
    # quiesce first: the QR check above clicks with a real mouse, and the carry answers real input for two
    # seconds afterwards, which would move the page out from under every position read below.
    page.quiesce()
    page.viewport(1600, 1000)
    loop_top = page.js("Math.round(document.getElementById('loop-scroll').getBoundingClientRect().top+scrollY)")
    vh = page.js('innerHeight')

    # NOTHING STOPS IN THE HAND-OFF. The section is exactly one viewport tall, so its top and the calculator's
    # round to a gap of screen + 1 -- and a gap-filling stop dropped in there lands the reader on the bottom half
    # of this section and the top of the calculator, seating neither. It shipped that way once.
    app_top = page.js("Math.round(document.getElementById('app-scroll').getBoundingClientRect().top+scrollY)")
    all_stops = page.json('JSON.stringify(window.AKNAV.stops())')
    between = [s for s in all_stops if loop_top < s < app_top]
    r.ok('no stop lands between the section and the calculator', not between, 'stops at %s' % between)

    # THE CALCULATOR IS THREE PRESSES: one seats it, one commits the morph, and the third leaves. A fourth was
    # landing 890px into the section's exit, showing the same played-out calculator the press before it did.
    exp_top = page.js("Math.round(document.getElementById('experience').getBoundingClientRect().top+scrollY)")
    inside = [s for s in all_stops if app_top <= s < exp_top]
    r.check('the calculator is two stops, not three', len(inside), 2)
    r.check('the first of them seats it', inside[0] if inside else -1, app_top)
    nxt = [s for s in all_stops if s >= exp_top]
    r.check('and the press after the morph leaves the section', nxt[0] if nxt else -1, exp_top)
    ARRIVAL = ("(()=>{const s=getComputedStyle(document.getElementById('cartographer'));"
               "return JSON.stringify({o:parseFloat(s.opacity),t:s.transform})})()")

    page.scroll(loop_top - vh, pause=0.4)
    start = page.json(ARRIVAL)
    r.ok('the section is still arriving where it first shows', start['o'] < 0.1,
         'opacity %.3f at the foot of the screen' % start['o'])

    page.scroll(loop_top, pause=0.4)
    seated = page.json(ARRIVAL)
    r.check('and it is seated at full strength', round(seated['o'], 3), 1.0)
    r.ok('with no offset left on it', seated['t'] in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), seated['t'])

    faint = page.js("[...document.querySelectorAll('#cartographer .checks li')]"
                    ".filter(e=>parseFloat(getComputedStyle(e).opacity)<0.99).length")
    total = page.js("document.querySelectorAll('#cartographer .checks li').length")
    r.ok('every check is legible once it is', total > 0 and faint == 0,
         '%d of %d under full opacity' % (faint, total))

    # It fits the one screen the stage clips it to. Overflowing the pin is how a section loses its own CTA.
    over = page.js("(()=>{const s=document.getElementById('cartographer');"
                   "return Math.max(0, Math.round(s.getBoundingClientRect().height - innerHeight))})()")
    r.ok('and the section fits the screen it is given', over == 0, '%dpx over' % over)

    # THE LOADING RING GETS OUT OF THE WAY. It is a full-screen overlay, so the failure that matters is not
    # whether it appears but whether it LEAVES -- one left at opacity zero is an invisible sheet across the whole
    # instrument that quietly eats every click. Removed from the DOM, not merely faded.
    for path, tint in [('labs/reactor/Reactor.html', 'rgb(143, 255, 106)'),
                       ('labs/wormhole/Wormhole.html', 'rgb(255, 180, 84)')]:
        page.goto(path)
        page.settle(1.6)
        r.ok('the ring is gone once %s is running' % path.split('/')[1],
             page.js("document.querySelectorAll('.kit-load').length") == 0)

    # And it wears its own lab's color, because it reads --panel-accent rather than carrying one of its own.
    page.cdp.call('Page.navigate', {'url': 'http://127.0.0.1:%d/labs/reactor/Reactor.html' % page.port})
    lit = page.until("document.querySelector('.kit-load .kr-dash circle')", timeout=3)
    if lit:
        r.check('and takes the lab it belongs to for its color',
                page.js("getComputedStyle(document.querySelector('.kit-load .kr-dash circle')).stroke"),
                'rgb(143, 255, 106)')
    else:
        r.skip('and takes the lab it belongs to for its color', 'the lab came up before it could be sampled')
    page.goto('index.html')

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
