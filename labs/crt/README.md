# CRT Lab modules

`CRT Lab.dc.html` is the view: measuring the glass, plotting the curved layers, assigning CSS variables, driving the
panel. Everything below is logic, and none of it can reach the component — **no DOM, no component state**. That is the
rule the instrument is built on: there is one surface, described once, and geometry that can read the component is
geometry that can disagree with it.

```
crt-geometry.js    guideOutline (the guide + its shape ratio), radiusAt / shapeRatio / axisWeight (lookups),
                   foldQuad (a ray into the first quadrant, by arithmetic), fixed (the one coordinate formatter every
                   path emitter here and in crt-grid uses), ringLadder (rings + heat), edgeGather (the corner band
                   inside the rim)
crt-projection.js  fieldFolds (fold test), faceAmax (the amplitude ceiling), faceProfile / faceF / faceShaped (the
                   projection, radial and shape-aware)
crt-phosphor.js    PH palette, blackbody KELVIN table, hexRgb / mix / kelvinRgb / resolvePhosphor
crt-fixture.js     createFixture() -> { ignite, tubeHealth, portalPolygon }
crt-flicker.js     createFlicker() -> { screenFlicker, bulbFlick, bulbState, frameVars }
crt-grid.js        curvedScanPath (scanlines + grille), curvedGridPaths (grid lines + cell dots)
crt-controls.js    createMeta (the control table: ranges, units, fmt/parse), SECTIONS (panel layout)
crt-vars.js        screenVars (every CSS custom property the tube reads: settings in, one string out)
crt-bezel.js       bezelCols (the frame's plastic: base + a little phosphor and room light)
crt-warp.js        runWarp (the magnet warp over the text layer, owning its own frame loop)
crt-terminal.js    bootLines (the boot text), typeInto (the typewriter)
crt.css            keyframes, slider thumbs, document reset
```

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

Loaded by a `<script type="module">` in the DC's helmet and published on `window` (`CRT_GEOM`, `CRT_PROJ`, `CRT_PHOS`,
`CRT_FIXTURE`, `CRT_FLICKER`, `CRT_GRID`, `CRT_CONTROLS`, `CRT_VARS`, `CRT_BEZEL`, `CRT_WARP`, `CRT_TERM`) because a DC
logic class is not itself a module. Module scripts are deferred, so the first render can land before they do: everything
geometric returns empty until then and `componentDidMount` rebuilds once the `crt-math` event fires. `META` is a lazy
getter for the same reason — an empty table renders an empty panel instead of throwing.

`crt-fixture` and `crt-flicker` are **factories** (`createFixture()`, `createFlicker()`) — they hold memo caches and
machine phase, so two instruments on one page cannot share each other's state. `crt-controls` exports a factory too, for
a different reason: exactly one formatter has to reach outside itself (FACE reports the *effective* cap, which the
projection computes), so the ceiling is injected as an accessor rather than read off the component.

Dependency order, and it is a line, not a graph: `crt-phosphor` <- `crt-fixture`, `crt-phosphor` <- `crt-vars`,
`crt-phosphor` <- `crt-bezel`. Nothing else imports anything.

`crt.css` holds only what cannot be an inline style: the document reset, the slider thumb pseudo-elements, and the eight
keyframes. Timing is NOT in there — renderVals composes each animation's full shorthand from the POWER controls, so the
duration lives with the state and only the motion lives in CSS.

## Two live findings from the simplification pass

- **`--glare` has no reader.** The GLARE slider drives `--glarelight`, which the fixture reads; the comment claiming
  "five glass references" was stale, and the dead write is gone. So GLARE currently affects the fixture only — if it is
  meant to reach the glass layers too, that is a wiring job, not a value.
- **`cabs` was a hard-coded 0** standing in for the removed CURVATURE control, and `--curve` (the vignette's
  border-radius) was its only consumer. Both removed; the reader falls back to 0, which is what it already computed.

## What is deliberately NOT in here

The rendering that these feed. Splitting it out would mean a second description of the same surface, which is the bug
this whole structure exists to prevent:

- **Plotting the curved layers into SVG paths.** `crt-grid` returns path strings; deciding what stroke, ink and blend
  mode they get is rendering. The scan pattern is the clearest case — `curvedScanPath` places N lines and nothing more,
  while the DC supplies each axis's width, alpha and ink from six independent controls (density, width and level, per
  axis). The only thing fixed in code is the INK: black for the horizontal pass, warm `#2a1608` for the vertical one.
- **Heat -> colour** (`guideRings` in the DC). `ringLadder` returns heat as a number; the ramp is presentation.
- **The fixture and phosphor MARKUP.** The logic moved; the markup did not. It reads ~40 CSS custom properties inherited
  from `#crt_monitor`, and a child component would either break that inheritance or need all 40 as props.

## Verifying a change here

**Measure, don't look.** A refactor that claims to preserve behaviour is checked by hashing the outputs against a
pre-change backup at identical settings — the displacement PNG's full data URL, every ring band's `d` string, the grid
canvas pixels, and the whole `--var` block on `#crt_monitor`. The module split was verified exactly that way against
`CRT Lab (backup post-cleanup).dc.html`: all four hashes equal, including the 95,646-character map byte for byte.

Also worth knowing:

- Ring quadrant maxima must be equal in all four quadrants — the outline is one quadrant mirrored, so any spread means
  something is measuring the mirror rather than the shape. Sample with `getPointAtLength`, and remember the 0-100 viewBox
  is stretched to the glass, so measure in the same space you compare in.
- Decode the map's PNG header (IHDR at bytes 16-23) and check its aspect against the glass.
- **A 616x540 preview cannot reproduce the >1024 map bug.** Check geometry at the real size (1561x1103).
- **On a COLD load the overlay can lag the picture.** The first render lands before these deferred modules, so the
  `crt-math` rebuild runs against the un-inset stage (924 here) and the sidebar's width arrives afterwards. `map` and
  `grid` re-measure themselves and come out right; the rings and heat bands are built in `renderVals` from a measured
  width, so they only correct if something re-renders. `syncScreenAspect` therefore keys its re-render on the measured
  GLASS WIDTH, not on the inset — at ASPECT FULL the inset is identically 0 at every stage width, so an inset-only guard
  sees nothing and leaves the reference describing a different glass than the picture. Warm modules reorder it and hide
  the bug, which is what makes it intermittent: test it on a cold load, and the bands must hash `19c80928:210984` with
  no interaction at all.
