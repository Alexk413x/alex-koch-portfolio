# The stack machine and the keys wired to it.
#
# The arithmetic runs against a fresh machine built in the page, so a failure here is about the maths and not
# about layout. The keypad cases go through the real buttons afterwards, because a correct machine nobody can
# reach is still a broken section.
import json

NAME = 'rpn'

# Tokens: ENT enter, CA clear, SWP swap, DRP drop, NEG negate, and any bare digit or operator.
CASES = [
    (['2', 'ENT', '3', '+'], '5', 'add'),
    (['5', 'ENT', '3', '-'], '2', 'subtract'),
    (['6', 'ENT', '7', '*'], '42', 'multiply'),
    (['1', '0', 'ENT', '4', '/'], '2.5', 'divide'),
    (['1', 'ENT', '2', 'ENT', '3', '+', '+'], '6', 'chained adds'),
    # ENTER pushes ONE value on this calculator: it has a separate IN line, so there is no stack lift to
    # duplicate X. Squaring needs both operands entered.
    (['5', 'ENT', '*'], '5', 'operator with one operand is ignored'),
    (['5', 'ENT', '5', 'ENT', '*'], '25', 'square needs two entries'),
    (['2', 'ENT', '3', 'SWP', '-'], '1', 'swap then subtract'),
    (['1', 'ENT', '0', '/'], 'ERROR', 'divide by zero is ERROR, not Infinity'),
    (['5', 'NEG'], '-5', 'negate the entry'),
    (['7', 'ENT', '8', 'DRP'], '7', 'drop cancels a half-typed number'),
    (['9', 'ENT', '9', '+', 'CA'], '0', 'clear'),
    (['1', '.', '5', 'ENT', '2', '*'], '3', 'decimal entry'),
    (['2', 'ENT', '3', 'ENT', '4', '*', '+'], '14', 'operator precedence is the stack'),
    (['9', 'sqrt'], '3', 'square root'),
    (['4', 'inv'], '0.25', 'reciprocal'),
    (['2', 'ENT', '1', '0', 'pow'], '1024', 'y to the x'),
    (['1', 'exp10'], '10', 'ten to the x'),
    (['0', 'exp'], '1', 'e to the x'),
    (['9', '0', 'sin'], '1', 'sin in degrees'),
    (['deg', '0', 'sin'], '0', 'sin after switching to radians'),
    (['5', 'fact'], '120', 'factorial'),
    (['2', '.', '5', 'fact'], 'ERROR', 'factorial of a non-integer is ERROR'),
    (['7', 'sto', 'CA', 'rcl'], '7', 'memory survives a clear'),
    (['1', 'ENT', '2', 'ENT', '3', 'roll'], '2', 'roll down: [1,2,3] becomes [3,1,2]'),
    (['8', 'ENT', '2', '+', 'undo', 'undo'], '8', 'undo twice'),
    (['6', 'ENT', '7', '*', 'undo'], '7', 'undo a binary operator'),
]

RUN = """
(() => {
  const s = window.AKRPN.createStack();
  for (const t of %s) {
    if (t === 'ENT') s.enter();
    else if (t === 'CA') s.clear();
    else if (t === 'SWP') s.swap();
    else if (t === 'DRP') s.drop();
    else if (t === 'NEG') s.neg();
    else if (t === 'pow') s.pow();
    else if (t === 'roll') s.roll();
    else if (t === 'sto') s.sto();
    else if (t === 'rcl') s.rcl();
    else if (t === 'undo') s.undo();
    else if (t === 'deg') s.toggleDeg();
    else if (t === '.') s.dot();
    else if ('+-*/'.includes(t)) s.op(t);
    else if (/^[0-9]$/.test(t)) s.digit(t);
    else s.unary(t);
  }
  return s.view().x;
})()
"""

LEVEL_1 = "[...document.querySelectorAll('#rpn .rpn-row')][3].querySelector('.v').textContent"
IN_LINE = "document.querySelector('#rpn .rpn-in .v').textContent"


def run(page, r):
    page.goto('index.html')
    r.ok('machine is loaded', page.js('typeof window.AKRPN') == 'object')

    for keys, want, label in CASES:
        r.check(label, str(page.js(RUN % json.dumps(keys))), want)

    # The stack must return to EMPTY, not to a zero sitting under every result.
    empty = page.json("(()=>{const s=window.AKRPN.createStack();"
                      "s.digit('2');s.enter();s.digit('3');s.op('+');"
                      "return JSON.stringify(s.view().levels.map(l=>l.text))})()")
    r.check('one result leaves one value on the stack', [x for x in empty if x], ['5'])

    # THE DEMO OPENS WITH A STACK ON IT, and undo must not walk back past that. The seed is where the reader
    # arrived, not somewhere they got to; without forget() the history holds the eight presses that built it and
    # undo unwinds into an empty calculator nobody ever saw.
    seeded = page.json("(()=>{const s=window.AKRPN.createStack();"
                       "['1','2'].forEach(d=>s.digit(d));s.dot();s.digit('5');s.enter();"
                       "['3','8','2'].forEach(d=>{s.digit(d);s.enter()});s.forget();"
                       "for(let i=0;i<10;i++)s.undo();"
                       "return JSON.stringify(s.view().levels.map(l=>l.text))})()")
    r.check('a sealed stack survives ten undos', seeded, ['12.5', '3', '8', '2'])

    # Now through the real keypad, from the end of the morph where the app is assembled and live. The morph runs
    # on its own clock rather than tracking the scroll, so the wait here is the animation's, not the browser's.
    pin = page.pin('app-scroll', 'app-stage')
    page.scroll(pin['top'] + pin['run'], pause=1.3)
    page.js("document.querySelector('#rpn .rpn-pad [data-key=\\\"CA\\\"]').click();1")
    for key in ('1', '2', 'Enter', '3', '+'):
        page.js("document.querySelector('#rpn .rpn-pad [data-key=%s]').click();1" % json.dumps(key))
    r.check('keypad: 12 ENTER 3 +', page.js(LEVEL_1), '15')

    page.js("document.querySelector('#rpn .rpn-pad [data-key=\\\"CA\\\"]').click();1")
    for key in ('1', '2'):
        page.js("document.querySelector('#rpn .rpn-pad [data-key=%s]').click();1" % json.dumps(key))
    r.check('a half-typed number stays on IN', page.js(IN_LINE), '12')
    r.check('...and not on the stack', page.js(LEVEL_1), '')
