import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SVG_SOURCE = resolve("frontend/public/assets/beat-logo.svg");
const OUT = resolve("backend/Assets/BeatIcon.png");
const ICNS_OUT = resolve("backend/Assets/BeatIcon.icns");
const SIZE = 1024;
const SCALE = 3;
const HI = SIZE * SCALE;
const ICON_INSET = 138;
const ICON_SIZE = SIZE - ICON_INSET * 2;

const alphaPixels = new Uint8Array(HI * HI);
const lumaPixels = new Uint8Array(HI * HI);

function put(index, value) {
  alphaPixels[index] = 255;
  lumaPixels[index] = value;
}

function fillRect(x, y, w, h, value = 255) {
  const x0 = Math.max(0, Math.round(x * SCALE));
  const y0 = Math.max(0, Math.round(y * SCALE));
  const x1 = Math.min(HI, Math.round((x + w) * SCALE));
  const y1 = Math.min(HI, Math.round((y + h) * SCALE));
  for (let yy = y0; yy < y1; yy += 1) {
    const row = yy * HI;
    for (let xx = x0; xx < x1; xx += 1) put(row + xx, value);
  }
}

function fillContoursEvenOdd(contours, viewBox, value = 255) {
  const scale = Math.min(ICON_SIZE / viewBox.width, ICON_SIZE / viewBox.height);
  const xInset = ICON_INSET + (ICON_SIZE - viewBox.width * scale) / 2;
  const yInset = ICON_INSET + (ICON_SIZE - viewBox.height * scale) / 2;
  const scaledContours = contours.map((contour) => contour.map(([x, y]) => [
    Math.round((xInset + (x - viewBox.x) * scale) * SCALE),
    Math.round((yInset + (y - viewBox.y) * scale) * SCALE),
  ]));
  const allY = scaledContours.flat().map(([, y]) => y);
  const minY = Math.max(0, Math.min(...allY));
  const maxY = Math.min(HI - 1, Math.max(...allY));

  for (let y = minY; y <= maxY; y += 1) {
    const intersections = [];
    for (const contour of scaledContours) {
      for (let i = 0; i < contour.length; i += 1) {
        const [x1, y1] = contour[i];
        const [x2, y2] = contour[(i + 1) % contour.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          intersections.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
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

function parsePath(path) {
  const tokens = path.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const contours = [];
  let command = "";
  let cursor = [0, 0];
  let start = [0, 0];
  let lastCubicControl = null;
  let contour = [];
  let index = 0;

  const isCommand = (token) => /^[a-zA-Z]$/.test(token);
  const number = () => Number(tokens[index++]);
  const closeContour = () => {
    if (contour.length > 1) contours.push(contour);
    contour = [];
  };
  const moveTo = (x, y) => {
    closeContour();
    cursor = [x, y];
    start = [x, y];
    contour.push(cursor);
  };
  const lineTo = (x, y) => {
    cursor = [x, y];
    lastCubicControl = null;
    contour.push(cursor);
  };
  const cubicTo = (x1, y1, x2, y2, x3, y3) => {
    const x0 = cursor[0];
    const y0 = cursor[1];
    for (let step = 1; step <= 24; step += 1) {
      const t = step / 24;
      const mt = 1 - t;
      cursor = [
        mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
        mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
      ];
      contour.push(cursor);
    }
    cursor = [x3, y3];
    lastCubicControl = [x2, y2];
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++];
    switch (command) {
      case "M":
        moveTo(number(), number());
        lastCubicControl = null;
        command = "L";
        break;
      case "m":
        moveTo(cursor[0] + number(), cursor[1] + number());
        lastCubicControl = null;
        command = "l";
        break;
      case "L":
        while (index < tokens.length && !isCommand(tokens[index])) lineTo(number(), number());
        break;
      case "l":
        while (index < tokens.length && !isCommand(tokens[index])) lineTo(cursor[0] + number(), cursor[1] + number());
        break;
      case "H":
        while (index < tokens.length && !isCommand(tokens[index])) lineTo(number(), cursor[1]);
        break;
      case "h":
        while (index < tokens.length && !isCommand(tokens[index])) lineTo(cursor[0] + number(), cursor[1]);
        break;
      case "V":
        while (index < tokens.length && !isCommand(tokens[index])) lineTo(cursor[0], number());
        break;
      case "v":
        while (index < tokens.length && !isCommand(tokens[index])) lineTo(cursor[0], cursor[1] + number());
        break;
      case "C":
      case "c":
        while (index < tokens.length && !isCommand(tokens[index])) {
          const relative = command === "c";
          const x0 = cursor[0];
          const y0 = cursor[1];
          const x1 = number() + (relative ? x0 : 0);
          const y1 = number() + (relative ? y0 : 0);
          const x2 = number() + (relative ? x0 : 0);
          const y2 = number() + (relative ? y0 : 0);
          const x3 = number() + (relative ? x0 : 0);
          const y3 = number() + (relative ? y0 : 0);
          cubicTo(x1, y1, x2, y2, x3, y3);
        }
        break;
      case "S":
      case "s":
        while (index < tokens.length && !isCommand(tokens[index])) {
          const relative = command === "s";
          const x0 = cursor[0];
          const y0 = cursor[1];
          const x1 = lastCubicControl ? 2 * x0 - lastCubicControl[0] : x0;
          const y1 = lastCubicControl ? 2 * y0 - lastCubicControl[1] : y0;
          const x2 = number() + (relative ? x0 : 0);
          const y2 = number() + (relative ? y0 : 0);
          const x3 = number() + (relative ? x0 : 0);
          const y3 = number() + (relative ? y0 : 0);
          cubicTo(x1, y1, x2, y2, x3, y3);
        }
        break;
      case "Z":
      case "z":
        lineTo(start[0], start[1]);
        closeContour();
        break;
      default:
        throw new Error(`Unsupported SVG path command: ${command}`);
    }
  }
  closeContour();
  return contours;
}

function contourBounds(contours) {
  const points = contours.flat();
  return {
    minX: Math.min(...points.map(([x]) => x)),
    maxX: Math.max(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

function intersectsViewBox(bounds, viewBox) {
  return (
    bounds.maxX >= viewBox.x
    && bounds.minX <= viewBox.x + viewBox.width
    && bounds.maxY >= viewBox.y
    && bounds.minY <= viewBox.y + viewBox.height
  );
}

function readLogoContours() {
  const svg = readFileSync(SVG_SOURCE, "utf8");
  const viewBoxMatch = svg.match(/\bviewBox=["']([^"']+)["']/i);
  if (!viewBoxMatch) throw new Error(`Missing viewBox in ${SVG_SOURCE}`);
  const [x, y, width, height] = viewBoxMatch[1].trim().split(/[\s,]+/).map(Number);
  const viewBox = { x, y, width, height };
  const contours = [...svg.matchAll(/<path\b[^>]*\bd=["']([^"']+)["'][^>]*>/gi)]
    .flatMap(([, d]) => {
      const parsed = parsePath(d);
      return intersectsViewBox(contourBounds(parsed), viewBox) ? parsed : [];
    });
  if (contours.length === 0) throw new Error(`No visible path contours found in ${SVG_SOURCE}`);
  return { contours, viewBox };
}

// Dock/process icon: black square with the supplied Beat mark in white.
fillRect(0, 0, SIZE, SIZE, 0);
const logo = readLogoContours();
fillContoursEvenOdd(logo.contours, logo.viewBox, 255);

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
