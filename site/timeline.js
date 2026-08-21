/* timeline.js — the roles, one at a time.
 *
 * The section is a viewer rather than a list: it is pinned, and the scroll chooses WHICH role is showing rather
 * than how far down a column of them you are. That is what lets fourteen years cost one screen.
 *
 * Two things read the same number and nothing else does: the deck, which shows that role, and the strip, which
 * lights it. The strip is also the section's only progress readout — a separate dial would be the duplication
 * this design exists to remove.
 */
(function () {
  'use strict';

  const scroll = document.getElementById('exp-scroll');
  const stage = document.getElementById('exp-stage');
  const strip = document.querySelector('.exp-strip');
  const deck = document.querySelector('.exp-deck');
  if (!scroll || !stage || !strip || !deck) return;

  const roles = Array.prototype.slice.call(deck.querySelectorAll('.role'));
  if (!roles.length) return;

  /* THE RUNWAY IS DECLARED IN THE STYLESHEET, once. --exp-beat is viewport heights per role; the container's
     height is derived from it in CSS and the index is derived from it here, so the pin cannot be a different
     length from the thing it is pinning. */
  function beat() {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--exp-beat'));
    return v > 0 ? v : .3;
  }

  /* Written as a PROPERTY, not as a height. A media query cannot outrank an inline style, and below the
     breakpoint the pin has to give the runway back — a viewer showing one role at a time needs a screen to show
     it on, and a landscape phone has 393px of one. */
  scroll.style.setProperty('--exp-run', roles.length * beat());

  // ---------------------------------------------------------------- the strip
  const tabs = roles.map((role, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = role.dataset.label || String(i + 1);
    /* Scrolls the PAGE to that role's beat, which is the only way to change what is showing: the deck has no
       state of its own, so setting a class here would be a second description that the next scroll frame
       overwrites. Landing mid-beat rather than on its edge, so a pixel of rounding cannot show the neighbour. */
    b.addEventListener('click', () => {
      window.scrollTo({ top: pinTop + run * ((i + .5) / roles.length), behavior: 'smooth' });
    });
    strip.appendChild(b);
    return b;
  });

  // ---------------------------------------------------------------- which role
  let current = -1;

  function show(i) {
    if (i === current) return;
    if (current >= 0) {
      roles[current].classList.remove('here');
      tabs[current].removeAttribute('aria-selected');
    }
    current = i;
    roles[i].classList.add('here');
    tabs[i].setAttribute('aria-selected', 'true');
  }

  /* THE PIN'S GEOMETRY, READ ONCE PER LAYOUT RATHER THAN ONCE PER FRAME. offsetHeight and
     getBoundingClientRect force a synchronous layout, and this handler runs on every scroll frame anywhere on
     the page — against a tree the scenes above have just dirtied with a block of custom properties, which is the
     condition that makes the read expensive rather than free. Measured across a full-page scrub: 3.75ms of
     forced layout for a frame's worth of reads like these, on a 16.7ms budget.
     getBoundingClientRect and NOT offsetTop, which is relative to the nearest POSITIONED ancestor: the section
     this pin lives in is position: relative, so offsetTop reports the distance from the section rather than from
     the top of the document and every beat lands on the wrong role. */
  let pinTop = 0, run = 0;

  function measure() {
    run = scroll.offsetHeight - stage.offsetHeight;
    pinTop = scroll.getBoundingClientRect().top + (window.scrollY || window.pageYOffset || 0);
  }

  let queued = false;
  function frame() {
    queued = false;
    const y = window.scrollY || window.pageYOffset || 0;
    const p = run > 0 ? (y - pinTop) / run : 0;
    const i = Math.max(0, Math.min(roles.length - 1, Math.floor(p * roles.length)));
    show(i);
  }

  function remeasure() {
    measure();
    frame();
  }

  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  }, { passive: true });

  window.addEventListener('resize', remeasure);
  // Web fonts land after this runs and reflow every section above, which moves where this pin starts.
  window.addEventListener('load', remeasure);
  /* And so does anything else that changes a section's height, none of which fires a resize — fitDeck below is
     one, since it writes the floor the strip sits on. Nothing this file writes per frame is a layout property,
     so the observer cannot feed itself. */
  if ('ResizeObserver' in window) new ResizeObserver(remeasure).observe(document.body);
  remeasure();

  /* The deck is absolutely positioned, so it has no height of its own and the strip above it would sit on the
     tallest role's text. Measured once, after fonts, and written as a floor. */
  function fitDeck() {
    let tallest = 0;
    roles.forEach((r) => {
      /* Released from the absolute box to be measured. A role is inset: 0 on the deck, so in place its height IS
         the deck's — asking it how tall it wants to be while it is stretched to fit reads back the answer from
         the last pass and the deck never grows. */
      const was = r.classList.contains('here');
      if (!was) r.classList.add('here');
      r.style.position = 'static';
      const n = r.offsetHeight;
      r.style.position = '';
      // How far the sweep's leading rule has to travel. A percentage would resolve against the 2px rule itself.
      r.style.setProperty('--role-h', n + 'px');
      tallest = Math.max(tallest, n);
      if (!was) r.classList.remove('here');
    });
    deck.style.setProperty('--deck-h', tallest + 'px');
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitDeck);
  else fitDeck();
  window.addEventListener('resize', fitDeck);
})();
