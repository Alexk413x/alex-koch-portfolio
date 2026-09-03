# The home page's intro, end to end: it runs once, every beat ends on its stated gate, it lands on the hero's
# own state, and it leaves nothing behind. The harness marks the intro seen before every navigation, so this
# suite forces it with ?intro and, for the decision itself, registers a second script that unmarks it.
import time

NAME = 'intro'

# The director's HUD names the beat; ?intro&hud puts it up.
BEAT = "(()=>{const h=document.getElementById('intro-hud');return h?h.textContent.split(/\\s+/)[1]:''})()"
LIVE = "document.documentElement.classList.contains('intro-live')"

END = ("(()=>{const h=window.HERO;const b=document.getElementById('hero-core').getBoundingClientRect();"
       "const at=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);"
       "return JSON.stringify({sheet:!!document.getElementById('intro'),live:" + LIVE + ","
       "booting:document.documentElement.classList.contains('booting'),"
       "iframes:document.querySelectorAll('iframe').length,driven:!!(h&&h.driven),ringOn:h?h.state.ringOn:-1,"
       "hex:h?h.state.coreHex:'',heroHex:h?h.heroHex:'',rs:h?h.state.renderScale:-1,dropN:h?h.state.dropN:-1,"
       "y:window.scrollY,seen:sessionStorage.getItem('intro-seen'),at:at?(at.id||at.tagName):''})})()")


def landed(page, r, label):
    """The page after the intro has to be the page a returning visitor gets, key by key."""
    st = page.json(END)
    r.ok(label + ': the sheet is removed from the DOM', not st['sheet'] and not st['live'], str(st))
    r.ok(label + ': the hero is revealed', not st['booting'])
    r.ok(label + ': no frame is left behind', st['iframes'] == 0)
    r.ok(label + ': the core is released', not st['driven'])
    r.check(label + ': ring off', st['ringOn'], 0)
    r.check(label + ': the accent color', st['hex'], st['heroHex'])
    r.check(label + ': render scale', st['rs'], 1)
    r.check(label + ': droplets', st['dropN'], 10)
    r.check(label + ': scroll at the top', st['y'], 0)
    r.check(label + ': marked seen', st['seen'], '1')
    r.ok(label + ': nothing of the intro under the pointer', not str(st['at']).startswith('intro'), st['at'])


def run(page, r):
    # ---- the decision ----
    page.goto('index.html')
    r.ok('a returning visitor never sees it', page.js("!document.getElementById('intro') && !" + LIVE))

    unmark = page.cdp.call('Page.addScriptToEvaluateOnNewDocument',
                           {'source': "try{sessionStorage.removeItem('intro-seen');localStorage.removeItem('intro-seen')}catch(e){}"})
    try:
        page.goto('index.html')
        r.ok('a first visit gets it', page.js(LIVE + " && !!document.getElementById('intro')"))
        # From a different URL each time: index.html to index.html#labs is a same-document hash change, and
        # the head script that decides only runs on a new document.
        page.goto('index.html?nointro')
        r.ok('?nointro skips it', page.js("!" + LIVE))
        page.goto('index.html#labs')
        r.ok('a deep link skips it', page.js("!" + LIVE))
        page.cdp.call('Emulation.setEmulatedMedia',
                      {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]})
        page.goto('index.html')
        r.ok('reduced motion skips it', page.js("!" + LIVE))
    finally:
        page.cdp.call('Emulation.setEmulatedMedia', {'features': []})
        page.cdp.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': unmark['identifier']})

    # ---- the whole sequence ----
    page.goto('index.html?intro&hud')
    r.ok('the sheet is up from the first paint', page.js(LIVE))
    # The ring is written into index.html so it shows before any script runs. ONE copy in spirit: it has to be
    # exactly what the kit would have mounted, or the page and the labs drift apart ring by ring. Read from the
    # page's SOURCE, not the live DOM: with a warm shader cache the tube boots inside settle() and the ring is
    # already gone by the time this runs.
    page.js("window.__ring=undefined;(async()=>{const m=await import('/labs/kit/lab.js');const d=document.createElement('div');"
            "d.className='kit-load';m.mountLoader('Warming up',d);d.querySelector('.kit-load-name').textContent='ALEXK413X';"
            "const src=await (await fetch('/index.html')).text();"
            "const s=new DOMParser().parseFromString(src,'text/html').querySelector('#intro .kit-load');"
            "const norm=(h)=>h.replace(/>\\s+</g,'><').trim();"
            "window.__ring=!!s&&norm(s.innerHTML)===norm(d.innerHTML)})();1")
    r.ok("the page's loading ring is the kit's own markup",
         page.until('window.__ring!==undefined', timeout=5) and page.js('window.__ring===true'))
    r.ok('the hero waits under it', page.js("document.documentElement.classList.contains('booting')"))
    r.ok('the tube boots and types', page.until(BEAT + "==='prompt'", timeout=75, step=0.25))
    r.ok('the hero core is taken for the ring', page.js("HERO.driven && HERO.state.ringOn===1"))
    page.key('Enter', pause=0.3)
    r.ok('Enter leaves the prompt', page.until(BEAT + "!=='prompt' && " + BEAT + "!==''", timeout=3))
    seen = []
    end = time.time() + 90
    while time.time() < end:
        b = page.js(BEAT)
        if b and (not seen or seen[-1] != b):
            seen.append(b)
        if not page.js(LIVE):
            break
        time.sleep(0.2)
    r.ok('it reaches the end', not page.js(LIVE), 'beats ' + ' '.join(seen))
    for want in ('surge', 'off', 'open', 'cruise', 'run', 'stable', 'critical', 'meltdown', 'break', 'stabilize'):
        r.ok('beat ' + want + ' played', want in seen, ' '.join(seen))
    landed(page, r, 'after the run')

    # A real click on the stage still pulses the core, as suite_hero asserts on a plain load.
    page.click_at('#stage')
    pulsed = page.json("(()=>{HERO.renderNow(1/60);return JSON.stringify({p:HERO.sim.step(HERO.state,0,0).pulse})})()")
    r.ok('a click on the stage pulses the core', pulsed['p'] > 0.02, 'pulse %.3f' % pulsed['p'])

    # ---- skip ----
    page.goto('index.html?intro&hud')
    r.ok('the sheet is up again when forced', page.js(LIVE))
    page.until(BEAT + "==='type' || " + BEAT + "==='prompt'", timeout=75, step=0.25)
    page.key('Escape', pause=0.5)
    r.ok('Escape skips it', page.until("!" + LIVE, timeout=5))
    landed(page, r, 'after a skip')

    # ---- forced, with a hash ----
    # A hash alone skips the intro. ?intro overrides that, and the reveal used to put the page on the hero with
    # the address still naming CONTACT, so a reload of a forced URL landed at the top.
    page.goto('index.html?intro#contact')
    page.until(BEAT + "==='type' || " + BEAT + "==='prompt'", timeout=75, step=0.25)
    page.key('Escape', pause=1.5)
    page.until("!" + LIVE, timeout=5)
    at_end = page.js("Math.abs(scrollY-(document.documentElement.scrollHeight-innerHeight))<4")
    r.ok('a forced intro lands on the hash it was opened with', at_end,
         'scrollY %s' % page.js('scrollY'))
    r.ok('and ?intro is gone from the address, so a refresh is an ordinary visit',
         '?intro' not in page.js('location.href') and 'intro=' not in page.js('location.href'),
         page.js('location.href'))

    # ---- replay ----
    # Once per browser: after a play the flag is in localStorage, and only the REPLAY controls bring it back,
    # through a one-shot session flag and a load of the bare path, so the reveal lands on the hero at the top.
    page.goto('index.html')
    r.check('a browser that has seen it is marked for good', page.js("localStorage.getItem('intro-seen')"), '1')
    r.ok('a plain visit after that skips it', page.js("!" + LIVE))
    r.ok('the mark opens its menu',
         page.js("(()=>{document.querySelector('#nav .mark').click();return document.querySelector('#nav .brand-menu').classList.contains('is-open')})()"))
    page.scroll(3000)
    page.js("document.querySelector('#nav .brand-menu [data-replay-intro]').click();1")
    page.settle(1.0)
    r.ok('REPLAY runs it again', page.until(LIVE, timeout=5))
    r.check('from the top', page.js('scrollY'), 0)
    r.ok('with a clean address', page.js("location.search+location.hash") == '', page.js('location.href'))
    r.ok('the labs section carries the same control', page.js("!!document.querySelector('#labs [data-replay-intro]')"))
    page.key('Escape', pause=0.5)
    page.until("!" + LIVE, timeout=5)
