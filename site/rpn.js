/* rpn.js — a reverse-Polish stack machine.
 *
 * Pure: it owns a stack and a digit-entry buffer and nothing else. No DOM, no rendering, no key codes — the
 * demo wires input to these methods and reads back a plain snapshot. That split is what lets the arithmetic be
 * tested without a browser, which matters because the whole point of the section is that the stack never lies.
 */
(function () {
  'use strict';

  const DEPTH = 4;   // levels the readout shows; the stack itself is not capped

  /* Formats a value the way the readout wants it: plain digits where it can, exponent only when the number is
     genuinely too large or small to write out, and ERROR rather than Infinity or NaN. */
  function format(v) {
    if (!Number.isFinite(v)) return 'ERROR';
    if (v === 0) return '0';
    const mag = Math.abs(v);
    if (mag >= 1e12 || mag < 1e-6) return v.toExponential(4).replace('e+', 'e');
    return String(Number(v.toPrecision(12)));
  }

  function createStack() {
    let cells = [];        // bottom .. top; the last element is X. EMPTY is a real state, not zero.
    let entry = null;      // digits being typed on the IN line, or null when nothing is being entered

    const top = () => (cells.length ? cells[cells.length - 1] : 0);

    /* Moves the IN line onto the stack. ONE value, never two.
     *
     * A classic HP has no separate entry line: X is both the display and the top of the stack, so ENTER has to
     * copy X up and disable stack lift to leave you two operands. This calculator has an IN line, so the entry
     * is already distinct from the stack and ENTER simply pushes it. Carrying the HP's lift semantics over put
     * two numbers on the stack for one keypress, and `5 ENTER x` squaring a number is a side effect of that
     * older design rather than something to reproduce here. */
    function commit() {
      if (entry === null) return;
      const v = parseFloat(entry);
      cells.push(Number.isFinite(v) ? v : 0);
      entry = null;
    }

    const api = {
      digit(c) {
        if (entry === null) entry = '';
        if (entry === '0' && c !== '.') entry = '';
        entry += c;
        return api;
      },

      dot() {
        if (entry === null) entry = '0';
        if (!entry.includes('.')) entry += '.';
        return api;
      },

      // Negates whatever is currently showing: the entry while typing, X otherwise.
      neg() {
        if (entry !== null) entry = entry.startsWith('-') ? entry.slice(1) : '-' + entry;
        else if (cells.length) cells[cells.length - 1] = -top();
        return api;
      },

      back() {
        if (entry === null) return api;
        entry = entry.slice(0, -1);
        if (entry === '' || entry === '-') entry = null;
        return api;
      },

      enter() {
        commit();
        return api;
      },

      // Cancels a half-typed number if there is one; otherwise discards X.
      drop() {
        if (entry !== null) entry = null;
        else cells.pop();
        return api;
      },

      swap() {
        commit();
        if (cells.length >= 2) {
          const n = cells.length;
          [cells[n - 1], cells[n - 2]] = [cells[n - 2], cells[n - 1]];
        }
        return api;
      },

      clear() {
        cells = [];
        entry = null;
        return api;
      },

      /* Binary operators take the IN line as the right-hand operand when one is being typed, then consume Y and
         X. With fewer than two values there is nothing to operate on, so the press is ignored rather than
         inventing a zero operand. */
      op(sym) {
        commit();
        if (cells.length < 2) return api;
        const b = cells.pop(), a = cells.pop();
        cells.push(sym === '+' ? a + b : sym === '-' ? a - b : sym === '*' ? a * b : a / b);
        return api;
      },

      /* A snapshot for rendering. Levels run 4, 3, 2, 1 down the readout and show the STACK ONLY — a half-typed
         number lives on IN until something commits it, which is what the app does: level 1 reads 5 while IN
         reads 26. `x` is the IN line's content: the entry while typing, X otherwise, which is also what the
         faceplate's single-line display needs. */
      view() {
        const n = cells.length;
        const levels = [];
        for (let i = DEPTH; i >= 1; i--) {
          const v = cells[n - i];
          levels.push({ label: i, text: v === undefined ? '' : format(v) });
        }
        return { x: entry !== null ? entry : format(top()), levels, typing: entry !== null, depth: n };
      },
    };

    return api;
  }

  window.AKRPN = { createStack, format };
})();
