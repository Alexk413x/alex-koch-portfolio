/* render-probe.js — a deterministic render fingerprint for CRT Lab.
 *
 * NOTHING IN THE LAB LOADS THIS, and nothing should -- it is an instrument that attaches on demand, so it costs
 * nothing when it is not in use.
 *
 *     <script src="/labs/crt/render-probe.js"></script>   // or paste this file into the console
 *
 *     CRTPROBE.hash()      render seven fixed scenes and print an FNV-1a fingerprint of each
 *     CRTPROBE.check(ref)  compare against a previous run and say what moved
 *
 * WHAT IT IS FOR: proving a refactor changed nothing. It was written to verify the de-duplication of the
 * fixture shader, where ~850 lines moved between files and the only acceptable outcome was a byte-identical
 * picture. A visual check cannot answer that; a hash can.
 *
 * IT MUST NOT DISTURB THE PAGE IT MEASURES. An earlier version left the page holding its own `base` scene on
 * exit, and the lab's debounced save then wrote that over the operator's stored configuration -- 34 settings,
 * most recoverable, some not. The caller's state is now snapshotted on entry and restored key-for-key on exit,
 * including via the failure path.
 *
 * TWO THINGS LEAK REAL TIME INTO A FRAME, and both are pinned here. Getting this wrong cost three false
 * results before the harness was trusted, so they are worth naming:
 *   powerOn() stamps performance.now() into powerT0, so the power pose depends on WHEN it was called. Pinning
 *     the clock only around drawContent is not enough -- the settle itself has to run on the pinned clock, or
 *     wall time enters every scene that follows. This was measured: six of seven scenes moved between two runs
 *     of an identical harness until the pin was widened to cover powerOn().
 *   drawContent() reads performance.now() for the caret's blink, so the CONTENT TEXTURE itself varies.
 *   triggerWarp draws a fresh random seed on every press, so a warp can never be fingerprinted at all. There
 *     is no warp scene, and there cannot be one without exposing the seed.
 *
 * ONE TIMESTAMP PER SCENE, NOT A MARCHING ONE. Rendering repeatedly at a fixed timestamp is a measured fixed
 * point -- 1, 4, 8, 16 and 32 frames at the same time all produce the identical hash -- whereas advancing the
 * clock keeps moving the picture, because a time-driven term survives with flicker parked. Two renders are
 * taken rather than one so any single-frame feedback texture has settled.
 *
 * IT PINS THE WHOLE STATE, NOT THE PART IT VARIES, and that took a false alarm to learn. `base` below names
 * about eighty keys; the lab has around a hundred and fifty. Every key it did NOT name was inherited from
 * whatever the browser had in storage, so a reference was only ever comparable against a run on the SAME
 * stored configuration. Measured: seven scenes reproduced across four consecutive verifications, then all six
 * picture-bearing ones moved -- by 86 parts in 205 million -- with no change to the renderer at all. The cause
 * was a state write between the runs, and the flicker edit under test was wrongly implicated until an A/B with
 * the change reverted came out byte-identical to the run with it in.
 *
 * So the run now starts from crt-presets' defaultPreset() and lays `base` over it. A reference is then a
 * property of the CODE and the window size, which is the only thing it was ever meant to measure.
 *
 * THE TEST OF THE TEST: run hash() twice on an unchanged build. If the two disagree, something else is leaking
 * and no comparison made with it means anything.
 */
(function () {

async function loadDefaults() {
  try {
    const m = await import('/labs/crt/crt-presets.js');
    return m.defaultPreset({ integrated: false });
  } catch (e) { return null; }
}

function fingerprint(defaults) {
  const G = window.CRTGL, gl = G.R.gl;
  const realNow = performance.now.bind(performance);

  // THE CALLER'S STATE, HELD ASIDE. Structured so nested values (phCustom) are copied rather than aliased.
  const caller = JSON.parse(JSON.stringify(G.state));

  /* RENDER SCALE IS PINNED AND THE BUFFER IS PRINTED, and both are here because of a false alarm.
   *
   * A comparison run on a browser whose stored RENDER SCALE was 0.67 against a reference taken at 0.62 reported
   * every one of the seven scenes as MOVED, with the sums up a uniform 17%. Nothing had changed but the number
   * of pixels. A fingerprint is only comparable against another taken at the same resolution, so the scale is
   * forced here rather than inherited, and the size is printed in the output -- a reference from a different
   * window can then be recognized at a glance instead of read as a regression. */
  const wasScale = G.state.renderScale;
  if (wasScale !== 0.62) { G.state.renderScale = 0.62; G.resize(); }
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(W * H * 4);

  const base = {
    lflickA: 0, lflickB: 0, flickHz: 0, fstr: 0, ripple: 0, persist: 0,
    sweepOn: 0, hsweepSec: 0, lightOn: 1, power: 1, debugOn: 0, fixSolo: 0,
    healthA: 0.55, healthB: 1, glowA: 0.35, glowB: 0.35, sheen: 0.35, scatterCM: 22,
    boxVis: 1, railVis: 1, frame: 0.88, frameW: 13, glare: 0.78, matte: 0,
    frost: 0.25, diffuse: 0, prism: 0, prismN: 18, fixTilt: 0.42, fixXmm: 0, fixYmm: 0,
    distMM: 1800, fixWmm: 1200, fixHmm: 600, recessMM: 90, tubeDiaMM: 26,
    tubeInsetMM: 60, tubeGapMM: 180, capMM: 25, railMM: 19, tubeDead: 0.18,
    bright: 0.62, phos: 0.13, glow: 3, bloom: 0.42, vig: 0.19, face: 0.90,
    overscan: 1.02, corner: 27, bend: 6, famp: 1, fexp: 2.3, grings: 20,
    scan: 25, grille: 25, scanw: 1, grillew: 1, scanop: 50, grilleop: 40,
    lightA: 1, lightB: 1, tempA: 5000, tempB: 4400, spot: 0.85, convOn: 1,
    tw: 70, tht: 64, tcell: 5, tgap: 2, tcols: 0, type: 1, tox: 0, toy: 0,
    tjust: 0, tvert: 0, frameOn: 1, beamOn: 1, frameBleed: 0.6,
    frameScreen: 0.45, frameFixture: 0.35, collapse: 0.9, ignite: 0.7,
  };
  /* THE DEFAULTS UNDERNEATH, so the ~70 keys `base` never mentions are the shipped values rather than whatever
   * the browser happened to have stored. secClosed and renderScale are excluded: the first only folds the panel
   * and the second is pinned separately just below. */
  if (defaults) {
    for (const k in defaults) {
      if (k === 'secClosed' || k === 'renderScale' || k in base) continue;
      if (defaults[k] !== null && typeof defaults[k] === 'object') continue;   // nested blobs stay the page's
      base[k] = defaults[k];
    }
  }
  const scenes = [
    ['plain',      {}],
    ['dying',      { healthA: 0.30, healthB: 0.75 }],
    ['boxHalf',    { boxVis: 0.5, railVis: 0.4 }],
    ['roomOff',    { lightOn: 0 }],
    ['deepFace',   { face: -0.7, bend: 40, corner: 60 }],
    ['fineRaster', { scan: 12, grille: 12, scanop: 80 }],
    ['tubesOnly',  { debugOn: 1, fixSolo: 1, healthA: 0.35 }],
  ];

  const T = 500000;
  let out = [];

  function runScenes() {
    const acc = [];
    G.resize();
    G.powerOn();
    G.renderNow(T + base.ignite * 1000 + 2000);   // retires the phase to 'on'; poseFor is constant thereafter
    for (const [name, over] of scenes) {
      Object.assign(G.state, base, over);
      G.triggerWarp(-1e9); G.triggerSurge(-1e9);
      G.typed = G.full; G.drawContent(true);
      G.renderNow(T); G.renderNow(T);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let h = 2166136261 >>> 0, sum = 0;
      for (let i = 0; i < px.length; i += 4) {
        h ^= px[i];     h = Math.imul(h, 16777619) >>> 0;
        h ^= px[i + 1]; h = Math.imul(h, 16777619) >>> 0;
        h ^= px[i + 2]; h = Math.imul(h, 16777619) >>> 0;
        sum += px[i] + px[i + 1] + px[i + 2];
      }
      acc.push(name.padEnd(11) + h.toString(16).padStart(8, '0') + '  sum=' + sum);
    }
    return acc;
  }

  performance.now = () => T;
  try {
    Object.assign(G.state, base);
    /* THE FIRST PASS IS RUN AND THROWN AWAY, because the first fingerprint after a page load disagreed with
     * every one taken after it -- and only in the scenes that draw the PICTURE. `tubesOnly` sets fixSolo, which
     * hides it, and that scene alone was byte-identical across the boundary; the other six all moved, by about
     * 0.006% of the sum. So it is the content raster settling, not the fixture and not the geometry. A single
     * drawContent() ahead of the loop was measured NOT to be enough; a whole discarded pass is.
     *
     * A reference is usually taken exactly once, so a probe that is only trustworthy from its second call is a
     * trap. The cost is one extra pass, about a second. */
    runScenes();
    out = runScenes();
  } finally {
    performance.now = realNow;
    // Key-for-key, so a key the probe added but the caller never had does not survive as a stowaway.
    for (const k of Object.keys(G.state)) if (!(k in caller)) delete G.state[k];
    Object.assign(G.state, caller);
    if (G.state.renderScale !== wasScale) { G.state.renderScale = wasScale; }
    G.resize();
    G.powerOn();
  }
  // The buffer leads, so two runs taken at different sizes are never mistaken for a regression.
  return ['buffer ' + W + 'x' + H].concat(out).join('\n');
}

  let defaults = null;
  const ready = loadDefaults().then((d) => { defaults = d; return d ? 'defaults pinned' : 'DEFAULTS UNAVAILABLE'; });

  window.CRTPROBE = {
    ready,
    hash: () => fingerprint(defaults),
    /* Compare against a previous run and say WHICH scene moved. A refactor that is meant to change nothing
     * should print IDENTICAL; anything else names the scene to go and look at. */
    check(ref) {
      const NL = String.fromCharCode(10);
      const now = fingerprint(defaults);
      if (now === ref) return 'IDENTICAL' + NL + now;
      const a = ref.split(NL), b = now.split(NL);
      return 'DIFFERS' + NL +
        b.map((l, i) => (l === a[i] ? '  ok    ' : '  MOVED ') + l).join(NL);
    },
    /* THE TEST OF THE TEST, as one call. Anything but true means the harness is leaking and no comparison
     * made with it means anything. */
    selfTest() {
      const a = fingerprint(defaults), b = fingerprint(defaults);
      return (a === b ? 'DETERMINISTIC' : 'LEAKING — do not trust any comparison') +
        String.fromCharCode(10) + a;
    },
  };
})();
