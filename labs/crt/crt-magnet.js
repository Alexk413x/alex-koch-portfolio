/* crt-magnet.js — the magnet's timeline: where the pole is, and how hard it pulls.
 *
 * Pure: it returns numbers the shader displaces a coordinate with, and touches nothing.
 *
 * WHY THIS IS NOT A PORT OF THE DOM BUILD'S. That one transformed the element holding the TEXT and deliberately
 * held the glass layers still, because there is no way to bend one composited layer without re-rastering all of
 * them. A magnet bends the BEAM, so the scanlines, the mask, the grid and the bloom all bend with it and only
 * the glass stays put — which this build can say directly, because each of those is a function of one coordinate.
 *
 * The pole ORBITS rather than crossing or tracing a Lissajous figure. A crossing at fixed height can only ever
 * disturb one band; a Lissajous spends most of its time reversing at the ends of its travel, which still reads
 * as oscillation. A magnet being walked around a screen goes round, one way, at a rate that varies within the lap.
 *
 * And it is a SPRING, not a sine: a raster under a magnet is a deflection circuit being fought, so it overshoots
 * its rest position on release and rings down. SPRING is how much of the motion is that ringing.
 */

const REST = { k: [0, 0, 0, 0], pos: [0.5, 0.5], r: [0.5, 0.55], d: [0, 0] };
const TAU = Math.PI * 2;

/* A factory, because it holds the run's clock and its seed.
 *
 * `env` carries what the magnet cannot know for itself: `face` is the dome depth, `aspect` the tube's, and
 * `rgbScale` converts the RGB split from panel pixels into the picture's own 0..1.
 */
export function createMagnet() {
  let t0 = null, seed = 0;

  return {
    get t0() { return t0; },

    /* A different path every press. The SHAPE is authored; where the pole wanders is not, and a magnet arriving
       on the same track twice is the tell that it is canned. */
    trigger(now) {
      t0 = (now == null ? performance.now() : now);
      seed = Math.random() * 1000;
    },

    at(now, s, env) {
      if (t0 == null) return REST;
      const t = (now - t0) / (Math.max(0.05, s.warpSec) * 1000);
      if (t < 0 || t >= 1) return REST;

      const env0 = Math.sin(Math.PI * t);
      /* Centred on 1 so the ring MODULATES the pull rather than replacing it, and floored at 0.15 so a hard ring
         cannot invert the field — a magnet does not repel on the rebound; the picture does. */
      const ring = Math.exp(-t * 3.2) * Math.sin(t * TAU * (1.4 + s.wwig * 2.2));
      const spr  = Math.max(0.15, 1 + ring * s.warpSpring * 1.6);
      const amp  = s.wint * env0 * spr;

      /* THE DOME TRADES THE SWEEP FOR THE SQUEEZE. A picture painted inside a bowl cannot slide sideways as
         freely as one on a flat sheet, so the pole's authority is scaled DOWN by the dome and handed to the
         pinch rather than added to it: a deep FACE cannot throw the picture off the tube. */
      const dome  = Math.min(1, Math.abs(env.face));
      const slide = 1 - dome * 0.55;

      const spin = (seed % 2 < 1) ? 1 : -1;
      const laps = 1 + (seed % 1.7);
      // A time warp, not a second oscillator: the pole never reverses, it covers some of the circle faster.
      const tw   = t + Math.min(0.4, s.wwig * 0.13) * Math.sin(t * TAU);
      const ang  = spin * TAU * laps * tw + seed;
      const rad  = 0.30 + 0.20 * Math.sin(t * TAU * 1.3 + seed * 2.1);
      // The x radius carries the aspect, or a circular orbit in suv is an ellipse on a 16:9 tube.
      const asp  = Math.max(0.2, env.aspect);
      const px   = 0.5 + rad * Math.cos(ang) * Math.min(1.6, asp * 0.85);
      const py   = 0.5 + rad * Math.sin(ang);

      // Pointed at the pole, so the whole raster follows it round rather than merely leaning.
      const dl = Math.hypot(px - 0.5, py - 0.5) || 1;
      const drag = amp * s.warpDrag * slide;

      return {
        k: [amp * s.warpPinch * (0.45 + 0.55 * dome),
            amp * s.warpPull * slide,
            amp * s.warpSwirl,
            /* Over the raster scale, like the static convergence: 31.5px is a radius chosen so the three rasters
               land a full glyph apart. Fixed, it would not make a phone's warp more dramatic, it would make it a
               different effect — the text gone rather than pulled apart. */
            amp * s.warpRGB * env.rgbScale],
        pos: [px, py],
        r: [Math.max(0.02, s.warpR), s.warpRim],
        d: [(px - 0.5) / dl * drag, (py - 0.5) / dl * drag],
      };
    },
  };
}
