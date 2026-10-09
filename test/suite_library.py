# The Library: that the ring turns clockwise, that one index drives the ring and the text, that only the front
# model moves, and that the reader's first input takes the clock off.
#
# The faults here are all silent: a ring that turns the wrong way still looks like a ring, a back model that
# keeps animating only costs frames and attention, and a clock that ignores the reader reads as a page fighting
# them. None of them throw.
import time

NAME = 'library'

FRONT = "[...document.querySelectorAll('.lib-slot')].findIndex(s=>s.classList.contains('is-front'))"
TEXT = "[...document.querySelectorAll('.lib-list li')].findIndex(l=>l.classList.contains('is-on'))"
CURRENT = "[...document.querySelectorAll('.lib-item')].findIndex(b=>b.getAttribute('aria-current')==='true')"
MARKUP = "[...document.querySelectorAll('.lib-slot .lm')].map(s=>s.innerHTML)"


def centers(page):
    return page.json(
        "JSON.stringify([...document.querySelectorAll('.lib-slot')].map(s=>{const r=s.getBoundingClientRect();"
        "return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,o:+getComputedStyle(s).opacity}}))")


def run(page, r):
    page.goto('index.html')
    page.viewport(1500, 1000)
    top = page.js("Math.round(document.getElementById('library').getBoundingClientRect().top+scrollY)")
    page.scroll(top, pause=1.0)

    r.check('the ring has four plugins', page.js("document.querySelectorAll('.lib-slot .lm').length"), 4)
    r.check('and four descriptions', page.js("document.querySelectorAll('.lib-item').length"), 4)
    r.check('one slot is at the front', page.js("document.querySelectorAll('.lib-slot.is-front').length"), 1)
    r.check('and the text agrees with it', page.js(TEXT), page.js(FRONT))
    r.check('and so does the current item', page.js(CURRENT), page.js(FRONT))
    r.ok('the logos are real paths, not empty marks',
         page.js("[...document.querySelectorAll('.lm-logo path')].every(p=>(p.getAttribute('d')||'').length>200)"))

    c = centers(page)
    f = page.js(FRONT)
    r.ok('the front is the largest', all(c[f]['w'] > c[i]['w'] for i in range(4) if i != f),
         str([round(x['w']) for x in c]))
    r.ok('and the brightest', all(c[f]['o'] > c[i]['o'] for i in range(4) if i != f),
         str([x['o'] for x in c]))
    r.ok('and every other one is still visible', all(c[i]['o'] > .2 for i in range(4) if i != f),
         str([x['o'] for x in c]))

    # THE RAIL BAR sits on the active description. It is measured, so it cannot drift from the text.
    bar = page.js("(()=>{const l=document.querySelector('.lib-list');"
                  "return parseFloat(l.style.getPropertyValue('--bar-y'))-document.querySelector('.lib-list li.is-on').offsetTop})()")
    r.near('the accent bar sits on the active row', bar, 0, 1)

    # ARROWS TURN THE RING WHILE THE READER IS IN THE SECTION, and do not step the page.
    y0 = page.js('scrollY')
    page.key('ArrowRight', pause=1.5)
    r.check('the right arrow selects the next plugin', page.js(FRONT), (f + 1) % 4)
    r.check('and the text follows', page.js(TEXT), (f + 1) % 4)
    r.near('and the page does not step', page.js('scrollY'), y0, 2)

    # CLOCKWISE: the plugin that was in front is now on the left, and the one before it is behind.
    c = centers(page)
    ring = page.json("JSON.stringify((()=>{const r=document.querySelector('.lib-ring').getBoundingClientRect();"
                     "return {x:r.left+r.width/2,y:r.top+r.height/2}})())")
    r.ok('the plugin that left the front went left', c[f]['x'] < ring['x'] - 40, 'x %d, ring %d' % (c[f]['x'], ring['x']))
    r.ok('the one that was behind went right', c[(f + 2) % 4]['x'] > ring['x'] + 40, str([round(x['x']) for x in c]))
    r.ok('and the one that was on the right went behind', c[(f + 3) % 4]['y'] < min(c[i]['y'] for i in range(4) if i != (f + 3) % 4),
         str([round(x['y']) for x in c]))
    r.ok('and the new front is the lowest', all(c[(f + 1) % 4]['y'] > c[i]['y'] for i in range(4) if i != (f + 1) % 4),
         str([round(x['y']) for x in c]))

    page.key('ArrowLeft', pause=1.5)
    r.check('the left arrow turns it back', page.js(FRONT), f)

    # ONLY THE FRONT MOVES. Three of the four svgs are byte-identical across a second; the front one is not.
    before = page.json('JSON.stringify(%s)' % MARKUP)
    time.sleep(1.2)
    after = page.json('JSON.stringify(%s)' % MARKUP)
    f = page.js(FRONT)
    r.ok('the front model animates', before[f] != after[f])
    r.ok('and the other three hold still', all(before[i] == after[i] for i in range(4) if i != f),
         'moved: %s' % [i for i in range(4) if i != f and before[i] != after[i]])

    # ONLY THE FRONT MODEL SHOWS ITS LIGHT. The beads and the lit node borders of the three behind it are cleared, so
    # nothing frozen mid-flight glows in the background.
    lit = page.js("[...document.querySelectorAll('.lib-slot:not(.is-front)')].reduce((n,s)=>n+s.querySelectorAll('.bead.on').length+"
                  "[...s.querySelectorAll('.lm-rim')].filter(r=>+r.getAttribute('stroke-opacity')>0).length,0)")
    r.check('the models behind the front show no beads or lit borders', lit, 0)

    # THE CLOCK STOPS FOR THE READER. The arrow keys above were input, so nothing may advance now.
    held = page.js(FRONT)
    time.sleep(6.5)
    r.check('after the reader has acted the ring stays put', page.js(FRONT), held)

    # A FRESH LOAD RUNS ON ITS OWN, one plugin per period.
    page.goto('index.html')
    page.viewport(1500, 1000)
    page.scroll(top, pause=1.0)
    start = page.js(FRONT)
    moved = page.until("%s !== %d" % (FRONT, start), timeout=8.0)
    r.ok('the ring advances by itself', moved)
    r.check('and goes to the next plugin', page.js(FRONT), (start + 1) % 4)

    # OFF SCREEN IT STOPS: nothing runs where nobody can see it.
    page.scroll(0, pause=0.8)
    away = page.js(FRONT)
    time.sleep(6.0)
    r.check('out of view the ring holds', page.js(FRONT), away)
