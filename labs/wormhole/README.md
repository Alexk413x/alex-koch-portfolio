# Wormhole Lab

A tunnel **solved** rather than marched, ending at a black hole traced along real light paths.

`Wormhole.html` is the view: the canvas, the readouts, the panel, the frame loop. Everything else is logic.

```
wormhole-shader.js    the GLSL. Pure source: uniforms in, one colour out
wormhole-sidebar.js   HEAD + shellSections (panel layout) + FMT (how each value reads)
wormhole-presets.js   defaultPreset — the shipped configuration, and nothing else
```

`../kit/glquad.js` is the renderer, `../kit/lab.js` the host scaffolding, `../kit/units.js` the formatters, and
`../kit/panel.js` + `../kit/panel.css` the panel. There is no sim: the scene is a pure function of
`(state, time)`, so `renderNow(sec)` reproduces any frame exactly.

## The wall is a cylinder and a ray is a line

Which means where they meet has a **closed form**. That is the whole idea: one root-find per shell instead of a
loop of samples down every ray. What used to live at this path marched 28 steps through a 3D density field to
answer the same question and cost 46 ms per megapixel; this costs about 15.

**There is no integral being estimated, so there is no grain.** A march estimates each ray from a handful of
point samples of a field finer than its own step, so where those samples land decides the answer and
neighbouring pixels disagree. Here the answer is exact, so that term does not exist.

**Shells are what buys depth back.** One surface has nothing in front of anything else. Six cylinders at six
radii are met at six depths by the same ray, so compositing them front-to-back gives real occlusion *and* real
parallax. Every shell can carry every effect — NEBULA, PLASMA, STREAKS and RINGS are amounts on a surface, any
mix, any shell.

**The shells are sorted inner-first by the host**, and that is load-bearing twice over: compositing needs it,
and so does the solver. `Rc` is `mix(R, uEndR, taper)` and `mix` is monotone in `R`, so a wider shell's surface
is never nearer the axis at any depth — which means each shell's scan can start where the last one hit instead
of at the eye. That is most of the geometry cost.

## The far end is a black hole, and it is traced

Not a sprite and not a screen-space pinch. The shader integrates the real null geodesic:

```
d2x/dlambda2 = -(3/2) Rs h^2 x / r^5,   h = |x cross v|, conserved
```

with velocity-Verlet, bounded to the rays that pass near the hole. Everything falls out of that one line rather
than being drawn: the shadow is the rays that reach `r < Rs`, and its edge lands at 2.598 Rs on its own — that
number appears nowhere in the loop. The photon ring is rays that wound most of a turn and came back. The disc's
second image, the arc over the top of the shadow and under the bottom, is simply the ray's second crossing.

**MASS is the only number the hole has.** Everything else is a fixed multiple of its Schwarzschild radius: the
shadow at 2.598 Rs, the disc's inner edge at the innermost stable orbit of 3 Rs. Derived, they cannot disagree.

The tunnel is bent by the same law solved on paper, `delta(s) = (Rs/b)(s + sqrt(s^2 + b^2))`. For every
`s <= 0` that lies in `(0, Rs]`, and the whole tube is at or before closest approach — so the largest sideways
pull anywhere in it is exactly one Schwarzschild radius, and no clamp says so.

## Two motions, two controls

DISC SPIN is how fast the disc turns and which way. DISC FLOW is how fast its material travels along the radius
and which way: it is a rate of change of radius, so **negative falls toward the hole** and positive streams away.
An accreting disc is a negative one, and that is what ships. FLOW used to be taken from SPIN — rate and sign
together — which meant spinning the disc the other way made its material flow outward.

The Keplerian **shear saturates**, and it has to. Rotation twists the pattern by `turn * kep * 0.5` and `kep`
falls outward, so the spiral would wind tighter forever; a winding spiral's constant-phase curves travel
outward for *both* signs of rotation, which made the disc read as spraying out however it was spun.

## Rates are integrated, not multiplied by the clock

The host integrates every rate — each shell's SPEED and SPIN, and BEND FLOW — into a phase, and hands the shader
the phase instead of the rate. The shader used to compute `uTime * rate`, so when a move scaled a rate the change
was multiplied by the whole elapsed clock: a burst lurched the walls forward as the speed rose and back as it
fell. At rest the phase is exactly rate times time, so nothing about the shipped look changed.

## Running it

ES modules mean `file://` will not work.

```
python -m http.server 8000     # then http://localhost:8000/labs/wormhole/Wormhole.html
```

`window.WORMHOLE` is the handle: `state`, `R`, `renderNow(sec)`, `fit()`, `saveState()`, `rebuildPanel()`.

```
python bench.py --page wormhole --uncapped
```

**It stores under `tunnel`, not `wormhole`**, and that is deliberate — see the note above `persist()` in
`Wormhole.html`. A storage key is an address rather than a label, `tunnel` is what this lab was called while it
was built, and `wormhole` belongs to the lab that used to live here and describes different controls entirely.

## Where the frame goes

Measured by GPU timer query on an Intel UHD 630 at 0.74 MP, one thing switched on at a time:

| item | ms |
|---|---|
| post chain alone | 1.20 |
| `solveShell` geometry, first shell | 2.17 |
| each additional shell | 1.92 |
| NEBULA at 4 octaves / at 1 octave | 1.24 / 0.40 |
| PLASMA | 0.68 |
| STREAKS / RINGS | 0.22 / 0.17 |
| the black hole at the shipped MASS | 0.16 |

**The geometry solve is the whole cost** — about sixty per cent of a three-shell frame before an effect is drawn.
The hole is nearly free. BEND makes the frame slightly *cheaper*, because a bent tube exits its scan sooner.

At 14.6 ms/MP a 60 fps budget buys about 1.14 MP, so **100% render scale is the target and anything past it is a
hardware question**. Deleting the entire geometry solve would still leave 6.5 ms/MP.

## Known, deliberate, not bugs

- **The arc across the shadow runs opposite to the disc outside it.** That is the secondary image, which lensing
  inverts radially: larger disc radii map nearer the shadow's edge.
- **Higher images stop at a turn and a quarter.** Each is squeezed into about `e^-2pi` of the width of the one
  before, so the third lands inside a pixel and reports which side of itself that pixel fell on. Damping by
  accumulated winding angle — continuous in the impact parameter — fades them instead of stepping.
- **Speckle along the nebula's edges** is the noise field outrunning the sample rate where the wall goes
  edge-on. A filtering problem, not a fault. The concentric *rings* that used to accompany it were `graze`
  differenced over a collapsed bracket, and those are fixed.
- **DISC HEIGHT is in Schwarzschild radii** because a percentage of something the panel never names is not a
  reading of anything.
