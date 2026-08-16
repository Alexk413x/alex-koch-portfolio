# test/harness.py -- the plumbing every suite shares: one server, one browser, one page.
#
# Reuses bench.py's CDP client and Chrome lookup rather than restating them, so there is one description of how
# this project talks to a browser. What is added here is the part the suites all got wrong independently while
# they lived in a scratch directory:
#
#   * the anti-occlusion flags, without which Chrome runs ZERO animation frames in a window that is not
#     front-most and every scroll-driven measurement reads a page that never moved;
#   * cache disabled and a hard reload, because a persistent profile will happily serve a stale module against
#     fresh HTML, which looks exactly like a logic bug;
#   * waiting for fonts, since display-lockup.js re-runs on document.fonts.ready and text metrics before that
#     are measurements of a fallback face.
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bench  # noqa: E402  -- the repo root is on the path as of the line above

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Result:
    """One suite's tally. Suites call check/ok and never decide their own exit status."""

    def __init__(self, name):
        self.name = name
        self.passed = 0
        self.failures = []
        self.skipped = []

    def check(self, label, got, want):
        """Equality, with a numeric tolerance so a float comparison does not fail on the last bit."""
        ok = got == want
        if not ok:
            try:
                ok = abs(float(got) - float(want)) < 1e-9
            except (TypeError, ValueError):
                ok = False
        return self._record(ok, label, '%r, wanted %r' % (got, want))

    def ok(self, label, cond, detail=''):
        return self._record(bool(cond), label, detail)

    def near(self, label, got, want, tol):
        return self._record(abs(got - want) <= tol, label, '%s, wanted %s +/- %s' % (got, want, tol))

    def skip(self, label, why):
        self.skipped.append('%s (%s)' % (label, why))

    def _record(self, ok, label, detail):
        if ok:
            self.passed += 1
        else:
            self.failures.append('%s -- %s' % (label, detail))
        return ok


class Page:
    """A CDP-driven page with the handful of helpers the suites actually need."""

    def __init__(self, cdp, port):
        self.cdp = cdp
        self.port = port

    def js(self, expr):
        return self.cdp.js(expr)

    def json(self, expr):
        return json.loads(self.cdp.js(expr))

    def goto(self, path='index.html'):
        self.cdp.call('Page.navigate', {'url': 'http://127.0.0.1:%d/%s' % (self.port, path)})
        self.settle()

    def reload(self):
        self.cdp.call('Page.reload', {'ignoreCache': True})
        self.settle()

    def settle(self, extra=0.0):
        """Waits for the document, then for fonts. Text metrics before fonts.ready measure a fallback face."""
        for _ in range(80):
            try:
                if self.cdp.js('document.readyState') == 'complete':
                    break
            except Exception:
                pass
            time.sleep(0.1)
        try:
            self.cdp.js('document.fonts ? document.fonts.ready.then(()=>1) : 1')
        except Exception:
            pass
        time.sleep(0.6 + extra)

    def viewport(self, width, height, mobile=False, dpr=1):
        self.cdp.call('Emulation.setDeviceMetricsOverride',
                      {'width': width, 'height': height, 'deviceScaleFactor': dpr, 'mobile': mobile})
        time.sleep(0.35)

    def reset_viewport(self):
        self.cdp.call('Emulation.clearDeviceMetricsOverride')
        time.sleep(0.3)

    def scroll(self, y, pause=0.25):
        self.cdp.js('window.scrollTo({top:%d,behavior:"instant"});1' % int(y))
        time.sleep(pause)

    def pin(self, scroll_id, stage_id):
        """Geometry of a sticky scene: where its pin starts and how far it runs."""
        return self.json(
            "(()=>{const s=document.getElementById('%s'),g=document.getElementById('%s');"
            "return JSON.stringify({top:s.offsetTop,run:s.offsetHeight-g.offsetHeight,vh:innerHeight})})()"
            % (scroll_id, stage_id))

    def click_at(self, selector, pause=0.15):
        """A REAL mouse event at the element's centre, not element.click().

        click() dispatches straight at the node and ignores hit-testing, so it passes through
        pointer-events:none and through anything a 3D transform has moved. Half the point of these tests is
        that a key is reachable where it appears to be."""
        r = self.json("(()=>{const b=document.querySelector(%s);if(!b)return 'null';"
                      "const q=b.getBoundingClientRect();"
                      "return JSON.stringify({x:q.left+q.width/2,y:q.top+q.height/2})})()" % json.dumps(selector))
        for kind in ('mousePressed', 'mouseReleased'):
            self.cdp.call('Input.dispatchMouseEvent',
                          {'type': kind, 'x': r['x'], 'y': r['y'], 'button': 'left', 'clickCount': 1})
        time.sleep(pause)

    def wheel(self, dy, pause=0.25):
        """A REAL wheel event, which scroll() is deliberately not.

        The page answers input rather than position, so it ignores a programmatic scrollTo. Anything testing
        the wheel has to arrive the way a reader does."""
        self.cdp.call('Input.dispatchMouseEvent',
                      {'type': 'mouseWheel', 'x': 400, 'y': 300, 'deltaX': 0, 'deltaY': dy})
        time.sleep(pause)

    def until(self, expr, timeout=4.0, step=0.05):
        """Polls a JS predicate until it is true. Returns whether it became true."""
        end = time.time() + timeout
        while time.time() < end:
            if self.js('!!(%s)' % expr):
                return True
            time.sleep(step)
        return False

    def until_still(self, quiet=0.2, timeout=5.0):
        """Waits until the page has FINISHED moving, rather than for a fixed time.

        A scroll that has stopped is not the same as a scroll that has finished. The page answers a gesture with
        a settle, then decides whether to carry, then glides -- so between the wheel going quiet and the carry
        starting there is a window where nothing is moving and the page is not done. AKNAV.busy() covers exactly
        that window; stillness alone is what made these checks flaky."""
        self.until('!window.AKNAV || !window.AKNAV.busy()', timeout=timeout)
        end = time.time() + timeout
        last, still = None, 0.0
        while time.time() < end:
            y = self.js('Math.round(scrollY)')
            busy = self.js('!!(window.AKNAV && window.AKNAV.busy())')
            still = still + 0.05 if (y == last and not busy) else 0.0
            if still >= quiet:
                return y
            last = y
            time.sleep(0.05)
        return self.js('Math.round(scrollY)')

    def until_ran(self, timeout=5.0):
        """Waits for the Cartographer suite to finish its run.

        It lights on its own 1.5s clock once the scroll lands, so reading when the page has merely stopped
        moving catches it part-way -- five checks of six. The grid is the only readout it has."""
        self.until("(()=>{const c=document.querySelectorAll('#covers .cover');"
                   "return c.length>0 && [...c].every(e=>e.classList.contains('on'))})()", timeout=timeout)

    def until_morphed(self, timeout=4.0):
        """Waits for the calculator to reach a PURE state.

        It runs on its own clock rather than tracking the scroll, so a glide that crosses its trigger leaves it
        animating after the page has come to rest. Reading --m before then reads a mechanism mid-flight."""
        self.until("(m => m < 0.001 || m > 0.999)"
                   "(+(document.getElementById('app-stage').style.getPropertyValue('--m') || 0))",
                   timeout=timeout)
        return float(self.js("document.getElementById('app-stage').style.getPropertyValue('--m') || '0'"))

    def quiesce(self):
        """Lets the page forget the reader touched it.

        The carry only ever finishes a movement the READER made, so it ignores a scrollTo unless real input
        arrived in the last two seconds. Anything that drives the page programmatically and does not want to
        race a carry waits this out first."""
        time.sleep(2.1)

    def flick(self, total=900, events=24, spacing=0.016, pause=1.1):
        """A trackpad flick: ONE decision arriving as a decaying stream of events over ~400ms.

        This is the shape that matters. A page reading the wheel as distance answers every event in the tail and
        races several stops past the one that was wanted."""
        step = total / float(events)
        for i in range(events):
            self.cdp.call('Input.dispatchMouseEvent',
                          {'type': 'mouseWheel', 'x': 400, 'y': 300, 'deltaX': 0,
                           'deltaY': step * (1 - i / float(events)) * 2})
            time.sleep(spacing)
        time.sleep(pause)

    VK = {'ArrowDown': 40, 'ArrowUp': 38, 'ArrowLeft': 37, 'ArrowRight': 39, ' ': 32}

    def key(self, name, pause=0.95):
        """A real key press. The default pause covers the page's glide, which is what an arrow starts."""
        for kind in ('keyDown', 'keyUp'):
            self.cdp.call('Input.dispatchKeyEvent',
                          {'type': kind, 'key': name, 'code': name,
                           'windowsVirtualKeyCode': self.VK.get(name, 0)})
        time.sleep(pause)

    def screenshot(self, path):
        data = self.cdp.call('Page.captureScreenshot', {'format': 'png'})['data']
        with open(path, 'wb') as f:
            f.write(base64.b64decode(data))

    def frame_cost(self, scroll_id, stage_id, samples=90):
        """Mean and worst frame time while scrubbing a pinned scene end to end.

        Advisory, not a gate: this reads whatever else the machine is doing. Compare it against the control in
        the same run rather than against a number from another day."""
        return self.json("""new Promise(res=>{
          const s=document.getElementById('%s'), g=document.getElementById('%s');
          const top=s.offsetTop, run=s.offsetHeight-g.offsetHeight;
          let i=0,n=0,worst=0,t0=0,sum=0;
          function step(ts){
            if(t0){const dt=ts-t0; sum+=dt; n++; if(dt>worst)worst=dt;}
            t0=ts;
            window.scrollTo({top: top + run*(i/%d), behavior:'instant'});
            if(++i<=%d) requestAnimationFrame(step);
            else res(JSON.stringify({mean:+(sum/n).toFixed(2), worst:+worst.toFixed(2)}));
          }
          requestAnimationFrame(step);
        })""" % (scroll_id, stage_id, samples, samples))


class Session:
    """Serves the repo and drives one browser for every suite in a run."""

    def __init__(self, port=8129, debug_port=9410, headless=True, width=1500, height=1000):
        self.port = port
        self.debug_port = debug_port
        self.headless = headless
        self.size = (width, height)
        self.proc = None
        self.httpd = None

    def __enter__(self):
        self.httpd = bench.serve(self.port)
        profile = os.path.join(tempfile.gettempdir(), 'ak-site-test')
        args = [
            bench.chrome_binary(), '--user-data-dir=' + profile,
            '--no-first-run', '--no-default-browser-check', '--disable-extensions',
            '--remote-debugging-port=%d' % self.debug_port, '--remote-allow-origins=*',
            # The three that stop Chrome halting rendering when the window is not front-most. Without them a
            # scroll-driven page reports zero animation frames and every envelope reads as flat.
            '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion',
            '--window-size=%d,%d' % self.size,
        ]
        if self.headless:
            args.append('--headless=new')
        else:
            args.append('--new-window')
        args.append('http://127.0.0.1:%d/index.html' % self.port)
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        ws = None
        for _ in range(80):
            try:
                listing = json.loads(urllib.request.urlopen(
                    'http://127.0.0.1:%d/json/list' % self.debug_port, timeout=2).read())
                for tab in listing:
                    if tab.get('type') == 'page' and 'index.html' in tab.get('url', ''):
                        ws = tab['webSocketDebuggerUrl']
                if ws:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        if not ws:
            self.__exit__(None, None, None)
            raise RuntimeError('no debuggable page on port %d' % self.debug_port)

        cdp = bench.CDP(ws)
        cdp.call('Page.enable')
        cdp.call('Network.enable')
        # A kept profile serves stale modules against fresh HTML, which reads as a logic bug.
        cdp.call('Network.setCacheDisabled', {'cacheDisabled': True})
        self.page = Page(cdp, self.port)
        self.page.reload()
        return self.page

    def __exit__(self, *exc):
        if self.proc:
            self.proc.kill()
        if self.httpd:
            self.httpd.shutdown()
        return False
