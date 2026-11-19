// gta6-meme-reddit-01 — "The 13-year download"
// A GTA 6 launch-week meme, drawn from scratch with the Node 22 standard library only.
// main.ts does two things when run:
//   1. copies POST.json from the repository root to /output/POST.json (the gate reads it there),
//   2. generates the meme picture and writes it to /output/meme.png.
// No network, no clock, no files outside the repository: the picture is fully deterministic,
// so two runs write the same bytes. The make.fun ghost in the picture is make.fun's own press
// mark (mark-1024.png, fetched from https://make.fun/press/ at build time, downscaled to
// 128x128 RGBA, zlib-compressed and embedded below as base64); the program only decodes it.
//
// The joke: GTA 6 is finally out, but the download has been stuck at 99% for 13 years —
// "TIME REMAINING: 13 YEARS". Meanwhile the poster's AI agent already got paid on make.fun.
// Run locally:  mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Raster canvas (24-bit RGB, row-major)
// ---------------------------------------------------------------------------

const px = Buffer.alloc(W * H * 3);

type RGB = [number, number, number];

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
}

// Alpha-blend a colour over the pixel (a in 0..255).
function blendPixel(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 3;
  const inv = 255 - a;
  px[i] = (c[0] * a + px[i] * inv) >> 8;
  px[i + 1] = (c[1] * a + px[i + 1] * inv) >> 8;
  px[i + 2] = (c[2] * a + px[i + 2] * inv) >> 8;
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPixel(xx, yy, c);
  }
}

function fillRectAlpha(x: number, y: number, w: number, h: number, c: RGB, a: number): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) blendPixel(xx, yy, c, a);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(x, y, c);
    }
  }
}

function fillCircleAlpha(cx: number, cy: number, r: number, c: RGB, a: number): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) blendPixel(x, y, c, a);
    }
  }
}

// Scanline polygon fill.
function fillPolygon(points: Array<[number, number]>, c: RGB): void {
  let minY = H, maxY = 0;
  for (const [, y] of points) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(H - 1, Math.floor(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(0, Math.ceil(xs[i])); x <= Math.min(W - 1, Math.floor(xs[i + 1])); x++) {
        setPixel(x, y, c);
      }
    }
  }
}

// A thick line drawn as discs along the segment.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w / 2, c);
  }
}

// A quadratic bezier sampled as a thick line.
function thickCurve(p0: [number, number], p1: [number, number], p2: [number, number], w: number, c: RGB): void {
  const steps = 24;
  let prev: [number, number] | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
    const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
    if (prev) thickLine(prev[0], prev[1], x, y, w, c);
    prev = [x, y];
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, w, h - 2 * r, c);
  fillCircle(x + r, y + r, r, c);
  fillCircle(x + w - r, y + r, r, c);
  fillCircle(x + r, y + h - r, r, c);
  fillCircle(x + w - r, y + h - r, r, c);
}

function roundRectAlpha(x: number, y: number, w: number, h: number, r: number, c: RGB, a: number): void {
  // Opaque fill first is wrong for alpha; approximate by stamping the shape with blend.
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const inRect =
        (xx >= x + r && xx < x + w - r) ||
        (yy >= y + r && yy < y + h - r) ||
        (Math.hypot(xx - (x + r), yy - (y + r)) <= r) ||
        (Math.hypot(xx - (x + w - r), yy - (y + r)) <= r) ||
        (Math.hypot(xx - (x + r), yy - (y + h - r)) <= r) ||
        (Math.hypot(xx - (x + w - r), yy - (y + h - r)) <= r);
      if (inRect) blendPixel(xx, yy, c, a);
    }
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (glyphs as 7 rows of 5 bits, '1' = on). Only the characters
// this meme uses, plus the full A-Z / 0-9 set for safety.
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
};

function textWidth(s: string, scale: number): number {
  return s.length === 0 ? 0 : s.length * 6 * scale - scale;
}

function drawTextRaw(s: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT[' '];
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if (g[r][col] === '1') {
          fillRect(cx + col * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}

// Draw text centred on cx, with a dark outline so it reads over the sunset.
function drawText(s: string, cx: number, y: number, scale: number, c: RGB, outline: RGB | null): void {
  const x = Math.round(cx - textWidth(s, scale) / 2);
  if (outline) {
    const o = Math.max(1, Math.round(scale / 2));
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]] as const) {
      drawTextRaw(s, x + dx, y + dy, scale, outline);
    }
  }
  drawTextRaw(s, x, y, scale, c);
}

function drawTextLeft(s: string, x: number, y: number, scale: number, c: RGB, outline: RGB | null): void {
  if (outline) {
    const o = Math.max(1, Math.round(scale / 2));
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, -o], [-o, o], [o, o]] as const) {
      drawTextRaw(s, x + dx, y + dy, scale, outline);
    }
  }
  drawTextRaw(s, x, y, scale, c);
}

// ---------------------------------------------------------------------------
// make.fun's ghost mark, embedded.
// make.fun press mark (mark-1024.png) downscaled to 128x128 RGBA, zlib-deflated
// and base64-encoded. Decoded at run time; no network needed.
// ---------------------------------------------------------------------------

const GHOST_B64 = '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';
const GHOST_SIZE = 128;

function ghostRgba(): Buffer {
  return inflateSync(Buffer.from(GHOST_B64, 'base64'));
}

// Blit the ghost scaled to `size` px with its top-left at (x, y).
function blitGhost(rgba: Buffer, x: number, y: number, size: number): void {
  for (let dy = 0; dy < size; dy++) {
    const sy = Math.floor((dy / size) * GHOST_SIZE);
    for (let dx = 0; dx < size; dx++) {
      const sx = Math.floor((dx / size) * GHOST_SIZE);
      const i = (sy * GHOST_SIZE + sx) * 4;
      const a = rgba[i + 3];
      if (a === 0) continue;
      blendPixel(x + dx, y + dy, [rgba[i], rgba[i + 1], rgba[i + 2]], a);
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (colour type 2, 8-bit, filter 0, zlib via stdlib)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 (RGB)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    px.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// The meme itself: a Vice City sunset, a download stuck at 99% for 13 years,
// and make.fun's ghost, already paid.
// ---------------------------------------------------------------------------

const DARK: RGB = [22, 8, 46];
const WHITE: RGB = [255, 255, 255];
const MAGENTA: RGB = [233, 30, 140];
const SUN_YELLOW: RGB = [255, 209, 102];
const PANEL: RGB = [16, 10, 38];

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function drawSunset(): void {
  const stops: Array<[number, RGB]> = [
    [0.0, [32, 9, 74]],
    [0.38, [124, 29, 110]],
    [0.62, [224, 69, 123]],
    [0.82, [255, 138, 61]],
    [1.0, [255, 196, 107]],
  ];
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    const c = lerpColor(c0, c1, f);
    for (let x = 0; x < W; x++) setPixel(x, y, c);
  }
  // Stars in the dark top of the sky.
  const stars: Array<[number, number]> = [
    [70, 40], [150, 90], [240, 30], [330, 70], [420, 36], [620, 60],
    [700, 30], [800, 80], [900, 40], [970, 110], [40, 150], [880, 140],
  ];
  for (const [sx, sy] of stars) fillCircle(sx, sy, 2, WHITE);
  // Sun with a soft glow, half-hidden behind the download panel.
  fillCircleAlpha(512, 290, 165, [255, 190, 90], 46);
  fillCircleAlpha(512, 290, 140, [255, 210, 120], 70);
  fillCircle(512, 290, 115, [255, 233, 168]);
  // A few birds.
  for (const [bx, by, s] of [[210, 190, 14], [268, 158, 11], [790, 176, 12]] as const) {
    thickLine(bx - s, by, bx, by - 6, 4, DARK);
    thickLine(bx, by - 6, bx + s, by, 4, DARK);
  }
}

function drawPalm(xBase: number, lean: number, flip: boolean): void {
  // Trunk: a gentle curve from the bottom of the frame up to the crown,
  // stamped densely so it reads as one solid silhouette, tapering upward.
  const crown: [number, number] = [xBase + lean, 300];
  const base: [number, number] = [xBase, 1024];
  const mid: [number, number] = [xBase + lean * 0.4, 680];
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = (1 - t) * (1 - t) * base[0] + 2 * (1 - t) * t * mid[0] + t * t * crown[0];
    const y = (1 - t) * (1 - t) * base[1] + 2 * (1 - t) * t * mid[1] + t * t * crown[1];
    fillCircle(x, y, 16 - 8 * t, DARK);
  }
  // Fronds fanning out and drooping from the crown.
  const dir = flip ? -1 : 1;
  const fronds: Array<[[number, number], [number, number]]> = [
    [[crown[0] - 170 * dir, crown[1] - 30], [crown[0] - 280 * dir, crown[1] + 130]],
    [[crown[0] - 110 * dir, crown[1] - 90], [crown[0] - 230 * dir, crown[1] + 10]],
    [[crown[0] - 20 * dir, crown[1] - 120], [crown[0] - 90 * dir, crown[1] - 60]],
    [[crown[0] + 80 * dir, crown[1] - 100], [crown[0] + 190 * dir, crown[1] - 10]],
    [[crown[0] + 160 * dir, crown[1] - 30], [crown[0] + 280 * dir, crown[1] + 120]],
  ];
  for (const [ctrl, end] of fronds) {
    thickCurve(crown, ctrl, end, 20, DARK);
  }
  // Coconuts tucked under the crown.
  fillCircle(crown[0] - 12 * dir, crown[1] + 14, 11, DARK);
  fillCircle(crown[0] + 12 * dir, crown[1] + 18, 11, DARK);
}

function drawMeme(): void {
  drawSunset();
  drawPalm(70, 60, false);   // left palm, leaning right
  drawPalm(954, -60, true);  // right palm, leaning left

  // Title.
  drawText('GRAND THEFT AUTO VI', 512, 56, 8, WHITE, DARK);
  drawText('LAUNCH DAY IN LEONIDA', 512, 132, 4, SUN_YELLOW, DARK);

  // Download panel.
  const px0 = 110, py0 = 330, pw = 804, ph = 380;
  roundRectAlpha(px0, py0, pw, ph, 18, PANEL, 235);
  // Panel border.
  roundRect(px0, py0, pw, 6, 3, WHITE);
  drawTextLeft('DOWNLOADING...', px0 + 40, py0 + 34, 5, WHITE, null);
  // Progress bar: 99% full.
  const bx = px0 + 40, by = py0 + 104, bw = pw - 80, bh = 56;
  fillRect(bx, by, bw, bh, [255, 255, 255]);
  fillRect(bx + 4, by + 4, Math.round((bw - 8) * 0.99), bh - 8, MAGENTA);
  drawText('99%', bx + bw / 2, by + 11, 5, WHITE, DARK);
  drawTextLeft('247 GB OF 250 GB', bx, by + bh + 22, 4, [230, 220, 235], null);
  // Divider.
  fillRect(bx, by + bh + 66, bw, 3, [255, 255, 255]);
  // Punchline.
  drawText('TIME REMAINING:', 512, py0 + 236, 5, WHITE, null);
  drawText('13 YEARS', 512, py0 + 282, 8, SUN_YELLOW, DARK);

  // Footer band so the sign-off reads over the sunset.
  fillRectAlpha(0, 745, W, H - 745, [10, 4, 26], 120);
  drawText('MEANWHILE, MY AI AGENT', 360, 800, 4, WHITE, DARK);
  drawText('ALREADY GOT PAID ON MAKE.FUN', 360, 852, 4, WHITE, DARK);
  drawText('NO WAITING. JUST WINNING.', 360, 904, 4, SUN_YELLOW, DARK);

  // make.fun's ghost, sitting in on the wait, bottom right.
  blitGhost(ghostRgba(), 726, 736, 264);
}

// ---------------------------------------------------------------------------
// Entry point: copy POST.json and write the meme, both to /output.
// ---------------------------------------------------------------------------

mkdirSync(OUTPUT_DIR, { recursive: true });
try {
  copyFileSync(join(BOT_DIR, 'POST.json'), join(OUTPUT_DIR, 'POST.json'));
} catch (err) {
  console.error(`POST.json could not be copied from ${BOT_DIR}: ${(err as Error).message}`);
  process.exit(1);
}

drawMeme();
writeFileSync(join(OUTPUT_DIR, 'meme.png'), encodePng());
console.log('meme.png written');
