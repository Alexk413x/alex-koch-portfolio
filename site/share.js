/* share.js — the share dialog: a scannable QR code for the site, drawn in the page from qr.js.
 *
 * Accent modules on near-black, with the site mark stamped over the middle, so the code and the mark are the
 * one orange. --accent measures 5.7:1 against --ink, which clears what a binarisation step needs. The other
 * margin is error-correction level H, which recovers 30% of the symbol against level M's 15%; the stamp covers
 * 11.1% of the modules, well inside that budget.
 *
 * MEASURED: inverted polarity is the part that costs something. OpenCV's detector reads nothing from this
 * canvas as drawn, and reads it every time once the polarity is flipped — so the modules and the stamp are
 * sound and the inversion alone is what a strict decoder refuses. Phone cameras invert for themselves. To go
 * back to a code every decoder reads without leaving the palette, swap MODULE and GROUND: dark modules on an
 * amber ground decode as drawn, verified at 246px and 180px.
 */
(function () {
  'use strict';

  // The www host, deliberately: the apex alexk413x.com does not resolve, so a code encoding it scans to nothing.
  const SITE_URL = 'https://www.alexk413x.com';
  const MODULE = '#dd6a20';    // --accent, the same orange the mark is drawn in
  const GROUND = '#0c0c0e';    // --ink
  const LEVEL = 'H';           // the recovery budget the centre stamp spends
  const QUIET = 4;             // modules of margin the spec requires around the code

  /* The favicon, not a second drawing of it: the mark is one file and the canvas loads it. Same-origin SVG does
     not taint the canvas, so SAVE PNG still works. */
  const stamp = new Image();
  stamp.src = 'favicon.svg';

  const dlg = document.getElementById('qr-dialog');
  const canvas = document.getElementById('qr-canvas');
  if (!dlg || !canvas || !window.AKQR) return;

  /* Every trigger, not one button: the header mark and the contact button are two doors into this one dialog
     rather than two descriptions of it, sharing the drawn-once canvas and the same focus trap. */
  const openBtns = document.querySelectorAll('[data-qr-open]');
  const closeBtn = document.getElementById('qr-close');
  const saveBtn = document.getElementById('qr-save');
  let lastFocus = null;
  // An explicit flag, not canvas.width: an undrawn canvas reports the default 300, which reads as "already done".
  let drawn = false;

  /* How many modules the mark covers, and how many are cleared around it. Both odd so the block centres exactly
     on a symbol, whose size is always odd. The cleared ring is what keeps the scanner from reading a module
     that the mark has half-covered. */
  function stampSpan(size) {
    const clear = 2 * Math.round((size * 0.33 - 1) / 2) + 1;
    return { clear, mark: clear - 2 };
  }

  /* Draws the matrix at whole-pixel module size. A QR scaled to a fractional module width gets antialiased
     edges, and a soft edge is exactly what a scanner's binarisation step gets wrong. */
  function draw() {
    const { size, modules } = window.AKQR.encode(SITE_URL, LEVEL);
    const total = size + QUIET * 2;
    const css = 260;
    const scale = Math.max(1, Math.floor((css * (window.devicePixelRatio || 1)) / total));
    const px = total * scale;
    const { clear } = stampSpan(size);
    const lo = (size - clear) / 2, hi = lo + clear - 1;

    canvas.width = px;
    canvas.height = px;
    canvas.style.width = canvas.style.height = (total * Math.max(1, Math.floor(css / total))) + 'px';

    const g = canvas.getContext('2d');
    g.fillStyle = GROUND;
    g.fillRect(0, 0, px, px);
    g.fillStyle = MODULE;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (r >= lo && r <= hi && c >= lo && c <= hi) continue;
      if (modules[r][c]) g.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
    }
    drawStamp(size, scale);
  }

  // Separate from draw() because the SVG may still be loading when the dialog first opens.
  function drawStamp(size, scale) {
    if (!stamp.complete || !stamp.naturalWidth) return;
    const { mark } = stampSpan(size);
    const at = (QUIET + (size - mark) / 2) * scale;
    canvas.getContext('2d').drawImage(stamp, at, at, mark * scale, mark * scale);
  }

  function open() {
    lastFocus = document.activeElement;
    if (!drawn) { draw(); drawn = true; }
    dlg.hidden = false;
    closeBtn.focus();
    document.addEventListener('keydown', onKey);
  }

  function close() {
    dlg.hidden = true;
    document.removeEventListener('keydown', onKey);
    if (lastFocus) lastFocus.focus();
  }

  // Escape closes; Tab is kept inside the dialog so focus cannot wander onto the page behind it.
  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const stops = [closeBtn, saveBtn].filter((el) => el && !el.disabled);
    const i = stops.indexOf(document.activeElement);
    const next = e.shiftKey ? i - 1 : i + 1;
    if (next < 0 || next >= stops.length || i === -1) {
      e.preventDefault();
      stops[e.shiftKey ? stops.length - 1 : 0].focus();
    }
  }

  // Redraws whole rather than stamping in place: draw() is cheap, and it needs no scale carried between calls.
  stamp.addEventListener('load', () => { if (drawn) draw(); });

  openBtns.forEach((btn) => btn.addEventListener('click', open));
  closeBtn.addEventListener('click', close);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

  saveBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'alexk413x-qr.png';
    a.click();
  });
})();
