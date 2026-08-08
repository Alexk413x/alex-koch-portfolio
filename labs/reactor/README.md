# Reactor Lab

A containment core: a sphere-traced SDF scene — a turbulent goo core, nine alloy ring fragments and a continuous
inner shield band — with a pulse that tears sub-cores out of the surface and a vent that charges, booms and fades on
a schedule the panel sets.

`Reactor.html` is the view: the canvas, the readouts, the panel, the frame loop. Everything else is logic, and none
of it can reach the page.

```
reactor-shader.js    the GLSL. Pure source: 50 uniforms in, one colour out
reactor-sim.js       createSim() -> { step, firePulse, fireVent } — the pulse spring, the vent envelope,
                     the break/scatter machine, the instability lag, and the droplet table
reactor-sidebar.js   SECTIONS (panel layout) + FMT (how each value reads)
reactor-presets.js   PRESETS, MODES, CAM_KEYS, matchIdx, defaultPreset
```

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
- **`uFragFly` and `uSnap` are read but never move.** The auto-fling they drive was disabled in the DC build behind
  a literal `if (false)`, superseded by the manual break-scatter (`uScatter`) which reaches the same fly-apart from
  a control. They are left at 0 and 1: cutting them changes what the shader can express, which is a deliberate
  decision and not a side effect of moving code. **Cutting them is a real follow-up.**

## Verifying a change here

**Measure, don't look.** The port was checked by diffing the GLSL body line for line against the DC build's —
357 lines, differing only in the one `uv` line that removes `uPanelPx` — and by driving every control over CDP and
reading the consequence back out of the page (28 checks: sliders, steppers, folds, the RING master, presets and
CUSTOM, PULSE, VENT, the colour row, the debounce, and a reload).

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
