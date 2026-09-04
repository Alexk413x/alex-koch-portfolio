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
const OPEN_SEC = 2.3;      // the intro's arrival: the depth brings the hole in, a slow tilt, the walls come up and it backs off
const RUN_SEC = 2.0;       // the intro's exit: the tube straightens and its end comes up to the eye
// The cruise's depth and lens, as fractions of the sliders: shorter and wider so the bend reads as the arch it is.
// The arrival lands on these, so the hand-off to the cruise does not step.
// Shorter and wider still than the lab's: the same swing over less depth is a sharper arch.
const CRUISE_FAR = 0.5;
const CRUISE_FOV = 1.35;
// Where the arrival's tilt lands and the cruise holds it: face-on, in the panel's degrees.
const FACE = 0;
// The arrival's nearest depth, the exit's, and the bend the cruise ramps to. World units, as the sliders are.
const NEAR_FAR = 15;
const START_FAR = 1.8;   // times the slider's depth: where the arrival begins, so the hole opens small
const EXIT_FAR = 2;       // close enough that the shadow grows past the frame's edges
const BEND = 20;
const BEND_IN_SEC = 2.5;   // the cruise's bend comes up over this, from nothing; at full swing before the exit
/* The flow through the intro, as multiples of the slider's speed. The walls rise through the arrival's back-off
 * to seven tenths of CRUISE_TOP, then on to CRUISE_TOP over CRUISE_ACCEL_SEC of flight; the exit climbs to RUN_SPEED
 * before the depth pulls in. Bursts ride on top of this. */
const CRAWL = 0.3;
const CRUISE_TOP = 2.4;
const CRUISE_ACCEL_SEC = 3.0;
// The flight's acceleration starts this long before the arrival's back-off lands, so the flow is already
// picking up as the depth settles rather than sitting flat for a beat between the two eases.
const CRUISE_LEAD_SEC = 0.1;
const RUN_SPEED = 3.6;

// The reactor's STABLE green, in hue degrees. The palette starts turning to it TINT_START seconds into the
// flight and is there TINT_SEC later, which runs on into the exit.
const GREEN_HUE = 118;
const TINT_START = 1.0;
const TINT_SEC = 3.0;

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
// `opts.engaged` false starts the tunnel dark, so a host can open on black and dive in on cue.
export function createMoves(opts) {
  // Each is elapsed seconds since its trigger, or -1 for idle. `engaged` is the only state that persists.
  let burstT = -1, stormT = -1, moveT = -1, runT = -1, openT = -1;
  let engaged = !(opts && opts.engaged === false), closing = false;
  // After the intro's arrival the tube cruises: the bend at full swing, its direction wandering, until the run.
  let cruise = false, cruiseT = 0;

  const api = {
    get engaged() { return engaged; },
    get busy() { return burstT >= 0 || stormT >= 0 || moveT >= 0 || runT >= 0 || openT >= 0 || cruise; },
    // Where each move has got to, in seconds, or -1. A director sequencing the moves reads these.
    get moveT() { return moveT; },
    get runT() { return runT; },
    get openT() { return openT; },
    get cruising() { return cruise; },
    // The intro's arrival, from dark. Ends in the cruise, which the run ends.
    fireOpen() { openT = 0; cruise = false; cruiseT = 0; },

    fireBurst() { burstT = 0; },
    fireStorm() { stormT = 0; },
    // The exit. Ends with the frame at white and the tunnel gone, so whatever follows can cut in under it.
    fireRun() { runT = 0; },

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
      if (openT >= 0) { openT += d; if (openT > OPEN_SEC) { openT = -1; cruise = true; } }
      if ((cruise || (openT >= 0 && openT >= OPEN_SEC - CRUISE_LEAD_SEC)) && runT < 0) cruiseT += d;
      // The run holds at its last frame rather than retiring: what follows it is a cut, and the cut decides
      // when this scene is done.
      if (runT >= 0 && runT < RUN_SEC) runT = Math.min(RUN_SEC, runT + d);

      // A shut-down lab should cost nothing per frame, so this is checked once.
      const dark = !engaged && moveT < 0 && runT < 0 && openT < 0 && !cruise;
      if (!api.busy && !dark) return s;

      const o = { ...s };
      // Ease-out, not smoothstep: it has to leave the arrival's speed with slope, or the hand-off reads as a stall.
      const accel = 1 - Math.pow(1 - clamp01(cruiseT / CRUISE_ACCEL_SEC), 2);
      const cruiseSpeed = CRAWL + (CRUISE_TOP - CRAWL) * (0.7 + 0.3 * accel);

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

      /* The intro's arrival. The hole is lit under the tube's collapse, then the DEPTH brings it to the eye:
       * the slider's far end down to NEAR_FAR, the mass unchanged, so it grows the way a thing does when it is
       * approached. The tilt to face-on begins as that approach eases to a stop, three quarters of the way in,
       * and holds from then on. The walls begin just before the approach and the tilt land together, and the
       * depth slides back out to the cruise's, the flow easing up to speed. */
      if (openT >= 0) {
        const p = clamp01(openT / OPEN_SEC);
        // The disc lights under the tube's collapse and is already growing and coming in before the tube fades,
        // so nothing waits for the screen to go dark.
        const lit = seg(p, 0.021, 0.043);
        const near = seg(p, 0.066, 0.48);
        const form = seg(p, 0.46, 0.72);
        const out = seg(p, 0.50, 1.00);
        o.disc = s.disc * lit;
        const inFar = s.far * START_FAR + (NEAR_FAR - s.far * START_FAR) * near;
        o.far = inFar + (s.far * CRUISE_FAR - inFar) * out;
        o.fov = s.fov * (1 + (CRUISE_FOV - 1) * out);
        o.discTilt = s.discTilt + (FACE - s.discTilt) * seg(p, 0.27, 0.48);
        // The turn begins with the flight's acceleration, CRUISE_LEAD_SEC before the back-off lands.
        o.bend = BEND * seg(cruiseT / BEND_IN_SEC, 0, 1);
        o.exposure = s.exposure * (1 + 0.2 * form);
        scaleShells(o, s, { speed: cruiseT > 0 ? cruiseSpeed : CRAWL + (CRUISE_TOP - CRAWL) * 0.7 * out, warp: 1, amt: form, rad: 0.12 + 0.88 * form });
      }

      /* The cruise, and the run over it. The bend ramps in over the first seconds of the flight, from nothing
       * to BEND, and its DIRECTION is driven here rather than spun by the shader's clock: two slow sines send
       * it back and forth across most of a turn instead of round and round. The depth is shortened and the
       * lens widened so the swing reads as the arch it is. */
      if (cruise || runT >= 0 || openT >= 0) {
        o.bendFlow = 0;
        o.bendDir = s.bendDir + 1.8 * Math.sin(0.55 * sec) + 0.9 * Math.sin(0.21 * sec + 2.0);

        // The palette turns green over the flight: nothing at the arrival, the core's green by the exit.
        const tint = seg((cruiseT + Math.max(0, runT) - TINT_START) / TINT_SEC, 0, 1);
        if (tint > 0) {
          o.discA = tintToward(s.discA, tint); o.discB = tintToward(s.discB, tint);
          for (let i = 0; i < 6; i++) {
            const p = 'L' + i;
            for (const k of ['CloudA', 'CloudB', 'BoltA', 'BoltB', 'StrkA', 'StrkB']) o[p + k] = tintToward(s[p + k], tint);
          }
        }
      }
      if (cruise || runT >= 0) {
        o.far = s.far * CRUISE_FAR;
        o.fov = s.fov * CRUISE_FOV;
        o.discTilt = FACE;
        o.bend = BEND * seg(cruiseT / BEND_IN_SEC, 0, 1);
        scaleShells(o, s, { speed: cruiseSpeed, warp: 1, amt: 1 });
      }

      /* The run. First the flow climbs to its top speed while the bend straightens; then the depth pulls in to
       * EXIT_FAR and the walls thin and fade as it does, while the flow keeps climbing rather than easing off --
       * the hole comes up to the eye and past it, and what cuts in under this is what is on the other side. */
      if (runT >= 0) {
        const p = clamp01(runT / RUN_SEC);
        // The cut over this begins halfway in, so the end is reached and the hole is past the eye by then: the
        // depth is in by the half and the swell is most of the way; the last half is the shadow, under the fade.
        o.bend = BEND * (1 - seg(p, 0.00, 0.35));
        const rush = seg(p, 0.05, 0.50);
        o.far = s.far * CRUISE_FAR + (EXIT_FAR - s.far * CRUISE_FAR) * rush;
        // And the hole swells as it is reached, so the eye goes into the shadow rather than past a small one.
        o.mass = s.mass * (1 + 1.5 * seg(p, 0.28, 0.60));
        o.exposure = s.exposure * (1 + 0.35 * rush);
        scaleShells(o, s, { speed: cruiseSpeed + (RUN_SPEED - cruiseSpeed) * seg(p, 0.00, 0.65), warp: 1, amt: 1 - rush });
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

// Reads a '#rrggbb' string as [hue 0..360, saturation 0..1, lightness 0..1].
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

// Writes [hue 0..360, saturation 0..1, lightness 0..1] as a '#rrggbb' string.
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Turns a hex colour's hue toward GREEN_HUE by k, keeping its saturation and lightness, so a warm palette
// becomes the same palette in green rather than a different one.
function tintToward(hex, k) {
  const [h, s, l] = hexToHsl(hex);
  // Shortest way round the wheel.
  let d = ((GREEN_HUE - h + 540) % 360) - 180;
  return hslToHex((h + d * k + 360) % 360, s, l);
}
