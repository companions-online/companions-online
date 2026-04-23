import { Terrain } from '@shared/terrain.js';
import { BlendMode } from './blend-masks.js';

/** Minimal interface for terrain lookups — allows override with effective terrain. */
export interface TerrainGrid {
  getTerrain(x: number, y: number): number;
  inBounds(x: number, y: number): boolean;
}

/**
 * Draw-order priority per terrain. Higher values are drawn on top of lower:
 * a neighbor contributes to the current tile only if its priority exceeds the
 * current tile's. Indexed by Terrain enum value.
 */
export const TERRAIN_PRIORITY: readonly number[] = [
  10, // Grass
  20, // Dirt
  40, // Rock
  30, // Sand
  60, // Water
  50, // River
  70, // WoodenFloor (above all natural terrain)
  70, // StoneFloor
];

/** Blend-mode (mask shape-class) per terrain. Indexed by Terrain enum value. */
export const TERRAIN_BLEND_MODE: readonly BlendMode[] = [
  BlendMode.Rough,  // Grass
  BlendMode.Rough,  // Dirt
  BlendMode.Rough,  // Rock
  BlendMode.Smooth, // Sand
  BlendMode.Short,  // Water
  BlendMode.Short,  // River
  BlendMode.Smooth, // WoodenFloor (unused — see TERRAIN_NO_OVERLAY below)
  BlendMode.Smooth, // StoneFloor  (unused — see TERRAIN_NO_OVERLAY below)
];

/** When true, this terrain type never contributes an overlay onto lower-
 *  priority neighbors — it renders strictly inside its own tile diamond with
 *  a hard edge. Used for man-made floors so they look like laid flooring
 *  instead of bleeding into the surrounding grass/dirt/river. */
export const TERRAIN_NO_OVERLAY: readonly boolean[] = [
  false, // Grass
  false, // Dirt
  false, // Rock
  false, // Sand
  false, // Water
  false, // River
  true,  // WoodenFloor
  true,  // StoneFloor
];

// ---------------------------------------------------------------------------
// Neighbor direction bits.
//
// Clockwise from screen north (spec order in docs/client/blendomatic.md):
//
//         0 (N)
//    7 (NW)   1 (NE)
//  6 (W)   @   2 (E)
//    5 (SW)   3 (SE)
//         4 (S)
//
// Tile offsets in iso grid coords (remember: (+1, 0) moves SE on screen,
// (0, +1) moves SW, so screen-north is (-1, -1) in tile space):
//
//   idx dir  (dx, dy)
//    0  N    (-1, -1)
//    1  NE   ( 0, -1)
//    2  E    ( 1, -1)
//    3  SE   ( 1,  0)
//    4  S    ( 1,  1)
//    5  SW   ( 0,  1)
//    6  W    (-1,  1)
//    7  NW   (-1,  0)
//
// "Adjacent" bits are the iso-edge-sharing neighbors (NE/SE/SW/NW, bits
// 1,3,5,7). "Diagonal" bits are the iso-vertex-only neighbors that appear
// straight-cardinal on screen (N/E/S/W, bits 0,2,4,6).
// ---------------------------------------------------------------------------

const NEIGHBOR_DX = [-1, 0, 1, 1, 1, 0, -1, -1];
const NEIGHBOR_DY = [-1, -1, -1, 0, 1, 1, 1, 0];

const ADJACENT_MASK = 0b10101010;

export interface Influence {
  terrainId: number;
  /** Bitmask of neighbor indices (0..7) that contribute this terrain. */
  bits: number;
  priority: number;
  blendMode: BlendMode;
}

/**
 * Gather all higher-priority neighbor influences for tile (tx, ty), grouped by
 * terrain. Returned list is sorted ascending by priority so the caller draws
 * lowest-priority overlays first and highest last.
 *
 * Diagonal (N/E/S/W screen) neighbors are suppressed if either of their two
 * iso-adjacent neighbors already contributes the SAME terrain — avoids
 * double-drawing the dominant texture at convex corners.
 */
export function gatherInfluences(
  tx: number,
  ty: number,
  terrainGrid: TerrainGrid,
): Influence[] {
  const centerTerrain = terrainGrid.getTerrain(tx, ty) as number;
  const centerPriority = TERRAIN_PRIORITY[centerTerrain];

  const influences = new Map<number, Influence>();

  const getOrCreate = (terrainId: number, priority: number): Influence => {
    let inf = influences.get(terrainId);
    if (!inf) {
      inf = {
        terrainId,
        bits: 0,
        priority,
        blendMode: TERRAIN_BLEND_MODE[terrainId],
      };
      influences.set(terrainId, inf);
    }
    return inf;
  };

  // Pass 1: iso-adjacent neighbors (bits 1, 3, 5, 7).
  const adjacentDirs = [1, 3, 5, 7] as const;
  for (const i of adjacentDirs) {
    const nx = tx + NEIGHBOR_DX[i];
    const ny = ty + NEIGHBOR_DY[i];
    if (!terrainGrid.inBounds(nx, ny)) continue;

    const nTerrain = terrainGrid.getTerrain(nx, ny) as number;
    if (nTerrain === centerTerrain) continue;

    const nPriority = TERRAIN_PRIORITY[nTerrain];
    if (nPriority <= centerPriority) continue;
    if (TERRAIN_NO_OVERLAY[nTerrain]) continue;

    getOrCreate(nTerrain, nPriority).bits |= 1 << i;
  }

  // Pass 2: iso-diagonal neighbors (bits 0, 2, 4, 6) with suppression.
  const diagonalDirs = [0, 2, 4, 6] as const;
  for (const i of diagonalDirs) {
    const nx = tx + NEIGHBOR_DX[i];
    const ny = ty + NEIGHBOR_DY[i];
    if (!terrainGrid.inBounds(nx, ny)) continue;

    const nTerrain = terrainGrid.getTerrain(nx, ny) as number;
    if (nTerrain === centerTerrain) continue;

    const nPriority = TERRAIN_PRIORITY[nTerrain];
    if (nPriority <= centerPriority) continue;
    if (TERRAIN_NO_OVERLAY[nTerrain]) continue;

    // Suppression: if either adjacent neighbor of this diagonal (i-1, i+1 mod 8)
    // already contributes the same terrain, skip — its edge mask already covers
    // this corner and a point mask on top would duplicate coverage.
    const existing = influences.get(nTerrain);
    if (existing) {
      const adjBitsOfThisDiagonal =
        (1 << ((i + 7) & 7)) | (1 << ((i + 1) & 7));
      if ((existing.bits & adjBitsOfThisDiagonal) !== 0) continue;
    }

    getOrCreate(nTerrain, nPriority).bits |= 1 << i;
  }

  return [...influences.values()].sort((a, b) => a.priority - b.priority);
}

/**
 * Pick the combined mask id (0..30) representing all iso-adjacent (NE/SE/SW/NW)
 * contributions in `bits`. Returns undefined when no adjacent bits are set.
 *
 * For edge masks 0..15 this returns the BASE id (0, 4, 8, 12); the caller adds
 * a variant offset via edgeMaskVariant() to break up repetition across tiles.
 */
export function pickAdjacentMaskId(bits: number): number | undefined {
  const adj = bits & ADJACENT_MASK;
  switch (adj) {
    case 0:          return undefined;
    case 0b00001000: return 0;  // SE only  → lower-right edge
    case 0b00000010: return 4;  // NE only  → upper-right edge
    case 0b00100000: return 8;  // SW only  → lower-left edge
    case 0b10000000: return 12; // NW only  → upper-left edge
    case 0b00100010: return 20; // NE + SW  → opposite diagonals
    case 0b10001000: return 21; // SE + NW  → opposite diagonals
    case 0b10100000: return 22; // SW + NW  → left pair
    case 0b10000010: return 23; // NE + NW  → top pair
    case 0b00101000: return 24; // SE + SW  → bottom pair
    case 0b00001010: return 25; // NE + SE  → right pair
    case 0b00101010: return 26; // 3 of 4, keep NW
    case 0b10101000: return 27; // 3 of 4, keep NE
    case 0b10100010: return 28; // 3 of 4, keep SE
    case 0b10001010: return 29; // 3 of 4, keep SW
    case 0b10101010: return 30; // all four
    default:         return undefined;
  }
}

/**
 * Return the point-mask ids (16..19) to draw for the iso-diagonal (N/E/S/W)
 * bits in `bits`. Empty when no diagonal bits are set.
 */
export function pickDiagonalMaskIds(bits: number): number[] {
  const result: number[] = [];
  if (bits & 0b00000100) result.push(16); // E  (bit 2) → right point
  if (bits & 0b00010000) result.push(17); // S  (bit 4) → down  point
  if (bits & 0b00000001) result.push(18); // N  (bit 0) → up    point
  if (bits & 0b01000000) result.push(19); // W  (bit 6) → left  point
  return result;
}

/**
 * Deterministic variant offset [0..3] for edge masks 0..15, selected by tile
 * coordinates. Breaks obvious tiling when adjacent tiles use the same edge
 * mask. Same multiplicative-XOR hash as texture.tileVariant() — see that
 * function for the rationale on why a linear `tx*a + ty*b mod N` hash
 * collapses along iso screen rows for unfortunate (a, b, N) combinations.
 * The `& 3` here happens to be safe with the old constants (count=4 escaped
 * the trap) but using the proper hash makes future variant-count tweaks
 * non-load-bearing.
 */
export function edgeMaskVariant(tx: number, ty: number): number {
  let h = Math.imul(tx | 0, 0x27d4eb2d);
  h ^= Math.imul(ty | 0, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) & 3;
}

// Re-export Terrain so callers in client-webgl can work without reaching into
// @shared directly for one value.
export { Terrain };
