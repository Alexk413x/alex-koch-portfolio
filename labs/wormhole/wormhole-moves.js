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
const DIVE_SEC = 3.2;      // the hole alone: huge, seen from over the top, turning down as it shrinks
const SETTLE_SEC = 3.6;    // the tunnel forms around it and the flow eases up to the slider
const COLLAPSE_SEC = 4.6;  // shutting down: straighten, the tunnel stops, the hole comes back, out

/* THE HOLE BOTH MOVES OPEN AND CLOSE ON, relative to the scene the sliders describe. The dive starts here and
 * leaves it; the collapse arrives back at it and goes out.
 *
 * REACH IS QUOTED IN SCHWARZSCHILD RADII HERE AND IN WORLD UNITS ON THE PANEL, which is the whole reason it
 * has to move at all. DISC REACH is an outright radius, so a hole swollen four times its mass keeps a disc of
 * the same absolute size -- and the shipped 30 units of it around a hole this close covers the frame corner to
 * corner, with no outer edge in the picture and so nothing to read the rotation against. Tied to Rs instead,
 * the disc stays a ring with a visible rim however large the hole is.
 *
 * AND IT HOLDS THAT TIE UNTIL AFTER THE ROTATION, on a curve of its own rather than the one MASS is on. Run
 * together, REACH climbs toward the slider's 30 while the hole shrinks under it, so the disc's ANGULAR size
 * grows even as its hole's falls: the rim leaves the frame in the middle of the sweep, which is exactly where
 * the rim is the only thing telling you the disc is turning. Held in Rs, the disc shrinks with its hole and
 * keeps its rim; it opens out to the slider's reach later, once the tunnel is what the eye is reading. */
const SWELL = 4.2;        // times its own mass, so the shadow is most of the frame
const NEAR = 0.55;        // and of DEPTH away, so it is close as well as large
const DISC_RS = 5.8;      // the swollen hole's disc reach, in Schwarzschild radii
const RS_PER_MASS = 0.2;  // the shader's scale from solar masses to world units, needed here to size the disc

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v) => v * v * (3 - 2 * v);

/* ONE CURVE FOR EVERY MOVE: rises from nothing, peaks once, returns to nothing, and is flat at both ends so
 * there is no corner where it starts or stops. p runs 0..1 across the move and k sets how broad the peak is.
 *
 * THERE IS NO HOLD IN THE MIDDLE. An ease-in, hold, ease-out shape would be
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

      /* THE DIVE IS AN APPROACH SEEN FROM ITS OTHER END: it opens on the hole from directly over it, close
       * enough to overflow the frame, and everything after that is the eye backing off and coming down onto the
       * tunnel's axis. The tunnel only exists once there is somewhere to put it.
       *
       * THERE IS NO CAMERA IN THIS SHADER, AND THE MOVE DOES NOT NEED ONE. The eye sits at the origin looking
       * down +z and every ray is built from that, so a viewpoint over the disc cannot be had by moving it. What
       * can be had is the disc's own orientation: TILT 0 puts the disc's normal on the eye, which IS looking
       * straight down on it, and the slider's angle is near edge-on. Sweeping between the two makes the picture
       * a descending camera would make, and it costs one uniform rather than a camera basis in every ray.
       *
       * THE HOLE DOES NOT COME CLOSER, IT GETS BIGGER -- and it has to be that way round. Angular size is
       * rs/distance so either lever will fill the frame, but DEPTH is also where the tunnel ENDS: driving it
       * near enough to swell the hole puts the tube's far end a few units in front of the eye, inside a disc
       * whose reach does not move, and the shot becomes weather rather than a hole. MASS moves the hole alone.
       * DEPTH still closes, but only to NEAR, which is a lean-in and not an arrival.
       *
       * The beats, in the order they are seen:
       *
       *   1  LIGHT, NOT GROWTH.  The hole is at full size on the first frame; what comes up is the disc's
       *      brightness. Scaling MASS from zero instead grows the shadow out of a point, which is a thing being
       *      assembled rather than a thing being arrived at.
       *   2  THE SWELL FALLS AWAY.  MASS eases from SWELL back to the slider and the disc opens from the tight
       *      ring it wears close up out to the slider's reach. This is the zoom-out.
       *   3  THE EYE COMES DOWN OFF THE TOP.  TILT sweeps from flat to the slider's angle.
       *   4  THE FAR END DRAWS AWAY.  DEPTH grows from NEAR to what the slider says, carrying the hole with it.
       *   5  THE TUNNEL OPENS AROUND THE VIEWER, while the hole is still shrinking rather than after it has
       *      stopped. Waited out, the shrink leaves a second of small hole alone in a black frame, because the
       *      hole loses the frame far faster than it loses its size -- angular size falls as 1/DEPTH and DEPTH
       *      is still climbing. The tube has to be arriving by then or there is a dead beat in the middle.
       *   6  THE TUNNEL BENDS, last of all.
       *   7  THE FLOW EASES UP TO THE SLIDER'S RATE, and never past it.
       *
       * IT STARTS DEAD STRAIGHT, AND THAT IS WHY BEND IS LAST. The bend swings the vanishing point -- and the
       * hole welded to it -- off the middle of the frame, and at the shipped BEND of 12 that is most of the way
       * to the edge. Building the hole out there meant the whole move arrived from a corner, which is what
       * threw it off: the eye had no centre to read it against. Straight first, and the bend eased in once
       * there is a tunnel to bend.
       *
       * They overlap: each starts before the one before it has finished, so it is a hand-off rather than seven
       * separate events queued up. */
      if (moveT >= 0 && !closing) {
        const p = clamp01(moveT / (DIVE_SEC + SETTLE_SEC));

        // 1. the light, not the hole
        o.disc = s.disc * seg(p, 0.00, 0.12);

        // 2. the swell falling away, the disc holding its shape through it and opening out afterwards
        swellHole(o, s, 1 - seg(p, 0.06, 0.54), seg(p, 0.40, 0.84));

        // 3. off the top and down onto the axis
        o.discTilt = s.discTilt * seg(p, 0.08, 0.52);

        // 4. the far end -- and the hole on it -- drawing off. Starts near, ends where the slider put it.
        o.far = s.far * (NEAR + (1 - NEAR) * seg(p, 0.20, 0.82));

        // 5. the tube opening around the viewer, arriving while the hole still has size to lose
        const grow = seg(p, 0.36, 0.80);

        // 6. the bend, last, so everything before it happens on the axis
        const lean = seg(p, 0.58, 1.00);
        o.bend = s.bend * lean;
        o.bendFlow = s.bendFlow * lean;

        /* 7. THE FLOW ONLY EVER RISES TO THE SLIDER'S RATE, AND NEVER PAST IT. A bell peaking above idle and
              easing back down reads as REVERSING: anything decelerating from above the rate the eye has settled
              on looks like it is going the other way, and no easing curve fixes that, because the direction of
              the change is what is wrong. Nothing is lost by leaving it out -- beat 4 stretches DEPTH out from
              NEAR, and a tube crossed in more distance already reads as gathering speed. That stretch IS the
              acceleration, and a multiplier would be a second one arguing with it. */
        const flow = 0.25 + 0.75 * seg(p, 0.40, 0.92);
        // A lift timed to the tunnel and not to the hole, which is already the brightest thing on screen.
        o.exposure = s.exposure * (1 + 0.25 * seg(p, 0.42, 0.68) * (1 - seg(p, 0.84, 1.00)));
        scaleShells(o, s, { speed: flow, warp: 1, amt: grow, rad: 0.12 + 0.88 * grow });
      }

      /* THE COLLAPSE IS THE DIVE RUN BACKWARDS, and it ends on the frame the dive opened on: the hole alone,
       * swollen, seen from over the top. The last thing in the picture is the thing the arrival led with.
       *
       * IT DECELERATES RATHER THAN RUSHING. An earlier version sped UP here, on the theory that being pulled
       * into a hole should accelerate -- but the tunnel then went out at its most frantic, which reads as a cut
       * rather than an ending. The tunnel stopping and the hole swelling into the frame it is left alone in is
       * a place being left.
       *
       * IT STRAIGHTENS FIRST, for the reason the dive bends last: the frame has to be on the axis or the hole
       * swells from a corner and there is nothing centred to watch it go.
       *
       *   1  STRAIGHTEN.  BEND and BEND FLOW back to zero, so the hole returns to the middle.
       *   2  THE TUNNEL STOPS ARRIVING.  The flow falls to a crawl and AMOUNT goes to nothing -- the walls stop
       *      coming rather than dimming where they stand, which is an ending rather than a dip.
       *   3  THE HOLE COMES BACK.  DEPTH closes to NEAR and MASS swells to SWELL, so it fills the emptied frame.
       *   4  THE EYE LIFTS BACK OVER THE TOP.  TILT returns to flat.
       *   5  OUT.  The disc's light and the exposure go together, on a frame with nothing else left in it. */
      if (moveT >= 0 && closing) {
        const p = clamp01(moveT / COLLAPSE_SEC);

        const straight = 1 - seg(p, 0.00, 0.30);
        o.bend = s.bend * straight;
        o.bendFlow = s.bendFlow * straight;

        const slow = 1 - 0.85 * seg(p, 0.14, 0.52);
        const gone = seg(p, 0.20, 0.56);

        const swell = seg(p, 0.34, 0.86);
        o.far = s.far * (1 - (1 - NEAR) * swell);
        swellHole(o, s, swell, 1 - seg(p, 0.20, 0.60));

        o.discTilt = s.discTilt * (1 - seg(p, 0.38, 0.90));

        const out = seg(p, 0.86, 1.00);
        o.disc = s.disc * (1 - out);
        o.exposure = s.exposure * (1 - out);
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

      /* STORM. Each effect is pushed the way that effect gets more intense, and they are not the same way.
       *
       * THE NEBULA GAINS COVERAGE AND NOT BRIGHTNESS. Its FILL is the threshold the fbm is cut at, so lowering
       * it lights wall that was dark -- the cloud spreads. Its AMOUNT is left alone: raising that would make
       * the cloud already on screen glare instead, which is a brighter picture rather than a heavier one, and
       * the wall is the backdrop the other two are read against.
       *
       * PLASMA AND STREAKS GAIN BRIGHTNESS, because that is what those two are for: they are the sharp things
       * in the frame, and a storm should put more of them in it and drive them harder.
       *
       * STREAK COUNT IS DELIBERATELY NOT TOUCHED. LANES sets how many there are, and the lane index seeds the
       * hash that gives each one its head, its colour and whether it is lit at all -- so changing the count
       * re-rolls every streak at once and they all jump. More streaks has to come from their amount.
       *
       * NO EXPOSURE LIFT EITHER. That multiplies the whole frame, nebula included, which is the brightness the
       * first clause of this comment exists to avoid.
       *
       * It arrives and leaves on the same curve, so there is no moment where it snaps off. */
      if (stormT >= 0) {
        const k = bell(stormT / STORM_SEC, 1.4);
        for (let i = 0; i < 6; i++) {
          const p = 'L' + i;
          // The cloud spreads. FILL is coverage on the panel and the host inverts it into the threshold.
          o[p + 'Fill'] = Math.min(1, s[p + 'Fill'] + 0.30 * k);
          // The sharp things get harder. The added term is what lights a shell whose amount is zero.
          o[p + 'Bolts'] = s[p + 'Bolts'] * (1 + 1.8 * k) + 0.30 * k;
          o[p + 'Streak'] = s[p + 'Streak'] * (1 + 1.8 * k) + 0.30 * k;
          // And the filament writhes harder while it is happening.
          o[p + 'BoltRipple'] = s[p + 'BoltRipple'] + 1.2 * k;
        }
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

/* Sizes the hole and its disc. `k` is how far the mass is swollen toward SWELL; `open` is separately how far
   the disc has been let out from a ring DISC_RS across -- which tracks whatever the mass currently is -- to
   the outright reach the slider asks for. Two curves, because they run at different times: see DISC_RS. */
function swellHole(o, s, k, open) {
  const mass = s.mass * (1 + (SWELL - 1) * k);
  o.mass = mass;
  const tight = mass * RS_PER_MASS * DISC_RS;
  o.discOut = tight + (s.discOut - tight) * open;
}
