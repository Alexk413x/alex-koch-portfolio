# CRT Lab — layer work handoff

You are continuing work on **`CRT Lab.dc.html`**, an amber CRT terminal with a calibration instrument bolted on. Read
**`CRT Lab HANDOFF.md`** and **`crt/README.md`** first — they are maintained and current. This file covers only the
layer work in progress and the traps that cost real time.

---

## The layer model

Three groups, front to back. Each is a plain container element that carries **no `data-layer`** — a container earns a
legend row by drawing something, and these draw nothing.

```
#clOverlay     overlay   instruments: layer borders, guide, heat map
  #clScreen    screen    scan pattern (mask), sweeps, phosphor wash, phosphor glow, power-off line,
                         terminal text, content, power anim, picture content
    #clGlass   glass     inner vignette, edge gather, sheen, fixture spill, fixture rail, fixture
  #clFrameSvg  —         the moulding. z-index 60, so it paints over the guide and under the title.
#clBezel       —         the tube. Draws nothing, and is not a group: it IS the glass box.
```

**`#clOverlay` is also THE INSET WRAPPER, and that is why the frame is in it.** ASPECT resizes `#clBezel` — the glass
box — and every full-stage layer that is not inside it has to be inset by hand to follow. `syncScreenAspect` does that
for `#clOverlay` and nothing else, deliberately: one wrapper, so a new overlay inherits the inset instead of having to
join a list. `#clFrameSvg` was written as a sibling of that wrapper and never joined it, so at ASPECT SQUARE the
moulding stayed the full width of the stage — a wide rectangle round a narrow tube, drawing an outline stretched
across 1287px that had been computed for 712. Anything added here that must track the glass goes inside `#clOverlay`.

The physical story this encodes: **glass** is light arriving from the room and bouncing off the front surface, and it
sits INSIDE **screen**, painted last; **screen** is the phosphor, which emits. The shadow mask (`scan pattern`) belongs
in front of the phosphor and behind the glass — it was behind the phosphor until recently, where screen-blended glow and
wash painted over it and lifted the dark lines back up.

**`--reflwarp` is scoped to a wrapper inside `#clRefl` holding only `fixture`, `fixture rail` and `fixture spill`.** It
used to sit on `#clRefl` itself, where it resampled every child — including the sheen and the spill, which are plotted, so
the curve got applied twice: once as geometry, once as displacement. Two approximations of one dome, composed. The sheen
stays outside that wrapper, still plotted, because it registers with the **glass**, not with the fixture. MATTE stays on
`#clRefl`, since it is a property of the glass surface and belongs to all the reflection layers together.

**`fixture spill` is warped by CHOICE** — the only layer in the instrument for which that is true, and the reason is worth
keeping. It *can* be plotted, and was. The fixture cannot: it is a perspective + `preserve-3d` composite with no outline
to walk, so it only reaches the dome through the map. A plotted hole and a warped lamp are two different transforms and
they disagreed by ~19px at the opening — the hole measured 542×265 against the fixture's 504×252 and sat high. No
correction to the spill's *geometry* could close that, because the error was not in the geometry. `spillPath` now passes
`null` where `faceF` used to go and rides the same map, which brings it to `dx -2, dy 2`. **If the fixture and rail are
ever plotted, this should go back to `∿`.**

## The legend has two marks, not five

`∿ plotted` (scan, grid, heat, glow, wash, sweeps, sheen, terminal text, inner vignette, power-off line) and `≈ warped`
(fixture, rail, spill). **Everything else is unmarked, and that is the whole taxonomy.**

**The `power-off line` is `∿`, but it does not bow — and it cannot.** Every one of its 49 plotted points returns
`y = 50.000` exactly. That is the projection, not a plotting bug: `faceF` maps an on-axis point *along its own ray*, and this
line sits on the horizontal axis, so its `y` is invariant. The horizontal centreline of a dome whose map preserves each ray's
DIRECTION projects to a straight line — which the shape term does not change, since it only scales how far ALONG the ray a
point lands. **The one row in the picture the dome cannot bend is the one the collapse line is on.**

What the curve does reach is the **extent**: the projection magnifies it, so the authored middle 70% arrives as 12.81..87.19
rather than 15..85, and it tracks FACE. That is what makes the mark honest — but the visible difference from the old flat divs
is ~4.4% of length, not a shape. An earlier comment in the DC claimed it bowed with its row; that was false and survived a
revision because it sounded right. If a visible bow is ever wanted it needs a non-radial term in the projection, or the line
moved off-axis — both are design changes, not fixes.

**`power anim` (`#clPower`) is unmarked and cannot be plotted — do not try.** It is a transform group: `inset:0`, no paint of
its own, carrying the `clCrtOn` / `clCrtOff` `scale()` keyframes over the entire picture. There is no outline to walk, so
"plot it" has no referent; its CHILDREN are plotted and the scale applies to their already-bent geometry, which is the correct
composition order for a raster collapsing.

A uniform `scaleY` also cannot converge onto a bowed line — but per the point above, the line it converges on is straight
under this projection anyway, so there is nothing to converge onto that a scale cannot reach. Animating the plot instead of
transforming it would mean re-plotting every child per frame for a 0.9s animation, at which point the collapse costs more than
the calibration grid. Deliberately not done.

It used to carry `◜ outline`, `■ fill` and `· flat` as well. Those were not mechanisms — they were excuses. `outline`
meant a layer riding the rim, and the rim is a **fixed point of the projection**: it renders the identical path whether it
is plotted or not, so the mark claimed work that never happened. `fill` meant uniform colour, where curvature is
unobservable. `flat` meant no. Three ways of saying a layer does not follow the dome, printed as though they were three
ways of following it — and a legend with a mark for every case marks nothing.

The column answers one question, *how does the curve reach this layer*, and exactly two mechanisms reach it: generated
bent, or resampled bent. Blank is the honest answer for the rest. `data-warp="edge"` is deleted from the markup rather
than renamed, so there is no dormant third state to drift back in.

**The inner vignette is now `∿`, and the reason it took a real change to earn it is worth keeping.** `vigPath` is
`guidePathCoarse` — the glass rim — and **on the axes** the rim is a fixed point of the projection (`faceF` is pinned so
`F(1, 0) = 1`), so walking each falloff ring through it would reproduce the outline already there. That is why the layer was
correctly *unmarked* for so long: nothing in its geometry came from the curve. It still rides the APERTURE rather than the
raster, which is right — the vignette is the edge of the glass, and OVERSCAN magnifying the picture does not widen it.
(`vigEdgeC` is therefore measured on-axis and divided by `F(1, 0)`, which takes overscan out of the reach and is exactly 1
when overscan is off.)

What was genuinely missing was the **scale**. `vigReach` was pure screen px, so deepening FACE tightened every other layer's
spacing at the rim while the vignette held a fixed screen width. It is now multiplied by `dF/du` at the rim — below 1 whenever
the face is curved (`(1-A)/(1+A)` for a `u/(1+Au^2)` profile), because a step measured on the glass projects to a smaller step
on screen there. That factor is the dome's entire effect on a constant-distance-from-edge band. Floored at 0.15 so an extreme
FACE cannot silently zero the control. `--vigfall` and `--vigblur` both derive from the reach and follow automatically.

**Radial rings remain the wrong answer** and this did not revisit it: ring *i* sits at `1 - step*i` of each point's distance
from the CENTRE, so band thickness is `step * r(theta)` — and a rectangle's corners are its far points, which is the dark X on
the diagonals that moved this layer onto edge strokes originally.

The spill is an **annulus**: the lamp's projected outline (`portalCorners`, four exact corners with linearly subdividededges — no parametric sampling, which would round them) is cut out of the pool with `fill-rule="evenodd"`, so the spill
cannot paint over the fixture. Its outer edge is a superellipse in **screen** space, grown by the same px margin on both
axes. Spreading it along the fixture's plane instead was geometrically honest and visually useless: at `--ftilt -72°` that
plane is nearly edge-on, so `cos()` crushed the vertical axis to ~31% and the pool came out 1570×178 whatever SPILL SIZE
said. A halo is not confined to its source's plane.

Its `<defs>` travels with its `<svg>`, which is what keeps `--lcol` resolving: the gradient's own computed style stays
inside `#crt_monitor`. A gradient in a sibling subtree paints the fallback in silence — the bug the sheen had.

There used to be a fourth group, `tube`, holding one layer: an `overscan backdrop`, an opaque black rectangle over an
already-opaque black bezel. It painted the same pixels twice and is gone; the framed bezel's `#050301` background went
with it, since the backdrop had covered it since the day it was written and `#000` is the colour that was shipping.

**`#clBezel` is the glass box.** Every curved layer is plotted against it and `syncScreenAspect` sizes it, so the box
that is measured and the box that is resized are now the same element. `glassBox()` is the only place that measures it —
there were nine call sites, each re-fetching the element and each carrying its own fallback.

`inner vignette` is the **top** of the glass group deliberately: it is the tube's edge falloff, so it darkens the
reflections as well as the picture.

### Verify order by measuring, never by reading the legend

The legend is derived from ancestry and can agree with itself while being wrong. Recompute independently:

```js
// walk each layer's ancestor chain accumulating (z-index, document index)
// sort by that; compare to the legend
```

This has caught real bugs. Do it after any structural change.

---

## The face's SHAPE is in the projection now (and the rim is no longer a fixed point)

SQUIRCLE and BEND used to move the clip and nothing else: the warp was radial, so a rounded faceplate bent its picture
exactly like a rectangular one and the roundness was a cookie-cutter over a square dome. `crt-projection`'s `faceShaped`
scales the sag amplitude by `rho(theta)^(2*SHAPE)` — `rho` being `guideOutline`'s shape ratio, the aperture's radius over
the box's radius on that ray. Read `crt/README.md`'s "The projection reads the face's SHAPE" for the argument; what the
layer work needs to know is the four consequences:

1. **The rim is a fixed point ON THE AXES ONLY.** `faceF()` pins `F(1, 0) = 1`; at the diagonal `F(1, theta)` measures
   above 1 (that ray is less sagged than the pin), and OVERSCAN multiplies everything on top. Two claims elsewhere in this
   file rested on "the rim maps to itself" and are now narrower than they were — see the vignette note below.
2. **The picture is meant to overflow.** The corners run past the aperture and `crtFaceClip` cuts them. That is the look,
   not a bug to correct: OVERSCAN sets how much, SAFE AREA keeps the CONTENT out of what gets cut.
3. **Anything that samples the projection at ONE angle is now a lie.** `ringLadder`'s per-ring scalar became per-ray, and
   its band heat is the minimum over rays rather than one sample. Same trap anywhere else a single call stands in for a
   ring, a band or an extent.
4. **The axes are bit-for-bit unchanged**, which is what makes every stored setting still valid. If a measurement moves on
   an axis ray, something is wrong with the change and not with the calibration.

Four controls came with it, all in TUBE except the last: **SHAPE** (how much of the shape the warp carries; RADIAL is the
old behaviour), **OVERSCAN** (the raster drawn bigger than the glass), **EDGE GLASS** (the gather's level) and **SAFE
AREA** (in TERMINAL — how far the text pulls in from the cut). All four are inert at SQUIRCLE 0 / BEND 0, because a
rectangular outline has no shape to follow: test them on a rounded tube or they look broken.

## `edge gather` is the squircle's own layer

The band of glass just inside the rim, as filled wedges bucketed by corner weight — six paths, six opacities, one blur.
Where the outline turns, the glass is thicker and steeper and gathers the room into a band that **widens and brightens
into the corners and vanishes on the axes**. The inner vignette cannot say this and never could: it is a stroke, and a
stroke carries one width and one opacity for its whole path, which is why it reads as a uniform dark rim however round the
tube is.

It has **no shape control of its own, deliberately**. Depth and brightness both come from `(1 - rho)` normalised to the
outline's own deepest corner, so the layer is a READING of SQUIRCLE and BEND rather than a second opinion about them, and
at SQUARE `crt-geometry.edgeGather` returns nothing at all. The weight is **squared**: the raw ratio departs from 1 over
almost the whole outline once the shape is at all round (at SQUIRCLE 65 every ray but the two axes scores high), so it
marked the entire rim as corner and the first build came out as a wall of haze rather than a gather.

## Rules that are load-bearing

**No `opacity`, `filter` or `isolation` on `#clGlassStack`.** Its children are `mix-blend-mode: screen` and blend
against the phosphor beneath. Any of those three makes it an isolated group, and the reflections would blend against
transparent black inside it, then composite flat. Measured: the fixture walls (`#a89e88`) over a lit glyph give 245,191,122
blended vs 204,160,105 isolated — the isolated version is *darker than its backdrop*, i.e. a reflection that dims the
picture. The sheen is immune (white screens identically either way), and over the dark tube the difference is ~7/255,
which is why this would ship unnoticed. If the glass ever needs one opacity, put it on a nested element.

**The calibration mask only reaches state.** `renderVals` builds it by copying `this.state` and zeroing fields, so
anything driven imperatively must be masked at its writer. `--textglow` is the one such input (`syncCalibrationContent`
sets it to `'0'`). If you add another imperative visual input, mask it there too.

**Multiply needs light to bite into.** The scan pattern is `mix-blend-mode: multiply`; on a dark tube it changes
almost nothing. `lightOn` defaults to `false`, so the lab loads unlit and the scanlines look absent. This is correct
behaviour, not a bug — see the note above `#clScanLayer`.

---

## The one bug pattern to watch for

A fourth instance turned up during the group rename and is now fixed: `lFlickerStep` wrote all seventeen per-frame light
variables onto the old tube div inside `#clBezel`, which is a **sibling** of `#clOverlay`, not an ancestor of the
fixture. Every reader resolved the `crt.css` fallback instead, on every frame, so LIGHT FLICKER moved nothing at any
setting. It now writes to `#clGlass`, the group that contains every reader. The tell was the value: the fixture's
computed `--lflk` read `1` (the stylesheet's) while the element being written read `1.000` (the loop's).

Three separate bugs before that were the same shape: **a value read at a point where it cannot yet be correct.**

1. `axisOn()` read `this.state` while `renderVals` drew from the *masked* state → the layer mounted in calibration and
   built a full path set to draw at alpha 0.
2. `--textglow` was written to `#clScreen`, but its reader is a *sibling of `#clImage`* two levels above → it resolved
   to the `0` fallback forever and that layer never once drew.
3. `syncGlowField()` measured at DOM-commit time, but `#crt_log` carries `transition: all .12s` → it always read the
   pre-change box, and a transition ending is not a render, so it never self-corrected.

Before wiring any new layer: **who writes this value, when, and can the reader see it at that moment?**

---

## Current state of the phosphor glow

Content-shaped glow, built this session. `crt/crt-glow.js` is pure; the DC measures.

- `clustersFrom({rects, gap})` merges nearby content rects into bounding boxes, **iterated to a fixed point** (one pass
  leaves a paragraph as 2–3 overlapping glows depending on measurement order).
- `glowBoxes({clusters, rgb, gain, pad, radius})` returns **markup**, not a background — CSS gradients cannot describe a
  rounded rectangle. Boxes are painted solid and hard-edged; **all** falloff comes from `--glowblur` on the container.
- Rects come from a **`Range` over each line's contents**, not the line's block box. Log lines are block elements, so
  65–68% of each box was empty space right of the glyphs, and the glow lit a full-width band on every row.
- Driven imperatively into `#clGlowLayer.innerHTML` via `syncGlowField()`, kept fresh by a `ResizeObserver` on
  `#crt_log` plus a bounded rAF settle loop (the observer is silent on position-only moves like TEXT X/Y).

A **7×5 dimming-zone grid** was tried first and removed: quantising trades a shape you recognise for a lattice you
don't want, and no amount of overlap or blur removes a lattice — it only dilutes it. Do not reintroduce it.

---

## Open items

0. **`--glarelight` is written to the fixture and read there, and GLARE reads 0 only because the stored setting is 0.**
   Not the `cabs` ghost the old note guessed at — `crtlab` has `glare: 0` saved. Nothing to fix; raise the slider.

1. **`lightOn` defaults to false.** Flipping it to `true` is most of the difference between a dead-looking tube and a
   lit one, and gives the scanlines something to bite into. The user has been asked and has not decided.
2. **Layers dark by setting, not broken:** beam sweeps (SWEEPS off), fixture/rail/spill (LIGHT OFF), power-off line
   (shutdown only). Confirm before "fixing" any of them.
3. **`state.gn` (CORNER) is inert** — only enters `guideKey`. Delete it or give it a job.
4. **GLARE reads 0** — likely a hard-coded `cabs = 0` left from an old cleanup.
5. **Phosphor texture does not compress with the warp**, though scanlines and grille now do.
6. **The fixture's 3D reads slightly off at steep tilt — KNOWN, AND THE USER HAS SAID NOT TO CHASE IT.** At large
   `--ftilt` (it runs at -72°) the recess walls, the tube ends and the rail do not agree perfectly with the opening's
   projection. Cause is structural rather than a bug: the walls get their foreshortening from CSS `preserve-3d` and
   `rotateX/rotateY(±90deg)`, the opening's clip comes from `portalPolygon`'s own perspective maths, and the spill comes
   from `portalCorners` — three implementations of one projection, which agree near 0° and drift as the tilt grows.
   Fixing it properly means plotting the fixture instead of warping it (assessed in chat: ~18 painted elements, the recess
   and rail are straightforward quads, the tubes' halo needs `feGaussianBlur` or a plotted falloff, and the real work is
   replacing `preserve-3d`'s free occlusion with an explicit paint order derived from the sign of `--ftilt`). **Do not
   start that unprompted** — accuracy here was explicitly declined.

   Doing it would also let the spill go back to `∿ plotted` and delete `--reflwarp`, `displacementMap` and the
   `feImage`/`feDisplacementMap` pair, which is the last resampling left in the instrument.

---

## Working notes

- **The helmet's ES modules do not hot-reload.** Edit anything in `crt/` and the running page keeps the OLD module.
  This is silent and looks exactly like a maths bug. Reload before believing any measurement.
- **Re-query DOM nodes before every write.** The sidebar re-renders on each `setState` and replaces its inputs; cached
  element references go stale and later writes land nowhere, silently.
- **Do not leave test values in the user's state.** Sliders persist on a debounce to `localStorage` (`crtlab`).
  Snapshot and restore in the *same* call — anything can interrupt between two calls. Extremes left behind have twice
  been reported as visual bugs.
- **Count what you claim.** `d.split('M').length - 1` on a path's `d` is the whole test for subpath counts.
- **Delete stale comments, don't patch them.** A comment block here was patched across three model changes until it
  described none of the code beneath it. If a change makes a comment untrue, remove the block.
