import { PerlinNoise } from '@shared/world/noise.js';
import { CHUNK_SIZE, MAP_SIZE } from '@shared/constants.js';
import { Terrain, Building } from '@shared/terrain.js';
import { TILE_W, TILE_H, PX_PER_Z } from '../platform/config.js';
import type { WorldMap } from '@shared/world/world-map.js';

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

const WATER_LEVEL = -0.02;
const SHORE_HEIGHT = 0.01;

/** Vertex-count for a chunk-local corner grid: (CHUNK_SIZE+1)². */
export const CHUNK_CORNER_SIZE = CHUNK_SIZE + 1;

/**
 * Build a chunk-local vertex elevation grid of (CHUNK_SIZE+1)² entries.
 * Corner (lx, ly) in the returned grid corresponds to world corner
 * (cx*CHUNK_SIZE + lx, cy*CHUNK_SIZE + ly). Per-corner elevation depends on
 * the surrounding 4 tiles via water/building flatten heuristics, so this
 * function reads a 1-tile border of worldMap data around the chunk. Tiles
 * outside the bounded map read as zero (Terrain.Grass) and self-correct when
 * neighbor chunks arrive and trigger a rebuild.
 *
 * Regenerated on-demand per chunk rebuild — not persisted.
 */
export function buildElevationGridChunk(
  seed: number,
  worldMap: WorldMap,
  chunkX: number,
  chunkY: number,
): Float32Array {
  const grid = new Float32Array(CHUNK_CORNER_SIZE * CHUNK_CORNER_SIZE);

  const elevation = new PerlinNoise(seed);
  const scale = MAP_SIZE / 128;
  const elevFreq = 0.03 / scale;
  const cx = MAP_SIZE / 2;
  const cy = MAP_SIZE / 2;
  const maxDist = MAP_SIZE * 0.45;

  const originX = chunkX * CHUNK_SIZE;
  const originY = chunkY * CHUNK_SIZE;

  // Pass 1: raw elevation per corner
  for (let ly = 0; ly < CHUNK_CORNER_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_CORNER_SIZE; lx++) {
      const vx = originX + lx;
      const vy = originY + ly;
      const dx = vx - cx;
      const dy = vy - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const mask = Math.max(0, 1 - Math.pow(dist / maxDist, 2));

      const raw = (elevation.octave2d(vx * elevFreq, vy * elevFreq, 4, 0.5) + 1) / 2;
      const e = raw - (1 - mask);
      grid[ly * CHUNK_CORNER_SIZE + lx] = Math.max(e, WATER_LEVEL);
    }
  }

  // Pass 2: water flatten. A corner fully surrounded by water tiles is
  // pulled to WATER_LEVEL; partial shore is pulled down to SHORE_HEIGHT.
  for (let ly = 0; ly < CHUNK_CORNER_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_CORNER_SIZE; lx++) {
      const vx = originX + lx;
      const vy = originY + ly;
      let waterCount = 0;
      let tileCount = 0;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = vx + dx;
          const ty = vy + dy;
          if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) continue;
          tileCount++;
          const t = worldMap.getTerrain(tx, ty) as number;
          if (t === Terrain.Water || t === Terrain.River) waterCount++;
        }
      }
      if (waterCount === tileCount && tileCount > 0) {
        grid[ly * CHUNK_CORNER_SIZE + lx] = WATER_LEVEL;
      } else if (waterCount > 0) {
        grid[ly * CHUNK_CORNER_SIZE + lx] =
          Math.min(grid[ly * CHUNK_CORNER_SIZE + lx], SHORE_HEIGHT);
      }
    }
  }

  // Pass 3: flatten corners under building footprints.
  for (let ly = 0; ly < CHUNK_CORNER_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_CORNER_SIZE; lx++) {
      const vx = originX + lx;
      const vy = originY + ly;
      let hasBuilding = false;
      for (let dy = -1; dy <= 0 && !hasBuilding; dy++) {
        for (let dx = -1; dx <= 0 && !hasBuilding; dx++) {
          const tx = vx + dx;
          const ty = vy + dy;
          if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) continue;
          if ((worldMap.getBuilding(tx, ty) as number) !== Building.None) {
            hasBuilding = true;
          }
        }
      }
      if (hasBuilding) grid[ly * CHUNK_CORNER_SIZE + lx] = SHORE_HEIGHT;
    }
  }

  return grid;
}

export interface TileCorners {
  nx: number; ny: number; // N vertex (top)
  ex: number; ey: number; // E vertex (right)
  sx: number; sy: number; // S vertex (bottom)
  wx: number; wy: number; // W vertex (left)
}

/**
 * Compute the 4 deformed corner screen positions for tile (tx, ty), reading
 * elevation from a chunk-local corner grid. (lx, ly) is the chunk-local
 * coordinate corresponding to world (tx, ty). Tile corners are at grid
 * vertices (lx, ly), (lx+1, ly), (lx+1, ly+1), (lx, ly+1).
 */
export function getTileCornersLocal(
  tx: number, ty: number,
  lx: number, ly: number,
  grid: Float32Array,
  offsetX: number, offsetY: number,
): TileCorners {
  const zN = grid[ly * CHUNK_CORNER_SIZE + lx];
  const zE = grid[ly * CHUNK_CORNER_SIZE + (lx + 1)];
  const zS = grid[(ly + 1) * CHUNK_CORNER_SIZE + (lx + 1)];
  const zW = grid[(ly + 1) * CHUNK_CORNER_SIZE + lx];

  return {
    nx: (tx - ty) * HALF_W + HALF_W + offsetX,
    ny: (tx + ty) * HALF_H - zN * PX_PER_Z + offsetY,
    ex: (tx + 1 - ty) * HALF_W + HALF_W + offsetX,
    ey: (tx + 1 + ty) * HALF_H - zE * PX_PER_Z + offsetY,
    sx: (tx - ty) * HALF_W + HALF_W + offsetX,
    sy: (tx + ty + 2) * HALF_H - zS * PX_PER_Z + offsetY,
    wx: (tx - ty - 1) * HALF_W + HALF_W + offsetX,
    wy: (tx + ty + 1) * HALF_H - zW * PX_PER_Z + offsetY,
  };
}
