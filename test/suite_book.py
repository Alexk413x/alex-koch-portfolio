# The booking dialog: Cal.com is not in the page until asked for, and is asked for once.
#
# The suite checks the order of events rather than the booker's rendering: no Cal.com script on load, exactly
# one after the first open, none added by a second open, and the page held still underneath.
import time

NAME = 'book'

CALENDAR = 'https://cal.com/alexk413x/connect'


def cal_scripts(page):
    return page.js("document.querySelectorAll('script[src*=\"cal.com/embed/embed.js\"]').length")


def run(page, r):
    page.goto('index.html')

    r.check('no Cal.com script in the page on load', cal_scripts(page), 0)
    r.check('no cookies of the site\'s own', page.js('document.cookie'), '')
    r.ok('the header trigger sits before the QR one',
         page.js("(()=>{const t=[...document.querySelectorAll('#nav-tools [data-open],#nav-tools [data-qr-open]')];"
                 "return t.length===2&&t[0].getAttribute('data-open')==='cal-dialog'})()"))
    r.ok('the contact section has the button', page.js("!!document.getElementById('cal-open')"))
    r.check('the no-JS link is the calendar',
            page.js("document.querySelector('#cal-dialog .book-failed a').href"), CALENDAR)

    # focus() first: a scripted click() moves no focus, so there would be nothing for close() to return to.
    page.js("const b=document.getElementById('cal-open');b.focus();b.click();1")
    time.sleep(0.2)
    r.ok('the dialog opens', page.js("!document.getElementById('cal-dialog').hidden"))
    r.ok('the ring is up', page.js("document.getElementById('cal-dialog').classList.contains('is-loading')"))
    r.check('one Cal.com script requested', cal_scripts(page), 1)

    # The booker needs the network; the frame appearing is the embed's own doing, so this is advisory.
    for _ in range(40):
        if page.js("!!document.querySelector('#cal-dialog .book-frame iframe')"):
            break
        time.sleep(0.25)
    src = page.js("(document.querySelector('#cal-dialog .book-frame iframe')||{}).src||''")
    if src:
        r.ok('the iframe opens the calendar', src.startswith('https://app.cal.com/alexk413x/connect'), src)
        r.ok('in the dark theme', 'theme=dark' in src, src)
        r.ok('the ring lifts once the booker is ready',
             page.until("!document.getElementById('cal-dialog').classList.contains('is-loading')", timeout=20))
    else:
        r.skip('the iframe opens the calendar', 'app.cal.com unreachable')

    # The page under the dialog holds still: a wheel over the overlay must not move it.
    # focus() scrolled the trigger into view and the rail is still settling; sample only once it is still.
    page.until_still()
    before = page.js('scrollY')
    page.wheel(600, pause=0.8)
    page.until_still()
    r.check('the page does not scroll under the dialog', page.js('scrollY'), before)

    page.js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));1")
    time.sleep(0.1)
    r.ok('Escape closes it', page.js("document.getElementById('cal-dialog').hidden"))
    r.ok('and the page scrolls again', not page.js("document.documentElement.classList.contains('dialog-open')"))
    r.check('focus returns to the trigger', page.js("document.activeElement.id"), 'cal-open')

    page.js("document.querySelector('#nav-tools [data-open=\"cal-dialog\"]').click();1")
    time.sleep(0.2)
    r.ok('the header trigger opens the same dialog', page.js("!document.getElementById('cal-dialog').hidden"))
    r.check('and requests no second script', cal_scripts(page), 1)
    r.ok('the booker is kept, not remade', page.js("document.querySelectorAll('#cal-dialog iframe').length<=1"))
    page.js("document.getElementById('cal-dialog').click();1")
    time.sleep(0.1)
    r.ok('the backdrop closes it', page.js("document.getElementById('cal-dialog').hidden"))
