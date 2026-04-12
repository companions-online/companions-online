import { MAP_SIZE } from '@shared/constants.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { TERRAIN_VARIANT_COUNTS } from '../platform/config.js';
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

/**
 * Bytes per base instance: 8 corner floats + srcLayer + animStride = 10 × 4.
 *
 * `animStride` is the number of texture-array layers to skip per animation
 * frame for this tile. 0 for static terrains. For water/river, it equals that
 * terrain's variant count — the layer table in texture-arrays.ts is laid out
 * `[terrain][frame][variant]`, so consecutive frames of the same variant sit
 * exactly `variantCount` layers apart.
 */
export const BASE_INSTANCE_STRIDE = 40;

/**
 * Bytes per overlay instance: 8 corner floats + srcLayer + maskLayer +
 * animStride = 11 × 4.
 */
export const OVERLAY_INSTANCE_STRIDE = 44;

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

  // Helper — returns the layer-frame-stride for a terrain, matching the
  // shader's `v_srcLayer = a_srcLayer + u_frame * a_animStride` formula.
  // Non-animated terrains get 0 so the shader math reduces to identity.
  const animStrideFor = (terrainId: number): number => {
    // Water (4) and River (5) are the only animated terrains today. Stride =
    // variant count because layers are laid out [terrain][frame][variant].
    return (terrainId === 4 || terrainId === 5) ? TERRAIN_VARIANT_COUNTS[terrainId] : 0;
  };

  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const tileIdx = ty * W + tx;
      const terrain = worldMap.getTerrain(tx, ty) as number;

      const corners = getTileCorners(tx, ty, elevationGrid, 0, 0);

      // --- Base instance for this tile ---------------------------------
      // Write the frame-0 layer. The vertex shader adds `u_frame * animStride`
      // at draw time, so animated water/river tiles pick the right layer per
      // frame without any CPU-side buffer patching.
      const variantCount = TERRAIN_VARIANT_COUNTS[terrain];
      const variant = tileVariant(tx, ty, variantCount);
      const baseLayer = terrainLayerIndex[terrain][0][variant];

      const baseF = tileIdx * 10;  // 10 32-bit words per base instance
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

        const nAnimStride = animStrideFor(nTerrain);

        const writeOverlay = (maskId: number) => {
          const off = overlayCount * 11;  // 11 32-bit words per overlay
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
