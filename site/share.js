/* share.js — the share dialog: a scannable QR code for the site, drawn in the page from qr.js.
 *
 * Dark modules on cream, NOT the brand orange on near-black. An inverted or low-contrast code is the one design
 * flourish that can stop a scanner resolving it at all, and a QR that does not scan is decoration. Both colours
 * are still design-system values, so it reads as part of the site rather than a pasted-in widget.
 */
(function () {
  'use strict';

  // The www host, deliberately: the apex alexk413x.com does not resolve, so a code encoding it scans to nothing.
  const SITE_URL = 'https://www.alexk413x.com';
  const DARK = '#341706';      // --orange-950
  const LIGHT = '#fff4ec';     // --orange-100
  const QUIET = 4;             // modules of margin the spec requires around the code

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

  /* Draws the matrix at whole-pixel module size. A QR scaled to a fractional module width gets antialiased
     edges, and a soft edge is exactly what a scanner's binarisation step gets wrong. */
  function draw() {
    const { size, modules } = window.AKQR.encode(SITE_URL);
    const total = size + QUIET * 2;
    const css = 260;
    const scale = Math.max(1, Math.floor((css * (window.devicePixelRatio || 1)) / total));
    const px = total * scale;

    canvas.width = px;
    canvas.height = px;
    canvas.style.width = canvas.style.height = (total * Math.max(1, Math.floor(css / total))) + 'px';

    const g = canvas.getContext('2d');
    g.fillStyle = LIGHT;
    g.fillRect(0, 0, px, px);
    g.fillStyle = DARK;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (modules[r][c]) g.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
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
