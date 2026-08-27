/* The lab's scripted moves. Pure: no DOM, no GL, no timers of its own.
 *
 * THE SLIDERS ARE NEVER TOUCHED. `step` returns a COPY of the state with the running moves added on top, and
 * the panel keeps showing what the user set. Reactor's sim works the same way and for the same reason: a move
 * that wrote to the controls would leave them somewhere nobody chose once it finished, and there would be no
 * way to tell a dialled-in value from the wreckage of an animation.
 *
 * IT IS DRIVEN BY dt, NOT BY A CLOCK. The host already integrates one, and a move keyed to wall-clock time
 * would jump its whole duration in a single frame after the tab had been hidden -- which is exactly the failure
 * lab.js's loop documents for uTime.
 *
 * RENDER REPRODUCIBILITY: while nothing is running, `step` returns the state object ITSELF and the scene stays
 * a pure function of (state, time), so renderNow(sec) reproduces any frame exactly. That guarantee holds only
 * while the moves are idle -- a move carries phase forward, so a frame stepped during one cannot be re-created
 * from its time alone. Same trade Reactor makes, stated here rather than discovered later.
 */

/* WHY THESE ARE MULTIPLIERS AND NOT TARGETS. A move has to read the same on a scene dialled to a whisper and
 * one already at its ceiling, and an absolute target cannot: it would be a surge on one and a cut on the other.
 * Scaling what is there keeps the move's SHAPE while the scene keeps its character. */
const BURST_SEC = 1.6;     // a shove, and over before it is a mode
const STORM_SEC = 7.0;     // long enough to arrive, sit, and leave
const DIVE_SEC = 1.5;      // the fall into the throat
const SETTLE_SEC = 2.2;    // and the recovery out of it
const COLLAPSE_SEC = 1.8;  // shutting down: the rush in, then black

// Rises fast and falls slow: a shove that arrives at once and lets go gradually reads as a release rather than
// a switch. p runs 0..1 across the move.
const shove = (p) => (p <= 0 ? 0 : Math.pow(1 - p, 1.7) * Math.min(1, p * 14));
// Symmetric and smooth at both ends: a weather front, not an impact.
const swell = (p) => (p <= 0 || p >= 1 ? 0 : Math.pow(Math.sin(Math.PI * p), 1.4));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v) => v * v * (3 - 2 * v);

export function createMoves() {
  // Each is elapsed seconds since its trigger, or -1 for idle. `engaged` is the only state that persists.
  let burstT = -1, stormT = -1, moveT = -1;
  let engaged = true, closing = false;

  const api = {
    get engaged() { return engaged; },
    get busy() { return burstT >= 0 || stormT >= 0 || moveT >= 0; },

    fireBurst() { burstT = 0; },
    fireStorm() { stormT = 0; },

    /* ONE BUTTON, TWO DIRECTIONS. Engaging runs the dive: the hole is there from the first frame and the tunnel
       rushes onto it, then settles. Disengaging runs the collapse: the same rush, and then the frame goes out.
       Re-engaging from dark is a NEW tunnel rather than the old one resumed, which is why the dive starts from
       nothing rather than from wherever the collapse stopped. */
    toggle() {
      engaged = !engaged;
      closing = !engaged;
      moveT = 0;
    },

    step(s, dt, sec) {
      const d = Math.max(0, Math.min(0.05, dt || 0));
      if (burstT >= 0) { burstT += d; if (burstT > BURST_SEC) burstT = -1; }
      if (stormT >= 0) { stormT += d; if (stormT > STORM_SEC) stormT = -1; }
      if (moveT >= 0) {
        moveT += d;
        if (moveT > (closing ? COLLAPSE_SEC : DIVE_SEC + SETTLE_SEC)) moveT = -1;
      }

      // Dark and still: held here rather than run every frame, so a shut-down lab costs nothing to leave open.
      const dark = !engaged && moveT < 0;
      if (!api.busy && !dark) return s;      // the untouched object, so the scene stays reproducible

      const o = { ...s };

      /* THE DIVE. DEPTH collapsing is what makes this read as travel rather than as a zoom: the far end -- and
         the hole welded to it -- comes at the eye, and the walls sweep past because the same tube is being
         crossed in less distance. Speed carries the pattern with it so the wall does not slide backwards. */
      if (moveT >= 0 && !closing) {
        const p = clamp01(moveT / DIVE_SEC);
        const settle = clamp01((moveT - DIVE_SEC) / SETTLE_SEC);
        // 0 at the moment of engaging, 1 once settled: how much of the user's scene is back.
        const back = ease(settle);
        const rush = (1 - back) * (1 - ease(p) * 0.55);
        o.far = s.far * (0.18 + 0.82 * ease(clamp01(p * 0.7 + back)));
        o.fov = s.fov * (1 + 0.9 * rush);
        o.exposure = s.exposure * (1 + 1.6 * rush);
        scaleShells(o, s, { speed: 1 + 9 * rush, warp: 1 + 1.2 * rush, amt: 0.25 + 0.75 * ease(clamp01(p * 1.4)) });
      }

      /* THE COLLAPSE. The same rush inward, and then the light goes: AMOUNT and EXPOSURE to nothing rather than
         a fade to grey, because a tunnel dimming uniformly reads as a dip and a tunnel whose walls stop
         arriving reads as an ending. */
      if (moveT >= 0 && closing) {
        const p = clamp01(moveT / COLLAPSE_SEC);
        const gone = ease(clamp01((p - 0.35) / 0.65));
        o.far = s.far * (1 - 0.86 * ease(p));
        o.fov = s.fov * (1 + 1.4 * ease(p));
        o.exposure = s.exposure * (1 + 2.2 * ease(p) * (1 - gone)) * (1 - gone);
        scaleShells(o, s, { speed: 1 + 14 * ease(p), warp: 1 + 1.6 * ease(p), amt: 1 - gone });
      }

      // Shut down and finished: nothing is drawn, and the hole's own light goes with it.
      if (dark) {
        o.exposure = 0;
        o.disc = 0;
        o.mass = 0;
        scaleShells(o, s, { speed: 1, warp: 1, amt: 0 });
      }

      /* BURST. Faster, more twist, more roll -- and STRETCH is the one that makes it read: it scales the
         distance the pattern is sampled over, so raising it tightens the whorl at the vanishing point and the
         tunnel appears to wind up rather than merely run quicker. */
      if (burstT >= 0) {
        const k = shove(burstT / BURST_SEC);
        o.bendFlow = s.bendFlow * (1 + 1.8 * k);
        o.discSpin = s.discSpin * (1 + 2.5 * k);
        scaleShells(o, s, { speed: 1 + 4.5 * k, warp: 1 + 1.1 * k, amt: 1, spin: 1 + 6 * k }, o);
      }

      /* STORM. Everything drawn ON the wall thickens at once -- nebula, plasma, streaks -- and FILL comes up
         with them, because raising the amounts alone brightens what is already lit rather than covering more
         of the wall. It arrives and leaves on the same curve, so there is no moment where it snaps off. */
      if (stormT >= 0) {
        const k = swell(stormT / STORM_SEC);
        for (let i = 0; i < 6; i++) {
          const p = 'L' + i;
          o[p + 'Cloud'] = s[p + 'Cloud'] * (1 + 0.9 * k);
          o[p + 'Bolts'] = s[p + 'Bolts'] * (1 + 1.6 * k) + 0.35 * k;
          o[p + 'Streak'] = s[p + 'Streak'] * (1 + 1.4 * k) + 0.25 * k;
          // FILL is coverage on the panel and the host inverts it, so raising it here is more wall alight.
          o[p + 'Fill'] = Math.min(1, s[p + 'Fill'] + 0.22 * k);
          o[p + 'BoltRipple'] = s[p + 'BoltRipple'] + 1.2 * k;
        }
        o.exposure = s.exposure * (1 + 0.25 * k);
      }
      return o;
    },
  };
  return api;
}

/* Scales the four per-shell rates a move can reach. `from` is where the numbers come from and defaults to the
   same object being written, so a second move composes onto the first instead of overwriting it. */
function scaleShells(o, s, m, from) {
  const src = from || s;
  for (let i = 0; i < 6; i++) {
    const p = 'L' + i;
    if (m.speed !== 1) o[p + 'Speed'] = src[p + 'Speed'] * m.speed;
    if (m.warp !== 1) o[p + 'Warp'] = src[p + 'Warp'] * m.warp;
    if (m.amt !== 1) o[p + 'Amt'] = src[p + 'Amt'] * m.amt;
    if (m.spin) o[p + 'Spin'] = src[p + 'Spin'] * m.spin;
  }
}
