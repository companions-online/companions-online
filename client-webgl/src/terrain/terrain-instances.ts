import { CHUNK_SIZE, MAP_SIZE } from '@shared/constants.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { Terrain, Building } from '@shared/terrain.js';
import { TERRAIN_VARIANT_COUNTS, PX_PER_Z } from '../platform/config.js';
import { tileVariant } from './texture.js';
import { getTileCornersLocal } from './elevation.js';
import {
  gatherInfluences,
  pickAdjacentMaskId,
  pickDiagonalMaskIds,
  edgeMaskVariant,
  TERRAIN_BLEND_MODE,
  type TerrainGrid,
} from './terrain-blend.js';
import { maskLayerIndex, type TerrainLayerIndex } from './texture-arrays.js';

/**
 * Bytes per base instance: 8 corner floats + srcLayer + animStride
 * + tileX + tileY = 12 × 4.
 */
export const BASE_INSTANCE_STRIDE = 48;
/** Bytes per overlay instance: 8 corner floats + srcLayer + maskLayer +
 *  animStride + tileX + tileY = 13 × 4. */
export const OVERLAY_INSTANCE_STRIDE = 52;
/** Bytes per side instance: 8 corner floats + srcLayer + tileX + tileY = 11 × 4.
 *  Sides are opaque and non-animated, so no maskLayer / animStride. */
export const SIDE_INSTANCE_STRIDE = 44;
/** Bytes per floor-top redraw instance — same layout as a base instance so
 *  we can draw these with the base program. Used to repaint floor tops AFTER
 *  the overlay pass, overdrawing any neighbor's tilted overlay that would
 *  otherwise bite into the lifted top. */
export const TOP_INSTANCE_STRIDE = BASE_INSTANCE_STRIDE;

/** World-Z lift applied to the TOP surface of floor tiles (WoodenFloor,
 *  StoneFloor) when building their base instance. The shared per-chunk
 *  corner grid is NOT modified — this offset is applied only to the floor's
 *  own top-diamond and the top edge of its side quads, so neighboring tiles
 *  keep their natural corner heights. */
export const FLOOR_LIFT_Z = 0.25;

const TILES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;
// Upper bound: adjacent (max 4) + diagonal (max 4) overlays per tile.
const MAX_OVERLAYS_PER_TILE = 8;
// Upper bound: SE + SW side quads per floor tile.
const MAX_SIDES_PER_TILE = 2;

export interface ChunkTerrainData {
  /** Exactly TILES_PER_CHUNK × BASE_INSTANCE_STRIDE bytes. */
  baseData: ArrayBuffer;
  /** Trimmed to overlayCount × OVERLAY_INSTANCE_STRIDE bytes. */
  overlayData: ArrayBuffer;
  overlayCount: number;
  /** Trimmed to sideCount × SIDE_INSTANCE_STRIDE bytes. */
  sideData: ArrayBuffer;
  sideCount: number;
  /** Trimmed to topCount × TOP_INSTANCE_STRIDE bytes. One per floor tile —
   *  a copy of the floor's lifted base instance, re-drawn after overlay to
   *  overdraw any neighbor overlay that would bite into the lifted top. */
  topData: ArrayBuffer;
  topCount: number;
}

/** Effective render-time terrain for a tile — building floors override. */
function effectiveTerrainAt(worldMap: WorldMap, tx: number, ty: number): Terrain {
  if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return Terrain.Grass;
  const b = worldMap.getBuilding(tx, ty) as number;
  if (b === Building.WoodenFloor) return Terrain.WoodenFloor;
  if (b === Building.StoneFloor) return Terrain.StoneFloor;
  // Wall tiles keep their natural terrain so floor texture does not bleed
  // outward past the walls.
  return worldMap.getTerrain(tx, ty) as Terrain;
}

function animStrideFor(terrainId: number): number {
  // Water (4) and River (5) are the only animated terrains.
  return (terrainId === 4 || terrainId === 5) ? TERRAIN_VARIANT_COUNTS[terrainId] : 0;
}

/**
 * Build base + overlay instance data for one 16×16 chunk. Reads worldMap at
 * a 1-tile border beyond the chunk so overlays at the chunk's edge can
 * correctly sample neighbor-chunk terrain. Elevation must already be
 * computed for this chunk (17×17 corners).
 *
 * Called per chunk arrival or per tile-delta that touched this chunk. The
 * scene concatenates all chunks' overlay data into one GPU buffer.
 */
export function buildChunkTerrainData(
  worldMap: WorldMap,
  elevationLocal: Float32Array,
  chunkX: number,
  chunkY: number,
  terrainLayerIndex: TerrainLayerIndex,
): ChunkTerrainData {
  const baseData = new ArrayBuffer(BASE_INSTANCE_STRIDE * TILES_PER_CHUNK);
  const baseF32 = new Float32Array(baseData);
  const baseI32 = new Int32Array(baseData);

  const overlayCap = TILES_PER_CHUNK * MAX_OVERLAYS_PER_TILE;
  const overlayData = new ArrayBuffer(OVERLAY_INSTANCE_STRIDE * overlayCap);
  const overlayF32 = new Float32Array(overlayData);
  const overlayI32 = new Int32Array(overlayData);
  let overlayCount = 0;

  const sideCap = TILES_PER_CHUNK * MAX_SIDES_PER_TILE;
  const sideData = new ArrayBuffer(SIDE_INSTANCE_STRIDE * sideCap);
  const sideF32 = new Float32Array(sideData);
  const sideI32 = new Int32Array(sideData);
  let sideCount = 0;

  // Up to 1 top-redraw instance per tile (only floor tiles emit one).
  const topData = new ArrayBuffer(TOP_INSTANCE_STRIDE * TILES_PER_CHUNK);
  const topF32 = new Float32Array(topData);
  const topI32 = new Int32Array(topData);
  let topCount = 0;

  const effGrid: TerrainGrid = {
    getTerrain: (x, y) => effectiveTerrainAt(worldMap, x, y),
    inBounds: (x, y) => worldMap.inBounds(x, y),
  };

  const originX = chunkX * CHUNK_SIZE;
  const originY = chunkY * CHUNK_SIZE;

  const FLOOR_LIFT_PX = FLOOR_LIFT_Z * PX_PER_Z;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const tx = originX + lx;
      const ty = originY + ly;
      const terrain = effectiveTerrainAt(worldMap, tx, ty);
      const corners = getTileCornersLocal(tx, ty, lx, ly, elevationLocal, 0, 0);

      const variantCount = TERRAIN_VARIANT_COUNTS[terrain];
      const variant = tileVariant(tx, ty, variantCount);
      const baseLayer = terrainLayerIndex[terrain][0][variant];

      const isFloor = terrain === Terrain.WoodenFloor || terrain === Terrain.StoneFloor;
      // Lifted top corners for the floor's own base-diamond render. Screen-Y
      // decreases upward, so lift subtracts. The shared grid is NOT changed,
      // so the `corners` values (natural ground) are still used for the side
      // quads' bottom edges and any neighbor overlays onto this tile.
      const nyTop = isFloor ? corners.ny - FLOOR_LIFT_PX : corners.ny;
      const eyTop = isFloor ? corners.ey - FLOOR_LIFT_PX : corners.ey;
      const syTop = isFloor ? corners.sy - FLOOR_LIFT_PX : corners.sy;
      const wyTop = isFloor ? corners.wy - FLOOR_LIFT_PX : corners.wy;

      const baseF = (ly * CHUNK_SIZE + lx) * 12;
      baseF32[baseF + 0] = corners.nx;
      baseF32[baseF + 1] = corners.ex;
      baseF32[baseF + 2] = corners.sx;
      baseF32[baseF + 3] = corners.wx;
      baseF32[baseF + 4] = nyTop;
      baseF32[baseF + 5] = eyTop;
      baseF32[baseF + 6] = syTop;
      baseF32[baseF + 7] = wyTop;
      baseI32[baseF + 8] = baseLayer;
      baseI32[baseF + 9] = animStrideFor(terrain);
      baseF32[baseF + 10] = tx;
      baseF32[baseF + 11] = ty;

      if (isFloor) {
        // Top-redraw instance — identical to the base instance for this
        // tile. Drawn AFTER the overlay pass to overdraw any neighbor
        // overlay (e.g., water onto tilted grass) whose tilted screen-space
        // extent would otherwise bite into the floor's lifted top.
        const topF = topCount * 12;
        topF32[topF + 0] = corners.nx;
        topF32[topF + 1] = corners.ex;
        topF32[topF + 2] = corners.sx;
        topF32[topF + 3] = corners.wx;
        topF32[topF + 4] = nyTop;
        topF32[topF + 5] = eyTop;
        topF32[topF + 6] = syTop;
        topF32[topF + 7] = wyTop;
        topI32[topF + 8] = baseLayer;
        topI32[topF + 9] = 0; // animStride — floors don't animate.
        topF32[topF + 10] = tx;
        topF32[topF + 11] = ty;
        topCount++;

        // Side quads face SE (toward tile tx+1, ty) and SW (toward tile tx, ty+1).
        // Skip the face if the neighbor is also a floor (shared interior edge).
        const seNeighbor = effectiveTerrainAt(worldMap, tx + 1, ty);
        const seIsFloor = seNeighbor === Terrain.WoodenFloor || seNeighbor === Terrain.StoneFloor;
        const swNeighbor = effectiveTerrainAt(worldMap, tx, ty + 1);
        const swIsFloor = swNeighbor === Terrain.WoodenFloor || swNeighbor === Terrain.StoneFloor;

        const writeSide = (
          x0: number, y0: number,  // top-left  (corner id 0)
          x1: number, y1: number,  // top-right (corner id 1)
          x2: number, y2: number,  // bottom-right (corner id 2)
          x3: number, y3: number,  // bottom-left  (corner id 3)
        ) => {
          const off = sideCount * 11;
          sideF32[off + 0] = x0;
          sideF32[off + 1] = x1;
          sideF32[off + 2] = x2;
          sideF32[off + 3] = x3;
          sideF32[off + 4] = y0;
          sideF32[off + 5] = y1;
          sideF32[off + 6] = y2;
          sideF32[off + 7] = y3;
          sideI32[off + 8] = baseLayer;
          sideF32[off + 9] = tx;
          sideF32[off + 10] = ty;
          sideCount++;
        };

        // SE face: top-E (lifted) → top-S (lifted) → bottom-S (natural) → bottom-E (natural).
        if (!seIsFloor) {
          writeSide(
            corners.ex, eyTop,
            corners.sx, syTop,
            corners.sx, corners.sy,
            corners.ex, corners.ey,
          );
        }
        // SW face: top-S (lifted) → top-W (lifted) → bottom-W (natural) → bottom-S (natural).
        if (!swIsFloor) {
          writeSide(
            corners.sx, syTop,
            corners.wx, wyTop,
            corners.wx, corners.wy,
            corners.sx, corners.sy,
          );
        }
      }

      const influences = gatherInfluences(tx, ty, effGrid);
      if (influences.length === 0) continue;

      const variantOffset = edgeMaskVariant(tx, ty);

      for (const inf of influences) {
        const nTerrain = inf.terrainId;
        const nVariantCount = TERRAIN_VARIANT_COUNTS[nTerrain];
        const nVariant = tileVariant(tx, ty, nVariantCount);
        const nSrcLayer = terrainLayerIndex[nTerrain][0][nVariant];
        const blendMode = TERRAIN_BLEND_MODE[nTerrain];
        const nAnimStride = animStrideFor(nTerrain);

        const writeOverlay = (maskId: number) => {
          const off = overlayCount * 13;
          overlayF32[off + 0]  = corners.nx;
          overlayF32[off + 1]  = corners.ex;
          overlayF32[off + 2]  = corners.sx;
          overlayF32[off + 3]  = corners.wx;
          overlayF32[off + 4]  = corners.ny;
          overlayF32[off + 5]  = corners.ey;
          overlayF32[off + 6]  = corners.sy;
          overlayF32[off + 7]  = corners.wy;
          overlayI32[off + 8]  = nSrcLayer;
          overlayI32[off + 9]  = maskLayerIndex(blendMode, maskId);
          overlayI32[off + 10] = nAnimStride;
          overlayF32[off + 11] = tx;
          overlayF32[off + 12] = ty;
          overlayCount++;
        };

        const adjBase = pickAdjacentMaskId(inf.bits);
        if (adjBase !== undefined) {
          const maskId = adjBase < 16 ? adjBase + variantOffset : adjBase;
          writeOverlay(maskId);
        }

        const diagIds = pickDiagonalMaskIds(inf.bits);
        for (let i = 0; i < diagIds.length; i++) {
          writeOverlay(diagIds[i]);
        }
      }
    }
  }

  const trimmedOverlay = overlayData.slice(0, overlayCount * OVERLAY_INSTANCE_STRIDE);
  const trimmedSide = sideData.slice(0, sideCount * SIDE_INSTANCE_STRIDE);
  const trimmedTop = topData.slice(0, topCount * TOP_INSTANCE_STRIDE);
  return {
    baseData,
    overlayData: trimmedOverlay,
    overlayCount,
    sideData: trimmedSide,
    sideCount,
    topData: trimmedTop,
    topCount,
  };
}

// Compile-time sanity check — catches MAP_SIZE drift from shared constants.
if (MAP_SIZE <= 0) throw new Error(`invalid MAP_SIZE: ${MAP_SIZE}`);
