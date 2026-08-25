/* catalog.js — the back catalog: seventeen shipped products as a rack of cases and one display case.
 *
 * READ FROM THE MARKUP, NEVER FROM AN ARRAY. Every product and every proof is written out in index.html and this
 * script turns them into the rack, so a crawler running no JavaScript still reads all seventeen records in full.
 * Building them from a record instead would delete the page's content for anyone not running scripts. If it is not
 * in the markup it does not exist.
 *
 * The case itself is drawn by case3d.js: one projected wireframe, corners sampled as curves, sides built as real
 * per-segment quads. This file owns the rack, the company bar and what the case is showing.
 *
 * The ARTWORK is in site/cover-art/, one module per product keyed by the record's own id, and the LOCKUP over it is
 * built here in HTML so the title stays selectable and reflows at blade size.
 */
import { coverArt } from './cover-art/index.js';

(function () {
  /* A module reaching for a global, because site/kit.js is a classic script: every other file on this page is
     one, and converting them all is a change to how the page loads rather than to what it does. */
  const K = window.AKKIT;

  const shelf = document.getElementById('shelf');
  const reelHost = document.getElementById('reel');
  if (!shelf || !reelHost) return;

  const txt = (n, sel) => {
    const e = n && n.querySelector(sel);
    return e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
  };

  /* THE ACTS COME OUT OF THE SPINES' OWN LABELS, in page order, first appearance winning — so an act cannot be
     a heading here and missing from the shelf, and the two can never disagree about which product sits in it. */
  const acts = [];
  Array.prototype.forEach.call(shelf.querySelectorAll('.spine-face'), (face) => {
    const ref = face.getAttribute('aria-controls') || '';
    const proof = document.getElementById(ref);
    if (!proof) return;

    const label = txt(face, '.p-domain');           // "Act IV · Scale, then agents"
    const cut = label.indexOf('·');
    const actName = (cut < 0 ? label : label.slice(0, cut)).trim();
    const says = cut < 0 ? '' : label.slice(cut + 1).trim();
    let act = acts[acts.length - 1];
    if (!act || act.act !== actName) {
      act = { act: actName, says: says, items: [] };
      acts.push(act);
    }

    act.items.push({
      id: ref,
      name: txt(face, '.p-name'),
      /* The cover's own two lines of copy. The tagline is content and lives in the markup with everything
         else. `data-cover-title` is what the COVER prints, in lines, and it is only there when the name does
         not set itself: Self Pickup wants two lines the default rule leaves on one, and Housekeeping has to
         break inside its single word. */
      tag: txt(face, '.p-tag'),
      lines: (face.getAttribute('data-cover-title') || '').split('|').filter(Boolean),
      marks: Array.prototype.map.call(face.querySelectorAll('.p-marks i'), (i) => i.textContent.trim()),
      /* FEATURES AND TOOLS AS THE ROLE LISTS THEM, off the record's own kit lines. They belong to the role and
         not to the product, which is why two records under one employer carry the same pair — the same way they
         already carry the same employer, role and dates. Comma-separated in the markup because that is how a CV
         writes a tool list; split here rather than tagged one by one. */
      /* WHAT THE PRODUCT IS, then WHAT IT ACHIEVED. The lede is one paragraph under the header and the wins are
         the outcomes worth reading on their own — a box back is scanned, and a reader who stops after the first
         line should still know what the thing did. Records not yet rewritten carry the role's write-up in the
         wins list and no lede, so the panel is never empty while the pass is in progress. */
      /* THE SOURCE NODES, NOT THEIR TEXT. These carry <b> around the figures, and textContent would flatten it —
         so the panel copies the record's own nodes instead. Cloned at draw time rather than parsed from a
         string: there is no HTML to re-parse and nothing here can be anything the record did not already say. */
      ledeEls: Array.prototype.slice.call(proof.querySelectorAll('.proof-lede')),
      winEls: Array.prototype.slice.call(proof.querySelectorAll('.proof-wins li')),
      kit: Array.prototype.reduce.call(proof.querySelectorAll('.proof-kit'), (all, row) => {
        const head = row.querySelector('b');
        const key = head ? head.textContent.trim().toLowerCase() : '';
        const rest = row.textContent.slice(head ? head.textContent.length : 0);
        all[key] = rest.split(',').map((t) => t.trim()).filter(Boolean);
        return all;
      }, {}),
      at: txt(proof, '.proof-at h4'),
      /* The employer's own site, off the record's own heading. Empty when the record does not name one, which
         is what makes the link optional rather than a list of special cases in the script. */
      /* THE AGENCY THE CONTRACT RAN THROUGH, where there was one. Attributes and not text, because the h4's TEXT
         is what names the employer everywhere else — the company bar, the jump list, the chip you are on — and
         putting "(Contract: ...)" in it would rename the employer in all three. */
      atSite: (function () {
        const h = proof.querySelector('.proof-at h4');
        return h ? (h.getAttribute('data-site') || '') : '';
      })(),
      via: (function () {
        const h = proof.querySelector('.proof-at h4');
        return h ? (h.getAttribute('data-via') || '') : '';
      })(),
      viaSite: (function () {
        const h = proof.querySelector('.proof-at h4');
        return h ? (h.getAttribute('data-via-site') || '') : '';
      })(),
      role: txt(proof, '.pa-role'),
      when: txt(proof, 'time'),
      /* WHERE THE APP CAN BE GOT, read off the record's own anchors. Real links in index.html and not a table
         here, for the same reason every other field is: a crawler with no JavaScript still finds the store. */
      stores: Array.prototype.map.call(proof.querySelectorAll('.proof-get a'), (a) => ({
        store: a.getAttribute('data-store') || '',
        label: a.textContent.trim(),
        href: a.getAttribute('href')
      }))
    });
  });
  if (!acts.length) return;

  /* One flat list in page order, each item still knowing which act it came from. Acts are contiguous in the
     markup and so are the employers, which is what lets the company bar be a jump rather than a filter. */
  const items = acts.reduce((all, a) => all.concat(a.items.map((it) => Object.assign({ act: a }, it))), []);
  /* NO. 01 IS THE FIRST BOX ON THE RACK, not a number typed onto a drawing. The kicker and the rack cannot
     disagree about which one this is, because there is only one place the number is decided. */
  items.forEach((it, i) => { it.no = String(i + 1).padStart(2, '0'); });

  // The shelf's own UI is replaced by this one; the records stay in the DOM as the source above.
  shelf.setAttribute('hidden', '');
  document.getElementById('experience').classList.add('js-cat');

  let at = 0;
  let flipped = false;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const svg = (tag, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    return n;
  };

  /* ---- the box art ----
   *
   * THE DRAWING IS IN site/cover-art/, KEYED BY THE RECORD'S OWN ID. This used to be one axonometric motif per
   * domain, which meant three products shared a picture; they were placeholders and they said so. What is left
   * here is the LOCKUP — the words printed on the cover — because words belong in HTML: the title stays
   * selectable, it reflows at blade size, and a crawler running no JavaScript still reads it out of index.html.
   */

  /* The years a box foots with are the range, not the months. The record carries "Jul 2017 – Mar 2019" because
     that is what a CV says; a cover says 2017–2019, and one year when it started and ended in one. */
  function yearsOf(when) {
    const ys = (when || '').match(/\d{4}/g);
    if (!ys || !ys.length) return '';
    const a = ys[0], b = ys[ys.length - 1];
    return a === b ? a : a + '–' + b;
  }

  /* HOW THE TITLE BREAKS. Long names set on one line drop to half the size of a short one and stop reading as
     the same series, so past eleven characters the name splits at the word boundary that leaves the two lines
     nearest equal. Where the rule is wrong, or where the cover prints something other than the product's full
     name, the record says so in `data-cover-title` rather than this becoming a list of special cases. */
  function titleLines(p) {
    if (p.lines.length) return p.lines;
    const t = p.name.toUpperCase();
    const words = t.split(' ');
    if (t.length <= 11 || words.length < 2) return [t];
    let at = 1, near = Infinity;
    for (let i = 1; i < words.length; i++) {
      const gap = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
      if (gap < near) { near = gap; at = i; }
    }
    return [words.slice(0, at).join(' '), words.slice(at).join(' ')];
  }

  /* The size, as a fraction of the face's own width. A fit against the real glyph widths would be exact, but it
     needs layout and this runs before the rack is measured — so it fits against the character count instead and
     the title is centerd in a fixed band, which is where the few per cent of error goes. One line is capped at
     the size ISU sets at; two lines share one size across the whole two-line family, which is what makes them
     read as a set rather than as seventeen separate decisions. */
  function titleScale(lines) {
    const longest = Math.max.apply(null, lines.map((l) => l.length));
    if (lines.length > 1) return Math.min(0.13, 1.15 / longest);
    if (longest <= 3) return 0.2;
    return Math.min(0.1867, 1.27 / longest);
  }

  /* The whole face: the drawing, then the words over it. Returns a fragment so both hosts — the blade in the
     rack and the case on the stage — put the identical thing on their front. */
  function buildCover(p) {
    const frag = document.createDocumentFragment();
    const art = coverArt(p.id);
    if (art) frag.appendChild(art);

    const lock = el('div', 'cover-lock');
    /* The head is the scrim and nothing else; the three lines are its siblings, so their offsets are
       percentages of the FACE rather than of the head. See .cover-head in site.css. */
    lock.appendChild(el('div', 'cover-head'));
    lock.appendChild(el('span', 'cover-kicker', p.act.act + ' · No. ' + p.no));

    const title = el('div', 'cover-title');
    const lines = titleLines(p);
    const words = el('span', null);
    lines.forEach((line, i) => {
      if (i) words.appendChild(document.createElement('br'));
      words.appendChild(document.createTextNode(line));
    });
    title.style.setProperty('--t-scale', titleScale(lines).toFixed(4));
    title.appendChild(words);
    lock.appendChild(title);
    lock.appendChild(el('span', 'cover-tag', p.tag));

    const foot = el('div', 'cover-foot');
    foot.appendChild(el('span', null, p.at));
    foot.appendChild(el('span', null, yearsOf(p.when)));
    lock.appendChild(foot);

    frag.appendChild(lock);
    return frag;
  }

  /* ---- the flip rack ----
   *
   * A JUKEBOX SELECTOR, not a row that scrolls and not a fan. The boxes hang from a rail at the top and you tip them
   * forward one at a time: the one you are on faces you square, the ones still to come stack up behind it, and the
   * ones you have passed lie over toward you almost flat.
   *
   * It is also the page's own axis used a third way. The calculator's phone turns about Y; a rack hinged at the TOP
   * turns about X, so this is a gesture of its own rather than a second copy of that one.
   *
   * EVERY BOX IS PLACED FROM ITS OFFSET AND NOTHING ELSE. One expression owns the whole rack, so the hinge, the
   * stack and the pile cannot drift apart, and a box's position is never a state to keep in step.
   */
  /* THE HINGE IS THE LEADING EDGE, and the flip is horizontal. A rack hinged at the TOP tips its boxes forward
     and down, which is a page of a wall calendar; hinged at the SIDE it swings them across, which is a book, a
     CD rack and a jukebox selector — the thing anybody flicking through covers is actually doing.
     MEASURED AGAINST WHAT YOU CAN SEE. At 104 degrees a flipped box was edge-on and read as nothing, and a
     stack that recedes straight back sits entirely behind the box in front of it: the first rack drew seventeen
     boxes and looked like one. Everything below is tuned so both piles stay legible from the front. */
  /* SYMMETRIC BLADES, one face and thirty-two edges. The cover you are on faces you square and every other one
     stands nearly edge-on, fanning away to both sides — a card index or a Rolodex, not a book. The turned/
     untouched split a book has is wrong for a catalog anyway: there is no "already read" here, only near and
     far from where you are standing.
     ALL SIXTEEN OTHERS STAY ON SCREEN, because the section's claim is seventeen and a rack that shows five is
     asking the reader to take the other twelve on trust. */
  const BLADE = 79;     // degrees the flanking covers stand at. At 90 they are invisible lines; under about 70
                        // they read as facing you at an angle and the fan stops being edges.
  /* SPACING AND THICKNESS ARE SEPARATE NUMBERS. They were briefly the same one — the depth derived from STEP so
     the rims tiled exactly — and that ties two things the reader judges independently: tiling the rims makes a
     wider fan a thicker case, which is not what anybody asked for either time. RIM is what a blade shows, STEP
     is how far apart they stand, and STEP > RIM is the gap between them. */
  /* THE RIM IS WHAT THE NAME IS SET ON, so it is sized for reading and not for the drawing. At 12 the name had
     about a pixel of rim either side of its caps and sat on whatever cover was behind it, which is most of why
     the fan was hard to read. RIM costs nothing but daylight — `room` below is charged against STEP, not this —
     so widening it takes the gap between names from 12 to 6 and buys the type both size and margin. */
  const RIM = 18;       // px of rim each blade actually shows
  const STEP = 24;      // px between blades: the rim plus six of daylight, so every name stands clear
  const LIFT = 60;      // px the facing cover stands in front of the fan
  /* EVERY BLADE STANDS AT THE SAME DEPTH. They used to recede 7px each, which shrinks the far ones through the
     perspective divide — and the spine is the only thing naming a blade, so a rack that recedes is a rack whose
     far names are smaller than its near ones. The fan's own overlap already says which is nearer; it does not
     need the size to say it a second time at the cost of legibility. */
  const REACH = 16;     // blades drawn each side: all of them.
  /* THE FAN COMPRESSES WITH DISTANCE instead of stepping evenly. Even spacing has to fit sixteen blades in the
     rack's half-width, which left every one of them STEP apart and the near ones as crowded as the far ones —
     and the near ones are the only ones anybody reads. The reel is 597px and the even fan already reserved 384
     of it, so there was nothing to widen INTO: the cover just shrank.
     A power curve spends the same total width unevenly. At .7 the first blade each side sits about 28px out
     rather than 12, the second another 17, and the tail packs down to 8 — which is what a rack of cases does
     when you pull one forward. */
  /* 1 is even spacing, and even is what "all seventeen readable" means: any curve under 1 buys the near blades
     room by taking it from the tail, and the tail is where the names were running together. The rack no longer
     has to ration width — see the reservation in place() — so there is nothing left to trade. */
  const CURVE = 1;
  const SPAN = REACH * STEP;   // total half-width the fan is allowed, unchanged
  const gap = (n) => SPAN * Math.pow(Math.min(n, REACH) / REACH, CURVE);

  const reel = document.getElementById('reel');
  const reelAct = document.getElementById('reel-act');

  const boxes = items.map((p, i) => {
    const b = el('button', 'box');
    b.type = 'button';
    b.dataset.id = p.id;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-label', p.name + ', ' + p.at);
    /* THE SAME OBJECT AS THE ONE ON THE STAGE, at rack size: a drawn wireframe carrying the outlines, the
       glass and the side walls, with the print over it in its own 3D box. The cover used to be a bordered div
       with a 14px strip down its right edge standing in for thickness — a flat slab that could not follow the
       corners and did not turn, which is exactly what the stage's case stopped doing. */
    const wire = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wire.setAttribute('class', 'c3-wire box-wire');
    wire.setAttribute('aria-hidden', 'true');
    b.appendChild(wire);
    const print = el('div', 'box-print');
    const face = el('div', 'box-face');
    face.appendChild(buildCover(p));
    print.appendChild(face);
    b._face = face;
    /* A SPINE ON BOTH RIMS, and the front cover only.
       The fan is symmetric, so blades to the left of center show their right rim and blades to the right show
       their left — one spine would leave half the rack anonymous. Two, and every blade in the fan is legible
       whichever way it leans, which is the whole point of a rack of edges: at 79 degrees the reader is looking
       at the spine, not at the cover.
       No back panel here. It is never visible on a blade, and seventeen of them is seventeen more faces to lay
       out and turn for nothing. */
    b._rims = ['l', 'r'].map((side) => {
      const rim = el('div', 'box-spine box-spine-' + side);
      rim.appendChild(el('span', null, p.name));
      print.appendChild(rim);
      return rim;
    });
    b.appendChild(print);
    b._print = print;
    /* 8 samples a corner, against the stage case's 18. Four was chosen when the cover was 189px; at 1920 it is
       388 and the facets showed on the facing one. Only the blade crossing the center redraws on a given frame,
       so the corner is worth paying for. */
    b._draw = window.CASE3D ? window.CASE3D.make(wire, 8, true) : null;
    b.addEventListener('click', () => go(i));
    reel.appendChild(b);
    return b;
  });

  /* THE RACK RUNS ON A FLOAT, TWEENED BY HAND. `at` is still the integer you are on; `pos` is where the rack
     actually is, and every blade's angle, offset and depth is a function of `i - pos`.
     It used to be integers with a CSS transition doing the moving, which cannot work now that each blade
     carries a drawn wireframe: the print would ease over .44s while the drawing snapped to its final angle on
     the first frame — the same two-clock fault the case on the stage had. One number, read by both.
     It also makes the fan continuous rather than three fixed angles, so a cover turns as it comes round instead
     of jumping to face you. */
  let pos = 0, glide = 0;

  /* THE ALIGNMENT IS MEASURED, NOT PREDICTED, and corrected on the next frame.
     hw() below estimates how wide a turned cover projects, and every closed form for it came out short: the
     cover is inside a box with its own perspective, inside a reel with another, and the two compose in ways the
     obvious P/(P-z) does not capture. Three attempts landed the rack 39px, 22px and 13px left of its column.
     So: place the rack, read where its left edge actually is, and fold the error back in. It converges in a
     frame, needs no model of the compositing at all, and cannot drift as the geometry changes around it. */
  let shiftFix = 0;

  function slideTo(target) {
    cancelAnimationFrame(glide);
    const from = pos, delta = target - pos;
    if (!delta || reduced.matches) {
      glide = 0; pos = target;
      place(); settleCase(); armAutoTurn();
      return;
    }
    const ms = Math.min(620, 240 + Math.abs(delta) * 80);
    let t0 = 0;
    const step = (ts) => {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / ms);
      pos = from + delta * K.easeOutCubic(p);
      place();
      if (p < 1) { glide = requestAnimationFrame(step); return; }
      glide = 0; pos = target; place();
      /* THE SETTLE IS WHERE THE SECOND IS COUNTED FROM, not the keypress. A jump across the rack glides for up
         to 620ms, and arming the turn at the gesture spends most of that second on a cover that is still
         moving. */
      settleCase();
      armAutoTurn();
    };
    glide = requestAnimationFrame(step);
  }

  function place() {
    /* THE BOX IS SIZED FROM THE RACK, not written down. The reel takes whatever the blocks above it leave and
       the box is a fraction of that, so the section fits by construction at any window rather than by a number
       here being lucky. A fraction and not the whole height, because the rack needs room to pile forward. */
    /* SIZED SO THE WHOLE FAN FITS, AND THE SAME SIZE WHEREVER YOU ARE IN IT. Against the CURRENT fan the cover
       grew and shrank on every step — widest at the ends, narrowest in the middle — which reads as the layout
       breaking rather than as the rack turning. Against the deepest fan it is one size for the whole run. */
    /* SIZED FOR THE BLADE'S PROJECTED HEIGHT, not the cover's laid-out height.
       A blade stands at BLADE degrees, which swings its near edge forward to z = w/2 * sin(BLADE) — and the
       perspective divide magnifies whatever is at +z. At a 409px cover that is 1.17x, so a 545px box projected
       636px into a 620px reel and the top corners of the leaning blades were cut off. It only showed on TALL
       windows, because the box is sized from the reel's height: 1920x1080 and 1680x1050 clipped by 8px and 6px
       while 1440x900 was fine, which is why it read as "some of them".
       Solving (4/3)w * P/(P - k*w) <= H for w, with k = sin(BLADE)/2, gives the widest cover whose LEANING
       copies still fit. .97 is a hair of slack for the outline's own stroke. */
    /* THE BUDGET IS THE COLUMN MINUS THE FIXED BLOCKS, and it must not be read off anything the rack's own size
       moves. The reel is sized from the cards and the wrapper is sized from the reel, so measuring either would
       feed back and the rack would walk down to nothing over a few passes; the column's height and the heights
       of the title, the credential, the key rows and the chip bar are all independent of it. */
    const wrap = reel.parentElement;
    const col = reel.closest('.cat-left');
    const actH = reelAct ? reelAct.offsetHeight : 0;
    let used = 0;
    if (col) {
      Array.prototype.forEach.call(col.children, (c) => {
        const cs = getComputedStyle(c);
        used += parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
        if (c !== wrap) used += c.getBoundingClientRect().height;
      });
    }
    const h = Math.max(40, (col ? col.clientHeight : reel.clientHeight) - used - actH - 10);
    const P = 1400, k = Math.sin(BLADE * Math.PI / 180) / 2;
    /* THE FULL FIT, now that the reel does not clip. The expression is the widest cover whose LEANING copies
       stand exactly H tall; every fraction under 1 that this carried was paying for a clip that no longer
       exists. The facing cover is shorter than that — it does not lean, so it is not magnified — which is why
       the rack still reads as sitting inside its band with the blades reaching past it. */
    const fit = h * P / ((4 / 3) * P + h * k);
    /* THE FAN IS RESERVED ONCE, NOT TWICE. This held back REACH * STEP on BOTH sides — but there are only
       sixteen blades in total, so whether they sit all to one side or eight each way the rack spans the same
       16 * STEP either side of nothing. Reserving symmetrically charged the cover for width no arrangement can
       ever use, and it is what kept the blades twelve pixels apart.
       It is only correct because the rack is placed by its own left EDGE now; pinned to the cover, the
       one-sided case really did need the full symmetric room. */
    const room = reel.clientWidth - REACH * STEP - 24;
    if (h > 40) reel.style.setProperty('--box-w', Math.max(90, Math.min(Math.round(fit), room)) + 'px');

    /* AND THE REEL IS ONLY AS TALL AS THE RACK IN IT. Left to fill the column it reserved the whole remainder —
       measured at 1600x1000, 361px of box for 299px of cards — and the carousel read as floating in a band of
       nothing. The projected height is the same expression the fit solves against: a leaning blade swings its
       near edge forward and the perspective divide magnifies it. */
    const bwNow = parseFloat(getComputedStyle(reel).getPropertyValue('--box-w')) || 0;
    if (bwNow) {
      const tall = (4 / 3) * bwNow * P / (P - k * bwNow);
      reel.style.height = Math.min(h, Math.ceil(tall) + 10) + 'px';
    }

    const bw = boxes[0].offsetWidth || 1, bh = boxes[0].offsetHeight || 1;
    /* THE BLADE'S DEPTH IS SET BY THE SPACING, not by the case's own thickness ratio.
       A blade stands at BLADE degrees, so the rim it shows is depth * sin(BLADE) wide — and the next blade sits
       STEP away. At the stage case's eleventh-of-its-width the rim came out 17px against a 12px step, so every
       rim ran a third of the way under its neighbor and the rack read as a smear rather than as a stack.
       Derived from STEP, the rims tile: each blade shows exactly its own rim and no more. */
    const bd = Math.max(5, Math.round(RIM / Math.sin(BLADE * Math.PI / 180)));
    // The rims are CSS faces, so they need the two measurements the drawing takes as arguments.
    reel.style.setProperty('--blade-w', bw + 'px');
    reel.style.setProperty('--blade-d', bd + 'px');
    reel.style.setProperty('--blade-step', RIM + 'px');

    const half0 = bw / 2;
    /* HOW WIDE A COVER ACTUALLY IS ON SCREEN at a given turn: its half-width foreshortened by cos, then
       magnified by the perspective divide because turning swings its near edge forward to +z.
       Guessing this as "about nothing once it is turned" put the rack 39px left of its column — a blade at 79
       degrees still projects 43px of half-width at a 388px cover, not the 2px the estimate allowed it. */
    const hw = (t) => {
      const a = BLADE * t * Math.PI / 180;
      /* The near edge's depth is both terms: how far the whole cover stands forward (LIFT, which only the
         facing one gets) and how far turning swings its own edge forward. Leaving LIFT out made the facing
         cover measure 194 half-widths when it projects 203, and the rack sat left of its column by that much
         plus change whenever the first item was selected. */
      const z = LIFT * (1 - t) + half0 * Math.sin(a);
      return half0 * Math.cos(a) * P / (P - z);
    };
    let lo = Infinity, hi = -Infinity;
    boxes.forEach((b, i) => {
      const n = i - pos, f = Math.abs(n), t = Math.min(1, f);
      if (f > REACH) return;
      const e = (n < 0 ? -1 : 1) * (t * (half0 + 4) + gap(f));
      lo = Math.min(lo, e - hw(t));
      hi = Math.max(hi, e + hw(t));
    });
    const shift = (lo < hi ? lo + reel.clientWidth / 2 - 2 : 0) + shiftFix;

    boxes.forEach((b, i) => {
      const n = i - pos;                      // < 0 to the left, 0 facing you, > 0 to the right
      const far = Math.abs(n);
      const side = n < 0 ? -1 : 1;
      const shown = far <= REACH;
      const turn = Math.min(1, far);          // 0 facing you, 1 fully into the fan

      /* ORDER MATTERS. translate(-50%) is written FIRST so it is applied LAST — the cover turns about its own
         center and is only then shifted half its width to sit on the reel's center line. Written the other way
         round the shift is dragged into the rotation and every blade lands somewhere it was never sent.
         The offset clears the FACING cover's half width before the blades start, or the first one either side
         is buried behind it. */
      /* ONE EXPRESSION FOR EVERY POSITION, continuous through the center. Each term is the old discrete case
         with `turn` ramping it in over the first step, so a cover at n = 1 lands exactly where the fan used to
         put it and a cover part way between turns part way.
         The offset clears the FACING cover's full half-width before the fan starts, or the first blade each
         side is buried behind it. */
      const half = bw / 2;
      const x = side * (turn * (half + 4) + gap(far));
      const z = LIFT * (1 - turn);
      const yaw = -side * BLADE * turn;

      b.style.transform = 'translate(-50%, 0) translate3d(' + (x - shift).toFixed(1) + 'px, 0, ' +
                          z.toFixed(1) + 'px)';
      b._print.style.transform = 'rotateY(' + yaw.toFixed(1) + 'deg)';
      /* THE COVER STAYS ON. It used to fade out as a blade turned, because sixteen transparent covers stacked
         their artwork through each other into a scribble — but that was at twelve pixels of spacing, where a
         blade showed nothing but rim. At twenty-four each blade exposes its rim AND a strip of its own cover,
         and turning that off left the fan a row of blank edges when the art is the thing that distinguishes
         them. Both faces are front-facing at 79 degrees either way, so this reads on both sides of the rack. */

      /* Redrawn only when its angle or size has actually moved — a rack step turns a handful of blades, not
         seventeen, and this runs on every frame of the glide. */
      if (b._draw && shown) {
        const key = bw + '|' + bh + '|' + bd + '|' + yaw.toFixed(1);
        if (b._key !== key) { b._key = key; b._draw(bw, bh, bd, yaw, 0); }
      }
      // Nearest to the front wins, whichever side it is on. The facing cover is always on top.
      b.style.zIndex = String(100 - Math.round(far));
      /* Hidden rather than merely faint past reach: a box at 5% opacity still takes a compositor layer and still
         answers the pointer, and seventeen of those under the one you are reading is a hit-target lottery. */
      /* A SHALLOW FADE, because the fan is sixteen deep each side. At a steeper rate everything past the sixth
         blade sat at the floor, which is a fade that has stopped saying anything about distance. */
      /* NO FADE WITH DISTANCE. A blade carries a name and the name is the point — dimming it by how far it sits
         from the playhead makes the ends of the rack unreadable, which is the opposite of showing all
         seventeen. Hidden past reach, full strength inside it. */
      /* Written as a PROPERTY, not as opacity. An inline opacity beats any stylesheet rule, so the company
         highlight below could never dim a box the script had touched. This way the two compose: the script owns
         whether a blade is on the rack at all, the stylesheet owns what the pointer does to it. */
      b.style.setProperty('--vis', shown ? '1' : '0');
      b._print.style.pointerEvents = shown ? 'auto' : 'none';
      b.classList.toggle('picked', i === at);
      b.classList.toggle('blade', i !== at);
      b.setAttribute('aria-selected', i === at ? 'true' : 'false');
    });

    /* MEASURED OVER THE RIMS TOO, not just the print. A spine face is pushed out to half the width and stands
       in the side wall, so it projects PAST the print's own box — measured, the leftmost blade's print began at
       42 while its spine face began at 36, and the reel's overflow clipped four pixels off the first name. The
       leftmost thing on the rack is a rim, not a cover. */
    /* THE RACK STARTS ON THE COLUMN'S RAIL, the same edge the title, the key rows and the chip bar start on.
       The target is a fixed edge rather than a center on purpose: the rack's own span is about 40px wider when
       the leftmost item is a cover than when it is a blade, so centering it would slide the whole thing sideways
       every time the selection crossed that boundary. A fixed edge keeps the frame still and lets the covers do
       the moving, which is what a rack does. */
    const rr = reel.getBoundingClientRect();
    const want = rr.left + 2;
    let got = Infinity;
    boxes.forEach((b) => {
      if (b.style.getPropertyValue('--vis') === '0') return;
      got = Math.min(got, b._print.getBoundingClientRect().left);
      b._rims.forEach((r) => { got = Math.min(got, r.getBoundingClientRect().left); });
    });
    // The act line is centerd over the rack rather than over the column, so it needs the rack's real width.

    // Clamped, so a bad frame during a resize cannot walk the rack off the column.
    if (got < Infinity) shiftFix = Math.max(-400, Math.min(400, shiftFix + (got - want)));

    // Last, and in the same frame: the case on the stage is one more thing placed from `pos`.
    stepCase();
  }


  /* ONE LINE, and no counter. "08 / 17" was a third readout of a position the fan already shows and the company
     bar already names — three answers to one question, none of them the one a reader came for. What the act is
     called is the only thing here they cannot see for themselves. */
  function drawAct() {
    reelAct.textContent = items[at].act.act + ': ' + items[at].act.says;
  }

  // ---------------------------------------------------------------- the company bar

  const firmsEl = document.getElementById('firms');

  /* THE EMPLOYERS IN PAGE ORDER, first appearance wins. Derived rather than listed, so a company cannot be a
     button here and missing from the crate — and the index it jumps to is the first product it shipped, which
     is what makes the bar a jump and not a filter. */
  const firms = [];
  items.forEach((p, i) => {
    if (!firms.some((f) => f.name === p.at)) firms.push({ name: p.at, at: i });
  });

  /* HOVERING A COMPANY LIGHTS EVERY BOX IT SHIPPED. The bar is a jump, not a filter, so a click still takes you
     to that company's first product — but a rack of seventeen edges gives no answer to "which of these are
     theirs" until you have walked the whole thing. Pointing at the name answers it without moving anything.
     On focus as well as hover, or the same information is missing from the keyboard. */
  function mark(name) {
    boxes.forEach((b, i) => b.classList.toggle('of-firm', !!name && items[i].at === name));
    reel.classList.toggle('marking', !!name);
  }

  const firmBtns = firms.map((f) => {
    const b = el('button', null, f.name);
    b.type = 'button';
    b.addEventListener('click', () => go(f.at));
    b.addEventListener('pointerenter', () => mark(f.name));
    b.addEventListener('pointerleave', () => mark(null));
    b.addEventListener('focus', () => mark(f.name));
    b.addEventListener('blur', () => mark(null));
    firmsEl.appendChild(b);
    return b;
  });

  /* THE COMPANY BAR SCROLLS ON A PLAIN WHEEL. It runs off its right edge and a mouse has no deltaX at all, so
     without this the row could only be reached on a trackpad — and only by someone who guessed it moved.
     CHAINS AT THE ENDS: once the row is against a stop the page takes the gesture back, so a reader whose
     cursor happens to be over the chips is never trapped there. */
  firmsEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // sideways already works on its own
    const max = firmsEl.scrollWidth - firmsEl.clientWidth;
    if (max <= 0) return;
    if ((e.deltaY > 0 && firmsEl.scrollLeft >= max - 1) ||
        (e.deltaY < 0 && firmsEl.scrollLeft <= 1)) return;
    e.preventDefault();
    firmsEl.scrollLeft = Math.max(0, Math.min(max, firmsEl.scrollLeft + e.deltaY));
  }, { passive: false });

  /* THE FADES ONLY EXIST WHERE THERE IS MORE TO SEE. A fade at an end you have already reached dims a chip for
     no reason — and the last company was permanently half-hidden under one. */
  const FADE = 34;
  function edges() {
    const max = firmsEl.scrollWidth - firmsEl.clientWidth;
    firmsEl.style.setProperty('--fade-l', (firmsEl.scrollLeft > 1 ? FADE : 0) + 'px');
    firmsEl.style.setProperty('--fade-r', (firmsEl.scrollLeft < max - 1 ? FADE : 0) + 'px');
  }
  firmsEl.addEventListener('scroll', edges, { passive: true });

  /* AND THE CURRENT COMPANY IS BROUGHT INTO THE CLEAR as the carousel crosses into it — past the fade, not just
     inside the box, or the chip that names where you are is the one you cannot read. */
  /* MEASURED AGAINST THE SCROLLER, NOT AGAINST offsetParent. This read b.offsetLeft as if it were the chip's
     position in the row, and it is the chip's position in whatever ancestor happens to be positioned — here
     303px further out. Every chip therefore measured 303 too far right: the left-hand test could never fire, so
     walking back to Yahoo! never scrolled the row and the first chip stayed half under the fade. The chips on
     the right looked correct only because their overflow test was true for the wrong reason and the result
     clamped to the end anyway. A rect is relative to the viewport whatever the offsetParent is. */
  function firmSpan(b) {
    const br = b.getBoundingClientRect(), fr = firmsEl.getBoundingClientRect();
    const l = br.left - fr.left + firmsEl.scrollLeft;
    return { l: l, r: l + br.width };
  }

  /* WHICH COMPANY THE BAR IS ON, and which way it last moved. The peek below needs a direction and the bar is
     the only thing that knows one: `at` steps through PRODUCTS, and several of them share an employer, so a
     walk from myDay to Store Companion moves the playhead without moving the bar at all. Held between calls so
     those steps keep the last real direction rather than resetting it. */
  let firmAt = -1, firmDir = 1;

  function revealFirm(b, idx, dir) {
    const max = firmsEl.scrollWidth - firmsEl.clientWidth;
    if (max <= 0) return;
    const span = firmSpan(b);
    const l = span.l, r = span.r, view = firmsEl.scrollLeft, w = firmsEl.clientWidth;
    let to = view;
    if (r + FADE > view + w) to = r + FADE - w;
    else if (l - FADE < view) to = l - FADE;

    /* AND A LOOK AT WHAT IS COMING, ON THE SIDE YOU ARE HEADED. The bar is a jump list, so showing the company
       you are on and nothing beyond it hides the answer to "what is next" — which is most of why anybody scans
       it. This used to peek at idx + 1 always, which is the wrong neighbor half the time: walking BACK through
       the rack it revealed the company you had just left and kept the one you were heading toward under the
       fade, so the bar led you in the opposite direction to the one you were moving.
       Never at the current chip's expense, either way: the peek is taken only if the chip being named keeps its
       own far edge inside the view, so the thing the bar is pointing at can never be pushed out to show its
       neighbor. */
    const nb = firmBtns[idx + dir];
    if (nb) {
      const ns = firmSpan(nb);
      if (dir > 0) {
        const want = ns.r + FADE - w;             // far edge of the next chip, clear of the right fade
        if (want > to && want <= l - 6) to = want;
      } else {
        const want = ns.l - FADE;                 // near edge of the previous chip, clear of the left fade
        if (want < to && want >= r + 6 - w) to = want;
      }
    }
    to = Math.max(0, Math.min(max, to));
    if (Math.abs(to - view) < 1) return;
    if (firmsEl.scrollTo) firmsEl.scrollTo({ left: to, behavior: 'smooth' });
    else firmsEl.scrollLeft = to;
  }

  function drawFirms() {
    const here = items[at].at;
    firmBtns.forEach((b, i) => {
      const on = firms[i].name === here;
      b.setAttribute('aria-current', on ? 'true' : 'false');
      if (!on) return;
      if (firmAt >= 0 && i !== firmAt) firmDir = i > firmAt ? 1 : -1;
      firmAt = i;
      revealFirm(b, i, firmDir);
    });
    edges();
  }

  // ---------------------------------------------------------------- the case

  const caseEl = document.getElementById('case');
  const caseBody = caseEl.querySelector('.case-body');
  const print = document.getElementById('case-print');
  const spineFace = document.querySelector('.c3-spine');
  const printFar = document.getElementById('case-print-far');
  const slide = document.getElementById('case-slide');
  const spine = document.getElementById('case-spine');
  const front = document.getElementById('case-front');
  const back = document.getElementById('case-back');
  const flipBtn = document.getElementById('flip');

  /* ---- the drawing ----
   *
   * ONE REDRAW PER ANGLE. case3d.js projects the box's outline at the current yaw and pitch and rebuilds five
   * paths; the print layer gets the same two angles through CSS. Nothing measures the DOM in here, because a
   * drag runs it on every frame.
   */
  const wire = window.CASE3D ? window.CASE3D.make(document.getElementById('case-wire')) : null;
  let caseW = 0, caseH = 0, caseD = 0;

  function sizeCase() {
    const body = document.getElementById('case-body');
    if (!body) return;
    const w = body.offsetWidth, h = body.offsetHeight;
    if (w < 20) return;
    caseW = w;
    caseH = h;
    /* A real game case is about a fourteenth of its own width thick; this is an eleventh, which is enough
       exaggeration for a hairline to read on a near-black page and no more. */
    caseD = Math.max(14, Math.round(w / 11));
    body.style.setProperty('--case-d', caseD + 'px');
    // The spine's push is along the width, so the print layer needs that measurement too.
    body.style.setProperty('--case-w', w + 'px');
    paint();
  }

  function paint() {
    if (wire && caseW) wire(caseW, caseH, caseD, turn, tilt);
  }

  /* `measure` is off for the redraws the glide makes: sizeCase reads offsetWidth, which forces layout, and the
     case's own size cannot change between two covers. Only a settle and a resize need it. */
  function drawFront(p, measure) {
    front.replaceChildren();
    front.appendChild(buildCover(p));
    if (spine) spine.textContent = p.name;
    if (measure !== false) sizeCase();
  }

  /* An anchor when the record names a site and a span when it does not, so a missing URL is a quieter label
     rather than a dead link. noopener is the security half; noreferrer keeps the reader's origin off the
     company's logs. */
  function linkOr(text, href, cls) {
    if (!href) return el('span', cls, text);
    const a = el('a', cls, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  /* The two stores' supplied badges, with the wording each requires as the alt text. */
  const BADGE = {
    play: { file: './store-badges/google-play.png', alt: 'Get it on Google Play' },
    ios:  { file: './store-badges/apple-black.svg', alt: 'Download on the App Store' }
  };

  /* A new element carrying a copy of another's children, markup and all. slice() first: appending MOVES a node
     out of the clone, so iterating the live childNodes would walk off the end and drop every other one. */
  function copyOf(tag, cls, src) {
    const out = el(tag, cls);
    Array.prototype.slice.call(src.cloneNode(true).childNodes).forEach((n) => out.appendChild(n));
    return out;
  }

  function drawBack(p) {
    back.replaceChildren();
    /* THE ROLE IS THE PANEL'S HEADLINE, not the product. The front of the box, the spine and the rack all name
       the product already; the back is the record, and what a reader wants from a record is the job. */
    back.appendChild(el('div', 'b-lead', p.role));

    /* THE EMPLOYER AND THE DATES SIT WITH THE ROLE, then the product under them — a job is a title, a place and
       a span of time, and the product is what came out of it. Written in reading order: the stylesheet gives
       only the product a full row, so DOM order and reading order are the same thing.
       THE EMPLOYER IS A LINK WHEN THE RECORD CARRIES ONE, and plain text when it does not, so adding a company
       site is one attribute in index.html and never a change here. */
    const where = el('div', 'b-at');
    where.appendChild(linkOr(p.at, p.atSite, 'firm'));
    /* STRAIGHT AFTER THE EMPLOYER, because it qualifies the employer. It can sit there without disturbing
       anything now that the dates take a row of their own below. */
    if (p.via) {
      const via = el('span', 'via');
      via.appendChild(document.createTextNode('(Contract: '));
      via.appendChild(linkOr(p.via, p.viaSite, 'via-name'));
      via.appendChild(document.createTextNode(')'));
      where.appendChild(via);
    }
    where.appendChild(el('span', 'when', p.when));
    where.appendChild(el('span', 'product', p.name));
    back.appendChild(where);

    /* THE RECORD IS WRITTEN OUT IN index.html AND READ FROM THERE. This panel is now the only place the full
       role text lives — experience.html carried it until the rack replaced that page — so the markup is not a
       fallback for a fuller page any more, it is the source. A crawler and a no-script reader get all of it. */

    p.ledeEls.forEach((el) => back.appendChild(copyOf('p', 'b-lede', el)));
    if (p.winEls.length) {
      const wins = el('ul', 'b-wins');
      p.winEls.forEach((li) => wins.appendChild(copyOf('li', null, li)));
      back.appendChild(wins);
    }

    /* WHERE TO GET IT, directly above the spec panel — the foot of a game box is where a store badge belongs,
       and it is the last thing read before the panel that lists what the thing is made of. Absent entirely
       when the record names no store, rather than an empty row: eleven of the seventeen predate an app store
       or have been delisted since. */
    /* THE STORES' OWN BADGES, NOT A CHIP OF OUR OWN. Both stores publish the linking artwork and both ask that
       it be used as supplied — Apple's from its marketing toolbox, Google's from its badge page — so the files
       in site/store-badges/ are the originals, unedited, and the only thing this decides is which one goes with
       which record. Resolved off import.meta.url so the path holds whatever page imports this module. */
    /* ALWAYS APPENDED, FILLED ONLY WHEN THERE IS A STORE. This element carries the `margin-top: auto` that
       pins both foot blocks, and eleven of the seventeen name no store — leaving it out on those would hand the
       pinning to .b-spec, and then a record WITH stores would have two auto margins splitting the slack and a
       gap opening between the two blocks. Empty, it is zero pixels tall and only does the pinning. */
    const get = el('div', 'b-get');
    if (p.stores.length) {
      /* No "Get it on" heading above these: each badge already says it, and the two together read as a stutter. */
      const row = el('div', 'b-get-row');
      p.stores.forEach((st) => {
        const badge = BADGE[st.store];
        const a = el('a', 'store ' + (st.store || ''));   // .store carries the shared badge sizing
        a.href = st.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        if (badge) {
          const img = document.createElement('img');
          img.src = new URL(badge.file, import.meta.url).href;
          img.alt = badge.alt;
          a.appendChild(img);
        } else {
          a.textContent = st.label;
        }
        row.appendChild(a);
      });
      get.appendChild(row);
    }
    back.appendChild(get);

    /* TWO ROWS, THE WAY THE FULL RECORD SEPARATES THEM. This was one "Tools and features" row fed by the
       product's two or three spine marks, which is a fraction of what the role actually lists — the panel was
       thinner than the source it is drawn from. Features and tools are different questions and get a label
       each; the product's own marks lead the features, because they are the specific ones. */
    /* ONE ROW, NO HEADINGS. Features and tools were labeled and split; the labels were the only thing telling
       them apart, so without them two rows would read as one list that happened to wrap. Joined, features
       first — the specific ones the product carries, then the role's kit behind them. */
    const spec = el('div', 'b-spec');
    const feats = p.marks.concat((p.kit.features || []).filter((f) => p.marks.indexOf(f) < 0));
    const all = feats.concat((p.kit.tools || []).filter((t) => feats.indexOf(t) < 0));
    if (all.length) {
      const chips = el('div', 'b-chips');
      all.forEach((m) => chips.appendChild(el('span', null, m)));
      spec.appendChild(chips);
    }
    back.appendChild(spec);
  }

  /* ---- and the case rides the same playhead the rack does ----
   *
   * THE CASE READS `pos`, NOT ITS OWN CLOCK. Thrown on a CSS timeline of its own — one exit, one swap, one entry —
   * crossing ten boxes shows the reader two covers and a wait while the rack beside it turns all ten: two
   * descriptions of one movement.
   *
   * The cover it shows is the nearest whole box, and how far it sits off center is the fraction left over, so every
   * cover crossed comes through it in step with the blade carrying the same artwork.
   *
   * The direction falls out and is not written down: `k - pos` is negative while the playhead is still short of box
   * k, so a cover leaves to the left as the rack walks right.
   */
  const CASE_TRAVEL = 1.35;   // case widths a cover crosses between one box and the next
  let showing = -1;

  function stepCase() {
    const k = Math.max(0, Math.min(items.length - 1, Math.round(pos)));
    const off = k - pos;                    // -.5 to .5, and exactly 0 once the glide has landed
    if (k !== showing) {
      showing = k;
      /* BOTH FACES, NOT THE ONE THAT HAPPENS TO BE OUT. Reading `flipped` here looked like an economy and was a
         bug: go() turns the case back to the front over TURN_MS while the rack glides for at most 620, and
         `flipped` does not clear until that swing lands — so every cover crossed was painted onto the back
         panel, behind the face the reader was watching, and the rack appeared to jump straight to its
         destination. The two faces are cheap next to being able to disagree about which product this is.
         `false` skips sizeCase alone: it forces layout and the case cannot change size between two covers. */
      drawFront(items[k], false);
      drawBack(items[k]);
    }
    slide.style.translate = (off * CASE_TRAVEL * (caseW || 260)).toFixed(1) + 'px';
    /* GONE BY THE HANDOVER. Opacity reaches 0 at half a box either side, which is the only moment the artwork
       is swapped, so the exchange itself is never on screen however fast the rack is moving. */
    slide.style.opacity = (1 - Math.min(1, Math.abs(off) * 2)).toFixed(3);
  }

  /* Both faces, measured, once the rack is still. */
  function settleCase() {
    showing = at;
    drawFront(items[at], true);
    drawBack(items[at]);
    slide.style.translate = '0px';
    slide.style.opacity = '1';
  }

  /* ---- which way the case is facing ----
   *
   * ONE ANGLE, and every rest pose is a half turn from the last. -20 shows the front with its spine rim toward
   * the reader; -200 shows the back the same way; -380 is the front again. Nothing here tracks a boolean and an
   * angle separately, so they cannot disagree about which face is out.
   */
  const REST = -20;         // degrees the case sits at, turned enough to show a rim
  let turn = REST, tilt = 2;
  /* WHICH HALF TURN THE CASE IS ON, as a whole number. A legal rest pose is REST + k * 180 and this is that k,
     so it is the state and the angle is derived from it rather than the other way round. */
  let aim = 0;
  const restAt = (k) => REST + k * 180;

  function faceOut(t) {
    // 0 = front toward the reader, 1 = back. Rounding the half-turns is the whole test.
    return Math.abs(Math.round((t - REST) / 180) % 2) === 1;
  }

  /* BOTH LAYERS OFF ONE ANGLE, written in the same frame. The print is a CSS transform and the wireframe is a
     path rebuild, and there is no way to hand those to two different clocks and have them agree. */
  /* A FACE TURNED EDGE ON CARRIES NO READABLE INK, so it fades out instead of painting at full strength into a
     few pixels. Without this the spine stays pure white as it compresses — measured at 160 degrees it was nine
     pixels of screen still holding the whole name — and it reads as a sliver stuck to the edge of the box rather
     than as type on a rim. The floor is above zero width on purpose: a face that vanishes exactly at grazing
     pops, and one that fades from about a quarter facing does not. */
  /* HOW PRESENT A FACE IS, from how squarely it faces the reader. f is the cosine of that angle: 1 square on, 0 edge
     on, negative when it is the far side seen through the case.
     ONE CONTINUOUS RAMP, not two clamped ones. Two ramps with a dead zone leave both terms zero near edge-on, so
     every face switches off across a wide window and switches back on. A face turning away should fade, and reach
     nothing only where it truly has no area, which is edge-on and nowhere else.
     The two sides differ by a multiplier, not by a separate curve, so the crossover at edge-on is continuous. */
  const THROUGH = .3;
  const LOCK_THROUGH = .2;   // how much of THAT the lockup gets when it is the far face
  const fade = (a) => Math.min(1, a / .28);
  const facing = (f) => (f > 0 ? 1 : THROUGH) * fade(Math.abs(f));

  /* A face moves under the drawing the moment it turns away, and back over it when it comes round. Only on the
     sign change — this runs on every frame of a drag.
     NOT named place(): the reel's fan layout already owns that name in this scope, and a second declaration
     hoists over the first, so calling it took the whole carousel out. */
  function depthSort(el, f) {
    if (!el) return;
    const host = f >= 0 ? print : printFar;
    if (el.parentNode !== host) host.appendChild(el);
  }

  function apply() {
    const t = 'rotateY(' + turn.toFixed(1) + 'deg) rotateX(' + tilt.toFixed(1) + 'deg)';
    print.style.transform = t;
    printFar.style.transform = t;
    /* HOW SQUARELY EACH FACE POINTS AT THE READER, from the REAL normal after both rotations. Reading the yaw alone
       means pitch cannot reveal anything — turning the case upside down leaves the front still counted as
       front-facing. CSS applies `rotateY(turn) rotateX(tilt)` right to left, so a face normal n comes out as
       Ry(turn) · Rx(tilt) · n, and what matters is the z of that. */
    const a = turn * Math.PI / 180, b = tilt * Math.PI / 180;
    const fF = Math.cos(b) * Math.cos(a), fS = Math.sin(a);
    depthSort(front, fF); depthSort(back, -fF); depthSort(spineFace, fS);
    front.style.opacity = facing(fF);
    back.style.opacity = facing(-fF);
    /* THE PRINT GOES QUIETER THAN THE PICTURE WHEN THE FACE TURNS AWAY. Seen through the case, the cover's
       artwork reads as printing behind glass and is worth keeping; its TITLE does not — it is white, it is the
       largest thing on the box, and reversed across the back panel it competed with the copy that panel exists
       to carry. One multiplier on top of the face's own fade, so both still reach nothing at edge-on and the
       handover stays continuous. */
    front.style.setProperty('--through', fF > 0 ? '1' : String(LOCK_THROUGH));
    if (spineFace) spineFace.style.opacity = facing(fS);
    paint();
  }

  function setTurn(t) {
    turn = t;
    apply();
    // Resynced from the real angle, so a drag that lands anywhere cannot leave the grid index behind.
    aim = Math.round((t - REST) / 180);
    flipped = faceOut(t);
    caseEl.classList.toggle('flipped', flipped);
    flipBtn.querySelector('span').textContent = flipped ? 'Front' : 'Turn it over';
  }

  /* ---- the swing ----
   *
   * TWEENED BY HAND, because the wireframe cannot be transitioned. The easings are the ones the stylesheet used
   * to carry: a settle for a deliberate turn, and a spring with a touch of overshoot for the way home from a
   * drag — which is what a hinged plastic thing does when you let go of it.
   */
  /* REDUCED MOTION LANDS THE TWEEN, IT DOES NOT CANCEL THE MOVE. Both animations below are hand-written
     because neither the wireframe nor the rack's fan can be transitioned by the stylesheet, so the media query
     cannot reach them and has to be asked here. The cover still turns over on its timer and the rack still
     steps — they simply arrive rather than travel. */
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const EASE_TURN = K.easeOutCubic;
  const EASE_SPRING = (p) => {
    const c = 1.7;
    return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
  };

  let swing = 0;
  /* When the turn in flight will land, so the auto-turn below can wait it out. */
  let swingEnds = 0;

  function swingTo(toTurn, toTilt, ms, ease) {
    cancelAnimationFrame(swing);
    if (reduced.matches) {
      swing = 0; swingEnds = 0;
      turn = toTurn; tilt = toTilt;
      apply(); setTurn(toTurn);
      return;
    }
    swingEnds = performance.now() + ms;
    const fromTurn = turn, fromTilt = tilt;
    let t0 = 0;
    const step = (ts) => {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / ms);
      const e = ease(p);
      turn = fromTurn + (toTurn - fromTurn) * e;
      tilt = fromTilt + (toTilt - fromTilt) * e;
      apply();
      if (p < 1) { swing = requestAnimationFrame(step); return; }
      swing = 0;
      setTurn(toTurn);
    };
    swing = requestAnimationFrame(step);
  }

  /* EVERY TURN AIMS AT A GRID POSE, never at an offset from wherever the case happens to be.
     flip() used to ask for `turn - 180`, read off the LIVE angle — and swingTo cancels the frame in flight, so
     interrupting a turn took some arbitrary mid-swing value as the new origin. Moving through the rack faster
     than the swing therefore landed the case off a face and KEPT the error, which compounds: measured,
     eight steps 120ms apart ended at -949.5 degrees, 5.16 half turns from rest — stuck 29 degrees askew with
     the button still naming a face. Rounding on the way in cannot drift, whatever interrupts it. */
  function turnTo(k, ms, ease) {
    aim = k;
    /* THE LABEL FOLLOWS THE INTENT, NOT THE LANDING. `flipped` was written only by setTurn, which swingTo calls
       when the swing ENDS — so for a whole swing every reader of it, go() included, got the face it was leaving
       rather than the one it was going to, and a fast run through the rack turned the wrong way. */
    flipped = Math.abs(k % 2) === 1;
    caseEl.classList.toggle('flipped', flipped);
    flipBtn.querySelector('span').textContent = flipped ? 'Front' : 'Turn it over';
    swingTo(restAt(k), 2, ms || TURN_MS, ease || EASE_TURN);
  }

  function flip() {
    turnTo(aim - 1);
  }

  flipBtn.addEventListener('click', flip);

  /* ---- and it turns itself over ----
   *
   * A BEAT ON THE ART, THEN THE RECORD. The back panel carries the outcome, the employer and the dates, and a
   * reader who never presses the button never learns it is there — so the case shows it unasked, once the cover
   * has had long enough to be read as a cover.
   *
   * ARMED BY A CHANGE OF COVER AND BY NOTHING ELSE. Turning it back to the front by hand has to stick, or the
   * button cannot be used at all: the reader presses Front, the wait elapses and the case overrules them. So a
   * manual turn never re-arms this, while a turn already pending still fires — pointing at the back yourself
   * before the wait is up is not a reason to cancel a move to the back.
   */
  /* THE TWO TIMES THE CASE IS JUDGED BY, TOGETHER. They are easy to confuse and they answer different
     questions: TURN_MS is how long a half turn TAKES, AUTO_TURN_MS is how long the cover is left alone BEFORE
     one starts. A reader sees their sum — half a second of art, then three quarters of a second of turning. */
  const TURN_MS = 750;         // how long a half turn takes
  const AUTO_TURN_MS = 500;    // how long a new cover is left face up first
  let autoTurn = 0;

  /* COUNTED FROM WHEN THE COVER IS ACTUALLY STILL, which is the later of the rack landing and the turn landing.
     This was armed on the rack alone, and the two are independent: go() starts a TURN_MS unflip while the rack
     glides for as little as 320ms, so a one-step move armed the wait at 320, fired it at 820 — and the case
     reached the front at 750 and set off back 70ms later. The reader sees a bounce, not a turn. */
  function armAutoTurn() {
    clearTimeout(autoTurn);
    const busy = Math.max(0, swingEnds - performance.now());
    autoTurn = setTimeout(() => { if (!flipped) flip(); }, busy + AUTO_TURN_MS);
  }

  /* ---- and the case can be picked up ----
   *
   * DRAG TURNS IT, LETTING GO PUTS IT BACK. The rest pose is the stylesheet's and the drag is an offset on top,
   * so the two never disagree and releasing is a matter of clearing two properties rather than working out
   * which angle the case is supposed to return to.
   *
   * UNCLAMPED, both axes. It was bounded to keep the case from winding through several turns and landing on its
   * back while the button still said "turn it over" — but the case springs home on release, so there is no
   * landing to be wrong about, and being able to turn it right round is the whole reason to pick it up.
   */

  const TURN_PER_PX = .5;   // degrees of yaw per pixel dragged sideways
  let turnAtGrab = REST;
  const TILT_PER_PX = .3;   // degrees of pitch per pixel dragged up or down

  let grab = null;

  caseBody.addEventListener('pointerdown', (e) => {
    /* A LINK IS NOT A HANDLE. setPointerCapture below sends every later event — the CLICK included — to the case
       body, so an anchor inside it never sees its own click and the company link was completely inert. Not
       starting the grab at all is what leaves the anchor its normal behavior; the case is still a drag surface
       everywhere else, and a name is small enough that losing it as a handle costs nothing. */
    if (e.target.closest && e.target.closest('a')) return;
    grab = { x: e.clientX, y: e.clientY, moved: 0 };
    turnAtGrab = turn;
    cancelAnimationFrame(swing);
    swing = 0;
    caseBody.classList.remove('springing');
    caseBody.classList.add('held');
    caseBody.setPointerCapture(e.pointerId);
  });

  caseBody.addEventListener('pointermove', (e) => {
    if (!grab) return;
    const dx = e.clientX - grab.x, dy = e.clientY - grab.y;
    grab.moved = Math.max(grab.moved, Math.abs(dx), Math.abs(dy));
    /* Straight to the angle, no tween: a hand on the case is the clock, and easing under it is lag. */
    tilt = 2 + -dy * TILT_PER_PX;
    turn = turnAtGrab + dx * TURN_PER_PX;
    apply();
  });

  const drop = (e) => {
    if (!grab) return;
    grab = null;
    caseBody.classList.remove('held');
    caseBody.classList.add('springing');
    /* SNAPS TO THE FACE YOU ARE LOOKING AT, not back to the front. Turn it past halfway and let go and it settles
       showing its back, because that is the face the reader chose — springing home to the front would undo the
       thing they just did. The nearest half turn is always within ninety degrees, so it is always a short move,
       and the spring carries the drawing and the print together. */
    turnTo(Math.round((turn - REST) / 180), 620, EASE_SPRING);
    if (e && e.pointerId != null && caseBody.hasPointerCapture(e.pointerId)) {
      caseBody.releasePointerCapture(e.pointerId);
    }
    /* The spring easing is only for the way home. Left on, the next FLIP would overshoot too, and a case that
       bounces every time it turns over reads as a wobble rather than as a hinge. */
    setTimeout(() => caseBody.classList.remove('springing'), 640);
  };
  caseBody.addEventListener('pointerup', drop);
  caseBody.addEventListener('pointercancel', drop);
  caseBody.addEventListener('lostpointercapture', drop);


  // ---------------------------------------------------------------- the playhead

  /* A NEW BOX ALWAYS ARRIVES FACE UP. Turning the case over is something the reader asked about ONE product,
     and carrying that state to the next one shows them a back they never turned. */
  function go(i) {
    const n = Math.max(0, Math.min(items.length - 1, i));
    const same = n === at;
    at = n;
    clearTimeout(autoTurn);
    if (!same && flipped) flip();
    slideTo(n);
    drawAct();
    drawFirms();
  }

  // ---------------------------------------------------------------- flicking through

  /* SIDEWAYS ONLY, and that is a decision rather than an omission. The page this lands in is scroll-driven top
     to bottom — the rail stops on beats and the scenes scrub off position — so a section that ate the vertical
     wheel would be fighting the whole document for the reader's most-used gesture. A trackpad's horizontal
     wheel is free, and so is a drag; both are the gesture somebody flicking through a crate already makes. */
  /* ONE DIRECTION FOR ALL THREE. Dragging right, wheeling right and pressing Right all walk the playhead the
     same way; arrows disagreeing with the drag is what made the rack feel mirrored. */
  let acc = 0;
  const WHEEL_STEP = 48;   // px of horizontal travel per box: a light flick moves one, not five.
  const DRAG_STEP = 34;    // px of drag per box, a little more than a blade so a slip does not jump two.

  /* SIDEWAYS BELONGS TO THE RACK WHENEVER THIS SECTION IS THE SCREEN, not only when the pointer happens to be
     over the reel. The section is a beat and fills the viewport when you are on it, so "is the reader here" is
     the honest test — a trackpad swipe or an arrow press aimed at the catalog should not depend on where the
     cursor was left. Owning the middle of the viewport is the test rather than any overlap, so the two screens
     either side of it can never both claim a gesture. */
  const catSec = document.getElementById('experience');
  function mine() {
    if (!catSec) return false;
    const r = catSec.getBoundingClientRect();
    const mid = (window.innerHeight || 1) / 2;
    return r.top < mid && r.bottom > mid;
  }
  /* nav.js reads this before it takes an arrow for the page's rail: down and up move between beats, left and
     right move through the catalog, and neither has to know the other's rules. */
  window.AKCAT = { sideways: mine };

  window.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    if (!mine()) return;
    /* THE COMPANY BAR KEEPS ITS OWN SIDEWAYS. It scrolls horizontally too, and this handler claims every
       sideways gesture on the section — without this, a trackpad swipe over the chips drove the carousel and
       the bar could not be scrolled at all. */
    if (e.target && e.target.closest && e.target.closest('.firms')) return;
    e.preventDefault();
    acc += e.deltaX;
    while (Math.abs(acc) >= WHEEL_STEP) {
      go(at + (acc > 0 ? -1 : 1));
      acc -= acc > 0 ? WHEEL_STEP : -WHEEL_STEP;
    }
  }, { passive: false });

  /* Dragging the crate, the other half of the same gesture. Pointer events rather than mouse, so a touch flick
     and a trackpad drag are one code path. */
  let down = null;

  /* CAPTURE ONLY ONCE A DRAG HAS ACTUALLY STARTED, never on pointerdown.
     A captured pointer retargets the CLICK to the capturing element — so with the reel capturing from the first
     press, every click on a cover was delivered to the reel and no box's own handler ever ran. Clicking a blade
     did nothing at all, and only a synthetic click dispatched straight at the button appeared to work, which is
     what hid it from every probe here. Past the six-pixel threshold it is a drag and there is no click to lose. */
  reel.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, at: at, moved: 0, id: e.pointerId, held: false };
  });

  reel.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    down.moved = Math.max(down.moved, Math.abs(dx));
    if (!down.held && down.moved > 6) {
      reel.setPointerCapture(down.id);
      down.held = true;
    }
    if (!down.held) return;
    /* One blade of travel per box. SPREAD was the old fan's constant and did not survive the rewrite — with it
       undefined this whole handler threw on the first pointermove and dragging did nothing at all. */
    go(down.at - Math.round(dx / DRAG_STEP));
  });

  const release = (e) => {
    if (!down) return;
    /* A DRAG IS NOT A CLICK. Without this the pointerup ending a flick lands on whichever box finished under the
       cursor and jumps the crate a second time, to somewhere the reader never aimed at. */
    if (down.moved > 6) {
      reel.addEventListener('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); },
                            { capture: true, once: true });
    }
    const held = down.held, id = down.id;
    down = null;
    if (held && id != null && reel.hasPointerCapture(id)) reel.releasePointerCapture(id);
  };
  reel.addEventListener('pointerup', release);
  reel.addEventListener('pointercancel', release);

  /* Arrows step the crate from anywhere on this screen. nav.js yields left and right to AKCAT.sideways() above,
     so the section's arrows and the page's beats never fight for the same press — and the reader does not have
     to find and focus the reel first. */
  window.addEventListener('keydown', (e) => {
    if (!mine() || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
    // Never take a key from something that wants it: a field, or the QR trigger.
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    /* RIGHT WALKS TOWARD THE BLADES ON THE RIGHT, which is FORWARD through the record: the rack is laid out
       newest first from its left edge, so higher indices sit further right and pressing right has to raise the
       index. It was inverted, from when the fan was centerd and the rack traveled under a fixed playhead —
       with the rack left-aligned it is the covers that move past you, and the arrow has to point the way they
       go. */
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    go(at + d);
    /* Focus follows the selection only if the rack already had it. Moving focus into the rack from elsewhere
       would scroll the page to it, which on a section that IS the screen is a jump for no reason. */
    if (reel.contains(document.activeElement)) boxes[at].focus();
  });

  // The kit's resize channel already carries load and a body observer, so both of these arrive once per frame.
  K.onResize(place);
  K.onResize(sizeCase);

  /* setTurn first: stepCase asks which face is out before it decides which one to draw, and go(0) runs the
     whole placement. */
  setTurn(REST);
  go(0);
})();
