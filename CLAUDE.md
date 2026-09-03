# Working on this repo

## What this is

A portfolio site and three WebGL instruments, hand-authored, with no build step. `index.html` is a
scroll-driven home page; `labs/` holds a CRT, a reactor core and a wormhole, each a fragment shader with a
control panel and a measurement story. Live at **https://alexk413x.com**.

## The first rule: this is working code, not a draft to rewrite

Every page under `labs/` is finished, measured, working software. **Do not convert one to JSX/Vite/a build step,
do not extract the inline `<style>` blocks into a framework's idea of components, and do not "modernize" what is
already plain.** There is no build step here and that is the point.

`labs/crt/` is twelve **pure** ES modules: no DOM, no component state. That is load-bearing, not stylistic — see
`labs/crt/README.md`. Geometry that can read the renderer is geometry that can disagree with it, and every
serious bug in this project's history has been two descriptions of the same surface drifting apart.

## There is ONE copy of everything

The same fault, one level up from the geometry. It has been caught three times:

- A `deploy/` folder mirroring the whole site for Pages — 46% of the repo, hand-maintained, so a missed copy
  shipped a site that disagreed with its source. **Pages now serves the repo root**; see *Deploying* below.
- The control panel, which existed three times. All that survives is `labs/kit/panel.js` + `panel.css`, used by
  every lab and tinted through custom properties. **Do not add a second.**
- The host scaffolding: Reactor and Wormhole were 113 lines identical. That is now `labs/kit/lab.js`.

**The DOM/SVG CRT build is gone**, deleted 2026-08-08 along with `crt-controls.js`, `crt-fixture.js`,
`crt-vars.js`, `crt-warp.js`, `crt-glow.js`, `crt.css` and `fps-probe.js`. Two builds agreeing was the old
verification story; one renderer that is right beats two that must be kept in step. It is all in the history.

## Plain HTML, and that direction is settled

No framework, no CDN, no build step in any lab. A lab is a thin host page plus pure modules for its shader, its
sim, its control table and its values. `labs/kit/` is the shared kit.

**The home page is a consumer of `labs/`.** `site/hero-core.js` imports `labs/kit/glquad.js`, `labs/kit/lab.js`
and four of `labs/reactor/`'s modules to draw the reactor's core behind the hero. It is the lab's scene, not a
copy — the uniform block both pages upload lives in `labs/reactor/reactor-uniforms.js` for that reason. So
renaming or deleting anything in `labs/` breaks `index.html`.

**Start a new lab from `labs/shell/Shell.html`.** It is the base lab — a live catalog of every control type and
formatter, annotated, on the same scaffold the real labs use. Not linked from the index, not meant for users.

**`labs/kit/boot-guard.js` is deliberately NOT a module. Do not convert it.** A module body does not run if any
import fails to fetch, so one 503 skips both `mountLoader()` and `labReady()` and leaves an opaque black sheet
a viewer cannot tell from a slow load. A guard inside that graph would be skipped with it, which is why it is a
classic script loaded *before* the entry module in every lab. It reloads once, flagged in `sessionStorage`, and
`labReady()` clears the flag on success. Nothing tests this; converting it breaks it silently.

## Running it

ES modules mean `file://` will not work. Needs a real server from the repo root:

```
python -m http.server 8000     # then http://localhost:8000/labs/crt/CRT%20Lab.html
```

First load needs network for the fonts from Google, and nothing else.

**NEVER put a backtick in a comment inside a GLSL template literal.** The shaders are template strings, so a
backtick there is not comment text — it closes the string, and everything after it parses as code. In pairs
(`` `graze` ``) it closes and reopens, which can parse cleanly while silently truncating the shader. Write the
identifier bare. `python test/run.py --only labs` catches it; nothing else does.

**Editing anything in `labs/crt/` needs a hard reload**, and a plain reload is not always enough — the browser
serves the modules from cache while the HTML is fresh, which looks exactly like a math bug. Hard-reload with the
cache disabled, or serve with `Cache-Control: no-store`.

## Deploying

`.github/workflows/pages.yml` deploys the repo root to GitHub Pages on every push to `main`. It uses a workflow
rather than the built-in branch deploy because the branch deploy wedged: two runs sat `queued` for 46 minutes
and four hours with no runner assigned. **The workflow strips the tooling** — `bench.py`, `site-url.py`, `test`,
`.githooks`, `knowledge`, `.claude`, `CLAUDE.md` — from the artifact before upload. A branch deploy would not,
and would publish all of it.

**Move the site's address with `python site-url.py https://<host>/`, never by hand.** Six things cannot be
relative — the canonical URL, the OG URL, the OG image, the sitemap `<loc>`s, robots' `Sitemap:` line and the QR
encoder's string — and the script moves all of them at once. `README.md` is in its list too, for the live URL
in its header. `python test/run.py --only seo` fails when they disagree, and the suite asserts its own list and
the script's are the same list, so a file that writes the address cannot be added to one and missed by the other.

Two traps, both hit on 2026-08-27:

- **Never change the Pages custom domain while a deploy is in flight.** Pages sits in `updating_pages` during
  the change and `deploy-pages` gives up after ~90s, leaving a deployment GitHub holds as "in progress" while
  its own API reports it `deployment_cancelled`. Every later deploy 400s for ~25 minutes and no API clears it.
- **Never use "Re-run failed jobs" on this workflow.** The re-run uploads a second artifact named
  `github-pages` into the same run and `deploy-pages` refuses to choose. Start a fresh run —
  `workflow_dispatch` is on the workflow for exactly this.

## The intro

`site/intro/` plays a once-per-session sequence over the home page: the CRT terminal, Enter, warp and surge,
power-off with the wormhole already opening under it (`open`: a small ring comes to the viewer, the tube forms
and backs off), a cruise with the bend's direction wandering, a `run` that straightens and brings the hole up
close, a crossfade onto the reactor on the hero's own canvas with its ring in frame, then the lab's three
presets in turn, STABLE, CRITICAL, MELTDOWN, tweened key by key with the camera pulling out, the vent, the
break, and a cool-down to the hero's orange at STABLE motion. The last frame IS the hero's idle frame; the
director never draws.

- **The CRT and the wormhole run in same-origin iframes of their own lab pages with `?intro`**, which strips the
  chrome, skips the stored settings (no `persist()` at all, or its pagehide flush would overwrite the visitor's
  own), and applies each lab's `introPreset`. The wormhole's carries the values Alex dialled in the lab, baked,
  so the intro is the same in every browser; re-bake when the lab changes. `&panel` keeps the lab's panel for
  tuning live. The reactor leg
  is `window.HERO` driven through `take()` / `release()`; while taken, `draw()` writes none of its own state.
- **The head script decides before first paint** (`AK_INTRO`, `html.intro-live`) so the sheet is true for the
  first frame. `?intro` forces, `?nointro`, any hash, reduced motion or `sessionStorage['intro-seen']` skip.
  If `intro.js` never runs, the head script drops the sheet after 6s.
- **Beats are data in `intro-script.js`**; every length is a number there. Heavy legs end on readiness gates,
  not timers: the reactor's full program is a 12s link on the UHD 630, so the settle beat holds for it.
  `?intro&hud` shows the beat, gates and frame rate; `?intro&from=worm|hero` starts part-way in.
- **The harness marks the intro seen before every navigation** (`Page.addScriptToEvaluateOnNewDocument`), so
  the other suites see the page a returning visitor sees. `suite_intro` forces it and unmarks it deliberately.
- Two traps hit on 2026-09-02: a rule on `#intro` loses to `html.intro-live #intro` on specificity, so the
  sheet never went clear for the reactor leg; and the CRT typed at most one character per frame, so a frame
  rate halved by a shader link beside it halved the typing. Both are fixed in place and commented.

## Measuring frame rate

### `python bench.py` — the whole measurement in one command

```
python bench.py                     # CRT Lab, 12 samples, verdict
python bench.py --page reactor      # any lab: crt | reactor | wormhole | shell, or a literal path
python bench.py --uncapped          # frame COST, not frame rate
python bench.py --inject "<js>"     # pin a setting first, so two runs are comparable
```

It serves the repo, launches an isolated Chrome, warms the profile's cache, drives the page over CDP and prints
the **distribution**, not a single number. It refuses a verdict when `median > 2.5 × min`, because at that point
the minimum is finding gaps between interference rather than measuring the renderer.

A run measures whatever state was restored, which on a fresh bench profile is the shipped default. **`--inject`
is how you pin one**, and it is required for any before/after comparison:

```
python bench.py --page reactor --uncapped --inject "REACTOR.state.renderScale=0.62; REACTOR.fit(true); 1"
```

The **first sampling window is excluded as a warm-up**: uncapped with an idle compositor it returns well under
1 ms where every later window sits at 4–6 ms, which was making the tool refuse verdicts on runs whose remaining
samples agreed to within 5%.

### Why this page could not be measured: Chrome stops rendering occluded windows

`document.visibilityState` reads **`hidden` while `document.hasFocus()` is `true`** whenever the Chrome window is
occluded or minimized on Windows — and a hidden page gets **zero** animation frames. Not slow frames. None. Every
frame number quoted from a tab that was not front-most measured nothing, and a CDP screenshot forces a single
frame, which moves the readout just enough to look alive.

`bench.py` launches with the flags that fix it. **`--disable-features=CalculateNativeWinOcclusion` is the one
that matters**; `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding` go with it.
Verified: without them the page reported `hidden` and 0 rAF callbacks per second; with them, `visible` and 57
frames in the first second.

**`renderNow()` is the way round it entirely** — it draws synchronously and needs no animation frame. Each lab
pauses its loop on `visibilitychange` deliberately, so a frozen clock in a hidden tab is correct, not a fault.

**Measure on an IDLE machine, in ONE tab.** An *unchanged* build measured 33ms early and 71ms late in one
session, degrading 36 → 53 → 70 → 88ms within a single 60s run, because a dozen lab instances had accumulated
across tabs. Every lab tab holds a live WebGL context and its buffers whether or not it is rendering. A throwaway
profile is the clean room, with one catch: its HTTP and GPU shader caches are both empty, so the first run
recompiles every shader — measured ~4x pessimistic cold. `bench.py` warms it; `--warm` reuses it.

Costs are reported in **ms per frame, not fps**. fps deltas are not additive and mislead near the target — a
layer costing 2ms reads as "−25 fps" at 60 and "−3 fps" at 20, for identical work.

## What local testing is actually for

The checks a small embedded preview cannot perform:

1. **Geometry above 1024px.** A long-running "bottom-left corner is messed up" bug only reproduces when the
   glass exceeds 1024px on both axes. Open wide — target ~1560x1100 — and inspect the corners at high FACE and
   high CURVE AREA.
2. **Resize behavior.** Drag across the 1024px boundary and watch the grid stay aligned to the rings; a grid
   line and its ring must coincide on every ray, by construction. Then hide the panel with the chevron: the
   stage grows without the window changing, and a buffer sized from `innerWidth` would stretch here.
3. **Settings persistence.** Each lab stores under its own key — `crtgl`, `reactor`, `tunnel`, `labshell` — and
   **NEITHER `crtgl` NOR `tunnel` matches its lab's name**: a storage key is an address, not a label, and moving
   it orphans every stored configuration silently. Wormhole stores under `tunnel` because that is what it was
   called while it was built; taking `wormhole` would also have handed it the *previous* occupant's saved state.
   See the note above `SAVE_KEY` before touching it. The shipped defaults are a real saved configuration, so to
   see them you need an origin with no stored state — clearing localStorage and calling `location.reload()` does
   NOT give you one, because the flush on hide writes the in-memory state straight back. Clear it from a page on
   the same origin that is not the app, then navigate in.
4. **Context loss.** `WEBGL_lose_context` on the canvas, then restore. The page must rebuild rather than stay
   black — and every uniform must be re-sent, which is why `glquad` clears its dirty cache on relink.

Verify by **measuring, not looking.** Ring quadrant maxima must be equal in all four quadrants — any spread means
something is measuring the mirror rather than the shape.

**Editing any module requires a full page reload before you measure.** A stale cached module looks exactly like a
math bug.

**`index.html?debug` puts the hero core's pointer state on screen** — viewport, reach, finger and core positions,
the distance between them, `target`/`near`, `churn`, `visc`, `--ring-o`, and counters for `touchmove`,
`pointercancel` and `pointerleave`. It exists because a phone has no console attached, which is what made the
touch path guesswork: a real device answers in one look whether the finger is out of REACH, whether `touchmove`
survives the scroll takeover, or whether the scene rig has simply faded the core out on schedule.

## Known, deliberate, not bugs

- **SQUIRCLE shapes the guide outline and the clip, not the picture's warp.** Known gap; wiring it to the frame
  toggle is the fix if you want it.
- **GLARE reaches the fixture only.** The stored default is `0`, so a reading of 0 is correct, not broken.
- **The rim is unpinned** — the picture sits inside the glass and that gap is real.
- **The corners are cut, not warped.** Settled; the picture ends on the squircle by clip.
- **Reactor's ring pattern does not travel with a scattered fragment.** The nine pieces are displaced and tumbled
  inside `ringSDF`, but the shading reads `ringSpace(hp)` — the unscattered frame — so a flown-off piece's
  machined surface swims across it rather than riding on it. Fixing it means returning the per-piece transform
  out of the SDF. The pieces are small on screen for most of a break, which is why it has not been worth that.
- **The tunnel's grain rings are gone but the speckle is not.** The concentric banding was `graze`, differenced
  over a bracket the refinement had already collapsed, and it is fixed. The remaining stipple along the nebula's
  edges is the noise field genuinely outrunning the sample rate where the wall goes edge-on — a filtering
  problem, not a bug.
- **`fieldFolds`'s 2x threshold no longer bounds anything physical** (it predates the removal of the displacement
  lens) but it still sets how deep FACE bends, and every stored setting is calibrated against it. Change it
  knowingly or not at all.

## Not yet done

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
