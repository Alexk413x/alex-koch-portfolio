# CRT Lab — handoff

`CRT Lab.dc.html` + eleven plain ES modules of pure logic in `crt/`. **See `crt/README.md` for the current module
table** — it is maintained; the list that used to sit here was not.

The modules are loaded by a `<script type="module">` in the helmet and published on `window` (`CRT_GEOM`,
`CRT_PROJ`, and so on), because the logic class is not itself a module. Module scripts are deferred, so the first
render can land before the math does: everything geometric returns empty until then and `componentDidMount`
rebuilds once the `crt-math` event fires. Backups: `CRT Lab (backup).dc.html`, `(backup unified-curve)`,
`(backup solved-rings)` — all pre-split.

An amber CRT terminal with a calibration instrument bolted on: a curved glass face, a grid you can measure it with,
and a heat-map overlay that reports how hard the surface is being compressed.

> **THE LENS IS GONE.** Nothing is resampled any more. `crt-barrel.js` and `displacementField` are deleted; the
> `feDisplacementMap` is out of the document. Every curved layer — grid, scanlines, grille, guide outline, heat
> bands, face clip — is **plotted bent** through `faceF`, and the picture itself is not distorted at all (the face
> clip gives it its curved edge). Sections below that talk about maps, PNG encodes, filter scale or 8-bit bias are
> describing machinery that no longer exists; they are kept only where the *geometric* reasoning still applies.

---

## The one idea to hold onto

There is **one surface**, described **once**. Every serious bug in this file has been two descriptions of the same
geometry drifting apart — the guard testing one profile while the map delivered another, the rings riding a
different sag than the picture, three `Rdiag` definitions disagreeing about box vs guide. If you add a term to the
projection, it belongs in `faceF` and nowhere else. That is now enforceable: the math has no second copy to drift
into, and the DC cannot reach past the two module APIs.

## Architecture as it stands

```
state.fcurve   FACE        -90..90, always available, never clamped
SIX scan controls, three per axis, all independent — nothing is derived from anything else:
state.scan     SCANLINES H 0..100 lines per 100 rendered px (rows, down the picture height); 0 = axis off
state.grille   SCANLINES V 0..100 lines per 100 rendered px (columns, across the width); 0 = axis off
state.scanw    WIDTH H     0..3 px, quarter-px steps; 0 = axis off
state.grillew  WIDTH V     0..3 px, quarter-px steps; 0 = axis off
state.scanop   LEVEL H     0..100 % — the stroke alpha, one to one; 0 = axis off
state.grilleop LEVEL V     0..100 % — the stroke alpha, one to one; 0 = axis off
                           V's key is still `grille*` (pre-rename). Displayed unit is PPI, a costume — see below.
                           The V pass differs only in INK (#2a1608 vs black) and its lower defaults.
state.grings   CURVE AREA  0..20 bands; each band = 1 grid cell = 5% of span
state.gsqe     SQUIRCLE    guide outline only — does NOT reach the picture
state.gbend    BEND        bulges the straight runs outward, corners stay rounded
GRIDN = 40                 calibration grid divisions; one cell = 2/40 = 5% of half-extent
```

**Guide — `guideOutline(w, H, sq, bend)`** (geometry). One superellipse, `|x/hw|^n + |y/hh|^n = 1`, its straight
runs bulged by BEND. Returns the closed outline in centred px plus `rQ`, the radius as a function of angle — exact
on the axes, where the old ray/polyline intersection failed. The DC measures `#clGlass` and caches the result on
`guideKey()`; `radiusAt(prof, theta)` folds any angle into the first quadrant.

**Projection — `faceF(deg, fadeSpan)`** (projection) returns `u => u / (1 + sg·A·shape(u))`, or null when flat.

- `u` is the fraction of the way out to the rim **on that ray**. There is no `Rg` parameter: the profile does not
  vary by ray, and passing one invited exactly the drift this file keeps paying for.
- `A = faceAmax(fadeSpan, sign) · (1 − cos θ)` — dimensionless. Depth saturates at the renderable ceiling, which
  is why FACE never needs clamping.
- `shape(u) = uB²`, `uB = (u − u0)/(1 − u0)`, `u0 = 1 − fadeSpan`, `fadeSpan = CURVE AREA · cell`.
  So the interior inside `u0` is **exactly** flat and the rim is pinned to nothing.
- **Unpinned**: `F(1) < 1`, so the picture's edge pulls *inside* the glass by the sag.
- The DC returns null when CURVE AREA < 1: a band of no cells has no region to warp.

**Ceiling — `faceAmax`**: bisects the largest `A` that `fieldFolds` accepts. Memoised on `fadeSpan|sign` inside the
module. **This is why CURVE AREA is a softness control**: the same depth over a wider band is a gentler gradient.

**Fold test — `fieldFolds(A, fadeSpan, sign)`**: one 1-D walk requiring every step to keep at least half its source
span (2× local minification). It does **not** test for spacing reversal: `sag ~ uB²` has a monotone derivative, so
that cannot happen by construction. The property comes from the shape, not from a test rejecting bad shapes.

That 2× came from the point a 1px line stopped surviving `feDisplacementMap`. **Nothing resamples now, so it bounds
nothing physical** — but `faceF` multiplies by `faceAmax`, which bisects against it, so the constant is what sets
how deep FACE actually bends. Kept because the range looks right and every stored setting is calibrated against it.
Change it knowingly or not at all.

- Destination `= F(u) · rBox(θ)`. Everything is measured in **box fractions** — the source raster *is* the box.
  Normalising the destination by `Rg` while scaling the source by `rBox` painted concentric rings through the middle.
- Inverted by **one** monotone forward walk (256 samples), not by per-pixel bisection (25M closure calls per map).
  This was 128 angle bins while `F` depended on the ray; it no longer does, so they were 128 copies of one table.
- `q` is a resolution scale: half-res during a drag, full-res on release.
- Resolution cap is **one scale factor for both axes**. Clamping `NX`/`NY` independently made a square map on any
  glass >1024 on both axes, which `preserveAspectRatio="none"` then sheared — the long-running "bottom-left corner
  is messed up" bug. Only reproduces above 1024px, so a small preview cannot see it.
- The guide's only remaining part in the field is refusing a ray with no glass on it.
- Rebuild is coalesced to one per animation frame, and guarded by **both** `_faceKey` and `_faceBuiltW/H`. Do **not**
  re-measure the glass inside the deferred frame: the rAF can land before `--panelw` applies and you build a
  924-wide map for a 616-wide element.

**Overlay — `ringLadder(prof, n, stepK, faceF)`** → array of ring paths, plus `.bands` of `{d, heat}`. The DC maps
heat to the colour ramp, because colour is presentation.

- Rings are **scaled rectangles**, because the raster is a rectangle. They ride the same `fF` the picture does, so
  ring *i* and grid line *i* coincide on every ray.
- Ring 0 is the **picture's** edge, not the glass edge. The dashed outline is the glass.
- One scale per ring, forced monotone outward-in (`KG`). This was a 257-column per-ray table holding 257 copies of
  one column; likewise the band heat was a minimum over 13 rays of one value. **If a per-ray term ever returns,
  both have to become tables again.**
- Heat per band `= 1 − gap/stepK`. Colour ramp tops out at heat 0.5 — the fold test's own bound — so full magenta
  means "at the limit". Alpha `0.25 + hn·0.30`.
- Built only out to `CURVE AREA + 1` rings; bands further in can only ever be flat.

**Grid — `curvedGridPaths(w, H, N, faceF)`** (crt-grid): SVG path strings in a stretched 0–100 viewBox, every point
walked through the same `radialMap`/`faceF` the rings ride, so a grid line lands on its ring by construction. No
canvas, no parity dance, no filter — an SVG path in a stretched viewBox has no pixel grid to be misaligned against,
and because `F` and the box radius are both even in the angle it is mirror-exact with no mirroring code.

**Scanlines and grille — `curvedScanPath(w, H, count, faceF, samples, axis)`** (crt-grid): same construction, one
path of `count` lines at band centres. **It takes a COUNT, not a pitch** — the DC converts its PPI density into a
count in `scanCount` and this stays a dumb "place N lines" primitive. See the note on `scanPath` in the DC for the two
superseded models and what each got wrong.

## Settled decisions — please don't relitigate

- **The corners are cut, not warped.** This one outlived the lens that motivated it: the picture ends on the
  squircle by **clip**, and that is still how it should end. (The original argument was about lateral pixel
  transport into the rounded corner being far beyond what the filter could carry. There is no filter now, so the
  number no longer applies — but the clip is simpler than a shaped projection and it works.)
- **Sag is one amplitude in normalised radius**, not `sag(lat)` per ray. Per-ray sag gave the corner 1.8× the
  sides' sag, so it folded first and ate the whole budget. This was the root of the fold complaints.
- **The rim is unpinned.** The picture sits inside the glass. That gap is real.
- **`BEND` must not be inverted** to bow the runs inward: `wAx` peaks *on* the axis and needs its double root at
  the diagonal to hide the `min(sx, sy)` kink.
- **The math modules stay pure.** No DOM, no `this.state`, no canvas. The moment geometry can read the component
  it can disagree with it.

## Open items

1. ~~**Perf on a large glass**~~ — moot. The 1.7M-pixel field loop and the PNG encode per build went with the lens;
   there is nothing left to coalesce. Path-string length is the remaining cost, and it is an order of magnitude
   smaller. **Four rounds of that cost are now gone** (cold `renderVals` at 1287×712: 13.1ms → 8.3ms at FACE FLAT):

   - `Number#toFixed` is the wrong formatter for a path. `crt-geometry`'s `fixed(v, m)` rounds and lets V8 print the
     shortest round-tripping decimal, so `50` is `"50"` and not `"50.00000"`. Measured on the 3604-point outline:
     1.26ms/74.6KB → 0.49ms/54.8KB at **identical precision**. Every emitter uses it.
   - **The face clip was a second copy of the outline.** It asked in `objectBoundingBox` units and everything else asks
     in 100s, so one curve was built twice per render, ~64KB each. The `<path>` inside `#crtFaceClip` carries
     `transform="scale(0.01)"` and reads the same string as the guide and the frame.
   - **Folding a ray into the first quadrant is arithmetic, not trigonometry.** `atan2(|sin t|, |cos t|)` was three
     transcendental calls, two deep in the innermost loop (`faceShaped` asks for the shape ratio *and* the axis weight
     per plotted point). `crt-geometry`'s `foldQuad` is `|t| mod pi`, mirrored past `pi/2`: 139ns → 27ns, agreeing to
     3.3e-16 rad over ±2pi. Worth a measured 12% of a cold render at FACE 60.
   - **The box radius comes off the point, not off the angle.** `radialMap` computed `th` from `x, y` and then took
     `|cos th|`/`|sin th|` back apart — they are `|x|/r` and `|y|/r`, already in hand.
   - **The calibration grid was built with `FILL` off.** `gridLinePath` / `gridDotPath` were computed on every render
     while the `<sc-if>` that draws them was gated on the same flag — 3.5ms handed to React and dropped. Gated now, the
     same rule `axisOn` and the ladder already follow: **a hidden layer costs nothing.** Worth checking the rest of
     `renderVals` against this; it is the cheapest class of win in the file.
   - **The ring ladder joined the draft tier.** It is the single most expensive thing in a rebuild and every input it
     has is a `GEOM_KEY`, so a SQUIRCLE / BEND / FACE drag rebuilt it in full at the slider's event rate. `ringLadder`
     takes a `rays` count now; the DC passes 120 while a geometry control is moving and 260 on settle, with the tier in
     the memo key exactly as `scanPath`'s is. Measured 5.2ms → 2.95ms, and 103KB → 49KB of path data per drag frame.
     Settled output is unchanged.

   What is left: `guideRings` (~5ms settled) and `scanPath` (~2.6ms) still dominate, and both are bounded by how many
   points they emit rather than by what each point costs. The outline is 3604 points at ~1px spacing on a 1300px glass
   and every consumer decimates it; cutting `NS` in `guideOutline` is the next real lever, and it changes output, so it
   wants the byte-comparison treatment below. `radialMap` also allocates a two-element array per plotted point (~25k a
   rebuild) that every caller immediately formats and drops.
2. **THE BIGGEST WIN IN THE FILE: the frame speckle was a full-stage feTurbulence. 54.2ms → 0.5ms.**

   The moulding's injection-moulding noise was `filter="url(#framePlastic)"` on the frame PATH. A filter computes over
   its REGION — the path's bounding box plus 20% a side — and that path is the whole glass outline. So **three octaves
   of fractal noise were generated across 140% of the stage on every composite, to texture a ring thirteen pixels
   wide.**

   `feTurbulence` with fixed parameters is a **static texture**. It belongs in a `<pattern>` that rasterises once and
   tiles, not in a filter that re-evaluates. Measured, minimum-of-four, tight enough that the two states do not
   overlap at all:

   ```
   before   frame shown 108.1 ms   hidden 53.9 ms   -> the moulding cost 54.2 ms
   after    frame shown  70.8 ms   hidden 70.3 ms   -> the moulding costs  0.5 ms
                         (71.2 70.8 71.0 71.4)  vs  (70.6 70.5 70.7 70.3)
   ```

   **Everything-on went from ~108ms to ~71ms in the same window.** Visually verified at the widest frame with the
   lamp on: grain intact, no tiling seam, the lit-edge-to-shadow gradient unchanged. The tile is 50 viewBox units —
   two across the glass — which cannot read as repetition on a thin ring at 22% opacity.

   **A NEAR-MISS WORTH RECORDING, because it nearly went in this file as a result.** A later run at 2197×1047 read
   `[215.3, 160, 157.3, 18.0, 108.3]` for the shipped build against `[286.3, 105.7, 143, 125.4, 88.9]` for the old
   speckle — a minimum of **18.0ms, 56fps**, which would have been the headline. Twelve repeats of that same state
   immediately afterwards gave `min 35.7, median 284.0, and zero samples under 20ms`. **The 18.0 was one lucky
   window.** Minimum-of-N is the right estimator only while the machine is behaving; once the median runs away from
   the minimum by 8x, the minimum is measuring a gap in the interference, not the renderer. **Report a minimum only
   with its distribution beside it**, and re-run before believing a number that is much better than its neighbours.

   **The general rule this is an instance of:** a filter's cost is its REGION, not its ink. Anything static that
   textures a thin shape wants a pattern or a sprite; a filter on a full-stage path pays for the whole stage. The
   earlier attribution missed this entirely because it was scored by median — see the note on minimum-of-N below.

3. **THE COST MODEL IS SURFACES AND BLENDS, NOT FILTERS. Three measurements say so, two of them counter-intuitive.**

   Breaking `#clRefl` down, minimum-of-three per state:

   | component | present | removed | "saves" |
   |---|---|---|---|
   | screen blend on `#clRefl` | 106.1 | 89.6 | **+16.5 ms** |
   | sheen layer | 104.8 | 90.0 | **+14.8 ms** |
   | fixture displacement filter | 90.0 | 121.4 | **−31.4 ms** |
   | matte blur on `#clRefl` | 71.9 | 106.0 | **−34.1 ms** |

   **Removing the two filters made it SLOWER, by a lot.** That is not noise — it is the same effect that made the
   half-resolution experiment fail. A filter on a group gives that group its own render surface, which *flattens* it:
   the browser composites one surface instead of blending each child against the backdrop separately. Take the filter
   away and `#clRefl`'s children each composite on their own. **More surfaces, more passes, slower.**

   So the intuition "filters are expensive, remove them" is wrong here, and it cost this session two failed
   experiments. What is expensive is:

   - **BLEND PASSES over full-stage layers** — the screen blend on `#clRefl` alone is 16.5ms.
   - **A filter whose REGION is huge**, which is a different thing from a filter existing. The frame speckle was
     54.2ms because three octaves of noise were regenerated over 140% of the stage every composite (item 2). Once it
     became a tiled pattern, the cost went to 0.5ms — the filter did not go away, its *region* did.

   **But FORCING a flatten does not help either — that was tested too.** Adding a no-op `opacity(0.999)` filter to
   collapse a group into one surface, minimum-of-four: `#clPower` **106.1 → 123.0 ms (−16.9, worse)**, `#clScreen`
   **54.0 → 53.8 ms (neutral)**. So the browser's existing surface decisions are already reasonable; you cannot buy
   frames by nudging them either way. Both of the levers that sound obvious — remove a filter, add a flatten — are
   measured losses.

   **Seven experiments, two wins, five refutations**, all reverted where they lost:

   | change | result |
   |---|---|
   | frame speckle → `<pattern>` | **WIN, 54.2 → 0.5 ms** |
   | spill filter removed (plotted instead) | **WIN, ~35 ms** |
   | `will-change: transform` on warp wrappers | worse — added surfaces |
   | half-resolution soft layers | worse, 36 ms — added surfaces |
   | flatten `#clPower` | worse, 17 ms |
   | flatten `#clScreen` | neutral |
   | narrow the spill's filter region | worse — region grew 96% |

   Both wins came from the same place: **a filter's REGION**, never from a filter's existence or a compositing hint.
   That is the one lever with a track record here. Before optimising anything else, go looking for another filter
   whose region is far larger than its ink — that is where the frames are.

4. **THE CEILING IS GPU FILL RATE, NOT ANY ONE LAYER. Read this before optimising anything.**

   Frame time was measured against window size with everything animated on, all four points in one session on one
   machine (Intel UHD 630, hardware compositing and rasterisation both confirmed enabled via `SystemInfo.getInfo`):

   | device pixels | median frame | ms per megapixel |
   |---|---|---|
   | 0.9 MP | 18.0 ms | 21.0 |
   | 1.8 MP | 52.8 ms | 28.8 |
   | 3.0 MP | 53.5 ms | 17.9 |
   | 4.4 MP | 88.9 ms | 20.2 |

   **Roughly constant ms/megapixel across a 5× range.** That is the signature of a workload bound by pixels pushed
   through the layer stack, not by any layer's logic. The instrument composites ~13 full-stage blended layers, several
   of them blurred; at 2195×1066 CSS and DPR 1.75 that is 7.2 MP of output and around **94 megapixels of blending per
   frame**. Sixty of those a second is 5.6 gigapixels/second, which is not what integrated graphics does.

   **So the arithmetic of the goal:** at the ~4.6 ms/MP this machine's warm main profile managed (33.3 ms at 7.2 MP),
   16.67 ms buys about **3.6 MP** — half the current output. Chasing individual layers cannot close that; the honest
   levers are how many full-stage layers composite, and at what resolution.

   **THE HALF-RESOLUTION IDEA WAS BUILT, MEASURED, AND IS A LOSS. Do not try it again.** Laying the three blurred
   layers out at 50% and scaling them back up (blur radii scaled to match, verified to raster exactly a quarter of
   the pixels, verified visually indistinguishable) is **36ms/frame SLOWER**. Five interleaved pairs, minimum-of-five,
   with **no overlap between the distributions**:

   ```
   full res    70.3  72.3  87.6  88.5  88.5      min 70.3
   downscaled 106.5 107.3 122.4 124.3 141.3      min 106.5
   ```

   **Why:** `transform: scale()` on an element carrying `mix-blend-mode` gives it its own stacking context and an
   extra render surface. Three new offscreen buffers, each resampled on the way back up, cost more than the pixels
   they save. The fill-rate ceiling is real; the way past it is **fewer composited surfaces, not smaller ones**.
   Adding a surface to shrink a raster trades the wrong way round. Reverted; the note lives on `#clGlowLayer`.

   **USE MINIMUM-OF-N, NOT THE MEDIAN.** This is how that result was obtained on a machine where the median said
   nothing. Interference only ever makes a frame slower, so the minimum across repeats is the robust estimator of what
   the renderer can actually do; a median mixes in every unrelated hiccup. Six medians of one unchanged state spread
   58% here and read as unmeasurable — the same machine, scored by minimum-of-five, separated two builds with zero
   overlap. **Measure the apparatus first** (repeats of one state), then compare minima.

   **A noise floor is a hard stop, and here is what one looks like.** Six back-to-back 2.5s medians of an UNCHANGED
   state, everything animated on, in a clean isolated profile with the occlusion flags:

   ```
   90.1  124.4  88.4  88.5  140.6  89.4     spread 52.2 ms = 58% of the median
   ```

   No A/B design survives that — the spread is several times any effect worth hunting. **Measure the apparatus before
   you measure the change:** six repeats of one state should agree within a few percent. If they do not, stop and fix
   the machine. Everything in this item marked "not measured" is waiting on exactly that, and nothing more.

   The lever below is **built and switched off** for this reason, not because it was tried and failed.

   **The lever that does NOT cost realism:** most of the expensive layers are *deliberately soft* — the phosphor glow
   carries a 53px blur, the inner vignette 14px, the spill ~50px, the matte blurs the whole reflection group. A layer
   that is about to be blurred by fifty pixels does not need to be rastered at 1.75× device resolution. Rendering the
   soft layers into a half-resolution buffer and scaling up quarters their fill cost and is, for a blur that wide,
   visually indistinguishable. That is where to go next, and it is a bigger lever than every filter fix in this item
   combined. The sharp layers — scanlines, grille, grid, terminal text, the guide — must stay at full resolution;
   they are the ones the eye reads edges off.

5. **THE FRAME BUDGET PER LAYER — and the light fixture is the whole of the non-fill-rate part.**

   Measured with `fps-probe.js` (see `CLAUDE.md`), 60s single-state, everything animated on, 2195×1066 @ DPR 1.75:

   | | measured | budget |
   |---|---|---|
   | median frame | **33.3 ms** — exactly two vsyncs | 16.67 ms |
   | p95 / worst | 66.7 / 266.7 ms | — |
   | frame rate | **27 fps** | 60 |
   | dropped | 74% | — |

   The curve settles by the eighth second and then holds 33.3 ± 0.1ms for fifty seconds: not jitter, not warm-up, a
   stable 30fps sitting **one vsync over**. Frame times quantise to exact vsync multiples throughout.

   **Interleaved attribution, run twice, agrees with itself:**

   | layer | with it off | saves |
   |---|---|---|
   | **light fixture** | 33.3 → 16.7 ms *(2nd run 69.4 → 17.9)* | **16.6 ms** *(51.5)* |
   | the other thirteen | 16.7 → 16.7 ms | **0.0 ms** |

   Sweeps, both flickers, phosphor glow, wash, bloom, scanlines, vignette, matte, sheen, glare, frame moulding and the
   FACE warp measure **zero each**. The realism is free; one layer is the entire overrun. It is the two SVG reference
   filters the fixture needs, because it is a `perspective`/`preserve-3d` composite with no outline to plot.

   **The re-runs are re-COMPOSITION, not invalidation** — switching the lamp flicker off does not make it cheaper.
   `#clRefl` screens over the picture, the picture changes every frame, so the group re-composites every frame and the
   reference filters inside it are recomputed with it.

   **Two fixes tried, both measured, both reverted — do not repeat them:**

   - `will-change: transform` on both warp wrappers, to make the filtered result a cached texture. With it in place
     the fixture still cost **36.4ms of a 35.2ms budget at 1034×706** — a quarter of the pixels of the run that first
     measured 16.6ms at 2195×1066. **The cost barely tracks pixel count**, which is the most useful thing learned:
     this is not fill rate, it is the filter pipeline being re-established per frame, and a compositor hint does not
     reach it. Reverted.
   - Narrowing `#clReflWarp`'s region to the spill. The spill genuinely spans the glass, so the margin produced a
     region **96% larger** than full and cost 2ms. Regions are clamped to 0..100% now, which restores the status quo
     and guards the next attempt.

   **APPLIED: the spill is plotted again and `--reflwarp` is permanently `none`.** That deletes one of the two
   filters — and it was the bigger one: the spill's ran over the FULL glass where the fixture's covers 29.5% of it.
   `spillPath` passes `faceF` again instead of `null`, so the layer rides the same projection as the grid, the
   scanlines, the rings and the glass outline, and costs a path string rebuilt on geometry change instead of a
   per-frame resample of a million pixels. Its legend mark goes back to `∿ plotted`.

   This is justified **by construction, not by measurement** — see the warning below about the state this machine was
   in by the end. A full-stage SVG displacement that ran every frame no longer exists in the render tree; that is a
   structural fact (`--reflwarp` computes to `none`, the wrapper's filter computes to `none`), not an inference. It
   still wants a clean before/after.

   What it costs is registration with the fixture: the ~19px disagreement the layer handoff records is back, because
   the fixture still goes through its own filter. **It is not visible** — the spill carries a ~50px blur, so a 19px
   shift sits well inside its own falloff — and the fixture is the one that is wrong anyway (open item 4). When the
   shear is fixed the fixture comes back to meet a spill that is already correct.

   **APPLIED: the fixture's filter region is sized off the bloom it protects.** The margin was 12% of the HOST — the
   glass — which meant a 222px guard band on every side of a 593×296 lamp, because the glass is 1853px wide. Nothing
   about a tube's box-shadow scales with the glass. A box-shadow reaches exactly `spread + blur` past its box, and
   both are published as `--tglowspread` / `--tglowblur`, so the band asks them via a one-pixel probe sized in those
   variables (asked, not recomputed — re-deriving `calc(k * 0.45vw)` here would be a second copy of a crt-vars
   formula). Region: **29.5% → 21.8% of the glass at default glow, 25.8% at maximum**, and it now tracks the setting
   instead of being fixed. Verified at max glow: the halo still falls off smoothly with no hard edge anywhere.

   **Per-frame SVG displacement area, in total:**

   | | before | after |
   |---|---|---|
   | `#clReflWarp` (spill) | 100% of glass | **removed** — plotted |
   | `#clReflWarpFix` (fixture) | 29.5% | 21.8% |
   | **total resampled per frame** | **129.5%** | **21.8%** |

   An **83% reduction** in per-frame displacement area, verified structurally (computed filter values and region
   attributes) and visually (spill and fixture both render correctly, bloom intact at maximum glow).

   **And measured.** Toggling `#clReflWarp` back on over CDP, interleaved against the shipped state, four pairs:

   ```
   removed -> restored      the filter costs
     125.7 -> 106.9            -18.8 ms   (first pair, still settling)
      90.0 -> 124.7            +34.7 ms
      88.2 -> 124.6            +36.4 ms
     107.5 -> 143.5            +36.0 ms
   ```

   The three settled pairs agree: **removing it is worth ~35 ms/frame** on the machine it was measured on. That box
   had a ~53 ms floor with the fixture switched off entirely, so the absolute numbers are inflated — but the pairs
   are interleaved, so the *saving* is real. On a healthy machine expect it proportionally smaller and in the same
   direction.

   **The route left** if it does not, which is architectural rather than a property to flip:

   1. **Rasterise the warped fixture once.** The displacement is a function of FACE and geometry only — it does not
      change when the lamp flickers. Draw the fixture+spill through the filter into a bitmap when the geometry moves,
      and let the flicker modulate that bitmap with a brightness/opacity, which is free. The catch is the two tubes
      flicker independently (`--lflk1`, `--lflk2`) inside the composite, so either they get their own cached layers or
      the per-tube flicker moves outside the filter. Brightness and displacement COMMUTE — displacing a brightened
      pixel and brightening a displaced one are the same operation — so hoisting the modulation out is exact, not an
      approximation.
   **Measure any attempt on an idle machine.** This one carried 30+ Chrome processes and a dozen lab instances by the
   end, and an UNCHANGED build measured 33ms early in the session and 71ms late. Absolute numbers drifted 2–3×;
   only the interleaved pairs stayed meaningful.

6. **Frame rate is a COMPOSITING problem, not a JS one, and the lamp is the cliff.** Everything in item 1 is rebuild
   cost — what you pay when a control moves. What you pay *per frame* is the stack of full-stage surfaces that carry a
   filter, a blend mode, or both. Counted at 1900×1066 (`getComputedStyle` over every element ≥100k px):

   | state | full-stage surfaces | blurs | SVG ref filters | blended |
   |---|---|---|---|---|
   | shipped defaults | 11 | 2 | 1 | 6 |
   | + SWEEPS | 13 | 2 | 1 | 8 |
   | **+ LIGHT** | **21** | 3 | **3** | 11 |
   | + MATTE & SHEEN | 21 | 4 | 3 | 11 |
   | + FILL grid & instruments | 21 | 4 | 3 | 11 |

   **LIGHT ON is the step that hurts** — it nearly doubles the surfaces and triples the reference filters, because the
   fixture is a `perspective` + `preserve-3d` composite that can only reach the dome by resampling (see the layer
   handoff). The calibration grid and the instruments cost *nothing* here; they are path-length cost, which item 1
   covers. Three surfaces that were being paid for while switched off are now gone:

   - `#clRefl` read `filter: blur(var(--matte, 0px))`. **`blur(0px)` is not a no-op** — the element still gets a render
     surface and a filter pass over the whole tube. It is `var(--mattefx, none)` now, and the group's isolation was
     never the filter's job: `isolation: isolate` is on the element explicitly.
   - `--reflwarp` / `--reflwarpfix` were gated on FACE alone, so with the lamp OFF two full-stage SVG displacement
     filters ran over a fixture that `--fixvis: 0` and `--fixdisp: none` had already switched off. Gated on `lightOn`
     as well.
   - The two beam sweeps sat at `opacity: 0` with `mix-blend-mode: screen`. **A blended layer at opacity 0 is still
     composited.** They take `display: none` now. The note beside them already knew the half of this that concerns the
     animation; the blend was the other half.

   Not measured, and it needs a FOREGROUND window (see the debugging note): the actual ms-per-frame of what remains.
   The candidates, in order of suspicion, are `#clGlowLayer`'s 53.6px blur over the full stage, the frame's
   `feTurbulence` speckle at `overlay` blend, and `FLK_MIN_DT` — the flicker's write budget, which the note in
   `lFlickerStep` already calls the single biggest lever on frame rate, because every write re-filters the reflection
   group and with the lamp on that group is now three reference filters deep.

7. **THE LIGHT FIXTURE IS SHEARED BY ITS OWN WARP — open, and the cause is NOT in the geometry.** The reflected lamp
   leans: its top edge sits ~20px left of centre while its bottom edge is centred, a horizontal shear of roughly 5%
   proportional to y. Ruled out, each by measurement rather than by reading the code:

   - **The object is centred.** `crt_portal_clip` and `fixture rail` both measure a centre offset of exactly 0.00px
     against the glass centre.
   - **The field is symmetric.** `dx(x, y) + dx(−x, y)` over a 41×61 grid: max 2.8e-14 viewBox units.
   - **The map image is correct.** Decoding the actual data-URL back through a canvas and comparing each texel to
     `mapPoint` agrees to ~0.3px, which is the 8-bit quantisation plus the neutral-value bias below.
   - **It is not the filter region.** Matched zooms at the narrowed region and at 0/0/100%/100% are indistinguishable.
   - **It is not the glass-box staleness** (fixed below) — the shear survives the fix.
   - **It is not `--mattefx`, `foldQuad`, the inlined box radius or the `fixed` formatter.** Restoring `blur(0px)` on
     `#clRefl` changes nothing, and the other three measure **exactly 0** deviation against reimplementations of the
     previous code over ~10k sample points.

   So the fault is between the PNG and `feDisplacementMap` — how the browser places or samples the map — not in
   anything this code computes. Two concrete things to try next, in order: (a) drive the filter with a **synthetic map
   carrying a known linear ramp** and compare the rendered displacement to the predicted one, which measures the
   placement transform directly instead of inferring it; (b) suspect **colour management** — `feImage` takes a
   data-URL PNG with no embedded profile, and if Chrome converts it to the display profile the R and G channels are
   remapped non-linearly and independently, which breaks the symmetry the field has. `color-interpolation-filters` is
   already `sRGB`; that governs the filter's own space, not the image decode.

   One real defect found while looking, worth fixing whatever the shear turns out to be: **the encoder's neutral value
   is 128, and `feDisplacementMap`'s neutral is 127.5** (it divides by 255, so zero displacement needs exactly 0.5).
   That puts a constant `scale × 0.00196` — measured 0.31px at `scale` 160 — into both axes of every warp.

8. **SQUIRCLE shapes nothing in the picture** — only the dashed boundary. Wiring the clip to the frame toggle is
   the fix.
9. ~~**Phosphor and scanline density don't compress with the warp**~~ — done. Scanlines and grille are plotted
   through `faceF`, so they tighten where the glass turns by construction. **Phosphor texture still does not.**
10. ~~**GLARE reads 0**~~ — not a bug. `--glarelight` is written by `crt-vars` and read by the fixture; the stored
   setting in `crtlab` is simply `glare: 0`.
11. **CORNER (`state.gn`) is inert** — the superellipse is the only shape rule, so `gn` now only enters `guideKey`.
   Left alone deliberately during the cleanup; delete it or give it back a job.

## Debugging notes

- Verify by **measuring, not looking**. The cleanup pass was verified by re-implementing the pre-split algorithm
  (per-ray ring table, 128-bin field, two-arg `faceF`) inside `eval_js` and comparing: 741,376 field pixels
  bit-identical at 1561×1103, ring path strings and band fills byte-identical, across six settings spanning
  ±90°, CURVE AREA 0/1/5/14/20, SQUIRCLE 0–100 and half-res. That comparison is the tool to reach for whenever a
  refactor claims to be behaviour-preserving.
- Ring quadrant maxima are exactly equal in all four quadrants (spread 0.000000000) — the outline is one quadrant
  mirrored, so any spread at all means something is measuring the mirror rather than the shape.
- Sample ring paths with `getPointAtLength` and compare quadrant maxima. (The PNG-decode check that used to be
  here died with the map.)
- **The readout is a promise.** FACE reports its effective fold cap marked ` MAX` rather than the request. If you add
  another clamped control, follow that contract: show what is DRAWN. A clamp that is not surfaced is the bug this
  instrument exists to find.
- **Better than surfacing a clamp is not needing one.** SCANLINES went count -> density for exactly this reason. As a
  total its ceiling depended on the window (218 lines on a short one, 446 on a tall one) so the slider's top end moved
  as you resized; as a density in rendered px there is nothing left to clamp at all. Reach for this before reaching for
  a marker. (The range briefly stopped at 33 PPI / a 3px pitch, back when the stroke was a fixed 42% of the pitch and a
  finer setting therefore forced a thinner-than-renderable line. WIDTH is its own control now, so that coupling — and
  with it the ceiling — is gone: 100 PPI is a 1px pitch and the line width is whatever you set.)
- **The unit is presentation; the number is not.** The readout says `PPI`, but the value is lines per 100 rendered
  pixels — the real drawn quantity, measurable on screen. The label is deliberate costume and the distinction is the
  rule: dress the unit to suit the fiction, never the value. A real PPI or mm dot pitch would need a declared tube
  diagonal, which does not exist yet; add a TUBE SIZE control and both become honestly derivable.
- **Count what you claim.** The scan pattern's line count was reported wrong twice in one session before anyone
  counted subpaths in the actual `d` attribute. `d.split('M').length - 1` is the whole test.
- **The helmet's ES modules do not hot-reload with the logic class.** Editing anything in `crt/` and then measuring
  without a page reload measures the OLD module. This is silent and it looks exactly like a maths bug: a signature
  change from `pitch` to `count` gave 9 lines instead of 120, which is precisely what the old function does when
  handed the new argument. Reload before believing a measurement.
- A 616×540 preview cannot reproduce the >1024 map bug. Check geometry at the user's size.
- **A backgrounded tab reports 0-1 FPS and it means nothing.** Chrome does not run `requestAnimationFrame` in a hidden
  tab (`document.visibilityState === 'hidden'`), so the readout, `__crtProf` and every wall-clock frame measurement go
  to zero while the page is behind another window — which is exactly the state a tab driven over CDP is usually in.
  Check `document.visibilityState` before believing an FPS number. JS-side cost is still measurable there: null the
  memo keys and time `renderVals()` in a loop, which is what the numbers in Open item 1 are.
- If an overlay and the picture disagree, find the second description and delete it.
