/*
 * Minimal QR Code encoder (byte mode, versions 1-10, ECC levels L and M).
 * Zero dependencies. Works both in Node (require) and in the browser (window.QR).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- GF(256)
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], 1);
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const res = new Array(ecLen).fill(0);
    for (const byte of data) {
      const factor = byte ^ res[0];
      res.shift();
      res.push(0);
      for (let i = 0; i < ecLen; i++) res[i] ^= gmul(gen[i + 1], factor);
    }
    return res;
  }

  // ------------------------------------------------------------ spec tables
  // [totalCodewords, ecPerBlock, blocks1, data1, blocks2, data2]
  const SPEC = {
    L: {
      1: [26, 7, 1, 19, 0, 0],
      2: [44, 10, 1, 34, 0, 0],
      3: [70, 15, 1, 55, 0, 0],
      4: [100, 20, 1, 80, 0, 0],
      5: [134, 26, 1, 108, 0, 0],
      6: [172, 18, 2, 68, 0, 0],
      7: [196, 20, 2, 78, 0, 0],
      8: [242, 24, 2, 97, 0, 0],
      9: [292, 30, 2, 116, 0, 0],
      10: [346, 18, 2, 68, 2, 69],
    },
    M: {
      1: [26, 10, 1, 16, 0, 0],
      2: [44, 16, 1, 28, 0, 0],
      3: [70, 26, 1, 44, 0, 0],
      4: [100, 18, 2, 32, 0, 0],
      5: [134, 24, 2, 43, 0, 0],
      6: [172, 16, 4, 27, 0, 0],
      7: [196, 18, 4, 31, 0, 0],
      8: [242, 22, 2, 38, 2, 39],
      9: [292, 22, 3, 36, 2, 37],
      10: [346, 26, 4, 43, 1, 44],
    },
  };

  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  const ECC_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

  const dataCapacity = (v, ecc) => {
    const [, ec, b1, d1, b2, d2] = SPEC[ecc][v];
    return b1 * d1 + b2 * d2;
  };

  // -------------------------------------------------------------- bitstream
  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.put = function (value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  // ----------------------------------------------------------------- encode
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    return Array.from(Buffer.from(str, 'utf8'));
  }

  function buildCodewords(text, version, ecc) {
    const bytes = utf8Bytes(text);
    const buf = new BitBuffer();
    buf.put(0b0100, 4);                       // byte mode
    buf.put(bytes.length, version <= 9 ? 8 : 16);
    for (const b of bytes) buf.put(b, 8);

    const capacityBits = dataCapacity(version, ecc) * 8;
    const terminator = Math.min(4, capacityBits - buf.bits.length);
    buf.put(0, terminator);
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);

    const data = [];
    for (let i = 0; i < buf.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j];
      data.push(byte);
    }
    const pads = [0xec, 0x11];
    let p = 0;
    while (data.length < dataCapacity(version, ecc)) data.push(pads[p++ % 2]);

    // split into blocks, compute EC, interleave
    const [, ecLen, b1, d1, b2, d2] = SPEC[ecc][version];
    const blocks = [];
    let offset = 0;
    for (let i = 0; i < b1; i++) { blocks.push(data.slice(offset, offset + d1)); offset += d1; }
    for (let i = 0; i < b2; i++) { blocks.push(data.slice(offset, offset + d2)); offset += d2; }
    const ecBlocks = blocks.map((b) => rsEncode(b, ecLen));

    const out = [];
    const maxData = Math.max(d1, d2);
    for (let i = 0; i < maxData; i++)
      for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecLen; i++)
      for (const b of ecBlocks) out.push(b[i]);
    return out;
  }

  // ----------------------------------------------------------------- matrix
  function newMatrix(size) {
    const m = [];
    for (let i = 0; i < size; i++) m.push(new Array(size).fill(null));
    return m;
  }

  function placeFunctionPatterns(m, version) {
    const size = m.length;
    const finder = (r, c) => {
      for (let i = -1; i <= 7; i++)
        for (let j = -1; j <= 7; j++) {
          const rr = r + i, cc = c + j;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          const inRing = i >= 0 && i <= 6 && j >= 0 && j <= 6 &&
            (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
          m[rr][cc] = inRing ? 1 : 0;
        }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {
      const bit = i % 2 === 0 ? 1 : 0;
      m[6][i] = bit;
      m[i][6] = bit;
    }

    const centers = ALIGN[version];
    for (const r of centers)
      for (const c of centers) {
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (let i = -2; i <= 2; i++)
          for (let j = -2; j <= 2; j++)
            m[r + i][c + j] = (Math.abs(i) === 2 || Math.abs(j) === 2 || (i === 0 && j === 0)) ? 1 : 0;
      }

    m[size - 8][8] = 1; // dark module

    // reserve format areas
    for (let i = 0; i < 9; i++) {
      if (m[8][i] === null) m[8][i] = 0;
      if (m[i][8] === null) m[i][8] = 0;
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0;
    }

    if (version >= 7) {
      let rem = version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = (bits >>> i) & 1;
        m[Math.floor(i / 3)][size - 11 + (i % 3)] = bit;
        m[size - 11 + (i % 3)][Math.floor(i / 3)] = bit;
      }
    }
  }

  function reservedMask(version, size) {
    const m = newMatrix(size);
    placeFunctionPatterns(m, version);
    return m.map((row) => row.map((v) => v !== null));
  }

  function placeData(m, reserved, codewords) {
    const size = m.length;
    let bitIndex = 0;
    const total = codewords.length * 8;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // skip vertical timing column
      for (let n = 0; n < size; n++) {
        const row = upward ? size - 1 - n : n;
        for (let k = 0; k < 2; k++) {
          const c = col - k;
          if (reserved[row][c]) continue;
          let bit = 0;
          if (bitIndex < total) {
            bit = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
            bitIndex++;
          }
          m[row][c] = bit;
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (i, j) => (i + j) % 2 === 0,
    (i) => i % 2 === 0,
    (i, j) => j % 3 === 0,
    (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
    (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
    (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
    (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
  ];

  function applyMask(m, reserved, maskId) {
    const size = m.length;
    const out = m.map((row) => row.slice());
    for (let i = 0; i < size; i++)
      for (let j = 0; j < size; j++)
        if (!reserved[i][j] && MASKS[maskId](i, j)) out[i][j] ^= 1;
    return out;
  }

  function placeFormat(m, ecc, maskId) {
    const size = m.length;
    const data = (ECC_BITS[ecc] << 3) | maskId;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    // Bit 14 (MSB) is the module at (8,0); verified against a reference decoder.
    const get = (i) => (bits >>> (14 - i)) & 1;

    for (let i = 0; i <= 5; i++) m[8][i] = get(i);
    m[8][7] = get(6);
    m[8][8] = get(7);
    m[7][8] = get(8);
    for (let i = 9; i <= 14; i++) m[14 - i][8] = get(i);

    for (let i = 0; i <= 7; i++) m[size - 1 - i][8] = get(i);
    for (let i = 8; i <= 14; i++) m[8][size - 15 + i] = get(i);
    m[size - 8][8] = 1;
  }

  function penalty(m) {
    const size = m.length;
    let score = 0;

    const runScore = (line) => {
      let s = 0, run = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) s += 3 + (run - 5);
      return s;
    };
    for (let i = 0; i < size; i++) {
      score += runScore(m[i]);
      score += runScore(m.map((r) => r[i]));
    }

    for (let i = 0; i < size - 1; i++)
      for (let j = 0; j < size - 1; j++) {
        const v = m[i][j];
        if (v === m[i][j + 1] && v === m[i + 1][j] && v === m[i + 1][j + 1]) score += 3;
      }

    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matches = (line, start, pat) => {
      for (let k = 0; k < pat.length; k++) if (line[start + k] !== pat[k]) return false;
      return true;
    };
    for (let i = 0; i < size; i++) {
      const row = m[i];
      const col = m.map((r) => r[i]);
      for (let j = 0; j + 11 <= size; j++) {
        if (matches(row, j, pat1) || matches(row, j, pat2)) score += 40;
        if (matches(col, j, pat1) || matches(col, j, pat2)) score += 40;
      }
    }

    let dark = 0;
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) dark += m[i][j];
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /** Returns a 2D array of 0/1 modules (no quiet zone). */
  function encode(text, options) {
    const opts = options || {};
    const ecc = opts.ecc || 'M';
    let version = opts.version || 0;
    if (!version) {
      for (let v = 1; v <= 10; v++) {
        const headerBits = 4 + (v <= 9 ? 8 : 16);
        if (utf8Bytes(text).length * 8 + headerBits <= dataCapacity(v, ecc) * 8) { version = v; break; }
      }
      if (!version) throw new Error('QR: payload too long for versions 1-10');
    }

    const size = version * 4 + 17;
    const codewords = buildCodewords(text, version, ecc);
    const reserved = reservedMask(version, size);

    const base = newMatrix(size);
    placeFunctionPatterns(base, version);
    placeData(base, reserved, codewords);

    let best = null, bestScore = Infinity;
    const candidates = opts.mask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [opts.mask];
    for (const mask of candidates) {
      const cand = applyMask(base, reserved, mask);
      placeFormat(cand, ecc, mask);
      const s = penalty(cand);
      if (s < bestScore) { bestScore = s; best = cand; }
    }
    return best;
  }

  /** Renders the QR as an SVG string. */
  function toSVG(text, options) {
    const opts = options || {};
    const modules = encode(text, opts);
    const quiet = opts.quiet == null ? 4 : opts.quiet;
    const n = modules.length;
    const total = n + quiet * 2;
    let path = '';
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (modules[i][j]) path += 'M' + (j + quiet) + ' ' + (i + quiet) + 'h1v1h-1z';
    const fg = opts.color || '#000';
    const bg = opts.background || '#fff';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
      '" shape-rendering="crispEdges"><rect width="' + total + '" height="' + total +
      '" fill="' + bg + '"/><path d="' + path + '" fill="' + fg + '"/></svg>';
  }

  return { encode, toSVG };
});
