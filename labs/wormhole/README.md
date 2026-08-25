# Wormhole Lab

A tunnel down the throat of a wormhole: a domain-warped fbm field swept along a seamless angular coordinate, in
three flavours — nebula, lightspeed, plasma vortex.

`Wormhole.html` is the view: the canvas, the readouts, the panel, the frame loop. Everything else is logic.

```
wormhole-shader.js    the GLSL. Pure source: uniforms in, one colour out
wormhole-sidebar.js   SECTIONS (panel layout) + FMT (how each value reads) + EFFECTS (the layers, for the mast)
wormhole-presets.js   defaultPreset — the shipped configuration, and nothing else
```

The panel reads RENDER (how much is drawn), IMAGE (the lens and the whole-frame post), TUNNEL (the shape of the
tube — COVERAGE, WALL, RIBS, BEND, and every row that governs all three layers at once), then each layer.

Shared, not local: [`../kit/glquad.js`](../kit/glquad.js) hosts the shader, [`../kit/panel.js`](../kit/panel.js)
and `../kit/panel.css` are the panel. There is no `wormhole-sim.js` — the field is a pure function of
`(state, seconds)` with nothing accumulating, so there is no machine to hold.

## There are no button strips, and no presets

Every section that can be switched off owns a **master in its own header** — the third entry in its `SECTIONS`
tuple, which `kit/panel.js` has always supported. NEBULA, LIGHTSPEED, PLASMA and CORE each carry one, and they are
independent flags rather than a radio group, so any combination runs at once.

That replaced a strip of layer buttons above the panel. A strip puts "is this on" in a different place from "what
is it set to", and the answer to both is the section.

**The JUMP and STORM presets are gone with it.** They were three tuned scenes behind three buttons, and nothing
else reached `PRESETS` or `matchIdx` once the strip went — dead data behind a deleted control. They are in the
history if the scenes are ever wanted back.

Sections read top to bottom in the order pixels are built: RENDER decides how much is drawn, IMAGE is the lens
and the whole-frame post applied to the finished result, TUNNEL is the shape of the tube every layer is drawn in,
then each thing that draws.

## What makes it read as a tunnel, and what did not

The scene shipped for a long time as three layers of field and nothing that said *tube*. It was described, fairly,
as "clouds going by and a background spiral". Three things fixed that, and they are in the order they matter:

**FOV is the largest of them.** The ray was built as `vec3(uv, 1.3)` — about 42° vertical — and at that angle the
wall never reaches the edge of the frame. Everything sits out in front of the eye, which is what a cloud does and
not what a corridor does. At 74° the wall sweeps the periphery and the picture closes around the viewer. It is now
`uFov`, stored in DEGREES and converted where it is sent: the shader wants the ray's z, where small is wide, and a
slider running backwards from the number printed beside it cannot be aimed.

**COVERAGE down and WALL up, together.** COVERAGE 0.8 filled the tube almost to the axis, so there was no clear
throat to travel down; `wallProfile`'s falloff was a fixed 0.35 of the radius, so there was no surface to travel
past either. A skin on the wall with an edge that arrives over a few percent is a tube; the same three layers
otherwise unchanged.

**RIBS are rings of thick and thin wall** sliding toward the eye. A ring lives at a fixed depth, so it foreshortens
toward the throat and arrives faster as it comes — and one cosine per step buys the whole cue.

Two ways of writing RIBS were tried first and neither is visible on screen. Do not spend the time again:

- **Through COVERAGE** (`wallProfile(s01, cov * ribK, soft)`) moves only the wall's INNER edge, and the profile
  saturates at 1 for every sample past the wall — which is most of the ray over most of the frame, because a ray
  leaves the tube early and keeps marching to FAR. The rings appeared in one thin annulus near the throat.
- **As grooves** — density REMOVED at each ring — is invisible for a different reason: a ray crosses several ribs
  on its way out, and thinning some of them only changes a sum that was already smooth. A ring has to OCCLUDE to
  read as a ring, so the near one stands in front of the far one. It is now dense rings with a thin tube between.

**The core's hot centre was a hard-edged disc** (`smoothstep(0.045, 0.0, rc)`) and read as a ball pasted over the
picture in every shot. Cubed over three times the radius it peaks at the same value and blooms into the corona
instead of stopping against it.

## The nebula's fbm stops as soon as the answer is fixed

**19.0 ms per frame to 12.1**, measured interleaved on an Intel UHD 630 at 32 steps, for a byte-identical picture.
It is the largest single saving this lab has had, and it is what made 60 reachable at all: end to end the lab went
from 79.34 to 46.31 ms per megapixel uncapped, and now holds 60 capped with 1.57x headroom. Those two figures are
not the same measurement — the shipped integrated step count also came down from 32 to 26 to buy the last 1.8 ms,
and only the 19.0-to-12.1 pair is like for like.

The cloud's density is `smoothstep(lo, lo + 0.26, w * var)` over a five-octave sum, and a tunnel is mostly empty —
so most samples were fetching five octaves to produce a density of exactly zero. A partial sum already bounds the
finished one: the octaves left can add at most `rem` and at least nothing. A sum that cannot climb to `lo` is a
zero however it finishes, and one already past `lo + 0.26` is a one. Both exits return a value on the same side of
the same threshold, so it is EXACT rather than an approximation.

Two details are load-bearing. The normaliser is passed IN (`fbmNorm`, resolved once per frame) — accumulating it
inside would renormalise against the octaves that happened to run, which is a different field rather than the same
one cut short. And the threshold is divided by VARIANCE rather than the field multiplied by it, so the sum knows
what it has to beat before it starts; both sides are positive, so it is the same comparison either way round.

## Where the rest of the frame goes

Attributed by stubbing one thing at a time and interleaving A/B/A/B, four rounds each, on the retuned scene at
561x408. The base is 12.15 ms of GPU time — `EXT_disjoint_timer_query_webgl2` around a batch of `renderNow` calls,
because this machine's wall clock drifts further than the effects being measured.

| stubbed out | saving | picture |
|---|---|---|
| `bendAt` — four transcendentals a step | 4.1% | different |
| both layers' `spin` — two more | 3.2% | different |
| the three COVERAGE uniforms, collapsed to one | **2.6%** | **identical** |
| the RIBS branch, removed rather than switched off | 1.1% | different |

**Only the coverage collapse was taken.** It was three uniforms carrying one control's value long after the panel
stopped offering three rows to set them from, so the march evaluated `wallProfile` twice a step against two copies
of the same number. The fingerprints matched to the last digit.

The other three are the answer to "is there a big lever left": there is not. Four transcendentals a step cost half
a millisecond between them, so no cheaper sine is worth writing — a polynomial sine is about eight ALU ops against
one special-function op, and on this part the special-function unit issues at a quarter rate, which makes the
polynomial the slower of the two. RIBS cost a fortieth of the frame and carry most of the scene's sense of speed.

**About half the frame is not the shader at all.** 12.15 ms of GPU time reads as 18.2 ms of wall clock, and the
difference is the composite: the canvas is 561x408 and the browser scales it to 2182x1587 device pixels on an
integrated part that is already driving a 4K desktop. Nothing in the shader touches that; only RENDER SCALE does.

**The same trick on PLASMA's filament measured worse and is not in the build.** A filament is where two noise
fields both cross zero, so a sample whose first field is already outside the kernel cannot be on a bolt — five in
six, at the shipped CRACKLE. Alone it was worth 9%; stacked on top of the nebula gate it cost 5% against the gate
by itself, twice, interleaved. Two nested early-outs in one loop diverge more than they save here.

## The shader is built for whichever layers are on

A layer costs even with its uniform at zero — the march pays for code it does not run. Measured at 480x360 and
32 steps on an Intel UHD 630, against a shader carrying all three layers:

| lit | all-three shader | built for that set |
|---|---|---|
| plasma | 9.28 ms | **3.38 ms** |
| lightspeed + plasma | 10.01 ms | **4.97 ms** |
| lightspeed | 1.83 ms | **1.24 ms** |
| nebula | 7.36 ms | **5.93 ms** |
| nebula + lightspeed | 8.17 ms | 7.56 ms |
| all three | 10.02 ms | no change — it is that shader |

So each layer's functions and its call site sit behind an `#ifdef`, `fragFor(neb, ls, pl)` returns the source for
a set, and `glquad`'s `R.use(key)` switches between them. **The key is derived from the same flags the uniforms
are sent from** — a key that disagrees with them silently drops a layer, and two lists would eventually disagree.

Nothing stalls: `FRAG` is the superset and draws correctly at any setting, so it covers the frames while a
narrower build compiles, and `KHR_parallel_shader_compile` keeps that compile off the main thread. Switching a
layer therefore costs nothing visible — the frame simply gets cheaper a moment later.

Two shaders compiled separately do not schedule their arithmetic identically. Across 120 whole-frame
comparisons, seven differed — by **four subpixels out of 691,200, each off by one of 255**. That is rounding, not
a different picture, and it is the reason a permutation is checked by how far apart it is rather than by a hash.

## PLASMA's early-outs live in the march, not in a function

Written as one function with early returns, they measured **free** — 16% of samples reach the filament and 1.4%
the flash gate, yet deleting both tests changed nothing, and *adding* two texture fetches behind them made the
frame 36% faster. The compiler was flattening them and running the filament on every sample.

`plasmaSite` / `plasmaFil` / `plasmaLive` are three functions so the march can decide between them. Same frame,
half the cost. Do not collapse them back.

## `uPanelPx` is gone, and that was the point

The canvas used to span the viewport with the sidebar painted over its right-hand 340px, so the shader was handed
the panel's width and shifted the tunnel's centre to compensate — while still evaluating every covered fragment,
three noise octaves deep, in order to hide it. The canvas is now a child of the stage, which the panel insets by
being its flex sibling. Measured: **872×634 where the DC build rendered 1111×635**, at the same render scale.

Size from `stage.clientWidth`, never `innerWidth`, or hiding the panel stretches the buffer.

## Verifying a change here

**Measure, don't look.** The port was checked by diffing the GLSL line for line against the DC build's — 48 lines,
differing only in the `uv` line and the dropped `uPanelPx` declaration — and by driving the controls over CDP and
reading the result back (12 checks: the loop, a drag, a stepper, a fold, the debounce, and a reload).

`window.WORMHOLE` is the handle: `state`, `R`, `renderNow(sec)`, `fit()`, `saveState()`.

**`renderNow` pins the clock and draws synchronously**, so a frame is reproducible and reachable from a tab that is
not front-most. **Read pixels in the same task as the call** — the context is `preserveDrawingBuffer:false`, so a
later `readPixels` returns a cleared buffer and a working shader reports as black.

```
python bench.py --page wormhole --uncapped
```
