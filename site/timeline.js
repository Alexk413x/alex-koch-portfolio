/* timeline.js — the experience rail as an instrument.
 *
 * The list keeps its OWN scroll, and `overscroll-behavior: contain` in the stylesheet is what makes that
 * civilised: the wheel moves the timeline while the pointer is over it and hands back to the page at either
 * end, natively, with no listener to fight the page's own stepper.
 *
 * This file does three things and nothing else: builds the jump strip from the roles themselves, keeps one
 * readout in step with whatever is being read, and marks that role so its neighbours can recede. All three run
 * off ONE description of "which role am I on", for the same reason the header and the page share one.
 */
(function () {
  'use strict';

  const scroll = document.getElementById('tl-scroll');
  const strip = document.querySelector('.tl-strip');
  if (!scroll || !strip) return;

  const roles = Array.prototype.slice.call(scroll.querySelectorAll('.role'));
  if (!roles.length) return;

  const yearOut = document.querySelector('.tl-year');
  const whereOut = document.querySelector('.tl-where');
  const band = document.querySelector('.tl-band');
  const bandOut = band && band.querySelector('b');
  const bar = band && band.querySelector('.tl-bar');

  /* The whole Android era, as the scale both ends of the band are written against. Fixed rather than derived
     from the roles, so a role that shipped against a narrow range reads as narrow instead of filling the bar. */
  const API_LO = 4, API_HI = 16;
  const pct = (v) => ((Math.max(API_LO, Math.min(API_HI, v)) - API_LO) / (API_HI - API_LO)) * 100;

  // ---------------------------------------------------------------- the strip
  const tabs = roles.map((role, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = role.dataset.label || ('0' + (i + 1)).slice(-2);
    /* Scrolls the LIST, not the page. scrollIntoView would scroll every ancestor that can scroll, which here
       means the page moves as well and the reader is taken out of the section they were browsing.
       The two boxes are measured against EACH OTHER rather than read off offsetTop, which is relative to the
       nearest positioned ancestor — not the scroller — so the arithmetic silently lands on the wrong role. */
    b.addEventListener('click', () => {
      const delta = role.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
      scroll.scrollTo({ top: scroll.scrollTop + delta, behavior: 'smooth' });
    });
    strip.appendChild(b);
    return b;
  });

  // ---------------------------------------------------------------- the readout
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

    const d = roles[i].dataset;
    if (yearOut) yearOut.textContent = d.year || '';
    if (whereOut) whereOut.textContent = d.label || '';
    if (!band) return;

    const lo = parseFloat(d.lo), hi = parseFloat(d.hi);
    const has = !Number.isNaN(lo) && !Number.isNaN(hi);
    band.classList.toggle('none', !has);
    if (bandOut) bandOut.textContent = has ? 'Android ' + d.lo + '–' + d.hi : 'Not an Android role';
    if (bar && has) {
      bar.style.setProperty('--lo', pct(lo).toFixed(1) + '%');
      bar.style.setProperty('--hi', pct(hi).toFixed(1) + '%');
    }
  }

  /* ONE reading line, and whichever role contains it is the one being read. Measured against the SCROLLER's box
     rather than the viewport's: the list scrolls inside the page, so a viewport-relative line would report the
     same role however far through the list the reader was.
     FIXED near the top of the panel, so the role at the top of the panel is the one the readout names. That is
     what makes the strip honest: a jump puts its target at the top, and the reader expects the readout to agree
     with the button they just pressed.
     A SLIDING line was tried first, to solve the last role — it is shorter than the panel, so at the bottom of
     the scroll its top never climbs past a line near the top, and the oldest role would light for nobody. But
     sliding it down puts SEVERAL roles above the line at the end, and the last one wins, so the strip and the
     readout stop agreeing. The end of the list is simply the last role, and saying so costs one line. */
  const LINE = .12;

  let queued = false;
  function frame() {
    queued = false;
    const run = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
    if (scroll.scrollTop >= run - 2) { show(roles.length - 1); return; }

    const box = scroll.getBoundingClientRect();
    const line = box.top + box.height * LINE;
    let i = 0;
    for (let n = 0; n < roles.length; n++) {
      if (roles[n].getBoundingClientRect().top <= line) i = n;
    }
    show(i);
  }

  scroll.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  }, { passive: true });

  window.addEventListener('resize', frame);
  frame();
})();
