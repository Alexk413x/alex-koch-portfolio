# Alex Koch — Portfolio & Labs

A portfolio site and a set of **instruments**: single-purpose tools built to make something physical
measurable rather than merely to look like it. The largest of them simulates an amber CRT.

**Live:** https://alexk413x.github.io/alex-koch-portfolio/

Everything here is hand-authored — no build step, no bundler, no framework scaffolding. Pages are plain
HTML that pull React and Babel from a CDN at runtime; the geometry and physics are plain ES modules.

---

## The CRT lab

The centrepiece, and the reason most of this code exists. An amber CRT with a curved glass face, a
measurement grid, and a heat-map overlay reporting how hard the surface is being compressed. It exists in
two independent builds that render the same tube by different means:

| | | |
|---|---|---|
| **[CRT GL](labs/crt/CRT%20GL.html)** | WebGL2 | The tube as a fragment shader — the face, the shadow mask, the beam, the phosphor's persistence and a ray-traced light fitting reflected in the glass, all solved per pixel. |
| **[CRT Lab](labs/crt/CRT%20Lab.dc.html)** | DOM / SVG | The original. Thirteen blended layers, the curve *plotted* into SVG paths rather than resampled, and CSS custom properties driven per frame. |

The two agree because they share their maths. `labs/crt/` is a set of **pure** ES modules — no DOM, no
component state — and both builds walk the same `faceShaped` projection, the same `guideOutline`, the same
flicker state machines. That constraint is load-bearing rather than stylistic: geometry that can read the
renderer is geometry that can disagree with it, and two descriptions of one surface drifting apart is the
failure this project keeps having. See [`labs/crt/README.md`](labs/crt/README.md).

### The other labs

- **[Reactor Lab](labs/reactor/Reactor%20Lab.dc.html)**
- **[Wormhole Lab](labs/wormhole/Wormhole%20Lab.dc.html)**
- **[Lab Shell](lab/Lab%20Shell.dc.html)** — the reference lab: every control type the shared sidebar
  offers, wired correctly. Start here if you want to see how a lab is put together.

---

## Running it locally

ES modules mean `file://` will not work. It needs a real server, from the repository root:

```
python -m http.server 8000
```

Then open http://localhost:8000/ and pick a page.

Two things worth knowing:

- **The first load needs network** — React, ReactDOM and Babel come from unpkg, and the fonts from Google.
- **Editing anything in `labs/crt/` needs a hard reload**, and a plain reload is not always enough: the
  browser will serve the modules from cache while the HTML is fresh, which looks exactly like a maths bug.
  Serve with `Cache-Control: no-store` if you are working on them.

---

## Measuring

The CRT lab ships its own instruments, because on this subject looking at the screen is not evidence.
None of them are loaded by the page — they attach on demand, so they cost nothing when unused.

```
python bench.py               # frame rate, as a distribution, with a verdict
python bench.py --attribute   # ranked per-layer cost in ms/frame
```

`bench.py` serves the repo, launches an isolated Chrome with the flags that stop it from halting rendering
in a window that is not front-most, warms the profile's cache, and drives the page over the DevTools
protocol. It refuses a verdict when the machine is too loaded to measure on.

- `labs/crt/fps-probe.js` — live readout, stress state, and per-layer attribution for the DOM build.
- `labs/crt/render-probe.js` — a deterministic render fingerprint for the GL build. Hashes seven fixed
  scenes, which is how a refactor proves it changed nothing.

---

## Layout

```
labs/crt/       the CRT instrument: eleven pure modules, two renderers, two probes
labs/reactor/   reactor lab
labs/wormhole/  wormhole lab
lab/            shared lab kit — sidebar, control plumbing, visual defaults
ui/             the panel used by the WebGL build
components/     shared components
support.js      the runtime that renders the .dc.html component files
bench.py        the frame-rate harness
```

`.dc.html` files are single-document components — markup, logic class and inline styles in one file, run by
`support.js`. They are standalone pages: open one directly and it bootstraps itself.

---

## Known limits

- **Designed for desktop.** These are instruments laid out at around 1560x1100. Below 820px the control
  panel folds away behind a **CONTROLS** button so the tube gets the screen to itself, and it slides over
  the picture rather than reflowing it — but the readouts and the control density are still built for a
  large window.
- **No vendored dependencies.** Offline use would need React, ReactDOM and Babel copied in locally.
- The WebGL build is demanding. It defaults to a reduced render scale on integrated graphics, and
  **RENDER SCALE** in the panel is the lever if your machine struggles.

## Licence

No licence granted — all rights reserved. Read it, run it, learn from it; please ask before reusing it.
