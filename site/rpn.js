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
    let cells = [0];       // bottom .. top; the last element is X, and X always exists
    let entry = null;      // digits being typed, or null when the stack is what is showing
    let lift = true;       // does the next committed number push a level, or overwrite X?

    const top = () => cells[cells.length - 1];

    /* Moves a half-typed number onto the stack, honouring stack lift. LIFT IS THE WHOLE MACHINE: ENTER copies X
       up and clears this flag, so the number typed next lands ON X instead of above it. Without it
       `1 ENTER 2 ENTER 3 + +` totals 7 rather than 6, because every ENTER leaves a duplicate nothing consumes. */
    function commit() {
      if (entry === null) return;
      const v = parseFloat(entry);
      const n = Number.isFinite(v) ? v : 0;
      if (lift) cells.push(n);
      else cells[cells.length - 1] = n;
      entry = null;
      lift = true;
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

      // Negates whatever is currently showing, which is the entry while typing and X otherwise.
      neg() {
        if (entry !== null) entry = entry.startsWith('-') ? entry.slice(1) : '-' + entry;
        else cells[cells.length - 1] = -top();
        return api;
      },

      back() {
        if (entry === null) return api;
        entry = entry.slice(0, -1);
        if (entry === '' || entry === '-') entry = null;
        return api;
      },

      // Commits any entry, then copies X up a level and disables lift, so the next number typed replaces X.
      enter() {
        commit();
        cells.push(top());
        lift = false;
        return api;
      },

      // Cancels a half-typed number if there is one; otherwise discards X. X always survives.
      drop() {
        if (entry !== null) entry = null;
        else if (cells.length > 1) cells.pop();
        else cells[0] = 0;
        lift = true;
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
        cells = [0];
        entry = null;
        lift = true;
        return api;
      },

      /* Binary operators consume Y and X and push the result. With fewer than two values there is nothing to
         operate on, so the press is ignored rather than inventing a zero operand. */
      op(sym) {
        commit();
        if (cells.length < 2) return api;
        const b = cells.pop(), a = cells.pop();
        cells.push(sym === '+' ? a + b : sym === '-' ? a - b : sym === '*' ? a * b : a / b);
        return api;
      },

      /* A snapshot for rendering: `x` is what the big line shows, `levels` are the lines above it, deepest
         first, and `typing` lets the caller show a caret only while a number is being entered.
         The readout has to show where a half-typed number WOULD land, so the entry is projected onto the stack
         the same way commit() will place it — pushed when lift is on, over X when it is off. */
      view() {
        const eff = entry === null ? cells
          : (lift ? cells.concat([entry]) : cells.slice(0, -1).concat([entry]));
        const n = eff.length;
        // Levels run 4, 3, 2, 1 from the top of the readout down, matching the app: level 1 is the top of stack.
        const levels = [];
        for (let i = DEPTH; i >= 1; i--) {
          const v = eff[n - i];
          levels.push({ label: i, text: v === undefined ? '' : format(v) });
        }
        return { x: entry !== null ? entry : format(top()), levels, typing: entry !== null, depth: n };
      },
    };

    return api;
  }

  window.AKRPN = { createStack, format };
})();
