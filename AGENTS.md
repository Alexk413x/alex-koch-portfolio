# Working on this repo

## What this is

A portfolio site and three WebGL instruments, hand-authored, with no build step. `index.html` is a
scroll-driven home page; `labs/` holds a CRT, a reactor core and a wormhole, each a fragment shader with a
control panel and a measurement story. Live at **https://alexk413x.com**.

Area notes live in `.claude/rules/`. Read the one that matches your task before you start it:

- `.claude/rules/intro.md`: the once-per-session intro in `site/intro/`.
- `.claude/rules/measuring.md`: frame-rate measurement with `bench.py`.
- `.claude/rules/lab-quirks.md`: known, deliberate lab behavior that is not a bug, and unfinished lab work.

## The first rule: this is working code, not a draft to rewrite

Every page under `labs/` is finished, measured, working software. **Do not convert one to JSX/Vite/a build step,
do not extract the inline `<style>` blocks into a framework's idea of components, and do not "modernize" what is
already plain.** There is no build step here and that is the point.

`labs/crt/` is twelve **pure** ES modules: no DOM, no component state. That is load-bearing, not stylistic — see
`labs/crt/README.md`. Geometry that can read the renderer is geometry that can disagree with it, and every
serious bug in this project's history has been two descriptions of the same surface drifting apart.

## There is one copy of everything

The same fault, one level up from the geometry. It has been caught three times:

- A `deploy/` folder mirroring the whole site for Pages, hand-maintained, so a missed copy shipped a site that
  disagreed with its source. **Pages serves the repo root**; see *Deploying* below.
- The control panel, which existed three times. All that survives is `labs/kit/panel.js` + `panel.css`, used by
  every lab and tinted through custom properties. **Do not add a second.**
- The host scaffolding: Reactor and Wormhole were 113 lines identical. That is `labs/kit/lab.js`.

**The DOM/SVG CRT build is gone.** One renderer that is right beats two that must be kept in step; do not
reintroduce a second build.

**`maproom/` is the one deliberate copy, and it is generated.** It is a snapshot of cartographer's viewer and the
RPN Dominator Calculator survey, which live in other repositories. `python maproom.py ui|data` writes all of it
(see `README.md`). Never edit it by hand: the next refresh overwrites the edit, and a hand fix would make the
snapshot disagree with the tool that wrote it.

## Plain HTML, and that direction is settled

No framework, no CDN, no build step in any lab. A lab is a thin host page plus pure modules for its shader, its
sim, its control table and its values. `labs/kit/` is the shared kit.

**The home page is a consumer of `labs/`.** `site/hero-core.js` imports `labs/kit/glquad.js`, `labs/kit/lab.js`
and four of `labs/reactor/`'s modules to draw the reactor's core behind the hero. It is the lab's scene, not a
copy — the uniform block both pages upload lives in `labs/reactor/reactor-uniforms.js` for that reason. So
renaming or deleting anything in `labs/` breaks `index.html`.

**Start a new lab from `labs/shell/Shell.html`.** It is the base lab — a live catalog of every control type and
formatter, annotated, on the same scaffold the real labs use. Not linked from the index, not meant for users.

**`labs/kit/boot-guard.js` is deliberately not a module. Do not convert it.** A module body does not run if any
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

To verify a change, run the whole suite: `python test/run.py` (headless, several minutes; the QR suite needs
`opencv-python` and reports SKIP without it). `--only <suite>` runs a subset; see `test/README.md`.

After a comment-only edit, run `python .claude/comment-check.py`. It exits 1 if any code moved.

**Never put a backtick in a comment inside a GLSL template literal.** The shaders are template strings, so a
backtick there is not comment text — it closes the string, and everything after it parses as code. In pairs
(`` `graze` ``) it closes and reopens, which can parse cleanly while silently truncating the shader. Write the
identifier bare. `python test/run.py --only labs` catches it; nothing else does.

Editing anything in `labs/crt/` needs a hard reload, and a plain reload is not always enough — the browser
serves the modules from cache while the HTML is fresh, which looks exactly like a math bug. Hard-reload with the
cache disabled, or serve with `Cache-Control: no-store`.

## Deploying

`.github/workflows/pages.yml` deploys the repo root to GitHub Pages on every push to `main`. It uses a workflow
rather than the built-in branch deploy because the branch deploy wedged in `queued` for hours with no runner
assigned. **The workflow strips the tooling** — `bench.py`, `site-url.py`, `maproom.py`, `test`, `.githooks`,
`knowledge`, `.claude`, `CLAUDE.md`, `AGENTS.md` — from the artifact before upload. A branch deploy would not, and would
publish all of it. Anything else committed at the root is published.

**Move the site's address with `python site-url.py https://<host>/`, never by hand.** Six things cannot be
relative — the canonical URL, the OG URL, the OG image, the sitemap `<loc>`s, robots' `Sitemap:` line and the QR
encoder's string — and the script moves all of them at once. `README.md` is in its list too, for the live URL
in its header. `python test/run.py --only seo` fails when they disagree, and the suite asserts its own list and
the script's are the same list, so a file that writes the address cannot be added to one and missed by the other.

Two traps:

- **Do not change the Pages custom domain while a deploy is in flight.** Pages sits in `updating_pages` during
  the change and `deploy-pages` gives up after ~90s, leaving a deployment GitHub holds as "in progress" while
  its own API reports it `deployment_cancelled`. Every later deploy 400s for ~25 minutes and no API clears it.
- **Do not use "Re-run failed jobs" on this workflow.** The re-run uploads a second artifact named
  `github-pages` into the same run and `deploy-pages` refuses to choose. Start a fresh run —
  `workflow_dispatch` is on the workflow for exactly this.

## What local testing is for

The checks a small embedded preview cannot perform:

1. **Geometry above 1024px.** A long-running "bottom-left corner is messed up" bug only reproduces when the
   glass exceeds 1024px on both axes. Open wide — target ~1560x1100 — and inspect the corners at high FACE and
   high CURVE AREA.
2. **Resize behavior.** Drag across the 1024px boundary and watch the grid stay aligned to the rings; a grid
   line and its ring must coincide on every ray, by construction. Then hide the panel with the chevron: the
   stage grows without the window changing, and a buffer sized from `innerWidth` would stretch here.
3. **Settings persistence.** Each lab stores under its own key — `crtgl`, `reactor`, `tunnel`, `labshell` — and
   **neither `crtgl` nor `tunnel` matches its lab's name**: a storage key is an address, not a label, and moving
   it orphans every stored configuration silently. Wormhole stores under `tunnel` because that is what it was
   called while it was built; taking `wormhole` would also have handed it the *previous* occupant's saved state.
   See the note above `SAVE_KEY` before touching it. The shipped defaults are a real saved configuration, so to
   see them you need an origin with no stored state — clearing localStorage and calling `location.reload()` does
   not give you one, because the flush on hide writes the in-memory state straight back. Clear it from a page on
   the same origin that is not the app, then navigate in.
4. **Context loss.** `WEBGL_lose_context` on the canvas, then restore. The page must rebuild rather than stay
   black — and every uniform must be re-sent, which is why `glquad` clears its dirty cache on relink.

Verify by **measuring, not looking.** Ring quadrant maxima must be equal in all four quadrants — any spread means
something is measuring the mirror rather than the shape.

**Editing any module requires a full page reload before you measure.** A stale cached module looks exactly like a
math bug.

**`index.html?debug` puts the hero core's pointer state on screen** — viewport, reach, finger and core positions,
the distance between them, `target`/`near`, `churn`, `visc`, `--ring-o`, and counters for `touchmove`,
`pointercancel` and `pointerleave`. It exists because a phone has no console attached: a real device answers in
one look whether the finger is out of REACH, whether `touchmove` survives the scroll takeover, or whether the
scene rig has faded the core out on schedule.
