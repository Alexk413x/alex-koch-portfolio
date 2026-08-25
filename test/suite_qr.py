# The QR encoder, checked by DECODING what it draws.
#
# A hand-written encoder that renders is not one that scans: an early version produced a flawless-looking symbol
# that read as nothing, because the fifteen format bits were written least-significant first. Nothing short of
# reading the code back catches that, so this suite skips rather than pretends when OpenCV is absent.
import base64
import json

NAME = 'qr'

# A spread that exercises version selection, multibyte UTF-8, and the version-information blocks that only
# exist above version 6.
PAYLOADS = [
    'https://www.alexk413x.com',
    'A',
    'alexk413x',
    'https://www.alexk413x.com/android',
    'MECARD:N:Koch,Alex;EMAIL:Alexk413x@gmail.com;URL:https://www.alexk413x.com;;',
    'https://www.alexk413x.com/?utm_source=qr&utm_medium=print&utm_campaign=resume',
    'x' * 150,
    'Kotlin · Compose · Multi-Agent QA — 14 years shipping mobile at scale.',
]


def run(page, r):
    try:
        import cv2
        import numpy as np
    except ImportError:
        r.skip('encoder decodes back', 'opencv-python not installed; pip install opencv-python')
        return

    page.goto('index.html')
    r.ok('encoder is loaded', page.js('typeof window.AKQR') == 'object')

    detector = cv2.QRCodeDetector()
    for text in PAYLOADS:
        d = page.json("(()=>{const q=window.AKQR.encode(%s);"
                      "return JSON.stringify({v:q.version,s:q.size,"
                      "m:q.modules.map(r=>Array.from(r).join('')).join('')})})()" % json.dumps(text))
        # EIGHT modules of quiet zone here, not the spec's four. The page renders four, which is correct and
        # scans; OpenCV's detector simply wants more margin on some symbols and returns empty above a certain
        # scale with the minimum. Widening the margin tests the encoder rather than the detector's tolerance.
        size, flat, quiet = d['s'], d['m'], 8
        img = np.full((size + quiet * 2, size + quiet * 2), 255, np.uint8)
        for row in range(size):
            for col in range(size):
                if flat[row * size + col] == '1':
                    img[row + quiet, col + quiet] = 0
        # Nearest-neighbour: a soft edge is exactly what a scanner's binarisation step gets wrong.
        big = cv2.resize(img, None, fx=8, fy=8, interpolation=cv2.INTER_NEAREST)
        got, _, _ = detector.detectAndDecode(cv2.cvtColor(big, cv2.COLOR_GRAY2BGR))
        label = 'v%d decodes: %s' % (d['v'], (text[:34] + '...') if len(text) > 34 else text)
        r.check(label, got, text)

    # And the code the page actually renders, at the size a camera would meet it.
    page.js("document.getElementById('qr-open').click();1")
    page.settle()
    r.ok('the share dialog opens', page.js("!document.getElementById('qr-dialog').hidden"))
    # The <img>'s own bytes, not a canvas read: share.js draws to an OFFSCREEN canvas and hands the page a PNG
    # data URL, because a canvas offers no save affordance and long-press/right-click only offer to save an
    # <img>. The src IS the drawing, so decoding it tests exactly what a camera meets.
    data = page.js("document.getElementById('qr-image').src.split(',')[1]")
    img = cv2.imdecode(np.frombuffer(base64.b64decode(data), np.uint8), cv2.IMREAD_COLOR)
    want = 'https://' + page.js("document.querySelector('.qr-url').textContent.trim()")

    # POLARITY IS NORMALISED FIRST, and that is a cost, not a formality. The page draws light modules on a dark
    # ground; OpenCV's detector reads dark-on-light only and returns nothing from the canvas as drawn, measured
    # at both 246px and 180px. Phone cameras that invert for themselves still read it, and this cannot check
    # that. Inverting here tests the modules and the centre stamp, which is what this file is for.
    def flip(im):
        return cv2.cvtColor(255 - cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)

    got, _, _ = detector.detectAndDecode(flip(img))
    r.check('the rendered code decodes', got, want)
    small = cv2.resize(img, (180, 180), interpolation=cv2.INTER_AREA)
    got_small, _, _ = detector.detectAndDecode(flip(small))
    r.check('...and still decodes at 180px', got_small, want)

    # A missing favicon.svg leaves a clean hole that still decodes, so the decode above cannot catch it. Only
    # the mark puts accent-red pixels in the middle of the code.
    mid = img.shape[0] // 2
    core = img[mid - 20:mid + 20, mid - 20:mid + 20, 2]
    r.ok('the centre carries the mark', bool((core > 150).any()))

    # The overlay IS the close control -- there is no button. Every part of it closes, panel included.
    page.js("document.getElementById('qr-dialog').click();1")
    r.ok('a click anywhere on the overlay hides the dialog',
         page.js("document.getElementById('qr-dialog').hidden"))
