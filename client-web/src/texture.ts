import { TILE_W, TILE_H, TERRAIN_COUNT, TERRAIN_VARIANT_COUNTS, WATER_ANIM_FRAMES, DEBUG_VIEW } from './config.js';
import { splitTile, type SplitTile } from './quad-renderer.js';

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function isInsideDiamond(px: number, py: number): boolean {
  return Math.abs(px - HALF_W + 0.5) / HALF_W + Math.abs(py - HALF_H + 0.5) / HALF_H <= 1.0;
}

/** Normalized distance from center to diamond edge (0 = center, 1 = edge) */
export function diamondEdgeDist(px: number, py: number): number {
  return Math.abs(px - HALF_W + 0.5) / HALF_W + Math.abs(py - HALF_H + 0.5) / HALF_H;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export interface TerrainStyle {
  baseR: number; baseG: number; baseB: number;
  noiseR: number; noiseG: number; noiseB: number;
  edgeDarken: number;
  features(rand: () => number, r: number, g: number, b: number): [number, number, number];
}

export const TERRAIN_STYLES: readonly TerrainStyle[] = [
  // Grass (0)
  {
    baseR: 56, baseG: 120, baseB: 48,
    noiseR: 8, noiseG: 15, noiseB: 8,
    edgeDarken: 1.0,
    features(rand, r, g, b) {
      const v = rand();
      if (v < 0.05) return [r + 10, g + 15, b + 8];
      if (v < 0.08) return [r - 10, g - 12, b - 8];
      return [r, g, b];
    },
  },
  // Dirt (1)
  {
    baseR: 120, baseG: 90, baseB: 55,
    noiseR: 10, noiseG: 8, noiseB: 6,
    edgeDarken: 1.0,
    features(rand, r, g, b) {
      const v = rand();
      if (v < 0.04) return [r + 15, g + 12, b + 10];
      if (v < 0.06) return [r - 12, g - 10, b - 8];
      return [r, g, b];
    },
  },
  // Rock (2)
  {
    baseR: 110, baseG: 105, baseB: 100,
    noiseR: 12, noiseG: 12, noiseB: 12,
    edgeDarken: 1.2,
    features(rand, r, g, b) {
      const v = rand();
      if (v < 0.06) return [r + 20, g + 18, b + 16];
      if (v < 0.10) return [r - 18, g - 16, b - 14];
      return [r, g, b];
    },
  },
  // Sand (3)
  {
    baseR: 194, baseG: 178, baseB: 128,
    noiseR: 8, noiseG: 6, noiseB: 5,
    edgeDarken: 0.8,
    features(rand, r, g, b) {
      const v = rand();
      if (v < 0.03) return [r + 8, g + 4, b - 2];
      return [r, g, b];
    },
  },
  // Water (4)
  {
    baseR: 30, baseG: 70, baseB: 140,
    noiseR: 6, noiseG: 10, noiseB: 15,
    edgeDarken: 1.5,
    features(rand, r, g, b) {
      const v = rand();
      if (v < 0.04) return [r + 15, g + 20, b + 25];
      if (v < 0.07) return [r - 8, g - 6, b - 4];
      return [r, g, b];
    },
  },
  // River (5)
  {
    baseR: 40, baseG: 90, baseB: 150,
    noiseR: 5, noiseG: 8, noiseB: 12,
    edgeDarken: 1.3,
    features(rand, r, g, b) {
      const v = rand();
      if (v < 0.05) return [r + 12, g + 16, b + 20];
      if (v < 0.08) return [r - 6, g - 4, b - 3];
      return [r, g, b];
    },
  },
];

function generateSingleTile(
  terrainType: number,
  variantIndex: number,
  frameIndex: number,
  style: TerrainStyle,
): OffscreenCanvas {
  const oc = new OffscreenCanvas(TILE_W, TILE_H);
  const ctx = oc.getContext('2d')!;
  const imageData = ctx.createImageData(TILE_W, TILE_H);
  const data = imageData.data;

  // Shift seed per frame for animation variation
  const seed = (terrainType * TERRAIN_COUNT + variantIndex) * 2654435761
    + 374761393
    + frameIndex * 999331;
  const rand = lcg(seed);

  // Per-frame color modulation for water/river
  const isWater = terrainType === 4 || terrainType === 5;
  const frameColorShift = isWater ? Math.sin(frameIndex * Math.PI / 2) * 3 : 0;

  for (let py = 0; py < TILE_H; py++) {
    for (let px = 0; px < TILE_W; px++) {
      if (!isInsideDiamond(px, py)) continue;

      let r = style.baseR + Math.floor(rand() * style.noiseR * 2 - style.noiseR);
      let g = style.baseG + Math.floor(rand() * style.noiseG * 2 - style.noiseG);
      let b = style.baseB + Math.floor(rand() * style.noiseB * 2 - style.noiseB) + frameColorShift;

      [r, g, b] = style.features(rand, r, g, b);

      if (DEBUG_VIEW) {
        const edgeDist = 1.0 - diamondEdgeDist(px, py);
        if (edgeDist < 0.06) {
          const darken = 15 * style.edgeDarken;
          r -= darken;
          g -= darken * 1.2;
          b -= darken * 0.8;
        }
      }

      const i = (py * TILE_W + px) * 4;
      data[i]     = clamp(r);
      data[i + 1] = clamp(g);
      data[i + 2] = clamp(b);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return oc;
}

/**
 * Generate all terrain tile textures, pre-split for the quad renderer.
 * Returns [terrainType][frameIndex][variant] = SplitTile.
 *
 * Non-animated terrain types have 1 frame (frameIndex always 0).
 * Water (4) and River (5) have WATER_ANIM_FRAMES frames.
 */
export function generateTerrainTiles(): SplitTile[][][] {
  const allTiles: SplitTile[][][] = [];

  for (let t = 0; t < TERRAIN_COUNT; t++) {
    const style = TERRAIN_STYLES[t];
    const variantCount = TERRAIN_VARIANT_COUNTS[t];
    const isAnimated = t === 4 || t === 5;
    const frameCount = isAnimated ? WATER_ANIM_FRAMES : 1;

    const frames: SplitTile[][] = [];
    for (let f = 0; f < frameCount; f++) {
      const variants: SplitTile[] = [];
      for (let v = 0; v < variantCount; v++) {
        const tile = generateSingleTile(t, v, f, style);
        variants.push(splitTile(tile));
      }
      frames.push(variants);
    }
    allTiles.push(frames);
  }

  return allTiles;
}

/** Deterministic variant selection per tile coordinate */
export function tileVariant(tileX: number, tileY: number, count: number): number {
  return ((tileX * 7 + tileY * 13) & 0x7fffffff) % count;
}
