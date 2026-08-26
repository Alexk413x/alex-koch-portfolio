/* lab-objects.js — the three instruments as stylised solids, in CSS 3D.
 *
 * NO CANVAS AND NO CONTEXT. The page already runs one WebGL context for the reactor in the hero; three more for
 * three cards would be four live contexts holding their buffers whether or not they are drawing, and the cards
 * are the three that gain least from it. These hold nothing.
 *
 * This file builds only the parts whose sole variable is an index — the tube's funnel plates and the throat's
 * stations, rings and blades. Every one is placed once at load and never touched again; everything that then
 * animates is a transform or an opacity in the stylesheet, so the row is compositor work.
 *
 * The gesture is an ARRIVAL, not a button: each object fires once when the section reaches the reader and runs
 * backwards when it leaves, so a scroll past shows a complete movement rather than a thing that appeared.
 */
(function () {
  'use strict';

  const bay = document.querySelector('#labs .lab-grid');
  const crt = document.querySelector('#labs .obj.crt');
  const rx = document.querySelector('#labs .obj.rx');
  const wh = document.querySelector('#labs .obj.wh');
  if (!bay || !crt || !rx || !wh) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- the tube's funnel
  /* THE BACK IS THE OTHER HALF OF THE OBJECT, not a cap on it. Sized on t^1.8 rather than t, so the shell stays
     wide through the first third and necks late, which is the profile of a real funnel. The COUNT is the trick:
     at five plates you see each plate's face and the back reads as a second lobe stuck to the side of the tube.
     Packed close enough that the visible slivers overlap, the same stack becomes one continuous wall. */
  const tube = crt.querySelector('.tube');
  const PLATES = 28;
  for (let f = PLATES - 1; f >= 0; f--) {
    const t = f / (PLATES - 1);
    const e = Math.pow(t, 1.8);
    const w = 178 - 154 * e;
    const h = 134 - 116 * e;
    const plate = document.createElement('div');
    plate.className = 'fn';
    plate.style.width = w.toFixed(1) + 'px';
    plate.style.height = h.toFixed(1) + 'px';
    plate.style.margin = (-h / 2).toFixed(1) + 'px 0 0 ' + (-w / 2).toFixed(1) + 'px';
    plate.style.transform = 'translateZ(' + (12 - 168 * t).toFixed(1) + 'px)';
    plate.style.borderRadius = (44 - 33 * e).toFixed(1) + 'px';
    /* WIREFRAME, like the Cartographer's phones: the funnel is its edges and nothing else. Twenty-eight unfilled
       rounded rects stepping back IS how a cone is drawn in wireframe, so the plate count that used to build a
       solid wall now builds the contour lines instead.
       The faces stay unfilled rather than taking the phones' transparent black, because twenty-eight of them
       stacked would compound to opaque and the object would be solid again by accident. Only the front frame
       carries the fill. --e fades the edge with depth so the far end of the cone recedes.
       NO filter on these. A filter forces an element out of its preserve-3d context and flattens it, which
       silently collapses the whole cone into the plane of the face. */
    plate.style.setProperty('--e', (.62 - .42 * t).toFixed(3));
    tube.insertBefore(plate, tube.firstChild);
  }

  // ---------------------------------------------------------------- the throat
  const throat = wh.querySelector('.roll');
  const RINGS = 14, R = 79, DEG = 180 / Math.PI;
  const STATIONS = 18, BLADES = 8;

  /* ONE description of the centerline, read by both the rings and the wall. u is depth: 0 at the camera, 1 at
     the far end. THE OFFSET GOES WITH u SQUARED, and that exponent is the entire difference between a bend and
     a straight tube — spread linearly, every ring is displaced by the same proportion and the result is a
     straight bore skewed sideways. Squared, the mouth sits on the axis and the far end swings. */
  function pose(u) {
    const p = u * u;
    return { x: 170 * p, y: -74 * p, z: 430 - 1680 * u, ry: 23 * p, rx: -15 * p };
  }

  /* THE WALL IS A CHAIN OF STATIONS, each spinning in place about the tube's own axis. That is the difference
     between the wall turning and the BEND being swung around: a rotateZ on the whole throat moves the
     centerline with it, because the bend lives in x and y. Rotating each station where it stands leaves every
     center exactly where it was and turns only what is drawn on the surface. */
  for (let i = 0; i < STATIONS; i++) {
    const a = pose(i / STATIONS), b = pose((i + 1) / STATIONS);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    /* The TRUE tangent, from the vector to the next station — not the exaggerated bank the hoops use. A hoop
       only has to look like it leans into the curve; a blade has to actually arrive at the next station, and an
       over-banked one makes the wall zigzag. */
    const srx = Math.asin(dy / len) * DEG;
    const sry = Math.atan2(-dx, -dz) * DEG;

    const stn = document.createElement('div');
    stn.className = 'wst';
    stn.style.transform = 'translate3d(' + a.x.toFixed(1) + 'px,' + a.y.toFixed(1) + 'px,' + a.z.toFixed(1) +
      'px) rotateY(' + sry.toFixed(2) + 'deg) rotateX(' + srx.toFixed(2) + 'deg)';

    const spin = document.createElement('div');
    spin.className = 'wsp';
    stn.appendChild(spin);

    const o = (.5 * Math.pow(Math.sin(Math.PI * (i + .5) / STATIONS), .8)).toFixed(3);
    for (let k = 0; k < BLADES; k++) {
      const th = (k / BLADES) * Math.PI * 2;
      const bar = document.createElement('span');
      bar.className = 'wb';
      /* EXACTLY the gap to the next station, with no overlap. Overlapping doubles the opacity at every join and
         the line beads: eighteen bright dots strung along each of the eight lines. */
      bar.style.width = len.toFixed(1) + 'px';
      bar.style.setProperty('--o', o);
      bar.style.setProperty('--d', (2.4 * (1 - i / STATIONS)).toFixed(2) + 's');
      bar.style.setProperty('--dr', (.85 * (i / STATIONS)).toFixed(2) + 's');
      bar.style.transform = 'translate3d(' + (R * Math.cos(th)).toFixed(1) + 'px,' +
        (R * Math.sin(th)).toFixed(1) + 'px,0) rotateY(90deg)';
      spin.appendChild(bar);
    }
    throat.appendChild(stn);
  }

  for (let w = 0; w < RINGS; w++) {
    const rg = document.createElement('div');
    rg.className = 'rg';
    /* POSITIVE delays, one slot each, with the animation paused. In steady state that is identical to negative
       ones; the difference is the first cycle, where the throat fills from the far end forward rather than
       arriving complete. animation-play-state pauses the DELAY too, which is why nothing counts down while the
       section is off screen.
       A FRACTION of --fly rather than a number of seconds: hover rescales the cycle, and a delay that did not
       scale with it would leave the train unevenly spaced at one of the two speeds. */
    rg.style.animationDelay = 'calc(var(--fly) * ' + (w / RINGS).toFixed(4) + ')';
    const rp = pose(w / (RINGS - 1));
    rg.style.transform = 'translate3d(' + rp.x.toFixed(1) + 'px,' + rp.y.toFixed(1) + 'px,' + rp.z.toFixed(1) +
      'px) rotateY(' + rp.ry.toFixed(1) + 'deg) rotateX(' + rp.rx.toFixed(1) + 'deg)';
    throat.appendChild(rg);
  }

  // ---------------------------------------------------------------- arrival and departure
  const solids = [crt, rx];
  let exitTimer = 0;

  function clearRings() {
    wh.querySelectorAll('.rg').forEach((r) => {
      r.style.transitionDelay = '';
      r.style.opacity = '';
      r.style.animationName = '';
    });
  }

  function arrive() {
    clearTimeout(exitTimer);
    crt.classList.remove('cold');
    wh.classList.add('on');
    clearRings();
    solids.forEach((el) => {
      el.classList.remove('off', 'cold', 'go');
      /* Restart by NAME, never by the shorthand. Setting `animation` to none resets every animation-* longhand,
         which silently wipes the inline per-element delay — and here that delay is what spaces the rings along
         the tube. One replay without this left all fourteen in perfect sync for the rest of the session. */
      void el.offsetWidth;
      el.classList.add('go');
    });
    setTimeout(() => solids.forEach((el) => el.classList.remove('go')), 1100);
  }

  /* LEAVING RUNS THE ARRIVAL BACKWARDS, so a scroll past shows a complete gesture rather than a thing that
     appeared once. It fires when the row is nearly gone, so nobody watches it: a choreographed exit would be
     effort spent where there is no audience, and a long one risks being caught halfway on the way back. */
  function depart() {
    clearTimeout(exitTimer);
    solids.forEach((el) => { el.classList.remove('go'); el.classList.add('off'); });
    wh.classList.remove('on');

    /* A ring's opacity comes from its fly animation, and CANCELING AN ANIMATION SNAPS THE ELEMENT TO ITS BASE
       STYLE — which is zero here, so they would vanish rather than fade, killing the effect while the wall was
       still gracefully receding behind them. Freeze each at what it is showing, then transition that to zero. */
    wh.querySelectorAll('.rg').forEach((r, i) => {
      const now = getComputedStyle(r).opacity;
      r.style.animationName = 'none';
      r.style.opacity = now;
      void r.offsetWidth;
      r.style.transitionDelay = (i * .04).toFixed(2) + 's';
      r.style.opacity = '0';
    });

    exitTimer = setTimeout(() => {
      solids.forEach((el) => { el.classList.remove('off'); el.classList.add('cold'); });
      clearRings();
    }, 700);
  }

  // Reduced motion gets the objects composed and still, which is what every static transform already describes.
  if (reduced || !('IntersectionObserver' in window)) {
    crt.classList.remove('cold');
    rx.classList.remove('cold');
    wh.classList.add('on');
    return;
  }

  /* TWO THRESHOLDS, NOT ONE. Arriving at 45% and leaving at 12% leaves a wide dead band, so a reader parked
     near the edge cannot thrash the objects in and out — a single threshold re-fires every time the ratio
     crosses it, which on a trackpad is several times a second. */
  let live = false;
  new IntersectionObserver((entries) => {
    const ratio = entries[entries.length - 1].intersectionRatio;
    if (!live && ratio >= .45) { live = true; arrive(); }
    else if (live && ratio <= .12) { live = false; depart(); }
  }, { threshold: [0, .12, .45, 1] }).observe(bay);
})();
