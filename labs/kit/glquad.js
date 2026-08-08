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

/* Builds the renderer, or returns null if WebGL is unavailable or the shader will not compile.
 *
 *   const R = createQuad(canvas, { frag: FRAG, uniforms: ['uRes'], ext: ['OES_standard_derivatives'] });
 *   R.resize(w, h, 0.7);  R.f('uTime', t);  R.draw();
 *
 * `onRestore` fires after a lost context is rebuilt, so the caller can re-send anything it only sets on change.
 * A shader using `fwidth` must pass `ext: ['OES_standard_derivatives']` AND carry the matching `#extension`
 * directive as its first line, or it compiles to nothing and this returns null.
 */
export function createQuad(canvas, { frag, uniforms = [], ext = [], onRestore = null } = {}) {
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
