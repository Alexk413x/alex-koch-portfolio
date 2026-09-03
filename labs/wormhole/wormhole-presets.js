/* What the tunnel is set to. Pure data, kept apart from the panel layout.
 *
 * THE SHIPPED SCENE IS TWO SHELLS, both at the widest radius the slider has. It was three, on the argument that
 * three is the fewest that reads as depth -- one to pass in front, one to be passed, one between them to prove
 * the other two are at different distances. That argument holds when the shells sit at DIFFERENT radii and the
 * eye reads the gaps between them. These two are both at 2.4 and are separated by what is drawn on them rather
 * than by where they are, so a third adds cost and not depth. The first shell keeps its settings and its master
 * off, so switching it on gives something tuned rather than raw.
 *
 * FILL IS COVERAGE: how much of the wall lights up, so higher is denser. It reads that way on the panel and is
 * inverted into a threshold on the way to the shader, because raising a threshold passes less.
 *
 * COVERAGE IS HIGH HERE AND THAT IS THE POINT OF THIS SCENE. fbm averages about 0.5, so coverage near half
 * passes half of everything; these two shells sit at 0.57 and 0.60 with EDGE wide open at 0.7, which is a soft
 * dense wall rather than sparse filaments. If the frame turns into a sheet of light, FILL is still the first
 * number to reach for.
 */
import { MAXL } from './wormhole-shader.js';

/* Every shell carries every key, whether or not its effects are lit, so a shell switched on later arrives tuned
 * rather than raw. The two that ship are lit; the rest sit at sensible values with their masters off.
 */
function shell(i, v) {
  const base = {
    On: 0, Rad: 0.8, Amt: 1.0,
    Cloud: 0.0, Bolts: 0.0, Streak: 0.0, Ring: 0.0,
    RingN: 4.4, RingFlow: 7.4,
    CloudA: '#ff7a1e', CloudB: '#7d2a05',
    BoltA: '#ffce85', BoltB: '#ff4d00',
    StrkA: '#ffb454', StrkB: '#ffffff',
    Fill: 0.42, Edge: 0.20, Oct: 4, Lanes: 190,
    BoltFill: 0.23, BoltEdge: 0.25, BoltRipple: 0.6,
    Speed: 6.0, Warp: 0.30, Spin: 0.0,
  };
  const out = {};
  Object.entries(Object.assign(base, v)).forEach(([k, val]) => { out['L' + i + k] = val; });
  return out;
}

export function defaultPreset(gpu) {
  const weak = gpu && gpu.integrated;
  return {
    renderScale: weak ? 0.85 : 1.0,

    /* A NARROW LENS DOWN A LONG TUBE. 30 degrees keeps the wall away from the frame's edge, so the picture reads
       as weather out in front rather than closing around the viewer, and DEPTH at 90 puts the hole far enough
       away that the tube has somewhere to go before it gets there.

       DEPTH FADE IS OFF, and with a tube this long that is a deliberate trade rather than an oversight: the fade
       exists to keep the far stretch from crowding the near one, and switching it off is what lets the whole
       length stay lit down to the throat. */
    fov: 30, exposure: 1, fog: 0,

    far: 90,
    /* BEND IS AT ITS CEILING, AND IT CAN BE. BEND and the hole fight each other only under a screen-space
       lens, which drags the whole frame toward the hole, so swinging the vanishing point away with BEND leaves
       the image pulling one way and the tunnel going another. A traced geodesic bends only light that passes
       near the hole, and the hole rides the tunnel's own axis at DEPTH -- so the tube can swing as far as it
       likes and the hole goes with it, wall and all.

       The swing saturates in the shader (see MAX_SWING), so 12 is not twelve tube radii off axis; it is as far
       round as the arch is allowed to go. */
    bend: 12, bendDir: 0.38, bendFlow: 5,

    /* THE FAR END IS A BLACK HOLE, traced along real null geodesics. MASS is the only number describing its
       gravity: the shadow's radius, the photon ring, the disc's inner edge and the disc's second image all
       follow from it and none of them has a setting of its own.

       DISC REACH IS AT ITS MAXIMUM against a MASS of 2, which is a wide thin disc rather than a tight bright
       one -- the Novikov-Thorne profile falls as r^-3, so most of that reach is dim and the light stays near
       the inner edge where it belongs.

       TILT IS NEGATIVE, which tips the disc the other way: the eye sits under its plane rather than over it.
       -86 is very near edge-on, which is where the far side climbs over the top of the shadow and hangs under
       the bottom at the same time.

       DISC FLOW IS AT ITS INWARD LIMIT. It is a rate of change of radius, so negative falls toward the hole --
       an accreting disc, being consumed as fast as this scene allows.

       DOPPLER IS OFF, so the disc is lit by its own emission and the gravitational half of the redshift alone.
       Neither limb is beamed brighter than the other, which suits a disc this close to edge-on: the beaming
       would put nearly all of the light on one side of a very thin band. */
    holeOn: 1,
    mass: 2,
    disc: 1.26, discA: '#ff3300', discB: '#ff4800',
    discTilt: -86, discLean: 0, discOut: 30, discH: 0.3, discSpin: 2, discFlow: -8, doppler: 0,

    /* TWO ARE LIT AND FOUR ARE NOT. Both lit shells sit at the widest radius, so what separates them is what is
       drawn on them: the SECOND carries the nebula with plasma and streaks through it, the THIRD carries a
       darker nebula turning the other way. The four that are off carry real settings so switching one on at its
       header gives something to look at rather than a black surface. */
    ...shell(0, { On: 0, Rad: 2.40, Amt: 0.14,
                  Bolts: 1.0, Streak: 1.0, Ring: 0.18,
                  BoltA: '#550202', BoltB: '#854000',
                  StrkA: '#ffb454', StrkB: '#ffffff',
                  Fill: 1.0, Edge: 0.70, Oct: 1, Lanes: 190,
                  BoltFill: 0.42, BoltEdge: 0.50,
                  RingN: 0.5, RingFlow: 20,
                  Speed: 4.2, Warp: 0.45 }),
    ...shell(1, { On: 1, Rad: 2.40, Amt: 0.95,
                  Cloud: 1.16, Bolts: 0.6, Streak: 0.36, Ring: 0.49,
                  CloudA: '#ff7a1e', CloudB: '#8c3a08',
                  Fill: 0.57, Edge: 0.70, Oct: 2,
                  BoltFill: 0.29, BoltEdge: 0.70,
                  RingN: 0.5, RingFlow: 20,
                  Speed: 6.0, Warp: 0.30, Spin: -0.07 }),
    ...shell(2, { On: 1, Rad: 2.40, Amt: 1.0,
                  Cloud: 1.0, Bolts: 1.06, Streak: 0.36, Ring: 0.38,
                  CloudA: '#7d2a05', CloudB: '#2a0d02',
                  Fill: 0.60, Edge: 0.70, Oct: 1, Lanes: 400,
                  BoltFill: 0.12, BoltEdge: 0.39,
                  RingN: 0.5, RingFlow: 20,
                  Speed: 3.6, Warp: 0.27, Spin: 0.11 }),
    ...shell(3, { Rad: 1.91, Amt: 0.8, Cloud: 1.0,
                  CloudA: '#3d1403', CloudB: '#140600',
                  Fill: 0.46, Edge: 0.18, Speed: 2.2, Warp: 0.18 }),
    ...shell(4, { Rad: 0.30, Amt: 0.7, Bolts: 0.8,
                  BoltA: '#ffe6bd', BoltB: '#ffa03a',
                  Edge: 0.28, Speed: 13.0, Warp: 0.55 }),
    ...shell(5, { Rad: 2.2, Amt: 0.6, Cloud: 1.0, Streak: 0.4,
                  CloudA: '#1d0a02', CloudB: '#000000',
                  Fill: 0.40, Edge: 0.16, Lanes: 90, Speed: 1.6, Warp: 0.14 }),

    secClosed: { RENDER: true, TUNNEL: false, 'BLACK HOLE': false },
  };
}

/* The intro's configuration: the shipped scene with the values Alex dialled in the lab for it, baked so the
 * intro is the same in every browser. The render scale is capped for a frame that shares its thread with two
 * others. Everything the intro moves it moves through wormhole-moves, on top of these. */
export function introPreset(gpu) {
  return {
    ...defaultPreset(gpu),
    // The disc a hair past edge-on, as Alex set it in the lab on 2026-09-02. The bend and the walls are the
    // moves' to bring in, so the shipped shells stay on and wormhole-moves holds their amount at zero until
    // the tube forms.
    discTilt: -90,
    // An opaque dark wall behind the two lit shells, at their radius so it sorts behind them: the disc's wide
    // wings then show only down the tube's opening, not through the nebula. Off in the lab.
    L3On: 1, L3Rad: 2.40, L3Amt: 1.0, L3Cloud: 1.0, L3Bolts: 0, L3Streak: 0, L3Ring: 0,
    L3CloudA: '#1a0a02', L3CloudB: '#000000', L3Fill: 1.0, L3Edge: 0.04, L3Oct: 1, L3Speed: 2.0, L3Warp: 0.15,
    renderScale: 0.75,
  };
}

export { MAXL };
