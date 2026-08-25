/* glquad.js — hosts one full-screen fragment shader: compile, uniform cache, resize, context loss.
 *
 * Knows nothing about any uniform's meaning; the shader source and the values are the caller's. CRT Lab keeps its
 * own host — four programs and a half-float ping-pong do not fit this shape.
 */

// Reports which adapter the context landed on. A page cannot choose (powerPreference is ignored on Windows
// Chrome), but it can ask, and pick a lighter default render scale on integrated graphics.
export function detectGPU(gl) {
  try {
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const name = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '';
    return { name, integrated: /intel|uhd|iris|radeon\s*graphics|adreno|mali|apple/i.test(name) };
  } catch (_) { return { name: '', integrated: false }; }
}

// Compiles one stage, naming the file and line on failure. A silent compile failure renders black, which is
// indistinguishable from a maths bug that happens to output zero.
function stage(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[glquad] ' + (type === gl.VERTEX_SHADER ? 'vertex' : 'fragment') + ':\n' +
                  gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

// ES 3.00, like every fragment shader this compiles: a WebGL2 context will not link a 1.00 vertex shader to a
// 3.00 fragment one, and the pair must agree on the language before either compiles.
// A template literal, because #version has to sit on its own line and an escape would hide that.
const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

/* A LOOKUP TABLE FOR 3D VALUE NOISE, PACKED INTO ONE 2D TEXTURE.
 *
 * Computing value noise in the shader costs eight hashes and seven interpolations per sample. A shader that wants
 * ten samples per march step spends its entire budget there. This is the standard answer: put the lattice in a
 * texture and let the sampler do the work — one filtered fetch, and the hardware's bilinear unit performs the x
 * and y interpolation for free.
 *
 * THE THIRD DIMENSION IS THE TRICK. The two channels hold the SAME field offset by (37, 17) texels, and the
 * shader addresses slice z at `xy + vec2(37,17)*z`. So the red channel at a texel is slice z and the green
 * channel is slice z+1 of that same address, and one fetch returns both — the caller only has to mix them by the
 * fractional z. The offset is coprime with the size, so slices decorrelate rather than repeating.
 *
 * 256 is a power of two. WebGL2 wraps NPOT textures happily, so this is no longer a requirement — but the
 * shader addresses slices by adding a coprime offset and wrapping, and that arithmetic assumes this size.
 */
export function valueNoiseTexture(size = 256, seed = 1) {
  const n = size * size;
  const base = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    base[i] = (s >>> 24) & 255;
  }
  const data = new Uint8Array(n * 4);
  const blue = blueNoiseTile(64);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const j = ((y + 17) % size) * size + ((x + 37) % size);
      data[i * 4] = base[i];          // slice z
      data[i * 4 + 1] = base[j];      // slice z + 1, at the address the shader will read
      // The third channel is free, so the dither pattern rides along rather than costing a second texture.
      data[i * 4 + 2] = blue[(y % 64) * 64 + (x % 64)];
      data[i * 4 + 3] = 255;
    }
  }
  return { data, w: size, h: size };
}

/* BLUE NOISE, BY ENERGY MINIMISATION.
 *
 * A raymarch jitters where each ray starts so a fixed step count does not band into rings, and the character of
 * that jitter decides how the residual error looks. White noise spreads error across all frequencies including
 * the low ones the eye is most sensitive to, so it reads as clumpy grain. Blue noise pushes the energy into high
 * frequencies the eye averages away, and the same step count looks markedly cleaner.
 *
 * Void-and-cluster is the textbook construction; this is the cheaper swap-based one — start from white noise and
 * repeatedly exchange two samples when doing so lowers a Gaussian-weighted neighbourhood energy. It converges to
 * a good approximation in a few thousand swaps, which is a few milliseconds once at startup.
 *
 * The neighbourhood is clipped to 4 texels because the Gaussian is negligible beyond that, turning an O(n^2)
 * energy into a constant per swap.
 */
function blueNoiseTile(size) {
  const n = size * size;
  const v = new Float32Array(n);
  let s = 12345;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) v[i] = i / n;
  for (let i = n - 1; i > 0; i--) {                     // shuffle into white noise
    const j = (rnd() * (i + 1)) | 0;
    const t = v[i]; v[i] = v[j]; v[j] = t;
  }

  /* THE SPATIAL WEIGHTS ARE CONSTANT, so they are computed once into a flat table rather than per neighbour per
   * swap, and the value term is a linear falloff rather than a second exp. Both exps in the inner loop made this
   * take 400ms at startup — half a second of blank page for a 64x64 tile. Same result, a fraction of the work.
   *
   * Offsets are precomputed too: the wrap is a modulo that never changes for a given neighbour. */
  const R = 4, SIG2 = 2.1 * 2.1;
  const wt = [], odx = [], ody = [];
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (!dx && !dy) continue;
      const w = Math.exp(-(dx * dx + dy * dy) / SIG2);
      if (w < 0.004) continue;                        // negligible, and the tail is most of the neighbourhood
      wt.push(w); odx.push(dx); ody.push(dy);
    }
  }
  const NW = wt.length;

  const energyAt = (idx, val) => {
    const x0 = idx % size, y0 = (idx / size) | 0;
    let e = 0;
    for (let k = 0; k < NW; k++) {
      const j = ((y0 + ody[k] + size) % size) * size + ((x0 + odx[k] + size) % size);
      // Similar values close together is exactly the clumping to be penalised, so the term peaks at zero
      // difference and falls away linearly.
      let dv = val - v[j];
      if (dv < 0) dv = -dv;
      if (dv < 1.0) e += wt[k] * (1.0 - dv);
    }
    return e;
  };

  for (let iter = 0; iter < 14000; iter++) {
    const a = (rnd() * n) | 0, b = (rnd() * n) | 0;
    if (a === b) continue;
    const before = energyAt(a, v[a]) + energyAt(b, v[b]);
    const after = energyAt(a, v[b]) + energyAt(b, v[a]);
    if (after < before) { const t = v[a]; v[a] = v[b]; v[b] = t; }
  }

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(255, (v[i] * 256) | 0);
  return out;
}

/* Builds the renderer, or returns null if WebGL is unavailable or the shader will not compile.
 *
 *   const R = createQuad(canvas, { frag: FRAG, uniforms: ['uRes'] });
 *   R.resize(w, h, 0.7);  R.f('uTime', t);  R.draw();
 *
 * `onRestore` fires after a lost context is rebuilt, so the caller can re-send anything it only sets on change.
 *
 * `fwidth` and the derivatives NEED NOTHING. They are core in WebGL2, so the OES_standard_derivatives dance —
 * an `ext` entry plus a `#extension` directive as the shader's first line — is gone from every caller. `ext` is
 * kept for extensions that are still extensions here, EXT_color_buffer_float being the one likely to matter.
 *
 * `textures` maps a sampler name to { data, w, h } — see valueNoiseTexture. They are uploaded on build, so a
 * restored context recreates them along with everything else.
 *
 * `variant(key)` returns a fragment source for a key, and R.use(key) switches to it — for a shader whose cost
 * depends on which parts are switched on. `frag` must then be the SUPERSET, because it is what draws while a
 * narrower build compiles.
 */
const HEX = new Map();   // shared by every renderer: a hex string parses to the same vec3 anywhere

export function createQuad(canvas, { frag, uniforms = [], ext = [], textures = {}, onRestore = null,
                                     variant = null, deferLink = false } = {}) {
  /* WEBGL2, and only WebGL2. There is no WebGL1 fallback and that is deliberate: `experimental-webgl` was a 2013
     spelling for browsers that no longer exist, and a silent downgrade path is worse than none — a shader using
     a core-in-2 feature would compile to nothing on the fallback and the page would show black with no error
     worth reading.
     THIS IS NOT A SPEED CHANGE. Every lab here draws one fullscreen triangle, so the frame cost is fragment
     shader arithmetic and the context version does not touch it. What 2 buys is that derivatives, textureLod,
     texelFetch, round() and NPOT textures are all core, so a shader can use them without an extension dance.
     The measured cost of each lab before and after this move is the same. */
  /* `alpha: false` STAYS, and the reason is that removing it has NOT been shown to help. MDN warns the flag makes
     the browser composite the canvas as though it were opaque "at a significant performance cost" and says to
     write 1.0 from the shader instead — which these shaders already do, so it looks like free money.
     It was tried. The run without it came back slower, but the same build measured 56.4 ms and 37.8 ms on two
     runs an hour apart on this machine, so a ~10% effect is far inside the noise and NOTHING was demonstrated
     either way. Left as it was, because an unmeasured change to a working default is not an improvement.
     If you want the real answer: interleave A/B/A/B on an idle machine, several runs each. */
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false,
                                           premultipliedAlpha: false, preserveDrawingBuffer: false,
                                           powerPreference: 'high-performance' });
  if (!gl) return null;

  /* ONE RENDERER, SEVERAL PROGRAMS. A fragment shader pays for code it does not run: in this project's wormhole,
   * the plasma layer measured 9.14 ms alone in a shader carrying all three layers and 4.88 ms in one carrying
   * only plasma, for a byte-identical frame. `variant` is how a caller offers a narrower build — see use().
   *
   * A caller that passes no `variant` gets exactly one program and none of the rest of this applies.
   */
  const par = gl.getExtension('KHR_parallel_shader_compile');
  const progs = new Map();
  // A symbol, so no key a caller can pass ever names the superset. A string sentinel would: the natural key for
  // "nothing switched on" is the empty one, and it would collide with the base program and quietly draw the
  // widest shader for the narrowest scene.
  const BASE = Symbol('superset');
  let cur = null, pending = null, quad = null;
  // The base program while it is still linking, under deferLink. Null once adopted, and null always without it.
  let basePending = null;

  // 0 still linking, 1 linked, -1 failed. Reading LINK_STATUS is what BLOCKS until the driver has finished, so
  // the completion query has to come first or the compile is synchronous after all.
  const linkState = (prog, wait) => {
    if (!wait && par && !gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR)) return 0;
    if (gl.getProgramParameter(prog, gl.LINK_STATUS)) return 1;
    console.error('[glquad] link:\n' + gl.getProgramInfoLog(prog));
    return -1;
  };

  const submit = (src) => {
    const vs = stage(gl, gl.VERTEX_SHADER, VERT), fs = stage(gl, gl.FRAGMENT_SHADER, src);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    return prog;
  };

  /* Makes a linked program current. The attribute binding and the sampler units are BOTH re-applied on every
   * switch rather than once at build: a sampler uniform lives in the program like any other, and no vertex array
   * object is bound here to remember the attribute. WebGL2 has VAOs and this could use one; it does not, because
   * one program drawing one triangle has nothing to gain from it.
   *
   * `last` is per program and is NOT cleared here: uniform values live in the program object and survive being
   * switched away from, so a returning program's cache is still telling the truth.
   */
  const activate = (entry) => {
    gl.useProgram(entry.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const loc = gl.getAttribLocation(entry.prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    Object.keys(textures).forEach((name, unit) => {
      gl.uniform1i(gl.getUniformLocation(entry.prog, name), unit);
    });
    cur = entry;
  };

  const adopt = (key, prog) => {
    const U = {};
    uniforms.forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    // A freshly linked program's uniforms are all zero, so it starts with an empty cache and everything is
    // uploaded on the next frame.
    const entry = { key, prog, U, last: new Map(), ok: true };
    progs.set(key, entry);
    return entry;
  };

  const build = () => {
    ext.forEach((n) => gl.getExtension(n));

    // One triangle, not two: (-1,-1) (3,-1) (-1,3) covers the clip box with three vertices and rasterises no
    // shared diagonal.
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // Uploaded here rather than at construction so a restored context gets them back: the old texture objects
    // died with the old context, and a shader sampling a dead one renders black.
    Object.keys(textures).forEach((name, unit) => {
      const spec = textures[name];
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, spec.w, spec.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, spec.data);
      // LINEAR so the sampler does the lattice interpolation; REPEAT so the field tiles without a seam.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    });

    // Every program in the cache is a dead object now; it went with the context.
    progs.clear(); cur = null; pending = null;

    const prog = submit(frag);
    if (!prog) return false;
    /* deferLink: HAND THE PROGRAM TO THE DRIVER AND WALK AWAY. Reading LINK_STATUS is what blocks, so the wait
       below is the whole cost — measured on an Intel UHD 630 with a cold shader cache, linking the reactor's
       superset took 13.3 seconds on the main thread, and the page could not paint past it. A caller that opts
       in polls ready() instead and draws nothing until it lands.
       OFF BY DEFAULT, so every lab keeps the behaviour it was measured with: they own the whole viewport and
       have nothing to show before the shader exists, where a page with a hero has a page around it. */
    if (deferLink) { basePending = prog; return true; }
    if (linkState(prog, true) !== 1) return false;
    activate(adopt(BASE, prog));
    return true;
  };
  if (!build()) return null;

  const R = {
    gl,
    gpu: detectGPU(gl),
    lost: false,
    w: 1, h: 1,

    /* Whether there is a program to draw with. Always true without deferLink, so no existing caller changes.
       Under it, this is the poll: COMPLETION_STATUS_KHR costs nothing and LINK_STATUS is only read once the
       driver says it is done, which is the difference between a poll and a stall.
       `wait` FORCES IT, and that is what a synchronous frame needs. renderNow() is documented to draw without an
       animation frame at all, which is the only way to step a page that is not front-most — and a poll that
       returns false leaves it drawing nothing, so the caller gets a blank buffer rather than a picture. The
       frame loop never passes it; the harness path always does. */
    ready(wait) {
      if (!basePending) return !!cur;
      const st = linkState(basePending, !!wait);
      if (st === 0) return false;
      const prog = basePending;
      basePending = null;
      if (st === -1) return false;
      activate(adopt(BASE, prog));
      return true;
    },

    /* Asks for the program built for `key`, and returns whether that is what is now current.
     *
     * IT NEVER STALLS AND NEVER SHOWS THE WRONG FRAME. A key that has not been built yet starts compiling and
     * the CURRENT program keeps drawing — the caller's base shader is the superset, so it is already correct,
     * only slower. Where the driver offers KHR_parallel_shader_compile that compile costs the main thread
     * nothing at all; without it the wait lands on whichever frame finds it finished.
     *
     * Call this BEFORE the frame's uniforms: a switch lands on a program whose uniforms are all zero, and it is
     * the sends that follow which fill it in.
     */
    use(key) {
      if (!variant || R.lost) return false;
      if (pending) {
        const st = linkState(pending.prog, false);
        if (st === 1) { adopt(pending.key, pending.prog); pending = null; }
        else if (st === -1) { progs.set(pending.key, { key: pending.key, ok: false }); pending = null; }
      }
      if (cur && cur.key === key) return true;
      const have = progs.get(key);
      if (have && have.ok) { activate(have); return true; }

      /* WHILE A BUILD IS NOT READY, FALL BACK TO THE SUPERSET — never to whatever happened to be current.
       *
       * The current program is usually another narrow build, and a narrow build CANNOT draw a part it does not
       * contain: switching a layer on while running a build without it showed nothing at all for the 150-350 ms
       * the compile took. The superset is the only program guaranteed to draw every setting, so it is what
       * covers the gap. Costs one slower frame at the switch and never a wrong one.
       */
      if (cur && cur.key !== BASE) activate(progs.get(BASE));
      if (have) return false;                          // known bad: the superset draws it, do not retry
      if (pending) return false;                       // one at a time; the next frame asks again
      const src = variant(key);
      if (src == null) return false;
      const prog = submit(src);
      if (!prog) { progs.set(key, { key, ok: false }); return false; }
      pending = { key, prog };
      return false;
    },

    // Skips the upload when the value has not moved. Reactor pushes about fifty floats per frame and perhaps
    // three of them differ from the frame before.
    f(name, v) {
      if (!cur) return;
      if (cur.last.get(name) === v) return;
      cur.last.set(name, v);
      gl.uniform1f(cur.U[name], v);
    },
    f2(name, a, b) {
      if (!cur) return;
      const k = cur.last.get(name);
      if (k && k[0] === a && k[1] === b) return;
      cur.last.set(name, [a, b]);
      gl.uniform2f(cur.U[name], a, b);
    },
    f3(name, a, b, c) {
      if (!cur) return;
      const k = cur.last.get(name);
      if (k && k[0] === a && k[1] === b && k[2] === c) return;
      cur.last.set(name, [a, b, c]);
      gl.uniform3f(cur.U[name], a, b, c);
    },
    /* A '#rrggbb' colour as a vec3 in 0..1. The parse is memoised across every renderer on the page — a colour
     * comes from a swatch or a preset, so the same handful of strings recur for the life of the lab — and the
     * upload itself is skipped by f3's own cache. */
    f3hex(name, hex) {
      const h = hex || '#ffffff';
      let c = HEX.get(h);
      if (!c) HEX.set(h, c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255));
      this.f3(name, c[0], c[1], c[2]);
    },

    // Uncached: an array uniform here is a per-frame animation table, so comparing costs what uploading costs.
    fv4(name, arr) { if (!cur) return; gl.uniform4fv(cur.U[name], arr); },

    // Uncached for the same reason as fv4: nine floats compare for what they cost to send. Column-major, which
    // is what GLSL expects and what mat3(a,b,c, d,e,f, g,h,i) builds.
    m3(name, arr) { if (!cur) return; gl.uniformMatrix3fv(cur.U[name], false, arr); },

    // Sizes the buffer to a CSS box at a fraction of it, reporting whether anything moved. dpr is capped at 1 on
    // top of `scale`: these are soft, noisy fields where the extra samples buy nothing visible.
    resize(cssW, cssH, scale) {
      const dpr = Math.min(1, window.devicePixelRatio || 1);
      const w = Math.max(2, Math.floor(cssW * dpr * scale));
      const h = Math.max(2, Math.floor(cssH * dpr * scale));
      if (w === R.w && h === R.h) return false;
      canvas.width = R.w = w; canvas.height = R.h = h;
      gl.viewport(0, 0, w, h);
      return true;
    },

    draw() { if (cur) gl.drawArrays(gl.TRIANGLES, 0, 3); },
  };

  // preventDefault is required or the browser will not restore the context at all and the page stays black.
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); R.lost = true; });
  canvas.addEventListener('webglcontextrestored', () => {
    R.lost = !build();
    R.w = R.h = 1;                     // the buffer went with the context, so force the next resize through
    if (!R.lost && onRestore) onRestore();
  });

  return R;
}
