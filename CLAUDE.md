# Working on this repo

## What this is

A CRT terminal calibration instrument: an amber CRT with a curved glass face, a measurement grid, and a
heat-map overlay reporting how hard the surface is being compressed. It is a finished, working desktop tool.

## The first rule: this is working code, not a draft to rewrite

Every page under `labs/` is finished, measured, working software. **Do not convert one to JSX/Vite/a build step,
do not extract the inline `<style>` blocks into a framework's idea of components, and do not "modernize" what is
already plain.** There is no build step here and that is the point.

`labs/crt/` is twelve **pure** ES modules: no DOM, no component state. That is load-bearing, not stylistic — see
`labs/crt/README.md`. Geometry that can read the renderer is geometry that can disagree with it, and every serious
bug in this project's history has been two descriptions of the same surface drifting apart.

**The DOM/SVG CRT build is gone.** `CRT Lab.dc.html` rendered the same tube thirteen blended layers deep, and the
two builds agreeing was the verification story. It was deleted deliberately on 2026-08-08: the GL build looks and
performs better, and one renderer that is right beats two that must be kept in step. Deleted with it, because
nothing else reached them: `crt-controls.js`, `crt-fixture.js`, `crt-vars.js`, `crt-warp.js`, `crt-glow.js`,
`crt.css`, `fps-probe.js`. It is all in the history if the cross-check is ever wanted back.

## There is ONE copy of everything

There used to be a `deploy/` folder holding a byte-for-byte mirror of the lab for GitHub Pages — a second
`index.html`, a second `labs/crt/`, a second `support.js`, a second copy of both handoffs. It was **46% of the
repo** and it was maintained by hand, which meant every edit had to be made twice and a missed copy shipped a
site that silently disagreed with its source. That is the same failure this project's one rule is about, one
level up from the geometry. It is deleted. If Pages is wanted again, serve the repo ROOT — it already works
as-is — or add a script that copies; do not reintroduce a hand-kept mirror.

The same rule caught the **control panel**, which existed three times: inline in CRT Lab, again in the DC
`Sidebar.dc.html`, and a third time in `components/ControlPanel.dc.html`. All that survives is
`labs/kit/panel.js` + `panel.css`, and every lab uses it, tinted through custom properties. **Do not add a
second.** It caught the **host scaffolding** too: Reactor and Wormhole came out 113 lines identical — 58% of one
of them — and that is now `labs/kit/lab.js`.

## Everything under labs/ is plain HTML, and that direction is settled

There is no framework, no CDN and no build step in any lab. `labs/kit/` is the shared kit; a lab is a thin host
page plus pure modules for its shader, its sim, its control table and its values.

**The home page is now a consumer of `labs/`.** `site/hero-core.js` imports `labs/kit/glquad.js`, `labs/kit/lab.js`
and four of `labs/reactor/`'s modules to draw the reactor's core, alone and ring-off, behind the hero. It is the
lab's scene, not a copy of it — the uniform block both pages upload lives in `labs/reactor/reactor-uniforms.js`
for that reason. So `labs/` is no longer only a lab: renaming or deleting anything in it breaks `index.html`.

**Start a new lab from `labs/shell/Shell.html`.** It is the base lab — a live catalogue of every control type and
every formatter, annotated with why each is the kind it is, built on the same scaffold the real labs use. It is
not linked from the index and is not meant for users.

Five `.dc.html` pages remain **at the repository root** — the portfolio, the console, the intro and two notes.
They still run on `support.js` (React + Babel from unpkg). They are on their way out, and `support.js` goes with
the last of them. Migrating one is a deliberate job with measurements either side, not something to do
incidentally.

## Running it

ES modules mean `file://` will not work. Needs a real server from the repo root:

```
python -m http.server 8000     # then http://localhost:8000/labs/crt/CRT%20Lab.dc.html
```

First load needs network: React + Babel from unpkg, fonts from Google.

**Editing anything in `labs/crt/` needs a hard reload**, and a plain reload is not always enough — the browser will
serve the modules from cache while the HTML is fresh, which looks exactly like a maths bug. Either hard-reload
with the cache disabled, or serve with `Cache-Control: no-store`.

## Measuring frame rate

`fps-probe.js` and its `CRTFPS.stress()` / `CRTFPS.attribute()` went with the DOM build — they knew that lab's
thirteen layers by name, and nothing else has layers to attribute cost to. What remains is the harness and each
lab's own handle.

### `python bench.py` — the whole measurement in one command

```
python bench.py                     # CRT Lab, 12 samples, verdict
python bench.py --page reactor      # any lab: crt | reactor | wormhole | shell, or a literal path
python bench.py --uncapped          # frame COST, not frame rate
python bench.py --inject "<js>"     # pin a setting first, so two runs are comparable
```

The sampler needs nothing from the page, but it also cannot fix the page's state — a run measures whatever was
restored, which on a fresh bench profile is the shipped default. **`--inject` is how you pin one**, and it is
required for any before/after comparison:

```
python bench.py --page reactor --uncapped --inject "REACTOR.state.renderScale=0.62; REACTOR.fit(true); 1"
```

The **first sampling window is excluded as a warm-up**: uncapped with an idle compositor it comes back at well
under 1 ms where every later window sits at 4–6 ms, and it was making the tool refuse a verdict on runs whose
remaining samples agreed to within 5%.

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
mood. During one session an *unchanged* build measured 33ms early and 71ms late, and the per-second curve degraded
36 → 53 → 70 → 88ms *within a single 60s run*, because a dozen lab instances had accumulated across tabs. Every lab
tab holds a live WebGL context and its buffers whether or not it is rendering. Close them all, then measure.
Interleaved A/B results survive this; absolute numbers do not.

A throwaway profile (`chrome --user-data-dir=...`) is the clean room, with one catch: **its HTTP cache and its GPU
shader cache are both empty**, so the first run recompiles every shader. `bench.py` warms the profile for you, and
`--warm` reuses it. The harness measured ~4x pessimistic cold against the same page in a warm everyday profile.

**A backgrounded tab reports nothing.** Chrome runs no animation frames in a tab that is not visible, so every
wall-clock frame measurement reads 0–1 there — and a CDP screenshot forces one frame, which moves the number just
enough to look alive. Each lab pauses its loop on `visibilitychange` deliberately, so a frozen clock in a hidden
tab is correct behaviour and not a fault. **`renderNow()` is the way round it**: it draws synchronously and needs
no animation frame at all.

Costs are reported in **ms per frame, not fps**. fps deltas are not additive and mislead near the target — a
layer costing 2ms reads as "−25 fps" at 60 and "−3 fps" at 20, for identical work.

## What local testing is actually for

These are the checks a small embedded preview cannot perform. They are the reason to run it locally at all:

1. **Geometry above 1024px.** There was a long-running "bottom-left corner is messed up" bug that only
   reproduces when the glass exceeds 1024px on both axes. Open the window wide — target ~1560x1100 — and
   inspect the corners at high FACE and high CURVE AREA.
2. **Resize behaviour.** Drag the window across the 1024px boundary and watch the grid stay aligned to the
   rings. A grid line and its ring must coincide on every ray, by construction. Then hide the panel with the
   chevron: the stage grows without the window changing, and a buffer sized from `innerWidth` instead of the
   stage would stretch here.
3. **Settings persistence.** Each lab stores under its own key — `crtgl`, `reactor`, `wormhole`, `labshell` —
   and **`crtgl` deliberately no longer matches its lab's name**: a storage key is an address, not a label, and
   moving it orphans every stored configuration silently. See the note above `SAVE_KEY` before touching it —
   carrying a `v` that is checked on the way in. The shipped defaults are a real saved configuration, not a
   neutral baseline, so to see them you need an origin with no stored state; clearing localStorage and calling
   `location.reload()` does NOT give you one, because the flush on hide writes the in-memory state straight back.
   Clear it from a page on the same origin that is not the app, then navigate in.
4. **Context loss.** `WEBGL_lose_context` on the canvas, then restore. The page must rebuild rather than stay
   black — and every uniform must be re-sent, which is why `glquad` clears its dirty cache on relink.

Verify by **measuring, not looking.** Ring quadrant maxima must be equal in all four quadrants — any spread means
something is measuring the mirror rather than the shape.

**Editing any module requires a full page reload before you measure.** A stale cached module looks exactly like a
maths bug.

## Known, deliberate, not bugs

- **SQUIRCLE shapes the guide outline and the clip, not the picture's warp.** Known gap; wiring it to the
  frame toggle is the fix if you want it.
- **GLARE reaches the fixture only.** The stored default is `0`, so a reading of 0 is correct, not broken.
- **The rim is unpinned** — the picture sits inside the glass and that gap is real.
- **Reactor's ring pattern does not travel with a scattered fragment.** The nine pieces are displaced and tumbled
  inside `ringSDF`, but the shading reads `ringSpace(hp)` — the unscattered frame — so a flown-off piece's machined
  surface swims across it rather than riding on it. Fixing it means returning the per-piece transform out of the
  SDF. The pieces are small on screen for most of a break, which is why it has not been worth that.
- **The corners are cut, not warped.** Settled; the picture ends on the squircle by clip.
- **Wormhole compiles a shader per layer set, and two of them do not agree to the last bit.** Separately
  compiled programs schedule their arithmetic differently. Across 120 whole-frame comparisons, seven differed —
  four subpixels out of 691,200, each off by one of 255. Compare permutations by how far apart they are, never
  by a hash.
- **`fieldFolds`'s 2x threshold no longer bounds anything physical** (it predates the removal of the
  displacement lens) but it still sets how deep FACE bends, and every stored setting is calibrated against
  it. Change it knowingly or not at all.

`labs/crt/CRT Lab HANDOFF.md` has the full "settled decisions — please don't relitigate" list. **It is named for
a build that no longer exists, and most of it still binds**: the projection, the outline and the geometry it
argues about are the shared modules CRT Lab walks. Read it before touching either. Its companion
`CRT Lab LAYER HANDOFF.md` is more mixed — the thirteen-layer model is gone with the DOM build, but the sections
on the face's shape and the rim's pinning are still current.

## Not yet done

- **The root pages are still `.dc.html`.** Portfolio, Console OS, Cinematic Intro and the two notes. They are the
  last users of `support.js`, React and Babel; migrating them retires all three.
- **Reactor's two frozen uniforms** (above) are uncut.
- **Reactor's `renderNow` is not reproducible**, because `sim.step` carries phase forward — so that lab has no
  render fingerprint of the kind `render-probe.js` gives CRT Lab. Resetting the sim would be the way in.
- **Mobile is a fold-away panel, not a layout.** Below 820px wide *or 500px tall* each lab hides its panel behind
  a chevron and CRT Lab applies a small-display override table; the control density is still built for a large
  window. **Both halves of that test are load-bearing** — a phone on its side is 852x393, wide enough to pass any
  width test — and the pair lives in three places that must move together: `NARROW_W`/`SHORT_H` in CRT Lab, the
  `breakpoint`/`shortSide` defaults in `labs/kit/panel.js`, and the `(max-width), (max-height)` queries in
  `panel.css` and `lab.css`. A stylesheet cannot be read from the script; if they disagree the panel overlays the
  stage while the script still believes it is in the flow.
