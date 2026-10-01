/* The site's own tooltip, replacing the browser's.

   A native `title` is an OS tooltip: it ignores the palette, waits about a
   second, and wraps wherever it likes. Every control here is icon-only by the
   standing rule that self-evident controls carry no label, so the tooltip IS
   the label and has to look like the rest of the site.

   `.tip` is the canvas component from Components.dc.html, ported unchanged.
   Arm this once on the document; any element with `data-tip` gets it. */

const DELAY = 90;

export function armTips(root) {
  // Built on first hover, not on arm: this runs from `page()`, and a caller
  // that arms before <body> exists should not be the thing that breaks.
  let tip = null;
  const node = () => {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tip';
      tip.hidden = true;
      (document.body || document.documentElement).append(tip);
    }
    return tip;
  };

  let timer = null;
  let current = null;

  const hide = () => {
    clearTimeout(timer);
    current = null;
    if (!tip) return;
    tip.hidden = true;
    tip.classList.remove('in');
  };

  const place = (el) => {
    const t0 = node();
    t0.textContent = el.getAttribute('data-tip') || '';
    t0.hidden = false;
    const r = el.getBoundingClientRect();
    const t = t0.getBoundingClientRect();
    // Below the control, centred, and nudged back inside the viewport rather
    // than allowed to run off the edge -- the last button in a group is always
    // near one.
    const gap = 8;
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - t.width - 8));
    let y = r.bottom + gap;
    if (y + t.height > window.innerHeight - 8) y = r.top - t.height - gap;
    t0.style.left = `${Math.round(x)}px`;
    t0.style.top = `${Math.round(y)}px`;
    t0.classList.add('in');
  };

  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el || el === current) return;
    hide();
    current = el;
    timer = setTimeout(() => { if (current === el) place(el); }, DELAY);
  }, true);

  root.addEventListener('pointerout', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el && el === current) hide();
  }, true);

  // Keyboard focus only: a click also focuses, and a tip on every click is noise.
  root.addEventListener('focusin', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el || !e.target.matches(':focus-visible')) return;
    hide();
    current = el;
    place(el);
  }, true);

  root.addEventListener('focusout', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el && el === current) hide();
  }, true);

  // A tooltip left standing over a control that has just moved or been
  // replaced is worse than none, so any of these dismiss it.
  for (const ev of ['pointerdown', 'wheel', 'keydown']) {
    root.addEventListener(ev, hide, true);
  }
  window.addEventListener('blur', hide);
}
