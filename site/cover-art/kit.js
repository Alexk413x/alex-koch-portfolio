/* kit.js — the vocabulary every box cover is drawn in.
 *
 * THREE INKS AND A DEPTH RAMP, AND NEITHER LIVES HERE AS A NUMBER YOU CAN TYPE TWICE. A cover names a role —
 * line, lit, deep — and site.css decides what color the role is, so retinting the whole set is one rule. The
 * weights a role is laid on at are the PAINTS below: how much ink a thing gets is a function of how far back it
 * sits, and there are six depths, not sixty. Every defect in this artwork's history was a repeated value.
 *
 * Fill and stroke are ORTHOGONAL class families (f-* and s-*) rather than one class per combination. A shell is
 * a deep fill with a line edge; a screen is a deep fill with a lit edge. Enumerating the pairs would have been
 * sixteen classes that all have to move together.
 */

const NS = 'http://www.w3.org/2000/svg';

/* The ink roles. Values are class suffixes, not colors — see .cover-art in site.css. */
export const LINE = 'line';   // --accent: every edge and every body
export const LIT = 'lit';     // --amber: the one lit thing on a cover
export const DEEP = 'deep';   // --ink-deep: the face, and every knockout cut in it
export const STRONG = 'strong';

/* THE PAINTS. A depth, named. `body` is the subject; `mid` is a plane behind it; `far` is the furthest thing
   back. `shell` and `knock` are the same idea from the other side: a translucent member laid over another one
   compounds, so anything that must read solid gets an opaque cut first.
   THE STROKE-ONLY PAINTS DECLARE `fill: null` AND IT IS LOAD-BEARING. An SVG shape with no fill declared takes
   the initial value, which is BLACK — so a rect drawn as an outline over lit artwork fills in and hides it.
   Most of the outlines in this set sit over something, which is why the paints carry the none rather than
   leaving each call to remember it. The handful that genuinely inherit their fill say so at the call. */
const PAINTS = {
  body: { fill: LINE, fillOp: 0.25, stroke: LINE, w: 1.7 },
  edge: { fill: null, stroke: LINE, w: 1.7 },
  shell: { fill: DEEP, stroke: LINE, w: 1.7 },
  knock: { fill: DEEP },
  mid: { fill: null, stroke: LINE, strokeOp: 0.55, w: 1.1 },
  far: { fill: null, stroke: LINE, strokeOp: 0.35, w: 1.1 },
  tint: { fill: LINE, fillOp: 0.5 },

  panel: { fill: DEEP, stroke: LIT, strokeOp: 0.4, w: 1 },
  lit: { fill: LIT },
  soft: { fill: LIT, fillOp: 0.5 },
  glow: { fill: LIT, fillOp: 0.18 },
  hair: { fill: null, stroke: LIT, strokeOp: 0.32 },
  rule: { fill: null, stroke: LIT, strokeOp: 0.25 },
  trace: { fill: null, stroke: LIT, strokeOp: 0.7, w: 1.5, cap: 'round', join: 'round' },
  litLine: { fill: null, stroke: LIT, w: 2, cap: 'round', join: 'round' },
  cut: { fill: null, stroke: DEEP, w: 2, cap: 'round', join: 'round' }
};

/* Resolve a paint to attributes. A string names one of the PAINTS; an object overrides it field by field, which
   is how a cover says "this one thing is a little further back" without inventing a new color. */
export function pt(name, over) {
  const base = typeof name === 'string' ? PAINTS[name] : name;
  if (!base) throw new Error('cover-art: unknown paint "' + name + '"');
  return over ? Object.assign({}, base, over) : base;
}

/* A role that is ABSENT and a role that is null are different things: absent inherits from the group or from
   the <use> that placed a shared part, null paints nothing. Collapsing the two is what would leak a stroke onto
   Rexel's barcodes the moment the <use> carrying the drawer's color also carried a stroke. */

const VAR = { line: '--accent', lit: '--amber', deep: '--ink-deep', strong: '--text-strong' };

/* INSIDE A SHARED PART THE COLOR GOES ON AS AN INLINE STYLE, NOT A CLASS, and that is not a style preference.
   A part is drawn by <use>, and a CSS SELECTOR DOES NOT REACH INTO THE SHADOW CONTENT the <use> clones — only
   attributes and inline styles travel with the clone. Painted by class, every fixed-color shape in a shared
   part silently took the <use>'s inherited fill instead of its own: the agent glyph came out invisible, and
   Rexel's barcode label came out the same orange as the barcode on it, which is why the codes vanished.
   Shapes that are MEANT to take the placement's color still carry no paint at all; inheritance does reach the
   shadow tree, which is why FieldView's frame worked all along and nothing else did. */
let inShared = false;

function paintAttrs(p) {
  const cls = [];
  const style = [];
  const a = {};
  const paint = (prop, role) => {
    if (inShared) style.push(prop + ':' + (role ? 'var(' + VAR[role] + ')' : 'none'));
    else cls.push(prop[0] + '-' + (role || 'none'));
  };
  if ('fill' in p) paint('fill', p.fill);
  if ('stroke' in p) paint('stroke', p.stroke);
  if (p.fillRef) { a.fill = 'url(#' + p.fillRef + ')'; }
  if (p.fillOp != null) a['fill-opacity'] = p.fillOp;
  if (p.strokeOp != null) a['stroke-opacity'] = p.strokeOp;
  if (p.w != null) a['stroke-width'] = p.w;
  if (p.cap) a['stroke-linecap'] = p.cap;
  if (p.join) a['stroke-linejoin'] = p.join;
  if (p.rule) a['fill-rule'] = p.rule;
  if (p.mask) a.mask = 'url(#' + p.mask + ')';
  if (cls.length) a.class = cls.join(' ');
  if (style.length) a.style = style.join(';');
  return a;
}

/* One element. `paint` may be omitted for a child that inherits its group's paint, which is most of them. */
export function node(tag, attrs, paint) {
  const n = document.createElementNS(NS, tag);
  const all = paint ? Object.assign(paintAttrs(paint), attrs) : attrs || {};
  for (const k in all) if (all[k] != null) n.setAttribute(k, all[k]);
  return n;
}

const add = (g, n) => { g.appendChild(n); return n; };

export const rect = (g, x, y, w, h, paint, extra) =>
  add(g, node('rect', Object.assign({ x, y, width: w, height: h }, extra), paint));

export const path = (g, d, paint, extra) =>
  add(g, node('path', Object.assign({ d }, extra), paint));

export const circle = (g, cx, cy, r, paint, extra) =>
  add(g, node('circle', Object.assign({ cx, cy, r }, extra), paint));

export const ellipse = (g, cx, cy, rx, ry, paint, extra) =>
  add(g, node('ellipse', Object.assign({ cx, cy, rx, ry }, extra), paint));

/* A glyph drawn INTO the picture — the question mark on Store Companion, not the lockup. The face and weight
   come from .cover-art text in site.css; only the size is a per-cover decision. */
export const glyph = (g, x, y, str, size, paint, extra) => {
  const n = add(g, node('text', Object.assign({ x, y, 'font-size': size }, extra), paint));
  n.textContent = str;
  return n;
};

/* A group carrying a paint its children inherit. Returns the group so a caller can keep filling it. */
export const group = (g, paint, extra) => add(g, node('g', extra, paint));

/* A placed instance of a shared part. Color, fill opacity and stroke width ride on the <use>, not on the
   definition, so the same drawing can be the steel frame on one cover and the photo of it on another. */
export const use = (g, id, paint, extra) =>
  add(g, node('use', Object.assign({ href: '#' + id }, extra), paint));

/* ---- the shared defs ----
 *
 * ONE COPY IN THE DOCUMENT, however many covers are on screen. The rack builds and destroys covers as it turns;
 * a defs block per cover would be seventeen copies of the same four gradients and two masks.
 */
let defsHost = null;

function defs() {
  if (defsHost) return defsHost;
  const svg = node('svg', { width: 0, height: 0, 'aria-hidden': 'true', class: 'cover-defs' });
  defsHost = node('defs', {});
  svg.appendChild(defsHost);
  document.body.appendChild(svg);
  return defsHost;
}

/* Register a shared part once, under an id the covers reference by name. Later calls with the same id are a
   no-op, so a cover can declare what it needs without knowing whether another cover got there first. */
const registered = new Set();

export function share(id, tag, attrs, build) {
  if (registered.has(id)) return id;
  registered.add(id);
  const n = node(tag, Object.assign({ id }, attrs));
  if (build) {
    inShared = true;
    try { build(n); } finally { inShared = false; }
  }
  defs().appendChild(n);
  return id;
}

/* A gradient, declared as stops rather than markup. `stops` is [offset, roleOrNull, opacity]. */
export function shareGradient(id, kind, attrs, stops) {
  return share(id, kind === 'radial' ? 'radialGradient' : 'linearGradient', attrs, (n) => {
    stops.forEach(([offset, role, op]) => {
      n.appendChild(node('stop', {
        offset,
        class: role ? 'g-' + role : null,
        'stop-opacity': op == null ? null : op
      }));
    });
  });
}
