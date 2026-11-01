// 依存パッケージなしでアプリアイコン（PNG）を生成する
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public/icons');
const BLUE = [11, 61, 145];
const WHITE = [255, 255, 255];
const RED = [214, 40, 57];

/** 0〜1 の正規化座標の色を返す。ボールはマスカブルの安全領域内に収める */
function colorAt(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.5;
  if (Math.hypot(dx, dy) > 0.31) return BLUE;
  for (const side of [-1, 1]) {
    // 左右の縫い目を、ボールの外側に中心を持つ円弧として描く
    const cx = 0.5 + side * 0.4;
    const distance = Math.hypot(x - cx, dy);
    if (Math.abs(distance - 0.25) < 0.009) return RED;
    if (Math.abs(distance - 0.25) < 0.038) {
      const angle = Math.atan2(dy, x - cx);
      const phase = ((angle * 13) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (phase < 0.75) return RED;
    }
  }
  return WHITE;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function renderPng(size) {
  const SAMPLES = 3;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let offset = 0;
  for (let py = 0; py < size; py++) {
    raw[offset++] = 0;
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = colorAt((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size);
          color.forEach((value, i) => { sum[i] += value; });
        }
      }
      for (const value of sum) raw[offset++] = Math.round(value / SAMPLES ** 2);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 8bit
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(OUT, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await writeFile(join(OUT, name), renderPng(size));
  console.log(`${name} (${size}px)`);
}
