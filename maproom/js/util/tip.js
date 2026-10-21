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
  const node = (target) => {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tip';
      tip.hidden = true;
    }
    const host = target?.closest('dialog[open]')
      || document.querySelector('.root')
      || document.body
      || document.documentElement;
    if (tip.parentElement !== host) host.append(tip);
    return tip;
  };

  let timer = null;
  let current = null;
  let hovered = null;

  const hide = () => {
    clearTimeout(timer);
    current = null;
    if (!tip) return;
    tip.hidden = true;
    tip.classList.remove('in');
  };

  const place = (el) => {
    if (root.querySelector('select:open')) {
      hide();
      return;
    }
    const t0 = node(el);
    t0.textContent = el.getAttribute('data-tip') || '';
    t0.hidden = false;
    const r = el.getBoundingClientRect();
    const t = t0.getBoundingClientRect();
    const dialog = el.closest('dialog[open]');
    const bounds = dialog ? dialog.getBoundingClientRect() : {
      left: 0,
      right: window.innerWidth,
      top: 0,
      bottom: window.innerHeight,
    };
    // Below the control, centred, and nudged back inside the viewport rather
    // than allowed to run off the edge or outside a dialog's clipping area.
    const gap = 8;
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(bounds.left + gap, Math.min(x, bounds.right - t.width - gap));
    let y = r.bottom + gap;
    if (y + t.height > bounds.bottom - gap) y = r.top - t.height - gap;
    y = Math.max(bounds.top + gap, Math.min(y, bounds.bottom - t.height - gap));
    t0.style.left = `${Math.round(x)}px`;
    t0.style.top = `${Math.round(y)}px`;
    t0.classList.add('in');
  };

  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (!el) return;
    hovered = el;
    if (el === current) return;
    hide();
    current = el;
    timer = setTimeout(() => { if (current === el) place(el); }, DELAY);
  }, true);

  root.addEventListener('pointerout', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    const next = e.relatedTarget;
    if (el && !(next instanceof Node && el.contains(next))) {
      if (el === hovered) hovered = null;
      if (el === current) hide();
    }
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

  const observer = new MutationObserver(records => {
    const changed = records.find(record => record.target === current
      || record.target === hovered)?.target;
    if (!changed) return;
    if (changed === current && tip && !tip.hidden) {
      place(current);
      return;
    }
    if (changed === hovered) {
      clearTimeout(timer);
      current = hovered;
      timer = setTimeout(() => {
        if (current === hovered) place(hovered);
      }, DELAY);
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-tip'], subtree: true });
}
