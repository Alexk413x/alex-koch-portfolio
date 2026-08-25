# The hero core: that it built, that it draws, that it is the right color, and that the pointer reaches it.
#
# Every check here is a failure this page can have SILENTLY. A shader that will not compile, a canvas that eats
# the call to action, a spin that fights the cursor, a color the tone map turned to butter -- none of them
# throw, and all of them ship a hero that is simply wrong.
#
# ONE KNOWN FLAKE, and it is the reason for the retry below. Under --headless=new this page's shader renders
# background-only on roughly two loads in three, PER DOCUMENT: on a bad load the drawing buffer, the viewport and
# all 23 core-path uniforms read back byte-identical to a good one, the Reactor lab never flakes in the same
# browser process, and a headful Chrome has never reproduced it. So the pixel checks reload until they get a
# frame to measure and assert on that; if no load renders, they SKIP with the reason rather than pass quietly.
# A wrong color or a vanished core still fails, which is what those checks are for.
import time

NAME = 'hero'

# Reads the buffer back in the SAME task as the draw. The context is preserveDrawingBuffer:false, so a readPixels
# from a later call returns a cleared buffer -- which looks exactly like a shader that outputs black.
FRAME = """(()=>{
  const R=HERO.R, gl=R.gl, w=R.w, h=R.h;
  HERO.renderNow(1/60);
  const px=new Uint8Array(w*h*4);
  gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
  let peak=0;
  for(let i=0;i<px.length;i+=4){ const v=Math.max(px[i],px[i+1],px[i+2]); if(v>peak) peak=v; }
  const thr=Math.max(40, peak*0.62);
  let lit=0, n=0, sr=0, sg=0, sb=0;
  for(let i=0;i<px.length;i+=4){
    const v=Math.max(px[i],px[i+1],px[i+2]);
    if(v>18) lit++;
    if(v>=thr){ sr+=px[i]; sg+=px[i+1]; sb+=px[i+2]; n++; }
  }
  return JSON.stringify({peak, lit:lit/(w*h), r:sr/Math.max(n,1), g:sg/Math.max(n,1), b:sb/Math.max(n,1)});
})()"""

# The face follows the pointer's POSITION. Stepped by hand through renderNow so the result does not depend on
# whether this window is getting animation frames -- Windows Chrome delivers none to one that is not front-most.
# Angles are read as an OFFSET from the resting pose, because the preset carries a base tilt on X.
FOLLOW = """(()=>{
  const b=document.getElementById('hero-core').getBoundingClientRect();
  const cx=b.left+b.width/2, cy=b.top+b.height/2;
  const off=Math.min(innerWidth,innerHeight)*0.35;
  // 90 frames: the face chases its angle exponentially, so a short settle leaves a residual that the "still
  // pointer" check below would then read as drift.
  const put=(x,y)=>{ dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y}));
                     for(let i=0;i<90;i++) HERO.renderNow(1/60);
                     return {y:HERO.state.coreAngle, x:HERO.state.coreAngleX}; };
  const mid=put(cx,cy), right=put(cx+off,cy), left=put(cx-off,cy), up=put(cx,cy-off);
  for(let i=0;i<60;i++) HERO.renderNow(1/60);          // hand still, pointer unmoved
  const drift=Math.abs(HERO.state.coreAngle-up.y);
  return JSON.stringify({right:right.y-mid.y, left:left.y-mid.y, up:up.x-mid.x, drift});
})()"""


# A sub-core has PINCHED OFF when the gap between its inner edge and the core's surface clears the shader's goo
# blend, which is 0.16 of the core radius; under that it still reads as a stretching bridge. Averaged over whole
# fires, and inside ONE evaluate because the page's loop advances the spring between two of them.
SPLIT = """(()=>{
  const s=HERO.state;
  /* Steps until the spring stops rising rather than counting frames, because DURATION moves where the peak
   * falls: at 1.2s it lands around frame 13 and at 2.0s nearer frame 22. A fixed count silently samples the
   * ramp instead of the peak and reads every sub-core as still buried. dt 0 is a safe read of the pose. */
  const toPeak=()=>{ let prev=-1, p=HERO.sim.step(s,0,0);
    for(let i=0;i<120;i++){ HERO.renderNow(1/60); p=HERO.sim.step(s,0,0);
      if(p.pulse < prev) break; prev=p.pulse; }
    return p; };
  let free=0, bridged=0, out=0, big=0, n=0, moved=0, reach=0;
  for(let f=0;f<8;f++){
    HERO.near=0;
    for(let i=0;i<60;i++) HERO.renderNow(0.05);          // let the last one, and any throw, decay out
    const calm=HERO.sim.step(s,0,0).visc;      // the sim's OUTPUT: s.visc is never written back
    HERO.sim.firePulse(s);
    const p=toPeak();                                    // NOT a fixed frame count: DURATION moves the peak
    moved=Math.max(moved, p.visc-calm);
    const R=s.size + p.pulse*s.pulseSize;
    for(let i=0;i<p.dropN;i++){
      const d=p.dropData, c=Math.hypot(d[i*4],d[i*4+1],d[i*4+2]);
      const gap=(c - d[i*4+3] - R)/R;
      if(gap > 0.16) free++; else bridged++;
      if(gap > 0) out++;                                 // clear of the surface at all, neck or no neck
      reach=Math.max(reach, (c + d[i*4+3])/R);           // furthest extent, in core radii
      big=Math.max(big, d[i*4+3]/R); n++;
    }
  }
  return JSON.stringify({free:free/n, stretch:bridged/n, emerged:out/n, reach, biggest:big, n, viscMoved:moved});
})()"""


# WHICH WAY AN ANGLE ACTUALLY TURNS THE PICTURE, measured on the rendered frame rather than reasoned about from
# the rotation matrix. Getting this wrong shipped a core that span AGAINST the cursor, and a test asserting the
# sign of a state value could not have caught it — it would only ever enforce the same wrong belief.
#
# ONE sub-core is fired out as a landmark and swept through a WHOLE TURN. The screen motion is averaged weighted
# by the lit area, which stands in for how near the landmark is: a landmark on the far side travels the opposite
# way, so any single pair of frames is a coin toss on which side it happened to be. That is exactly how the
# original reading went wrong.
#
# Y only. The same estimator on X is dominated by the landmark's luck of the draw on the Fibonacci sphere and
# comes back mixed run to run; asserting a number that noisy would fail honest builds, so the X sign rests on
# the matrix, which agrees with this measurement on the axis that can be measured.
DIRECTION = """(()=>{
  const s=HERO.state, R=HERO.R, gl=R.gl, w=R.w, h=R.h;
  const keep={dropN:s.dropN, dropSize:s.dropSize, amp:s.pulseAmp, glow:s.glow, ca:s.coreAngle};
  const look=()=>{ const px=new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
    let sx=0,n=0;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const i=(y*w+x)*4;
      if(Math.max(px[i],px[i+1],px[i+2])>90){ sx+=x; n++; } }
    return {x:n?sx/n:0, area:n}; };
  const once=()=>{
    Object.assign(s,{dropN:1, dropSize:1.4, pulseAmp:18, glow:1.6});
    HERO.pose(0, 0);
    HERO.near=0;
    for(let i=0;i<60;i++) HERO.renderNow(0.05);
    HERO.sim.firePulse(s);
    let prev=-1;                                         // to the spring's peak, however long DURATION makes it
    for(let i=0;i<120;i++){ HERO.renderNow(1/60);
      const q=HERO.sim.step(s,0,0); if(q.pulse<prev) break; prev=q.pulse; }
    const N=32, sw=[];
    // pose(), not s.coreAngle: draw() writes that every frame from the pointer's angle and would overwrite it.
    for(let k=0;k<N;k++){ HERO.pose(k*Math.PI*2/N, 0); HERO.renderNow(0); sw.push(look()); }
    const mean=sw.reduce((a,v)=>a+v.area,0)/N;
    let acc=0; for(let k=0;k<N;k++) acc += (sw[k].area-mean)*(sw[(k+1)%N].x - sw[(k+N-1)%N].x);
    return acc/(N*mean); };
  const runs=[once(), once(), once()];
  Object.assign(s, keep);
  return JSON.stringify({ runs, positive: runs.filter(v=>v>0).length });
})()"""


def _hue(r, g, b):
    """Hue in degrees. The whole color argument on this element is about hue, not brightness."""
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    if d == 0:
        return 0.0
    if mx == r:
        return (60 * (((g - b) / d) % 6)) % 360
    if mx == g:
        return 60 * ((b - r) / d + 2)
    return 60 * ((r - g) / d + 4)


def _drawn_frame(page, tries=4):
    """A frame with the core actually in it, or None. See the flake note at the top of this file."""
    for i in range(tries):
        f = page.json(FRAME)
        if f['peak'] > 60:
            return f
        page.goto('index.html')
        page.scroll(0)
    return None


def run(page, r):
    page.goto('index.html')
    page.scroll(0)

    built = page.json("JSON.stringify({has:!!window.HERO, lost:!!(window.HERO&&HERO.R.lost),"
                      "w:window.HERO?HERO.R.w:0})")
    r.ok('the shader compiled and the renderer built', built['has'] and not built['lost'], str(built))
    if not built['has']:
        return                                   # every check below reads through the handle
    r.ok('the buffer has a real size', built['w'] > 64, '%dpx' % built['w'])

    accent = page.js("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
    f = _drawn_frame(page)
    if f is None:
        r.skip('the core draws a lit frame', 'headless rendered background only on every load')
        r.skip('the lit surface renders at the accent hue', 'no frame to measure')
    else:
        r.ok('the core covers a sensible part of its canvas', 0.02 < f['lit'] < 0.75, 'lit %.3f' % f['lit'])
        want = _hue(int(accent[1:3], 16), int(accent[3:5], 16), int(accent[5:7], 16))
        got = _hue(f['r'], f['g'], f['b'])
        # The shader tone maps per channel, which walks a warm hue toward yellow as it brightens -- so the core is
        # fed a PRE-INVERTED color and the lit surface lands on the accent. Measured on the pixels, because the
        # only way to know that worked is to read what came out. Butter-yellow measured 38 degrees here against
        # the accent's 23.5, so the tolerance separates the two failure it exists to catch.
        r.ok('the lit surface renders at the accent hue', abs(got - want) <= 9,
             'rendered %.1f deg, accent %.1f deg, rgb %d/%d/%d' % (got, want, f['r'], f['g'], f['b']))

    # The canvas sits behind the type and must never be what a click lands on.
    hit = page.json("(()=>{const b=document.getElementById('hero-core').getBoundingClientRect();"
                    "const el=document.elementFromPoint(b.left+b.width/2, b.top+b.height/2);"
                    "return JSON.stringify({id:el?el.id:'', tag:el?el.tagName:''})})()")
    r.ok('the core does not eat pointer events', hit['id'] != 'hero-core', str(hit))

    # A click anywhere on the stage pulses it. dt=0 reads the pose without stepping anything.
    page.click_at('#stage')
    pulsed = page.json("(()=>{HERO.renderNow(1/60);"
                       "return JSON.stringify({p:HERO.sim.step(HERO.state,0,0).pulse})})()")
    r.ok('a click on the stage fires a pulse', pulsed['p'] > 0.02, 'pulse %.3f' % pulsed['p'])

    # And it changes nothing else: a click answers with what a hover at that point would say, so viscosity is not
    # left pinned at MELTDOWN once the spring has decayed.
    HOVER = ("(()=>{const b=document.getElementById('hero-core').getBoundingClientRect();"
             "return JSON.stringify({x:Math.round(b.left+b.width/2+420), y:Math.round(b.top+b.height/2+260)})})()")
    at = page.json(HOVER)
    page.cdp.call('Input.dispatchMouseEvent', {'type': 'mouseMoved', 'x': at['x'], 'y': at['y']})
    page.js('(()=>{for(let i=0;i<90;i++) HERO.renderNow(1/60);})()')
    hovered = page.js('+HERO.near.toFixed(3)')
    for kind in ('mousePressed', 'mouseReleased'):
        page.cdp.call('Input.dispatchMouseEvent',
                      {'type': kind, 'x': at['x'], 'y': at['y'], 'button': 'left', 'clickCount': 1})
    page.js('(()=>{for(let i=0;i<120;i++) HERO.renderNow(1/60);})()')   # past the end of the spring
    clicked = page.js('+HERO.near.toFixed(3)')
    r.near('a click leaves the surface where hovering left it', clicked, hovered, 0.02)

    # These bounds describe the INSTRUMENT: FORCE is the only pulse value this scene sets itself, so if they need
    # moving, the lab moved and this scene has to be looked at again.
    # Whole fires are measured inside one evaluate, because the page's own loop advances the spring between two.
    split = page.json(SPLIT)
    r.ok('a pulse strains sub-cores out of the surface', split['reach'] > 1.25,
         'furthest reaches %.2f core radii' % split['reach'])
    # Analytic -- droplet centers against the core radius, two ideal spheres. It pins the droplet TABLE against
    # the settings and says nothing about the picture, where the displacement field and the blend decide.
    r.ok('the droplet table keeps them within the blend', split['free'] < 0.1,
         '%.0f%% of %d clear the blend' % (split['free'] * 100, split['n']))
    # Half the core radius. They are meant to READ as part of it, and above this they are a second object.
    r.ok('sub-cores stay well under the core', split['biggest'] < 0.5,
         'largest is %.2f of the core radius' % split['biggest'])
    # SUB VIS/TRB is 0 here: the surface's roil is the pointer's distance and nothing else, so a click near the
    # core cannot stack turbulence on top of it. Read off the sim's OUTPUT -- s.visc is never written back, so
    # reading the state compares a number with itself and reports 0 whatever the setting is.
    r.ok('a pulse does not roughen the surface', abs(split['viscMoved']) < 0.01,
         'viscosity moved %.3f' % split['viscMoved'])

    # Which way an angle turns the picture, and then which way a throw sets that angle. Two facts, checked apart:
    # the first is a property of the shader, the second is this file's mapping onto it. Together they are "the
    # core follows the hand", and neither on its own can prove it.
    d = page.json(DIRECTION)
    r.ok('a positive Y angle carries the near face right', d['positive'] == 3,
         '%d of 3 runs positive: %s' % (d['positive'], [round(v, 2) for v in d['runs']]))

    t = page.json(FOLLOW)
    r.ok('the face turns right when the pointer is right', t['right'] > 0.2, 'angle Y %+.2f rad' % t['right'])
    r.ok('and left when it is left', t['left'] < -0.2, 'angle Y %+.2f rad' % t['left'])
    # Upward is where clientY SHRINKS, and a positive X angle carries the near face down, so this one is negative.
    r.ok('and tips up when it is above', t['up'] < -0.1, 'angle X %+.2f rad' % t['up'])
    # THE POINT OF DRIVING IT OFF POSITION: a still hand is a still face. The velocity model this replaced kept
    # coasting after the pointer stopped, which is what read as janky.
    r.ok('a still pointer leaves the face still', t['drift'] < 0.01, 'drifted %.4f rad' % t['drift'])

    # Viscosity is the ONE value nearness moves, and it must move at both ends. Settled first, because a throw
    # also stirs the core and the one above is still running down — the coast is deliberately slow.
    ends = page.json("(()=>{HERO.near=0;for(let i=0;i<80;i++)HERO.renderNow(0.05);"
                     "const v=[];for(const p of [0,1]){HERO.near=p;HERO.renderNow(1/60);"
                     "v.push(HERO.state.visc);}HERO.near=0;return JSON.stringify(v)})()")
    r.ok('a near pointer stirs the core', ends[1] > ends[0] * 1.5,
         'viscosity %.2f -> %.2f' % (ends[0], ends[1]))

    # Nothing ELSE reacts. The hero got noisy once from six values chasing the mouse at the same time, and that
    # was the note that took it back to one.
    still = page.json("(()=>{const k=['glow','turb','amp','rate','size','zoom'];const a={};"
                      "HERO.near=0;HERO.renderNow(1/60);for(const n of k)a[n]=HERO.state[n];"
                      "HERO.near=1;HERO.renderNow(1/60);const d=[];"
                      "for(const n of k) if(HERO.state[n]!==a[n]) d.push(n);"
                      "HERO.near=0;return JSON.stringify({moved:d})})()")
    r.ok('nothing but the spins and viscosity answers the pointer', not still['moved'], str(still['moved']))

    # Reduced motion draws the object once and holds it. Checked on the simulation's phase rather than on a
    # pixel: a held frame and a frame that redraws the same thing look identical.
    page.cdp.call('Emulation.setEmulatedMedia',
                  {'features': [{'name': 'prefers-reduced-motion', 'value': 'reduce'}]})
    time.sleep(0.3)
    frozen = page.json("(()=>{HERO.renderNow(1/60);const a=HERO.sim.step(HERO.state,0,0).phCoreY;"
                       "for(let i=0;i<8;i++) HERO.renderNow(1/60);"
                       "return JSON.stringify({a, b:HERO.sim.step(HERO.state,0,0).phCoreY})})()")
    r.ok('reduced motion holds one frame', abs(frozen['b'] - frozen['a']) < 1e-9, str(frozen))
    page.cdp.call('Emulation.setEmulatedMedia', {'features': []})
    time.sleep(0.3)
