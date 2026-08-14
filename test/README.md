# test/

Checks for the home page, run against the real served site in a real browser.

```
python test/run.py                  everything, headless      (~20s)
python test/run.py --only rpn qr    just those suites
python test/run.py --show           a visible window, to watch a failure happen
python test/run.py --perf           also report frame cost (advisory, never fails)
```

Exit code is 0 when everything passes, so this can gate a push or a workflow.

Needs nothing but the standard library, plus **`opencv-python`** for the QR suite — without it that
suite reports SKIP rather than passing quietly, because a QR that renders is not a QR that scans and a
silent skip would be a lie about coverage.

## Why these tests look the way they do

Every one of them exists because something shipped broken and only measurement caught it. They are not
unit tests of pure functions; the interesting failures in this page were all about what the browser
actually did.

- **`suite_rpn`** — the stack machine's arithmetic against a fresh machine in the page, then the same
  through the real keypad. ENTER pushes ONE value here: this calculator has a separate IN line, so there
  is no stack lift to duplicate X, and `5 ENTER ×` is deliberately 5 rather than 25.
- **`suite_morph`** — the pin, the dead zones at both ends, and the two states the calculator has to
  rest in cleanly. A key whose start plus span exceeded 1 once sat stranded mid-flight in a state that is
  meant to be still, so the grid is asserted at both ends: 39 keys in 10x4, 28 keys in 4x7, no overlaps.
- **`suite_qr`** — decodes what the encoder draws, across the versions and a multibyte payload. An early
  encoder produced a flawless-looking symbol that read as nothing, because the fifteen format bits were
  written least-significant first. Only reading the code back catches that.
- **`suite_layout`** — nav on one row at seven widths, one shared left rail, no sideways scroll at four
  shapes, the hero fitting on a landscape phone, reduced motion collapsing both rigs, and every internal
  link resolving.

## Three things the harness does that matter

**Anti-occlusion flags.** Chrome runs *zero* animation frames in a window that is not front-most, so
without `--disable-features=CalculateNativeWinOcclusion` and friends every scroll-driven measurement
reads a page that never moved. This is the same trap `bench.py` documents.

**Cache disabled, then a hard reload.** A kept profile will serve a stale module against fresh HTML,
which looks exactly like a logic bug.

**Real mouse events, not `element.click()`.** `click()` dispatches straight at the node and ignores
hit-testing, so it passes through `pointer-events: none` and through anything a 3D transform has moved.
Half the point here is that a key is reachable *where it appears to be*.

## Measuring geometry through a 3D transform

The phone is turned about 15 degrees, and that breaks both obvious ways of measuring:

- `getBoundingClientRect` returns the axis-aligned box of the *projected* quad, so neighbouring keys
  appear to overlap when nothing is wrong.
- `offsetLeft`/`offsetTop` are the *layout* box and ignore transforms — but every key is laid out once at
  a home rectangle and moved by transform, so at the faceplate the shared keys report their app cells and
  the grid reads as a mix of both keyboards.

`suite_morph` drops the phone's rotation for the duration of the measurement and restores it. At rest the
keys' own transforms are pure translate and scale, so nothing else is disturbed.

## Frame cost is advisory

`--perf` reports the morph scrub against the hero scrub **measured in the same run**. An absolute frame
time here is a mood — it reads whatever else the machine is doing. The comparison against the page's
simplest scene is the number worth having.
