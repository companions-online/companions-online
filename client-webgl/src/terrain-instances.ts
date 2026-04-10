import { MAP_SIZE } from '@shared/constants.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { TERRAIN_VARIANT_COUNTS } from './config.js';
import { tileVariant } from './texture.js';
import { getTileCorners } from './elevation.js';
import {
  gatherInfluences,
  pickAdjacentMaskId,
  pickDiagonalMaskIds,
  edgeMaskVariant,
  TERRAIN_BLEND_MODE,
} from './terrain-blend.js';
import { maskLayerIndex, type TerrainLayerIndex } from './texture-arrays.js';

/** Bytes per base instance: 8 corner floats + 1 srcLayer int = 9 × 4. */
export const BASE_INSTANCE_STRIDE = 36;

/** Bytes per overlay instance: 8 corner floats + 2 ints = 10 × 4. */
export const OVERLAY_INSTANCE_STRIDE = 40;

export interface TerrainInstanceBuffers {
  baseData: ArrayBuffer;       // BASE_INSTANCE_STRIDE × tileCount
  baseCount: number;
  overlayData: ArrayBuffer;    // OVERLAY_INSTANCE_STRIDE × overlayCount
  overlayCount: number;
}

/**
 * Walk the entire WorldMap once and produce the base + overlay instance
 * payloads. Corners are baked in world pixel space (offset = 0) so the camera
 * only needs to update a uniform per frame.
 *
 * The overlay list is emitted in draw order:
 *   tileIdx asc → priority asc → kind asc (adjacent first, diagonal second).
 * Because `gatherInfluences` already returns influences sorted by priority and
 * we walk tiles in row-major order, simply appending records in iteration
 * order yields the correct layout — no explicit sort pass is needed.
 */
export function buildTerrainInstances(
  worldMap: WorldMap,
  elevationGrid: Float32Array,
  terrainLayerIndex: TerrainLayerIndex,
): TerrainInstanceBuffers {
  const W = worldMap.width;
  const H = worldMap.height;
  const tileCount = W * H;

  // Base buffer — one instance per tile, always populated even for water
  // (which just uses frame 0 in this static prototype).
  const baseData = new ArrayBuffer(BASE_INSTANCE_STRIDE * tileCount);
  const baseF32 = new Float32Array(baseData);
  const baseI32 = new Int32Array(baseData);

  // Overlay buffer — upper-bound allocation at 8 overlays per tile (4 adjacent
  // mask groups × max 2 contributions isn't reachable; real cap is 4 adjacent
  // + 4 diagonal = 8 per influence, × up to 5 influences, but in practice
  // average is <2). Allocate generously and trim via overlayCount on upload.
  const overlayCap = tileCount * 8;
  const overlayData = new ArrayBuffer(OVERLAY_INSTANCE_STRIDE * overlayCap);
  const overlayF32 = new Float32Array(overlayData);
  const overlayI32 = new Int32Array(overlayData);

  let overlayCount = 0;

  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const tileIdx = ty * W + tx;
      const terrain = worldMap.getTerrain(tx, ty) as number;

      const corners = getTileCorners(tx, ty, elevationGrid, 0, 0);

      // --- Base instance for this tile ---------------------------------
      const frame = 0; // animated water uses frame 0 for now
      const variantCount = TERRAIN_VARIANT_COUNTS[terrain];
      const variant = tileVariant(tx, ty, variantCount);
      const baseLayer = terrainLayerIndex[terrain][frame][variant];

      const baseF = tileIdx * 9;   // 9 32-bit words per base instance
      baseF32[baseF + 0] = corners.nx;
      baseF32[baseF + 1] = corners.ex;
      baseF32[baseF + 2] = corners.sx;
      baseF32[baseF + 3] = corners.wx;
      baseF32[baseF + 4] = corners.ny;
      baseF32[baseF + 5] = corners.ey;
      baseF32[baseF + 6] = corners.sy;
      baseF32[baseF + 7] = corners.wy;
      baseI32[baseF + 8] = baseLayer;

      // --- Overlay instances for each higher-priority neighbor --------
      // gatherInfluences returns an already-ascending-by-priority list; we
      // emit adjacent masks first, then diagonal, matching render-scene.ts.
      const influences = gatherInfluences(tx, ty, worldMap);
      if (influences.length === 0) continue;

      const variantOffset = edgeMaskVariant(tx, ty);

      for (const inf of influences) {
        const nTerrain = inf.terrainId;
        const nVariantCount = TERRAIN_VARIANT_COUNTS[nTerrain];
        const nVariant = tileVariant(tx, ty, nVariantCount);
        const nSrcLayer = terrainLayerIndex[nTerrain][0][nVariant];
        const blendMode = TERRAIN_BLEND_MODE[nTerrain];

        const writeOverlay = (maskId: number) => {
          const off = overlayCount * 10;  // 10 32-bit words per overlay
          overlayF32[off + 0] = corners.nx;
          overlayF32[off + 1] = corners.ex;
          overlayF32[off + 2] = corners.sx;
          overlayF32[off + 3] = corners.wx;
          overlayF32[off + 4] = corners.ny;
          overlayF32[off + 5] = corners.ey;
          overlayF32[off + 6] = corners.sy;
          overlayF32[off + 7] = corners.wy;
          overlayI32[off + 8] = nSrcLayer;
          overlayI32[off + 9] = maskLayerIndex(blendMode, maskId);
          overlayCount++;
        };

        // Adjacent (edge) mask — variant offset applies only to the 4 noise
        // variants at ids 0/4/8/12. Combination masks (20..30) are unique.
        const adjBase = pickAdjacentMaskId(inf.bits);
        if (adjBase !== undefined) {
          const maskId = adjBase < 16 ? adjBase + variantOffset : adjBase;
          writeOverlay(maskId);
        }

        // Diagonal point masks (16..19). Zero to four of them per influence.
        const diagIds = pickDiagonalMaskIds(inf.bits);
        for (let i = 0; i < diagIds.length; i++) {
          writeOverlay(diagIds[i]);
        }
      }
    }
  }

  // Trim overlay buffer to the exact count used.
  const trimmed = overlayData.slice(0, overlayCount * OVERLAY_INSTANCE_STRIDE);

  return {
    baseData,
    baseCount: tileCount,
    overlayData: trimmed,
    overlayCount,
  };
}

// Sanity check at module load — catches MAP_SIZE drift from the shared
// constants without having to wire a test.
if (MAP_SIZE <= 0) throw new Error(`invalid MAP_SIZE: ${MAP_SIZE}`);
