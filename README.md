# Alex Koch — Portfolio & Labs

A portfolio site and a set of **instruments**: single-purpose tools built to make something physical
measurable rather than merely to look like it. The largest of them simulates an amber CRT.

**Live:** https://alexk413x.github.io/alex-koch-portfolio/

Everything here is hand-authored — no build step, no bundler, no framework scaffolding. The geometry and
physics are plain ES modules. Pages come in two kinds: `.dc.html` component files, which pull React and Babel
from a CDN at runtime, and plain module pages, which have no runtime dependency but the fonts.

---

## The CRT lab

The centrepiece, and the reason most of this code exists.
**[CRT GL](labs/crt/CRT%20GL.html)** is an amber CRT solved per pixel in a WebGL2 fragment shader — the face's
curvature, the shadow mask, the beam, the phosphor's persistence and a ray-traced light fitting reflected in the
glass — with a measurement grid and a heat-map overlay reporting how hard the surface is being compressed.

`labs/crt/` is a set of **pure** ES modules: no DOM, no component state. That constraint is load-bearing rather
than stylistic — geometry that can read the renderer is geometry that can disagree with it, and two descriptions
of one surface drifting apart is the failure this project keeps having. See
[`labs/crt/README.md`](labs/crt/README.md).

> There used to be a second, independent DOM/SVG build of the same tube, and the two agreeing was the
> verification story. It is deleted: the GL build looks and performs better, and one renderer that is right beats
> two that have to be kept in step. It is in the history if the cross-check is ever wanted back.

### The other labs

Each is a single fragment shader over a full-screen triangle, decomposed the same way the CRT is: a thin host
page, and pure modules for the shader, the control table and the values.

- **[Reactor Lab](labs/reactor/Reactor.html)** — a containment core, sphere-traced. A goo core with sub-cores torn
  out of it by a pulse, nine alloy ring fragments, and a shield that fails on a schedule.
  See [`labs/reactor/README.md`](labs/reactor/README.md).
- **[Wormhole Lab](labs/wormhole/Wormhole.html)** — a domain-warped noise tunnel, in three flavours.
  See [`labs/wormhole/README.md`](labs/wormhole/README.md).
- **Lab Shell** (`labs/shell/Shell.html`) — not a user-facing page. It is the **base lab**: a live catalogue of
  every control type and every formatter the kit offers, annotated, built on the same scaffold the others use.
  Start there when writing a new lab. Deliberately not linked from the site index.

### One kit, shared

[`labs/kit/`](labs/kit/README.md) holds everything a lab needs that is not about the lab — the panel, the shader
host, the page shell, persistence, the frame loop and the units. Reactor and Wormhole were 113 lines identical
before it existed, which is the same drift the geometry rule above is about, one level up.

---

## Running it locally

ES modules mean `file://` will not work. It needs a real server, from the repository root:

```
python -m http.server 8000
```

Then open http://localhost:8000/ and pick a page.

Two things worth knowing:

- **The labs need no network** beyond the fonts. There is no framework, no CDN and no build step — they load
  their own ES modules and nothing else. The remaining `.dc.html` pages at the repository root still pull React,
  ReactDOM and Babel from unpkg.
- **Editing a module needs a hard reload**, and a plain reload is not always enough: the browser will serve the
  modules from cache while the HTML is fresh, which looks exactly like a maths bug. Serve with
  `Cache-Control: no-store` if you are working on them — `bench.py`'s own server already does.

---

## Measuring

Looking at the screen is not evidence here, so the labs ship the means to measure themselves. Nothing is loaded
by any page — it all attaches on demand, so it costs nothing when unused.

```
python bench.py                       # CRT GL: frame rate as a distribution, with a verdict
python bench.py --page reactor        # any lab: crtgl | reactor | wormhole | shell, or a literal path
python bench.py --uncapped            # frame COST, not frame rate — needed once a page holds 60
python bench.py --inject "<js>"       # pin a setting first, so two runs are comparable
```

`bench.py` serves the repo, launches an isolated Chrome with the flags that stop it from halting rendering
in a window that is not front-most, warms the profile's cache, and drives the page over the DevTools
protocol. It refuses a verdict when the machine is too loaded to measure on, and reports the first sampling
window separately as a warm-up rather than letting it poison that judgement.

- `labs/crt/render-probe.js` — a deterministic render fingerprint for CRT GL. Hashes seven fixed scenes, which
  is how a refactor proves it changed nothing.
- `window.CRTGL`, `window.REACTOR`, `window.WORMHOLE`, `window.SHELL` — every lab publishes a handle carrying
  `state`, `R`, `fit()` and a `renderNow()` that draws **synchronously**, so a frame can be taken from a tab
  that is not front-most, where Chrome delivers no animation frames at all. Read pixels back in the **same
  task** as the call, or a working shader reports as black.
- **Not every `renderNow` is reproducible.** CRT GL's, Wormhole's and Shell's are functions of `(state, time)`
  and give the same frame twice. Reactor's is not — `sim.step` carries phase forward — so a pixel fingerprint
  of that lab means nothing unless the sim is fresh.

**Absolute numbers on a hybrid-GPU machine drift further than most changes being measured.** Compare ratios,
and prefer interleaved A/B or per-pass GPU timer queries to two sequential runs.

---

## Layout

```
labs/crt/       the CRT instrument: twelve pure modules, the GL renderer, a render probe
labs/reactor/   reactor lab:  host page + shader, sim, sidebar, presets
labs/wormhole/  wormhole lab: host page + shader, sidebar, presets
labs/shell/     the BASE LAB — start here when writing a new one
labs/kit/       everything shared: panel, page shell, shader host, persistence, loop, units
support.js      the runtime for the remaining .dc.html pages at the root
bench.py        the frame-rate harness
```

**Every page under `labs/` is plain HTML plus ES modules.** The `.dc.html` files left at the repository root —
the portfolio, the console, the intro and two notes — are single-document components run by `support.js`, which
pulls React and Babel from a CDN. They are on their way out; `support.js` goes with the last of them.

---

## Known limits

- **Designed for desktop, with a narrow-display mode.** These are instruments laid out at around 1560x1100.
  Below 820px the CRT lab folds the control panel away behind a chevron, scales the raster up so the terminal
  text holds its column count (a real set has a fixed line count whatever size the tube is), tightens the
  convergence and beam spot to stay the same fraction of a glyph, drops the moulding for a full-bleed
  picture, and flattens the dome a little to put that area back. Those are one override table plus three
  ratios, applied to a *view* of the settings — the stored configuration is never touched, so a session
  tuned on a desktop survives being opened on a phone. Above 820px nothing is adjusted at all. The panel's
  own control density is still built for a large window.
- **The labs work offline; the root pages do not.** Nothing under `labs/` loads anything but its own modules and
  the fonts. The remaining root `.dc.html` pages would need React, ReactDOM and Babel vendored in.
- **The WebGL labs are demanding.** All three default to a reduced render scale on integrated graphics, and
  **RENDER SCALE** at the top of each panel is the lever if your machine struggles.

## Licence

No licence granted — all rights reserved. Read it, run it, learn from it; please ask before reusing it.
