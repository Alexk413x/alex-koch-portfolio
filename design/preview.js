/* preview.js — the workbench's only script.
 *
 * shelf.js is loaded before this and is the REAL one, unmodified: the collapse, the open/close, the counting
 * figures and the end fades all behave here exactly as they do on the page. Nothing in this file changes the
 * shelf; it only reports what the current design measures, because "it takes too much page" is a number and
 * arguing about it without one is how a section gets redesigned twice.
 */
(function () {
  'use strict';

  /* THE READOUT CARRIES ITS OWN STYLE. It is created here and used by two pages, and a rule for it in one
     stylesheet meant the other rendered it as a static block — 21px of body that made the catalogue's page
     scroll while every measurement said the section fitted. Chrome that travels with the script cannot be left
     behind by the page that borrows it. */
  const READOUT = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:90;' +
    'font-family:var(--font-mono);font-size:10px;letter-spacing:.12em;white-space:nowrap;' +
    'color:var(--text-faint);padding:9px 16px;border:1px solid var(--hairline);border-radius:999px;' +
    'background:rgba(12,12,14,.92);backdrop-filter:blur(8px)';

  /* SHOWN, because the thing that shows them is not on this page. scenes.js owns the [data-reveal] observer and
     it needs the home page's sticky stage to run at all, so without this the intro sits at opacity 0 and the
     workbench opens on a section that appears to be missing its heading. */
  document.querySelectorAll('[data-reveal]').forEach((n) => n.classList.add('shown'));

  /* The catalogue reports its own fit, because that page's section CLIPS — an overflow there is invisible to
     anything measuring the section's box, and the first version of this readout called a 1366x768 laptop a
     clean fit while the footing was sitting on top of Act I. */
  const cat = document.getElementById('cat');
  if (cat) {
    const box = document.createElement('div');
    box.className = 'wb-read';
    box.setAttribute('style', READOUT);
    document.body.appendChild(box);
    const read = () => {
      const reel = document.getElementById('reel');
      const one = document.querySelector('.box');
      const over = document.documentElement.scrollHeight > window.innerHeight + 1;
      box.textContent = [
        'SCREEN ' + window.innerWidth + '×' + window.innerHeight,
        'CRATE ' + (reel ? Math.round(reel.getBoundingClientRect().height) : '?') + 'px',
        'BOX ' + (one ? one.offsetWidth : '?') + 'px',
        over ? 'PAGE SCROLLS' : 'ONE SCREEN'
      ].join('   ·   ');
      box.style.color = over ? 'var(--accent)' : '';
    };
    read();
    window.addEventListener('resize', () => requestAnimationFrame(read));
    window.addEventListener('load', () => requestAnimationFrame(read));
    return;
  }

  const shelf = document.getElementById('shelf');
  if (!shelf) return;

  const box = document.createElement('div');
  box.className = 'wb-read';
  box.setAttribute('style', READOUT);
  document.body.appendChild(box);

  function read() {
    const sec = document.getElementById('experience');
    const open = shelf.querySelector('.proof:not([hidden])');
    const rack = shelf.querySelector('.rack');
    box.textContent = [
      'SECTION ' + Math.round(sec.getBoundingClientRect().height) + 'px',
      'SCREEN ' + window.innerHeight + 'px',
      'SCREENS ' + (sec.getBoundingClientRect().height / window.innerHeight).toFixed(2),
      'RACK ' + Math.round(rack.scrollWidth) + 'px in ' + Math.round(rack.clientWidth),
      'OPEN ' + (open ? open.id.replace('pf-', '') : 'none')
    ].join('   ·   ');
  }

  read();
  window.addEventListener('resize', read);
  shelf.addEventListener('click', () => requestAnimationFrame(read));
})();
