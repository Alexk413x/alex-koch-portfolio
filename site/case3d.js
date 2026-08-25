/* case3d.js — the game case as a projected wireframe.
 *
 * WHY NOT CSS 3D. The case was six CSS faces in a preserve-3d box, and every attempt to make its side follow the
 * front's rounded corners hit the same wall: a CSS face is a quad, and a quad cannot bend. The last version had
 * thirty-two flat panels fanned through the corners, which is a chamfer pretending to be a curve, and each one
 * carried its own border weight so no two lines on the object matched.
 *
 * HERE THE WHOLE OBJECT IS ONE PATH. The eight-ish corners of a rounded-rect prism are sampled, rotated and
 * divided by the same perspective CSS would have used, and the result is drawn as SVG. The corners are real
 * curves because they were sampled as curves; every line is 1.4 because every line is the same stroke on the
 * same element; and which edges are drawn is a decision rather than a side effect of what happens to face the
 * reader.
 *
 * THE PRINT IS STILL HTML, laid over the drawing in a CSS-3D box under the SAME perspective and the SAME two
 * angles — so it lines up by construction rather than by tuning. That is what keeps the title, the blurb and the
 * spine as real text: selectable, searchable, and wrapping the way text does. SVG text does none of those well.
 */
(function () {
  'use strict';

  /* SAMPLES PER QUARTER TURN. The corner is drawn as a polyline, so this is what decides whether it reads as an
     arc or as a bevel — at eight you can count the facets, and past about twenty the extra points are shorter
     than the stroke is wide. */
  const ARC = 18;
  const PERSP = 1400;      // px. The stylesheet's perspective for the print layer reads this same number.
  const STROKE = 1.4;      // one weight for every line on the object, which is the whole point of one path

  const NS = 'http://www.w3.org/2000/svg';

  /* The rounded-rect outline as a list of points, once. Both faces are this same outline at two depths, which is
     what guarantees the wall's two edges cannot disagree about the shape they are joining. */
  function outline(w, h, r, arc) {
    const pts = [];
    const x = w / 2 - r, y = h / 2 - r;
    // Corner centers in drawing order, each with the angle its quarter starts at.
    [[x, -y, -90], [x, y, 0], [-x, y, 90], [-x, -y, 180]].forEach((c) => {
      for (let i = 0; i <= arc; i++) {
        const a = (c[2] + (90 * i) / arc) * Math.PI / 180;
        pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
      }
    });
    return pts;
  }

  /* CSS's own projection, so the drawing and the print layer agree without either being tuned to the other.
     `transform: rotateY(a) rotateX(b)` applies rotateX FIRST — the rightmost function acts on the point first —
     and the perspective divide then happens about the origin. Getting that order backwards puts the drawing a
     few degrees off the text at every angle except zero, which reads as the print having come unstuck. */
  function project(p, yaw, pitch) {
    const a = yaw * Math.PI / 180, b = pitch * Math.PI / 180;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);

    let x = p[0], y = p[1], z = p[2];
    const y1 = y * cb - z * sb, z1 = y * sb + z * cb;   // rotateX
    const x2 = x * ca + z1 * sa, z2 = -x * sa + z1 * ca;  // rotateY

    const s = PERSP / (PERSP - z2);
    return [x2 * s, y1 * s, z2];
  }

  const d = (pts, open) =>
    'M' + pts.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L') + (open ? '' : 'Z');

  /* THE SEAM RUNS EVERYWHERE BUT THE SPINE, and it has to stop exactly where the two left corners end their
     curves — a clamshell's halves meet all the way round the free edges and are joined along the fold, so a ring
     that closes across the left draws a joint where the case does not have one.
     outline() lays its points down as four arcs in order from the top right, so the straight run between the
     third arc's end and the fourth's start IS the left edge. Reordering to begin at the fourth arc and leaving
     the path open is what cuts exactly that segment out and nothing else. */
  function openLeft(pts, arc) {
    const per = arc + 1;
    const tl = per * 3;              // index the top-left arc starts at
    return pts.slice(tl).concat(pts.slice(0, tl));
  }

  /* THE THUMB NOTCH, a pill lying in the plane of the opening edge. It is built in that plane's own two
     directions — down the case and through its depth — so it stays on the edge however the box is turned,
     rather than being a shape stuck to a face. */
  function notch(h, depth) {
    const half = h * .13, wide = depth * .3, r = Math.min(wide, half);
    const pts = [];
    const cap = (cy, from) => {
      for (let i = 0; i <= 10; i++) {
        const a = (from + (180 * i) / 10) * Math.PI / 180;
        pts.push([cy + Math.sin(a) * r, Math.cos(a) * wide]);
      }
    };
    cap(half - r, 0);
    cap(-(half - r), 180);
    return pts;
  }

  /* Builds the drawing once and returns a function that redraws it at an angle. Nothing here reads the DOM after
     setup: a drag calls draw() sixty times a second and it must not be measuring anything. */
  /* arc is the samples per quarter turn for THIS instance. The case on the stage is drawn at full detail; a
     blade in the rack is a fifth of its own width on screen and redraws on every frame of a move, so it takes
     the coarsest corner that still reads as a curve. Seventeen of them at the stage's sample count is about
     four thousand projections a frame, which is not a corner worth paying for at that size. */
  /* `simple` draws the rack's version of the case: the joint as its TOP and BOTTOM runs only, each ending where
     the corner starts to curve, and no thumb notch. A blade shows about twenty-four pixels of itself, and on
     that the notch and the joint's vertical runs are marks with no room to be read as anything — while the two
     horizontal runs are exactly what says the object is a case that opens. */
  function make(svg, arc, simple) {
    arc = arc || ARC;
    const g = document.createElementNS(NS, 'g');
    const el = (cls) => {
      const n = document.createElementNS(NS, 'path');
      n.setAttribute('class', cls);
      g.appendChild(n);
      return n;
    };
    /* Painted back to front, in the order the eye meets the surfaces: the far panel and its outline, the side
       walls turned AWAY (seen through the box), the near panel's glass, then the side walls turned TOWARD the
       reader — which nothing stands in front of — and finally the marks on the near face. */
    /* PAINT ORDER IS THE HIDDEN-LINE MODEL. An edge is as dark as the glass standing between it and the eye,
       and nothing else — so where the back outline has clear line of sight it comes out at exactly the front
       outline's value, and where the near panel covers it, it comes out one layer down.
       The back outline goes ABOVE both walls because the walls END on it: a side wall runs from the front plane
       to the back plane and terminates at that edge, so it is never in front of it. Under the walls it was being
       dimmed by surfaces that do not lie in its way, which flattened the whole line to one value.
       It goes BELOW the near panel's glass because that panel genuinely is in front of it — but only over the
       part of it that projects inside the panel. Outside, the path simply does not cover it, so the difference
       along the line falls out of the geometry rather than being drawn in. */
    /* The far panel carries its own class so a caller can weight it apart from the near one. Same path, same
       projection — it follows the outline because it IS the outline, at this yaw. */
    const farFace = el('c3-face c3-face-far');
    const wallAway = el('c3-wall c3-wall-away');
    const back = el('c3-edge c3-far');
    const face = el('c3-face');
    const wallToward = el('c3-wall c3-wall-toward');
    const seam = el('c3-seam');
    const notchP = el('c3-notch');
    const front = el('c3-edge');
    svg.appendChild(g);

    return function draw(w, h, depth, yaw, pitch) {
      const r = Math.min(w, h) * .05;
      const ring = outline(w, h, r, arc);
      svg.setAttribute('viewBox', [-w, -h, w * 2, h * 2].join(' '));

      /* THE TWO PLANES, AND THEN WHICH OF THEM IS ACTUALLY NEARER.
         plus/minus are fixed to the object: +depth/2 is the face the cover is printed on, whatever the angle.
         near/far are what the EYE sees, and past a quarter turn they are the other way round — which is the
         whole reason the case looked wrong from behind. With the roles nailed to the planes, the cover's own
         outline went on being drawn as "the back" after it had swung to the front, so turning the case around
         did not change which line was obscured. Everything below reads near/far and never plus/minus. */
      const plus = ring.map((q) => project([q[0], q[1], depth / 2], yaw, pitch));
      const minus = ring.map((q) => project([q[0], q[1], -depth / 2], yaw, pitch));
      const mid = ring.map((q) => project([q[0], q[1], 0], yaw, pitch));
      const flip = project([0, 0, depth / 2], yaw, pitch)[2] < project([0, 0, -depth / 2], yaw, pitch)[2];
      const near = flip ? minus : plus;
      const far = flip ? plus : minus;

      back.setAttribute('d', d(far));
      front.setAttribute('d', d(near));
      if (simple) {
        /* THE RUN CARRIES ON ROUND THE CORNER AND STOPS WHERE THE BENDING DOES.
           outline() lays four arcs down from the top right, so a run plus the corner at each of its ends is a
           whole number of arcs: the top is the top-left arc, the straight, and the top-right arc; the bottom is
           the bottom-right and bottom-left arcs, which are already adjacent. Each therefore begins and ends
           exactly where a VERTICAL straight would start — the joint reaches the end of the curve and no
           further, at any sample count.
           Cutting at the tangents instead left two flat dashes across a case whose corners are its whole
           character. */
        const per = arc + 1;
        seam.setAttribute('d', d(mid.slice(per * 3).concat(mid.slice(0, per)), true) + ' ' +
                               d(mid.slice(per, per * 3), true));
      } else {
        seam.setAttribute('d', d(openLeft(mid, arc), true));
      }

      // The notch sits in the opening edge's plane, at x = +w/2, and turns with everything else.
      notchP.setAttribute('d', simple ? '' : d(notch(h, depth).map(
        (q) => project([w / 2, q[0], q[1]], yaw, pitch)), false));
      /* THE SIDE IS BUILT AS SURFACES, one quad per segment of the outline.
       *
       * It used to be the even-odd difference of the two silhouettes — a 2D set operation over the whole
       * perimeter at once. That fills the right pixels and is not a surface: it cannot tell the spine from the
       * opening edge, cannot tell a wall turned toward the reader from one turned away, and so it painted every
       * rim at one value. The box came out with a back edge indistinguishable from its opening, and nothing on
       * it read as solid.
       *
       * Each segment of the ring now spans a real quad — near[i], near[i+1], far[i+1], far[i] — and the sign of
       * that quad's projected area says which way it faces. Front-facing quads are the rim you can see; the rest
       * are the far side of the tube, seen through the panels. Both groups are one path each, wound the same
       * way, so nonzero merges the quads into one continuous band around the corners with no seams between
       * them. */
      let toward = '', away = '';
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        /* Built from the OBJECT's planes, not the eye's. The facing test reads the quad's projected winding,
           which already flips when the box turns past a quarter — swapping the inputs as well would cancel it
           out and label every wall backwards beyond 90 degrees. */
        const quad = [plus[i], plus[j], minus[j], minus[i]];
        let area = 0;
        for (let k = 0; k < 4; k++) {
          const p1 = quad[k], p2 = quad[(k + 1) % 4];
          area += p1[0] * p2[1] - p2[0] * p1[1];
        }
        const seg = d(quad);
        /* NEGATIVE is toward the reader here: outline() lays its points down clockwise in a y-down coordinate
           system, which flips the sign of the projected area against the usual convention. Verified by measuring
           both rims at rest — with the test the other way the far rim came back carrying the lit value. */
        if (area < 0) toward += seg; else away += seg;
      }
      wallToward.setAttribute('d', toward);
      wallAway.setAttribute('d', away);
      /* BOTH PANELS ARE GLASS, and the overlap is where you are looking through two of them — so it comes out
         brighter than either the far panel alone or the rim beside it. That doubling is the whole depth cue on a
         page with no room to shade: filling only the near panel made the box read as one flat pane. */
      farFace.setAttribute('d', d(far));
      face.setAttribute('d', d(near));
    };
  }

  window.CASE3D = { make: make, PERSP: PERSP, STROKE: STROKE };
})();
