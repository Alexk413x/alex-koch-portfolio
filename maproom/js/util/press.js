/* Hover wash and press pulse, ported from docs/report-design/gen-map.py's `armPress`.

   Hover fills travel at 600 screen pixels per second. Screenshot borders trace
   both ways from the nearest edge; other washes expand from the pointer.
   A toggle pulses from the control that changed: outward when it
   turns on, inward when it turns off. A plain press pulses outward.

   The ink rules come from the canvas; map borders add perimeter-based timing. */

const PRESS_SEL = '.run-content .rfold > summary, button:not(.frame-close), .btn, .tab, .row, .app, .brand, .go, .rcard, .case-h, .trend, '
  + '.rtbl .rn, .box:not(.open), .map-shot, .fold:not(.flat) .fold-h, .drop div, .cell, .ih-name, .search, '
  + '.toggle, .check, .keybtn, .step, .visit, .nchip, .select-surface:has(select:enabled), '
  + '.select-surface select:enabled option:not(:disabled)';
const TOGGLE_SEL = '.toggle, .check, .seg button, .tab';
const HOVER_SPEED = 300;
const FILL_SPEED = 600;

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
    return { px, py, far, duration: far * k / FILL_SPEED };
  };

  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest(PRESS_SEL);
    if (!el || el.contains(e.relatedTarget) || el.matches('.off')) return;
    const outline = el.matches('.map-shot') ? el.querySelector('.shot-border rect') : null;
    const empty = outline && parseFloat(getComputedStyle(outline).strokeDasharray) === 0;
    if (empty) {
      outline.style.transition = 'none';
      const r = outline.ownerSVGElement.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
      const y = Math.max(0, Math.min(r.height, e.clientY - r.top));
      const perimeter = 2 * (r.width + r.height);
      const sides = [
        { distance: y, at: x },
        { distance: r.width - x, at: r.width + y },
        { distance: r.height - y, at: r.width + r.height + r.width - x },
        { distance: x, at: perimeter - y },
      ];
      const origin = sides.reduce((a, b) => a.distance <= b.distance ? a : b).at / perimeter;
      el.style.setProperty('--border-start', String(-origin));
      el.style.setProperty('--border-end', String(.5 - origin));
    }
    if (el.matches('.map-shot')) {
      const r = outline.ownerSVGElement.getBoundingClientRect();
      el.style.setProperty('--border-duration', `${(r.width + r.height) / HOVER_SPEED}s`);
      // Commit the empty dash at its pointer origin before starting the reveal.
      getComputedStyle(outline).strokeDashoffset;
      if (empty) outline.style.removeProperty('transition');
    }
    const { px, py, far, duration } = geom(el, e.clientX, e.clientY);
    el.setAttribute('data-press', '');
    el.style.setProperty('--hx', `${px}px`);
    el.style.setProperty('--hy', `${py}px`);
    el.style.setProperty('--hr', `${far}px`);
    el.style.setProperty('--hover-duration', `${duration}s`);
    el.style.setProperty('--wash', inkFor(el).wash);
    el.setAttribute('data-hov', '1');
  }, true);

  root.addEventListener('pointerout', (e) => {
    const el = e.target.closest && e.target.closest(PRESS_SEL);
    if (!el || el.contains(e.relatedTarget)) return;
    const { px, py, far, duration } = geom(el, e.clientX, e.clientY);
    el.style.setProperty('--hx', `${px}px`);
    el.style.setProperty('--hy', `${py}px`);
    el.style.setProperty('--hr', `${far}px`);
    el.style.setProperty('--hover-duration', `${duration}s`);
    el.setAttribute('data-hov', '0');
  }, true);

  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest && e.target.closest(PRESS_SEL);
    // A screen box gets no surface wash or pulse: its own border sweep is the
    // whole response, which is what keeps a capture from being washed over.
    if (!el || el.matches('.off, .box, .map-shot')) return;
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
