import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve("backend/Assets/BeatIcon.png");
const ICNS_OUT = resolve("backend/Assets/BeatIcon.icns");
const SIZE = 1024;
const SCALE = 3;
const HI = SIZE * SCALE;
const alphaPixels = new Uint8Array(HI * HI);
const lumaPixels = new Uint8Array(HI * HI);

function px(v) {
  return Math.round(v * SCALE);
}

function put(index, value) {
  alphaPixels[index] = 255;
  lumaPixels[index] = value;
}

function fillRect(x, y, w, h, value = 255) {
  const x0 = Math.max(0, px(x));
  const y0 = Math.max(0, px(y));
  const x1 = Math.min(HI, px(x + w));
  const y1 = Math.min(HI, px(y + h));
  for (let yy = y0; yy < y1; yy += 1) {
    const row = yy * HI;
    for (let xx = x0; xx < x1; xx += 1) put(row + xx, value);
  }
}

function fillEllipse(cx, cy, rx, ry, rotateDeg, value = 0) {
  const angle = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pad = Math.max(rx, ry);
  const x0 = Math.max(0, px(cx - pad));
  const y0 = Math.max(0, px(cy - pad));
  const x1 = Math.min(HI, px(cx + pad));
  const y1 = Math.min(HI, px(cy + pad));

  for (let yy = y0; yy < y1; yy += 1) {
    const y = yy / SCALE - cy;
    const row = yy * HI;
    for (let xx = x0; xx < x1; xx += 1) {
      const x = xx / SCALE - cx;
      const xr = x * cos + y * sin;
      const yr = -x * sin + y * cos;
      if ((xr * xr) / (rx * rx) + (yr * yr) / (ry * ry) <= 1) put(row + xx, value);
    }
  }
}

function fillPolygon(points, value = 0) {
  const scaled = points.map(([x, y]) => [px(x), px(y)]);
  const minY = Math.max(0, Math.min(...scaled.map(([, y]) => y)));
  const maxY = Math.min(HI - 1, Math.max(...scaled.map(([, y]) => y)));

  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (let i = 0; i < scaled.length; i += 1) {
      const [x1, y1] = scaled[i];
      const [x2, y2] = scaled[(i + 1) % scaled.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(intersections[i]));
      const x1 = Math.min(HI - 1, Math.floor(intersections[i + 1]));
      const row = y * HI;
      for (let x = x0; x <= x1; x += 1) put(row + x, value);
    }
  }
}

function t(x, y) {
  const noteScale = 0.75;
  return [512 + (x - 512) * noteScale, 512 + (y - 512) * noteScale];
}

// Match the in-app BrandMark: hard white square, black musical note.
fillRect(128, 128, 768, 768, 255);
fillRect(...t(470, 248), 68 * 0.75, 430 * 0.75, 0);
fillPolygon([
  t(470, 248),
  t(764, 300),
  t(746, 386),
  t(538, 348),
  t(538, 464),
  t(470, 464),
]);
fillEllipse(...t(374, 694), 122 * 0.75, 78 * 0.75, -24, 0);
fillEllipse(...t(374, 694), 54 * 0.75, 30 * 0.75, -24, 255);
fillRect(...t(456, 616), 82 * 0.75, 70 * 0.75, 255);

const image = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  const outRow = y * (SIZE * 4 + 1);
  image[outRow] = 0;
  for (let x = 0; x < SIZE; x += 1) {
    let alphaSum = 0;
    let lumaSum = 0;
    for (let sy = 0; sy < SCALE; sy += 1) {
      const row = (y * SCALE + sy) * HI;
      for (let sx = 0; sx < SCALE; sx += 1) {
        const sample = row + x * SCALE + sx;
        const alpha = alphaPixels[sample];
        alphaSum += alpha;
        lumaSum += lumaPixels[sample] * alpha;
      }
    }
    const alpha = Math.round(alphaSum / (SCALE * SCALE));
    const luma = alphaSum > 0 ? Math.round(lumaSum / alphaSum) : 255;
    const i = outRow + 1 + x * 4;
    image[i] = luma;
    image[i + 1] = luma;
    image[i + 2] = luma;
    image[i + 3] = alpha;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, crc]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 6;
header[10] = 0;
header[11] = 0;
header[12] = 0;

mkdirSync(dirname(OUT), { recursive: true });
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(image)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(OUT, png);

const icnsChunk = Buffer.alloc(8);
icnsChunk.write("ic10", 0, 4, "ascii");
icnsChunk.writeUInt32BE(png.length + 8, 4);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns", 0, 4, "ascii");
icnsHeader.writeUInt32BE(png.length + 16, 4);
writeFileSync(ICNS_OUT, Buffer.concat([icnsHeader, icnsChunk, png]));

console.log(OUT);
console.log(ICNS_OUT);
