/* crt/crt-glow.js — the phosphor glow, shaped to the content's AREA.
 *
 * Where the light comes from: the region content occupies, not the content itself. A glow traced from the glyphs is an
 * outline, and an outline reads as a sticker rather than as light -- you see the shape twice. Real phosphor bleed is a
 * neighbourhood effect: the excited region is much larger and much vaguer than the thing that excited it.
 *
 * THIS REPLACED A CELL GRID. The first version divided the picture into 7x5 dimming zones and emitted a blob per lit
 * cell, on the theory that quantising would throw the shape away. It did -- but it replaced the shape with a different
 * one, and the cell lattice was visible as a row of soft dots however much they overlapped or however hard the caller
 * blurred them. Quantising to a grid trades a shape you recognise for a shape you don't want, which is not a trade.
 *
 * What is here instead: content is merged into CLUSTERS, and each cluster emits one ellipse sized to that cluster's own
 * width and height. One block of text is one smooth glow the shape of the block. Text in four corners is four glows.
 * Nothing is quantised, so there is no lattice to see, and the falloff is continuous by construction rather than by
 * being blurred until the seams stop showing.
 *
 * Pure: no DOM, no component state. The caller measures and supplies rectangles in picture-local pixels.
 */

/* Merge rectangles into clusters: anything within `gap` px of an existing cluster joins it and grows its box.
 *
 *   o = { rects, gap }     rects are { x, y, w, h } in picture-local px
 *
 * Returns [{ x, y, w, h }] -- one bounding box per group of nearby content.
 *
 * Iterated to a fixed point rather than done in one pass, because merging two clusters can bring a third within reach
 * of the result. One pass leaves a block of text as two or three overlapping glows depending on the order the lines
 * happen to be measured in, which is a difference you can see and cannot explain.
 *
 * The gap is what decides "nearby", and it wants to be generous -- the lines of a paragraph are one lit region, not
 * one per line. The caller passes a fraction of the picture rather than a constant, so it scales with the tube.
 */
export function clustersFrom(o) {
  const gap = o.gap == null ? 40 : o.gap;
  let boxes = (o.rects || []).filter((r) => r.w > 0 && r.h > 0)
    .map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  if (!boxes.length) return [];
  const near = (a, b) => (a.x - gap < b.x + b.w) && (b.x - gap < a.x + a.w)
                      && (a.y - gap < b.y + b.h) && (b.y - gap < a.y + a.h);
  const union = (a, b) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (!near(boxes[i], boxes[j])) continue;
        boxes[i] = union(boxes[i], boxes[j]);
        boxes.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return boxes;
}

/* The clusters as ELEMENTS: one rounded box per cluster, for the caller to drop into the glow layer.
 *
 *   o = { clusters, rgb, gain, pad, radius }
 *
 * WHY NOT A GRADIENT. This was radial-gradient ellipses, and an ellipse is the wrong shape for a block of text: it
 * pinches in at the corners of the region it is lighting, so a paragraph glows as a lens rather than as a lit panel.
 * CSS gradients cannot describe a rounded rectangle at all -- there is no such shape in the grammar -- so a boxy glow
 * has to be an element with a border-radius. That is the entire reason this returns markup instead of a background.
 *
 * The boxes are painted SOLID and hard-edged here. All of the falloff comes from the blur the caller puts on the
 * container, which is what makes the edge one continuous ramp rather than a gradient's stop list -- and it means the
 * softness is one number the caller owns, rather than being baked into every box.
 *
 * The radius is a fraction of the SHORTER side, so a wide line of text keeps square-ish ends and a small square patch
 * goes nearly circular. A constant radius looks wrong at both extremes.
 */
export function glowBoxes(o) {
  const clusters = o.clusters || [];
  if (!clusters.length) return '';
  const rgb = o.rgb || '255,150,60';
  const a = Math.max(0, Math.min(1, o.gain == null ? 0.5 : o.gain));
  const pad = o.pad == null ? 40 : o.pad;
  const rf = o.radius == null ? 0.4 : o.radius;
  if (a <= 0.002) return '';
  const parts = [];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const x = c.x - pad, y = c.y - pad, w = c.w + pad * 2, h = c.h + pad * 2;
    const r = Math.min(w, h) * rf;
    parts.push('<div style="position:absolute;left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1)
      + 'px;width:' + w.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;border-radius:' + r.toFixed(1)
      + 'px;background:rgba(' + rgb + ',' + a.toFixed(3) + ')"></div>');
  }
  return parts.join('');
}
