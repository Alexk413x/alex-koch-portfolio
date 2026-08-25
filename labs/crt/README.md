# CRT Lab modules

`CRT Lab.html` is the view: sizing the glass, driving the panel, composing the boot text, running the frame loop.
Everything below is logic, and none of it can reach the page — **no DOM, no component state**. That is the rule the
instrument is built on: there is one surface, described once, and geometry that can read the renderer is geometry
that can disagree with it.

```
crt-geometry.js     guideOutline (the guide + its shape ratio), radiusAt / shapeRatio / axisWeight (lookups),
                    foldQuad (a ray into the first quadrant, by arithmetic), fixed (the one coordinate formatter
                    every path emitter here and in crt-grid uses), ringLadder (rings + heat), edgeGather (the
                    corner band inside the rim)
crt-projection.js   fieldFolds (fold test), faceAmax (the amplitude ceiling), faceProfile / faceF / faceShaped
                    (the projection, radial and shape-aware)
crt-phosphor.js     PH palette, blackbody KELVIN table, hexRgb / mix / kelvinRgb / resolvePhosphor
crt-flicker.js      createFlicker() -> { screenFlicker, bulbFlick, bulbState, frameVars }
crt-grid.js         curvedScanPath (scanlines + grille), curvedGridPaths (grid lines + cell dots)
crt-bezel.js        bezelCols (the frame's plastic: base + a little phosphor and room light)
crt-terminal.js     bootLines (the boot text), typeInto (the typewriter)
crt-sidebar.js      makeFmt (how each value reads), SECTIONS (panel layout)
crt-presets.js      defaultPreset and the stored configurations
crt-gl.js           createRenderer, buildFaceLUT, buildOutlineLUT, toLinear, detectGPU — four programs, the
                    half-float ping-pong, and the LUTs the shader reads the geometry through
crt-fixture-gl.js   the light fitting, ray-traced in the shader
crt-glsl-common.js  GLSL shared between those two
render-probe.js     CRTPROBE.hash() / .selfTest() — a deterministic render fingerprint over seven fixed scenes
```

**The DOM/SVG build is gone.** `CRT Lab.dc.html` rendered the same tube thirteen blended layers deep, and the two
builds agreeing was how a geometry change got verified. It was deleted deliberately on 2026-08-08: the GL build
looks and performs better, and one renderer that is right beats two that must be kept in step. Deleted with it,
because nothing else reached them — `crt-controls.js`, `crt-fixture.js`, `crt-vars.js`, `crt-warp.js`,
`crt-glow.js`, `crt.css`, `fps-probe.js`. All of it is in the history if the cross-check is wanted back.

The panel is [`../kit/panel.js`](../kit/README.md), shared with the other labs. CRT Lab uses **only** that much of
the kit: it predates the rest and keeps its own persistence, sizing and frame loop, wound through a power
sequence, a warp and a surge the generic helpers have no notion of. Stretching `lab.js` over both would produce an
abstraction fitting neither — the same judgement `glquad.js` records about not wrapping this renderer.

## The curve is plotted, not resampled

There is no lens. `crt-barrel.js` and `crt-projection.js`'s `displacementField` are deleted: the tube
used to be resampled through a generated displacement PNG on an `feDisplacementMap`, and it looked worse than not
doing it at all.

Everything curved is GENERATED BENT instead — the grid, the scanlines and grille, the guide outline, the heat bands and
the face clip all walk the same `radialMap` through `faceF`, so they cannot describe different surfaces. The picture
itself is not distorted at all; the face clip is what gives it a curved edge.

One inheritance to know about: `fieldFolds`'s 2x-minification threshold came from what `feDisplacementMap` could
resample. Nothing resamples now, so it no longer bounds anything physical — but `faceF` still multiplies by `faceAmax`,
so that constant is what sets how deep FACE bends. It is kept because the range looks right and every stored setting is
calibrated against it, not because 2x still means something.

## The projection reads the face's SHAPE

`faceF` is a function of normalised radius alone. `faceShaped` is the same profile with the amplitude scaled by
`rho(theta)^(2*SHAPE)`, where `rho` is `guideOutline`'s **shape ratio** — the aperture's radius over the raster box's
radius on that ray, 1 on both axes at every setting and lowest at the box's diagonal. Physically: the glass ends earlier
on a corner ray than the raster's box does, so the dome has less room to sag there.

What it buys, and why it is not the per-ray sag `crt-projection` refuses: the gain is **never above 1**, so no setting can
fold something `faceAmax` already certified, and the axes are the unchanged projection — every stored setting still
measures the same on them. What changes is that SQUIRCLE and BEND now reach the WARP instead of only the clip: the
picture stops being a scaled rectangle, its corners hold out toward the box corner while the aperture curves in behind
them (so they are **cut**, which is what an overscanned tube with a rounded faceplate does), and a scanline's bow varies
along its own length.

Everything plotted rides it through one call: `radialMap` computes the ray's angle for the box radius anyway and passes
it as `F(u, theta)`. A one-argument `F` ignores it. Three consequences worth knowing:

- **`ringLadder` is per-ray**, not one scale per ring, and its band heat is the WORST gap over the sampled rays. A
  single-sample gap would report the axes and stay silent about the corner, which is the ray that actually squeezes.
- **`curvedGridPaths` no longer keeps its own copy of the mapper.** It had an identical private one; a copy would have
  kept reading `F(u)` and the grid — the instrument the warp is judged BY — would have measured a different surface.
- **The rim is only a fixed point ON THE AXES.** The DC pins `F(1, 0) = 1`; off-axis `F(1, theta)` is above 1 (the corner
  is less sagged than the pin), and OVERSCAN multiplies the whole thing. Anything that assumed "the rim maps to itself"
  everywhere needs re-reading.

Imported directly by `CRT Lab.html`'s single `<script type="module">`. The DOM build could not do that — a DC logic
class is not a module, so these were published on `window` as `CRT_GEOM`, `CRT_PROJ` and so on, and everything
geometric returned empty until a `crt-math` event fired because module scripts are deferred. All of that machinery
went with it; a module page just imports.

`crt-flicker` is a **factory** (`createFlicker()`) — it holds memo caches and machine phase, so two instruments on
one page cannot share each other's state.

Dependency order, and it is a line, not a graph: `crt-phosphor` <- `crt-bezel`, and `crt-glsl-common` <-
`crt-gl` / `crt-fixture-gl`. Nothing else imports anything.

## One live finding

- **GLARE reaches the fitting only.** The slider drives the fixture's own light term; the old claim that it also
  fed "five glass references" was stale and the dead write is gone. If it is meant to reach the glass too, that is
  a wiring job, not a value.

## What is deliberately NOT in here

The rendering these feed. Splitting it out would mean a second description of the same surface, which is the bug
this whole structure exists to prevent:

- **Turning geometry into a path or a LUT.** `crt-grid` returns path strings and `crt-gl`'s `buildFaceLUT` /
  `buildOutlineLUT` turn the same functions into textures the shader samples; deciding what stroke, ink and blend
  each gets is rendering. `curvedScanPath` places N lines and nothing more — the page supplies each axis's width,
  alpha and ink from six independent controls.
- **Heat → colour.** `ringLadder` returns heat as a number; the ramp is presentation.

## Verifying a change here

**Measure, don't look.** `render-probe.js` is the instrument: `CRTPROBE.hash()` pins the clock, the full state and
the render scale, then fingerprints seven fixed scenes. A refactor that claims to preserve behaviour is checked by
hashing before and after and comparing. Run `CRTPROBE.selfTest()` first — it proves the harness is deterministic
on this machine before you trust a comparison.

Editing `crt-presets.js` invalidates every stored reference hash, because the probe renders from the preset
defaults. That is not a regression; re-baseline.

Also worth knowing:

- Ring quadrant maxima must be equal in all four quadrants — the outline is one quadrant mirrored, so any spread
  means something is measuring the mirror rather than the shape. Remember the 0-100 viewBox is stretched to the
  glass, so measure in the same space you compare in.
- **A small preview cannot reproduce the >1024 geometry bug.** Check at the real size (~1561x1103).
- **Gate per-pass GPU timing to inside the `renderNow` call.** The page's own rAF loop keeps drawing throughout,
  and its draws otherwise land in whatever slot the counter has reached — a 5-slot bucket once collected 4663
  samples for 120 frames.
