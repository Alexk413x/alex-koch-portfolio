/* What the tunnel is set to. Pure data, kept apart from the panel layout.
 *
 * THE SHIPPED SCENE IS THREE SHELLS, and it is three because that is the fewest that reads as depth: a near one
 * to pass in front, a far one to be passed, and one between them to prove the other two are at different
 * distances. Two reads as a foreground and a backdrop; one is a wall.
 *
 * FILL IS HIGH ON PURPOSE, and this is the number to reach for first if the scene turns into a sheet of light.
 * fbm averages about 0.5, so a threshold near it passes half of everything -- and three shells each passing half
 * is solid. Sparse shells are what let the eye see PAST the near one to the far one, which is the entire reason
 * there is more than one.
 */
import { MAXL } from './tunnel-shader.js';

/* Every shell carries every key, whether or not its effects are lit, so a shell switched on later arrives tuned
 * rather than raw. The three that ship are lit; the rest sit at sensible values with their masters off.
 */
function shell(i, v) {
  const base = {
    On: 0, Rad: 0.8, Amt: 1.0,
    Cloud: 0.0, Bolts: 0.0, Streak: 0.0, Ring: 0.0,
    CloudA: '#ff7a1e', CloudB: '#7d2a05',
    BoltA: '#ffce85', BoltB: '#ff4d00',
    StrkA: '#ffb454', StrkB: '#ffffff',
    Fill: 0.58, Edge: 0.20, Oct: 4, Lanes: 190,
    Speed: 6.0, Warp: 0.30, Spin: 0.0,
  };
  const out = {};
  Object.entries(Object.assign(base, v)).forEach(([k, val]) => { out['L' + i + k] = val; });
  return out;
}

export function defaultPreset(gpu) {
  const weak = gpu && gpu.integrated;
  return {
    /* MEASURED: this scene holds 60 at full render scale on an Intel UHD 630 -- 1584x905, 1.43 MP, about 5.8 ms
     * per megapixel. The marched lab next door needs 45% scale and 0.23 MP for the same 60, at 46 ms/MP. The
     * integrated path still starts a notch down because a shell is cheap but not free and the count is a slider.
     */
    renderScale: weak ? 0.85 : 1.0,

    fov: 74, exposure: 1.15, fog: 1.0,

    far: 26, wind: 1.0,
    /* BEND IS LOW NOW THE FAR END IS A HOLE, and that is a real conflict rather than a taste. BEND swings the
     * vanishing point around the frame; the lens warps everything toward it. Both are "the far end distorts",
     * and run together they fight -- the hole slides about while the image drags toward wherever it went, and
     * neither reads. A black hole wants to ANCHOR: it sits still and the tunnel falls into it. TIGHTNESS and
     * BEND FLOW are not duplicates of the lens and are worth keeping, but they do nothing while BEND is near
     * zero, which is the honest reason they look redundant here. */
    /* BEND LENGTH IS SET AGAINST DEPTH, not picked for its own sake. It is the distance between corners in world
       units, so at 30 against a DEPTH of 26 you see about one whole wave down the tunnel -- a bend that arrives,
       straightens and leaves. It shipped at 46, nearly twice the depth, which shows a third of one wave: that is
       a permanent lean with no corner in it, and it is why the tube read as leaning rather than bending. */
    bend: 3.0, bendDir: 0.0, bendFlow: 5.0,
    // The whole-tunnel ring pass is off: the shells carry their own, which foreshorten with the shell they are on.
    ringAmt: 0.0, ringN: 4.4, ringFlow: 7.4,


    /* THE FAR END IS A BLACK HOLE. It was a glow sprite, which sat on top of the winding at the vanishing point
     * and hid it -- and that winding is the one thing this technique has that a march cannot produce. A hole
     * works with it: the lens drags the wrapped wall around the shadow instead of covering it.
     *
     * MASS IS MODEST ON PURPOSE. The deflection goes as 1/b, so past about 1.5 the whole frame smears toward the
     * centre and the tunnel stops reading as a tunnel.
     *
     * DISC TILT SHIPS NEAR EDGE-ON, and that is the whole look. At 90 degrees the plane faces the camera and
     * draws a ring AROUND the hole -- which is what this shipped as, and it is why the disc read as a circle in
     * the middle rather than as a horizon. Near zero the plane is seen along its own surface: it crosses the
     * middle as a band, its far side lenses over the top of the shadow, and the light sits on the EDGE where it
     * belongs. */
    holeOn: 1,
    mass: 1.0, ring: 0.9, ringCol: '#ffd9a0',
    disc: 1.0, discA: '#fff0cf', discB: '#c23a05',
    discThick: 0.16, discTilt: 0.12, discLean: 0.0, discOut: 3.6, discSpin: 2.4, doppler: 0.85,

    /* THREE ARE LIT AND THREE ARE NOT, and three is the fewest that reads as depth: one to pass in front, one
     * to be passed, and one between them to prove the other two are at different distances. Two reads as a
     * foreground and a backdrop; one is a wall. The other three carry real settings so switching one on at its
     * header gives something to look at rather than a black surface. */
    ...shell(0, { On: 1, Rad: 0.50, Amt: 0.85,
                  Bolts: 1.0, Streak: 1.0, Ring: 0.25,
                  BoltA: '#ffe6bd', BoltB: '#ff7a1e',
                  StrkA: '#ffb454', StrkB: '#ffffff',
                  Edge: 0.22, Oct: 3, Lanes: 190, Speed: 9.0, Warp: 0.45 }),
    ...shell(1, { On: 1, Rad: 0.85, Amt: 0.95,
                  Cloud: 1.0, Ring: 0.45,
                  CloudA: '#ff7a1e', CloudB: '#8c3a08',
                  Fill: 0.58, Edge: 0.20, Speed: 6.0, Warp: 0.30 }),
    ...shell(2, { On: 1, Rad: 1.35, Amt: 1.0,
                  Cloud: 1.0,
                  CloudA: '#7d2a05', CloudB: '#2a0d02',
                  Fill: 0.55, Edge: 0.18, Speed: 3.6, Warp: 0.22 }),
    ...shell(3, { Rad: 1.9, Amt: 0.8, Cloud: 1.0,
                  CloudA: '#3d1403', CloudB: '#140600',
                  Fill: 0.54, Edge: 0.18, Speed: 2.2, Warp: 0.18 }),
    ...shell(4, { Rad: 0.30, Amt: 0.7, Bolts: 0.8,
                  BoltA: '#ffe6bd', BoltB: '#ffa03a',
                  Edge: 0.28, Speed: 13.0, Warp: 0.55 }),
    ...shell(5, { Rad: 2.2, Amt: 0.6, Cloud: 1.0, Streak: 0.4,
                  CloudA: '#1d0a02', CloudB: '#000000',
                  Fill: 0.60, Edge: 0.16, Lanes: 90, Speed: 1.6, Warp: 0.14 }),

    secClosed: { RENDER: true, TUNNEL: false, 'BLACK HOLE': false },
  };
}

export { MAXL };
