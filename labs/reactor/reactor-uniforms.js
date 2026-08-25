/* Every uniform reactor-shader reads, from one state, one pose and the clock. Pure: no GL calls of its own — the
 * renderer's setters are the caller's.
 *
 * Shared because two pages draw this scene now, the lab and the home page's hero core. A value uploaded by one
 * and forgotten by the other is the same scene disagreeing with itself, which is the failure this repo is
 * organised against.
 */
/* Row-major 3x3 product. Only used to compose the ring transform, so it stays local rather than becoming a
   maths module nothing else imports. */
function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

// Reused, so a frame costs no allocation. uniformMatrix3fv reads column-major.
const RING_M = new Float32Array(9);
const CORE_M = new Float32Array(9);

const rotYr = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rotXr = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; };
const rotZr = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; };

// Row-major in, column-major out, which is what uniformMatrix3fv expects with transpose = false.
function toColumnMajor(m, out) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 3 + r] = m[r * 3 + c];
  return out;
}

/* Composes world -> ring space: spin about the ring's own axis, then the two world tumbles.
 * The shader used to build this per call, and ringSDF and shieldSDF each call it inside the march loop — so a
 * 70-step ray composed the same matrix 140 times. The angles are all uniforms, so it is the same matrix for
 * every pixel in the frame.
 * The multiply order matches the old shader exactly: ringSpace applied Z first, then X, then Y.
 */
function ringMatrix(s, p) {
  const az = s.ringAngleZ + p.phOrbitZ + p.wobbleZ * Math.sin(p.phWobZ);
  const ax = s.ringAngleX + p.phOrbitX + p.wobbleX * Math.sin(p.phWobX);
  const ay = s.ringAngleY + p.phSpin;
  // ringSpace applied Z first, then X, then Y, so the product reads right to left in that order.
  return toColumnMajor(mul3(mul3(rotYr(ay), rotXr(ax)), rotZr(az)), RING_M);
}

/* Composes world -> core space. coreSDF applied Y then X, so the product is RX * RY.
 * coreSDF runs once per march step and four more times in the normal estimator, so a 70-step ray built this
 * 74 times from two uniform angles. */
function coreMatrix(s, p) {
  return toColumnMajor(mul3(rotXr(s.coreAngleX + p.phCoreX), rotYr(s.coreAngle + p.phCoreY)), CORE_M);
}

export function sendUniforms(R, s, p, sec) {
  R.f2('uRes', R.w, R.h);
  R.f('uTime', sec);
  R.f('uSize', s.size); R.f('uVisc', p.visc); R.f('uTurb', p.turb); R.f('uRate', s.rate);
  R.f('uGlow', s.glow); R.f('uZoom', s.zoom);
  R.f('uAmp', s.amp); R.f('uOct', s.octaves); R.f('uShape', s.shape);
  R.f('uCamAngle', s.camAngle); R.f('uCamEl', s.camEl);
  R.f('uPulseBright', s.pulseBright); R.f('uPulseSize', s.pulseSize);
  R.f('uPhCam', p.phCam); R.f('uPhRate', p.phRate);
  R.f('uVentSize', s.ventSize); R.f('uVentBright', s.ventBright);
  R.f('uRingLight', s.ringLight); R.f('uRingOn', s.ringOn ? 1 : 0);
  R.f('uRingRough', s.ringRough); R.f('uRingWear', s.ringWear);
  // Defaulted: a state saved before this control existed has no subSurf, and undefined uploads NaN — which
  // makes every droplet's SDF miss, so no sub-core renders at all.
  R.f('uSubSurf', s.subSurf != null ? s.subSurf : 1);
  R.f('uSwellAmt', s.ventSwellPct != null ? s.ventSwellPct : 0.9);

  R.f('uPulse', p.pulse); R.f('uVent', p.vent); R.f('uVentBurst', p.ventBurst); R.f('uVentSwell', p.ventSwell);
  R.f('uRingR', p.ringR); R.f('uSwellRingBase', p.swellRingBase); R.f('uSwellTarget', p.swellTarget);
  R.f('uRingGlow', p.ringGlow); R.f('uShieldExpand', p.shieldExpand); R.f('uScatter', p.scatter);
  R.f('uBreakBurst', p.breakBurst);

  // The composed form of the six angles above. They are still uploaded because the ring's shading reads them.
  /* The angles themselves are no longer uploaded. The shader read them only to rebuild these two matrices per
     pixel, so composing them here left fourteen float uniforms with no reader. */
  R.m3('uRingM', ringMatrix(s, p));
  R.m3('uCoreM', coreMatrix(s, p));

  R.f3hex('uCoreCol', s.coreHex || '#28ff1a');

  // dropN is 0 at rest, so the shader's droplet loop breaks immediately and eighty floats are never uploaded.
  R.f('uDropN', p.dropN);
  if (p.dropN) R.fv4('uDropData', p.dropData);
}
