# Working on this repo

## What this is

A CRT terminal calibration instrument: an amber CRT with a curved glass face, a measurement grid, and a
heat-map overlay reporting how hard the surface is being compressed. It is a finished, working desktop tool.

## The first rule: this is working code, not a draft to port

`labs/crt/CRT Lab.dc.html` is an authored component file — markup, logic class, and inline styles in one document, run
by the `support.js` runtime. **This is intentional. Do not convert it to JSX/Vite/a build step, do not extract
the inline styles into CSS classes, and do not "modernize" `support.js`.** A port is a real option later, but
it is a separate decision with a separate plan — not something to do incidentally while fixing a bug.

Likewise `labs/crt/` is eleven **pure** ES modules: no DOM, no component state. That is load-bearing, not
stylistic — see `labs/crt/README.md`. Geometry that can read the component is geometry that can disagree with it,
and every serious bug in this project's history has been two descriptions of the same surface drifting apart.

## There is ONE copy of everything

There used to be a `deploy/` folder holding a byte-for-byte mirror of the lab for GitHub Pages — a second
`index.html`, a second `labs/crt/`, a second `support.js`, a second copy of both handoffs. It was **46% of the
repo** and it was maintained by hand, which meant every edit had to be made twice and a missed copy shipped a
site that silently disagreed with its source. That is the same failure this project's one rule is about, one
level up from the geometry. It is deleted. If Pages is wanted again, serve the repo ROOT — it already works
as-is — or add a script that copies; do not reintroduce a hand-kept mirror.

## Running it

ES modules mean `file://` will not work. Needs a real server from the repo root:

```
python -m http.server 8000     # then http://localhost:8000/labs/crt/CRT%20Lab.dc.html
```

First load needs network: React + Babel from unpkg, fonts from Google.

**Editing anything in `labs/crt/` needs a hard reload**, and a plain reload is not always enough — the browser will
serve the modules from cache while the HTML is fresh, which looks exactly like a maths bug. Either hard-reload
with the cache disabled, or serve with `Cache-Control: no-store`.

## Measuring frame rate: `labs/crt/fps-probe.js`

**Nothing in the lab loads this**, and nothing should — it is an instrument that attaches on demand, so it costs
nothing when it is not in use.

```
<script src="/labs/crt/fps-probe.js"></script>      // or paste the file into the console

CRTFPS.live()          live readout: fps, median, p95, worst, dropped %
CRTFPS.stress()        switch ON everything that animates — the worst case as a STATE, not an opinion
CRTFPS.attribute()     ranked cost per layer, in ms/frame, measured by switching each one off in turn
CRTFPS.arm()           fire as soon as the tab becomes visible, park the answer in localStorage
CRTFPS.report()        read the last stored result
```

### `python bench.py` — the whole measurement in one command

```
python bench.py               # everything animated on, 12 samples, verdict
python bench.py --attribute   # ranked per-layer cost in ms/frame
```

It serves the repo, launches an isolated Chrome with the flags below, warms the profile's cache, drives the page
over CDP and prints the **distribution**, not a single number. It refuses a verdict when `median > 2.5 × min`,
because at that point the minimum is finding gaps between interference rather than measuring the renderer — a
session here read `18.0 ms` once and `35.7 ms` as the minimum of twelve repeats of the identical state.

**Close other tabs and applications first.** Everything below is why the script does what it does.

### The reason this page could not be measured: Chrome stops rendering occluded windows

`document.visibilityState` reads **`hidden` while `document.hasFocus()` is `true`** whenever the Chrome window is
occluded or minimised on Windows — and a hidden page gets **zero** animation frames. Not slow frames. None. Every
frame number this project has ever been quoted from a tab that was not the front-most window was measuring nothing,
and a CDP screenshot forces a single frame, which moves the readout just enough to look alive.

**Launch Chrome like this and the problem disappears:**

```
chrome --user-data-dir=%TEMP%\crt-bench --no-first-run --disable-extensions ^
       --remote-debugging-port=9222 --remote-allow-origins=* ^
       --disable-backgrounding-occluded-windows --disable-renderer-backgrounding ^
       --disable-features=CalculateNativeWinOcclusion ^
       --new-window --window-size=1600,1000 "http://localhost:8000/labs/crt/CRT%20Lab.dc.html"
```

Verified: without those flags the page reported `hidden` and 0 rAF callbacks per second; with them, `visible` and
**57 frames in the first second**. `CalculateNativeWinOcclusion` is the one that matters.

The debugging port then lets you drive the page without a human at the keyboard — `POST /json/new`,
`GET /json/activate/<id>`, and `Runtime.evaluate` over the websocket. A throwaway profile also starts with an EMPTY
HTTP CACHE, so load the page once to pull React/Babel/fonts before measuring anything.

**Measure on an IDLE machine, in ONE tab.** This is not fussiness — it is the difference between a number and a
mood. During the session that built this probe, an *unchanged* build measured 33ms early and 71ms late, and the
per-second curve degraded 36 → 53 → 70 → 88ms *within a single 60s run*, because a dozen lab instances had
accumulated across tabs. Every lab tab holds compositor memory for thirteen blended layers, four blurs and two SVG
reference filters, whether or not it is rendering. Close them all, then measure. Interleaved `attribute()` results
survive this; absolute `record()`/`curve` numbers do not.

A throwaway profile (`chrome --user-data-dir=...`) is the clean room, with one catch: **its HTTP cache is empty**,
so the lab has to pull React, Babel and the fonts off the network before it mounts. Load the page once to warm the
cache, then load it again with `?fps=`. The probe waits 60s for the lab to appear and posts an `error` record if it
never does, rather than failing silently — an earlier 8s budget lost several runs to exactly this.

**A backgrounded tab reports nothing, and the probe refuses to pretend otherwise.** Chrome runs no animation
frames in a tab that is not visible, so the FPS readout in the corner, `window.__crtProf` and every wall-clock
frame measurement read 0–1 there — and a CDP screenshot forces one frame, which moves the number just enough to
look alive. Every measurement in the probe is gated on `document.visibilityState`. That is what `arm()` is for:
a tool driving the tab cannot make the tab visible, so it arms the run, a human brings the window to the front,
and the result is read back from storage afterwards.

Costs are reported in **ms per frame, not fps**. fps deltas are not additive and mislead near the target — a
layer costing 2ms reads as “−25 fps” at 60 and “−3 fps” at 20, for identical work.

JS-side cost *is* measurable in a hidden tab: null the memo keys and time `renderVals()` in a loop. That is
rebuild cost (what a control drag pays), which is a different budget from the per-frame one.

## What local testing is actually for

These are the checks a small embedded preview cannot perform. They are the reason to run it locally at all:

1. **Geometry above 1024px.** There was a long-running "bottom-left corner is messed up" bug that only
   reproduces when the glass exceeds 1024px on both axes. Open the window wide — target ~1560x1100 — and
   inspect the corners at high FACE and high CURVE AREA.
2. **Cold load.** Hard-reload (empty cache) and take no action at all. The first render can land before the
   deferred modules do; the overlay is built from a measured width and only self-corrects if something
   re-renders. On a correct cold load the heat bands hash `19c80928:210984` with zero interaction. Warm
   modules reorder this and hide the bug — that is what makes it intermittent, so test cold.
3. **Resize behaviour.** Drag the window across the 1024px boundary and watch the grid stay aligned to the
   rings. A grid line and its ring must coincide on every ray, by construction.
4. **Settings persistence.** State saves to localStorage under **`crtlab`**, carrying its own `v` (schema 8); the
   versioned keys `crtlab.v1`/`.v4`/`.v5`/`.v6`/`.v7` are read-only migration fallbacks. Confirm a reload restores it.
   The shipped defaults in `state = { … }` are a real saved configuration, not a neutral baseline — to see them you
   need an origin with no stored state, and clearing localStorage then calling `location.reload()` does NOT give you
   one (the unload flush writes the in-memory state straight back). Clear it from a page on the same origin that is
   not the app, then navigate in.

Verify by **measuring, not looking.** `d.split('M').length - 1` counts scan lines. Ring quadrant maxima
sampled with `getPointAtLength` must be equal in all four quadrants — any spread means something is
measuring the mirror rather than the shape.

**Editing anything in `labs/crt/` requires a full page reload before you measure.** The modules do not hot-reload
with the logic class, and a stale module looks exactly like a maths bug.

## Known, deliberate, not bugs

- **SQUIRCLE shapes the guide outline and the clip, not the picture's warp.** Known gap; wiring it to the
  frame toggle is the fix if you want it.
- **CORNER (`state.gn`) is fully dead** — audited: its only appearance in the whole codebase is the `state` literal. It no longer enters `guideKey` either, whatever older notes say.
- **GLARE reaches the fixture only** via `--glarelight`. The stored default is `0`, so a reading of 0 is
  correct, not broken.
- **The rim is unpinned** — the picture sits inside the glass and that gap is real.
- **The corners are cut, not warped.** Settled; the picture ends on the squircle by clip.
- **`fieldFolds`'s 2x threshold no longer bounds anything physical** (it predates the removal of the
  displacement lens) but it still sets how deep FACE bends, and every stored setting is calibrated against
  it. Change it knowingly or not at all.

`labs/crt/CRT Lab HANDOFF.md` has the full "settled decisions — please don't relitigate" list. Read it before
touching projection or geometry.

## Not yet done

- No mobile layout. It is a desktop instrument at ~1560x1100; phones get a cramped version of the same page.
  A "best on desktop" gate would be honest, and is not written.
- No vendored React. Offline use would need unpkg's React/ReactDOM/Babel copied in and the `<script>` tags
  in `support.js` repointed at local files.
