# Wormhole Lab

A tunnel down the throat of a wormhole: a domain-warped fbm field swept along a seamless angular coordinate, in
three flavours — nebula, lightspeed, plasma vortex.

`Wormhole.html` is the view: the canvas, the readouts, the panel, the frame loop. Everything else is logic.

```
wormhole-shader.js    the GLSL. Pure source: uniforms in, one colour out
wormhole-sidebar.js   SECTIONS (panel layout) + FMT (how each value reads) + EFFECTS (the layers, for the mast)
wormhole-presets.js   defaultPreset — the shipped configuration, and nothing else
```

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

Sections read top to bottom in the order pixels are built: RENDER decides how much is drawn, IMAGE is the
whole-frame post applied to the finished result, then each thing that draws.

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
