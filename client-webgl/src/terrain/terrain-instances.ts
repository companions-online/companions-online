import { CHUNK_SIZE, MAP_SIZE } from '@shared/constants.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { Terrain, Building } from '@shared/terrain.js';
import { TERRAIN_VARIANT_COUNTS } from '../platform/config.js';
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
 * Bytes per base instance: 8 corner floats + srcLayer + animStride = 10 × 4.
 */
export const BASE_INSTANCE_STRIDE = 40;
/** Bytes per overlay instance: 8 corner floats + srcLayer + maskLayer +
 *  animStride = 11 × 4. */
export const OVERLAY_INSTANCE_STRIDE = 44;

const TILES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;
// Upper bound: adjacent (max 4) + diagonal (max 4) overlays per tile.
const MAX_OVERLAYS_PER_TILE = 8;

export interface ChunkTerrainData {
  /** Exactly TILES_PER_CHUNK × BASE_INSTANCE_STRIDE bytes. */
  baseData: ArrayBuffer;
  /** Trimmed to overlayCount × OVERLAY_INSTANCE_STRIDE bytes. */
  overlayData: ArrayBuffer;
  overlayCount: number;
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

  const effGrid: TerrainGrid = {
    getTerrain: (x, y) => effectiveTerrainAt(worldMap, x, y),
    inBounds: (x, y) => worldMap.inBounds(x, y),
  };

  const originX = chunkX * CHUNK_SIZE;
  const originY = chunkY * CHUNK_SIZE;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const tx = originX + lx;
      const ty = originY + ly;
      const terrain = effectiveTerrainAt(worldMap, tx, ty);
      const corners = getTileCornersLocal(tx, ty, lx, ly, elevationLocal, 0, 0);

      const variantCount = TERRAIN_VARIANT_COUNTS[terrain];
      const variant = tileVariant(tx, ty, variantCount);
      const baseLayer = terrainLayerIndex[terrain][0][variant];

      const baseF = (ly * CHUNK_SIZE + lx) * 10;
      baseF32[baseF + 0] = corners.nx;
      baseF32[baseF + 1] = corners.ex;
      baseF32[baseF + 2] = corners.sx;
      baseF32[baseF + 3] = corners.wx;
      baseF32[baseF + 4] = corners.ny;
      baseF32[baseF + 5] = corners.ey;
      baseF32[baseF + 6] = corners.sy;
      baseF32[baseF + 7] = corners.wy;
      baseI32[baseF + 8] = baseLayer;
      baseI32[baseF + 9] = animStrideFor(terrain);

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
          const off = overlayCount * 11;
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

  const trimmed = overlayData.slice(0, overlayCount * OVERLAY_INSTANCE_STRIDE);
  return { baseData, overlayData: trimmed, overlayCount };
}

// Compile-time sanity check — catches MAP_SIZE drift from shared constants.
if (MAP_SIZE <= 0) throw new Error(`invalid MAP_SIZE: ${MAP_SIZE}`);
