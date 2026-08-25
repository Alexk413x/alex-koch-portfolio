# Reactor Lab

A containment core: a sphere-traced SDF scene — a turbulent goo core, nine alloy ring fragments and a continuous
inner shield band — with a pulse that tears sub-cores out of the surface and a vent that charges, booms and fades on
a schedule the panel sets.

`Reactor.html` is the view: the canvas, the readouts, the panel, the frame loop. Everything else is logic, and none
of it can reach the page.

```
reactor-shader.js    the GLSL. Pure source: 49 uniforms in, one color out
reactor-sim.js       createSim() -> { step, firePulse, fireVent } — the pulse spring, the vent envelope,
                     the break/scatter machine, the instability lag, and the droplet table
reactor-sidebar.js   SECTIONS (panel layout) + FMT (how each value reads)
reactor-presets.js   PRESETS, MODES, CAM_KEYS, matchIdx, defaultPreset
reactor-uniforms.js  sendUniforms() — one state and one pose in, every uniform the shader reads out
```

The home page draws this scene too (`site/hero-core.js`: the core alone, ring off, accent-colored), which is why
the uniform block is a module rather than a paragraph of `R.f` calls inside this page's `draw()`.

Shared, not local: [`../kit/glquad.js`](../kit/glquad.js) hosts the shader, [`../kit/panel.js`](../kit/panel.js)
and `../kit/panel.css` are the panel.

## The split is between deciding and drawing

`reactor-sim.js` holds every accumulating number in the lab and can reach nothing. That is the same rule
[`../crt/README.md`](../crt/README.md) is built on, arrived at for a second reason: in the DC build this arithmetic
was interleaved with its own `gl.uniform1f` calls inside one 140-line `frame()`, so no value could be read without
also uploading it, and nothing could be checked without a GPU.

`step(state, dt, sec)` fills and returns **one reused object**. Read it and drop it — do not keep it.

**Everything animated is integrated into a phase.** `orbit` is a rate; what the shader receives is `uPhOrbit`, the
angle accumulated from it. Turning a speed down therefore slows the rotation instead of teleporting whatever it was
driving to wherever a smaller multiple of the elapsed time would have put it. Ten of the DC build's uniforms were
the *speeds* these phases replaced, still being uploaded.

## The ring is lit by a sphere, and its outward face is lit by nothing

The core is the only light in the scene, and it is a meter-wide ball a meter away — not a point. `sphereDiff`
takes its angular radius, which does two things a point at the origin cannot: it softens the terminator by the
light's real size, and it supplies the inverse-square falloff. **RING SIZE and CORE SIZE therefore change how lit
the ring is**, which is why `LIGHT_NORM` exists — it is `1/sin²A` at the shipped SIZE and RING SIZE, so stored
settings keep the brightness they were calibrated against while the falloff itself stays physical.

The consequence worth stating plainly: **the outward face of the band is turned away from the only light, so it
has no diffuse term at all.** What carries it is the reflection of the chamber's haze, the grazing rim, and the
ring's own lamps. That is also where ROUGHNESS acts — the outward face never sees the core's highlight, so a dial
that only widened that lobe would do nothing on the face you mostly look at. A wide lobe integrates a broad cone
of the chamber and catches the core even where the mirror direction misses it; a polished face reflects the sharp
image of an empty chamber, which is nearly black.

The surface is a **height field in meters** (`ringRelief`), and everything reads off that one description: the
bump, the cavity darkening and the paint. `bumpN` tilts the normal by the field's true world-space gradient —
the hit point's screen derivatives convert dH/dpixel into dH/dmeter. Perturbing the normal's x and y by screen
derivatives directly is the obvious shortcut and it shades without ever reading as relief.

Feature sizes are metric, so a bay's rib and its lip keep their size as the ring grows; the fine scribing stays
angular, so it does not densify on a big ring. Every mask is pixel-bounded through `cover`/`dashes`, which fade
below a pixel rather than aliasing into sparkle.

## Two descriptions of the core's radius, knowingly

`step` recomputes the core's live radius in JS exactly as the shader's `coreRadius()` computes it, because what
happens next — whether the core has pushed **past** the ring, and therefore whether the ring breaks — depends on it,
and the CPU cannot ask the GPU without a readback stall every frame. It is the one place this lab breaks the
one-description rule, and it is flagged here so that a change to `coreRadius()` is known to need a change beside it.

## What the audit found

Measured by stripping the uniform declarations and grepping the body, not by reading:

- **Ten of 61 uniforms were uploaded every frame and never read** by a single line of the shader: `uOrbit`, `uCam`,
  `uMode`, `uRingBreak`, `uStretchAmt`, `uWobbleSpd`, `uCoreSpin`, `uCoreSpinX`, `uPulseSeed`, `uForce`. Deleted.
  Note that most of the *controls* behind them are live — the value reaches the sim, it just never reached the GPU.
  `uPulseSeed` is the clearest case: the seed genuinely varies the sub-cores' arrangement, in `step`, on the CPU.
- **`ventStretch` did nothing at all.** It had a state field, a META entry and a uniform (`uStretchAmt`), appeared
  in no panel section, and its uniform was unread. Fully dead, removed.
- **`uFragFly` and `uSnap` were read but never moved**, pinned at 0 and 1. The auto-fling they drove was superseded
  by the manual break-scatter (`uScatter`), which reaches the same fly-apart from a control. Both are gone, along
  with `rotZ`, `sdHexPrism` and a `p0` captured for a bulge that no longer exists.
- **RADIATION was a second color control.** It rotated the hue of the color the picker had already chosen, so
  every setting it could reach was reachable from the swatch. Gone, and `uHue`, `hueShift()` and `coreCol()` with
  it — the last two existed only to serve it.

## The ring's three axes, and why the spin is composed innermost

`ringSpace` builds `rotY(spin) · rotX(tumbleX) · rotZ(tumbleZ) · p`, and the **order is load-bearing**. Put the Y
rotation on the outside instead and it stops being a spin: the ring's axis in world becomes

```
(-sin a · sin b,  cos b,  cos a · sin b)        a = the Y angle, b = the tilt
```

which depends on `a` the moment anything has tipped the ring. One control would then do two jobs — a spin while
the ring is flat, a precession once it is not — and the two rows would stop being independent. Composed innermost
the axis is `(-sin g · cos b, cos g · cos b, sin b)`, with no spin term at all.

Measured, on the ring's silhouette rendered as a bare geometry mask: spinning by 90° and 180° gives an
intersection-over-union of **1.0000** at every tilt, against **0.0895** for a half-radian tumble. The spin moves
the machined surface past the camera and nothing else.

The two tumbles are about world X and world Z, so between them the axis reaches anywhere on the sphere — a single
tumble axis only ever traces one great circle. Each carries its own WOBBLE, because a nutation belongs to the axis
it perturbs.

**Test an intact ring.** A broken one is nine separate fragments and is genuinely not rotationally symmetric, so
this measurement reads as failure against a ring that is behaving correctly. Confirm `sim.step().ringR` equals the
SIZE slider before trusting it — and note that clearing localStorage then reloading does NOT reset state, because
the flush on hide writes the in-memory values straight back.

## Rotation rates are stored in RPM

Not rad/s. They are read, stepped, typed and authored in RPM, so storing radians meant the panel converting on
every one of those — and a step of `0.02 rad/s` is `0.19 RPM`, which left the readout sitting on the same integer
for five clicks before jumping, never landing on an exact value. The ranges were rounded radians too, so the ends
read `50.006` and `59.97` rather than 50 and 60.

Stored as RPM the panel does no arithmetic at all: integer range, integer step, integer readout, integer preset.
`reactor-sim` multiplies by `RAD_PER_RPM` once, where a rate becomes a phase. Angles are still radians — they are
not stepped in whole degrees and have no such problem.

## What did NOT make it faster

The ring's and core's orientation matrices are built inside `ringSpace` and `coreSDF`, which the march calls
seventy times per pixel and four more times per normal — about 1400 transcendentals a pixel by hand count. Hoisting
them into frame constants assembled once in `main()` looks like an obvious win.

Measured across four interleaved runs it is **worth nothing**: medians 5.0 / 5.2 / 5.3 / 5.0 ms, inline against
hoisted. The matrices depend only on uniforms, so the shader compiler already lifts them out of the loop. The hoist
was reverted rather than kept — it bought no time, and it cost three mutable globals and a hand-written transpose
in a file otherwise built from pure functions.

The one attribution that did pay is the land/water map behind its branch, above.

## A preset is only its values

`mode` used to leak into the simulation: it scaled the ring's spin, orbit, wobble and the core's two spins by an
instability term, overrode the SHIELD slider outright in CRITICAL and MELTDOWN, and moved the pressure and
integrity gauges. So ORBIT at zero still tumbled the ring, and no row in the panel told the whole truth about what
it did.

Nothing reads a mode now. `applyPreset` writes the sliders and stops, `matchIdx` derives which preset is active
from the values, and the `mode` key is gone from state entirely. **A state dialed in by hand behaves identically
to the button that would have set it** — verified, not assumed. What still moves the shield is what happens TO it:
a pulse knocks it down, the core pressing on the ring stresses it, a vent floods it.

## Verifying a change here

**Measure, don't look.** The port was checked by diffing the GLSL body line for line against the DC build's —
357 lines, differing only in the one `uv` line that removes `uPanelPx` — and by driving every control over CDP and
reading the consequence back out of the page (28 checks: sliders, steppers, folds, the RING master, presets and
CUSTOM, PULSE, VENT, the color row, the debounce, and a reload).

`window.REACTOR` is the handle: `state`, `R`, `sim`, `renderNow(dt, sec)`, `rebuildPanel()`, `saveState()`.

**`renderNow(dt, sec)` draws synchronously**, which reaches a tab that is not front-most — where Windows Chrome
delivers no animation frames at all.

**It is NOT reproducible, and Wormhole's is.** `sim.step` mutates: the phases, the spring and the break machine all
carry forward, so the same `(dt, sec)` twice gives two different frames. A pixel fingerprint of this lab therefore
means nothing unless the sim is fresh. Note also that the first argument is **dt**, not the time — calling
`renderNow(8)` steps the simulation eight seconds in a single frame, which is a good way to confuse yourself.

**Read pixels in the same task as the call**: the context is `preserveDrawingBuffer:false`, so a `readPixels` from
a later call returns a cleared buffer, which looks exactly like a shader that outputs black. That one cost a
debugging cycle here.

```
python bench.py --page reactor --uncapped
```
