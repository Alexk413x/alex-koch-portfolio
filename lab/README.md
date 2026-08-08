# Lab kit

Shared infrastructure for the lab screens. The point of this folder is that **calculation, value plumbing, chrome
and rendering live in separate files** — a lab is then just its own subject plus a control table.

```
lab/
  Sidebar.dc.html    the control panel. Generic: it knows nothing about any value's meaning
  controls.js        value plumbing — the control table, units, clamping, persistence
  lab.css            shared visual defaults (tokens, stage, header, readout, guides)
  Lab Shell.dc.html  reference lab: every control type the sidebar offers, wired correctly
  support.js         the DC runtime, so Lab Shell opens standalone
```

Labs live at the project root and reference this folder — **CRT Lab, Reactor Lab and Wormhole Lab all use `Sidebar`**.
A lab's own maths goes in its own folder (`crt/crt-geometry.js`, `crt/crt-projection.js`) — pure functions, no DOM, no
component state.

## The contract

One rule: **the sidebar never owns a value.** It reads state and calls back.

```
META[key] = { key, label, min, max, step, keystep?, fmt?, parse? }   one entry per control
state[key] = <number>                                               the live value
onChange(key, value) => this.setState({ [key]: value })             the only way a value changes
```

`meta()` builds the table (`ctl` + an `as.*` unit); `spec()` names which keys appear in which section, in order.
Because `spec()` is rebuilt every render, a control can come and go with the state it depends on — see Lab Shell,
where CORNER disappears for shapes that have no corners.

## Wiring a new lab

```html
<helmet>
<link href="lab/lab.css" rel="stylesheet">
<script type="module">
  import * as controls from './lab/controls.js';
  window.LAB_CONTROLS = controls;
  window.dispatchEvent(new Event('lab-controls'));
</script>
</helmet>
<div class="lab-body">
  <div id="stage" class="lab-stage" style="{{ stageVars }}">…</div>
  <dc-import name="lab/Sidebar" title="MY LAB" accent="#ffb454"
    sections="{{ panelSections }}" on-change="{{ onChange }}" hint-size="308px,100%"></dc-import>
</div>
```

Copy `Lab Shell.dc.html` and replace the subject. Four things in it are not decoration:

- **The view insets itself** with `right: var(--sidebar-w, 0px)`. The sidebar publishes its own measured width, so no
  lab measures the panel. It also fires a `sidebar-width` event — it is a *fetched* child DC, so it mounts after the
  host's `componentDidMount` and after the first frame; reading the variable once gets nothing.
- **Never read layout during render.** `#stage` is `position:fixed`, so `offsetWidth` in `renderVals()` returns a
  half-resolved box and nothing re-renders to correct it. A `ResizeObserver` writes the measurement into state.
- **One style hole for the whole variable block**, on the stage only. Children read `var(--…)` from static inline
  styles, so they paint while the page streams instead of waiting for a value per property.
- **`filter: none` at rest**, never `hue-rotate(0deg)`. A filter forces a compositing layer and a containing block
  for as long as it is set.

## Persistence

`load` / `save` / `clamp` in `controls.js`, keyed per lab. **Each lab needs its own storage key** (`crtlab.v4`,
`labshell.v2`, `rl_state`, `wl_state`) — localStorage is the one thing labs genuinely share, so two labs on one key would
overwrite each other. It is the single thing you must change when copying a lab. Two traps, both paid for already:

- Save and restore from **one** `persistKeys()` list, and restore only keys on it. A code-owned value that ends up
  in an old blob otherwise overrides the declared value forever, with no control able to correct it.
- Values are **clamped into each control's current range** on the way in. Narrowing a range otherwise leaves a value
  the slider cannot represent, and the thumb pins at max while the readout still shows the old number.

## If the lab is WebGL

Reactor and Wormhole draw a full-viewport canvas *under* the sidebar and pass the panel width into the shader
(`uPanelPx`) so the field's centre lands in the free area. **Cache it from the `sidebar-width` event** — both labs used to
call `getBoundingClientRect()` on the panel inside the draw loop, forcing a layout read every frame for a number that
only changes on resize:

```js
this._panelPx = 0;
this._onSidebar = (e) => { this._panelPx = (e && e.detail)
  || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 0; };
window.addEventListener('sidebar-width', this._onSidebar);
this._onSidebar();   // the CSS-var fallback, for the frames before the sidebar mounts
```
