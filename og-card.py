"""og-card.py -- renders site/og-card.html to site/og-card.png.

    python og-card.py            render the card
    python og-card.py --check    render to a temporary file and report how far it differs from the committed one

The card is the image every scraper fetches for a link preview, and it used to be a committed PNG with nothing
behind it: no template, no script, no way to change a word without opening a bitmap editor. The design now lives
in site/og-card.html and this turns it into the PNG.

THIS IS NOT A BUILD STEP, and the distinction matters here. The PNG stays committed and is what ships; nothing
renders at request time and no page depends on this script. Editing the template changes nothing until you run
it -- the same arrangement site-url.py has, for the same reason.

It borrows bench.py's Chrome plumbing rather than repeating it: serve the repo, launch an isolated browser with
the flags that stop Windows halting an occluded renderer, drive it over the DevTools protocol.

TWO THINGS THE RENDER HAS TO WAIT FOR, and both have produced a wrong card when skipped. The fonts come off
Google's CDN, so a screenshot taken before document.fonts.ready shows the fallback and every line is the wrong
width. And a throwaway profile starts with an EMPTY HTTP CACHE, so the first load is the slow one.
"""
import argparse
import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
import bench  # noqa: E402  -- serve / CDP / chrome_binary / _shut

PORT = 8797
DBG = 9339
PAGE = 'site/og-card.html'
OUT = os.path.join(ROOT, 'site', 'og-card.png')

# Open Graph and Twitter's summary_large_image both want 1.91:1. This is the size the viewport is set to and the
# size the template's body is fixed at; the two must agree or the screenshot crops the design.
W, H = 1200, 630


def render(out_path):
    bench.serve(PORT)
    url = 'http://127.0.0.1:%d/%s' % (PORT, PAGE)
    prof = os.path.join(tempfile.gettempdir(), 'og-card-prof')
    proc = subprocess.Popen([
        bench.chrome_binary(), '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--remote-debugging-port=%d' % DBG, '--remote-allow-origins=*',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        # Pinned to 1, or a hi-dpi desktop renders the card at its scale factor and the PNG comes out oversized.
        '--force-device-scale-factor=1',
        '--hide-scrollbars',
        # NO LCD SUBPIXEL TEXT. Chrome renders type with coloured subpixel fringes by default, which is right on
        # a physical RGB-striped panel and wrong in a PNG that will be scaled and shown on anything. It put 2181
        # red-and-blue fringed pixels through the card's mono line; the CSS font-smoothing property does not turn
        # it off for a screenshot, and this flag does.
        '--disable-lcd-text',
        '--new-window', '--window-size=%d,%d' % (W, H + 120), url])
    try:
        time.sleep(10)
        ws = None
        for _ in range(30):
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/json' % DBG, timeout=5) as r:
                    for t in json.load(r):
                        if 'og-card' in t.get('url', ''):
                            ws = t['webSocketDebuggerUrl']
            except Exception:
                pass
            if ws:
                break
            time.sleep(1)
        if not ws:
            raise RuntimeError('could not reach the card page over CDP')
        c = bench.CDP(ws)
        # The viewport is set explicitly rather than inferred from the window, so the shot does not depend on
        # chrome's own border, the tab strip, or which platform this runs on.
        c.call('Emulation.setDeviceMetricsOverride',
               {'width': W, 'height': H, 'deviceScaleFactor': 1, 'mobile': False})
        for _ in range(40):
            if c.js('document.readyState === "complete"'):
                break
            time.sleep(0.25)
        # The webfonts, or every line is measured in the fallback and comes out the wrong width.
        c.js('document.fonts.ready.then(()=>1)')
        time.sleep(1.0)
        loaded = c.js('JSON.stringify([...document.fonts].filter(f=>f.status==="loaded").map(f=>f.family))')
        img = c.call('Page.captureScreenshot',
                     {'format': 'png', 'captureBeyondViewport': False,
                      'clip': {'x': 0, 'y': 0, 'width': W, 'height': H, 'scale': 1}})['data']
        with open(out_path, 'wb') as fh:
            fh.write(base64.b64decode(img))
        return loaded
    finally:
        bench._shut(proc)


def compare(a, b):
    """How far two cards are apart, as a share of pixels and the worst channel step.

    Compared by DISTANCE, never by a hash: two renders of the same page differ by a subpixel here and there --
    the same reason the wormhole lab compares permutations this way rather than by digest.
    """
    try:
        from PIL import Image
    except ImportError:
        return None
    ia, ib = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    if ia.size != ib.size:
        return {'size_a': ia.size, 'size_b': ib.size}
    pa, pb = ia.load(), ib.load()
    diff, worst = 0, 0
    for y in range(ia.size[1]):
        for x in range(ia.size[0]):
            ra, ga, ba = pa[x, y]
            rb, gb, bb = pb[x, y]
            d = max(abs(ra - rb), abs(ga - gb), abs(ba - bb))
            if d > 8:
                diff += 1
            worst = max(worst, d)
    n = ia.size[0] * ia.size[1]
    return {'differing_px': diff, 'share': diff / n, 'worst_channel_step': worst}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true',
                    help='render to a temporary file and report the difference instead of overwriting')
    a = ap.parse_args()

    out = OUT + '.new' if a.check else OUT
    loaded = render(out)
    print('fonts loaded: %s' % loaded)
    print('wrote %s (%d bytes)' % (out, os.path.getsize(out)))
    if a.check:
        print('vs committed: %s' % compare(OUT, out))


if __name__ == '__main__':
    main()
