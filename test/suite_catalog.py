# The back catalog: that every record in the markup reaches the rack, and that the rack, the company bar and
# the display case all agree about which product is showing.
#
# THE MARKUP IS THE SOURCE, so every check compares the built rack against the records written out in index.html
# rather than against a list of its own. A list here would be an eighteenth copy of the catalog, and it would
# pass while the page showed something else.
#
# Nothing reaches into catalog.js's internals: the contract is the DOM it builds -- aria-selected on the picked
# box, the flip button's own label, the cover art each box carries -- which is also what a screen reader gets.
NAME = 'catalog'

PICKED = "document.querySelector('#reel .box[aria-selected=\"true\"]')"
AT = ("[...document.querySelectorAll('#reel .box')]"
      ".findIndex(b=>b.getAttribute('aria-selected')==='true')")


def _at(page):
    return page.js(AT)


def _label(page):
    return page.js("(%s||{getAttribute:()=>''}).getAttribute('aria-label')" % PICKED) or ''


def _flipped(page):
    return page.js("(document.getElementById('case')||{classList:{contains:()=>false}})"
                   ".classList.contains('flipped')")


def _flip_label(page):
    return (page.js("(document.querySelector('#flip span')||{}).textContent||''") or '').strip().lower()


def _open_section(page):
    """The rack is a full-height beat, so put it on screen, let it build, and let it take the keyboard."""
    page.goto('index.html')
    page.until('!!document.getElementById("experience")', timeout=8.0)
    page.js("document.getElementById('experience').scrollIntoView();1")
    page.settle(0.6)
    # The rack builds from the markup on arrival; every check below assumes it is up.
    page.until('(%s) >= 0 && !!document.getElementById("case")' % AT, timeout=8.0)
    # And catalog.js only answers the arrow keys while its own section is the one on screen.
    page.until('!!(window.AKCAT && window.AKCAT.sideways && window.AKCAT.sideways())', timeout=4.0)


def _step(page, key, want, r, label, timeout=3.0):
    """Presses an arrow and waits for the rack to land on `want` rather than for a fixed duration."""
    if not page.js('!!(window.AKCAT && window.AKCAT.sideways && window.AKCAT.sideways())'):
        r.skip(label, 'the rack is not the section on screen, so it does not own the arrows')
        return
    page.key(key, pause=0.05)
    landed = page.until('(%s) === %d' % (AT, want), timeout=timeout)
    r.ok(label, landed, 'wanted index %d, sat at %s' % (want, _at(page)))


def run(page, r):
    # Cleared on the way IN as well as out: this suite emulates reduced motion below, and a crash between the
    # two would otherwise leave the emulation set for whichever suite runs next.
    page.cdp.call('Emulation.setEmulatedMedia', {'features': []})
    _open_section(page)

    # ---- every record reaches the rack ----

    built = page.json(
        "JSON.stringify({"
        "  rack:   [...document.querySelectorAll('#reel .box')].map(b=>b.dataset.id),"
        "  proofs: [...document.querySelectorAll('.bay .proof')].map(p=>p.id),"
        "  spines: [...document.querySelectorAll('.shelf .spine-face')]"
        "            .map(b=>b.getAttribute('aria-controls')),"
        "  covers: document.querySelectorAll('#reel .box .cover-art').length,"
        "  blank:  [...document.querySelectorAll('#reel .box .cover-art')]"
        "            .filter(s=>s.querySelectorAll('*').length < 2).length,"
        "  titled: [...document.querySelectorAll('#reel .box')]"
        "            .filter(b=>(b.getAttribute('aria-label')||'').includes(', ')).length"
        "})")

    r.check('every proof in the markup is a box', len(built['rack']), len(built['proofs']))
    r.check('and the shelf names the same set', sorted(built['spines']), sorted(built['proofs']))
    r.check('the rack is in the markup order', built['rack'], built['proofs'])
    r.check('every box carries cover art', built['covers'], len(built['proofs']))
    r.check('and none of it is a blank frame', built['blank'], 0)
    r.check('every box names its product and employer', built['titled'], len(built['proofs']))

    # A heading that disagrees with the rack is exactly the drift this suite exists to catch.
    heading = (page.js("(document.querySelector('.cat-left .sec-title')||{}).textContent||''") or '').upper()
    r.ok('the heading counts what is actually there',
         'SEVENTEEN' in heading or str(len(built['rack'])) in heading,
         '%r for %d products' % (heading.strip(), len(built['rack'])))

    # ---- the rack answers the arrow keys ----

    start = _at(page)
    r.ok('a box is picked on arrival', start >= 0)
    _step(page, 'ArrowRight', start + 1, r, 'right steps one box on')
    _step(page, 'ArrowLeft', start, r, 'and left steps back')

    # ---- the company bar is navigation, and every employer is on it ----

    firms = page.json(
        "JSON.stringify({"
        "  chips: [...document.querySelectorAll('#firms button')].map(b=>b.textContent.trim()),"
        "  employers: [...new Set([...document.querySelectorAll('.bay .proof-at h4')]"
        "               .map(h=>h.textContent.trim()))]"
        "})")
    r.check('every employer has a chip', len(firms['chips']), len(firms['employers']))

    if len(firms['chips']) > 2:
        page.js("document.querySelectorAll('#firms button')[2].click();1")
        page.until_still()
        chip = firms['chips'][2].split('·')[0].strip()
        # Compared on the first word, because a chip is the employer and the box's label is "product, employer".
        head = chip.replace('!', '').split()[0][:5].lower()
        r.ok('a company chip jumps the rack to that company', head in _label(page).lower(),
             'chip %r landed on %r' % (chip, _label(page)))

    # ---- the case turns over, and its button says which way it is facing ----
    #
    # NOTHING HERE ASSERTS WHICH FACE IS OUT. A new cover turns itself over on a timer, so the case's absolute
    # state is a function of when you looked; what is a contract is that a press TOGGLES it, and that the button's
    # accessible name follows the face rather than being written once.
    for press in (1, 2):
        was = _flipped(page)
        page.js("document.getElementById('flip').click();1")
        turned = page.until('document.getElementById("case").classList.contains("flipped") === %s'
                            % ('false' if was else 'true'))
        r.ok('press %d turns the case over' % press, turned,
             'still %s after the press' % ('flipped' if was else 'front'))
        r.check('and the button names the face now showing', _flip_label(page),
                'front' if _flipped(page) else 'turn it over')

    # ---- the section keeps its promises to the page ----

    r.check('the built rack hides the written-out shelf',
            page.js("document.getElementById('experience').classList.contains('js-cat')"), True)

    # ---- reduced motion lands the tween rather than running it ----
    #
    # The rack's glide and the case's swing are hand-written, so the media query cannot reach them and
    # catalog.js has to ask. The check is that a step ARRIVES rather than traveling: the same press that needs
    # a wait above must be complete within a frame or two here.
    page.cdp.call('Emulation.setEmulatedMedia',
                  {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]})
    try:
        _open_section(page)
        # aria-selected lands on the press whether or not the tween runs, so the observable is the box's
        # POSITION: under reduced motion it must already be where it ends up.
        before = _at(page)
        want = before + 3
        page.js("document.querySelectorAll('#reel .box')[%d].click();1" % want)
        page.settle(0.10)
        r.check('reduced motion steps the rack immediately', _at(page), want)
        # Addressed by index, not by aria-selected: the point is where THAT box is, over time.
        box = "document.querySelectorAll('#reel .box')[%d]" % want
        # Sampled twice across a window that sits INSIDE the tween's own duration: if the glide were running the
        # box would still be moving between the two reads. Deliberately not a comparison against the resting
        # position much later, which the case's own resize can nudge by a few pixels.
        first = page.js("(%s).getBoundingClientRect().x" % box)
        page.settle(0.08)
        second = page.js("(%s).getBoundingClientRect().x" % box)
        r.near('and the box is not still traveling a frame later', second, first, 0.5)

        # The cover turns itself over on a timer, so the case may be either way up by now: what is being checked
        # is that the press TOGGLES it within a frame, not which face it lands on.
        was = page.js("document.getElementById('case').classList.contains('flipped')")
        page.js("document.getElementById('flip').click();1")
        page.settle(0.10)
        now = page.js("document.getElementById('case').classList.contains('flipped')")
        r.check('and turns the case immediately', now, not was)
    finally:
        page.cdp.call('Emulation.setEmulatedMedia', {'features': []})
