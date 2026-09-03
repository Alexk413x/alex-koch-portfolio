# Cinematic intro: plan

## Status, 2026-09-02

Phase 1 is built and runs locally, end to end, on the Intel UHD 630. `python test/run.py` passes, including
`test/suite_intro.py`. The sequence after the second pass of direction: CRT boots and types (8.6s), prompt,
warp and surge at the lab's lengths (5s), power-off with the tunnel opening under it (1.6s), the arrival
(4.5s more), the cruise (5s, elastic on the ring's program), the run and crossfade (3s), STABLE, CRITICAL,
MELTDOWN (5s each, presets tweened over 1.4s, camera 1.35 to 1.0), the break (2.4s), the cool-down (3s).
About 40s from Enter to the reveal, which is what was asked for; every number is in `LENGTH` and `ZOOM`.

Measured at 1500x950 on the iGPU: 54 to 60 fps average on every beat except the run and crossfade (38) and
the break (44), where the ring's program and the tunnel overlap.

Tuning list, in the order it will matter:

- The cut. Target 18 to 20s after Enter; every number is in `LENGTH` and `PULSES` in `intro-script.js`.
- The dot to hole seam. The wormhole opens on black and the disc lights over 12% of the dive; the CRT's dot
  is gone 0.25s before. Try overlapping them.
- The break. The scatter throws the pieces past the canvas mask in about a second. Slower is a sim change.
- On a landscape phone (852x393) the CRT's last line sits under the viewport edge; the lab's own narrow
  mode does this. A `toy` offset in `introPreset` for short displays would lift it.
- The hero's `use('core')` compiles a second core program on every load; it always did. Harmless.


The intro is the hook. It runs once per session on the home page, it is skippable at any moment, and its last
frame is the hero's idle frame, so the viewer lands at the top of the scroll experience already oriented.

## The sequence

| # | Beat | Scene | Length | Ends on |
|---|------|-------|--------|---------|
| 0 | Boot | CRT | until ready | CRT programs linked, then PWR_ON (1s) and the boot text types |
| 1 | Prompt | CRT | until input | Enter, click, or tap. Idle hint after 8s, auto-advance after 20s |
| 2 | Surge and warp | CRT | 2.5s | time |
| 3 | Power off | CRT | 1.0s | PWR_OFF track: collapse to a white dot at bright 4.4 |
| 4 | Hole | Wormhole | 3.2s | DIVE: the swollen hole shrinks and turns down onto the axis |
| 5 | Settle | Wormhole | 3.6s min | SETTLE, elastic: holds until the reactor's full program is linked |
| 6 | Run | Wormhole | 3.0s | new move: bend up, shells faster, streaks up, exposure to white |
| 7 | Flash to core | Reactor on hero canvas | 1.0s | white fades to a green core with the ring lit |
| 8 | Stages | Reactor | 7.0s | three pulses of rising amplitude, then a vent |
| 9 | Break | Reactor | 3.0s | swell passes 100% (auto break) then 200% (scatter) |
| 10 | Stabilize | Reactor to hero | 2.5s | ring off, core green to orange, spin to idle, overlay removed |
| 11 | Reveal | Home page | 3.0s | `booting` removed: title, text, then nav |

Total after Enter is about 27s at these lengths. The hook should be nearer 18 to 20s. Every length above is a
number in one data file, so the cut is an edit, not a rewrite.

Cuts between scenes:

- **Dot to hole.** The CRT's collapse dot and the wormhole's swollen hole are both at the center of their
  canvases. The wormhole canvas is positioned so its center sits on the dot, and it fades in over the dot in
  0.2s. The dot's afterglow reads as the disc's rim.
- **Run to core.** Exposure runs to white in the last 0.6s of the run. The wormhole canvas is destroyed at the
  top of the flash. The reactor is already drawing under it.
- **Core to hero.** There is no cut. The reactor leg draws on the hero's own canvas through `R.use('full')`. The
  stabilize beat ends in the hero's exact state, then the overlay root is removed from the DOM.

## Architecture

**The reactor leg runs in place.** `site/hero-core.js` already mounts the reactor's modules on the hero canvas
with the ring assembly off. The intro switches the ring on, drives the sim, and switches it off. The handoff
into the page costs nothing because it is the same canvas, the same state object and the same sim.

**The CRT and wormhole legs run in same-origin iframes, phase 1.** Each lab's host page is loaded with `?intro`,
which hides the panel and readouts, skips the stored configuration, and applies an `INTRO` preset from the
lab's own presets module. The director reaches `iframe.contentWindow.CRTGL` and `.WORMHOLE` directly. Reasons:

- The CRT host owns its frame loop, content canvas, power, warp and surge sequencing in `CRT Lab.html`. That is
  about 200 lines that are not a module today. An iframe uses it as is. One copy.
- Each lab's whole control panel is available for tuning during the intro with `?intro&panel`. Dial the warp
  or the disc live, then copy the values into the INTRO preset.
- Each iframe is destroyed when its leg ends, so at most two GL contexts are alive at once.

Phase 2, only if the iframe seams show: extract the CRT host's frame and bag building into `crt-scene.js` and
mount it in the page. `CRTPROBE.hash()` verifies that refactor to the pixel.

**Readiness gates, not timers, start the heavy legs.** Reactor's full program is a 39s cold link on an Intel
UHD 630 and 7.5s for the core build. The director starts every compile at t=0: the CRT's four programs, the
wormhole iframe hidden, and `HERO.R.use('full')`. The CRT boot beat ends on link. The settle beat is elastic and
holds until the full reactor program reports ready. A warm GPU shader cache makes all of this instant on a
second visit.

**Shared motion primitives move to the kit.** `wormhole-moves.js` has `ease`, `bell` and `seg`, and
`crt-power.js` exports `bezier` and `poseAt`. They become `labs/kit/motion.js`, imported by both labs and the
director. One copy. The wormhole's reproducible `renderNow(sec)` verifies that move.

## Files

New:

- `site/intro/intro.js`. The director. Mounts `#intro`, owns the clock, the gates, input, skip, and removal.
  Runs its own rAF loop and calls the legs' triggers. Never draws.
- `site/intro/intro-script.js`. Pure. The beat table: `{ id, scene, dur, until, tracks, enter, exit }` per beat,
  and `SCRIPTS = { v1, v2, ... }` selected by `?intro=v2`.
- `site/intro/intro-debug.js`. The HUD behind `?intro&debug`: beat name, elapsed, gate state, program readiness,
  and keys. Space pauses. Left and right restart the previous or next beat. R restarts. 1 to 4 jump to a scene.
  Minus and equals set speed 0.25x to 2x.
- `site/intro/intro.css`. The overlay root at z-index 200, the crossfade rules, the skip control.
- `labs/kit/motion.js`. `ease`, `bell`, `seg`, `bezier`, `poseAt`.
- `test/suite_intro.py`.
- `intro-capture.py`, phase 3. Drives the director with an external clock at a fixed 60Hz step through CDP,
  screencasts frames, and writes an mp4 into the scratchpad. A cut becomes a file you can watch and compare.

Edited:

- `index.html`. The `#intro` root, the script tag, and the head reveal script: if the intro will run, the
  `booting` class stays until the director removes it. The 2500ms backstop becomes the director's failure path.
- `site/hero-core.js`. `HERO.take()` and `HERO.release()`. While taken, `draw()` stops writing spin, tilt,
  viscosity and angle from scroll and pointer, and the director writes state. `HERO.ready()` reports the full
  program.
- `site/site.css`. Overlay rules, a `.intro-done` nav fade, and a class that lifts the hero canvas's radial mask
  during the break beat so the fragments fly off the edge.
- `labs/crt/CRT Lab.html`, `labs/wormhole/Wormhole.html`. The `?intro` mode. Wormhole also exposes `moves`.
- `labs/crt/crt-presets.js`, `labs/wormhole/wormhole-presets.js`, `labs/reactor/reactor-presets.js`. One
  `INTRO` preset each. The reactor's is green `#28ff1a`, ring on, and vent timings cut for the intro.
- `labs/wormhole/wormhole-moves.js`. The `run` move: bend, flow, shell speed, streaks and exposure over 3s.
- `test/harness.py`. `goto()` sets the skip key first, so every existing suite sees the page it sees today.

## Policy

- **Once per session.** `sessionStorage['intro-seen']`. `?intro` forces it. `?nointro` skips it. Any hash in
  the URL skips it, so "Back to portfolio" and deep links land where they point.
- **Skip is always visible.** A small "SKIP" control at the bottom right. Escape skips. Skip cuts straight to
  the hero's idle state through the same stabilize path, so the page is never left half-driven.
- **Reduced motion** skips the intro entirely.
- **Phones** run it in phase 1 behind a flag, measured before it ships. Two contexts plus the CRT at phone size
  needs a number, not a guess.
- **Tests** never see it. The harness sets the skip key before navigation. `suite_intro.py` opens `?intro`
  on purpose and asserts: each beat ends on its stated gate, the overlay is gone from the DOM at the end, the
  hero state at the end equals the fresh-load hero state key by key, `booting` is gone, scroll is 0, and a real
  click on the stage pulses the core.

## Phases

1. **Scaffold and cut.** Director, script v1 with the table above, `?intro` modes in both labs, INTRO presets,
   `HERO.take()`, the harness skip, the debug HUD. Ships with rough timings. Goal: the whole sequence runs end
   to end and every seam is visible so you can judge it.
2. **Tune the seams.** The dot-to-hole alignment, the flash, the green-to-orange tween in pre-inverted space,
   the vent timings, and the cut to about 18s. Each is a preset value or a beat length. Versions live side by
   side in the script file and switch by URL.
3. **Measure.** `intro-capture.py` for reviewable cuts. `bench.py --page` style runs on the two iframe legs at
   phone and 4K sizes. Decide the phone policy from the numbers.
4. **In-page CRT, only if needed.** `crt-scene.js` verified by `CRTPROBE.hash()`.

## Risks

- **Cold compile on integrated GPUs.** Mitigated by gates and by starting every compile at t=0. The CRT's
  boot beat hides its own compile behind black, which is what the lab does today.
- **Two clocks.** The CRT's triggers stamp `performance.now()` from the iframe's own time origin. Phase 1 lets
  each leg run its own loop and only triggers it, so no clock crosses the frame boundary. Scrubbing inside a
  beat is a phase 4 feature that needs the in-page CRT.
- **Focus.** Enter must work whether or not the iframe has focus. The iframes are `pointer-events: none` and the
  director listens on the parent window. Tap and click count as Enter.
- **4K on the iGPU.** The INTRO presets cap `renderScale`, and the iframes are capped at 1600 CSS px and scaled.
- **First paint.** The intro delays the largest contentful paint. The hero text is in the DOM under the overlay,
  so crawlers see the page. Lighthouse will score it lower on a first visit. Accepted for the hook.
