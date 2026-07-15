#!/usr/bin/env bun
/**
 * Writes solid-color placeholder PNGs into src-tauri/icons/ so Tauri's
 * generate_context!() macro can compile. Replace with real artwork via
 *   `bun run tauri icon path/to/source.png`
 * before shipping a real build.
 *
 * No external dependencies — writes valid PNG bytes by hand.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { resolve } from "node:path";

const OUT = resolve(import.meta.dir, "../src-tauri/icons");
mkdirSync(OUT, { recursive: true });

// Brand purple — same as the title-bar dot in App.tsx.
const RGBA: [number, number, number, number] = [0x8b, 0x5c, 0xf6, 0xff];

function crc32(buf: Buffer): number {
  let crc = 0xffffffff >>> 0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng(size: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);  // width
  ihdr.writeUInt32BE(size, 4);  // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: truecolor + alpha
  // ihdr[10..12] already 0 (compression/filter/interlace defaults)

  // One filter byte (0 = none) per scanline, followed by RGBA pixels.
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const lineStart = y * (1 + size * 4);
    raw[lineStart] = 0; // filter type
    for (let x = 0; x < size; x++) {
      const p = lineStart + 1 + x * 4;
      raw[p] = RGBA[0];
      raw[p + 1] = RGBA[1];
      raw[p + 2] = RGBA[2];
      raw[p + 3] = RGBA[3];
    }
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sizes: Array<[string, number]> = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  // For build-time platform packaging, also provide icon.png at large size.
  ["icon.png", 512],
];

for (const [name, size] of sizes) {
  const png = makePng(size);
  writeFileSync(resolve(OUT, name), png);
  console.log(`wrote ${name} (${size}×${size}, ${png.length} bytes)`);
}

console.log(
  "\nPlaceholder PNGs written. Replace with real artwork via:\n" +
    "  bun run tauri icon path/to/source.png",
);
