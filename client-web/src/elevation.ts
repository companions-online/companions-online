import { PerlinNoise } from '@shared/world/noise.js';
import { MAP_SIZE } from '@shared/constants.js';
import { Terrain } from '@shared/terrain.js';
import { TILE_W, TILE_H, PX_PER_Z } from './config.js';
import type { WorldMap } from '@shared/world/world-map.js';

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

const WATER_LEVEL = -0.02;
const SHORE_HEIGHT = 0.01;

/**
 * Build a vertex elevation grid of (mapSize+1)² entries.
 * Vertex (vx, vy) is the N corner of tile (vx, vy) and shared
 * with tiles (vx-1, vy-1), (vx, vy-1), (vx-1, vy).
 */
export function buildElevationGrid(seed: number, mapSize: number, worldMap: WorldMap): Float32Array {
  const size = mapSize + 1;
  const grid = new Float32Array(size * size);

  const elevation = new PerlinNoise(seed);
  const scale = mapSize / 128;
  const elevFreq = 0.03 / scale;
  const cx = mapSize / 2;
  const cy = mapSize / 2;
  const maxDist = mapSize * 0.45;

  // Pass 1: sample raw elevation at each vertex
  for (let vy = 0; vy < size; vy++) {
    for (let vx = 0; vx < size; vx++) {
      const dx = vx - cx;
      const dy = vy - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const mask = Math.max(0, 1 - Math.pow(dist / maxDist, 2));

      const raw = (elevation.octave2d(vx * elevFreq, vy * elevFreq, 4, 0.5) + 1) / 2;
      const e = raw - (1 - mask);
      grid[vy * size + vx] = Math.max(e, WATER_LEVEL);
    }
  }

  // Pass 2: flatten water vertices
  for (let vy = 0; vy < size; vy++) {
    for (let vx = 0; vx < size; vx++) {
      // Check the up-to-4 tiles sharing this vertex:
      // tile (vx-1,vy-1), (vx,vy-1), (vx-1,vy), (vx,vy)
      let waterCount = 0;
      let tileCount = 0;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const tx = vx + dx;
          const ty = vy + dy;
          if (tx < 0 || tx >= mapSize || ty < 0 || ty >= mapSize) continue;
          tileCount++;
          const t = worldMap.getTerrain(tx, ty) as number;
          if (t === Terrain.Water || t === Terrain.River) waterCount++;
        }
      }

      if (waterCount === tileCount && tileCount > 0) {
        // All surrounding tiles are water — flatten to water level
        grid[vy * size + vx] = WATER_LEVEL;
      } else if (waterCount > 0) {
        // Shore vertex — pull down toward water
        grid[vy * size + vx] = Math.min(grid[vy * size + vx], SHORE_HEIGHT);
      }
    }
  }

  return grid;
}

export function getVertexHeight(grid: Float32Array, vx: number, vy: number): number {
  const size = MAP_SIZE + 1;
  if (vx < 0 || vx >= size || vy < 0 || vy >= size) return 0;
  return grid[vy * size + vx];
}

export interface TileCorners {
  nx: number; ny: number; // N vertex (top)
  ex: number; ey: number; // E vertex (right)
  sx: number; sy: number; // S vertex (bottom)
  wx: number; wy: number; // W vertex (left)
}

/**
 * Compute the 4 deformed corner screen positions for tile (tx, ty).
 * Tile corners correspond to vertices: N=(tx,ty), E=(tx+1,ty), S=(tx+1,ty+1), W=(tx,ty+1).
 */
export function getTileCorners(
  tx: number, ty: number,
  grid: Float32Array,
  offsetX: number, offsetY: number,
): TileCorners {
  const zN = getVertexHeight(grid, tx, ty);
  const zE = getVertexHeight(grid, tx + 1, ty);
  const zS = getVertexHeight(grid, tx + 1, ty + 1);
  const zW = getVertexHeight(grid, tx, ty + 1);

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
