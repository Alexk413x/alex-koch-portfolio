/* library-models.js — the four wireframe models on The Library's ring.
 *
 * Pure drawing: no layout, no timers, no listeners. Each builder returns { svg, step(dt), draw() }. The ring
 * decides who steps, so a model that is not at the front is never advanced and keeps the state it left in.
 *
 * NOT CSS 3D, for the reason case3d.js gives: every edge here is one stroke of one weight, projected by hand.
 * Every shape that has to line up with a wireframe edge, glass faces included, is projected point by point.
 * Only small marks (logos, labels) are placed by an affine map from three projected corners; used across a whole
 * window the map drifts by the perspective, which is how a flat fill ends up beside its own outline.
 */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const CX = 200, CY = 150, FOCAL = 640;

  /* Every model rests at this pose and never sways. The yaw leans the face a few degrees left for depth; the pitch
     is nearly level, so the camera reads as looking at the ring rather than down on it. */
  const POSE = { yaw: -.2, pitch: .05 };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const r1 = (v) => Math.round(v * 10) / 10;
  const r4 = (v) => Math.round(v * 10000) / 10000;

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function root(label) {
    return el('svg', { viewBox: '0 0 400 300', class: 'lm', role: 'img', 'aria-label': label, focusable: 'false' });
  }

  /* World: x right, y down, z toward the viewer. Yaw turns about y, pitch about x. Returns [x, y, depth, scale].
     A longer focal makes the perspective weaker. The two slabs use a very long one, so a back panel is the same
     size as its front and only the lean moves it: it shows past the front on one side and sits behind it on the
     other, which is how a slab of that thickness looks. With the default focal the shrink with distance hid it
     inside the front on both sides. */
  function camera(yaw, pitch, focal) {
    const f = focal || FOCAL;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return function (x, y, z) {
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const s = f / (f - z2);
      return [CX + x1 * s, CY + y2 * s, z2, s];
    };
  }

  const SLAB_FOCAL = 3000;

  /* The space the two networks, the graph and the org chart, are each fitted into, in viewBox units. Fitted rather
     than laid out to match: the graph is deep and the chart is flat, so their raw extents differ, and a camera that
     scales and centers whatever it is given makes both fill the same box. boxes are [x, y, z, halfWidth, halfHeight]. */
  const FIELD = [330, 240];
  function fitted(cam, boxes) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    boxes.forEach((b) => {
      const p = cam(b[0], b[1], b[2]);
      x0 = Math.min(x0, p[0] - b[3] * p[3]); x1 = Math.max(x1, p[0] + b[3] * p[3]);
      y0 = Math.min(y0, p[1] - b[4] * p[3]); y1 = Math.max(y1, p[1] + b[4] * p[3]);
    });
    const k = Math.min(FIELD[0] / (x1 - x0), FIELD[1] / (y1 - y0)), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return (x, y, z) => {
      const p = cam(x, y, z);
      return [CX + (p[0] - mx) * k, CY + (p[1] - my) * k, p[2], p[3] * k];
    };
  }

  function lines(parent, cls) {
    const path = el('path', { class: cls }, parent);
    let d = '';
    return {
      path,
      seg(a, b) { d += 'M' + r1(a[0]) + ' ' + r1(a[1]) + 'L' + r1(b[0]) + ' ' + r1(b[1]); },
      loop(pts) {
        d += 'M' + r1(pts[0][0]) + ' ' + r1(pts[0][1]);
        for (let i = 1; i < pts.length; i++) d += 'L' + r1(pts[i][0]) + ' ' + r1(pts[i][1]);
        d += 'Z';
      },
      dot(a) { d += 'M' + r1(a[0]) + ' ' + r1(a[1]) + 'h.01'; },
      flush() { path.setAttribute('d', d); d = ''; },
    };
  }

  /* The shared .bead component (site.css), scrubbed from script: the Cartographer's own keyframes held on the frame for
     a given progress along the path. A path crosses in the first 100 of the keyframes' 2274 units of a 20.7s cycle. */
  const BEAD_TRAVEL = 100 / 2274 * 20.7;
  /* Beads sit in one layer per drawing, so the layer carries their opacity once. */
  const beadLayer = (svg) => svg.querySelector(':scope > .lm-beads') || el('g', { class: 'lm-beads' }, svg);
  const newBead = (svg) => el('path', { class: 'bead scrub', pathLength: 100 }, beadLayer(svg));
  function moveBead(b, d, u) {
    if (b._d !== d) { b.setAttribute('d', d); b._d = d; b.style.setProperty('--len', b.getTotalLength().toFixed(2)); }
    b.classList.add('on');
    b.style.animationDelay = r4(-u * BEAD_TRAVEL) + 's';
  }

  function pathD(pts) {
    let d = 'M' + r1(pts[0][0]) + ' ' + r1(pts[0][1]);
    for (let i = 1; i < pts.length; i++) d += 'L' + r1(pts[i][0]) + ' ' + r1(pts[i][1]);
    return d + 'Z';
  }

  function panel(parent) {
    const g = el('g', null, parent);
    return {
      g,
      place(cam, x, y, z) {
        const p0 = cam(x, y, z), p1 = cam(x + 20, y, z), p2 = cam(x, y + 20, z);
        g.setAttribute('transform', 'matrix(' + [
          (p1[0] - p0[0]) / 20, (p1[1] - p0[1]) / 20, (p2[0] - p0[0]) / 20, (p2[1] - p0[1]) / 20, p0[0], p0[1],
        ].map(r4).join(' ') + ')');
      },
    };
  }

  function rectPts(cam, x0, y0, x1, y1, z) {
    return [cam(x0, y0, z), cam(x1, y0, z), cam(x1, y1, z), cam(x0, y1, z)];
  }

  const ARC = 4;

  /* A rounded rectangle as flat points, with the indices where each corner's arc starts and ends: those are the
     places a wall's edge runs between the front and back outlines, the same ticks the Cartographer's phones have. */
  function roundRect(x0, y0, x1, y1, r) {
    const pts = [], ticks = [];
    [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]].forEach((c) => {
      for (let i = 0; i <= ARC; i++) {
        const a = (c[2] + 90 * i / ARC) * Math.PI / 180;
        if (i === 0 || i === ARC) ticks.push(pts.length);
        pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
      }
    });
    return { pts, ticks };
  }

  const lift = (cam, pts, z) => pts.map((p) => cam(p[0], p[1], z));

  function circle(cam, x, y, r, z) {
    const pts = [];
    for (let k = 0; k < 10; k++) pts.push(cam(x + Math.cos(k * Math.PI / 5) * r, y + Math.sin(k * Math.PI / 5) * r, z));
    return pts;
  }

  /* The front outline carries the glass; the back outline and the corner edges are the faint wall behind it. */
  function shell(rr, cam, zf, zb, front, rear) {
    const f = lift(cam, rr.pts, zf), b = lift(cam, rr.pts, zb);
    front.loop(f);
    rear.loop(b);
    rr.ticks.forEach((i) => rear.seg(f[i], b[i]));
  }

  function text(parent, attrs, str) {
    const t = el('text', attrs, parent);
    t.textContent = str;
    return t;
  }

  /* Seeded, so the first frame of a model that has not run yet is the same on every load. */
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* Stands a solid on a corner: the vertex (1, -1, 1) turns to point at the viewer. */
  const TURN_Y = -Math.PI / 4, TURN_X = -Math.atan(Math.SQRT1_2);
  function standOnCorner(v) {
    const x1 = v[0] * Math.cos(TURN_Y) + v[2] * Math.sin(TURN_Y), z1 = -v[0] * Math.sin(TURN_Y) + v[2] * Math.cos(TURN_Y);
    return [x1, v[1] * Math.cos(TURN_X) - z1 * Math.sin(TURN_X), v[1] * Math.sin(TURN_X) + z1 * Math.cos(TURN_X)];
  }

  // ------------------------------------------------------------------------------------------------ agent tabs
  function agentTabs() {
    const logos = window.AKLOGOS || {};
    const svg = root('Agent Tabs: an IDE window with Claude Code, Codex, Gemini and Copilot sessions as tabs, each tab showing its own terminal.');
    const cam = camera(POSE.yaw, POSE.pitch, SLAB_FOCAL);
    const smooth = (u) => u * u * (3 - 2 * u);

    // The sidebar runs the full height of the window; the tabs fill the row above the terminal.
    const X0 = -165, Y0 = -100, W = 330, H = 200, DEPTH = 24, SB = 70;
    const GAP = 4, PAD = 6, CH = 24, TAB_Y = Y0 + PAD;
    const CW = (W - SB - PAD * 2 - GAP * 3) / 4, TAB_X = X0 + SB + PAD;
    const TX0 = X0 + SB + 14, TW = W - SB - 28, YB = Y0 + H - 18, TOP = Y0 + 46, ROW = 15;

    const rear = lines(svg, 'lm-line lm-faint');
    const wall = lines(svg, 'lm-wall');
    const frame = lines(svg, 'lm-line lm-faint lm-glass');
    const inner = lines(svg, 'lm-line lm-faint');
    const side = lines(svg, 'lm-bars lm-soft');

    const win = roundRect(X0, Y0, X0 + W, Y0 + H, 14);
    shell(win, cam, 0, -DEPTH, frame, rear);
    const wf = lift(cam, win.pts, 0), wb = lift(cam, win.pts, -DEPTH);
    const half = 2 * (ARC + 1);
    wall.loop(wf.slice(0, half).concat(wb.slice(0, half).reverse()));
    wall.loop(wf.slice(half).concat(wb.slice(half).reverse()));
    rear.flush();
    wall.flush();
    frame.flush();

    inner.seg(cam(X0 + SB, Y0, 0), cam(X0 + SB, Y0 + H, 0));
    inner.seg(cam(X0 + SB, Y0 + 36, 0), cam(X0 + W, Y0 + 36, 0));
    [14, 26, 38].forEach((dx) => inner.loop(circle(cam, X0 + dx, Y0 + 14, 3, 0)));
    inner.flush();
    [[12, 38, 40], [20, 54, 34], [20, 70, 46], [12, 86, 30], [20, 102, 38], [20, 118, 28], [12, 134, 44], [20, 150, 36]].forEach((r) => {
      side.seg(cam(X0 + r[0], Y0 + r[1], 1), cam(X0 + r[0] + r[2], Y0 + r[1], 1));
    });
    side.flush();

    /* A script is a run of rows: how long each one is and whether it is a prompt. Bars, not words: nothing here
       names a real command. */
    const TABS = ['claude', 'codex', 'gemini', 'copilot'].map((logo, t) => {
      const rand = rng(11 + t * 7);
      const rows = [];
      for (let j = 0; j < 16; j++) {
        const prompt = j % 5 === 0;
        rows.push({ kind: prompt ? 'p' : 'o', len: (prompt ? .24 + rand() * .22 : .26 + rand() * .38) * TW, rate: prompt ? 80 : 210 });
      }
      let at = .3;
      const start = rows.map((r) => { const s = at; at += r.len / r.rate + .18; return s; });
      return { logo, rows, start };
    });
    const DWELL = 4.2, SHIFT = .18;

    const chipPts = roundRect(0, 0, CW, CH, 5).pts;
    const chips = TABS.map((tab) => {
      const path = el('path', { class: 'lm-line lm-chip' }, svg);
      const p = panel(svg);
      const g = el('g', { transform: 'scale(.6)', class: 'lm-logo' }, p.g);
      const mark = el('path', { d: logos[tab.logo] || '' }, g);
      if (tab.logo === 'codex') mark.setAttribute('fill-rule', 'evenodd');
      return { path, p, lift: 0 };
    });

    const pools = { o: [], p: [] };
    for (let i = 0; i < 12; i++) pools.o.push(el('path', { class: 'lm-bars lm-soft' }, svg));
    const glow = el('g', { class: 'lm-glow' }, svg);
    for (let i = 0; i < 12; i++) pools.p.push(el('path', { class: 'lm-bars lm-hotbar' }, glow));
    const cursor = el('path', { class: 'lm-bars lm-hotbar' }, glow);

    let clock = 0, sel = 0, ts = 2.3;
    chips[0].lift = 1;

    const seg = (a, b) => 'M' + r1(a[0]) + ' ' + r1(a[1]) + 'L' + r1(b[0]) + ' ' + r1(b[1]);

    function step(dt) {
      clock += dt;
      ts += dt;
      if (ts >= DWELL) {
        sel = (sel + 1) % TABS.length;
        ts = 0;
      }
      const k = Math.min(1, dt * 9);
      chips.forEach((c, i) => { c.lift += ((i === sel ? 1 : 0) - c.lift) * k; });
    }

    function draw() {
      chips.forEach((c, i) => {
        const x = TAB_X + i * (CW + GAP), z = 6 + 12 * c.lift;
        c.path.setAttribute('d', pathD(chipPts.map((p) => cam(p[0] + x, p[1] + TAB_Y, z))));
        c.path.setAttribute('class', 'lm-line lm-chip' + (i === sel ? ' lm-on' : ''));
        c.p.place(cam, x + (CW - 14.4) / 2, TAB_Y + (CH - 14.4) / 2, z + 1);
        c.p.g.setAttribute('class', i === sel ? 'lm-on' : '');
      });

      /* The terminal is an input line at the bottom. Each new row starts there and pushes the ones above it up by
         one row, so pos is how many rows the stack has risen by. */
      const tab = TABS[sel];
      let pos = 0;
      tab.start.forEach((st, j) => { if (j) pos += smooth(clamp((ts - (st - SHIFT)) / SHIFT, 0, 1)); });
      const used = { o: 0, p: 0 };
      let curY = 0, curEnd = 0, cur = false;
      tab.rows.forEach((row, j) => {
        const n = clamp((ts - tab.start[j]) * row.rate, 0, row.len);
        if (n < .5) return;
        const y = YB + (j - pos) * ROW;
        const a = clamp((y - TOP) / 24, 0, 1);
        cur = true;
        curY = y;
        curEnd = n;
        if (a <= 0 || used[row.kind] >= 12) return;
        const path = pools[row.kind][used[row.kind]++];
        path.setAttribute('d', seg(cam(TX0, y, 3), cam(TX0 + n, y, 3)));
        path.setAttribute('stroke-opacity', r4(a));
      });
      ['o', 'p'].forEach((k) => { for (let i = used[k]; i < 12; i++) pools[k][i].setAttribute('d', ''); });
      cursor.setAttribute('d', cur && Math.floor(clock * 2) % 2 === 0 ? seg(cam(TX0 + curEnd + 4, curY, 3), cam(TX0 + curEnd + 8, curY, 3)) : '');

    }

    function rest() {
      pools.p.forEach((path) => path.setAttribute('d', ''));
      cursor.setAttribute('d', '');
    }

    draw();
    return { svg, step, draw, rest };
  }

  // -------------------------------------------------------------------------------------------- codebase graph
  function codebaseKG() {
    const svg = root('Codebase KG: a web of nodes, each a faceted dodecahedron, joined by edges, with a pulse spreading from one node to every node it connects to.');
    const YAW = POSE.yaw, PITCH = POSE.pitch;
    const base = camera(YAW, PITCH);
    let cam = base;
    /* [x, y, z, radius]. The graph is deep, not a sheet: the root is nearest and the far ranks sit a long way
       back, so perspective alone makes them smaller, and depth dims them further. */
    const NODES = [
      [-20, -10, 95, 21], [-105, -50, 40, 13], [70, -75, 20, 15], [35, 55, 55, 12], [-150, 20, -25, 11],
      [-60, -100, -55, 12], [120, -20, -45, 14], [150, 70, -70, 10], [-85, 85, -90, 13], [5, -45, -110, 12],
      [-130, -85, -130, 10], [95, 100, -120, 11], [-30, 110, -30, 9], [40, -100, -150, 10], [160, -75, -160, 11],
    ];
    const EDGES = [
      [0, 1], [0, 2], [0, 3], [0, 9], [1, 4], [1, 5], [2, 6], [2, 13], [3, 12], [3, 11], [3, 6], [4, 8], [4, 10],
      [5, 10], [5, 9], [6, 7], [6, 14], [7, 11], [8, 12], [9, 13],
    ];
    cam = fitted(base, NODES.map((n) => [n[0], n[1], n[2], n[3] * .95, n[3] * .95]));
    const STARTS = [0, 3, 2, 1];
    const DWELL = .45, SPEED = 85, REST = 1.1;

    /* The Reactor lab's faceted ball: a dodecahedron, twelve pentagons, twenty vertices. The vertices are (1, 1, 1) with
       every sign and the cyclic permutations of (0, phi, 1/phi) with every sign; a face is every vertex on the plane at
       the maximum distance along an icosahedron-vertex normal. Each node is turned to its own angle, and only the faces
       that point at the camera are drawn. */
    const PHI = (1 + Math.sqrt(5)) / 2, SCALE = .95, RADIUS = Math.sqrt(3);
    const unique = (list) => {
      const seen = {};
      return list.filter((v) => { const k = v.map((c) => c.toFixed(4)).join(); return seen[k] ? false : (seen[k] = true); });
    };
    const signed = (t) => {
      const out = [];
      [-1, 1].forEach((x) => [-1, 1].forEach((y) => [-1, 1].forEach((z) => out.push([t[0] * x, t[1] * y, t[2] * z]))));
      return out;
    };
    const cyclic = (a, b, c) => [[a, b, c], [b, c, a], [c, a, b]];
    const flat = (lists) => [].concat.apply([], lists);
    const VERTS = unique(signed([1, 1, 1]).concat(flat(cyclic(0, PHI, 1 / PHI).map(signed))));
    const PENTAGONS = unique(flat(cyclic(0, 1, PHI).map(signed)));

    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const FACES = PENTAGONS.map((raw) => {
      const len = Math.hypot(raw[0], raw[1], raw[2]), normal = raw.map((c) => c / len);
      const reach = VERTS.map((v) => dot(v, normal));
      const top = Math.max.apply(null, reach);
      const ids = VERTS.map((v, i) => i).filter((i) => Math.abs(reach[i] - top) < 1e-6);
      let u = cross(normal, [0, 1, 0]);
      if (Math.hypot(u[0], u[1], u[2]) < .1) u = cross(normal, [1, 0, 0]);
      const w = cross(normal, u);
      const angle = (i) => Math.atan2(dot(VERTS[i], w), dot(VERTS[i], u));
      return { ids: ids.sort((a, b) => angle(a) - angle(b)), normal };
    });

    const aimed = (n) => {
      const cyw = Math.cos(YAW), syw = Math.sin(YAW), cp = Math.cos(PITCH), sp = Math.sin(PITCH);
      const z1 = -n[0] * syw + n[2] * cyw;
      return n[1] * sp + z1 * cp > .02;
    };
    const spin = (v, a, b, c) => {
      const x1 = v[0] * Math.cos(c) - v[1] * Math.sin(c), y1 = v[0] * Math.sin(c) + v[1] * Math.cos(c);
      const y2 = y1 * Math.cos(b) - v[2] * Math.sin(b), z2 = y1 * Math.sin(b) + v[2] * Math.cos(b);
      return [x1 * Math.cos(a) + z2 * Math.sin(a), y2, -x1 * Math.sin(a) + z2 * Math.cos(a)];
    };
    const turnRand = rng(77);
    const BALLS = NODES.map(() => {
      const a = turnRand() * Math.PI * 2, b = turnRand() * Math.PI * 2, c = turnRand() * Math.PI * 2;
      const toward = FACES.map((f) => aimed(spin(f.normal, a, b, c)));
      return { verts: VERTS.map((v) => spin(v, a, b, c)), faces: FACES.filter((f, k) => toward[k]), behind: FACES.filter((f, k) => !toward[k]) };
    });

    /* The faces pointing at the camera are glass, and the ones behind them show through as faint lines. */
    function solidD(n, i, side) {
      const f = n[3] * SCALE / RADIUS;
      const pts = BALLS[i].verts.map((v) => cam(n[0] + v[0] * f, n[1] + v[1] * f, n[2] + v[2] * f));
      return BALLS[i][side].map((face) => pathD(face.ids.map((k) => pts[k]))).join('');
    }

    const P = NODES.map((n) => cam(n[0], n[1], n[2]));
    // 1 at the nearest node, .45 at the farthest.
    const depth = (z) => .45 + .55 * clamp((z + 170) / 260, 0, 1);

    const edgePaths = EDGES.map(() => el('path', { class: 'lm-line lm-wire' }, svg));
    const hidden = NODES.map(() => el('path', { class: 'lm-line lm-faint' }, svg));
    const faces = NODES.map(() => el('path', { class: 'lm-line lm-glass lm-snode' }, svg));
    const pulse = el('g', { class: 'lm-pulse' }, svg);
    const rims = NODES.map(() => el('path', { class: 'lm-rim' }, pulse));
    const beads = EDGES.map(() => newBead(svg));

    NODES.forEach((n, i) => {
      const d = solidD(n, i, 'faces'), o = r4(depth(n[2]));
      hidden[i].setAttribute('d', solidD(n, i, 'behind'));
      hidden[i].setAttribute('opacity', o);
      faces[i].setAttribute('d', d);
      faces[i].setAttribute('opacity', o);
      rims[i].setAttribute('d', d);
      rims[i].setAttribute('opacity', o);
    });
    const ew = EDGES.map(() => ({}));
    EDGES.forEach((e, i) => {
      const a = P[e[0]], b = P[e[1]];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      const ra = NODES[e[0]][3] * a[3] * .85, rb = NODES[e[1]][3] * b[3] * .85;
      const d = 'M' + r1(a[0] + dx / len * ra) + ' ' + r1(a[1] + dy / len * ra) +
        'L' + r1(b[0] - dx / len * rb) + ' ' + r1(b[1] - dy / len * rb);
      const o = r4(depth((NODES[e[0]][2] + NODES[e[1]][2]) / 2));
      edgePaths[i].setAttribute('d', d);
      edgePaths[i].setAttribute('opacity', o);
      ew[i].len = Math.max(12, len - ra - rb);
      ew[i].fwd = d;
      ew[i].rev = 'M' + r1(b[0] - dx / len * rb) + ' ' + r1(b[1] - dy / len * rb) + 'L' + r1(a[0] + dx / len * ra) + ' ' + r1(a[1] + dy / len * ra);
    });

    /* A message reaches a node, the node brightens and settles over DWELL as it reads it, and only then does it send
       the message on. Messages cross a link at one speed, so a longer link takes longer. TIMES[s][n] is when node n is
       reached from start s, by the quickest route. */
    const TIMES = STARTS.map((s) => {
      const t = NODES.map(() => Infinity);
      t[s] = 0;
      for (let pass = 0; pass < NODES.length; pass++) {
        EDGES.forEach((e, i) => {
          const cross = DWELL + ew[i].len / SPEED;
          if (t[e[0]] + cross < t[e[1]]) t[e[1]] = t[e[0]] + cross;
          if (t[e[1]] + cross < t[e[0]]) t[e[0]] = t[e[1]] + cross;
        });
      }
      return t;
    });
    const SPANS = TIMES.map((t) => Math.max.apply(null, t) + DWELL + REST);

    let clock = 1.15;

    function step(dt) { clock += dt; }

    function draw() {
      let acc = clock, ci = 0;
      while (acc >= SPANS[ci]) { acc -= SPANS[ci]; ci = (ci + 1) % STARTS.length; }
      const t = acc, time = TIMES[ci];

      const flash = NODES.map((n, i) => {
        const age = (t - time[i]) / DWELL;
        return age >= 0 && age <= 1 ? Math.sin(Math.PI * age) : 0;
      });

      EDGES.forEach((e, i) => {
        const from = time[e[0]] <= time[e[1]] ? e[0] : e[1];
        const leave = time[from] + DWELL, cross = ew[i].len / SPEED, u = (t - leave) / cross;
        if (u > 0 && u < 1) moveBead(beads[i], from === e[0] ? ew[i].fwd : ew[i].rev, u);
        else beads[i].classList.remove('on');
      });

      NODES.forEach((n, i) => {
        rims[i].setAttribute('stroke-opacity', r4(flash[i]));
        rims[i].setAttribute('fill-opacity', r4(flash[i] * .12));
      });
    }

    function rest() {
      beads.forEach((b) => b.classList.remove('on'));
      rims.forEach((r) => { r.setAttribute('stroke-opacity', 0); r.setAttribute('fill-opacity', 0); });
    }

    draw();
    return { svg, step, draw, rest };
  }

  // -------------------------------------------------------------------------------------------- sentinel swarm
  function sentinelSwarm() {
    const svg = root('Sentinel Swarm: an org chart of an Oracle, Managers, Leads and Coders, with a few messages passing between agents.');
    const base = camera(POSE.yaw, POSE.pitch, SLAB_FOCAL);
    let cam = base;

    /* One plane and one size: every agent is the same cube, stood on a corner so a vertex points at the viewer, and
       then the whole plane takes the lean the IDE and The Index have. The long focal keeps perspective from making the
       far side of the plane smaller. Lines join at the cube's top and bottom vertices. */
    const H = 11;
    const corner = (c) => ((c[0] + 1) / 2) * 4 + ((c[1] + 1) / 2) * 2 + (c[2] + 1) / 2;
    const CORNERS = [];
    [-1, 1].forEach((x) => [-1, 1].forEach((y) => [-1, 1].forEach((z) => CORNERS.push(standOnCorner([x, y, z])))));
    const FACES = [];
    for (let k = 0; k < 3; k++) {
      [-1, 1].forEach((sign) => {
        const u = (k + 1) % 3, v = (k + 2) % 3;
        const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map((ab) => {
          const c = [0, 0, 0];
          c[k] = sign; c[u] = ab[0]; c[v] = ab[1];
          return corner(c);
        });
        const axis = [0, 0, 0];
        axis[k] = sign;
        if (standOnCorner(axis)[2] > 0) FACES.push(quad);
      });
    }
    const by = (key) => CORNERS.reduce((best, c, i) => (key(c) < key(CORNERS[best]) ? i : best), 0);
    const TOP = CORNERS[by((c) => c[1])], BOTTOM = CORNERS[by((c) => -c[1])], FAR = by((c) => c[2]);
    const LEFT = CORNERS[by((c) => c[0])], RIGHT = CORNERS[by((c) => -c[0])];
    const at = (n, c) => [n.x + c[0] * H, n.y + c[1] * H, c[2] * H];

    /* A balanced chart: one agent over two over four over eight, each row on a single line at an even spacing, and every
       parent centered over its two reports. Each row is [x, y, parent]. */
    const COLS = [-154, -110, -66, -22, 22, 66, 110, 154], ROWS = [-105, -35, 35, 105];
    const SPEC = [[0, ROWS[0], -1]];
    [[-88, 88], [-132, -44, 44, 132]].forEach((xs, k) => xs.forEach((x, n) => SPEC.push([x, ROWS[k + 1], k === 0 ? 0 : 1 + Math.floor(n / 2)])));
    COLS.forEach((x, n) => SPEC.push([x, ROWS[3], 3 + Math.floor(n / 2)]));
    const nodes = [];
    SPEC.forEach((row, i) => nodes.push({ x: row[0], y: row[1], tier: row[2] < 0 ? 0 : nodes[row[2]].tier + 1, glow: 0 }));
    const edges = [];
    SPEC.forEach((row, i) => {
      if (row[2] < 0) return;
      edges.push({ a: row[2], b: i, tier: nodes[row[2]].tier, p: at(nodes[row[2]], BOTTOM), q: at(nodes[i], TOP) });
    });
    /* Neighbors in a tier that have room between them are joined side to side, corner to corner. */
    for (let tier = 0; tier < 4; tier++) {
      const row = nodes.map((n, i) => i).filter((i) => nodes[i].tier === tier).sort((a, b) => nodes[a].x - nodes[b].x);
      for (let k = 0; k + 1 < row.length; k++) {
        if (nodes[row[k + 1]].x - nodes[row[k]].x < 44) continue;
        edges.push({ a: row[k], b: row[k + 1], tier, lateral: true, p: at(nodes[row[k]], RIGHT), q: at(nodes[row[k + 1]], LEFT) });
      }
    }
    cam = fitted(base, nodes.map((n) => [n.x, n.y, 0, 18, 19]));

    const wires = lines(svg, 'lm-line lm-wire');
    const backs = lines(svg, 'lm-line lm-faint');
    const glass = nodes.map(() => el('path', { class: 'lm-line lm-glass lm-snode' }, svg));
    const pulse = el('g', { class: 'lm-pulse' }, svg);
    const rims = nodes.map(() => el('path', { class: 'lm-rim' }, pulse));
    const beads = Array.from({ length: 4 }, () => newBead(svg));

    edges.forEach((e, i) => {
      const a = cam(e.p[0], e.p[1], e.p[2]), b = cam(e.q[0], e.q[1], e.q[2]);
      wires.seg(a, b);
      e.len = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const d = 'M' + r1(a[0]) + ' ' + r1(a[1]) + 'L' + r1(b[0]) + ' ' + r1(b[1]);
      e.fwd = d;
      e.rev = 'M' + r1(b[0]) + ' ' + r1(b[1]) + 'L' + r1(a[0]) + ' ' + r1(a[1]);
    });
    wires.flush();

    nodes.forEach((n, i) => {
      const pts = CORNERS.map((c) => { const w = at(n, c); return cam(w[0], w[1], w[2]); });
      const d = FACES.map((quad) => pathD(quad.map((k) => pts[k]))).join('');
      glass[i].setAttribute('d', d);
      rims[i].setAttribute('d', d);
      [FAR ^ 4, FAR ^ 2, FAR ^ 1].forEach((k) => backs.seg(pts[FAR], pts[k]));
    });
    backs.flush();

    /* A handful of messages wander the chart at one speed. When one reaches an agent that agent brightens and settles
       over DWELL as it reads it, and only then is the message sent on, by a link picked at random. */
    const DWELL = .45, SPEED = 75;
    const adj = nodes.map(() => []);
    edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });
    const rand = rng(413);
    const walkers = beads.map((bead) => ({
      bead, e: Math.floor(rand() * edges.length), dir: rand() < .5 ? 1 : -1, u: rand(), reading: false, node: 0, t: 0,
    }));

    function step(dt) {
      nodes.forEach((n) => { n.glow = 0; });
      walkers.forEach((w) => {
        const e = edges[w.e];
        if (!w.reading) {
          w.u += SPEED / e.len * dt;
          if (w.u < 1) return;
          w.reading = true;
          w.t = 0;
          w.node = w.dir > 0 ? e.b : e.a;
        } else {
          w.t += dt;
        }
        nodes[w.node].glow = Math.max(nodes[w.node].glow, Math.sin(Math.PI * Math.min(1, w.t / DWELL)));
        if (w.t < DWELL) return;
        const options = adj[w.node].filter((k) => k !== w.e);
        const next = options.length ? options[Math.floor(rand() * options.length)] : w.e;
        w.e = next;
        w.dir = edges[next].a === w.node ? 1 : -1;
        w.u = 0;
        w.reading = false;
      });
    }

    function draw() {
      nodes.forEach((n, i) => {
        rims[i].setAttribute('stroke-opacity', r4(n.glow));
        rims[i].setAttribute('fill-opacity', r4(n.glow * .12));
      });
      walkers.forEach((w) => {
        if (w.reading) w.bead.classList.remove('on');
        else moveBead(w.bead, w.dir > 0 ? edges[w.e].fwd : edges[w.e].rev, w.u);
      });
    }

    for (let i = 0; i < 40; i++) step(.1);
    function rest() {
      beads.forEach((b) => b.classList.remove('on'));
      rims.forEach((r) => { r.setAttribute('stroke-opacity', 0); r.setAttribute('fill-opacity', 0); });
    }

    draw();
    return { svg, step, draw, rest };
  }

  // ---------------------------------------------------------------------------------------------- the index
  function theIndex() {
    const svg = root('The Index: a dashboard slab with three bands, each a symbol beside an animating chart: a dollar sign by a cost line, up and down arrows by a usage gauge, and a git branch by activity bars.');
    const rand = rng(97);
    const cam = camera(POSE.yaw, POSE.pitch, SLAB_FOCAL);
    const X0 = -160, Y0 = -105, W = 320, H = 210, DEPTH = 18;
    const SX = X0 + 14, SY = Y0 + 38, SW = 292, SH = 50, SPITCH = 58, SZ = 8, CZ = 9;
    const CHART0 = 64, CHART1 = 282;

    const rear = lines(svg, 'lm-line lm-faint');
    const wall = lines(svg, 'lm-wall');
    const frame = lines(svg, 'lm-line lm-faint lm-glass');
    const inner = lines(svg, 'lm-line lm-faint');
    const strips = lines(svg, 'lm-line lm-glass lm-strip');
    const win = roundRect(X0, Y0, X0 + W, Y0 + H, 12);
    shell(win, cam, 0, -DEPTH, frame, rear);
    const wf = lift(cam, win.pts, 0), wb = lift(cam, win.pts, -DEPTH), half = 2 * (ARC + 1);
    wall.loop(wf.slice(0, half).concat(wb.slice(0, half).reverse()));
    wall.loop(wf.slice(half).concat(wb.slice(half).reverse()));
    rear.flush();
    wall.flush();
    frame.flush();
    [14, 26, 38].forEach((dx) => inner.loop(circle(cam, X0 + dx, Y0 + 14, 3, 0)));
    inner.seg(cam(X0, Y0 + 28, 0), cam(X0 + W, Y0 + 28, 0));
    inner.flush();
    for (let i = 0; i < 3; i++) strips.loop(lift(cam, roundRect(SX, SY + i * SPITCH, SX + SW, SY + i * SPITCH + SH, 6).pts, SZ));
    strips.flush();

    // A point on strip i, in the strip's own units.
    const at = (i, u, v) => cam(SX + u, SY + i * SPITCH + v, CZ);
    const ring = (i, u, v, r, n) => Array.from({ length: n }, (_, k) => at(i, u + Math.cos(k * 2 * Math.PI / n) * r, v + Math.sin(k * 2 * Math.PI / n) * r));
    const stroke = (i, pts) => pts.forEach((p, k) => { if (k) sym.seg(at(i, pts[k - 1][0], pts[k - 1][1]), at(i, p[0], p[1])); });

    const gauge = lines(svg, 'lm-line lm-faint');
    gauge.loop(rectPts(cam, SX + CHART0, SY + SPITCH + 16, SX + CHART1, SY + SPITCH + 30, CZ));
    [.25, .5, .75].forEach((f) => gauge.seg(at(1, CHART0 + (CHART1 - CHART0) * f, 30), at(1, CHART0 + (CHART1 - CHART0) * f, 34)));
    gauge.flush();

    // The three symbols are still: a dollar sign, up and down arrows, and a git branch.
    const sym = lines(svg, 'lm-line lm-sym');
    stroke(0, [[28, 11], [28, 39]]);
    stroke(0, [[34, 19.5], [31.5, 16.5], [27, 16], [23, 18], [22.5, 21.5], [25.5, 24.5], [30.5, 26.5], [33.5, 29.5], [33, 33], [29, 35.5], [24.5, 35], [22, 32]]);
    stroke(1, [[21, 35], [21, 15]]);
    stroke(1, [[16.5, 20], [21, 15], [25.5, 20]]);
    stroke(1, [[35, 15], [35, 35]]);
    stroke(1, [[30.5, 30], [35, 35], [39.5, 30]]);
    stroke(2, [[24, 15], [24, 36]]);
    stroke(2, [[34, 22], [34, 27], [31, 30.5], [24, 31.5]]);
    sym.loop(ring(2, 24, 13, 3, 10));
    sym.loop(ring(2, 24, 38, 3, 10));
    sym.loop(ring(2, 34, 19, 3, 10));
    sym.flush();

    // Animated: the three charts, and one bead that runs up the cost line and back down.
    const area = lines(svg, 'lm-tfill');
    const fill = lines(svg, 'lm-tfill');
    const hist = lines(svg, 'lm-line lm-tbars');
    const spark = lines(svg, 'lm-line lm-hotline');
    const bead = newBead(svg);

    const BARS = 16, PASS = 1.7;
    let tick = 0, travel = 0, cost = 4.82, pct = 38, shown = 38;
    const series = Array.from({ length: 28 }, (_, i) => 1.2 + i * .13);
    const target = Array.from({ length: BARS }, () => .2 + rand() * .8);
    const level = target.slice();

    function update() {
      cost += .03 + rand() * .09;
      series.push(cost);
      series.shift();
      pct += .35 + rand() * .3;
      if (pct > 96) pct = 38;
      for (let k = 0; k < 2; k++) target[Math.floor(rand() * BARS)] = .15 + rand() * .85;
    }

    function step(dt) {
      tick += dt;
      travel = (travel + dt) % (2 * PASS);
      while (tick >= .6) { tick -= .6; update(); }
      const k = Math.min(1, dt * 6);
      for (let i = 0; i < BARS; i++) level[i] += (target[i] - level[i]) * k;
      shown += (pct - shown) * Math.min(1, dt * 4);
    }

    function draw() {
      const lo = Math.min.apply(null, series), hi = Math.max.apply(null, series), span = Math.max(.01, hi - lo);
      const pts = series.map((v, i) => at(0, CHART0 + i * ((CHART1 - CHART0) / (series.length - 1)), 40 - ((v - lo) / span) * 30));
      pts.forEach((p, i) => { if (i) spark.seg(pts[i - 1], p); });
      area.loop(pts.concat([at(0, CHART1, 40), at(0, CHART0, 40)]));

      const line = (list) => list.map((p, i) => (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1])).join('');
      const up = travel < PASS;
      moveBead(bead, up ? line(pts) : line(pts.slice().reverse()), (up ? travel : travel - PASS) / PASS);

      fill.loop(rectPts(cam, SX + CHART0 + 1, SY + SPITCH + 17, SX + CHART0 + 1 + (CHART1 - CHART0 - 2) * shown / 100, SY + SPITCH + 29, CZ));
      const pitch = (CHART1 - CHART0 - 6) / BARS;
      for (let i = 0; i < BARS; i++) {
        const h = 6 + level[i] * 28, x = SX + CHART0 + 3 + i * pitch;
        hist.loop(rectPts(cam, x, SY + 2 * SPITCH + 42 - h, x + pitch * .62, SY + 2 * SPITCH + 42, CZ));
      }
      [area, spark, fill, hist].forEach((l) => l.flush());
    }

    for (let i = 0; i < 50; i++) step(.1);
    function rest() { bead.classList.remove('on'); }

    draw();
    return { svg, step, draw, rest };
  }

  window.AKLIB = { agentTabs, codebaseKG, sentinelSwarm, theIndex };
})();
