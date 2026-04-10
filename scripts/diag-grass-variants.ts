// Diagnostic: dump every grass variant from generateRawTerrainTiles to its
// own PNG so we can see whether the 6 variants are actually distinct or
// statistically identical at game zoom.
import { createCanvas } from 'canvas';

(globalThis as any).OffscreenCanvas = class OffscreenCanvas {
  constructor(width: number, height: number) {
    return createCanvas(width, height) as any;
  }
};

import fs from 'fs';
import path from 'path';
import { generateRawTerrainTiles } from '../client-webgl/src/texture.js';
import { TILE_W, TILE_H, TERRAIN_VARIANT_COUNTS } from '../client-webgl/src/config.js';

const tiles = generateRawTerrainTiles();
const grass = tiles[0]; // terrain 0 = grass
const variants = grass[0]; // frame 0

const outDir = path.resolve(import.meta.dirname!, 'dist');
fs.mkdirSync(outDir, { recursive: true });

console.log(`Grass: ${variants.length} variants (config says ${TERRAIN_VARIANT_COUNTS[0]})`);

const SCALE = 4;

// Dump each variant individually
for (let v = 0; v < variants.length; v++) {
  const src = variants[v] as any;
  const big = createCanvas(TILE_W * SCALE, TILE_H * SCALE);
  const ctx = big.getContext('2d') as any;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, TILE_W * SCALE, TILE_H * SCALE);
  const outPath = path.join(outDir, `diag-grass-v${v}.png`);
  fs.writeFileSync(outPath, big.toBuffer('image/png'));
  console.log(`Wrote ${outPath}`);
}

// Build a single side-by-side atlas of all 6 grass variants for direct
// comparison.
const PAD = 8;
const cellW = TILE_W * SCALE + PAD;
const cellH = TILE_H * SCALE + PAD;
const atlas = createCanvas(cellW * variants.length, cellH);
const actx = atlas.getContext('2d') as any;
actx.fillStyle = '#222';
actx.fillRect(0, 0, atlas.width, atlas.height);
actx.imageSmoothingEnabled = false;
for (let v = 0; v < variants.length; v++) {
  const src = variants[v] as any;
  actx.drawImage(src, v * cellW + PAD / 2, PAD / 2, TILE_W * SCALE, TILE_H * SCALE);
}
const atlasPath = path.join(outDir, 'diag-grass-atlas.png');
fs.writeFileSync(atlasPath, atlas.toBuffer('image/png'));
console.log(`Wrote ${atlasPath}`);

// Also compute hashes / pixel diff between variants to confirm the bytes
// differ even if visually similar.
async function pixelHash(canvas: any): Promise<string> {
  const data = canvas.toBuffer('image/png');
  // Cheap rolling hash on the PNG bytes
  let h = 0;
  for (let i = 0; i < data.length; i++) {
    h = (h * 31 + data[i]) >>> 0;
  }
  return h.toString(16);
}

console.log('\nVariant byte hashes:');
for (let v = 0; v < variants.length; v++) {
  console.log(`  v${v}: ${await pixelHash(variants[v])}`);
}

// Compute pixel-level RGB difference between consecutive variants
console.log('\nMean RGB delta between consecutive variants:');
function getCtx(c: any): any { return c.getContext('2d'); }
for (let v = 1; v < variants.length; v++) {
  const a = getCtx(variants[v - 1]).getImageData(0, 0, TILE_W, TILE_H).data;
  const b = getCtx(variants[v]).getImageData(0, 0, TILE_W, TILE_H).data;
  let totalDelta = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    totalDelta += (dr + dg + db) / 3;
    count++;
  }
  console.log(`  v${v - 1} vs v${v}: ${(totalDelta / count).toFixed(2)} avg per-channel delta (out of 255)`);
}
