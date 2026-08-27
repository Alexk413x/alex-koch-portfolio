/* catalog.js — the back catalog: seventeen shipped products as a rack of cases and one display case.
 *
 * Reads every product and every proof straight from the markup in index.html, never from a data array, so a
 * crawler with no JavaScript still gets all seventeen records. case3d.js draws the case's wireframe; this file
 * owns the rack, the company bar and what the case shows. Cover art lives in site/cover-art/, one module per
 * product keyed by the record's own id; the lockup text is built here so it stays selectable and reflows.
 */
import { coverArt } from './cover-art/index.js';

(function () {
  // A global from site/kit.js, a classic script like every file here — converting only this one would change
  // how the page loads, not what it does.
  const K = window.AKKIT;

  const shelf = document.getElementById('shelf');
  const reelHost = document.getElementById('reel');
  if (!shelf || !reelHost) return;

  const txt = (n, sel) => {
    const e = n && n.querySelector(sel);
    return e ? e.textContent.replace(/\s+/g, ' ').trim() : '';
  };

  // Acts come from the spines' own labels, in page order, first appearance wins.
  const acts = [];
  Array.prototype.forEach.call(shelf.querySelectorAll('.spine-face'), (face) => {
    const ref = face.getAttribute('aria-controls') || '';
    const proof = document.getElementById(ref);
    if (!proof) return;

    const label = txt(face, '.p-domain');
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
      // `data-cover-title` overrides the default line break for names it gets wrong (Self Pickup, Housekeeping).
      tag: txt(face, '.p-tag'),
      lines: (face.getAttribute('data-cover-title') || '').split('|').filter(Boolean),
      marks: Array.prototype.map.call(face.querySelectorAll('.p-marks i'), (i) => i.textContent.trim()),
      // Kit tools/features belong to the role, not the product; lede is the pitch, wins are the outcome
      // (records not yet rewritten carry wins only). Cloned as nodes, not text — textContent would flatten
      // the <b> tags around figures.
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
      // Read from attributes, not text — the h4's text names the employer in the company bar, the jump list
      // and the chip, so folding "(Contract: ...)" into it would rename the employer everywhere.
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
      // Real anchors in index.html, not a table here — a no-JS crawler still finds the store link.
      stores: Array.prototype.map.call(proof.querySelectorAll('.proof-get a'), (a) => ({
        store: a.getAttribute('data-store') || '',
        label: a.textContent.trim(),
        href: a.getAttribute('href')
      }))
    });
  });
  if (!acts.length) return;

  // Flat list in page order, act still attached to each item — acts and employers are contiguous, letting
  // the company bar jump instead of filter.
  const items = acts.reduce((all, a) => all.concat(a.items.map((it) => Object.assign({ act: a }, it))), []);
  // Numbered here, once, rather than typed onto each cover — so the kicker and the rack can't disagree.
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

  // A box's years are a range, not months: "Jul 2017 – Mar 2019" becomes "2017–2019", or one year if equal.
  function yearsOf(when) {
    const ys = (when || '').match(/\d{4}/g);
    if (!ys || !ys.length) return '';
    const a = ys[0], b = ys[ys.length - 1];
    return a === b ? a : a + '–' + b;
  }

  // Splits a long name at the word boundary nearest the middle, past 11 characters; data-cover-title
  // overrides it where that rule is wrong.
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

  // Sized from character count, not glyph widths, since this runs before the rack is laid out; two-line
  // titles share one scale across the whole set.
  function titleScale(lines) {
    const longest = Math.max.apply(null, lines.map((l) => l.length));
    if (lines.length > 1) return Math.min(0.13, 1.15 / longest);
    if (longest <= 3) return 0.2;
    return Math.min(0.1867, 1.27 / longest);
  }

  // Draws one face (art + lockup) as a fragment, so the rack blade and the stage case share identical markup.
  function buildCover(p) {
    const frag = document.createDocumentFragment();
    const art = coverArt(p.id);
    if (art) frag.appendChild(art);

    const lock = el('div', 'cover-lock');
    // cover-head is the scrim only; the lines are its siblings so offsets are % of the FACE — see site.css.
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

  // The flip rack: every box's position, angle and depth is one function of `i - pos` — see place().
  const BLADE = 79;     // degrees the flanking covers stand at — measured: 104° reads edge-on and vanishes.
  // RIM (blade width shown) and STEP (spacing) are independent — tying them makes a wider fan a thicker case.
  const RIM = 18;       // shown rim per blade; at 12 the name nearly touched the next cover.
  const STEP = 24;      // px between blade centers — RIM plus 6px of daylight, so names stay clear of the fan.
  const LIFT = 60;      // px the facing cover stands in front of the fan
  // Every blade sits at the same depth (no recede), which would shrink far names via the perspective divide.
  const REACH = 16;     // blades drawn each side: all of them.
  // CURVE = 1 is even spacing — a curve under 1 buys near blades room by crowding the already-hard-to-read tail.
  const CURVE = 1;
  const SPAN = REACH * STEP;   // total half-width the fan is allowed
  const gap = (n) => SPAN * Math.pow(Math.min(n, REACH) / REACH, CURVE);

  const reel = document.getElementById('reel');
  const reelAct = document.getElementById('reel-act');

  const boxes = items.map((p, i) => {
    const b = el('button', 'box');
    b.type = 'button';
    b.dataset.id = p.id;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-label', p.name + ', ' + p.at);
    // The stage case's own wireframe, at rack size — a bordered div can't follow curved corners or turn in 3D.
    const wire = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    wire.setAttribute('class', 'c3-wire box-wire');
    wire.setAttribute('aria-hidden', 'true');
    b.appendChild(wire);
    const print = el('div', 'box-print');
    const face = el('div', 'box-face');
    face.appendChild(buildCover(p));
    print.appendChild(face);
    b._face = face;
    // Spine on both rims, cover on one — blades lean either way in the symmetric fan; no back panel, never seen.
    b._rims = ['l', 'r'].map((side) => {
      const rim = el('div', 'box-spine box-spine-' + side);
      rim.appendChild(el('span', null, p.name));
      print.appendChild(rim);
      return rim;
    });
    b.appendChild(print);
    b._print = print;
    // 8 corner samples vs. the stage case's 18 — facets show here, but only the centered blade redraws most
    // frames.
    b._draw = window.CASE3D ? window.CASE3D.make(wire, 8, true) : null;
    b.addEventListener('click', () => go(i));
    reel.appendChild(b);
    return b;
  });

  // `pos` is the rack's tweened position, `at` the integer box — tweened by hand, since a CSS transition
  // can't stay in sync with the drawn wireframe.
  let pos = 0, glide = 0;

  // Corrected by measurement, not predicted: closed-form estimates of a turned cover's width came up
  // consistently short (cover, box and reel each add their own perspective), so place() reads the rack's
  // real left edge each frame and folds the error back in here.
  let shiftFix = 0;

  // Eases `pos` toward `target`, then settles the case and arms the auto-flip once the rack stops moving.
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
      // Counted from settling, not the keypress, or a cross-rack glide (up to 620ms) would arm mid-move.
      settleCase();
      armAutoTurn();
    };
    glide = requestAnimationFrame(step);
  }

  // Sizes and positions every blade for `pos`, then places the rack and steps the stage case. Box size is
  // derived from the column's fixed-block heights, never from the rack's own size, or the feedback would
  // walk the rack down to nothing over a few frames.
  function place() {
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
    // `fit` is the widest cover whose leaning projection still fits height h — a blade's near edge swings to
    // z=w/2·sin(BLADE), magnified by the perspective divide; unaccounted for, tall windows clipped by 6-8px.
    const fit = h * P / ((4 / 3) * P + h * k);
    // Reserved once, not twice, since place() positions the rack by its own left edge, not pinned to the cover.
    const room = reel.clientWidth - REACH * STEP - 24;
    if (h > 40) reel.style.setProperty('--box-w', Math.max(90, Math.min(Math.round(fit), room)) + 'px');

    // Sized to the rack's projected height, not the column's remainder, or the carousel floats in empty space.
    const bwNow = parseFloat(getComputedStyle(reel).getPropertyValue('--box-w')) || 0;
    if (bwNow) {
      const tall = (4 / 3) * bwNow * P / (P - k * bwNow);
      reel.style.height = Math.min(h, Math.ceil(tall) + 10) + 'px';
    }

    const bw = boxes[0].offsetWidth || 1, bh = boxes[0].offsetHeight || 1;
    // Depth derives from RIM/sin(BLADE), not the case's own ratio — that once made a 17px rim overlap a
    // 12px step.
    const bd = Math.max(5, Math.round(RIM / Math.sin(BLADE * Math.PI / 180)));
    reel.style.setProperty('--blade-w', bw + 'px');
    reel.style.setProperty('--blade-d', bd + 'px');
    reel.style.setProperty('--blade-step', RIM + 'px');

    const half0 = bw / 2;
    // A turned cover's half-width: foreshortened by cos(angle), then magnified by the perspective divide as
    // it swings to +z.
    const hw = (t) => {
      const a = BLADE * t * Math.PI / 180;
      // z includes LIFT, not just the turn's swing — omitting it undercounted the facing cover (194 vs. 203)
      // and misaligned the rack.
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

      // translate(-50%) is written first so it applies LAST — the cover turns about its own center, then
      // shifts onto the reel's center line. One continuous expression for every position, `turn` ramping
      // each term in over the first step.
      const half = bw / 2;
      const x = side * (turn * (half + 4) + gap(far));
      const z = LIFT * (1 - turn);
      const yaw = -side * BLADE * turn;

      b.style.transform = 'translate(-50%, 0) translate3d(' + (x - shift).toFixed(1) + 'px, 0, ' +
                          z.toFixed(1) + 'px)';
      b._print.style.transform = 'rotateY(' + yaw.toFixed(1) + 'deg)';

      // Redrawn only when angle or size changed — most frames turn only a few blades, not all seventeen.
      if (b._draw && shown) {
        const key = bw + '|' + bh + '|' + bd + '|' + yaw.toFixed(1);
        if (b._key !== key) { b._key = key; b._draw(bw, bh, bd, yaw, 0); }
      }
      // Nearest to the front wins, whichever side it is on. The facing cover is always on top.
      b.style.zIndex = String(100 - Math.round(far));
      // Hidden (not merely faint) past REACH — a 5%-opacity box still costs a layer and answers the pointer.
      // Set as a property, not inline opacity, so the stylesheet's company-highlight dimming can still apply.
      b.style.setProperty('--vis', shown ? '1' : '0');
      b._print.style.pointerEvents = shown ? 'auto' : 'none';
      b.classList.toggle('picked', i === at);
      b.classList.toggle('blade', i !== at);
      b.setAttribute('aria-selected', i === at ? 'true' : 'false');
    });

    // Measured over the rims too — a spine face projects past the print (42px vs 36px, clipping 4px). Aligned
    // to the column's fixed rail, not centered, since the span shifts ~40px between a cover and a blade
    // leading.
    const rr = reel.getBoundingClientRect();
    const want = rr.left + 2;
    let got = Infinity;
    boxes.forEach((b) => {
      if (b.style.getPropertyValue('--vis') === '0') return;
      got = Math.min(got, b._print.getBoundingClientRect().left);
      b._rims.forEach((r) => { got = Math.min(got, r.getBoundingClientRect().left); });
    });

    // Clamped, so a bad frame during a resize cannot walk the rack off the column.
    if (got < Infinity) shiftFix = Math.max(-400, Math.min(400, shiftFix + (got - want)));

    stepCase();
  }


  // States only the act name, since the position and company are already visible elsewhere.
  function drawAct() {
    reelAct.textContent = items[at].act.act + ': ' + items[at].act.says;
  }

  const firmsEl = document.getElementById('firms');

  // Employers in page order, first appearance wins — the index each jumps to is that company's first product.
  const firms = [];
  items.forEach((p, i) => {
    if (!firms.some((f) => f.name === p.at)) firms.push({ name: p.at, at: i });
  });

  // Highlights every box shipped by `name`, so hovering/focusing answers "which of these are theirs".
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

  // A plain wheel has no deltaX, so without this the bar is trackpad-only; releases at either scroll limit.
  firmsEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;   // sideways already works on its own
    const max = firmsEl.scrollWidth - firmsEl.clientWidth;
    if (max <= 0) return;
    if ((e.deltaY > 0 && firmsEl.scrollLeft >= max - 1) ||
        (e.deltaY < 0 && firmsEl.scrollLeft <= 1)) return;
    e.preventDefault();
    firmsEl.scrollLeft = Math.max(0, Math.min(max, firmsEl.scrollLeft + e.deltaY));
  }, { passive: false });

  const FADE = 34;
  // Fades appear only on the side with more to scroll, or the last chip stays half-hidden under one.
  function edges() {
    const max = firmsEl.scrollWidth - firmsEl.clientWidth;
    firmsEl.style.setProperty('--fade-l', (firmsEl.scrollLeft > 1 ? FADE : 0) + 'px');
    firmsEl.style.setProperty('--fade-r', (firmsEl.scrollLeft < max - 1 ? FADE : 0) + 'px');
  }
  firmsEl.addEventListener('scroll', edges, { passive: true });

  // Measured against the scroller's rect, not offsetLeft — relative to the wrong ancestor here, by 303px.
  function firmSpan(b) {
    const br = b.getBoundingClientRect(), fr = firmsEl.getBoundingClientRect();
    const l = br.left - fr.left + firmsEl.scrollLeft;
    return { l: l, r: l + br.width };
  }

  // Current chip and last scroll direction, held across calls, since several items can share an employer.
  let firmAt = -1, firmDir = 1;

  // Scrolls to clear both fades, plus a peek of the neighbor ahead — answers "what's next", not just "where".
  function revealFirm(b, idx, dir) {
    const max = firmsEl.scrollWidth - firmsEl.clientWidth;
    if (max <= 0) return;
    const span = firmSpan(b);
    const l = span.l, r = span.r, view = firmsEl.scrollLeft, w = firmsEl.clientWidth;
    let to = view;
    if (r + FADE > view + w) to = r + FADE - w;
    else if (l - FADE < view) to = l - FADE;

    // Peeks only in the direction of travel, and never at the current chip's own expense.
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

  // One redraw per angle: case3d.js projects the outline and rebuilds five paths, while the print layer gets
  // the same two angles via CSS — nothing here measures the DOM, since a drag runs it per frame.
  const wire = window.CASE3D ? window.CASE3D.make(document.getElementById('case-wire')) : null;
  let caseW = 0, caseH = 0, caseD = 0;

  function sizeCase() {
    const body = document.getElementById('case-body');
    if (!body) return;
    const w = body.offsetWidth, h = body.offsetHeight;
    if (w < 20) return;
    caseW = w;
    caseH = h;
    // A real case is about 1/14 of its width thick; this is 1/11 — enough for a hairline to read, no more.
    caseD = Math.max(14, Math.round(w / 11));
    body.style.setProperty('--case-d', caseD + 'px');
    body.style.setProperty('--case-w', w + 'px');
    paint();
  }

  function paint() {
    if (wire && caseW) wire(caseW, caseH, caseD, turn, tilt);
  }

  // `measure` skips sizeCase during the glide (it forces layout, and size can't change between two covers).
  function drawFront(p, measure) {
    front.replaceChildren();
    front.appendChild(buildCover(p));
    if (spine) spine.textContent = p.name;
    if (measure !== false) sizeCase();
  }

  // An anchor when the record names a site, plain text otherwise, so a missing URL degrades, not dead-links.
  function linkOr(text, href, cls) {
    if (!href) return el('span', cls, text);
    const a = el('a', cls, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  // The two stores' supplied badges, with the wording each requires as the alt text.
  const BADGE = {
    play: { file: './store-badges/google-play.png', alt: 'Get it on Google Play' },
    ios:  { file: './store-badges/apple-black.svg', alt: 'Download on the App Store' }
  };

  // Clones src's children onto a new element; sliced first, or appendChild would skip nodes mid-walk.
  function copyOf(tag, cls, src) {
    const out = el(tag, cls);
    Array.prototype.slice.call(src.cloneNode(true).childNodes).forEach((n) => out.appendChild(n));
    return out;
  }

  function drawBack(p) {
    back.replaceChildren();
    // The role leads, not the product — the front, spine and rack all already name the product.
    back.appendChild(el('div', 'b-lead', p.role));

    const where = el('div', 'b-at');
    where.appendChild(linkOr(p.at, p.atSite, 'firm'));
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

    p.ledeEls.forEach((el) => back.appendChild(copyOf('p', 'b-lede', el)));
    if (p.winEls.length) {
      const wins = el('ul', 'b-wins');
      p.winEls.forEach((li) => wins.appendChild(copyOf('li', null, li)));
      back.appendChild(wins);
    }

    // Badges are the stores' own supplied artwork, resolved off import.meta.url. `get` is always appended,
    // even empty, since it carries the margin-top:auto that pins both foot blocks — omitting it would let
    // .b-spec take over the pinning and open a gap.
    const get = el('div', 'b-get');
    if (p.stores.length) {
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

    // One row, no headings — split, they read as indistinguishable without labels. Features first, then kit.
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

  // Reads `pos` directly instead of its own timeline, or a fast multi-box glide would show a stall.
  const CASE_TRAVEL = 1.35;   // case widths a cover crosses between one box and the next
  let showing = -1;

  function stepCase() {
    const k = Math.max(0, Math.min(items.length - 1, Math.round(pos)));
    const off = k - pos;                    // -.5 to .5, and exactly 0 once the glide has landed
    if (k !== showing) {
      showing = k;
      // Draws both faces, not just whichever is showing: reading `flipped` here was a bug — go() unflips the
      // case over TURN_MS while the rack glides for as little as 620ms, so a fast crossing painted the new
      // cover onto the hidden back panel.
      drawFront(items[k], false);
      drawBack(items[k]);
    }
    slide.style.translate = (off * CASE_TRAVEL * (caseW || 260)).toFixed(1) + 'px';
    // Opacity reaches 0 at half a box either side — the only moment art is swapped, so it's never on screen.
    slide.style.opacity = (1 - Math.min(1, Math.abs(off) * 2)).toFixed(3);
  }

  function settleCase() {
    showing = at;
    drawFront(items[at], true);
    drawBack(items[at]);
    slide.style.translate = '0px';
    slide.style.opacity = '1';
  }

  // Each rest pose is a half turn from the last (REST=front, REST-180=back), so nothing tracks a face as a
  // boolean that could disagree with the angle.
  const REST = -20;         // degrees the case sits at, turned enough to show a rim
  let turn = REST, tilt = 2;
  // Which half-turn the case is on — REST + k*180 is a legal pose, and k is the real state, angle derived
  // from it.
  let aim = 0;
  const restAt = (k) => REST + k * 180;

  function faceOut(t) {
    return Math.abs(Math.round((t - REST) / 180) % 2) === 1;
  }

  // Both layers driven from one angle in one frame, since the print (CSS) and wireframe (path rebuild) can't
  // use different clocks. Fades near edge-on, not full-strength into a sliver — measured 9px wide at 160°.
  const THROUGH = .3;
  const LOCK_THROUGH = .2;   // how much of THROUGH the lockup gets when it is the far face
  const fade = (a) => Math.min(1, a / .28);
  const facing = (f) => (f > 0 ? 1 : THROUGH) * fade(Math.abs(f));

  // Named depthSort, not place() — a second same-named function here would hoist over the reel's own place()
  // and silently disable it.
  function depthSort(el, f) {
    if (!el) return;
    const host = f >= 0 ? print : printFar;
    if (el.parentNode !== host) host.appendChild(el);
  }

  function apply() {
    const t = 'rotateY(' + turn.toFixed(1) + 'deg) rotateX(' + tilt.toFixed(1) + 'deg)';
    print.style.transform = t;
    printFar.style.transform = t;
    // The real face normal after both rotations, not just yaw — CSS applies rotateY(turn) then rotateX(tilt)
    // right-to-left, so a face normal n becomes Ry(turn)·Rx(tilt)·n, and only z of that matters.
    const a = turn * Math.PI / 180, b = tilt * Math.PI / 180;
    const fF = Math.cos(b) * Math.cos(a), fS = Math.sin(a);
    depthSort(front, fF); depthSort(back, -fF); depthSort(spineFace, fS);
    front.style.opacity = facing(fF);
    back.style.opacity = facing(-fF);
    // Title fades faster than the art turning away — it's the largest, whitest element and fights the back copy.
    front.style.setProperty('--through', fF > 0 ? '1' : String(LOCK_THROUGH));
    if (spineFace) spineFace.style.opacity = facing(fS);
    paint();
  }

  function setTurn(t) {
    turn = t;
    apply();
    // Resynced from the real angle, not incremented, so a drag landing anywhere can't leave the index behind.
    aim = Math.round((t - REST) / 180);
    flipped = faceOut(t);
    caseEl.classList.toggle('flipped', flipped);
    flipBtn.querySelector('span').textContent = flipped ? 'Front' : 'Turn it over';
  }

  // Tweened by hand, since neither layer can be transitioned by the stylesheet; reduced-motion still gets
  // every turn and step, just without the travel time.
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const EASE_TURN = K.easeOutCubic;
  const EASE_SPRING = (p) => {
    const c = 1.7;
    return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
  };

  let swing = 0;
  let swingEnds = 0;   // when the turn in flight will land, so the auto-turn below can wait it out

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

  // Always aims at a grid pose (restAt(k)), never an offset from the live angle — reading the live angle lets
  // an interrupted turn compound its error: measured, eight 120ms-apart steps left the case 29° off a face.
  function turnTo(k, ms, ease) {
    aim = k;
    // Set from intent, not the swing's landing — reading `flipped` mid-swing named the face being left, not
    // the one arriving.
    flipped = Math.abs(k % 2) === 1;
    caseEl.classList.toggle('flipped', flipped);
    flipBtn.querySelector('span').textContent = flipped ? 'Front' : 'Turn it over';
    swingTo(restAt(k), 2, ms || TURN_MS, ease || EASE_TURN);
  }

  function flip() {
    turnTo(aim - 1);
  }

  flipBtn.addEventListener('click', flip);

  // Auto-flips to the back after a beat, so a reader who never presses the button still sees the outcome and
  // the employer. Armed only by a cover changing, so a manual turn back to front sticks.
  const TURN_MS = 750;         // how long a half turn takes
  const AUTO_TURN_MS = 500;    // how long a new cover is left face up first
  let autoTurn = 0;

  // Counted from whichever lands later, the rack settling or the turn landing — arming off the rack alone let
  // a 320ms glide fire the timer at 820ms while a 750ms turn finished 70ms after, reading as a bounce.
  function armAutoTurn() {
    clearTimeout(autoTurn);
    const busy = Math.max(0, swingEnds - performance.now());
    autoTurn = setTimeout(() => { if (!flipped) flip(); }, busy + AUTO_TURN_MS);
  }

  // Dragging turns the case; releasing springs it home — unclamped, since release always corrects the landing.

  const TURN_PER_PX = .5;   // degrees of yaw per pixel dragged sideways
  let turnAtGrab = REST;
  const TILT_PER_PX = .3;   // degrees of pitch per pixel dragged up or down

  let grab = null;

  caseBody.addEventListener('pointerdown', (e) => {
    // Skips the grab on a link target — setPointerCapture below would retarget its click to the case body.
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
    // Straight to the angle, no tween: a hand on the case is the clock, and easing under it is lag.
    tilt = 2 + -dy * TILT_PER_PX;
    turn = turnAtGrab + dx * TURN_PER_PX;
    apply();
  });

  const drop = (e) => {
    if (!grab) return;
    grab = null;
    caseBody.classList.remove('held');
    caseBody.classList.add('springing');
    // Snaps to whichever face is closer, not the front, so releasing past halfway keeps the back you turned to.
    turnTo(Math.round((turn - REST) / 180), 620, EASE_SPRING);
    if (e && e.pointerId != null && caseBody.hasPointerCapture(e.pointerId)) {
      caseBody.releasePointerCapture(e.pointerId);
    }
    // Spring easing is only for the way home — left on, the next manual flip would overshoot too.
    setTimeout(() => caseBody.classList.remove('springing'), 640);
  };
  caseBody.addEventListener('pointerup', drop);
  caseBody.addEventListener('pointercancel', drop);
  caseBody.addEventListener('lostpointercapture', drop);


  // Moves to box i, always arriving face-up — a turned-over case answered a question about the last product.
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

  // Sideways gestures only — the page scrolls through pinned beats, so the wheel here would fight it.
  let acc = 0;
  const WHEEL_STEP = 48;   // px of horizontal travel per box: a light flick moves one, not five.
  const DRAG_STEP = 34;    // px of drag per box, a little more than a blade so a slip does not jump two.

  // True while the catalog fills the middle of the viewport, not gated on pointer hover.
  const catSec = document.getElementById('experience');
  function mine() {
    if (!catSec) return false;
    const r = catSec.getBoundingClientRect();
    const mid = (window.innerHeight || 1) / 2;
    return r.top < mid && r.bottom > mid;
  }
  // nav.js yields left/right to this before taking the page's own up/down rail.
  window.AKCAT = { sideways: mine };

  window.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    if (!mine()) return;
    // The company bar keeps its own horizontal scroll, or a swipe over the chips would drive the carousel.
    if (e.target && e.target.closest && e.target.closest('.firms')) return;
    e.preventDefault();
    acc += e.deltaX;
    while (Math.abs(acc) >= WHEEL_STEP) {
      go(at + (acc > 0 ? -1 : 1));
      acc -= acc > 0 ? WHEEL_STEP : -WHEEL_STEP;
    }
  }, { passive: false });

  let down = null;

  // Captured only once a drag starts, never on pointerdown, or it would retarget every later click to the reel.
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
    go(down.at - Math.round(dx / DRAG_STEP));
  });

  const release = (e) => {
    if (!down) return;
    // Swallows the click a drag's pointerup would otherwise fire on whatever box ends up under the cursor.
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

  // nav.js yields left/right here so the section's arrows and the page's beat rail never claim the same press.
  window.addEventListener('keydown', (e) => {
    if (!mine() || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    // Right raises the index — the rack lays out newest-first from the left, so higher indices sit further right.
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    go(at + d);
    // Focus follows the selection only if the rack already had it, or moving it in would scroll the page.
    if (reel.contains(document.activeElement)) boxes[at].focus();
  });

  K.onResize(place);
  K.onResize(sizeCase);

  // setTurn first: stepCase asks which face is out before it decides which one to draw.
  setTurn(REST);
  go(0);
})();
