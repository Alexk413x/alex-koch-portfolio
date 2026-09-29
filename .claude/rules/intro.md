---
paths:
  - "site/intro/**"
  - "test/suite_intro.py"
---

# The intro

`site/intro/` plays a once-per-session sequence over the home page: the CRT terminal, Enter, warp and surge,
power-off with the wormhole already opening under it (`open`: a small ring comes to the viewer, the tube forms
and backs off), a cruise with the bend's direction wandering, a `run` that straightens and brings the hole up
close, a crossfade onto the reactor on the hero's own canvas with its ring in frame, then the lab's three
presets in turn, STABLE, CRITICAL, MELTDOWN, tweened key by key with the camera pulling out, the vent, the
break, and a cool-down to the hero's orange at STABLE motion. The last frame is the hero's idle frame; the
director never draws.

- **The CRT and the wormhole run in same-origin iframes of their own lab pages with `?intro`**, which strips the
  chrome, skips the stored settings (no `persist()` at all, or its pagehide flush would overwrite the visitor's
  own), and applies each lab's `introPreset`. The wormhole's carries the values Alex dialed in the lab, baked,
  so the intro is the same in every browser; re-bake when the lab changes. `&panel` keeps the lab's panel for
  tuning live. The reactor leg is `window.HERO` driven through `take()` / `release()`; while taken, `draw()`
  writes none of its own state.
- **The head script decides before first paint** (`AK_INTRO`, `html.intro-live`) so the sheet is true for the
  first frame. `?intro` forces, `?nointro`, any hash, reduced motion or `sessionStorage['intro-seen']` skip.
  If `intro.js` never runs, the head script drops the sheet after 6s.
- **Beats are data in `intro-script.js`**; every length is a number there. Heavy legs end on readiness gates,
  not timers: the reactor's full program is a 12s link on the UHD 630, so the settle beat holds for it.
  `?intro&hud` shows the beat, gates and frame rate; `?intro&from=worm|hero` starts part-way in.
- **The harness marks the intro seen before every navigation** (`Page.addScriptToEvaluateOnNewDocument`), so
  the other suites see the page a returning visitor sees. `suite_intro` forces it and unmarks it deliberately.
- Two traps, both fixed in place and commented: a rule on `#intro` loses to `html.intro-live #intro` on
  specificity, so the sheet never went clear for the reactor leg; and the CRT typed at most one character per
  frame, so a frame rate halved by a shader link beside it halved the typing.
