/* Hover wash and press pulse, ported from docs/report-design/gen-map.py's `armPress`.

   Every fill takes 300ms whatever the size, so the speed comes from the far
   corner. The wash grows from the pointer's entry point and retracts to its
   exit point. A toggle pulses from the control that changed: outward when it
   turns on, inward when it turns off. A plain press pulses outward.

   This is a PORT. The selectors, the timings and the ink rules are the
   canvas's; only the element list is extended for classes this app adds. */

const PRESS_SEL = 'button, .btn, .tab, .row, .app, .brand, .go, .rcard, .case-h, .trend, '
  + '.rtbl .rn, .box, .fold:not(.flat) .fold-h, .drop div, .cell, .rl, .ih-name, .search, '
  + '.toggle, .check, .keybtn, .step, .visit, .nchip';
const TOGGLE_SEL = '.toggle, .check, .seg button, .tab';

/* The colour an element actually sits on, walking up past transparent
   backgrounds. Ink is measured from the surface, not assumed. */
function surfaceRGB(el) {
  for (let e = el; e; e = e.parentElement) {
    const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g);
    if (m && m.length >= 3 && (m.length < 4 || parseFloat(m[3]) > 0.05)) return m.slice(0, 3).map(Number);
  }
  return [0, 0, 0];
}

function parseColor(c) {
  c = String(c).trim();
  const h = c.match(/^#([0-9a-f]{3,8})$/i);
  if (h) {
    let x = h[1];
    if (x.length <= 4) x = [...x].map(ch => ch + ch).join('');
    return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16))
      .concat([x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1]);
  }
  const m = c.match(/[\d.]+/g) || [0, 0, 0];
  return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
}

function luminance([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/* White ink on a dark surface, black on a light one. The pulse keeps its own
   colour unless the surface is too close to it in brightness to show it, at
   which point it takes the ink too. */
function inkFor(el) {
  const root = document.querySelector('.root') || document.body;
  const base = parseColor(getComputedStyle(root).getPropertyValue('--pulse-base') || '#0e70c880');
  const surf = surfaceRGB(el);
  const dark = luminance(surf) < 0.35;
  const ink = dark ? '234,243,248' : '4,7,10';
  const usable = Math.abs(luminance(base) - luminance(surf)) > 0.22;
  const pulse = usable
    ? `rgba(${base[0]},${base[1]},${base[2]},${base[3]})`
    : `rgba(${ink},${dark ? 0.45 : 0.35})`;
  return { wash: `rgba(${ink},${dark ? 0.10 : 0.09})`, pulse };
}

/* Arm the whole document. Listeners are capturing so a press on a child still
   resolves to the pressable ancestor. */
export function armPress(root) {
  const geom = (el, x, y) => {
    const r = el.getBoundingClientRect();
    // The map world is CSS-scaled, so screen pixels must be divided back into
    // the element's own pixels or the wash is the wrong size at every zoom.
    const k = el.offsetWidth ? r.width / el.offsetWidth : 1;
    const px = (x - r.left) / k;
    const py = (y - r.top) / k;
    const w = el.offsetWidth || r.width;
    const h = el.offsetHeight || r.height;
    const far = Math.max(Math.hypot(px, py), Math.hypot(w - px, py),
      Math.hypot(px, h - py), Math.hypot(w - px, h - py));
    return { px, py, far };
  };

  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest(PRESS_SEL);
    if (!el || el.contains(e.relatedTarget) || el.matches('.off')) return;
    const { px, py, far } = geom(el, e.clientX, e.clientY);
    el.setAttribute('data-press', '');
    el.style.setProperty('--hx', `${px}px`);
    el.style.setProperty('--hy', `${py}px`);
    el.style.setProperty('--hr', `${far}px`);
    el.style.setProperty('--wash', inkFor(el).wash);
    el.setAttribute('data-hov', '1');
  }, true);

  root.addEventListener('pointerout', (e) => {
    const el = e.target.closest && e.target.closest(PRESS_SEL);
    if (!el || el.contains(e.relatedTarget)) return;
    const { px, py } = geom(el, e.clientX, e.clientY);
    el.style.setProperty('--hx', `${px}px`);
    el.style.setProperty('--hy', `${py}px`);
    el.setAttribute('data-hov', '0');
  }, true);

  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest && e.target.closest(PRESS_SEL);
    // A screen box gets no surface wash or pulse: its own border sweep is the
    // whole response, which is what keeps a capture from being washed over.
    if (!el || el.matches('.off') || el.matches('.box')) return;
    const ctl = el.closest(TOGGLE_SEL);
    // The pulse covers exactly what the click changes: the whole group when
    // picking one member deselects the rest, otherwise the element alone.
    const surface = el.closest('[data-scope]') || el;
    const mark = ctl && ctl.matches('.toggle, .check') ? ctl.querySelector('i') : null;
    let ox = e.clientX;
    let oy = e.clientY;
    if (mark) {
      const m = mark.getBoundingClientRect();
      ox = m.left + m.width / 2;
      oy = m.top + m.height / 2;
    }
    const inward = Boolean(ctl) && ctl.matches('.toggle, .check') && ctl.classList.contains('on');
    const { px, py, far } = geom(surface, ox, oy);
    const pulse = document.createElement('span');
    pulse.className = `pulse${inward ? ' in' : ''}`;
    pulse.style.cssText = `left:${px}px; top:${py}px; width:${far * 2}px; height:${far * 2}px; `
      + `margin:-${far}px 0 0 -${far}px`;
    surface.setAttribute('data-press', '');
    surface.style.setProperty('--pulse', inkFor(surface).pulse);
    surface.appendChild(pulse);
    pulse.addEventListener('animationend', () => pulse.remove());
  }, true);
}
