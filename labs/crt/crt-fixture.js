/* crt/crt-fixture.js — the light fixture's appearance: the tube's emission, its halo, the recess walls, the electrode
 * caps, and the faceted 3D tube.
 *
 * Pure: no DOM, no component state. Every function takes the settings bag `s` and returns strings the DC assigns to CSS
 * custom properties. Colour comes from crt-phosphor, so the tube body, its glow and the walls share ONE colour model —
 * a cosmetic filter on top of a different base is how they used to drift apart.
 *
 * createFixture() carries the memo caches, so two instruments on one page cannot share each other's state.
 */
import { kelvinRgb, mix } from './crt-phosphor.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const rgbStr = (c) => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';

export function createFixture() {
  let igKey = null, igVal = null;
  const thCache = {};

  /* The lit tube: dimmer response, emission fill, halo geometry, wall wash, electrode caps.
   *
   * State keys are legacy and worth naming once: tbloom = GLOW SPREAD (px), bfall = GLOW FALL, veil = TUBE GLOW.
   * Memoised on its six real inputs — dragging any other slider reuses the last result rather than rebuilding every
   * gradient string.
   */
  function ignite(s) {
    const key = s.ldim + '|' + s.tbloom + '|' + s.veil + '|' + s.bfall + '|' + s.ltk + '|' + s.veil + '|' + s.temp + '|' + s.health + '|' + s.box;
    if (igKey === key) return igVal;
    const d = s.ldim, spread = s.tbloom, glowInt = s.veil, glowFall = s.bfall, C = 'var(--lcol,255,255,255)';
    /* ONE CONTINUOUS DIMMER CURVE — no 0.25 / 0.5 kinks. lvl blends two linear regimes with a smoothstep around 0.5 so
     * the slope is continuous; the endpoints and midpoint stay 0 -> 0.7 -> 1.0. The gamma then makes low settings read
     * genuinely dim instead of roughly mid-bright, without moving either endpoint. */
    const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    const wHi = sstep(0.32, 0.68, d);
    const lvlBase = (1.4 * d) * (1 - wHi) + (0.7 + 0.6 * (d - 0.5)) * wHi;
    const lvl = Math.pow(lvlBase, 1.9);

    /* The halo. glowInt (TUBE GLOW) is the master intensity times the dimmer — at 0 there is no glow, so spread and
     * fall are moot. spread (GLOW SPREAD) is its px reach; glowFall (GLOW FALL) is how much of that reach is spent
     * fading. The GRADIENT defines the falloff rather than a blur, so the reach stays exact. */
    const glowRaw = Math.min(1, glowInt * 1.18) * Math.min(1, d * 1.05);
    const glowOp = glowRaw.toFixed(3);
    /* The colour washed onto the recess walls is the SAME tube emission colour (--lcol), and its amount is driven
     * straight off the glow's own opacity — so glow transparency and wall colour are one linked knob.
     *
     * THE CAP IS 18%, NOT 50%, AND THIS IS A CONTRAST BUDGET RATHER THAN A TASTE SETTING. The tube body paints at
     * --themit1, which at full health IS the lamp colour: 255,249,253. It has no headroom left. Everything in the
     * fixture is inside a mix-blend-mode:screen group, so the tube and the surface it is lighting clip toward white
     * TOGETHER — whatever the wall is given, the tube cannot answer with more.
     *
     * At the old 50% cap, TUBE GLOW 55% put --gwall at 0.325, which lifted the #a89e88 recess to roughly (196,188,174)
     * against a tube at (247,241,245): 1.26:1, so the tubes read as pale bands on a pale wall and were identified by
     * their electrode caps rather than by being bright. A fluorescent tube is several stops above its housing.
     *
     * So the surface is held down to leave the source room. Brightness beyond this belongs in the HALO
     * (--tglowspread / --tbloomop1), which blooms outward from the tube and reads as light rather than as paint. */
    const glowRawW = Math.min(1, Math.max(glowInt, s.veil) * 1.18) * Math.min(1, d * 1.05) * 0.18;
    const gwall = glowRawW.toFixed(3);
    const gwallhi = Math.min(1, glowRawW * 1.2).toFixed(3);

    // The walls whiten only from GLOW, never from the dimmer: DIMMER darkens the beige through the master --llvl and
    // adds no white of its own. Scaled by the same contrast budget as gwall above — this one reached 0.649 and was the
    // larger half of the washout, since it lands on the side walls at full strength.
    const walllit = (Math.min(1, Math.max(glowInt, s.veil) * 1.18) * Math.min(1, d * 1.05) * 0.34).toFixed(3);

    // Electrode caps warm up with the glow like the walls, staying an anodized metallic green rather than washing to
    // white. Two shades give a top-to-bottom sheen so it reads as anodized metal instead of a flat fill.
    const capvis = (s.box == null ? 1 : s.box).toFixed(3);
    const cg = Math.min(1, Math.max(glowInt, s.veil) * 1.18) * Math.min(1, d * 1.05);
    const capL = kelvinRgb(s.temp).split(',').map(Number);
    const capEnd = clamp01(((s.health == null ? 1 : s.health) - 0.18) / 0.12);
    const capLit = Math.min(1, cg) * capEnd;
    const capcol = 'rgb(' + mix([30, 80, 50], mix([70, 175, 105], capL, capLit * 0.4), capLit).join(',') + ')';
    const capcol2 = 'rgb(' + mix([18, 52, 32], mix([44, 112, 66], capL.map((v) => v * 0.82), capLit * 0.4), capLit).join(',') + ')';

    igKey = key;
    return (igVal = { llvl: lvl.toFixed(3), tbloomop: glowOp, walllit: walllit, capvis: capvis,
      capcol: capcol, capcol2: capcol2, gwall: gwall, gwallhi: gwallhi });
  }

  /* HEALTH models the tube's life along its LENGTH, which is what makes it read as a failing fluorescent rather than a
   * dimmer: 100% = uniform emission; ~50% = the two end-glows just meet in the middle; ~10% = orange embers at the ends
   * over a dark dead middle; 0% = charred ends, whole tube dark. Drives --themit (the horizontal fill of the tube body)
   * plus a glow gate, so the halo only blooms once the tube is actually healthy.
   *
   * Cached per (health, temp) pair, which is why the caller quantises health before asking.
   */
  function tubeHealth(s, hIn) {
    const key = (hIn == null ? 1 : hIn).toFixed(3) + '|' + s.temp;
    if (thCache[key]) return thCache[key];
    const h = clamp01(hIn == null ? 1 : hIn);
    const lamp = kelvinRgb(s.temp).split(',').map(Number);   // the lit core is exactly the colour you set
    const char = [46, 38, 33];                               // charred solid — visible under screen blend, not vanishing
    const gapDark = [38, 31, 27];                            // dead coating — still a visible dark solid
    const endVital = clamp01((h - 0.18) / 0.12);             // ends go charred -> lit over 18%..30%
    const endCol = mix(char, lamp, endVital);
    // The middle stays dark through the "ends only" stage, reaches only HALF-lit by 90%, then completes at 100% — the
    // last faint bit of the middle is the last thing to come alive.
    const conn = clamp01(h < 0.4 ? 0 : (h < 0.9 ? (h - 0.4) / 0.5 * 0.5 : 0.5 + (h - 0.9) / 0.1 * 0.5));
    const gapCol = mix(char, gapDark, clamp01((h - 0.15) * 1.6));
    const centerCol = mix(gapCol, lamp, conn);
    const frontCol = mix(mix(endCol, gapCol, 0.65), lamp, conn);   // the fading edge of the end-glow
    const reach = Math.max(0.08, Math.min(0.5, (h - 0.2) * 0.9)); // the glow grows inward from ~30%
    // A wide, soft end->centre handoff: the front zone fades over p2..p3 so the lit ends blend gradually into the
    // middle instead of stepping.
    const rp = reach * 100, p1 = (rp * 0.45).toFixed(1), p2 = rp.toFixed(1), p3 = Math.min(50, rp + 18).toFixed(1);
    const midCol = mix(frontCol, centerCol, 0.5);
    const themit = 'linear-gradient(90deg,'
      + rgbStr(endCol) + ' 0%,' + rgbStr(endCol) + ' ' + p1 + '%,'
      + rgbStr(frontCol) + ' ' + p2 + '%,' + rgbStr(midCol) + ' ' + ((+p2 + +p3) / 2).toFixed(1) + '%,' + rgbStr(centerCol) + ' ' + p3 + '%,'
      + rgbStr(centerCol) + ' 50%,'
      + rgbStr(centerCol) + ' ' + (100 - +p3).toFixed(1) + '%,' + rgbStr(midCol) + ' ' + (100 - (+p2 + +p3) / 2).toFixed(1) + '%,' + rgbStr(frontCol) + ' ' + (100 - +p2).toFixed(1) + '%,'
      + rgbStr(endCol) + ' ' + (100 - +p1).toFixed(1) + '%,' + rgbStr(endCol) + ' 100%)';
    const hGlow = clamp01((h - 0.2) / 0.55);                      // the broad ambient glow fades in as the tube heals
    const tchar = (clamp01((0.25 - h) / 0.25) * 0.92).toFixed(3); // charred/smoky darkening below ~25%
    return (thCache[key] = { themit, hGlow: hGlow.toFixed(3), eg: endVital.toFixed(3), tchar });
  }

  /* The fixture opening, projected. Under rotateX the rectangle becomes a trapezoid, and both the viewport clip and the
   * diffuse-blur wrapper have to follow that exact shape -- a rectangular clip on a tilted opening either slices the
   * corners off or lets blur bleed past the edge. Returns a CSS polygon() in percentages of the element.
   *
   * perspCm is the fixture's perspective in --cm units; it is converted against the viewport the same way --cm is.
   */
  function portalPolygon(w, h, perspCm, tiltDeg, viewportW) {
    // A hidden fixture measures 0x0, and the projection below divides by w and h -- which yields NaN%, an invalid
    // clip-path the browser silently drops. Returning 'none' says the same thing honestly.
    if (!(w > 0 && h > 0)) return 'none';
    const p = perspCm * 0.0045 * viewportW;
    const t = tiltDeg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
    const mx = w / 2, my = h / 2;
    const pt = (sx, sy) => {
      const y = sy * my, z = y * sn, sc = p / (p - z);
      return [50 + (sx * mx * sc) / w * 100, 50 + (y * cs * sc) / h * 100];
    };
    const c = [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)];
    return 'polygon(' + c.map((q) => q[0].toFixed(2) + '% ' + q[1].toFixed(2) + '%').join(',') + ')';
  }

  /* THE SPILL OUTLINE, ON THE FIXTURE'S OWN PLANE.
   *
   * The spill used to be built on the PICTURE plane and foreshortened by multiplying its vertical radius by
   * cos(ftilt). That is an orthographic squash, and the fixture is not orthographic -- it is `perspective(--persp)
   * rotateX(--ftilt)`, which is why its opening needs portalPolygon's trapezoid rather than a rectangle. At the tilts
   * this instrument actually runs at (-72 degrees is a normal ceiling fixture) the two disagree completely: cos() gives
   * a symmetric squashed oval while perspective gives a trapezoid whose far edge is narrower and closer. The pool read
   * as a flat sticker lying across the tube instead of light on the surface the lamp is mounted to.
   *
   * So it is built in the fixture's LOCAL plane and pushed through the SAME projection the opening uses. sx/sy are in
   * units of the fixture's half-extent -- 1.0 is exactly the opening's edge -- and oy slides the pool along the plane
   * (0 = concentric with the lamp). n is the superellipse exponent: the lamp is a rectangle and the pool it throws is a
   * rectangle with soft corners.
   *
   * Returns points as centred px offsets from the fixture's centre, ready to be added to its position and plotted
   * through radialMap. Deliberately NOT a path string: the caller owns the curve, this owns the plane.
   */
  function portalSpread(w, h, perspCm, tiltDeg, viewportW, sx, sy, oy, n, samples) {
    if (!(w > 0 && h > 0)) return [];
    const p = perspCm * 0.0045 * viewportW;
    const t = tiltDeg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
    const mx = w / 2, my = h / 2;
    const S = Math.max(8, samples || 96);
    const e = 2 / (n == null ? 4 : n);
    const sup = (v) => (v < 0 ? -1 : 1) * Math.pow(Math.abs(v), e);
    const out = [];
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2;
      const y = (sup(Math.sin(a)) * sy + oy) * my;
      const z = y * sn;
      /* CLAMPED, because a wide pool on a steep plane can reach the projection centre. sc = p/(p-z) goes to infinity as
       * z approaches p and NEGATIVE past it -- points behind the eye, which fold the outline inside out and emit
       * coordinates in the millions. The clamp keeps a pathological spread ugly rather than catastrophic. */
      const sc = Math.max(0.05, Math.min(8, p / (p - z)));
      out.push([sup(Math.cos(a)) * sx * mx * sc, y * cs * sc]);
    }
    return out;
  }

  /* THE FOUR CORNERS OF THE OPENING, projected, as centred px offsets from the fixture's centre.
   *
   * portalPolygon returns the same corners already formatted as a CSS percentage polygon, which is right for a clip-path
   * and useless to anything that needs to do arithmetic on them. This is the same projection with the formatting left
   * off. Exactly four points and no sampling: a rectangle's corners are corners, and any curve-fitting primitive that
   * walks it in uniform angular steps -- a superellipse included, at any exponent -- rounds them off.
   */
  function portalCorners(w, h, perspCm, tiltDeg, viewportW) {
    if (!(w > 0 && h > 0)) return [];
    const p = perspCm * 0.0045 * viewportW;
    const t = tiltDeg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
    const mx = w / 2, my = h / 2;
    const pt = (sx, sy) => {
      const y = sy * my, z = y * sn;
      const sc = Math.max(0.05, Math.min(8, p / (p - z)));
      return [sx * mx * sc, y * cs * sc];
    };
    return [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)];
  }

  return { ignite, tubeHealth, portalPolygon, portalSpread, portalCorners };
}
