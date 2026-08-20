// Renders a QR PNG for verification purposes: node tools/qr-png.js "<text>" out.png [ecc]
const zlib = require('node:zlib');
const fs = require('node:fs');
const QR = require('../lib/qr.js');

function png(matrix, scale, quiet) {
  const n = matrix.length;
  const size = (n + quiet * 2) * scale;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const i = Math.floor(y / scale) - quiet;
      const j = Math.floor(x / scale) - quiet;
      const dark = i >= 0 && j >= 0 && i < n && j < n && matrix[i][j];
      const v = dark ? 0 : 255;
      raw[p++] = v; raw[p++] = v; raw[p++] = v;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let TAB = null;
function crc32(buf) {
  if (!TAB) { TAB = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TAB[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (const b of buf) c = TAB[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const [, , text, out, ecc] = process.argv;
fs.writeFileSync(out, png(QR.encode(text, { ecc: ecc || 'M' }), 8, 4));
console.log('wrote', out);
