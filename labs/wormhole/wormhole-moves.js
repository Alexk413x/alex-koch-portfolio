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
const COLLAPSE_SEC = 3.2;  // shutting down: straighten, slow, drawn in, out

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
       *   4  THE TUNNEL BENDS.  BEND and BEND FLOW come up from zero last of all.
       *   5  THE FLOW EASES UP TO THE SLIDER'S RATE, and never past it.
       *
       * IT STARTS DEAD STRAIGHT, AND THAT IS WHY BEND IS LAST. The bend swings the vanishing point -- and the
       * hole welded to it -- off the middle of the frame, and at the shipped BEND of 12 that is most of the way
       * to the edge. Building the hole out there meant the whole move arrived from a corner, which is what
       * threw it off: the eye had no centre to read it against. Straight first, and the bend eased in once
       * there is a tunnel to bend.
       *
       * They overlap: each starts before the one before it is done, so it is a hand-off rather than five
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

        // 4. the bend, last, so everything before it happens on the axis
        const lean = seg(p, 0.50, 1.00);
        o.bend = s.bend * lean;
        o.bendFlow = s.bendFlow * lean;

        /* 5. THE FLOW ONLY EVER RISES TO THE SLIDER'S RATE. It used to overshoot -- a bell peaking above idle
              and easing back down -- and that fall is the thing that read as REVERSING. Anything decelerating
              from above the rate the eye has settled on looks like it is going the other way, and there is no
              easing curve that fixes it, because the direction of the change is what is wrong.
              Nothing is lost by dropping it: beat 3 stretches DEPTH out from 0.34, and a tube being crossed in
              more distance already reads as gathering speed. That stretch IS the acceleration; the multiplier
              was a second one arguing with it. */
        const flow = 0.25 + 0.75 * seg(p, 0.18, 0.85);
        o.exposure = s.exposure * (1 + 0.3 * seg(p, 0.10, 0.42) * (1 - seg(p, 0.5, 0.95)));
        scaleShells(o, s, { speed: flow, warp: 1, amt: grow, rad: 0.12 + 0.88 * grow });
      }

      /* THE COLLAPSE IS THE DIVE RUN BACKWARDS, and it decelerates rather than rushing.
       *
       * IT STRAIGHTENS FIRST, for the reason the dive bends last: the frame has to end on the axis or the
       * tunnel leaves from a corner and there is nothing centred to watch it go.
       *
       * THEN IT SLOWS. An earlier version sped UP here, on the theory that being pulled into a hole should
       * accelerate -- but the tunnel then went out at its most frantic, which reads as a cut rather than an
       * ending. Slowing to a crawl and then losing the light is a machine being switched off.
       *
       *   1  STRAIGHTEN.  BEND and BEND FLOW back to zero, so the hole returns to the middle.
       *   2  SLOW.        The flow falls to a crawl.
       *   3  DRAWN IN.    DEPTH closes, carrying the far end and its hole onto the eye.
       *   4  OUT.         AMOUNT and EXPOSURE to nothing -- the walls stop arriving rather than dimming where
       *                   they stand, which is an ending rather than a dip. */
      if (moveT >= 0 && closing) {
        const p = clamp01(moveT / COLLAPSE_SEC);

        const straight = 1 - seg(p, 0.00, 0.42);
        o.bend = s.bend * straight;
        o.bendFlow = s.bendFlow * straight;

        const slow = 1 - 0.85 * seg(p, 0.30, 0.78);
        o.far = s.far * (1 - 0.7 * seg(p, 0.38, 0.86));

        const gone = seg(p, 0.55, 1.00);
        o.exposure = s.exposure * (1 - gone);
        scaleShells(o, s, { speed: slow, warp: 1, amt: 1 - gone });
      }

      // Shut down and finished: nothing is drawn, and the hole's own light goes with it.
      if (dark) {
        o.exposure = 0;
        o.disc = 0;
        o.mass = 0;
        // Straight while it is off, so the next engage begins on the axis rather than mid-swing.
        o.bend = 0;
        o.bendFlow = 0;
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
