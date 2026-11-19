import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const b = Buffer.concat([Buffer.from(t), d]); const o = Buffer.alloc(4); o.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b)); return Buffer.concat([o, b, c]); };

function png(size) {
  const row = Buffer.alloc(1 + size * 3);
  const raw = Buffer.alloc(row.length * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const box = x > size * 0.28 && x < size * 0.72 && y > size * 0.28 && y < size * 0.72;
      const o = y * row.length + 1 + x * 3;
      [raw[o], raw[o + 1], raw[o + 2]] = box ? [255, 255, 255] : [0x1f, 0x6f, 0xeb];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [180, 192, 512]) writeFileSync(new URL(`../icons/icon-${s}.png`, import.meta.url), png(s));
