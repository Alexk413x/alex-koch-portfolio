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
const BURST_SEC = 2.4;     // long enough that both ends of it can be eased and still leave a surge between
const STORM_SEC = 7.0;     // long enough to arrive, sit, and leave
const DIVE_SEC = 2.0;      // the fall into the throat
const SETTLE_SEC = 2.6;    // and the recovery out of it
const COLLAPSE_SEC = 2.4;  // shutting down: the rush in, then black

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v) => v * v * (3 - 2 * v);

/* ONE CURVE FOR EVERY MOVE: rises from nothing, peaks once, returns to nothing, and is flat at both ends so
 * there is no corner where it starts or stops. p runs 0..1 across the move and k sets how broad the peak is.
 *
 * THERE IS NO HOLD IN THE MIDDLE, and there used to be. The first shape was ease-in, hold, ease-out, which
 * measured as a plateau -- seven times speed for three samples running, then a fall. A value that arrives and
 * then sits still reads as a step even when both of its ramps are smooth, because the acceleration stops dead
 * at the top. A bell never stops accelerating until it is already slowing down.
 *
 * Before either of those, BURST and ENGAGE jumped to full on the frame the button was pressed, which gives the
 * eye the result without the event. */
const bell = (p, k) => (p <= 0 || p >= 1 ? 0 : Math.pow(Math.sin(Math.PI * p), k || 2));

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
        const total = DIVE_SEC + SETTLE_SEC;
        /* THE RUSH IS EASED AT BOTH ENDS, so the tunnel gathers speed, runs, and lets go. It used to be at full
           on the first frame, which gave the fall no beginning. */
        const rush = bell(moveT / total);
        // The wall arrives out of nothing on its own ramp, so there is something to accelerate INTO.
        const there = ease(clamp01(moveT / (DIVE_SEC * 0.8)));
        /* DEPTH DIPS AND COMES BACK rather than starting collapsed: the far end -- and the hole welded to it --
           runs at the eye and then settles to where the slider put it. */
        o.far = s.far * (1 - 0.45 * rush);
        o.fov = s.fov * (1 + 0.35 * rush);
        o.exposure = s.exposure * (1 + 0.7 * rush);
        scaleShells(o, s, { speed: 1 + 3 * rush, warp: 1, amt: there });
      }

      /* THE COLLAPSE. The same rush inward, and then the light goes: AMOUNT and EXPOSURE to nothing rather than
         a fade to grey, because a tunnel dimming uniformly reads as a dip and a tunnel whose walls stop
         arriving reads as an ending. */
      if (moveT >= 0 && closing) {
        const p = clamp01(moveT / COLLAPSE_SEC);
        // Eased in so the fall STARTS from rest, and never eased out: this one is not meant to recover.
        const rush = ease(clamp01(p / 0.45));
        const gone = ease(clamp01((p - 0.4) / 0.6));
        o.far = s.far * (1 - 0.7 * rush);
        o.fov = s.fov * (1 + 0.6 * rush);
        o.exposure = s.exposure * (1 + 1.2 * rush * (1 - gone)) * (1 - gone);
        scaleShells(o, s, { speed: 1 + 5 * rush, warp: 1, amt: 1 - gone });
      }

      // Shut down and finished: nothing is drawn, and the hole's own light goes with it.
      if (dark) {
        o.exposure = 0;
        o.disc = 0;
        o.mass = 0;
        scaleShells(o, s, { speed: 1, warp: 1, amt: 0 });
      }

      /* BURST IS TRAVEL AND ONLY TRAVEL. It is the shell SPEEDs and nothing else, because that is the one rate
         that means "the camera is covering ground": the wall arrives faster and sweeps past.
         BEND FLOW IS DELIBERATELY LEFT ALONE. It turns the arch, which reads as the tunnel itself writhing
         rather than as the viewer moving through it -- a different event wearing the same button. STRETCH went
         with it: it scales the distance the pattern is read over, so raising it tightens the whorl at the
         vanishing point, which is the tunnel winding up rather than the camera accelerating. Both were in the
         first version and both fought the thing the move is for. */
      if (burstT >= 0) {
        const k = bell(burstT / BURST_SEC);
        scaleShells(o, s, { speed: 1 + 2.2 * k, warp: 1, amt: 1 }, o);
      }

      /* STORM. Everything drawn ON the wall thickens at once -- nebula, plasma, streaks -- and FILL comes up
         with them, because raising the amounts alone brightens what is already lit rather than covering more
         of the wall. It arrives and leaves on the same curve, so there is no moment where it snaps off. */
      if (stormT >= 0) {
        const k = bell(stormT / STORM_SEC, 1.4);
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
