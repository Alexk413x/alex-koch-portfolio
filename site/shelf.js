/* shelf.js — the back catalogue: seventeen shipped products on one shelf, one open at a time.
 *
 * THE PAGE KEEPS ITS SCROLL. The rack is a native horizontal scroller and nothing here touches the wheel, so
 * scrolling down never stops to drive something sideways. That is why this section is not pinned, and why there
 * is no rAF loop in this file: the shelf has no scroll-driven state at all.
 *
 * ONE ROW, not one per act. The acts are dividers standing between the spines rather than separate racks — the
 * career is a single shelf you browse end to end, and the act marks are where it changes chapter.
 *
 * THE PANELS ARE AUTHORED OPEN. Every proof is written out in index.html and this script is what collapses them,
 * so a crawler that runs no JavaScript — which is most of the AI ones — reads all seventeen records in full.
 * Nothing here builds a product out of an array; if it is not in the markup it does not exist.
 */
(function () {
  'use strict';

  const shelf = document.getElementById('shelf');
  if (!shelf) return;

  const rack = shelf.querySelector('.rack');
  const bay = shelf.querySelector('.bay');
  const spines = Array.prototype.slice.call(shelf.querySelectorAll('.spine-face'));
  if (!rack || !bay || !spines.length) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* The enhancement switch. Every rule that hides or animates anything is behind `.js-shelf` in the stylesheet,
     so the no-JS document is the complete one rather than a degraded one. */
  shelf.classList.add('js-shelf');

  let open = null;

  /* A spine's aria-controls names its proof, so the markup carries the pairing and this file never assumes the
     two lists are in the same order. */
  function show(face) {
    const panel = document.getElementById(face.getAttribute('aria-controls'));
    if (!panel || face === open) return;

    if (open) {
      open.setAttribute('aria-expanded', 'false');
      open.closest('.spine').classList.remove('picked');
      const was = document.getElementById(open.getAttribute('aria-controls'));
      if (was) was.hidden = true;
    }

    open = face;
    face.setAttribute('aria-expanded', 'true');
    face.closest('.spine').classList.add('picked');
    panel.hidden = false;

    /* Re-triggered per open by removing and re-adding the class — an animation that has already run does not run
       again just because its element was shown, and the panel is the same node every time. */
    panel.classList.remove('landing');
    void panel.offsetWidth;
    panel.classList.add('landing');

    countUp(panel);
    keepInView(face);
  }

  /* Nudge the rack so the picked spine is fully visible, and no further.
     THE RACK SCROLLS, THE PAGE DOES NOT. scrollIntoView on a horizontally overflowing child will happily scroll
     every ancestor including the document, which would yank the reader down the page for a click they made
     sideways. Only the rack's own scrollLeft is touched. Centring instead of nudging made every click near the
     ends jump the row for no reason. */
  function keepInView(face) {
    const s = face.closest('.spine');
    const left = s.offsetLeft;
    const right = left + s.offsetWidth;
    const pad = 28;
    const how = reduced.matches ? 'auto' : 'smooth';
    if (left - pad < rack.scrollLeft) {
      rack.scrollTo({ left: Math.max(0, left - pad), behavior: how });
    } else if (right + pad > rack.scrollLeft + rack.clientWidth) {
      rack.scrollTo({ left: right + pad - rack.clientWidth, behavior: how });
    }
  }

  spines.forEach((face, i) => {
    face.addEventListener('click', () => show(face));

    /* Left/right move along the shelf the way a listbox does. nav.js already declines to steal arrow keys when
       the target is a BUTTON, so these do not have to fight it — and up/down still page-step, which is correct:
       those are the reader leaving the shelf. */
    face.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const n = spines[Math.max(0, Math.min(spines.length - 1, i + d))];
      n.focus();
      show(n);
    });
  });

  // Collapse everything, then open the first. In that order, because the authored-open markup is the thing
  // being closed rather than this script deciding from scratch what "open" means.
  Array.prototype.slice.call(bay.querySelectorAll('.proof')).forEach((p) => { p.hidden = true; });
  spines.forEach((f) => f.setAttribute('aria-expanded', 'false'));
  show(spines[0]);

  /* ---- the ends of the shelf ----
   * A fade at whichever end has more shelf behind it. It is the only thing telling a reader on a wide screen
   * that seventeen products do not stop at the edge of the window — the scrollbar is 5px and easy to miss. */
  function ends() {
    const max = rack.scrollWidth - rack.clientWidth;
    shelf.classList.toggle('more-left', rack.scrollLeft > 4);
    shelf.classList.toggle('more-right', rack.scrollLeft < max - 4);
  }
  rack.addEventListener('scroll', ends, { passive: true });
  window.addEventListener('resize', ends);
  ends();

  /* The figure counts to the value written in the markup. `data-count` is the number; the element's text is the
     formatted target and is restored exactly at the end, so a thousands separator or a "+" never has to be
     reconstructed here and the DOM ends up identical to what was served. If no frame ever runs — a hidden tab
     gets none — the reader simply sees the correct final number, which is why this never clears the text first. */
  function countUp(panel) {
    const fig = panel.querySelector('[data-count]');
    if (!fig) return;

    const target = parseFloat(fig.getAttribute('data-count'));
    const final = fig.textContent;
    if (!(target > 0) || reduced.matches) { fig.textContent = final; return; }

    const dur = 900;
    let t0 = 0;
    if (fig._raf) cancelAnimationFrame(fig._raf);

    const step = (ts) => {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        fig.textContent = Math.round(target * e).toLocaleString('en-US');
        fig._raf = requestAnimationFrame(step);
      } else {
        fig.textContent = final;
        fig._raf = 0;
      }
    };
    fig._raf = requestAnimationFrame(step);
  }
})();
