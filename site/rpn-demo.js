/* rpn-demo.js — binds the RPN machine to the phone on the home page.
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
  const xOut = root.querySelector('.rpn-x');
  const levelOut = root.querySelectorAll('.rpn-level');
  const pad = root.querySelector('.rpn-pad');

  // Label -> what it does. The label is also what the key cap reads, so the two cannot drift apart.
  const KEYS = [
    ['ENT', () => stack.enter()], ['SWP', () => stack.swap()], ['DRP', () => stack.drop()], ['÷', () => stack.op('/')],
    ['7', () => stack.digit('7')], ['8', () => stack.digit('8')], ['9', () => stack.digit('9')], ['×', () => stack.op('*')],
    ['4', () => stack.digit('4')], ['5', () => stack.digit('5')], ['6', () => stack.digit('6')], ['−', () => stack.op('-')],
    ['1', () => stack.digit('1')], ['2', () => stack.digit('2')], ['3', () => stack.digit('3')], ['+', () => stack.op('+')],
    ['0', () => stack.digit('0')], ['.', () => stack.dot()], ['±', () => stack.neg()], ['C', () => stack.clear()],
  ];

  const KEYMAP = {
    Enter: 'ENT', ' ': 'ENT', Backspace: 'DRP', Escape: 'C', Delete: 'C',
    '/': '÷', '*': '×', '-': '−', '+': '+', '.': '.', s: 'SWP', n: '±',
  };

  function render() {
    const v = stack.view();
    xOut.textContent = v.x;
    xOut.classList.toggle('typing', v.typing);
    v.levels.forEach((lv, i) => {
      levelOut[i].querySelector('.n').textContent = lv.label + ':';
      levelOut[i].querySelector('.v').textContent = lv.text;
    });
  }

  /* The morph parks pointer-events on the pad until the calculator reaches its shipped state. That stops a
     mouse but NOT a keyboard: a focused button still activates on Enter, and a synthetic click ignores
     pointer-events entirely. Reading the same property here gates every path from one source of truth. */
  const interactive = () => getComputedStyle(pad).pointerEvents !== 'none';

  // Flashes the cap that just fired, so a keyboard press is as visible as a click.
  function press(label) {
    if (!interactive()) return;
    const key = KEYS.find((k) => k[0] === label);
    if (!key) return;
    key[1]();
    render();
    const btn = pad.querySelector('[data-key="' + label + '"]');
    if (!btn) return;
    btn.classList.add('hit');
    setTimeout(() => btn.classList.remove('hit'), 120);
  }

  for (const [label] of KEYS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.key = label;
    b.textContent = label;
    if ('÷×−+'.includes(label)) b.className = 'op';
    else if (label === 'ENT') b.className = 'ent';
    pad.appendChild(b);
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
