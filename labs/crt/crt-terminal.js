/* crt/crt-terminal.js — the boot text and the typewriter.
 *
 * The boot LINES are content; the typewriter is a self-contained engine that owns its own timers. It touches only the
 * container element it is handed, which is the whole reason it can live outside the DC: it needs no state, no layout and
 * no knowledge of the tube around it.
 *
 * The DC keeps the DOM: it supplies the container, the phosphor colours, and a `push` for its own timer bookkeeping.
 */

import { hexRgb, mix } from './crt-phosphor.js';

/* The boot sequence: a masthead, four status rows as a two-column table, and a prompt.
 *
 * The four table rows carry a label, a dot leader, and a value, and the leader is COMPUTED so all four values start in the
 * same column. It used to be hand-typed: one row carried 33 dots, another three, two had none at all, and the values landed
 * wherever the label happened to end. Hand-aligned columns only stay aligned until someone edits a label.
 *
 * THE LEADER IS BUDGETED AGAINST THE WRAP WIDTH, not just against the labels, and that omission is what made the first
 * version of this useless. Sized from label lengths alone the column was arithmetically perfect and invisible: every value
 * sat at column 40 of a 39-column frame, so all four wrapped and landed alone on the next row -- a second column that
 * existed only in the string. The alignment was verified by simulating the string and never by counting rendered rows.
 *
 * `cols` is the caller's character budget. The column is placed as far right as the labels want OR as far left as the
 * longest value needs, whichever is tighter, with MIN dots as the floor. If a row still cannot fit, the frame is genuinely
 * too narrow and it wraps -- but that is now the width's fault rather than this function's.
 *
 * The content is also kept short enough to fit the DEFAULT width: 'power-on self test' became 'self test', 'loading kernel'
 * became 'kernel', 'mounting' became 'mount'. Those were my words; the module list and the clearance wording are the user's
 * and are untouched. GRANTED was dropped from the operator row because a 7-character value moves the column left for all
 * four rows, and at 39 columns it cost more than it said.
 *
 * Segments exist so one row can carry both the dim prompt colour and the bright result; `hi` picks the bright one.
 */
export function bootLines(ph, cols) {
  const MIN = 3;
  /* THE MASTHEAD AND THE PROMPT ARE NOT TABLE ROWS. A row with no `v` gets no leader and no value -- the first line is a
   * machine identity and the last is an instruction, and neither has a result to report. Giving them dot leaders lined them
   * up with the self-test rows and made the boot read as six status checks, two of which were lying about being checks.
   * The phosphor NAME is deliberately not in the masthead: it restated a control the panel already shows, and its length
   * changed whenever the phosphor did, which is the one thing a fixed column cannot tolerate. */
  const rows = [
    { l: [{ t: 'ALEXK413X TERMINAL  ·  CRT-9000' }] },
    { l: [{ t: '> start up self test ' }, { t: 'LLM', hi: 1 }], v: [{ t: 'PASS', hi: 1 }] },
    { l: [{ t: '> kernel /agentic/os ' }, { t: 'v4.13', hi: 1 }], v: [{ t: 'OK', hi: 1 }] },
    { l: [{ t: '> mount [about skill work app]' }], v: [{ t: 'OK', hi: 1 }] },
    { l: [{ t: '> operator ' }, { t: 'ALEX KOCH', hi: 1 }, { t: ' clearance' }], v: [{ t: '413X', hi: 1 }] },
    { l: [{ t: '> press ' }, { t: 'ENTER', hi: 1 }, { t: ' to continue...' }] },
  ];
  const len = (segs) => segs.reduce((a, s) => a + s.t.length, 0);
  const table = rows.filter((r) => r.v);
  // Measured across the TABLE rows only. Including the masthead would pad every leader out to a label that is not in the
  // column, which is how the alignment would end up serving a row that does not use it.
  const maxLabel = Math.max.apply(null, table.map((r) => len(r.l)));
  const maxValue = Math.max.apply(null, table.map((r) => len(r.v)));
  const budget = (cols > 0 ? cols : 999) - 1 - maxValue;   // 1 = the single space before the value
  // As far right as the labels want, or as far left as the budget forces, whichever is tighter -- never below MIN dots.
  const col = Math.min(maxLabel + MIN, Math.max(MIN, budget));
  /* THE DIM COLOUR, DERIVED ONLY WHEN IT HAS TO BE.
   *
   * The two-tone is normally fg for the label and hi for the value -- amber's #f0a24a against a pale cream, green's the same
   * shape. WHITE cannot work that way: hi is #ffffff and there is nothing brighter to promote a highlight to, so pure white
   * on both sides flattens the label and the value into one colour.
   *
   * The contrast has to come from BELOW white, and the question is where to spend it. Not on ph.fg: that value is the
   * phosphor's identity everywhere else -- crt-bezel runs hexRgb() on it for the frame tint, the panel's swatch takes it as
   * an <input type="color"> value, and the calibration grid inks with it. Dimming it there would make a white phosphor
   * render grey, which is the thing that was just fixed.
   *
   * So it is spent HERE, on the boot text's label only, and only when fg and hi are the same colour. Amber and green take the
   * untouched fg exactly as before; white gets a 26%-toward-black label against a pure-white value. One targeted rule rather
   * than a palette-wide inversion, so no phosphor changes that did not have a problem.
   */
  /* COMPARED AS PARSED COLOURS, NOT AS STRINGS, and that distinction is the whole bug this replaces.
   *
   * resolvePhosphor returns fg as a hex and hi as an rgb() string -- mix() gives a triple and it is joined -- so on the CUSTOM
   * path a pure white arrives as fg '#ffffff' and hi 'rgb(255,255,255)'. A string compare calls those different, the dim rule
   * never fired, and the label stayed pure white. It worked only on the named `white` preset, where both fields happen to be
   * the literal '#ffffff'. Same custom-vs-preset trap that phActive already had to solve one module over.
   *
   * A TOLERANCE rather than equality, because the point is "is there room to brighten", not "are these identical". A custom
   * #fdfdfd has no usable headroom either, and demanding an exact match would leave it flat for the same reason while
   * reporting that everything was fine.
   */
  const fgRgb = hexRgb(ph.fg), hiRgb = hexRgb(ph.hi || ph.fg);
  const spread = Math.max(Math.abs(fgRgb[0] - hiRgb[0]), Math.abs(fgRgb[1] - hiRgb[1]), Math.abs(fgRgb[2] - hiRgb[2]));
  const flat = spread <= 12;
  const dimC = flat ? 'rgb(' + mix(fgRgb, [0, 0, 0], 0.26).join(',') + ')' : ph.fg;
  const paint = (segs) => segs.map((s) => ({ t: s.t, c: s.hi ? ph.hi : dimC }));
  /* NO SPACE AFTER THE LABEL, ONE BEFORE THE VALUE. The two are not equivalent.
   *
   * The gap before the VALUE is load-bearing: without it the leader runs straight into the word and "....PASS" reads as one
   * token rather than a label and its result. The gap after the LABEL is decoration, and dropping it buys a character of
   * budget on every row -- which at these widths is the difference between fitting and wrapping.
   *
   * It also reads better on this content: "> self test..........." is a machine reporting progress, which is what the row is,
   * while "> self test ..........." is a label sitting next to some dots.
   *
   * The leader is therefore col - labelLen wide and the value lands at col + 1 on every table row -- still constant, which is
   * all the alignment needs. */
  return rows.map((r) => (r.v
    ? paint(r.l)
      .concat([{ t: new Array(Math.max(MIN, col - len(r.l)) + 1).join('.') + ' ', c: dimC }])
      .concat(paint(r.v))
    : paint(r.l)));
}

/* THE TYPEWRITER, WITH NO OPINION ABOUT HOW TEXT IS DRAWN.
 *
 * It used to build the DOM itself -- a div per line, innerHTML per keystroke. That was fine while the terminal was flowing
 * HTML and impossible once the text had to be PLOTTED: glyphs on a curved face need explicit coordinates, and coordinates
 * are the view's business. So this now owns only what it always really owned -- the content and the RHYTHM -- and hands
 * the caller a cursor position to render.
 *
 *   lines      bootLines() output
 *   speed      TYPE SPEED; every delay below is divided by it
 *   paint(st)  called on every keystroke with { li, n, caret, blink }: line index, characters revealed on that line,
 *              whether to draw a caret and whether it blinks. The caller renders; this decides when.
 *   onGlow(f)  the fraction typed so far, so the tube's ambient glow can ramp with the text
 *   onDone()   called once the last character lands
 *   push(id)   hands each timer id back to the caller, so a power-off can cancel the whole sequence
 *
 * The delays are the point: a uniform interval reads as a progress bar, not as typing. Spaces and punctuation take
 * longer, and 4.5% of characters take a long pause -- which is what makes it read as a machine thinking rather than a
 * string being revealed.
 */
export function typeInto({ lines, speed, paint, onGlow, onDone, push }) {
  const keep = push || ((id) => id);
  const lineLens = lines.map((segs) => segs.reduce((a, s) => a + s.t.length, 0));
  const totalCh = Math.max(1, lineLens.reduce((a, b) => a + b, 0));
  const glow = (typed) => { if (onGlow) onGlow(Math.min(1, typed / totalCh)); };
  glow(0);
  let li = 0;
  const typeLine = () => {
    const segs = lines[li], full = segs.reduce((a, s) => a + s.t, '');
    const before = lineLens.slice(0, li).reduce((a, b) => a + b, 0);
    let i = 0;
    const step = () => {
      i++;
      paint({ li: li, n: i, caret: true, blink: false });
      glow(before + i);
      if (i < full.length) {
        const ch = full[i - 1];
        let d = (12 + Math.random() * 26) / speed;
        if (ch === ' ') d += Math.random() * 22 / speed;
        if ('.,:['.indexOf(ch) >= 0) d += (14 + Math.random() * 38) / speed;
        if (Math.random() < 0.045) d += (70 + Math.random() * 120) / speed;
        keep(setTimeout(step, d));
      } else {
        li++;
        if (li < lines.length) {
          paint({ li: li - 1, n: i, caret: false, blink: false });
          keep(setTimeout(typeLine, (150 + Math.random() * 220) / speed));
        } else {
          paint({ li: li - 1, n: i, caret: true, blink: true });
          if (onDone) onDone();
        }
      }
    };
    step();
  };
  typeLine();
}
