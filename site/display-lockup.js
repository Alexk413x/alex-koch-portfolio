/* Optical ink-edge alignment for static display lockups.
     <h1 data-display-stack><span>ALEX</span><span>KOCH</span></h1>
   Add data-display-ragged to keep a ragged right (left edges still align).

   Copied from the design system's assets/display-lockup.js so the site stands alone; that copy is the spec.

   The lines are NEVER split into per-character elements: each line stays a single text node, so a word is still a
   word when you select, copy, search or read it aloud. Matching the lines' widths is done the way a typesetter
   would — by tracking the line (CSS letter-spacing) — not by pushing glyphs around individually. Word spaces
   therefore stay real spaces at their natural width. */
(function () {
  var ctx;

  /* Ink metrics for a line, in its CURRENT tracking. Canvas has no notion of letter-spacing, so the
     tracking contribution (one gap per interior character) is added back by hand. */
  function measure(el) {
    ctx = ctx || document.createElement('canvas').getContext('2d');
    var cs = getComputedStyle(el);
    ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
    var text = el.dataset.dsWord || el.textContent;
    var m = ctx.measureText(text);
    var ls = parseFloat(cs.letterSpacing) || 0;
    var gaps = Math.max(text.length - 1, 0);
    var r = el.getBoundingClientRect();
    return {
      ls: ls,
      gaps: gaps,
      width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight + ls * gaps,
      left: r.left - m.actualBoundingBoxLeft
    };
  }

  function align(root) {
    var justify = !root.hasAttribute('data-display-ragged');
    var lines = [].slice.call(root.children).filter(function (el) {
      return (el.tagName === 'SPAN' || el.tagName === 'DIV') && (el.textContent || '').trim().length;
    });
    if (!lines.length) return;

    lines.forEach(function (l) {
      if (!l.dataset.dsWord) l.dataset.dsWord = l.textContent;
      /* Restore the line to ONE text node. Guarantees a word stays a word even if an earlier build
         (or a cached copy of it) had already exploded this line into per-character spans. */
      if (l.children.length) l.textContent = l.dataset.dsWord;
      l.style.display = 'block';
      l.style.width = 'max-content';
      l.style.whiteSpace = 'nowrap';
      l.style.transform = 'none';
      /* Back to the AUTHORED tracking before measuring, the same discipline fill() keeps with dsFs. The
         correction below is a delta on the tracking it reads, so measuring the previous pass's output makes
         every run build on the last: the lines still match each other, but the pair keeps widening. A resize
         from 430 back to 1600 grew this lockup 21px and it never recovered. Cleared rather than cached,
         because the authored value is itself viewport-dependent. */
      l.style.letterSpacing = '';
      l.style.marginRight = '';
    });

    if (justify) {
      var m0 = lines.map(measure);
      var target = Math.max.apply(null, m0.map(function (m) { return m.width; }));
      lines.forEach(function (l, i) {
        var m = m0[i];
        if (!m.gaps) return;
        var ls = m.ls + (target - m.width) / m.gaps;
        l.style.letterSpacing = ls.toFixed(4) + 'px';
        /* Tracking is added after the LAST glyph too, so the box would end short of (or past) the ink.
           Cancel exactly that much and the final letter's corner is never trimmed. */
        l.style.marginRight = (-ls).toFixed(4) + 'px';
      });
    }

    var now = lines.map(function (l) { return measure(l).left; });
    var base = Math.min.apply(null, now);
    lines.forEach(function (l, i) {
      l.style.transform = 'translateX(' + (base - now[i]).toFixed(2) + 'px)';
    });

    fill(root, lines, base);
  }

  /* A MULTI-WORD line (a job title, a tagline) doesn't need letter tracking — it can be fitted on its
     real word spaces alone. text-align-last:justify can only ADD space, so it fails whenever the text
     is naturally WIDER than the target. Driving word-spacing directly corrects in both directions.
     Mark it with data-display-fill="<selector>" on the lockup, or data-display-fill on a sibling. */
  function fill(root, lines, inkLeft) {
    var sel = root.getAttribute('data-display-fill');
    var el = sel ? document.querySelector(sel)
      : (root.parentElement && root.parentElement.querySelector('[data-display-fill]'));
    if (!el) return;
    var target = Math.max.apply(null, lines.map(function (l) {
      var m = measure(l);
      return m.left + m.width;
    })) - inkLeft;

    el.style.whiteSpace = 'nowrap';
    el.style.width = 'max-content';
    el.style.textAlign = 'left';
    el.style.textAlignLast = 'auto';
    /* align() runs several times (mount, fonts.ready, resize, DOM changes). Every value this function
       writes must be recomputed from the AUTHORED baseline, never from the last pass's output, or the
       size shrinks and the margin drifts a little further on each run. */
    if (!el.dataset.dsFs) el.dataset.dsFs = getComputedStyle(el).fontSize;
    el.style.fontSize = el.dataset.dsFs;
    el.style.wordSpacing = '0px';
    el.style.marginLeft = '0px';

    var text = (el.textContent || '').trim();
    var spaces = (text.match(/ /g) || []).length;
    if (spaces) {
      /* Fit by SIZE first. Squeezing word spaces to claw back an over-wide line is what made the title
         read as one run-on word; the size is the free variable, the spaces are not. So shrink the type
         until it fits, then let word-spacing take up only the small residual (or open a short line out). */
      var nat = measure(el).width;
      if (nat > target) {
        var fs = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = (fs * target / nat).toFixed(3) + 'px';
        nat = measure(el).width;
      }
      el.style.wordSpacing = ((target - nat) / spaces).toFixed(4) + 'px';
    }
    /* margin, not transform — the element usually carries an entrance animation, and a CSS animation
       overrides an inline transform, which would silently undo the alignment when it finishes. */
    el.style.marginLeft = (inkLeft - measure(el).left).toFixed(2) + 'px';
  }

  function runAll() {
    [].forEach.call(document.querySelectorAll('[data-display-stack]'), align);
  }

  window.akDisplayAlign = align;
  window.akDisplayAlignAll = runAll;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runAll);
  else runAll();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(runAll);

  window.addEventListener('resize', function () {
    clearTimeout(runAll._t);
    runAll._t = setTimeout(runAll, 120);
  });
})();
