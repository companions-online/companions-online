import { TILE_W, TILE_H } from './config.js';
import type { TileCorners } from './elevation.js';

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

/**
 * Extra columns each half keeps past the N-S center axis.
 *
 * Canvas bilinear sampling reads the 4 nearest source neighbors; if the
 * sample coordinate sits ε inside the split column (which elevation-induced
 * fractional destination corners make the common case), the kernel pulls in
 * one neighbor from the opposite side of the axis. With only the 1-column
 * overlap the original implementation had, that opposite neighbor is
 * transparent — each half contributes α≈0.5 along the seam and source-over
 * composites them to ~0.75, leaving the dark #111 clear-colour showing
 * through as a vertical stripe down every tile centre.
 *
 * 2 is the minimum that fixes it: it guarantees both bilinear neighbours
 * around x = HALF_W are opaque in each half. The hard α cliff is pushed out
 * to x = HALF_W ± 2, where the OTHER half is fully opaque and painting
 * correct colour, so the double-draw composites back to full opacity with
 * the right colour.
 */
const SEAM_OVERLAP = 2;

export interface SplitTile {
  left: OffscreenCanvas;
  right: OffscreenCanvas;
}

/**
 * Split a diamond tile along the N-S vertical center (x = HALF_W) into
 * left and right triangle halves. Each half also keeps a SEAM_OVERLAP-wide
 * skirt of opaque pixels past the axis so bilinear sampling of the seam
 * never reads a transparent neighbour — see SEAM_OVERLAP for the rationale.
 */
export function splitTile(tile: OffscreenCanvas): SplitTile {
  const w = tile.width;
  const h = tile.height;

  const src = (tile.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(0, 0, w, h);

  const leftOc = new OffscreenCanvas(w, h);
  const rightOc = new OffscreenCanvas(w, h);
  const leftData = leftOc.getContext('2d')!.createImageData(w, h);
  const rightData = rightOc.getContext('2d')!.createImageData(w, h);

  const leftMax = HALF_W + SEAM_OVERLAP;
  const rightMin = HALF_W - SEAM_OVERLAP;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if (src.data[i + 3] === 0) continue; // transparent pixel

      if (px <= leftMax) {
        leftData.data[i]     = src.data[i];
        leftData.data[i + 1] = src.data[i + 1];
        leftData.data[i + 2] = src.data[i + 2];
        leftData.data[i + 3] = src.data[i + 3];
      }
      if (px >= rightMin) {
        rightData.data[i]     = src.data[i];
        rightData.data[i + 1] = src.data[i + 1];
        rightData.data[i + 2] = src.data[i + 2];
        rightData.data[i + 3] = src.data[i + 3];
      }
    }
  }

  leftOc.getContext('2d')!.putImageData(leftData, 0, 0);
  rightOc.getContext('2d')!.putImageData(rightData, 0, 0);

  return { left: leftOc, right: rightOc };
}

/**
 * Pre-computed inverse matrices for the two fixed source triangles.
 *
 * Right triangle: N(HALF_W, 0), E(TILE_W, HALF_H), S(HALF_W, TILE_H)
 *   = N(32, 0), E(64, 16), S(32, 32)
 *
 * Left triangle: N(HALF_W, 0), W(0, HALF_H), S(HALF_W, TILE_H)
 *   = N(32, 0), W(0, 16), S(32, 32)
 *
 * For mapping source triangle (x0,y0),(x1,y1),(x2,y2) to destination
 * (X0,Y0),(X1,Y1),(X2,Y2), the affine transform [a,b,c,d,e,f] satisfies:
 *
 *   [X0]   [a c e] [x0]      [Y0]   [b d f] [x0]
 *   [X1] = [a c e] [x1]      [Y1] = [b d f] [x1]
 *   [X2]   [a c e] [x2]      [Y2]   [b d f] [x2]
 *         (with implicit 1)
 *
 * We pre-compute the inverse of the source coordinate matrix so that:
 *   [a, c, e] = [X0, X1, X2] * srcInverse
 *   [b, d, f] = [Y0, Y1, Y2] * srcInverse
 */

// Source matrix for right triangle N(32,0) E(64,16) S(32,32):
// | 32  64  32 |
// | 0   16  32 |
// | 1    1   1 |
// Determinant = 32*(16-32) - 64*(0-32) + 32*(0-16) = -512 + 2048 - 512 = 1024
// Inverse (transposed cofactor / det):
const RIGHT_INV = computeInverse(HALF_W, 0, TILE_W, HALF_H, HALF_W, TILE_H);

// Source matrix for left triangle N(32,0) W(0,16) S(32,32):
// | 32   0  32 |
// | 0   16  32 |
// | 1    1   1 |
// Determinant = 32*(16-32) - 0*(0-32) + 32*(0-16) = -512 + 0 - 512 = -1024
const LEFT_INV = computeInverse(HALF_W, 0, 0, HALF_H, HALF_W, TILE_H);

function computeInverse(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number[] {
  // Invert the 3x3 matrix:
  // | x0 x1 x2 |
  // | y0 y1 y2 |
  // | 1  1  1  |
  const det = x0 * (y1 - y2) - x1 * (y0 - y2) + x2 * (y0 - y1);
  const invDet = 1 / det;

  // Cofactor matrix (transposed) / det gives the inverse
  return [
    (y1 - y2) * invDet, (x2 - x1) * invDet, (x1 * y2 - x2 * y1) * invDet,
    (y2 - y0) * invDet, (x0 - x2) * invDet, (x2 * y0 - x0 * y2) * invDet,
    (y0 - y1) * invDet, (x1 - x0) * invDet, (x0 * y1 - x1 * y0) * invDet,
  ];
}

function computeAffine(
  inv: number[],
  dstX0: number, dstY0: number,
  dstX1: number, dstY1: number,
  dstX2: number, dstY2: number,
): [number, number, number, number, number, number] {
  // [a, c, e] = [dstX0, dstX1, dstX2] * inv
  const a = dstX0 * inv[0] + dstX1 * inv[3] + dstX2 * inv[6];
  const c = dstX0 * inv[1] + dstX1 * inv[4] + dstX2 * inv[7];
  const e = dstX0 * inv[2] + dstX1 * inv[5] + dstX2 * inv[8];

  // [b, d, f] = [dstY0, dstY1, dstY2] * inv
  const b = dstY0 * inv[0] + dstY1 * inv[3] + dstY2 * inv[6];
  const d = dstY0 * inv[1] + dstY1 * inv[4] + dstY2 * inv[7];
  const f = dstY0 * inv[2] + dstY1 * inv[5] + dstY2 * inv[8];

  return [a, b, c, d, e, f];
}

/**
 * Draw a pre-split tile onto a deformed quad defined by 4 corner screen positions.
 * Uses two affine-transformed drawImage calls (one per triangle half).
 */
export function drawDeformedTile(
  ctx: CanvasRenderingContext2D,
  tile: SplitTile,
  corners: TileCorners,
): void {
  // Right triangle: N → E → S
  const [ra, rb, rc, rd, re, rf] = computeAffine(
    RIGHT_INV,
    corners.nx, corners.ny,
    corners.ex, corners.ey,
    corners.sx, corners.sy,
  );

  ctx.save();
  ctx.setTransform(ra, rb, rc, rd, re, rf);
  ctx.drawImage(tile.right, 0, 0);
  ctx.restore();

  // Left triangle: N → W → S
  const [la, lb, lc, ld, le, lf] = computeAffine(
    LEFT_INV,
    corners.nx, corners.ny,
    corners.wx, corners.wy,
    corners.sx, corners.sy,
  );

  ctx.save();
  ctx.setTransform(la, lb, lc, ld, le, lf);
  ctx.drawImage(tile.left, 0, 0);
  ctx.restore();
}
