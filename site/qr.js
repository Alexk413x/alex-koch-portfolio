/* qr.js — a QR encoder: byte mode, error-correction levels M and H, versions 1 to 10.
 *
 * Written rather than pulled from a CDN because this site loads nothing at runtime but its own files and the
 * fonts, and a share code that fails when someone else's CDN is down is worse than no share code.
 *
 * Pure: takes a string, returns a square array of 0/1. It draws nothing and touches no DOM, so the same matrix
 * can go to a canvas, an SVG or a test without the encoder knowing which.
 */
(function () {
  'use strict';

  // GF(256) with the QR primitive polynomial 0x11d. EXP is doubled so a log sum never needs a modulo.
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  /* Two error-correction levels, versions 1..10 each. H recovers 30% of the symbol where M recovers 15%, which
     is what makes room for something drawn over the middle of the code; it costs capacity, so the same string
     lands two versions higher and the modules come out smaller.
       capacity  data codewords
       blocks    [ec codewords per block, group1 blocks, group1 data, group2 blocks, group2 data]
       format    pre-computed BCH format strings, one per mask, already XORed with 0x5412 */
  const LEVELS = {
    M: {
      capacity: [16, 28, 44, 64, 86, 108, 124, 154, 182, 216],
      blocks: [
        [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
        [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
      ],
      format: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
    },
    H: {
      capacity: [9, 16, 26, 36, 46, 60, 66, 86, 100, 122],
      blocks: [
        [17, 1, 9, 0, 0], [28, 1, 16, 0, 0], [22, 2, 13, 0, 0], [16, 4, 9, 0, 0], [22, 2, 11, 2, 12],
        [28, 4, 15, 0, 0], [26, 4, 13, 1, 14], [26, 4, 14, 2, 15], [24, 4, 12, 4, 13], [28, 6, 15, 2, 16],
      ],
      format: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b],
    },
  };
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  // Version information, versions 7..10. Below version 7 the field does not exist.
  const VERSION_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };

  // Builds the generator polynomial for n error-correction codewords, highest degree first.
  function genPoly(n) {
    let p = [1];
    for (let i = 0; i < n; i++) {
      const q = new Array(p.length + 1).fill(0);
      for (let j = 0; j < p.length; j++) { q[j] ^= p[j]; q[j + 1] ^= mul(p[j], EXP[i]); }
      p = q;
    }
    return p;
  }

  // Reed-Solomon remainder of one block: polynomial long division over GF(256).
  function ecc(data, n) {
    const g = genPoly(n), r = new Uint8Array(data.length + n);
    r.set(data);
    for (let i = 0; i < data.length; i++) {
      const f = r[i];
      if (!f) continue;
      for (let j = 0; j < g.length; j++) r[i + j] ^= mul(g[j], f);
    }
    return Array.from(r.subarray(data.length));
  }

  /* Byte-mode bitstream: mode nibble, character count, the bytes, a terminator, then the alternating pad
     codewords the spec names. The count field widens from 8 to 16 bits at version 10, which is why the version
     has to be chosen before the stream is built and not after. */
  function bitstream(bytes, version, capacity) {
    const bits = [];
    const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };

    push(0b0100, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) push(b, 8);

    const total = capacity * 8;
    for (let i = 0; i < 4 && bits.length < total; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);

    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      words.push(v);
    }
    for (let i = 0; words.length < capacity; i++) words.push(i % 2 ? 0x11 : 0xec);
    return words;
  }

  /* Splits the data into blocks, computes each block's EC, then reads the blocks column-wise. The interleave is
     the whole point of blocking: a scratch across the printed code damages one codeword in each block rather
     than destroying one block outright, and every block can then still be corrected. */
  function interleave(words, version, table) {
    const [ecLen, n1, d1, n2, d2] = table[version - 1];
    const blocks = [], eccs = [];
    let at = 0;
    for (let i = 0; i < n1 + n2; i++) {
      const len = i < n1 ? d1 : d2;
      const block = words.slice(at, at + len);
      at += len;
      blocks.push(block);
      eccs.push(ecc(block, ecLen));
    }
    const out = [];
    for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecLen; i++) for (const e of eccs) out.push(e[i]);
    return out;
  }

  // The fixed patterns, plus the reserved format and version areas. `fn` marks every module data must skip.
  function skeleton(version) {
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
    const fn = Array.from({ length: size }, () => new Uint8Array(size));
    const set = (r, c, v) => { m[r][c] = v; fn[r][c] = 1; };

    const finder = (r0, c0) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const r1 = r0 + r, c1 = c0 + c;
        if (r1 < 0 || c1 < 0 || r1 >= size || c1 >= size) continue;
        const on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(r1, c1, on ? 1 : 0);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 ? 0 : 1); set(i, 6, i % 2 ? 0 : 1); }

    const centers = ALIGN[version - 1];
    for (const r of centers) for (const c of centers) {
      // The three corners already carry finders; an alignment pattern there would overwrite them.
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++)
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
    }

    /* The second format copy is 8 modules along row 8 but only SEVEN up column 8: the eighth cell below the
       top-right run is the always-dark module, which is not format data. Reserving eight here (and writing
       eight in applyFormat) buries the dark module under a format bit and the symbol stops decoding. */
    for (let i = 0; i < 9; i++) { if (m[8][i] === -1) set(8, i, 0); if (m[i][8] === -1) set(i, 8, 0); }
    for (let i = 0; i < 8; i++) set(8, size - 1 - i, 0);
    for (let i = 0; i < 7; i++) set(size - 1 - i, 8, 0);
    set(size - 8, 8, 1);   // the always-dark module, claimed after the reservation above

    if (version >= 7) {
      const v = VERSION_INFO[version];
      for (let i = 0; i < 18; i++) {
        const bit = (v >> i) & 1, r = Math.floor(i / 3), c = i % 3;
        set(size - 11 + c, r, bit); set(r, size - 11 + c, bit);
      }
    }
    return { m, fn, size };
  }

  // Two-module-wide zigzag from the bottom right. Column 6 is the vertical timing line and is stepped over.
  function place(m, fn, size, bytes) {
    let i = 0, up = true;
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;
      for (let k = 0; k < size; k++) {
        const r = up ? size - 1 - k : k;
        for (let c = right; c > right - 2; c--) {
          if (fn[r][c]) continue;
          const bit = i < bytes.length * 8 ? (bytes[i >> 3] >> (7 - (i & 7))) & 1 : 0;
          m[r][c] = bit; i++;
        }
      }
      up = !up;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  /* The four penalty rules from the spec. The mask that scores lowest is the one that ships — the goal is a
     matrix with no long same-color runs and nothing that resembles a finder pattern, both of which would make
     a scanner mis-locate the code. */
  function penalty(m, size) {
    let score = 0, dark = 0;

    for (let i = 0; i < size; i++) {
      for (const line of [m[i], m.map((row) => row[i])]) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          if (line[j] === line[j - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; }
          else run = 1;
        }
        for (let j = 0; j <= size - 11; j++) {
          const w = line.slice(j, j + 11).join('');
          if (w === '10111010000' || w === '00001011101') score += 40;
        }
      }
    }

    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }

    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  /* The 15 format bits are written MOST significant first: bit 14 lands at (8,0), bit 0 at (0,8). Writing them
     LSB-first mirrors the string, the decoder's BCH check fails, and it cannot recover which mask was used —
     so the symbol renders perfectly and scans as nothing at all. */
  function applyFormat(m, size, mask, format) {
    const f = format[mask];
    for (let i = 0; i < 15; i++) {
      const bit = (f >> (14 - i)) & 1;
      if (i < 6) m[8][i] = bit;
      else if (i < 8) m[8][i + 1] = bit;
      else if (i === 8) m[7][8] = bit;
      else m[14 - i][8] = bit;

      if (i < 7) m[size - 1 - i][8] = bit;
      else m[8][size - 15 + i] = bit;
    }
  }

  /* Encodes `text` at error-correction level `level` ('M' or 'H', default M) and returns
     { size, version, level, modules } where modules is a size x size array of 0/1, quiet zone NOT included —
     the caller decides the margin because it depends on how the code is being drawn. Throws if the text is
     longer than a version-10 code at that level can carry. */
  function encode(text, level) {
    const name = LEVELS[level] ? level : 'M';
    const { capacity, blocks, format } = LEVELS[name];
    const bytes = Array.from(new TextEncoder().encode(text));
    let version = 0;
    for (let v = 1; v <= 10; v++) {
      const header = 4 + (v < 10 ? 8 : 16);
      if (bytes.length * 8 + header <= capacity[v - 1] * 8) { version = v; break; }
    }
    if (!version) throw new Error('qr: ' + bytes.length + ' bytes exceeds a version-10 level-' + name + ' code');

    const stream = interleave(bitstream(bytes, version, capacity[version - 1]), version, blocks);
    const { m, fn, size } = skeleton(version);
    place(m, fn, size, stream);

    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const trial = m.map((row) => Array.from(row));
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
        if (!fn[r][c] && MASKS[mask](r, c)) trial[r][c] ^= 1;
      applyFormat(trial, size, mask, format);
      const s = penalty(trial, size);
      if (!best || s < best.score) best = { score: s, modules: trial };
    }
    return { size, version, level: name, modules: best.modules };
  }

  window.AKQR = { encode };
})();
