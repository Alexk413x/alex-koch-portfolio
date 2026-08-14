/* rpn-demo.js — binds the RPN machine to the phone, and lays out the two keyboards the morph runs between.
 *
 * ONE set of key elements, not two. Each key carries the rectangle it occupies on the HP faceplate and the
 * rectangle it occupies in the shipped app, as percentages of the pad; CSS interpolates between them from a
 * single --m scalar. Keys that exist on only one side grow out of, or shrink into, the middle.
 *
 * The keypad is real <button>s rather than styled spans, so the demo is tab-navigable and operable from the
 * keyboard for free. Typing is bound on the phone element, NOT the document: a page-wide key handler would eat
 * digits from anyone using find-in-page or the browser's own shortcuts.
 */
(function () {
  'use strict';

  const root = document.getElementById('rpn');
  if (!root || !window.AKRPN) return;

  const stack = window.AKRPN.createStack();
  const rows = root.querySelectorAll('.rpn-row');
  const pad = root.querySelector('.rpn-pad');

  const HP_COLS = 10, HP_ROWS = 4;   // the faceplate: 39 keys, ENTER double-height
  const AP_COLS = 4, AP_ROWS = 7;    // the shipped app: 28 keys

  /* [label, hp, app, kind]
   *   hp  — [row, col, rowSpan] on the faceplate, or null if the key does not exist there
   *   app — [row, col] in the app, or null
   * Shared keys travel from one rectangle to the other; the rest fade from or into the pad's centre.
   * The faceplate is transcribed from a photograph of an HP-15C: 39 keys in ten columns and four rows, with
   * ENTER double-height at row 3 column 6. */
  const KEYS = [
    // ---- shared: the arithmetic core, which is the part that actually survives the redesign ----
    ['7',     [1, 7], [4, 1], 'num'],
    ['8',     [1, 8], [4, 2], 'num'],
    ['9',     [1, 9], [4, 3], 'num'],
    ['÷',     [1, 10], [3, 4], 'op'],
    ['4',     [2, 7], [5, 1], 'num'],
    ['5',     [2, 8], [5, 2], 'num'],
    ['6',     [2, 9], [5, 3], 'num'],
    ['×',     [2, 10], [4, 4], 'op'],
    ['1',     [3, 7], [6, 1], 'num'],
    ['2',     [3, 8], [6, 2], 'num'],
    ['3',     [3, 9], [6, 3], 'num'],
    ['−',     [3, 10], [5, 4], 'op'],
    ['0',     [4, 7], [7, 1], 'num'],
    ['.',     [4, 8], [7, 2], 'num'],
    ['+',     [4, 10], [6, 4], 'op'],
    ['CHS',   [1, 6], null, 'fn'],
    ['±',     null, [7, 3], 'fn'],
    ['ENTER', [3, 6, 2], null, 'ent'],
    ['Enter', null, [7, 4], 'ent'],

    // ---- faceplate only ----
    ['√x',  [1, 1], null, 'fn'], ['eˣ',  [1, 2], null, 'fn'], ['10ˣ', [1, 3], null, 'fn'],
    ['yˣ',  [1, 4], null, 'fn'], ['1/x', [1, 5], null, 'fn'],
    ['SST', [2, 1], null, 'fn'], ['GTO', [2, 2], null, 'fn'], ['SIN', [2, 3], null, 'fn'],
    ['COS', [2, 4], null, 'fn'], ['TAN', [2, 5], null, 'fn'], ['EEX', [2, 6], null, 'fn'],
    ['R/S', [3, 1], null, 'fn'], ['GSB', [3, 2], null, 'fn'], ['R↓',  [3, 3], null, 'fn'],
    ['x≷y', [3, 4], null, 'fn'], ['←',   [3, 5], null, 'fn'],
    ['ON',  [4, 1], null, 'fn'], ['f',   [4, 2], null, 'shift-f'], ['g', [4, 3], null, 'shift-g'],
    ['STO', [4, 4], null, 'fn'], ['RCL', [4, 5], null, 'fn'], ['Σ+', [4, 9], null, 'fn'],

    // ---- app only ----
    ['CA',    null, [1, 1], 'util'], ['C',     null, [1, 2], 'util'],
    ['Del',   null, [1, 3], 'util'], ['Undo',  null, [1, 4], 'util'],
    ['M-In',  null, [2, 1], 'util'], ['M-Out', null, [2, 2], 'util'],
    ['Deg',   null, [2, 3], 'fn2'],  ['⌃',     null, [2, 4], 'util'],
    ['π',     null, [3, 1], 'fn2'],  ['%',     null, [3, 2], 'fn2'], ['!', null, [3, 3], 'fn2'],
  ];

  // What each key does. Anything absent is decoration on a faceplate that was never wired up.
  const ACTIONS = {
    '7': () => stack.digit('7'), '8': () => stack.digit('8'), '9': () => stack.digit('9'),
    '4': () => stack.digit('4'), '5': () => stack.digit('5'), '6': () => stack.digit('6'),
    '1': () => stack.digit('1'), '2': () => stack.digit('2'), '3': () => stack.digit('3'),
    '0': () => stack.digit('0'), '.': () => stack.dot(),
    '÷': () => stack.op('/'), '×': () => stack.op('*'), '−': () => stack.op('-'), '+': () => stack.op('+'),
    'Enter': () => stack.enter(), 'ENTER': () => stack.enter(),
    '±': () => stack.neg(), 'CHS': () => stack.neg(),
    'Del': () => stack.back(), 'C': () => stack.drop(), 'CA': () => stack.clear(),
  };

  /* The app's chevron key is left unwired: what it does in the shipped app is not something this page knows,
     and guessing would put a behaviour on screen that the real calculator does not have. Swapping there is a
     two-tap gesture on the stack rows rather than a key, which is why the keypad has no SWAP. */
  const KEYMAP = {
    Enter: 'Enter', ' ': 'Enter', Backspace: 'Del', Escape: 'CA', Delete: 'C',
    '/': '÷', '*': '×', '-': '−', '+': '+', '.': '.', n: '±',
  };

  // Percent rectangle for a cell in a grid, with a small inset so keys read as separate caps at any size.
  function rect(cell, cols, gridRows) {
    const [r, c, span = 1] = cell;
    return {
      x: ((c - 1) / cols) * 100, y: ((r - 1) / gridRows) * 100,
      w: (1 / cols) * 100, h: (span / gridRows) * 100,
    };
  }

  const GONE = { x: 50, y: 50, w: 0, h: 0 };

  for (const [label, hp, app, kind] of KEYS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = label;
    b.textContent = label;
    b.className = 'k k-' + kind;
    if (!ACTIONS[label]) b.tabIndex = -1;          // a dead faceplate key is not a tab stop
    if (!hp) b.classList.add('app-only');
    if (!app) b.classList.add('hp-only');

    const a = hp ? rect(hp, HP_COLS, HP_ROWS) : GONE;
    const z = app ? rect(app, AP_COLS, AP_ROWS) : GONE;
    const s = b.style;
    s.setProperty('--x0', a.x.toFixed(3)); s.setProperty('--y0', a.y.toFixed(3));
    s.setProperty('--w0', a.w.toFixed(3)); s.setProperty('--h0', a.h.toFixed(3));
    s.setProperty('--x1', z.x.toFixed(3)); s.setProperty('--y1', z.y.toFixed(3));
    s.setProperty('--w1', z.w.toFixed(3)); s.setProperty('--h1', z.h.toFixed(3));
    s.setProperty('--o0', hp ? '1' : '0');
    s.setProperty('--o1', app ? '1' : '0');
    pad.appendChild(b);
  }

  /* Rows are 4, 3, 2, 1, IN. view() returns the levels in that same top-down order, and IN carries whatever is
     being entered — or the X register when nothing is. That second half is what lets the faceplate state work:
     collapse the four level rows and the remaining line is a single-line display showing X, which is exactly
     what an HP does. */
  function render() {
    const v = stack.view();
    v.levels.forEach((lv, i) => { rows[i].querySelector('.v').textContent = lv.text; });
    const inRow = rows[rows.length - 1];
    inRow.querySelector('.v').textContent = v.x;
    inRow.classList.toggle('typing', v.typing);
    /* Marked, not blanked. Which machine is on screen decides whether an idle IN should show X or nothing, and
       that state changes on scroll rather than on a keypress — so the choice is left to CSS, which re-evaluates
       on its own instead of needing the morph to call back into here. */
    inRow.classList.toggle('idle', !v.typing);
  }

  /* The morph parks pointer-events on the pad until the calculator reaches its shipped state. That stops a
     mouse but NOT a keyboard: a focused button still activates on Enter, and a synthetic click ignores
     pointer-events entirely. Reading the same property here gates every path from one source of truth. */
  const interactive = () => getComputedStyle(pad).pointerEvents !== 'none';

  function press(label) {
    if (!interactive() || !ACTIONS[label]) return;
    ACTIONS[label]();
    render();
    const btn = pad.querySelector('[data-key="' + label + '"]');
    if (!btn) return;
    btn.classList.add('hit');
    setTimeout(() => btn.classList.remove('hit'), 120);
  }

  pad.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) press(b.dataset.key);
  });

  root.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const label = /^[0-9]$/.test(e.key) ? e.key : KEYMAP[e.key];
    if (!label) return;
    // Space and Enter would otherwise also activate the focused key cap, firing the action twice.
    e.preventDefault();
    press(label);
  });

  render();
})();
