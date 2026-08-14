# Page-level invariants: the things that look right on one screen and break on another.
import urllib.request

NAME = 'layout'

WIDTHS = [1600, 1400, 1280, 1150, 1024, 900, 860]
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
        gap = page.js("(()=>{const c=document.querySelector('.cta').getBoundingClientRect();"
                      "const f=document.querySelector('.hero-foot .inner').getBoundingClientRect();"
                      "return Math.round(f.top-c.bottom)})()")
        r.ok('hero fits on %s' % label, gap > 0, 'gap %dpx' % gap)
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
