/* share.js — the share dialog: a scannable QR code for the site, drawn in the page from qr.js.
 * The overlay carries no controls; a click anywhere on it, or Escape, closes it.
 *
 * The code is drawn to an offscreen canvas and handed to an <img> as a PNG, rather than shown on a canvas in
 * the page. A canvas has no save affordance at all — long-press on a phone and right-click on a desktop both
 * offer to save an <img> and nothing else, which is the only way out of this dialog with the code in hand.
 *
 * Accent modules on near-black, with the site mark stamped over the middle, so the code and the mark are the
 * one orange. --accent measures 5.7:1 against --ink, which clears what a binarisation step needs. The other
 * margin is error-correction level H, which recovers 30% of the symbol against level M's 15%; the stamp covers
 * 11.1% of the modules, well inside that budget.
 *
 * MEASURED: inverted polarity is the part that costs something. OpenCV's detector reads nothing from this
 * code as drawn, and reads it every time once the polarity is flipped — so the modules and the stamp are
 * sound and the inversion alone is what a strict decoder refuses. Phone cameras invert for themselves. To go
 * back to a code every decoder reads without leaving the palette, swap MODULE and GROUND: dark modules on an
 * amber ground decode as drawn, verified at 246px and 180px.
 */
(function () {
  'use strict';

  // The address the site is actually served from. `python site-url.py <base>` moves this with the canonical
  // URL, the cards and the sitemap; a code encoding a host that serves something else scans to the wrong site.
  const SITE_URL = 'https://alexk413x.com';
  const MODULE = '#dd6a20';    // --accent, the same orange the mark is drawn in
  const GROUND = '#0c0c0e';    // --ink
  const LEVEL = 'H';           // the recovery budget the center stamp spends
  const QUIET = 4;             // modules of margin the spec requires around the code
  const CSS_PX = 260;          // the size the code is asked to occupy, before rounding to whole modules

  /* The favicon, not a second drawing of it: the mark is one file and the canvas loads it. Same-origin SVG does
     not taint the canvas, so toDataURL still returns the pixels and the <img> gets a saveable PNG. */
  const stamp = new Image();
  stamp.src = 'favicon.svg';

  const dlg = document.getElementById('qr-dialog');
  const img = document.getElementById('qr-image');
  if (!dlg || !img || !window.AKQR) return;

  /* Every trigger, not one button: the header mark and the contact button are two doors into this one dialog
     rather than two descriptions of it, sharing the drawn-once image and the same focus trap. */
  const openBtns = document.querySelectorAll('[data-qr-open]');
  let lastFocus = null;
  // An explicit flag, not img.src: the src is set asynchronously enough that reading it back races the first open.
  let drawn = false;

  /* How many modules the mark covers, and how many are cleared around it. Both odd so the block centers exactly
     on a symbol, whose size is always odd. The cleared ring is what keeps the scanner from reading a module
     that the mark has half-covered. */
  function stampSpan(size) {
    const clear = 2 * Math.round((size * 0.33 - 1) / 2) + 1;
    return { clear, mark: clear - 2 };
  }

  /* Draws the matrix at whole-pixel module size. A QR scaled to a fractional module width gets antialiased
     edges, and a soft edge is exactly what a scanner's binarisation step gets wrong. The displayed size is
     rounded down to whole modules for the same reason. */
  function draw() {
    const { size, modules } = window.AKQR.encode(SITE_URL, LEVEL);
    const total = size + QUIET * 2;
    const scale = Math.max(1, Math.floor((CSS_PX * (window.devicePixelRatio || 1)) / total));
    const px = total * scale;
    const { clear } = stampSpan(size);
    const lo = (size - clear) / 2, hi = lo + clear - 1;

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;

    const g = canvas.getContext('2d');
    g.fillStyle = GROUND;
    g.fillRect(0, 0, px, px);
    g.fillStyle = MODULE;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (r >= lo && r <= hi && c >= lo && c <= hi) continue;
      if (modules[r][c]) g.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
    }
    drawStamp(g, size, scale);

    img.src = canvas.toDataURL('image/png');
    img.style.width = img.style.height = (total * Math.max(1, Math.floor(CSS_PX / total))) + 'px';
  }

  // Separate from draw() because the SVG may still be loading when the dialog first opens.
  function drawStamp(g, size, scale) {
    if (!stamp.complete || !stamp.naturalWidth) return;
    const { mark } = stampSpan(size);
    const at = (QUIET + (size - mark) / 2) * scale;
    g.drawImage(stamp, at, at, mark * scale, mark * scale);
  }

  function open() {
    lastFocus = document.activeElement;
    if (!drawn) { draw(); drawn = true; }
    dlg.hidden = false;
    dlg.focus();
    document.addEventListener('keydown', onKey);
  }

  function close() {
    dlg.hidden = true;
    document.removeEventListener('keydown', onKey);
    if (lastFocus) lastFocus.focus();
  }

  /* Escape or Enter/Space closes, and Tab is swallowed rather than trapped: the dialog holds nothing focusable,
     so the only place focus could go is the page behind it. */
  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { e.preventDefault(); dlg.focus(); }
  }

  // Redraws whole rather than stamping in place: draw() is cheap, and it needs no scale carried between calls.
  stamp.addEventListener('load', () => { if (drawn) draw(); });

  openBtns.forEach((btn) => btn.addEventListener('click', open));
  // Anywhere, panel included: there is no close control, so every part of the overlay is the close control.
  dlg.addEventListener('click', close);
})();
