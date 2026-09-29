---
paths:
  - "bench.py"
  - "labs/**"
---

# Measuring frame rate

## `python bench.py` — the whole measurement in one command

```
python bench.py                     # CRT Lab, 12 samples, verdict
python bench.py --page reactor      # any lab: crt | reactor | wormhole | shell, or a literal path
python bench.py --uncapped          # frame COST, not frame rate
python bench.py --inject "<js>"     # pin a setting first, so two runs are comparable
```

It serves the repo, launches an isolated Chrome, warms the profile's cache, drives the page over CDP and prints
the **distribution**, not a single number. It refuses a verdict when `median > 2.5 × min`, because at that point
the minimum is finding gaps between interference rather than measuring the renderer.

A run measures whatever state was restored, which on a fresh bench profile is the shipped default. **`--inject`
is how you pin one**, and it is required for any before/after comparison:

```
python bench.py --page reactor --uncapped --inject "REACTOR.state.renderScale=0.62; REACTOR.fit(true); 1"
```

The first sampling window is excluded as a warm-up: uncapped with an idle compositor it returns well under
1 ms where every later window sits at 4–6 ms, which made the tool refuse verdicts on runs whose remaining
samples agreed to within 5%.

## Chrome stops rendering occluded windows

`document.visibilityState` reads **`hidden` while `document.hasFocus()` is `true`** whenever the Chrome window is
occluded or minimized on Windows — and a hidden page gets **zero** animation frames, not slow ones. Every frame
number quoted from a tab that was not front-most measured nothing, and a CDP screenshot forces a single frame,
which moves the readout just enough to look alive.

`bench.py` launches with the flags that fix it. **`--disable-features=CalculateNativeWinOcclusion` is the one
that matters**; `--disable-backgrounding-occluded-windows` and `--disable-renderer-backgrounding` go with it.
Without them the page reports `hidden` and 0 rAF callbacks per second; with them, `visible` and about 57 frames
in the first second.

**`renderNow()` is the way round it entirely** — it draws synchronously and needs no animation frame. Each lab
pauses its loop on `visibilitychange` deliberately, so a frozen clock in a hidden tab is correct, not a fault.

## Measure on an idle machine, in one tab

Every lab tab holds a live WebGL context and its buffers whether or not it is rendering. An unchanged build
measured 36 → 53 → 70 → 88ms within a single 60s run because a dozen lab instances had accumulated across tabs.
A throwaway profile is the clean room, with one catch: its HTTP and GPU shader caches are both empty, so the
first run recompiles every shader — about 4x pessimistic cold. `bench.py` warms it; `--warm` reuses it.

Costs are reported in **ms per frame, not fps**. fps deltas are not additive and mislead near the target — a
layer costing 2ms reads as "−25 fps" at 60 and "−3 fps" at 20, for identical work.
