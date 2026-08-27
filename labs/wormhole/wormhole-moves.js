/* Pure: no DOM, no GL, no timers of its own. step() returns a COPY of state with
 * running moves applied and never mutates the sliders, so the panel keeps showing
 * what the user set. Driven by dt, not wall-clock time, so a move can't jump on
 * wake from a hidden tab (see lab.js's loop for uTime's version of this). While
 * idle, step() returns `s` itself so renderNow(sec) stays reproducible -- that
 * breaks once a move is running, since it carries phase forward.
 */

// Moves scale existing values rather than set targets, so a move reads the same
// whether the scene is dialled to a whisper or already at its ceiling.
const BURST_SEC = 2.4;     // long enough that both ends of it can be eased and still leave a surge between
const STORM_SEC = 7.0;     // long enough to arrive, sit, and leave
const DIVE_SEC = 3.2;      // the hole alone: huge, seen from over the top, turning down as it shrinks
const SETTLE_SEC = 3.6;    // the tunnel forms around it and the flow eases up to the slider
const COLLAPSE_SEC = 4.6;  // shutting down: straighten, the tunnel stops, the hole comes back, out

/* The hole both moves open and close on. DISC_RS is in Schwarzschild radii, not
 * the panel's world units -- tied to the hole's own mass, the disc keeps a
 * visible rim at any size; tied to an absolute reach (the panel's ~30) it would
 * overflow the frame with no rim once the hole is swollen this close. The tie
 * holds until after TILT eases in, on its own curve, or the rim's angular size
 * would swing the wrong way mid-rotation. */
const SWELL = 4.2;        // times its own mass, so the shadow is most of the frame
const NEAR = 0.55;        // and of DEPTH away, so it is close as well as large
const DISC_RS = 5.8;      // the swollen hole's disc reach, in Schwarzschild radii
const RS_PER_MASS = 0.2;  // the shader's scale from solar masses to world units, needed here to size the disc

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v) => v * v * (3 - 2 * v);

// Rises from 0, peaks once, back to 0, flat at both ends. No held plateau in the
// middle -- a value that arrives and sits still reads as a step even with smooth ramps.
const bell = (p, k) => (p <= 0 || p >= 1 ? 0 : Math.pow(Math.sin(Math.PI * p), k || 2));

// One beat of a sequence: 0 before `a`, 1 after `b`, eased between. Beats overlap
// on purpose so a move hands off instead of stopping and starting.
const seg = (p, a, b) => ease(clamp01((p - a) / (b - a)));

// Tracks the lab's transient moves (burst, storm, engage/disengage) as pure
// state, so the host drives animation without owning any of the timing itself.
export function createMoves() {
  // Each is elapsed seconds since its trigger, or -1 for idle. `engaged` is the only state that persists.
  let burstT = -1, stormT = -1, moveT = -1;
  let engaged = true, closing = false;

  const api = {
    get engaged() { return engaged; },
    get busy() { return burstT >= 0 || stormT >= 0 || moveT >= 0; },

    fireBurst() { burstT = 0; },
    fireStorm() { stormT = 0; },

    // One button, two directions: engaging dives in, disengaging collapses out.
    // Re-engaging always starts a fresh dive, never resumes a stopped collapse.
    toggle() {
      engaged = !engaged;
      closing = !engaged;
      moveT = 0;
    },

    // Advances active moves by dt and returns the new state, or `s` itself when
    // nothing is running so renderNow(sec) stays reproducible.
    step(s, dt, sec) {
      const d = Math.max(0, Math.min(0.05, dt || 0));
      if (burstT >= 0) { burstT += d; if (burstT > BURST_SEC) burstT = -1; }
      if (stormT >= 0) { stormT += d; if (stormT > STORM_SEC) stormT = -1; }
      if (moveT >= 0) {
        moveT += d;
        if (moveT > (closing ? COLLAPSE_SEC : DIVE_SEC + SETTLE_SEC)) moveT = -1;
      }

      // A shut-down lab should cost nothing per frame, so this is checked once.
      const dark = !engaged && moveT < 0;
      if (!api.busy && !dark) return s;

      const o = { ...s };

      /* The dive opens already on the hole, full size, and backs off onto the
       * tunnel's axis. There's no camera in this shader -- TILT stands in for a
       * descending viewpoint, since the eye always looks down +z. DEPTH, not
       * MASS, does the closing: shrinking MASS while the far end stays close
       * would put the disc inside the tube instead of past it. The tunnel must
       * start opening before the hole finishes shrinking, or its angular size
       * (1/DEPTH) leaves a dead beat of tiny hole in an empty frame. Bend comes
       * last because it swings the vanishing point off-center; done early, the
       * move reads as arriving from a corner instead of the middle. Beats
       * overlap so each hands off rather than starting cold. */
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

        // 7. Flow only rises to the slider's rate, never past it -- decelerating from
        //    above it reads as reversing, and beat 4's stretch already reads as speeding up.
        const flow = 0.25 + 0.75 * seg(p, 0.40, 0.92);
        // A lift timed to the tunnel and not to the hole, which is already the brightest thing on screen.
        o.exposure = s.exposure * (1 + 0.25 * seg(p, 0.42, 0.68) * (1 - seg(p, 0.84, 1.00)));
        scaleShells(o, s, { speed: flow, warp: 1, amt: grow, rad: 0.12 + 0.88 * grow });
      }

      /* The collapse runs the dive backwards, ending on the same over-the-top
       * frame the dive opened on. It decelerates rather than speeding up -- an
       * earlier version accelerated into the hole, but the tunnel then quit at
       * its most frantic, which read as a cut rather than an ending. It
       * straightens first for the same reason the dive bends last: off-axis,
       * the hole would swell from a corner instead of the middle. */
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

      if (dark) {
        o.exposure = 0;
        o.disc = 0;
        o.mass = 0;
        // Straight while it is off, so the next engage begins on the axis rather than mid-swing.
        o.bend = 0;
        o.bendFlow = 0;
        scaleShells(o, s, { speed: 1, warp: 1, amt: 0 });
      }

      /* Burst only touches shell SPEED -- the one rate that reads as "the camera
       * is covering ground." bendFlow and stretch are deliberately left alone:
       * touching them reads as the tunnel itself writhing rather than the viewer
       * moving through it, and an earlier version that did was reverted for it. */
      if (burstT >= 0) {
        const k = bell(burstT / BURST_SEC);
        scaleShells(o, s, { speed: 1 + 1.1 * k, warp: 1, amt: 1 }, o);
      }

      /* Storm pushes each effect the way that effect reads as more intense, and
       * they're not all the same way. Nebula FILL (coverage) rises, not AMOUNT
       * (brightness) -- more amount just glares the cloud already on screen.
       * Plasma and streaks gain brightness instead, since they're the sharp
       * foreground detail. LANES (streak count) stays fixed: the lane index
       * seeds each streak's look, so changing it would re-roll every streak at
       * once. No exposure lift, or the nebula would double up with FILL. */
      if (stormT >= 0) {
        const k = bell(stormT / STORM_SEC, 1.4);
        for (let i = 0; i < 6; i++) {
          const p = 'L' + i;
          // FILL is coverage on the panel; the host inverts it into the fbm threshold.
          o[p + 'Fill'] = Math.min(1, s[p + 'Fill'] + 0.30 * k);
          // The added term is what lights a shell whose amount is otherwise zero.
          o[p + 'Bolts'] = s[p + 'Bolts'] * (1 + 1.8 * k) + 0.30 * k;
          o[p + 'Streak'] = s[p + 'Streak'] * (1 + 1.8 * k) + 0.30 * k;
          o[p + 'BoltRipple'] = s[p + 'BoltRipple'] + 1.2 * k;
        }
      }
      return o;
    },
  };
  return api;
}

// Scales the four per-shell rates a move can reach. `from` defaults to `s` so a
// second move composes onto the first instead of overwriting it.
function scaleShells(o, s, m, from) {
  const src = from || s;
  for (let i = 0; i < 6; i++) {
    const p = 'L' + i;
    if (m.speed !== 1) o[p + 'Speed'] = src[p + 'Speed'] * m.speed;
    if (m.warp !== 1) o[p + 'Warp'] = src[p + 'Warp'] * m.warp;
    if (m.amt !== 1) o[p + 'Amt'] = src[p + 'Amt'] * m.amt;
    if (m.spin) o[p + 'Spin'] = src[p + 'Spin'] * m.spin;
    // Scales every shell by the same factor, which preserves their radius ORDER --
    // the host composites inner-first, so a move that changed order would swap occlusion.
    if (m.rad) o[p + 'Rad'] = src[p + 'Rad'] * m.rad;
  }
}

// Sizes the hole and its disc. `k` is how far the mass is swollen toward SWELL;
// `open` is separately how far the disc has opened from a DISC_RS-wide ring to
// the slider's own reach. Two curves because they run at different times -- see DISC_RS.
function swellHole(o, s, k, open) {
  const mass = s.mass * (1 + (SWELL - 1) * k);
  o.mass = mass;
  const tight = mass * RS_PER_MASS * DISC_RS;
  o.discOut = tight + (s.discOut - tight) * open;
}
