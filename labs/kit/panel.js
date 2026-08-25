/* panel.js — THE CONTROL PANEL'S WIDGETS, FOR EVERY LAB.
 *
 * ONE COPY, for the reason panel.css gives: a slider existed three times in this repo and three implementations
 * drift. This file decides STRUCTURE and BEHAVIOUR, panel.css decides appearance, and neither should start doing
 * the other's job. Plain DOM, no framework: everything here takes a host element and returns elements.
 *
 * A ROW READS STATE ONCE and owns its DOM afterwards, so a drag writes one number and one text node. The price is
 * that a value changed from OUTSIDE the panel leaves its row stale — a caller that writes state itself must
 * rebuild the panel.
 *
 * IT KNOWS NOTHING ABOUT ANY LAB. It is handed a state object, a table of formatters and one callback, and has no
 * other way to reach the page. Anything a lab needs to do on a change arrives as (key, kind) on onChange.
 *
 * WHAT IS DELIBERATELY NOT HERE: anything a single lab needs. A kit that grows a special case per caller is three
 * implementations again wearing one filename.
 */

/* A ROW'S KIND IS ITS SPEC'S SHAPE, so a section never has to say which control it wants.
 *   ['k','LABEL','#']            colour swatch
 *   ['k','LABEL',['A','B']]      one-of-N
 *   ['k','LABEL',0,1,1]          toggle
 *   ['k','LABEL',lo,hi,step]     slider
 *
 * Any of them may carry a trailing options object:
 *   { when: ['otherKey', [1, 2]] }   show the row only while that key holds one of those values
 *   { wide: true }                   drop the label and give the control the panel's full width, twice as tall
 */
export function rowKind(spec) {
  const [, , lo, hi, st] = spec;
  if (lo === '#') return 'colour';
  if (Array.isArray(lo)) return 'choice';
  if (lo === 0 && hi === 1 && st === 1) return 'toggle';
  return 'slider';
}

/* A row's trailing options object, or null. Only the LAST element is examined, so a choice row's array of names is
 * never mistaken for one. */
function rowOpts(spec) {
  const last = spec[spec.length - 1];
  return (last && typeof last === 'object' && !Array.isArray(last)) ? last : null;
}

/* A ROW THAT ONLY APPLIES SOMETIMES SHOULD ONLY BE THERE SOMETIMES.
 *
 * A control that does nothing is worse than one that is absent: the wormhole's HUE row moved and changed
 * nothing in two of its three colour modes, while the two swatches did nothing in the third, and the panel gave
 * no sign which pair was live. Disabling rather than hiding was considered and dropped — a greyed row still
 * occupies the place the eye searches, and the panel is already dense.
 */
function rowWhen(spec) {
  const o = rowOpts(spec);
  return o && o.when ? o.when : null;
}

// A COLOUR: a full-bleed swatch. There is no meaningful min, max or step for one, and a hex string in a numeric
// readout is not a control -- so it is marked by '#' where the range would be.
function rowColour(ctx, k, label) {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = '<label>' + label + '</label>';
  const sw = document.createElement('input');
  sw.type = 'color'; sw.className = 'csw'; sw.value = ctx.state[k];
  sw.addEventListener('input', () => { ctx.state[k] = sw.value; ctx.onChange(k, 'colour'); });
  row.appendChild(sw);
  return row;
}

// A BOOLEAN: a button. 0..1 step 1 is one bit, not a range worth a slider, a stepper pair and a numeric readout.
function rowToggle(ctx, k, label) {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = '<label>' + label + '</label><button class="tgl"></button>';
  const b = row.querySelector('.tgl');
  const sync = () => {
    b.textContent = ctx.state[k] ? 'ON' : 'OFF';
    b.classList.toggle('on', !!ctx.state[k]);
  };
  b.addEventListener('click', () => { ctx.state[k] = ctx.state[k] ? 0 : 1; sync(); ctx.onChange(k, 'toggle'); });
  sync();
  return row;
}

/* A NUMBER: slider, a stepper either side of the readout, and real units.
 *
 * The steppers repeat on hold, because a fine step over a wide range is hundreds of clicks otherwise, and they are
 * tabindex -1: the slider is the focusable thing in a row, and three tab stops per row across seventy rows would
 * make the panel unusable from the keyboard.
 *
 * THE READOUT IS AN INPUT, NOT A LABEL, and it is typeable in the unit it displays — see units.js for the inverse.
 * A span selects like text and so reads as editable while doing nothing, and an affordance that lies is worse than
 * one that is absent. tabindex -1 for the reason above: reachable by click, not another stop between every slider.
 */
function rowSlider(ctx, k, label, lo, hi, st) {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = '<label>' + label + '</label><input type="range" min="' + lo + '" max="' + hi +
                  '" step="' + st + '" value="' + ctx.state[k] + '">' +
                  '<button class="stp" tabindex="-1" data-d="-1">‹</button>' +
                  '<input class="val" type="text" tabindex="-1" spellcheck="false" autocomplete="off">' +
                  '<button class="stp" tabindex="-1" data-d="1">›</button>';
  const inp = row.querySelector('input[type=range]'), val = row.querySelector('.val');
  row.addEventListener('click', () => inp.focus());
  const text = () => (ctx.fmt[k] ? ctx.fmt[k](ctx.state[k])
                                 : (hi > 40 ? Math.round(ctx.state[k]) : (+ctx.state[k]).toFixed(2)));
  // Never overwrite what is being typed: a drag on another row still reformats this one.
  const show = () => { if (document.activeElement !== val) val.value = text(); };
  const commit = () => { show(); ctx.onChange(k, 'slider'); };
  inp.addEventListener('input', () => { ctx.state[k] = parseFloat(inp.value); commit(); });

  /* Typed values are clamped to the row's own range and snapped to its step, so the field cannot express a value
   * the slider could not — the thumb pinning at one end while the readout shows something else is precisely the
   * disagreement persist() clamps against on restore. An unparseable entry reverts rather than zeroing. */
  const parse = (ctx.fmt[k] && ctx.fmt[k].parse) || parseFloat;
  const takeTyped = () => {
    const raw = parse(val.value);
    if (isFinite(raw)) {
      const v = Math.min(hi, Math.max(lo, +(Math.round(raw / st) * st).toFixed(6)));
      if (v !== ctx.state[k]) { ctx.state[k] = v; inp.value = v; ctx.onChange(k, 'slider'); }
    }
    val.value = text();
  };
  // The row focuses the slider on click; without this, clicking the field would take the focus straight back out.
  val.addEventListener('click', (e) => e.stopPropagation());
  val.addEventListener('focus', () => val.select());
  val.addEventListener('blur', takeTyped);
  val.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); val.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); val.value = text(); val.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation();   // let the caret rules apply
  });
  row.querySelectorAll('.stp').forEach((b) => {
    const bump = () => {
      const v = Math.min(hi, Math.max(lo, +(ctx.state[k] + parseFloat(b.dataset.d) * st).toFixed(6)));
      if (v === ctx.state[k]) return;
      ctx.state[k] = v; inp.value = v; commit();
    };
    let hold = 0, rep = 0;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault(); inp.focus(); bump();
      hold = setTimeout(() => { rep = setInterval(bump, 55); }, 380);
    });
    ['mouseup', 'mouseleave', 'blur'].forEach((ev) =>
      b.addEventListener(ev, () => { clearTimeout(hold); clearInterval(rep); }));
  });
  show();
  return row;
}

/* ONE OF N: a row of buttons of which exactly one is ever lit, holding a small integer.
 *
 * A three-way is not three toggles and it is not a 0..2 slider. As toggles nothing enforces the exclusivity and
 * two can read as lit at once; as a slider "CENTER" is a numeric position between two others, which is a lie
 * about a set that has no order.
 */
function rowChoice(ctx, k, label, names) {
  const row = document.createElement('div'); row.className = 'row choice';
  row.innerHTML = '<label>' + label + '</label>';
  const bs = names.map((nm, i) => {
    const b = document.createElement('button'); b.className = 'tgl'; b.textContent = nm;
    b.addEventListener('click', () => { ctx.state[k] = i; sync(); ctx.onChange(k, 'choice'); });
    row.appendChild(b); return b;
  });
  const sync = () => bs.forEach((b, i) => b.classList.toggle('on', ctx.state[k] === i));
  sync();
  return row;
}

export function buildRow(ctx, spec) {
  const [k, label, lo, hi, st] = spec;
  let row;
  switch (rowKind(spec)) {
    case 'colour': row = rowColour(ctx, k, label); break;
    case 'choice': row = rowChoice(ctx, k, label, lo); break;
    case 'toggle': row = rowToggle(ctx, k, label); break;
    default:       row = rowSlider(ctx, k, label, lo, hi, st);
  }
  // The state key on the element, because a LABEL DOES NOT IDENTIFY A ROW: SPEED, SPIN and BRIGHTNESS each occur
  // in several sections, and anything reaching in by label picks whichever came first.
  row.dataset.k = k;
  const opts = rowOpts(spec);
  if (opts && opts.wide) row.classList.add('wide');
  const when = rowWhen(spec);
  if (when && ctx.conditional) ctx.conditional.push({ row, key: when[0], values: when[1] });
  return row;
}

/* A SECTION: a header that folds, and optionally a master that switches its effect off.
 *
 * THOSE ARE DIFFERENT THINGS. A master kills the effect -- no moulding, no instruments, guns converged. Folding
 * just hides the rows while everything carries on exactly as it was. Conflating them would mean you could not
 * tidy the panel without changing the picture. Both can apply, so rows show only when open AND enabled, and the
 * master's button stops its click propagating or pressing it would fold the section as a side effect.
 */
export function buildSection(ctx, name, rowSpecs, masterKey) {
  const head = document.createElement('div'); head.className = 'sec';
  const caret = document.createElement('span'); caret.className = 'caret';
  const title = document.createElement('span'); title.className = 'sectitle'; title.textContent = name;
  head.appendChild(caret); head.appendChild(title);
  const group = document.createElement('div');

  let master = null;
  const sync = () => {
    const open = !ctx.foldMap()[name];
    caret.textContent = open ? '▾' : '▸';
    group.style.display = (open && (!masterKey || ctx.state[masterKey])) ? '' : 'none';
    if (master) {
      master.textContent = ctx.state[masterKey] ? '● ON' : '○ OFF';
      master.classList.toggle('on', !!ctx.state[masterKey]);
    }
  };
  head.addEventListener('click', () => {
    const f = ctx.foldMap(); f[name] = !f[name];
    sync(); ctx.onChange(name, 'fold');
  });
  if (masterKey) {
    master = document.createElement('button'); master.className = 'mtgl';
    master.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.state[masterKey] = ctx.state[masterKey] ? 0 : 1; sync(); ctx.onChange(masterKey, 'master');
    });
    head.appendChild(master); head.classList.add('has-tgl');
  }
  rowSpecs.forEach((spec) => group.appendChild(buildRow(ctx, spec)));
  queueMicrotask(sync);
  return [head, group];
}

/* UP/DOWN WALK THE LIST, LEFT/RIGHT CHANGE THE VALUE. A range input binds all four arrows to its own value, so out
 * of the box Up/Down cannot move between rows and the panel is unnavigable from the keyboard beyond Tab. Since the
 * two pairs are redundant on a slider, taking the vertical one for navigation costs nothing.
 *
 * PageUp/PageDown jump a whole section, Home/End go to the ends of the panel, and the focused row is scrolled into
 * view — a focus ring you have to hunt for is not much better than none.
 */
export function attachKeyNav(host) {
  host.addEventListener('keydown', (e) => {
    // offsetParent is null for anything inside a display:none row or a folded section, so Up/Down walks what is
    // actually on screen rather than stopping on a control nobody can see.
    const all = [...host.querySelectorAll('input[type=range]')].filter((el) => el.offsetParent !== null);
    const i = all.indexOf(e.target);
    if (i < 0) return;
    let to = -1;
    if (e.key === 'ArrowDown')      to = Math.min(all.length - 1, i + 1);
    else if (e.key === 'ArrowUp')   to = Math.max(0, i - 1);
    else if (e.key === 'PageDown')  to = Math.min(all.length - 1, i + 6);
    else if (e.key === 'PageUp')    to = Math.max(0, i - 6);
    else if (e.key === 'Home')      to = 0;
    else if (e.key === 'End')       to = all.length - 1;
    else return;                       // Left/Right and everything else keep their normal behaviour
    e.preventDefault();
    const el = all[to];
    el.focus();
    el.closest('.row').scrollIntoView({ block: 'nearest' });
  });
}

/* A STRIP OF ACTION BUTTONS. `lit` is a PREDICATE, not a flag, and an action without one is not a state and
 * never lights -- asking the page rather than remembering is what stops a restored session showing POWER lit
 * over a dark tube.
 *
 * Returns its own sync(), because a predicate can go false without anyone pressing the button that owns it: which
 * preset is lit is derived from the values, so moving any slider can extinguish one. Callers with no such
 * coupling can ignore the return.
 */
export function buildActions(host, actions, after) {
  const lamps = [];
  actions.forEach(([label, fn, lit]) => {
    const b = document.createElement('button'); b.textContent = label;
    if (lit) lamps.push([b, lit]);
    b.onclick = () => { fn(); sync(); if (after) after(); };
    host.appendChild(b);
  });
  const sync = () => lamps.forEach(([b, lit]) => b.classList.toggle('on', !!lit()));
  sync();
  return sync;
}

/* THE SWITCH THAT HIDES THE PANEL, because 340px of controls is a sidebar on a desktop and most of the screen on a
 * phone. panel.css owns what hiding LOOKS like at each width; this owns only the state and the button.
 *
 * IT REPORTS THE CHANGE RATHER THAN ACTING ON IT, for the reason the file header gives. Hiding the panel on a wide
 * screen grows the stage, and a renderer sized to the old box will stretch until something else resizes it — so
 * `onToggle(hidden)` fires AFTER the class lands, with layout already settled. On a narrow screen the panel is out
 * of the flow and nothing moves, so the same callback is harmless there.
 *
 * THE DEFAULT IS PER-SIZE AND NOT REMEMBERED: a stored "hidden" restored onto a desktop is a lab that opens looking
 * broken, and the state is one button away either direction.
 *
 * `shortSide` IS THE HANDSET ON ITS SIDE. A width test alone calls a phone in landscape a desktop — 852x393 is
 * wider than any phone breakpoint — so the panel comes back into the flex flow and takes 340 of those 852 px. The
 * numbers pair with the `(max-width), (max-height)` query in panel.css and must move together with it.
 */
export function mountPanelToggle({ panel, host = document.body, breakpoint = 820, shortSide = 500,
                                   onToggle = () => {} } = {}) {
  const b = document.createElement('button');
  b.id = 'paneltgl';
  b.type = 'button';
  if (panel && panel.id) b.setAttribute('aria-controls', panel.id);

  const apply = (hidden, notify) => {
    document.body.classList.toggle('panel-hidden', hidden);
    /* THE GLYPH IS THE DIRECTION THE PANEL MOVES, not a word: > sends it away, < brings it back. It carries
     * no meaning to a screen reader, so aria-label states the ACTION and aria-expanded the state -- a button
     * whose whole label is a punctuation mark is announced as "greater-than" without them. */
    b.textContent = hidden ? '‹' : '›';
    b.setAttribute('aria-expanded', String(!hidden));
    b.setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls');
    b.title = hidden ? 'Show controls' : 'Hide controls';
    // AFTER the class, so a caller measuring the stage measures the layout it is about to render into.
    if (notify) onToggle(hidden);
  };

  /* THE OPENING STATE IS PAINTED, NOT ANIMATED -- see the note on .panel-boot in panel.css. The class is
   * dropped after two frames rather than one: the first commits the style, and only from the second is a
   * later change a transition from something already on screen. */
  document.body.classList.add('panel-boot');
  apply(window.matchMedia(`(max-width: ${breakpoint}px), (max-height: ${shortSide}px)`).matches, false);
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('panel-boot')));

  b.addEventListener('click', () => apply(!document.body.classList.contains('panel-hidden'), true));
  host.appendChild(b);

  return { el: b, toggle: () => b.click(),
           set: (hidden) => apply(!!hidden, true),
           get hidden() { return document.body.classList.contains('panel-hidden'); } };
}

/* THE WHOLE PANEL, from a SECTIONS table. The only entry point most callers need.
 *
 * `folds` IS A FUNCTION, NOT AN OBJECT, and that is load-bearing rather than fussy. A lab's persistence merge
 * generally restores by whole key -- `for (const k in state) state[k] = stored[k]` -- which REPLACES the fold
 * map rather than filling it. A reference captured when the panel was built then points at an orphan: measured,
 * sections folded correctly on screen while state.secClosed stayed {} and no fold ever reached storage. The
 * code this kit replaced looked the map up on every read and so never had the problem; resolving per use keeps
 * that property, and costs one call.
 *
 * Which slice of state holds the map is still the caller's business -- pass a getter for anything but the
 * default `state.secClosed`.
 */
export function createPanel({ host, state, sections, fmt = {}, folds, onChange = () => {} }) {
  const foldMap = typeof folds === 'function' ? folds : () => (state.secClosed ||= {});
  const conditional = [];
  const syncRows = () => conditional.forEach(({ row, key, values }) => {
    row.style.display = values.indexOf(state[key]) >= 0 ? '' : 'none';
  });
  /* THE PANEL RE-EVALUATES ITS OWN `when` ROWS, so a lab never has to know which of its controls governs the
   * visibility of another. The caller's onChange still sees every change, unwrapped and in order. */
  const ctx = {
    state, fmt, foldMap, conditional, syncRows,
    onChange: (k, kind) => { syncRows(); onChange(k, kind); },
  };
  sections.forEach(([name, rowSpecs, masterKey]) => {
    buildSection(ctx, name, rowSpecs, masterKey).forEach((el) => host.appendChild(el));
  });
  syncRows();
  attachKeyNav(host);
  return ctx;
}
