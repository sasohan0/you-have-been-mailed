/**
 * Icon Generator for "You Have Been Mailed"
 * Pure Node.js script using built-in zlib module to produce valid PNG files
 * without external dependencies.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const chunkType = Buffer.from(type, 'ascii');
  const body = Buffer.concat([chunkType, data]);

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([len, body, crcBuf]);
}

function createPng(size, primaryColor, accentColor) {
  const width = size;
  const height = size;

  // Raw RGBA scanlines with filter byte 0 at start of each line
  const rawBytes = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;

  const [pr, pg, pb] = primaryColor;
  const [ar, ag, ab] = accentColor;

  for (let y = 0; y < height; y++) {
    rawBytes[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      // Draw rounded card background with mail envelope / checkmark pattern
      const cx = x / width;
      const cy = y / height;

      // Rounded rect border radius
      const r = 0.15;
      const dx = Math.max(Math.abs(cx - 0.5) - (0.5 - r), 0);
      const dy = Math.max(Math.abs(cy - 0.5) - (0.5 - r), 0);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > r) {
        // Transparent outside
        rawBytes[offset++] = 0;
        rawBytes[offset++] = 0;
        rawBytes[offset++] = 0;
        rawBytes[offset++] = 0;
        continue;
      }

      // Checkmark pattern in center
      let isCheck = false;
      const t1 = (cx - 0.28) / (0.44 - 0.28);
      if (t1 >= 0 && t1 <= 1) {
        const expectedY = 0.50 + t1 * 0.20;
        if (Math.abs(cy - expectedY) < (size < 32 ? 0.08 : 0.06)) isCheck = true;
      }
      const t2 = (cx - 0.44) / (0.76 - 0.44);
      if (t2 >= 0 && t2 <= 1) {
        const expectedY = 0.70 - t2 * 0.35;
        if (Math.abs(cy - expectedY) < (size < 32 ? 0.08 : 0.06)) isCheck = true;
      }

      if (isCheck) {
        rawBytes[offset++] = ar;
        rawBytes[offset++] = ag;
        rawBytes[offset++] = ab;
        rawBytes[offset++] = 255;
      } else {
        // Gradient background
        const grad = Math.floor(cy * 25);
        rawBytes[offset++] = Math.max(0, pr - grad);
        rawBytes[offset++] = Math.max(0, pg - grad);
        rawBytes[offset++] = Math.max(0, pb - grad);
        rawBytes[offset++] = 255;
      }
    }
  }

  // Header chunk IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: 6 (RGBA)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const idatData = zlib.deflateSync(rawBytes);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // Magic PNG header
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Brand colors: Deep Royal Blue background (#1A73E8 = [26, 115, 232]), Emerald Green checkmark (#34D399 = [52, 211, 153])
const primary = [26, 115, 232];
const accent = [52, 211, 153];

[16, 48, 128].forEach(size => {
  const pngBuf = createPng(size, primary, accent);
  const outPath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, pngBuf);
  console.log(`Generated: ${outPath} (${pngBuf.length} bytes)`);
});
