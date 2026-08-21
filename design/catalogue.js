/* catalogue.js — the crate, the company bar and the display case.
 *
 * BUILT FROM THE RECORD, not written out, because this is a prototype about layout: seventeen boxes typed into
 * the markup would be seventeen places to fix every time a component changes. When the design settles it goes
 * into index.html the other way round — written out, so a crawler running no JavaScript reads all seventeen,
 * which is the rule the shipped shelf already keeps.
 */
(function () {
  'use strict';

  const acts = window.CATALOGUE || [];
  if (!acts.length) return;

  /* One flat list in page order, each item still knowing which act it came from. Acts are contiguous in the
     record and so are the employers, which is what lets the company bar be a jump rather than a filter. */
  const items = acts.reduce((all, a) => all.concat(a.items.map((it) => Object.assign({ act: a }, it))), []);

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
   * PLACEHOLDERS, and deliberately a SYSTEM of them rather than seventeen drawings: one axonometric wireframe
   * per domain, in the page's own scenery stroke, so the crate reads as a set while the real art is still a
   * later job. Every motif is built on the same 0-100 box and the same two strokes — `ink` for the object and
   * `lit` for the one edge that says what it is.
   */
  const ART = {
    // agentic — planes fanning off one another, which is what an orchestrator looks like from above
    agentic: (g) => {
      for (let i = 0; i < 4; i++) {
        const y = 34 + i * 13;
        g.appendChild(svg('path', { class: i === 0 ? 'lit' : 'ink',
          d: 'M50 ' + (y - 11) + ' L84 ' + y + ' L50 ' + (y + 11) + ' L16 ' + y + ' Z' }));
      }
      g.appendChild(svg('path', { class: 'ink', d: 'M16 34 L16 73 M84 34 L84 73' }));
    },
    // consumer — a phone slab in three-quarter, the thing most of this work actually ran on
    consumer: (g) => {
      g.appendChild(svg('path', { class: 'fill', d: 'M32 18 L74 30 L74 88 L32 76 Z' }));
      g.appendChild(svg('path', { class: 'lit', d: 'M32 18 L74 30 L74 88 L32 76 Z' }));
      g.appendChild(svg('path', { class: 'ink', d: 'M26 24 L32 18 M26 24 L26 82 L32 76' }));
      for (let i = 0; i < 4; i++) {
        g.appendChild(svg('path', { class: 'ink', d: 'M38 ' + (34 + i * 12) + ' L68 ' + (42 + i * 12) }));
      }
    },
    // retail — shelving seen down an aisle, one bay lit
    retail: (g) => {
      for (let i = 0; i < 4; i++) {
        const y = 26 + i * 16;
        g.appendChild(svg('path', { class: i === 1 ? 'lit' : 'ink', d: 'M14 ' + y + ' L86 ' + (y + 8) }));
      }
      g.appendChild(svg('path', { class: 'ink', d: 'M14 26 L14 82 M50 34 L50 90 M86 34 L86 90' }));
    },
    // fintech — a card, and the value leaving it
    fintech: (g) => {
      g.appendChild(svg('path', { class: 'fill', d: 'M16 42 L62 30 L84 40 L38 52 Z' }));
      g.appendChild(svg('path', { class: 'lit', d: 'M16 42 L62 30 L84 40 L38 52 Z' }));
      g.appendChild(svg('path', { class: 'ink', d: 'M16 42 L16 54 L38 64 L38 52 M38 64 L84 52 L84 40' }));
      g.appendChild(svg('path', { class: 'ink', d: 'M50 76 L50 90 M42 84 L50 92 L58 84' }));
    },
    // field — a site plan with one pin standing off it
    field: (g) => {
      g.appendChild(svg('path', { class: 'ink', d: 'M12 62 L50 44 L88 62 L50 80 Z' }));
      g.appendChild(svg('path', { class: 'ink', d: 'M31 53 L69 71 M69 53 L31 71' }));
      g.appendChild(svg('path', { class: 'lit', d: 'M50 22 L50 56' }));
      g.appendChild(svg('circle', { class: 'lit', cx: 50, cy: 22, r: 7 }));
    },
    // tooling — a cube of frames, the shape everything in the labs is drawn as
    tooling: (g) => {
      g.appendChild(svg('path', { class: 'ink', d: 'M50 20 L84 38 L84 74 L50 92 L16 74 L16 38 Z' }));
      g.appendChild(svg('path', { class: 'lit', d: 'M50 20 L50 56 L84 38 M50 56 L16 38 M50 56 L50 92' }));
    }
  };

  function art(kind, klass) {
    const s = svg('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'xMidYMid meet',
                           class: klass || 'box-art', 'aria-hidden': 'true' });
    const g = svg('g', {});
    (ART[kind] || ART.tooling)(g);
    s.appendChild(g);
    return s;
  }

  /* ---- the flip rack ----
   *
   * A JUKEBOX SELECTOR, not a row that scrolls and not a fan. The boxes hang from a rail at the top and you tip
   * them forward one at a time: the one you are on faces you square, the ones still to come stack up behind it,
   * and the ones you have passed lie over toward you almost flat. That is the gesture anybody who has flicked
   * through a rack of records or a wall of game boxes already owns.
   *
   * It is also the page's own axis used a third way. The calculator's phone turns about Y; a rack hinged at the
   * TOP turns about X, so this is a gesture of its own rather than a second copy of that one.
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
     untouched split a book has is wrong for a catalogue anyway: there is no "already read" here, only near and
     far from where you are standing.
     ALL SIXTEEN OTHERS STAY ON SCREEN, because the section's claim is seventeen and a rack that shows five is
     asking the reader to take the other twelve on trust. */
  const BLADE = 79;     // degrees the flanking covers stand at. At 90 they are invisible lines; under about 70
                        // they read as facing you at an angle and the fan stops being edges.
  const STEP = 12;      // px between blades. A blade is only cos(BLADE) of its own width — about a sixth — so
                        // they pack tight, and this is what makes the fan read as a stack of edges.
  const LIFT = 60;      // px the facing cover stands in front of the fan
  const DEPTH = 7;      // px each further blade recedes, so the fan has a vanishing end rather than a flat wall
  const REACH = 16;     // blades drawn each side: all of them.

  const reel = document.getElementById('reel');
  const reelAct = document.getElementById('reel-act');

  const boxes = items.map((p, i) => {
    const b = el('button', 'box');
    b.type = 'button';
    b.dataset.id = p.id;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-label', p.name + ', ' + p.at);
    const face = el('div', 'box-face');
    face.appendChild(art(p.art));
    face.appendChild(el('div', 'box-name', p.name));
    b.appendChild(face);
    b.addEventListener('click', () => go(i));
    reel.appendChild(b);
    return b;
  });

  function place() {
    /* THE BOX IS SIZED FROM THE RACK, not written down. The reel takes whatever the blocks above it leave and
       the box is a fraction of that, so the section fits by construction at any window rather than by a number
       here being lucky. A fraction and not the whole height, because the rack needs room to pile forward. */
    /* SIZED SO THE WHOLE FAN FITS, AND THE SAME SIZE WHEREVER YOU ARE IN IT. Against the CURRENT fan the cover
       grew and shrank on every step — widest at the ends, narrowest in the middle — which reads as the layout
       breaking rather than as the rack turning. Against the deepest fan it is one size for the whole run. */
    const h = reel.clientHeight;
    const room = reel.clientWidth - REACH * STEP * 2 - 24;
    if (h > 40) reel.style.setProperty('--box-w', Math.max(90, Math.min(Math.round(h * .66), room)) + 'px');

    boxes.forEach((b, i) => {
      const n = i - at;                       // < 0 to the left, 0 facing you, > 0 to the right
      const far = Math.abs(n);
      const side = n < 0 ? -1 : 1;
      const shown = far <= REACH;

      /* ORDER MATTERS. translate(-50%) is written FIRST so it is applied LAST — the cover turns about its own
         centre and is only then shifted half its width to sit on the reel's centre line. Written the other way
         round the shift is dragged into the rotation and every blade lands somewhere it was never sent.
         The offset clears the FACING cover's half width before the blades start, or the first one either side
         is buried behind it. */
      const half = (boxes[0].offsetWidth || 1) / 2;
      let t;
      if (n === 0) {
        t = 'translate(-50%, 0) translate3d(0, 0, ' + LIFT + 'px) rotateY(0deg)';
      } else {
        /* CLEARS THE FACING COVER'S FULL HALF-WIDTH before the fan starts. At half of it the first blade each
           side sat inside the facing cover's own footprint and was drawn behind it — the fan looked one-sided,
           with every blade left of centre simply missing. */
        const x = side * (half + 4 + far * STEP);
        t = 'translate(-50%, 0) translate3d(' + x.toFixed(1) + 'px, 0, ' + (-far * DEPTH) +
            'px) rotateY(' + (-side * BLADE) + 'deg)';
      }

      b.style.transform = t;
      // Nearest to the front wins, whichever side it is on. The facing cover is always on top.
      b.style.zIndex = String(100 - far);
      /* Hidden rather than merely faint past reach: a box at 5% opacity still takes a compositor layer and still
         answers the pointer, and seventeen of those under the one you are reading is a hit-target lottery. */
      /* A SHALLOW FADE, because the fan is sixteen deep each side. At a steeper rate everything past the sixth
         blade sat at the floor, which is a fade that has stopped saying anything about distance. */
      b.style.opacity = !shown ? '0' : n === 0 ? '1' : String(Math.max(.3, .85 - far * .032));
      b.style.pointerEvents = shown ? 'auto' : 'none';
      b.classList.toggle('picked', n === 0);
      b.classList.toggle('blade', n !== 0);
      b.setAttribute('aria-selected', n === 0 ? 'true' : 'false');
    });
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

  const firmBtns = firms.map((f) => {
    const b = el('button', null, f.name);
    b.type = 'button';
    b.addEventListener('click', () => go(f.at));
    firmsEl.appendChild(b);
    return b;
  });

  function drawFirms() {
    const here = items[at].at;
    firmBtns.forEach((b, i) => b.setAttribute('aria-current', firms[i].name === here ? 'true' : 'false'));
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

  function drawFront(p) {
    front.replaceChildren();
    front.appendChild(art(p.art, 'box-art'));
    const foot = el('div', 'front-foot');
    foot.appendChild(el('h3', null, p.name));
    front.appendChild(foot);
    if (spine) spine.textContent = p.name;
    sizeCase();
  }

  function drawBack(p) {
    back.replaceChildren();
    back.appendChild(el('div', 'b-name', p.name));

    const where = el('div', 'b-at');
    where.appendChild(el('span', null, p.at));
    where.appendChild(el('span', null, p.role));
    where.appendChild(el('span', 'when', p.when));
    back.appendChild(where);

    const out = el('div', 'b-block');
    out.appendChild(el('b', null, 'Outcome'));
    const row = el('div', 'b-out');
    if (p.fig) {
      const f = el('div', 'fig');
      f.appendChild(document.createTextNode(String(p.fig.n)));
      if (p.fig.suffix) f.appendChild(el('i', null, p.fig.suffix));
      row.appendChild(f);
    }
    row.appendChild(el('p', null, p.outcome));
    out.appendChild(row);
    back.appendChild(out);

    const did = el('div', 'b-block');
    did.appendChild(el('b', null, 'Responsibilities'));
    did.appendChild(el('p', null, p.did));
    back.appendChild(did);

    /* TOOLS AND FEATURES IS THE THIN PART, and it is thin in the SOURCE: a product carries two or three marks
       and nothing else. The full record on experience.html is what fills this out, and until it does the panel
       shows what there is rather than padding it. */
    const spec = el('div', 'b-spec');
    spec.appendChild(el('b', null, 'Tools and features'));
    const chips = el('div', 'b-chips');
    p.marks.forEach((m) => chips.appendChild(el('span', null, m)));
    spec.appendChild(chips);
    back.appendChild(spec);
  }

  /* ---- and the box is thrown in and out ----
   *
   * MOMENTUM IS THE DISTANCE. A step to the neighbour is a nudge and a jump to another company is a throw, so
   * both the travel and the exit speed are read off how many boxes were crossed. A swap that costs the same
   * whatever it crossed makes the company bar feel like it did nothing.
   * The old box leaves the way the crate moved and the new one arrives from behind it, which is the direction
   * the reader's own gesture was already going.
   */
  let thrown = 0;

  function throwCase(p, dir, dist) {
    const travel = Math.min(520, 110 + dist * 62);
    const out = Math.max(150, 250 - dist * 12);     // further crossed, sharper the exit
    clearTimeout(thrown);

    slide.style.transition = 'translate ' + out + 'ms cubic-bezier(.4, 0, 1, 1), opacity ' + out + 'ms linear';
    slide.style.translate = (dir * travel) + 'px';
    slide.style.opacity = '0';

    thrown = setTimeout(() => {
      drawFront(p);
      drawBack(p);
      /* Set the far side WITHOUT a transition, then let the next frame carry it home. Both in one frame and the
         browser coalesces them into no movement at all. */
      slide.style.transition = 'none';
      slide.style.translate = (-dir * travel) + 'px';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        slide.style.transition = 'translate 460ms cubic-bezier(.16, 1, .3, 1), opacity 260ms linear';
        slide.style.translate = '0px';
        slide.style.opacity = '1';
      }));
    }, out);
  }

  /* ---- which way the case is facing ----
   *
   * ONE ANGLE, and every rest pose is a half turn from the last. -20 shows the front with its spine rim toward
   * the reader; -200 shows the back the same way; -380 is the front again. Nothing here tracks a boolean and an
   * angle separately, so they cannot disagree about which face is out.
   */
  const REST = -20;         // degrees the case sits at, turned enough to show a rim
  let turn = REST, tilt = 2;

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
  /* HOW PRESENT A FACE IS, from how squarely it faces the reader. f is the cosine of that angle: 1 square on,
     0 edge on, negative when it is the far side seen through the case.
     ONE CONTINUOUS RAMP, not two clamped ones. This was max(GRAZE(f), THROUGH * GRAZE(-f)) with GRAZE zeroing
     anything under .22 — and near edge-on BOTH terms are zero, so every face switched off across a 26 degree
     window and switched back on. Swept and measured: front and back each read exactly 0.00 from about 75 to 105
     degrees. A face turning away should fade, and reach nothing only where it truly has no area, which is
     edge-on and nowhere else.
     The two sides differ by a multiplier, not by a separate curve, so the crossover at edge-on is continuous:
     the ramp is already zero there, whichever side takes over. */
  const THROUGH = .3;
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
    const a = turn * Math.PI / 180;
    const fF = Math.cos(a), fS = Math.sin(a);
    depthSort(front, fF); depthSort(back, -fF); depthSort(spineFace, fS);
    front.style.opacity = facing(fF);
    back.style.opacity = facing(-fF);
    if (spineFace) spineFace.style.opacity = facing(fS);
    paint();
  }

  function setTurn(t) {
    turn = t;
    apply();
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
  const EASE_TURN = (p) => 1 - Math.pow(1 - p, 3);
  const EASE_SPRING = (p) => {
    const c = 1.7;
    return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
  };

  let swing = 0;

  function swingTo(toTurn, toTilt, ms, ease) {
    cancelAnimationFrame(swing);
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

  function flip() {
    swingTo(turn - 180, 2, 780, EASE_TURN);
  }

  flipBtn.addEventListener('click', flip);

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
    swingTo(REST + Math.round((turn - REST) / 180) * 180, 2, 620, EASE_SPRING);
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
    const was = at;
    at = n;
    place();
    drawAct();
    drawFirms();
    if (same) return;
    if (flipped) flip();
    throwCase(items[at], n > was ? -1 : 1, Math.abs(n - was));
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

  reel.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
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

  reel.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, at: at, moved: 0 };
    reel.setPointerCapture(e.pointerId);
  });

  reel.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    down.moved = Math.max(down.moved, Math.abs(dx));
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
    down = null;
    if (e && e.pointerId != null && reel.hasPointerCapture(e.pointerId)) reel.releasePointerCapture(e.pointerId);
  };
  reel.addEventListener('pointerup', release);
  reel.addEventListener('pointercancel', release);

  /* Arrows step the crate. On the page this lands in, nav.js already ignores an arrow whose target is a BUTTON
     and every box is one, so the section's arrows and the page's beats never fight for the same press. */
  reel.addEventListener('keydown', (e) => {
    /* RIGHT WALKS TOWARD THE BLADES ON THE RIGHT. The fan is symmetric and the record runs newest first, so the
       reader's arrow has to move the PLAYHEAD the way they pressed — pressing right while the rack travelled
       left made the whole fan feel mirrored. */
    const d = e.key === 'ArrowRight' ? -1 : e.key === 'ArrowLeft' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    go(at + d);
    boxes[at].focus();
  });

  window.addEventListener('resize', place);
  window.addEventListener('resize', sizeCase);
  window.addEventListener('load', sizeCase);
  window.addEventListener('load', place);

  // Drawn, not thrown: on arrival there is no box on its way out and nothing for the momentum to be read from.
  drawFront(items[0]);
  drawBack(items[0]);
  setTurn(REST);
  go(0);
})();
