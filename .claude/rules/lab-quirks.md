---
paths:
  - "labs/**"
---

# Known, deliberate, not bugs

- **SQUIRCLE shapes the guide outline and the clip, not the picture's warp.** Known gap; wiring it to the frame
  toggle is the fix if you want it.
- **GLARE reaches the fixture only.** The stored default is `0`, so a reading of 0 is correct, not broken.
- **The rim is unpinned** — the picture sits inside the glass and that gap is real.
- **The corners are cut, not warped.** Settled; the picture ends on the squircle by clip.
- **Reactor's ring pattern does not travel with a scattered fragment.** The nine pieces are displaced and tumbled
  inside `ringSDF`, but the shading reads `ringSpace(hp)` — the unscattered frame — so a flown-off piece's
  machined surface swims across it rather than riding on it. Fixing it means returning the per-piece transform
  out of the SDF. The pieces are small on screen for most of a break, which is why it has not been worth that.
- **The tunnel's grain rings are gone but the speckle is not.** The concentric banding was `graze`, differenced
  over a bracket the refinement had already collapsed, and it is fixed. The remaining stipple along the nebula's
  edges is the noise field genuinely outrunning the sample rate where the wall goes edge-on — a filtering
  problem, not a bug.
- **`fieldFolds`'s 2x threshold no longer bounds anything physical** but it still sets how deep FACE bends, and
  every stored setting is calibrated against it. Change it knowingly or not at all.

# Not yet done

- **Reactor's `renderNow` is not reproducible**, because `sim.step` carries phase forward — so that lab has no
  render fingerprint of the kind `render-probe.js` gives CRT Lab. Resetting the sim would be the way in.
- **Mobile is a fold-away panel, not a layout.** Below 820px wide *or 500px tall* each lab hides its panel behind
  a chevron and CRT Lab applies a small-display override table; the control density is still built for a large
  window. **Both halves of that test are load-bearing** — a phone on its side is 852x393, wide enough to pass any
  width test — and the pair lives in three places that must move together: `NARROW_W`/`SHORT_H` in CRT Lab, the
  `breakpoint`/`shortSide` defaults in `labs/kit/panel.js`, and the `(max-width), (max-height)` queries in
  `panel.css` and `lab.css`. A stylesheet cannot be read from the script; if they disagree the panel overlays the
  stage while the script still believes it is in the flow.
