import { TILE_W, TILE_H, GRASS_VARIANTS } from './config.js';

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function isInsideDiamond(px: number, py: number): boolean {
  return Math.abs(px - HALF_W + 0.5) / HALF_W + Math.abs(py - HALF_H + 0.5) / HALF_H <= 1.0;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function generateGrassTiles(): OffscreenCanvas[] {
  const tiles: OffscreenCanvas[] = [];

  for (let v = 0; v < GRASS_VARIANTS; v++) {
    const oc = new OffscreenCanvas(TILE_W, TILE_H);
    const ctx = oc.getContext('2d')!;
    const imageData = ctx.createImageData(TILE_W, TILE_H);
    const data = imageData.data;
    const rand = lcg(v * 2654435761 + 374761393);

    for (let py = 0; py < TILE_H; py++) {
      for (let px = 0; px < TILE_W; px++) {
        if (!isInsideDiamond(px, py)) continue;

        // Base earthy green
        let r = 56, g = 120, b = 48;

        // Per-pixel noise
        r += Math.floor(rand() * 16 - 8);
        g += Math.floor(rand() * 30 - 15);
        b += Math.floor(rand() * 16 - 8);

        // Sparse tufts
        const tuft = rand();
        if (tuft < 0.05) { r += 10; g += 15; b += 8; }
        else if (tuft < 0.08) { r -= 10; g -= 12; b -= 8; }

        // Edge darkening
        const edgeDist = 1.0 - (Math.abs(px - HALF_W + 0.5) / HALF_W + Math.abs(py - HALF_H + 0.5) / HALF_H);
        if (edgeDist < 0.06) { r -= 15; g -= 18; b -= 12; }

        const i = (py * TILE_W + px) * 4;
        data[i]     = clamp(r);
        data[i + 1] = clamp(g);
        data[i + 2] = clamp(b);
        data[i + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    tiles.push(oc);
  }

  return tiles;
}

/** Deterministic variant selection per tile coordinate */
export function tileVariant(tileX: number, tileY: number, count: number): number {
  return ((tileX * 7 + tileY * 13) & 0x7fffffff) % count;
}
