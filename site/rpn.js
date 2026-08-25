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
    let mem = 0;           // the single memory register behind STO/RCL and M-In/M-Out
    let degrees = true;    // trig unit; the app ships showing Deg
    const past = [];       // undo history, whole snapshots
    const PAST_MAX = 200;

    /* Undo keeps whole snapshots rather than inverse operations. Inverting is where undo goes wrong: some of
       these are lossy (drop, clear, a binary op consuming both operands) and cannot be run backwards at all. */
    function mark() {
      past.push({ cells: cells.slice(), entry, mem, degrees });
      if (past.length > PAST_MAX) past.shift();
    }

    const rad = (x) => (degrees ? (x * Math.PI) / 180 : x);

    // Integer factorial only, and only where the result is representable; 171! is already Infinity.
    function factorial(n) {
      if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
      let r = 1;
      for (let i = 2; i <= n; i++) r *= i;
      return r;
    }

    const UNARY = {
      sqrt: Math.sqrt,
      inv: (x) => 1 / x,
      exp: Math.exp,
      exp10: (x) => Math.pow(10, x),
      sin: (x) => Math.sin(rad(x)),
      cos: (x) => Math.cos(rad(x)),
      tan: (x) => Math.tan(rad(x)),
      fact: factorial,
    };

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
        mark();
        if (entry === null) entry = '';
        if (entry === '0' && c !== '.') entry = '';
        entry += c;
        return api;
      },

      dot() {
        mark();
        if (entry === null) entry = '0';
        if (!entry.includes('.')) entry += '.';
        return api;
      },

      // Negates whatever is currently showing: the entry while typing, X otherwise.
      neg() {
        mark();
        if (entry !== null) entry = entry.startsWith('-') ? entry.slice(1) : '-' + entry;
        else if (cells.length) cells[cells.length - 1] = -top();
        return api;
      },

      back() {
        mark();
        if (entry === null) return api;
        entry = entry.slice(0, -1);
        if (entry === '' || entry === '-') entry = null;
        return api;
      },

      enter() {
        mark();
        commit();
        return api;
      },

      // Cancels a half-typed number if there is one; otherwise discards X.
      drop() {
        mark();
        if (entry !== null) entry = null;
        else cells.pop();
        return api;
      },

      swap() {
        mark();
        commit();
        if (cells.length >= 2) {
          const n = cells.length;
          [cells[n - 1], cells[n - 2]] = [cells[n - 2], cells[n - 1]];
        }
        return api;
      },

      clear() {
        mark();
        cells = [];
        entry = null;
        return api;
      },

      /* Binary operators take the IN line as the right-hand operand when one is being typed, then consume Y and
         X. With fewer than two values there is nothing to operate on, so the press is ignored rather than
         inventing a zero operand. */
      op(sym) {
        mark();
        commit();
        if (cells.length < 2) return api;
        const b = cells.pop(), a = cells.pop();
        cells.push(sym === '+' ? a + b : sym === '-' ? a - b : sym === '*' ? a * b : a / b);
        return api;
      },

      /* Unary functions consume X and push the result. Anything undefined -- a negative square root, 1/0, a
         factorial of 2.5 -- lands as NaN or Infinity and formats as ERROR rather than being hidden. */
      unary(name) {
        mark();
        commit();
        if (!cells.length || !UNARY[name]) return api;
        cells.push(UNARY[name](cells.pop()));
        return api;
      },

      // y to the power of x, consuming both.
      pow() {
        mark();
        commit();
        if (cells.length < 2) return api;
        const b = cells.pop(), a = cells.pop();
        cells.push(Math.pow(a, b));
        return api;
      },

      // Roll down: X goes to the bottom and everything else moves up one.
      roll() {
        mark();
        commit();
        if (cells.length >= 2) cells.unshift(cells.pop());
        return api;
      },

      push(v) {
        mark();
        commit();
        cells.push(v);
        return api;
      },

      sto() { mark(); commit(); if (cells.length) mem = cells[cells.length - 1]; return api; },
      rcl() { mark(); commit(); cells.push(mem); return api; },

      toggleDeg() { mark(); degrees = !degrees; return api; },
      isDeg: () => degrees,

      /* Makes the CURRENT state the floor: everything before it stops being reachable by undo.
         For a calculator that opens with values already on it, the seed is where the reader started, and undo
         walking back past it unwinds into a state they never saw. Called once, immediately after seeding. */
      forget() {
        past.length = 0;
        return api;
      },

      /* Restores the last snapshot. Nothing to restore is a no-op rather than an error: pressing undo on a
         fresh calculator should do nothing, not complain. */
      undo() {
        const prev = past.pop();
        if (!prev) return api;
        cells = prev.cells;
        entry = prev.entry;
        mem = prev.mem;
        degrees = prev.degrees;
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
