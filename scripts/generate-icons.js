// Generates PNG icons for PWA — no dependencies, pure Node.js + zlib
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length, 0);
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(Buffer.concat([t, d])), 0);
  return Buffer.concat([len, t, d, crcVal]);
}

function generatePNG(size) {
  const px = [];
  const b1 = Math.round(size * 0.09);   // outer border inset
  const b2 = Math.round(size * 0.135);  // inner border inset
  // Inner mark: two horizontal cyan bars (stylised "SF")
  const markL = Math.round(size * 0.28);
  const markR = Math.round(size * 0.72);
  const bar1T = Math.round(size * 0.30); const bar1B = Math.round(size * 0.44);
  const bar2T = Math.round(size * 0.52); const bar2B = Math.round(size * 0.66);

  for (let y = 0; y < size; y++) {
    px.push(0); // PNG filter byte: None
    for (let x = 0; x < size; x++) {
      const inOuter = x >= b1 && x < size - b1 && y >= b1 && y < size - b1;
      const inInner = x >= b2 && x < size - b2 && y >= b2 && y < size - b2;
      const inBar1  = x >= markL && x < markR && y >= bar1T && y < bar1B;
      const inBar2  = x >= markL && x < markR && y >= bar2T && y < bar2B;
      const isBorder = inOuter && !inInner;
      const isMark   = inInner && (inBar1 || inBar2);

      if (isBorder || isMark) {
        px.push(0, 212, 255, 255); // cyan #00d4ff
      } else {
        px.push(4, 13, 18, 255);   // near-black #040d12
      }
    }
  }

  const raw        = Buffer.from(px);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [180, 192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, generatePNG(size));
  console.log(`Generated ${file}`);
}
