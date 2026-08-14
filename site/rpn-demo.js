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
    ['1/x',   [1, 5], [3, 2], 'fn2'],
    ['CHS',   [1, 6], null, 'fn'],
    ['±',     null, [7, 3], 'fn'],
    ['ENTER', [3, 6, 2], null, 'ent'],
    ['Enter', null, [7, 4], 'ent'],

    // ---- faceplate only ----
    ['√x',  [1, 1], null, 'fn'], ['eˣ',  [1, 2], null, 'fn'], ['10ˣ', [1, 3], null, 'fn'],
    ['yˣ',  [1, 4], null, 'fn'],
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
    ['π',     null, [3, 1], 'fn2'],  ['!',     null, [3, 3], 'fn2'],
  ];

  /* What each key does. BOTH keyboards are wired where the key means something arithmetically; the ones left
     out are programming and mode keys -- SST, GTO, GSB, R/S, ON, f, g, EEX, Sigma-plus -- which have no meaning
     without a program store, and the app's chevron, whose real behaviour this page does not know. An inert key
     is better than a key that does something the real calculator does not. */
  const ACTIONS = {
    '7': () => stack.digit('7'), '8': () => stack.digit('8'), '9': () => stack.digit('9'),
    '4': () => stack.digit('4'), '5': () => stack.digit('5'), '6': () => stack.digit('6'),
    '1': () => stack.digit('1'), '2': () => stack.digit('2'), '3': () => stack.digit('3'),
    '0': () => stack.digit('0'), '.': () => stack.dot(),

    '÷': () => stack.op('/'), '×': () => stack.op('*'), '−': () => stack.op('-'), '+': () => stack.op('+'),
    'Enter': () => stack.enter(), 'ENTER': () => stack.enter(),

    // Same operation, different faceplate.
    '±': () => stack.neg(),      'CHS': () => stack.neg(),
    'Del': () => stack.back(),   '←': () => stack.back(),
    'M-In': () => stack.sto(),   'STO': () => stack.sto(),
    'M-Out': () => stack.rcl(),  'RCL': () => stack.rcl(),
    '1/x': () => stack.unary('inv'),

    'C': () => stack.drop(), 'CA': () => stack.clear(), 'Undo': () => stack.undo(),
    'π': () => stack.push(Math.PI), '!': () => stack.unary('fact'),
    'Deg': () => stack.toggleDeg(),

    '√x': () => stack.unary('sqrt'), 'eˣ': () => stack.unary('exp'), '10ˣ': () => stack.unary('exp10'),
    'yˣ': () => stack.pow(),
    'SIN': () => stack.unary('sin'), 'COS': () => stack.unary('cos'), 'TAN': () => stack.unary('tan'),
    'R↓': () => stack.roll(), 'x≷y': () => stack.swap(),
  };

  const KEYMAP = {
    Enter: 'Enter', ' ': 'Enter', Backspace: 'Del', Escape: 'CA', Delete: 'C',
    '/': '÷', '*': '×', '-': '−', '+': '+', '.': '.', n: '±',
    u: 'Undo', p: 'π', r: '1/x', '^': 'yˣ', '!': '!', c: 'CA',
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

  /* WHEN each key moves, which is the difference between a mechanism and a crossfade. Three beats:
   *   the faceplate strips itself, outermost columns first, because the edge of a panel is what lets go first;
   *   the arithmetic core — the keys both machines share — migrates across;
   *   the app's own keys unfold last, top row down.
   * Every key's start plus its span stays under 1, or it would still be moving when the scrub ends. */
  function timing(hp, app) {
    let d, span;
    if (hp && !app) {
      const fromCentre = Math.abs(hp[1] - 5.5) / 4.5;          // 1 at the outer columns, 0 in the middle
      d = 0.20 * (1 - fromCentre); span = 0.40;
    } else if (!hp && app) {
      // Ranked, not raw row: the app-only keys sit in rows 1-3 and row 7, and using the row number directly
      // gave the row-7 pair a start of 0.73 — past the point where a 0.42 span can still finish.
      d = 0.40 + 0.05 * (Math.min(app[0], 4) - 1); span = 0.42;
    } else {
      d = 0.17 + 0.02 * ((app ? app[0] : 1) - 1); span = 0.46;
    }
    /* A key that has not finished by the end of the scrub never reaches its resting rectangle, and sits
       stranded mid-flight in what is supposed to be a still state. Clamping here means a later change to any
       of the formulas above cannot reintroduce that. */
    return { d: Math.min(d, 1 - span), span };
  }

  // A fixed per-key yaw and tilt so the keyboard does not swing as one sheet. Derived from the position, not
  // random, so the motion is identical on every load and a screenshot comparison stays meaningful.
  function twist(i, hp, app) {
    const seed = (hp ? hp[0] * 7 + hp[1] * 13 : app[0] * 11 + app[1] * 5) + i;
    return { spin: ((seed % 7) - 3) * 9, tilt: ((seed % 5) - 2) * 3.5 };
  }

  /* EVERY KEY IS LAID OUT ONCE, AT ITS HOME RECTANGLE, AND MOVES ONLY BY TRANSFORM.
   *
   * Interpolating left/top/width/height instead made the browser lay out fifty-one keys on every frame of the
   * scrub: measured at a 31.85ms mean and a 66.7ms worst frame, which is half the frame budget gone to work
   * that never had to happen. Translate and scale are composited, so the same motion costs no layout at all.
   *
   * The offsets are ratios of the key's own box, which is why they survive the pad resizing underneath them:
   * left is a percentage of pad width and the key's width is too, so their quotient is constant. */
  KEYS.forEach(([label, hp, app, kind], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = label;
    b.textContent = label;
    b.className = 'k k-' + kind;
    if (!ACTIONS[label]) b.tabIndex = -1;          // a dead faceplate key is not a tab stop
    if (!hp) b.classList.add('app-only');
    if (!app) b.classList.add('hp-only');

    const hpR = hp ? rect(hp, HP_COLS, HP_ROWS) : null;
    const apR = app ? rect(app, AP_COLS, AP_ROWS) : null;
    const home = apR || hpR;

    // Centre-relative, so a rotation pivots where a plate would and the scale lands the box on its target.
    const toward = (target) => {
      const cx = home.x + home.w / 2, cy = home.y + home.h / 2;
      if (!target) return { tx: ((50 - cx) / home.w) * 100, ty: ((50 - cy) / home.h) * 100, sx: 0, sy: 0 };
      return {
        tx: ((target.x + target.w / 2 - cx) / home.w) * 100,
        ty: ((target.y + target.h / 2 - cy) / home.h) * 100,
        sx: target.w / home.w,
        sy: target.h / home.h,
      };
    };

    const a = toward(hpR), z = toward(apR);
    const s = b.style;
    s.left = home.x.toFixed(3) + '%';
    s.top = home.y.toFixed(3) + '%';
    s.width = home.w.toFixed(3) + '%';
    s.height = home.h.toFixed(3) + '%';
    // The label rides the plate's own scale, so the type size needs no animating either.
    s.fontSize = (apR ? 14 : 9.5) + 'px';

    for (const [k, v] of [['--tx0', a.tx], ['--ty0', a.ty], ['--sx0', a.sx], ['--sy0', a.sy],
                          ['--tx1', z.tx], ['--ty1', z.ty], ['--sx1', z.sx], ['--sy1', z.sy]]) {
      s.setProperty(k, v.toFixed(4));
    }
    s.setProperty('--o0', hp ? '1' : '0');
    s.setProperty('--o1', app ? '1' : '0');

    const { d, span } = timing(hp, app);
    const { spin, tilt } = twist(i, hp, app);
    s.setProperty('--d', d.toFixed(4));
    s.setProperty('--rate', (1 / span).toFixed(4));
    s.setProperty('--spin', String(spin));
    s.setProperty('--tilt', String(tilt));
    pad.appendChild(b);
  });

  /* The display plates deploy after the keypad has finished assembling, building upward from the IN line, so the
     readout is the last thing to come together rather than the first. */
  rows.forEach((row, i) => {
    if (row.classList.contains('rpn-in')) return;
    row.style.setProperty('--d', (0.62 - i * 0.055).toFixed(4));
    row.style.setProperty('--rate', (1 / 0.30).toFixed(4));
  });

  /* Rows are 4, 3, 2, 1, IN. view() returns the levels in that same top-down order, and IN carries whatever is
     being entered — or the X register when nothing is. That second half is what lets the faceplate state work:
     collapse the four level rows and the remaining line is a single-line display showing X, which is exactly
     what an HP does. */
  function render() {
    const v = stack.view();
    v.levels.forEach((lv, i) => { rows[i].querySelector('.v').textContent = lv.text; });
    // The unit key states the CURRENT mode, so its cap is part of the readout rather than a fixed label.
    const deg = pad.querySelector('[data-key="Deg"]');
    if (deg) deg.textContent = stack.isDeg() ? 'Deg' : 'Rad';

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
