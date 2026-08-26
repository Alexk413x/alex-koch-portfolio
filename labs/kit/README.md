# The lab kit

Everything a lab page needs that is not about the lab. The point of this folder is that **the panel, the shader
host, the page scaffolding and the units live in separate files** — a lab is then its own subject plus a control
table.

```
labs/kit/
  panel.js     the control panel: rows, sections, action strips, the hide toggle
  panel.css    what the panel looks like — themed through custom properties
  lab.css      the page shell: the stage, the canvas, the masthead, the readout
  lab.js       persistence, canvas fitting, the frame loop, textOut
  glquad.js    one full-screen fragment shader, hosted
  units.js     how a number reads — `as.pct()`, `as.rad()`, `as.off(...)`
```

**Start from [`../shell/Shell.html`](../shell/Shell.html).** It is the base lab: a live catalog of every control
type and every formatter, annotated with why each one is the kind it is. Copy it, replace the subject, and delete
what you do not need.

## The contract

One rule: **the panel never owns a value.** It reads state and calls back.

```js
SECTIONS = [['NAME', [['key', 'LABEL', lo, hi, step]], 'masterKey?']]
state[key] = <number>                              the live value
onChange(key, kind)                                after panel.js has already written it
```

A row's **kind is its shape**, so a section never says which widget it wants:

| spec | widget |
|---|---|
| `['k','LABEL',0,10,0.5]` | slider, with steppers |
| `['k','LABEL',0,1,1]` | toggle — one bit is not a range |
| `['k','LABEL',['A','B']]` | one-of-N — exactly one lit |
| `['k','LABEL','#']` | color swatch |

A third element on a section is its **master key**: a switch that turns the section's *effect* off. That is not the
same as folding, which only hides the rows — both can apply at once, and conflating them would mean you could not
tidy the panel without changing the picture.

## Wiring a lab

Seven steps, in this order, and the kit is six of them. `Shell.html` is this with comments.

```js
const R = createQuad(canvas, { frag: FRAG, uniforms: UNIFORMS, onRestore: () => fit(true) });
if (!R) { reportNoGL(); throw new Error('WebGL unavailable'); }

const state = defaultPreset(R.gpu);
const store = persist({ key: 'mylab', version: 1, state, sections: SECTIONS, extra: ['ink'] });
store.restore();

createPanel({ host, state, sections: SECTIONS, fmt: FMT, onChange });
const fit = fitCanvas({ stage, R, scale: () => state.renderScale, onFit: (w, h) => ... });
fit(true);
mountPanelToggle({ panel, onToggle: () => fit(true) });

const loop = runLoop({ draw, onTick: (fps) => textOut(fpsEl, fps + ' FPS') });
```

Five things in there are not decoration:

- **Size the canvas from the STAGE, never from `innerWidth`.** The panel is a flex sibling, so hiding it grows the
  stage without the window changing at all — a window-sized buffer stretches until something else resizes it. It is
  also what lets a shader drop the old panel-width offset: the free area is a real box, not a number to subtract.
- **`mountPanelToggle`'s small-screen test is `breakpoint` (820 wide) OR `shortSide` (500 tall), and the second is
  not optional.** A phone on its side is 852x393 — wider than any phone breakpoint — so a width test alone put the
  panel back in the flex flow and gave 340 of those 852px to controls on a screen 393px tall. The same pair is in
  `panel.css` and `lab.css` as `(max-width: 820px), (max-height: 500px)`; a stylesheet cannot be read from here, so
  the numbers must move together or the panel overlays the stage while the script believes it is in the flow.
- **`extra` names the keys `persist` cannot see.** It derives ranges from the panel layout, so a color row (no
  range) and a section master (not a row) are invisible to it.
- **Rebuild the panel when something outside it writes state.** Rows read state once and own their DOM afterwards —
  that is why a drag costs nothing measurable, and the price is that a preset leaves every row stale.
- **`glquad` creates a WebGL2 context and has no WebGL1 fallback.** So `fwidth`, `textureLod`, `texelFetch`,
  `round()` and NPOT textures are all core and need nothing declared. The old two-part dance — an
  `ext: ['OES_standard_derivatives']` entry on the host *and* a `#extension` directive as the shader's first
  line — is gone; it was two halves that had to agree across two files, and when they did not the page simply
  never started. `ext` still exists for what really are extensions here, `EXT_color_buffer_float` chiefly.

## Persistence

**Each lab needs its own storage key** — `crtgl`, `reactor`, `tunnel`, `labshell`. `crtgl` no longer matches
the name of the lab that uses it, and that is deliberate: a key is an address, and moving one silently orphans
every configuration stored under it. localStorage is the one thing
labs genuinely share, so two on one key overwrite each other. It is the single thing you must change when copying.

`persist()` handles the four traps, all paid for already:

- **Restore only declared keys.** A whole-blob merge lets a value the code owns be frozen by an old save forever,
  with no control able to correct it.
- **Clamp into the control's current range.** Narrowing a range otherwise leaves a number the slider cannot show:
  the thumb pins at one end while the readout still reads the old value.
- **Carry a version and check it.** Reactor's `ringHidden` became `ringOn`, *inverted* — an old blob restored into
  the new state switches the ring off while lighting the button that claims it is on.
- **Debounce the write.** Saving from a change handler is one `JSON.stringify` and one synchronous write per input
  event, which during a drag is sixty a second for a value nobody has finished choosing.

## Units

`units.js` exists because a control table is mostly formatters, and hand-writing them is where units drift. Before
it, Reactor rendered percentages as `40 %` in most rows and `62%` in one, while Wormhole used `40%` throughout —
three spellings of a percent sign across two files.

`as.off(as.px())` names the bottom of a range (`OFF` rather than `0px`) and `as.ends(inner, 'SQUARE', 'ROUND', 1)`
names both. Those are labels on a value, not separate controls — a toggle beside a slider is two widgets for one
decision, and they can disagree.

## Two panel kits used to live here

There was a second, DC-component panel (`Sidebar.dc.html` + `controls.js`) for the `.dc.html` pages. Those pages
are gone and so is it. `panel.css`'s header records the history: this markup once existed **three** times.
