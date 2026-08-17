/* Every uniform reactor-shader reads, from one state, one pose and the clock. Pure: no GL calls of its own — the
 * renderer's setters are the caller's.
 *
 * Shared because two pages draw this scene now, the lab and the home page's hero core. A value uploaded by one
 * and forgotten by the other is the same scene disagreeing with itself, which is the failure this repo is
 * organised against.
 */
export function sendUniforms(R, s, p, sec) {
  R.f2('uRes', R.w, R.h);
  R.f('uTime', sec);
  R.f('uSize', s.size); R.f('uVisc', p.visc); R.f('uTurb', p.turb); R.f('uRate', s.rate);
  R.f('uGlow', s.glow); R.f('uZoom', s.zoom);
  R.f('uAmp', s.amp); R.f('uOct', s.octaves); R.f('uShape', s.shape);
  R.f('uCamAngle', s.camAngle); R.f('uCamEl', s.camEl);
  R.f('uCoreAngle', s.coreAngle); R.f('uCoreAngleX', s.coreAngleX);
  R.f('uPulseBright', s.pulseBright); R.f('uPulseSize', s.pulseSize);
  R.f('uVentSize', s.ventSize); R.f('uVentBright', s.ventBright);
  R.f('uRingLight', s.ringLight); R.f('uRingOn', s.ringOn ? 1 : 0);
  R.f('uRingRough', s.ringRough); R.f('uRingWear', s.ringWear);
  R.f('uSubVT', s.subVT != null ? s.subVT : 1);
  // Defaulted: a state saved before this control existed has no subSurf, and undefined uploads NaN — which
  // makes every droplet's SDF miss, so no sub-core renders at all.
  R.f('uSubSurf', s.subSurf != null ? s.subSurf : 1);
  R.f('uSwellAmt', s.ventSwellPct != null ? s.ventSwellPct : 0.9);

  R.f('uPulse', p.pulse); R.f('uVent', p.vent); R.f('uVentBurst', p.ventBurst); R.f('uVentSwell', p.ventSwell);
  R.f('uWobbleX', p.wobbleX); R.f('uWobbleZ', p.wobbleZ);
  R.f('uRingR', p.ringR); R.f('uSwellRingBase', p.swellRingBase); R.f('uSwellTarget', p.swellTarget);
  R.f('uRingGlow', p.ringGlow); R.f('uShieldExpand', p.shieldExpand); R.f('uScatter', p.scatter);
  R.f('uBreakBurst', p.breakBurst);
  R.f('uPhSpin', p.phSpin); R.f('uPhOrbitX', p.phOrbitX); R.f('uPhOrbitZ', p.phOrbitZ);
  R.f('uPhWobX', p.phWobX); R.f('uPhWobZ', p.phWobZ); R.f('uPhCam', p.phCam);
  R.f('uPhCoreY', p.phCoreY); R.f('uPhCoreX', p.phCoreX); R.f('uPhRate', p.phRate);
  R.f('uRingAngleY', s.ringAngleY); R.f('uRingAngleX', s.ringAngleX);
  R.f('uRingAngleZ', s.ringAngleZ);

  const c = s.coreHex || '#28ff1a';
  R.f3('uCoreCol', parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255,
                   parseInt(c.slice(5, 7), 16) / 255);

  // dropN is 0 at rest, so the shader's droplet loop breaks immediately and eighty floats are never uploaded.
  R.f('uDropN', p.dropN);
  if (p.dropN) R.fv4('uDropData', p.dropData);
}
