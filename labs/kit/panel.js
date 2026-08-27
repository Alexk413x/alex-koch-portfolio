/* Control panel widgets shared by every lab: rows, sections, key nav, the hide toggle. Plain DOM, no
 * framework -- takes a host element, returns elements. Panel.css owns appearance only.
 * A row reads state once and owns its DOM after that, so a value changed from outside the panel leaves its
 * row stale until the caller rebuilds it. This file knows nothing about any lab: state, a formatter table
 * and one onChange(key, kind) callback are its whole contact with the page. */

/* A row's kind follows its spec's shape:
 *   ['k','LABEL','#'] color | [['k1','k2'],'LABEL','#'] color pair | ['k','LABEL',['A','B']] choice
 *   ['k','LABEL',0,1,1] toggle | ['k','LABEL',lo,hi,step] slider
 * A trailing options object may add { when: ['otherKey',[vals]] } (show only for those values) or
 * { wide: true } (full width, no label). */
export function rowKind(spec) {
  const [k, , lo, hi, st] = spec;
  if (lo === '#') return Array.isArray(k) ? 'colorPair' : 'color';
  if (Array.isArray(lo)) return 'choice';
  if (lo === 0 && hi === 1 && st === 1) return 'toggle';
  return 'slider';
}

// A row's trailing options object, or null. Checks only the last element, so a choice row's name array is
// never mistaken for one.
function rowOpts(spec) {
  const last = spec[spec.length - 1];
  return (last && typeof last === 'object' && !Array.isArray(last)) ? last : null;
}

// A row that only applies sometimes should only be shown sometimes, not grayed out: the wormhole's HUE row
// once did nothing in two of three color modes with no visual sign of it, so `when` hides the row entirely.
function rowWhen(spec) {
  const o = rowOpts(spec);
  return o && o.when ? o.when : null;
}

// A full-bleed color swatch, marked by '#' where a slider's range would be since a hex string has no min/max/step.
function rowColor(ctx, k, label) {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = '<label>' + label + '</label>';
  const sw = document.createElement('input');
  sw.type = 'color'; sw.className = 'csw'; sw.value = ctx.state[k];
  sw.addEventListener('input', () => { ctx.state[k] = sw.value; ctx.onChange(k, 'color'); });
  row.appendChild(sw);
  return row;
}

// Two colors describing one decision (a gradient's two ends) share a row and a label instead of costing
// double the panel height. The key being an array is what tells rowKind this is a pair.
function rowColorPair(ctx, keys, label) {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = '<label>' + label + '</label>';
  const wrap = document.createElement('div'); wrap.className = 'cpair';
  keys.forEach((k) => {
    const sw = document.createElement('input');
    sw.type = 'color'; sw.className = 'csw'; sw.value = ctx.state[k];
    sw.addEventListener('input', () => { ctx.state[k] = sw.value; ctx.onChange(k, 'color'); });
    wrap.appendChild(sw);
  });
  row.appendChild(wrap);
  return row;
}

// A boolean as a button: 0..1 step 1 is one bit, not a range worth a slider and a numeric readout.
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

// A number: slider, a stepper pair, and a typeable readout in the unit it displays (see units.js for the
// inverse). The readout is an <input>, not a <label>, so it actually is the editable thing it looks like.
function rowSlider(ctx, k, label, lo, hi, st) {
  const row = document.createElement('div'); row.className = 'row';
  // tabindex -1 on the steppers/readout: the range input is the row's one tab stop, so three stops per row
  // across seventy rows doesn't make the panel unusable from the keyboard.
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

  // Typed values are clamped to the row's range and snapped to its step, so the field can't express a value
  // the slider couldn't; an unparseable entry reverts instead of zeroing.
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

// A row of buttons of which exactly one is lit: not toggles, which don't enforce exclusivity, and not a
// slider, which would give an unordered set a numeric position.
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

// Dispatches a spec to its row builder, then tags the element with the metadata the builders don't set:
// the state key, and any `when`/`wide` options.
export function buildRow(ctx, spec) {
  const [k, label, lo, hi, st] = spec;
  let row;
  switch (rowKind(spec)) {
    case 'color': row = rowColor(ctx, k, label); break;
    case 'colorPair': row = rowColorPair(ctx, k, label); break;
    case 'choice': row = rowChoice(ctx, k, label, lo); break;
    case 'toggle': row = rowToggle(ctx, k, label); break;
    default:       row = rowSlider(ctx, k, label, lo, hi, st);
  }
  // Not the label: SPEED, SPIN and BRIGHTNESS each occur in several sections, so a label-based lookup
  // would pick whichever came first.
  row.dataset.k = Array.isArray(k) ? k[0] : k;
  const opts = rowOpts(spec);
  if (opts && opts.wide) row.classList.add('wide');
  const when = rowWhen(spec);
  if (when && ctx.conditional) ctx.conditional.push({ row, key: when[0], values: when[1] });
  return row;
}

// A section header that folds, and optionally a master that switches its effect off -- different things: a
// master kills the effect, folding only hides its rows. Both can apply, so rows show only when open AND
// enabled, and the master button stops its click from also folding the section.
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

// Up/Down move focus between rows (a range input claims all four arrows for its own value otherwise, and
// Left/Right still change it); PageUp/PageDown jump a section, Home/End the ends of the panel.
export function attachKeyNav(host) {
  host.addEventListener('keydown', (e) => {
    // offsetParent is null inside a display:none row or a folded section, so Up/Down walks only what's on screen.
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
    else return;                       // Left/Right and everything else keep their normal behavior
    e.preventDefault();
    const el = all[to];
    el.focus();
    el.closest('.row').scrollIntoView({ block: 'nearest' });
  });
}

// A strip of action buttons. `lit` is a predicate, not a flag -- asking the page rather than remembering a
// state is what stops a restored session showing POWER lit over a dark tube. Returns sync() since a
// predicate (e.g. which preset matches the current values) can go false without its button being pressed.
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

// Hides the panel because 340px of controls is a sidebar on desktop and most of the screen on a phone;
// panel.css owns the look, this owns the state and button. Reports via onToggle rather than acting, firing
// after the class lands so a caller resizing its stage sees settled layout. Open/hidden is per-size and not
// persisted. `shortSide` catches a phone in landscape (852x393 passes any width-only test); it and
// `breakpoint` must move together with the `(max-width), (max-height)` query in panel.css.
export function mountPanelToggle({ panel, host = document.body, breakpoint = 820, shortSide = 500,
                                   onToggle = () => {} } = {}) {
  const b = document.createElement('button');
  b.id = 'paneltgl';
  b.type = 'button';
  if (panel && panel.id) b.setAttribute('aria-controls', panel.id);

  const apply = (hidden, notify) => {
    document.body.classList.toggle('panel-hidden', hidden);
    // The glyph shows the direction the panel moves, not a word, so aria-label states the action and
    // aria-expanded the state -- otherwise a screen reader announces only "greater-than".
    b.textContent = hidden ? '‹' : '›';
    b.setAttribute('aria-expanded', String(!hidden));
    b.setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls');
    b.title = hidden ? 'Show controls' : 'Hide controls';
    // AFTER the class, so a caller measuring the stage measures the layout it is about to render into.
    if (notify) onToggle(hidden);
  };

  // Painted, not animated -- see .panel-boot in panel.css. Two rAFs, not one: the first commits the style,
  // and only from the second does a later change read as a transition from something already on screen.
  document.body.classList.add('panel-boot');
  apply(window.matchMedia(`(max-width: ${breakpoint}px), (max-height: ${shortSide}px)`).matches, false);
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('panel-boot')));

  b.addEventListener('click', () => apply(!document.body.classList.contains('panel-hidden'), true));
  host.appendChild(b);

  return { el: b, toggle: () => b.click(),
           set: (hidden) => apply(!!hidden, true),
           get hidden() { return document.body.classList.contains('panel-hidden'); } };
}

// Builds the whole panel from a sections table -- the entry point most callers need. `folds` is a function,
// not an object: a lab's persistence merge typically replaces state wholesale (`state[k] = stored[k]`), which
// would orphan a fold map reference captured once at build time. Resolving per use keeps folds landing in
// storage. Pass a getter for anything but the default `state.secClosed`.
export function createPanel({ host, state, sections, fmt = {}, folds, onChange = () => {} }) {
  const foldMap = typeof folds === 'function' ? folds : () => (state.secClosed ||= {});
  const conditional = [];
  const syncRows = () => conditional.forEach(({ row, key, values }) => {
    row.style.display = values.indexOf(state[key]) >= 0 ? '' : 'none';
  });
  // Re-evaluates `when` rows itself, so a lab never has to know which control governs another's visibility.
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
