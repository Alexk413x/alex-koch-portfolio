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
const DIVE_SEC = 2.4;      // the arrival: the hole builds, then the tunnel grows around it
const SETTLE_SEC = 3.0;    // the hole draws away and the flow eases back to the slider
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

/* One beat of a sequence: 0 before `a`, 1 after `b`, eased between. The beats OVERLAP on purpose -- each starts
   before the one before it has finished, so the move hands over instead of stopping and starting. */
const seg = (p, a, b) => ease(clamp01((p - a) / (b - a)));

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

      /* THE DIVE IS FOUR BEATS IN ORDER, not one surge with everything moving at once.
       *
       * WHAT IT USED TO DO, AND WHY IT READ BACKWARDS. It drove SPEED, DEPTH and FOV together, and the three do
       * not agree about which way anything is going: SPEED flows the pattern down the tube, which is travel;
       * DEPTH shrinking compresses the tube toward the eye, which is a zoom, because the geometry rescales
       * while the pattern stays anchored to world z; and FOV widening while the subject closes is the Vertigo
       * shot, whose whole trick is that the frame appears to move two ways at once. DEPTH also ran the wrong
       * way for what this move is: it pulled the far end IN, when the hole is supposed to draw AWAY.
       *
       * The beats, in the order they are seen:
       *
       *   1  THE HOLE BUILDS FROM NOTHING.  MASS and DISC come up from zero with the tunnel still dark, so the
       *      first thing in the frame is the hole and there is nothing else to look at while it arrives.
       *   2  THE TUNNEL GROWS TOWARD THE EYE.  The shells open from a thread to their full radius, so the tube
       *      forms around the viewer rather than fading up in place.
       *   3  THE HOLE DRAWS AWAY.  DEPTH grows to what the slider says, carrying the far end -- and the hole
       *      welded to it -- off into the distance. This is the one direction the old version had backwards.
       *   4  THE FLOW EASES BACK.  Speed returns to the slider's own rate.
       *
       * They overlap: each starts before the one before it is done, so it is a hand-off rather than four
       * separate events queued up. */
      if (moveT >= 0 && !closing) {
        const p = clamp01(moveT / (DIVE_SEC + SETTLE_SEC));

        // 1. the hole, out of nothing
        const hole = seg(p, 0.00, 0.26);
        o.mass = s.mass * hole;
        o.disc = s.disc * hole;

        // 2. the tube opening around the viewer
        const grow = seg(p, 0.16, 0.58);

        // 3. the far end -- and the hole on it -- drawing off. Starts near, ends where the slider put it.
        o.far = s.far * (0.34 + 0.66 * seg(p, 0.44, 0.88));

        // 4. the flow, up while the tube is forming and back to the slider's rate by the end
        const rush = seg(p, 0.10, 0.46) * (1 - seg(p, 0.58, 1.0));
        o.exposure = s.exposure * (1 + 0.35 * rush);
        scaleShells(o, s, { speed: 1 + 1.2 * rush, warp: 1, amt: grow, rad: 0.12 + 0.88 * grow });
      }

      /* THE COLLAPSE. The same rush inward, and then the light goes: AMOUNT and EXPOSURE to nothing rather than
         a fade to grey, because a tunnel dimming uniformly reads as a dip and a tunnel whose walls stop
         arriving reads as an ending. */
      if (moveT >= 0 && closing) {
        const p = clamp01(moveT / COLLAPSE_SEC);
        // Eased in so the fall STARTS from rest, and never eased out: this one is not meant to recover.
        const rush = ease(clamp01(p / 0.45));
        const gone = ease(clamp01((p - 0.4) / 0.6));
        /* FOV IS LEFT ALONE HERE TOO, for the reason the dive gives. DEPTH still closes, because on the way
           out it is not competing with anything: the travel and the tube's end are both heading the same way,
           and the frame goes dark before the two could be told apart. */
        o.far = s.far * (1 - 0.7 * rush);
        o.exposure = s.exposure * (1 + 1.2 * rush * (1 - gone)) * (1 - gone);
        scaleShells(o, s, { speed: 1 + 2.2 * rush, warp: 1, amt: 1 - gone });
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
        scaleShells(o, s, { speed: 1 + 1.1 * k, warp: 1, amt: 1 }, o);
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
    /* RADIUS SCALES EVERY SHELL BY THE SAME FACTOR, which keeps their ORDER -- the host sorts by radius and
       composites inner-first, and a move that changed the order would swap which shell occludes which. */
    if (m.rad) o[p + 'Rad'] = src[p + 'Rad'] * m.rad;
  }
}
