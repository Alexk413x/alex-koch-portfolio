// Pure module: no DOM. The maproom tests import it in node.

function settingLabel(id, label) {
  if (label) return label;
  const cut = id.indexOf(':');
  return cut >= 0 ? id.slice(cut + 1) : id;
}

export function settingChildren(model) {
  const out = new Map();
  const rows = model.settingStates || [];
  if (!rows.length) return out;
  const labels = new Map((model.settings || []).map(s => [s.id, s.label]));
  const baseOf = new Map(rows.filter(r => Number(r.original) === 1 && r.state)
    .map(r => [r.setting_id, r.state]));
  for (const r of rows) {
    if (Number(r.original) === 1 || !r.state) continue;
    const state = model.byRendition.get(r.state);
    const screen = state && state.screen;
    if (!screen || screen.isExternal) continue;
    let base = model.byRendition.get(baseOf.get(r.setting_id)) || null;
    if (!base || base.screen !== screen) base = screen.renditions.find(x => x.isCore) || null;
    if (base === state) continue;
    if (!out.has(screen.id)) out.set(screen.id, []);
    out.get(screen.id).push({
      setting: r.setting_id,
      label: settingLabel(r.setting_id, labels.get(r.setting_id)),
      value: r.value,
      kind: r.kind,
      state,
      base,
    });
  }
  for (const kids of out.values()) {
    kids.sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  }
  return out;
}

const CONTROL = /^[^[(:]*(?:\[[^\]]*\])*(?:\(late\))?:([\s\S]+)$/;

export function controlOf(action) {
  const m = CONTROL.exec(action || '');
  return m ? m[1] : '';
}

function stateTag(r) {
  const cut = r.id.indexOf('@');
  return cut >= 0 ? r.id.slice(cut + 1) : r.id;
}

const KINDS = new Set(['dialog', 'snackbar', 'toast', 'alert', 'popup', 'foreign', 'keyboard',
  'reveal', 'setting', 'mode']);
const POPUPS = new Set(['menu', 'sheet']);

export function displayKind(row, state, host) {
  if (row && row.kind && KINDS.has(row.kind)) return row.kind;
  const screen = state && state.screen;
  if (screen && host && screen !== host) {
    const cut = screen.id.lastIndexOf('.');
    for (const k of [screen.kind, cut > 0 ? screen.id.slice(cut + 1) : '']) {
      if (KINDS.has(k)) return k;
      if (POPUPS.has(k)) return 'popup';
    }
  }
  return 'reveal';
}

function displayRows(model) {
  return new Map((model.displays || []).map(r => [r.state, r]));
}

/* Each screen's display children, drawn in the row its stacked card expands into: its setting
   value states (`settingChildren`) unless flagged hidden, and each state flagged shown under a
   parent state of the screen, an overlay's state under its host's. A keyboard is never one.
   Each child's `role` is its display kind. */
export function displayChildren(model) {
  const rows = displayRows(model);
  const out = new Map();
  const taken = new Set();
  const push = (screenId, kid) => {
    if (!out.has(screenId)) out.set(screenId, []);
    out.get(screenId).push(kid);
    taken.add(kid.state.id);
  };
  for (const [screenId, kids] of settingChildren(model)) {
    for (const kid of kids) {
      const row = rows.get(kid.state.id);
      if (row && row.display === 'hidden') continue;
      push(screenId, { ...kid, name: `${kid.label} = ${kid.value}`, parent: kid.base,
        role: row && row.kind && row.kind !== 'setting' ? displayKind(row, kid.state, null) : 'setting' });
    }
  }
  for (const row of rows.values()) {
    if (row.display !== 'shown' || !row.parent || taken.has(row.state)) continue;
    const state = model.byRendition.get(row.state);
    const parent = model.byRendition.get(row.parent);
    if (!state || !parent || state === parent || !parent.screen || parent.screen.isExternal) continue;
    const role = displayKind(row, state, parent.screen);
    if (role === 'keyboard') continue;
    const name = state.name
      || (state.screen && state.screen !== parent.screen ? state.screen.id : stateTag(state));
    push(parent.screen.id, { kind: 'display', role, label: name, value: '', name, state, base: parent, parent });
  }
  for (const kids of out.values()) {
    kids.sort((a, b) => (a.kind === 'display') - (b.kind === 'display')
      || a.name.localeCompare(b.name));
  }
  return out;
}

/* Each stored edge of a display child that its parent holds too: the same control's action
   to the same state in the same layout. The map draws such a route once, at the parent. */
export function inheritedCopies(model) {
  const rows = displayRows(model);
  const out = new Set();
  if (!rows.size) return out;
  const held = new Map();
  for (const e of model.edges) {
    if (!held.has(e.src)) held.set(e.src, new Set());
    held.get(e.src).add(`${e.action}\n${e.requires}\n${e.dst}`);
  }
  for (const e of model.edges) {
    const row = rows.get(e.src);
    if (!row || !row.parent || !controlOf(e.action)) continue;
    const parent = held.get(row.parent);
    if (parent && parent.has(`${e.action}\n${e.requires}\n${e.dst}`)) out.add(e);
  }
  return out;
}

function parseLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lineParts(line) {
  const text = line.trimStart();
  const depth = Math.floor((line.length - text.length) / 2);
  return { depth, text, cls: text.split(' ')[0] };
}

function lineOps(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head
    && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const w = y.length + 1;
  const len = new Int32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      len[i * w + j] = x[i] === y[j] ? len[(i + 1) * w + j + 1] + 1
        : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push({ op: '=', line: x[i] }); i += 1; j += 1;
    } else if (j < y.length && (i === x.length || len[i * w + j + 1] >= len[(i + 1) * w + j])) {
      ops.push({ op: '+', line: y[j] }); j += 1;
    } else {
      ops.push({ op: '-', line: x[i] }); i += 1;
    }
  }
  return { ops, same: head + tail + ops.filter(o => o.op === '=').length };
}

export function treeDiff(before, after) {
  const { ops, same } = lineOps(parseLines(before), parseLines(after));
  const rows = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === '=') { k += 1; continue; }
    const removed = [];
    const added = [];
    while (k < ops.length && ops[k].op !== '=') {
      (ops[k].op === '-' ? removed : added).push(lineParts(ops[k].line));
      k += 1;
    }
    const paired = new Set();
    for (const r of removed) {
      const match = added.find(a => !paired.has(a) && a.depth === r.depth && a.cls === r.cls);
      if (match) {
        paired.add(match);
        r.to = match;
      }
    }
    for (const r of removed) {
      rows.push(r.to
        ? { op: 'changed', depth: r.depth, text: r.to.text, from: r.text }
        : { op: 'removed', depth: r.depth, text: r.text });
    }
    for (const a of added) if (!paired.has(a)) rows.push({ op: 'added', depth: a.depth, text: a.text });
  }
  const count = op => rows.filter(r => r.op === op).length;
  return { rows, added: count('added'), removed: count('removed'), changed: count('changed'), same };
}

const VALUE_ROLES = new Set(['setting']);

/* The state a value state varies from. A mode toggle is a substate of its own, never a value. */
export function variedFrom(kid) {
  if (kid.kind === 'mode') return null;
  if (kid.setting) return kid.base || null;
  if (VALUE_ROLES.has(kid.role)) return kid.parent || null;
  return null;
}


/* A value state joins the card it varies from; the other display children are the card's substates. */
export function stackVariants(kids, { kidsOfScreen = () => [], settingsOf = () => [] } = {}) {
  const items = [];
  const byLead = new Map();
  const inRow = new Set(kids.map(k => k.state.id));
  for (const kid of kids) {
    if (variedFrom(kid)) continue;
    const item = { ...kid, members: [kid] };
    items.push(item);
    byLead.set(kid.state.id, item);
  }
  for (const kid of kids) {
    const from = variedFrom(kid);
    const lead = from && byLead.get(from.id);
    if (lead) lead.members.push(kid);
  }
  for (const item of byLead.values()) {
    const screen = item.state.screen;
    if (!screen || (item.parent && screen === item.parent.screen)) continue;
    for (const k of kidsOfScreen(screen.id)) {
      const from = variedFrom(k);
      if (inRow.has(k.state.id) || !from || from.id !== item.state.id) continue;
      if (!item.members.some(m => m.state.id === k.state.id)) item.members.push(k);
    }
  }
  const merged = new Map();
  return items.filter((item) => {
    const screen = item.state.screen;
    const settings = [...new Set(item.members.flatMap(m => settingsOf(m.state.id)))].sort();
    if (!settings.length || !screen || !item.parent || screen === item.parent.screen) return true;
    const key = `${item.parent.id}\n${screen.id}\n${settings.join('\n')}`;
    const into = merged.get(key);
    if (!into) {
      merged.set(key, item);
      return true;
    }
    for (const m of item.members) if (!into.members.includes(m)) into.members.push(m);
    return false;
  });
}
