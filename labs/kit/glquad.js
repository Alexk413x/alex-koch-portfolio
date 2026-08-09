/* glquad.js — hosts one full-screen fragment shader: compile, uniform cache, resize, context loss.
 *
 * Knows nothing about any uniform's meaning; the shader source and the values are the caller's. CRT GL keeps its
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

const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

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
 * 256 is a power of two, which WebGL1 requires for REPEAT wrapping.
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
 *   const R = createQuad(canvas, { frag: FRAG, uniforms: ['uRes'], ext: ['OES_standard_derivatives'] });
 *   R.resize(w, h, 0.7);  R.f('uTime', t);  R.draw();
 *
 * `onRestore` fires after a lost context is rebuilt, so the caller can re-send anything it only sets on change.
 * A shader using `fwidth` must pass `ext: ['OES_standard_derivatives']` AND carry the matching `#extension`
 * directive as its first line, or it compiles to nothing and this returns null.
 *
 * `textures` maps a sampler name to { data, w, h } — see valueNoiseTexture. They are uploaded on build, so a
 * restored context recreates them along with everything else.
 */
export function createQuad(canvas, { frag, uniforms = [], ext = [], textures = {}, onRestore = null } = {}) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false,
                                          premultipliedAlpha: false, preserveDrawingBuffer: false,
                                          powerPreference: 'high-performance' })
          || canvas.getContext('experimental-webgl');
  if (!gl) return null;

  let U = {}, last = new Map(), prog = null;

  const build = () => {
    ext.forEach((n) => gl.getExtension(n));
    const vs = stage(gl, gl.VERTEX_SHADER, VERT), fs = stage(gl, gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error('[glquad] link:\n' + gl.getProgramInfoLog(prog)); return false; }
    gl.useProgram(prog);

    // One triangle, not two: (-1,-1) (3,-1) (-1,3) covers the clip box with three vertices and rasterises no
    // shared diagonal.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

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
      gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    });

    U = {};
    uniforms.forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    // Must clear here, not only at construction: a relinked program's uniforms are all zero, and a surviving
    // cache would suppress the uploads that fix them.
    last.clear();
    return true;
  };
  if (!build()) return null;

  const R = {
    gl,
    gpu: detectGPU(gl),
    lost: false,
    w: 1, h: 1,

    // Skips the upload when the value has not moved. Reactor pushes about fifty floats per frame and perhaps
    // three of them differ from the frame before.
    f(name, v) {
      if (last.get(name) === v) return;
      last.set(name, v);
      gl.uniform1f(U[name], v);
    },
    f2(name, a, b) {
      const k = last.get(name);
      if (k && k[0] === a && k[1] === b) return;
      last.set(name, [a, b]);
      gl.uniform2f(U[name], a, b);
    },
    f3(name, a, b, c) {
      const k = last.get(name);
      if (k && k[0] === a && k[1] === b && k[2] === c) return;
      last.set(name, [a, b, c]);
      gl.uniform3f(U[name], a, b, c);
    },
    // Uncached: an array uniform here is a per-frame animation table, so comparing costs what uploading costs.
    fv4(name, arr) { gl.uniform4fv(U[name], arr); },

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

    draw() { gl.drawArrays(gl.TRIANGLES, 0, 3); },
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
