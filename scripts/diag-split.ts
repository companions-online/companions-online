// Diagnostic: render the same tile through several pipelines and output each
// as its own high-zoom PNG. Stacked cases:
//   1. raw + drawImage(img, x, y)                  [gold: pure integer blit]
//   2. split halves + plain drawImage              [proves split data is good]
//   3. raw + setTransform(integer) + drawImage     [tests Cairo translate path]
//   4. split + drawDeformedTile, FLAT integer corners
//   5. split + drawDeformedTile, FRACTIONAL corners (elevation-like)
//   6. Option A: clip-to-triangle + unsplit raw, FLAT corners
//   7. Option A: clip-to-triangle + unsplit raw, FRACTIONAL corners
import { createCanvas } from 'canvas';
(globalThis as any).OffscreenCanvas = class OffscreenCanvas {
  constructor(width: number, height: number) {
    return createCanvas(width, height) as any;
  }
};

import fs from 'fs';
import path from 'path';
import { generateRawTerrainTiles, splitTerrainTiles } from '../client-web/src/texture.js';
import { drawDeformedTile } from '../client-web/src/quad-renderer.js';
import { TILE_W, TILE_H } from '../client-web/src/config.js';
import type { TileCorners } from '../client-web/src/elevation.js';

const raw = generateRawTerrainTiles();
const splits = splitTerrainTiles(raw);

// Build a SYNTHETIC solid-red diamond tile so alpha-bleed seams appear as
// obvious dark pixels against bright red. Noise-colored tiles hide the seam.
function makeSolidDiamondTile(): any {
  const c = createCanvas(TILE_W, TILE_H);
  const ctx = c.getContext('2d') as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(TILE_W, TILE_H);
  const HALF_W = TILE_W / 2;
  const HALF_H = TILE_H / 2;
  for (let py = 0; py < TILE_H; py++) {
    for (let px = 0; px < TILE_W; px++) {
      const dx = Math.abs(px - HALF_W + 0.5);
      const dy = Math.abs(py - HALF_H + 0.5);
      const inside = dx / HALF_W + dy / HALF_H <= 1;
      const i = (py * TILE_W + px) * 4;
      if (inside) {
        img.data[i] = 255;
        img.data[i + 1] = 0;
        img.data[i + 2] = 0;
        img.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Import splitTile so we can split our synthetic red tile the same way
// the real texture pipeline splits real tiles.
const { splitTile } = await import('../client-web/src/quad-renderer.js');

const grassRaw = makeSolidDiamondTile();
const grassSplit = splitTile(grassRaw as any);
void raw; void splits;

const PAD = 8;

function makeCell(draw: (ctx: CanvasRenderingContext2D, ox: number, oy: number) => void): any {
  const cell = createCanvas(TILE_W + PAD, TILE_H + PAD);
  const ctx = cell.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, cell.width, cell.height);
  draw(ctx, PAD / 2, PAD / 2);
  return cell;
}

// Zoom each tile independently at 8x so the seam is plainly visible.
function upscale(src: any, scale: number): any {
  const big = createCanvas(src.width * scale, src.height * scale);
  const ctx = big.getContext('2d') as unknown as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, big.width, big.height);
  return big;
}

function flatCorners(ox: number, oy: number): TileCorners {
  return {
    nx: ox + TILE_W / 2, ny: oy,
    ex: ox + TILE_W,     ey: oy + TILE_H / 2,
    sx: ox + TILE_W / 2, sy: oy + TILE_H,
    wx: ox,              wy: oy + TILE_H / 2,
  };
}

// Fractional corners as elevation would produce: ~0.3 px offsets.
function fracCorners(ox: number, oy: number): TileCorners {
  return {
    nx: ox + TILE_W / 2, ny: oy + 0.3,
    ex: ox + TILE_W,     ey: oy + TILE_H / 2 - 0.2,
    sx: ox + TILE_W / 2, sy: oy + TILE_H + 0.4,
    wx: ox,              wy: oy + TILE_H / 2 + 0.1,
  };
}

// Compute affine [a,b,c,d,e,f] mapping source triangle (sx0,sy0),(sx1,sy1),(sx2,sy2)
// to destination (dx0,dy0),(dx1,dy1),(dx2,dy2). Canvas matrix form:
//   [a c e]
//   [b d f]
//   [0 0 1]
function affineFromTriangles(
  sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number,
  dx0: number, dy0: number, dx1: number, dy1: number, dx2: number, dy2: number,
): [number, number, number, number, number, number] {
  const det = sx0 * (sy1 - sy2) - sx1 * (sy0 - sy2) + sx2 * (sy0 - sy1);
  const invDet = 1 / det;
  const i0 = (sy1 - sy2) * invDet, i1 = (sx2 - sx1) * invDet, i2 = (sx1 * sy2 - sx2 * sy1) * invDet;
  const i3 = (sy2 - sy0) * invDet, i4 = (sx0 - sx2) * invDet, i5 = (sx2 * sy0 - sx0 * sy2) * invDet;
  const i6 = (sy0 - sy1) * invDet, i7 = (sx1 - sx0) * invDet, i8 = (sx0 * sy1 - sx1 * sy0) * invDet;
  const a = dx0 * i0 + dx1 * i3 + dx2 * i6;
  const c = dx0 * i1 + dx1 * i4 + dx2 * i7;
  const e = dx0 * i2 + dx1 * i5 + dx2 * i8;
  const b = dy0 * i0 + dy1 * i3 + dy2 * i6;
  const d = dy0 * i1 + dy1 * i4 + dy2 * i7;
  const f = dy0 * i2 + dy1 * i5 + dy2 * i8;
  return [a, b, c, d, e, f];
}

function drawOptionA(ctx: CanvasRenderingContext2D, corners: TileCorners): void {
  // Source diamond corners for the UNSPLIT raw tile:
  //   N(32,0), E(64,16), S(32,32), W(0,16)
  const srcN = [TILE_W / 2, 0];
  const srcE = [TILE_W, TILE_H / 2];
  const srcS = [TILE_W / 2, TILE_H];
  const srcW = [0, TILE_H / 2];

  // Right triangle: clip N-E-S, draw full tile via real affine (N,E,S → dst)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.nx, corners.ny);
  ctx.lineTo(corners.ex, corners.ey);
  ctx.lineTo(corners.sx, corners.sy);
  ctx.closePath();
  ctx.clip();
  const rM = affineFromTriangles(
    srcN[0], srcN[1], srcE[0], srcE[1], srcS[0], srcS[1],
    corners.nx, corners.ny, corners.ex, corners.ey, corners.sx, corners.sy,
  );
  ctx.setTransform(rM[0], rM[1], rM[2], rM[3], rM[4], rM[5]);
  ctx.drawImage(grassRaw as any, 0, 0);
  ctx.restore();

  // Left triangle: clip N-W-S, draw full tile via real affine (N,W,S → dst)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners.nx, corners.ny);
  ctx.lineTo(corners.wx, corners.wy);
  ctx.lineTo(corners.sx, corners.sy);
  ctx.closePath();
  ctx.clip();
  const lM = affineFromTriangles(
    srcN[0], srcN[1], srcW[0], srcW[1], srcS[0], srcS[1],
    corners.nx, corners.ny, corners.wx, corners.wy, corners.sx, corners.sy,
  );
  ctx.setTransform(lM[0], lM[1], lM[2], lM[3], lM[4], lM[5]);
  ctx.drawImage(grassRaw as any, 0, 0);
  ctx.restore();
}

const cells: { label: string; cell: any }[] = [
  {
    label: '1-raw-drawImage',
    cell: makeCell((c, ox, oy) => { c.drawImage(grassRaw as any, ox, oy); }),
  },
  {
    label: '2-split-plain',
    cell: makeCell((c, ox, oy) => {
      c.drawImage(grassSplit.left as any, ox, oy);
      c.drawImage(grassSplit.right as any, ox, oy);
    }),
  },
  {
    label: '3-raw-setTransform',
    cell: makeCell((c, ox, oy) => {
      c.save();
      c.setTransform(1, 0, 0, 1, ox, oy);
      c.drawImage(grassRaw as any, 0, 0);
      c.restore();
    }),
  },
  {
    label: '4-split-deformed-flat',
    cell: makeCell((c, ox, oy) => {
      drawDeformedTile(c, grassSplit, flatCorners(ox, oy));
    }),
  },
  {
    label: '5-split-deformed-frac',
    cell: makeCell((c, ox, oy) => {
      drawDeformedTile(c, grassSplit, fracCorners(ox, oy));
    }),
  },
  {
    label: '6-optionA-flat',
    cell: makeCell((c, ox, oy) => {
      drawOptionA(c, flatCorners(ox, oy));
    }),
  },
  {
    label: '7-optionA-frac',
    cell: makeCell((c, ox, oy) => {
      drawOptionA(c, fracCorners(ox, oy));
    }),
  },
];

const outDir = path.resolve(import.meta.dirname!, 'dist');
fs.mkdirSync(outDir, { recursive: true });

const SCALE = 8;
for (const { label, cell } of cells) {
  const big = upscale(cell, SCALE);
  const outPath = path.join(outDir, `diag-${label}.png`);
  fs.writeFileSync(outPath, big.toBuffer('image/png'));
  console.log(`Wrote ${outPath}`);
}
