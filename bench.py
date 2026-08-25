"""bench.py — measure a lab's true frame rate, start to finish, in one command.

    python bench.py                     # CRT Lab, 12 samples, verdict
    python bench.py --page reactor      # any lab: crt | reactor | wormhole | shell, or a literal path
    python bench.py --uncapped          # frame COST, not frame RATE — see below
    python bench.py --inject "<js>"     # change something in the page before sampling it
    python bench.py --high-perf-gpu     # render on the discrete adapter instead of the default one
    python bench.py --port 8000         # if you already have a server running

EVERY LAB IS MEASURED BY THE SAMPLER ALONE, which needs nothing from the page but the size of its canvas -- the
render target is the divisor for ms/megapixel, and the window is not. `--attribute` and `--state` are
gone with the DOM build they served: `fps-probe.js` knew that lab's thirteen layers by name, and nothing else has
layers to attribute cost to.

What the sampler cannot do is FIX the page's state, so a run measures whatever the page restored -- and on a fresh
bench profile that is the shipped default. Two numbers are only comparable when they were taken at the same
settings, so the run prints which page it measured, and `--inject` is how you pin a setting before sampling:

    python bench.py --page reactor --uncapped --inject "REACTOR.state.renderScale=0.62; REACTOR.fit(true); 1"

Each lab publishes a handle for exactly this -- CRTGL, REACTOR, WORMHOLE, SHELL -- carrying `state`, `R`, `fit`
and a `renderNow` that draws one frame synchronously.

ONCE THE PAGE HITS 60 THIS TOOL GOES BLIND, AND `--uncapped` IS THE ANSWER. rAF is delivered on the vsync, so a
page comfortably inside budget and a page exactly at budget both report 16.67ms and nothing distinguishes them.
The samples pin to the floor (`16.66, 16.67, 16.67, ...`) and every further optimization prints the same number.
`--uncapped` adds `--disable-gpu-vsync --disable-frame-rate-limit`, which lets rAF run as fast as the renderer
can retire frames and turns the reading back into a measurement of WORK. Use it to find headroom; use the default
to answer "does it hold 60".

The two modes are NOT comparable and the output labels which one ran. Every historical number in the handoffs was
taken capped, so a capped run is what those tables can be read against.

Everything this needs is in here: it serves the repo, launches an isolated Chrome with the flags that stop Chrome
from halting rendering, warms the profile's cache, drives the page over the DevTools protocol, and reports the
distribution rather than a single number.

WHY IT EXISTS, and why the obvious approach fails:

  - Chrome reports `visibilityState: hidden` and runs ZERO animation frames whenever its window is occluded on
    Windows -- while `document.hasFocus()` still says true. Every frame number this project was ever quoted from a
    window that was not front-most measured nothing at all. `--disable-features=CalculateNativeWinOcclusion` is the
    flag that fixes it; without it this script would report 0 fps for a page running perfectly.
  - A throwaway profile starts with an EMPTY HTTP CACHE, so the lab has to pull React, Babel and the fonts off the
    network before it mounts. The first load here is a throwaway that only warms the cache.
  - **The median is the wrong statistic and the minimum is only right sometimes.** Interference makes frames slower,
    never faster, so the minimum across repeats is the honest estimate of what the renderer can do. But when a
    machine is loaded the minimum starts measuring gaps in the interference instead: one session here read 18.0ms
    once and 35.7ms minimum over twelve repeats of the identical state. So this prints the whole distribution and
    REFUSES A VERDICT when median/min says the machine is not fit to measure on.

Close other tabs and applications before trusting the number.
"""
import argparse, base64, json, os, socket, struct, subprocess, sys, tempfile, threading, time
import http.server, socketserver, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
TARGET_MS = 1000.0 / 60

# THE LAB UNDER TEST, BY NAME. CRT Lab has a space in its filename, so the alternative at the command line is
# `--page 'labs/crt/CRT Lab.html'` with the escaping to match -- a quoting problem to solve before taking a
# measurement. A literal path is still accepted for anything not on this list.
# `crtgl` still resolves, so anything already written against it keeps working. It is only an alias here --
# unlike the lab's localStorage key of the same spelling, which is an address and cannot move.
PAGES = {
    'crt':      'labs/crt/CRT%20Lab.html',
    'crtgl':    'labs/crt/CRT%20Lab.html',
    'reactor':  'labs/reactor/Reactor.html',
    'wormhole': 'labs/wormhole/Wormhole.html',
    'shell':    'labs/shell/Shell.html',
}


# ---------------------------------------------------------------- server
def serve(port):
    os.chdir(ROOT)

    class H(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', port), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# ---------------------------------------------------------------- minimal CDP
class CDP:
    def __init__(self, ws_url):
        rest = ws_url.split('://', 1)[1]
        hostport, path = rest.split('/', 1)
        host, port = hostport.split(':')
        self.sock = socket.create_connection((host, int(port)), timeout=15)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(('GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                           'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nOrigin: http://127.0.0.1\r\n\r\n'
                           % (path, hostport, key)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.sock.recv(4096)
        self._buf = buf.split(b'\r\n\r\n', 1)[1]
        self._id = 0

    def _frame(self):
        def need(k):
            while len(self._buf) < k:
                self._buf += self.sock.recv(65536)
        need(2)
        ln, off = self._buf[1] & 0x7F, 2
        if ln == 126:
            need(4); ln = struct.unpack('>H', self._buf[2:4])[0]; off = 4
        elif ln == 127:
            need(10); ln = struct.unpack('>Q', self._buf[2:10])[0]; off = 10
        need(off + ln)
        p = self._buf[off:off + ln]
        self._buf = self._buf[off + ln:]
        return p

    def call(self, method, params=None, timeout=300):
        self._id += 1
        data = json.dumps({'id': self._id, 'method': method, 'params': params or {}}).encode()
        mask = os.urandom(4)
        hdr = bytearray([0x81])
        n = len(data)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 1 << 16:
            hdr.append(0x80 | 126); hdr += struct.pack('>H', n)
        else:
            hdr.append(0x80 | 127); hdr += struct.pack('>Q', n)
        hdr += mask
        self.sock.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
        self.sock.settimeout(timeout)
        while True:
            msg = json.loads(self._frame().decode('utf-8', 'replace'))
            if msg.get('id') == self._id:
                if 'error' in msg:
                    raise RuntimeError(str(msg['error']))
                return msg.get('result')

    # ships a literal expression from this file to the page; not Python eval
    def js(self, expr, timeout=300):
        r = self.call('Runtime.evaluate', {'expression': expr, 'awaitPromise': True,
                                           'returnByValue': True, 'userGesture': True}, timeout)
        if r.get('exceptionDetails'):
            raise RuntimeError(json.dumps(r['exceptionDetails'])[:400])
        return r.get('result', {}).get('value')


def chrome_binary():
    for p in [os.environ.get('CHROME'),
              r'C:\Program Files\Google\Chrome\Application\chrome.exe',
              r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
              '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
              'google-chrome', 'chromium']:
        if p and (os.path.exists(p) or not os.sep in p):
            return p
    sys.exit('Chrome not found — set the CHROME environment variable to its path.')


# THE MEAN WITHIN A WINDOW, THE MINIMUM ACROSS WINDOWS. Two different jobs, two different statistics.
#
# rAF is delivered on the vsync, so an individual frame interval can only ever BE a multiple of 16.67ms. Taking
# the MEDIAN of those intervals therefore returns one of 16.7 / 33.3 / 50 / 66.7 exactly, and nothing in between:
# the estimator quantizes what the hardware already quantized. A change that moves a tenth of the frames from one
# step to the next -- which is what a few ms of extra cost looks like -- does not move the median at all, and then
# moves it a whole step at once. Attribution scored that way produced NEGATIVE layer costs here (switching the
# screen flicker off "saved" -33.1ms), which is a staircase being read as a ruler.
#
# The MEAN over the window is continuous, because a page that is over budget does not sit on one step -- it mixes
# 33.3s and 50s, and the ratio of the mix moves smoothly with cost. Same data, same window, resolution better than
# a tenth of a vsync.
#
# The minimum ACROSS windows stays exactly as it was: interference only ever makes a frame slower, so the smallest
# window is still the honest estimate of what the renderer can do. See the note in main() on when even that fails.
#
# ALL OF THE ABOVE DESCRIBES THE CAPPED RUN. Under --uncapped there is no vsync to quantize against, so intervals
# are continuous at the source and the mean is simply a mean. The staircase this comment exists to work around is
# gone in that mode -- but so is the floor, which is the whole reason to use it: a capped run cannot distinguish a
# page that costs 16.6ms from one that costs 4ms, and both are extremely common readings here.
SAMPLER = '''(async()=>{
  const R=(ms)=>new Promise(res=>{let last=0,d=[];const s=(t)=>{if(last)d.push(t-last);last=t;
   if(d.length&&d.reduce((a,b)=>a+b,0)>ms){res(+(d.reduce((a,b)=>a+b,0)/d.length).toFixed(2));return;}
   requestAnimationFrame(s);};requestAnimationFrame(s);});
  const o=[]; for(let i=0;i<%d;i++) o.push(await R(2000));
  const cs=[...document.querySelectorAll('canvas')].filter(c=>c.width>1&&c.height>1);
  const t=cs.length?cs.reduce((a,b)=>a.width*a.height>=b.width*b.height?a:b):null;
  return JSON.stringify({reps:o, size:[innerWidth,innerHeight,devicePixelRatio],
                         target:t?[t.width,t.height]:null,
                         visible:document.visibilityState});})()'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--page', default='crt',
                    help='which lab to measure: ' + ' | '.join(PAGES) + ', or a literal path from the repo root')
    ap.add_argument('--port', type=int, default=8791)
    ap.add_argument('--samples', type=int, default=12)
    ap.add_argument('--width', type=int, default=1600)
    ap.add_argument('--height', type=int, default=1000)
    ap.add_argument('--uncapped', action='store_true',
                    help='unthrottle rAF so frame COST is measurable below the 16.67ms vsync floor')
    ap.add_argument('--high-perf-gpu', action='store_true',
                    help='force the discrete adapter')
    ap.add_argument('--low-power-gpu', action='store_true',
                    help='force the integrated adapter — the honest target, and what the handoff tables were measured on')
    ap.add_argument('--dpr', type=float, default=None,
                    help='force the device scale factor, e.g. 1.0. The lab renders at the window DPR (1.75 on this '
                         'display), so this answers what capping render resolution would buy before anything in '
                         'the lab is changed to do it.')
    ap.add_argument('--warm', action='store_true',
                    help='REUSE the bench profile instead of wiping it, so the GPU shader cache survives. This '
                         'harness is ~4x pessimistic cold (see the note in the verdict); run once to warm, then '
                         'again with --warm for a number comparable to a real browser.')
    ap.add_argument('--inject', default=None,
                    help='JS evaluated in the page before the samples. This is how a setting is PINNED so two runs '
                         'are comparable, and how a change is tried without editing the lab.')
    ap.add_argument('--keep-open', action='store_true')
    a = ap.parse_args()

    a.path = PAGES.get(a.page, a.page).replace('\\', '/').lstrip('/')
    # FAIL HERE, NOT AFTER LAUNCHING A BROWSER AND SLEEPING 48 SECONDS. A mistyped page name otherwise surfaces
    # as "could not reach the page over CDP", which reads as a harness fault rather than a typo.
    if not os.path.exists(os.path.join(ROOT, urllib.parse.unquote(a.path))):
        sys.exit('no such page: %s\n  names: %s' % (a.path, ' | '.join(PAGES)))

    serve(a.port)
    base = 'http://127.0.0.1:%d/%s' % (a.port, a.path)
    prof = os.path.join(tempfile.gettempdir(), 'crt-bench-run')
    # KEPT ON PURPOSE UNDER --warm. A wiped profile has no GPU shader cache, which is the single biggest
    # systematic error this harness has: every shader the compositor needs is recompiled on the first frames.
    if not a.warm:
        subprocess.run('rmdir /s /q "%s"' % prof if os.name == 'nt' else ['rm', '-rf', prof],
                       shell=(os.name == 'nt'), capture_output=True)

    dbg = 9333
    args = [chrome_binary(), '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check',
            '--disable-extensions', '--remote-debugging-port=%d' % dbg, '--remote-allow-origins=*',
            # the three that stop Chrome halting rendering when the window is not front-most
            '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
            '--disable-features=CalculateNativeWinOcclusion',
            '--new-window', '--window-size=%d,%d' % (a.width, a.height)]
    # BOTH, NOT EITHER: --disable-gpu-vsync unblocks the GPU process's swap and --disable-frame-rate-limit removes
    # the compositor's own cap. With only one of them rAF still arrives on the vsync and nothing changes.
    if a.uncapped:
        args += ['--disable-gpu-vsync', '--disable-frame-rate-limit']
    # DO NOT ASSUME WHICH ADAPTER "DEFAULT" MEANS -- IT HAS BEEN BOTH ON THIS MACHINE.
    #
    # With no forcing flag at all, Chrome has been recorded here picking the discrete `ANGLE (NVIDIA GeForce GTX
    # 1650 ... D3D11)`, and has since been measured from a fresh bench profile picking the Intel UHD 630 -- the part
    # the handoff's whole ms/megapixel table was taken on. Whichever it picks dominates the reading, so an
    # unlabeled frame time on a hybrid box is how two adapters' numbers end up in one table: a run with a forcing
    # flag is measuring different HARDWARE, not a different build.
    #
    # So the adapter is printed on every run, and both directions are forceable. The INTEGRATED one is the honest
    # target for a page anyone else will open; the discrete one is a separate, labeled comparison.
    if a.dpr:
        args.append('--force-device-scale-factor=%s' % a.dpr)
    if a.high_perf_gpu:
        args.append('--force-high-performance-gpu')
    if a.low_power_gpu:
        args.append('--force-low-power-gpu')
    args.append(base)
    proc = subprocess.Popen(args)
    # THE BROWSER IS CLOSED ON EVERY PATH OUT, and it used to be closed on exactly one.
    #
    # proc.terminate() was the last statement of this function, so it ran only when the run reached the end. An
    # early return skipped it, both sys.exit calls skipped it, and so did any exception or Ctrl-C. A harness that
    # leaks on the unhappy path leaks hardest while it is being debugged, which is when it is run most: four
    # aborted runs in one session left four full browsers and two profile trees behind, and a lab's worth of
    # compositor memory with each.
    #
    # Everything below therefore raises rather than sys.exit-ing, and the close lives in the finally.
    try:
        _run(a, c_args=(proc, dbg, base))
    finally:
        if not a.keep_open:
            _shut(proc)


def _shut(proc):
    """Close the browser and WAIT for it. terminate() signals the parent only; the renderer, GPU and utility
    children outlive it briefly and keep the profile locked, which makes the next launch fail confusingly."""
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def gpu_report(dbg, c):
    """Which adapter Chrome actually rendered on, and whether rasterization was hardware-accelerated.

    THIS IS PRINTED WITH EVERY RUN BECAUSE THIS MACHINE HAS TWO GPUS. An unlabeled frame time on a hybrid box is
    how two different adapters' numbers end up in the same table: Chrome picks the integrated one by default, and
    a run with --force-high-performance-gpu is measuring different hardware, not a different build.

    Two sources, because they answer different halves and either can be unavailable. WebGL's unmasked renderer
    NAMES the adapter, which is the part that matters here. SystemInfo.getInfo says whether compositing and
    rasterization are on hardware at all. A run that cannot answer says UNKNOWN rather than guessing.
    """
    name = None
    try:
        name = c.js("(()=>{const g=document.createElement('canvas').getContext('webgl');if(!g)return null;"
                    "const e=g.getExtension('WEBGL_debug_renderer_info');"
                    "return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null;})()")
    except Exception:
        pass
    feats = {}
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/json/version' % dbg, timeout=5) as r:
            ws = json.load(r).get('webSocketDebuggerUrl')
        if ws:
            fs = (CDP(ws).call('SystemInfo.getInfo').get('gpu') or {}).get('featureStatus') or {}
            feats = {k: fs[k] for k in ('gpu_compositing', 'rasterization', 'multiple_raster_threads') if k in fs}
    except Exception:
        pass
    return name, feats


def _run(a, c_args):
    proc, dbg, base = c_args
    print('warming the profile cache (React/Babel/fonts come off the network on a fresh profile)...')
    time.sleep(28)

    # MATCHED ON THE PAGE'S OWN FILENAME, escaped or not. This was `'CRT' in url`, which was true of exactly one
    # page and is now true of three; Chrome also reports the URL back with its own idea of escaping, so both forms
    # are tried rather than assuming which one comes back.
    leaf = a.path.rsplit('/', 1)[-1]
    wanted = {leaf, urllib.parse.unquote(leaf)}
    tgt = None
    for _ in range(20):
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/json' % dbg, timeout=5) as r:
                pages = [t for t in json.load(r) if t.get('type') == 'page'
                         and any(w in urllib.parse.unquote(t.get('url', '')) or w in t.get('url', '')
                                 for w in wanted)]
            if pages:
                tgt = pages[0]
                break
        except Exception:
            pass
        time.sleep(2)
    if not tgt:
        raise RuntimeError('could not reach %s over CDP' % a.path)

    c = CDP(tgt['webSocketDebuggerUrl'])
    c.call('Runtime.enable')
    c.call('Page.bringToFront')
    # WHAT IS MEASURED IS WHATEVER THE PAGE RESTORED, which on a fresh bench profile is the shipped default. Say so,
    # because a number is only comparable to another taken at the same settings -- and --inject is how you pin them.
    print('measuring the restored state of "%s" (a fresh profile means the shipped default)' % a.page)
    print('settling 20s...')
    time.sleep(20)

    if c.js('document.visibilityState') != 'visible':
        raise RuntimeError('page reports hidden — Chrome is not rendering it; the occlusion flags did not take')

    gpu_name, gpu_feats = gpu_report(dbg, c)
    print()
    print('page:    %s' % a.path)
    forced = ('  (--force-high-performance-gpu)' if a.high_perf_gpu else
              '  (--force-low-power-gpu)' if a.low_power_gpu else '  (Chrome default — VERIFY, it is not always the iGPU)')
    print('adapter: %s%s' % (gpu_name or 'UNKNOWN', forced))
    if gpu_feats:
        print('         ' + ', '.join('%s=%s' % kv for kv in sorted(gpu_feats.items())))
    print('vsync:   %s' % ('DISABLED — this is frame COST, not frame rate; not comparable to a capped run'
                           if a.uncapped else 'on — floor is %.2f ms, cost below it is invisible' % TARGET_MS))

    if a.inject:
        print('injected:', a.inject[:90] + ('...' if len(a.inject) > 90 else ''))
        print('  ->', c.js(a.inject, 60))
        time.sleep(6)                 # let the change settle before sampling it
    d = json.loads(c.js(SAMPLER % a.samples, 400))
    # The first window is a warm-up, not a measurement: uncapped with an idle compositor it retires a burst of
    # near-empty frames and comes back well under 1ms where every later window sits at 4-6ms. Left in the output so
    # a genuinely slow first window is still visible, but excluded from the min, the median and the verdict — the
    # guard below compares min against median, and that one sample defeated it.
    reps = d['reps']
    warm, kept = (reps[0], reps[1:]) if len(reps) > 2 else (None, reps)
    r = sorted(kept)
    lo, med = r[0], r[len(r) // 2]
    w, h, dpr = d['size']
    # THE DIVISOR IS THE RENDER TARGET, NOT THE WINDOW. `innerWidth * innerHeight * dpr^2` described the DOM build,
    # which composited full-stage layers and owned no buffer; every surviving lab draws ONE GL canvas sized from the
    # STAGE by dpr and renderScale, so the window count billed the panel's 340px as rendered pixels and ignored the
    # scale entirely -- 4.4 MP against a real 0.87 on the display this was fixed on, understating ms/MP ~5x. The
    # handoff's ms/megapixel table is the old build's and is NOT comparable to this line.
    tgt = d.get('target')
    mp = (tgt[0] * tgt[1] / 1e6) if tgt else None
    print()
    print('window %dx%d CSS @ dpr %s' % (w, h, dpr))
    if mp:
        print('render target %dx%d = %.2f MP' % (tgt[0], tgt[1], mp))
    else:
        print('render target UNKNOWN — no sized canvas in the DOM; ms/MP withheld rather than guessed')
    if warm is not None:
        print('warm-up window (excluded): %.2f ms' % warm)
    print('samples:', kept)
    print('  min %.1f ms (%.0f fps)   median %.1f ms (%.0f fps)   max %.1f ms' % (lo, 1000 / lo, med, 1000 / med, r[-1]))
    if mp:
        # A DENSITY DIVIDED OUT OF A PINNED MINIMUM IS NOT A DENSITY. Capped, `lo` is the vsync floor for any page
        # inside budget, so the quotient reports how big the target was and nothing about what a pixel cost.
        pinned = not a.uncapped and lo <= TARGET_MS * 1.05
        print('  %.2f ms per megapixel%s'
              % (lo / mp, '   (vsync-pinned — a floor, not a cost; use --uncapped)' if pinned else ''))
    print()
    # A THROWAWAY PROFILE IS SYSTEMATICALLY PESSIMISTIC, and by a lot. Measured on one machine in one session, in the
    # window-based megapixels this tool no longer prints: ~20 ms/MP here where the user's own warm, long-lived Chrome
    # profile managed ~4.6 -- a factor of four, with hardware acceleration confirmed in both. A fresh profile has
    # no GPU shader cache and no accumulated driver state. So the RATIO between two builds measured here is sound,
    # which is what this tool is for; the ABSOLUTE number is a floor, not a forecast. Cross-check against the same
    # page in your everyday browser before concluding a build is too slow to ship.
    if lo > TARGET_MS:
        print('  NOTE: a throwaway profile has no GPU shader cache and measured ~4x slower than a warm everyday')
        print('  profile on the machine this was written on. Trust the RATIO between builds, not this absolute.')
        print()
    if med > lo * 2.5:
        print('  MACHINE NOT FIT TO MEASURE ON. The median is %.1fx the minimum, which means the minimum is finding'
              % (med / lo))
        print('  gaps between interference rather than measuring the renderer. Close other tabs and applications')
        print('  and run again. Do not trust either number as it stands.')
    elif a.uncapped:
        # UNCAPPED, THE BUDGET IS A RATIO, NOT A PASS MARK. Nothing pins these samples to a step, so the number is
        # what a frame costs -- and the useful statement is how many times over it fits inside the vsync, because
        # that is the margin a slower machine, a bigger window or the next layer has to eat into.
        print('  FRAME COST %.2f ms — %.2fx headroom inside the %.2f ms vsync.' % (lo, TARGET_MS / lo, TARGET_MS))
        if lo > TARGET_MS:
            print('  OVER BUDGET even uncapped: there is no headroom, this is real work to remove.')
    elif lo <= TARGET_MS * 1.05:
        # AT THE FLOOR THE TOOL HAS STOPPED MEASURING, and saying "60fps" without saying so invites the next
        # optimization to be judged by a number that physically cannot move. Point at the mode that can.
        print('  LOCKED AT 60 — %.1f ms against a %.2f ms budget.' % (lo, TARGET_MS))
        print('  The samples are ON THE VSYNC FLOOR, so this is a ceiling on what can be READ, not a measurement')
        print('  of what a frame costs. Re-run with --uncapped to see the real cost and the headroom.')
    else:
        print('  NOT AT 60 — %.1f ms against a %.2f ms budget; %.1f ms/frame still to find.'
              % (lo, TARGET_MS, lo - TARGET_MS))


if __name__ == '__main__':
    main()
