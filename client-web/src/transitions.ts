import { TILE_W, TILE_H, TERRAIN_COUNT } from './config.js';
import { TERRAIN_STYLES, isInsideDiamond, diamondEdgeDist } from './texture.js';
import { splitTile, type SplitTile } from './quad-renderer.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { Terrain } from '@shared/terrain.js';

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

/** How far the neighbor color bleeds inward (0-1, fraction of diamond radius) */
const BLEED_DIST = 0.3;

/** Cardinal directions: N=0, E=1, S=2, W=3 */
const DIR_COUNT = 4;
/** Diagonal directions: NE=0, SE=1, SW=2, NW=3 */
const DIAG_COUNT = 4;

/**
 * Compute normalized distance from a pixel to a specific diamond edge.
 * Returns 0 at the edge, 1 at the opposite edge.
 *
 * Diamond edges in a 64x32 tile:
 *   N edge: top-left  (from W corner to N corner, i.e., left-top slope)
 *   ... actually the 4 edges of the diamond connect N-E, E-S, S-W, W-N.
 *
 * For blending toward a cardinal neighbor, we measure distance from the
 * diamond edge closest to that neighbor:
 *   N neighbor → top edges (W-N and N-E)
 *   E neighbor → right edges (N-E and E-S)
 *   S neighbor → bottom edges (E-S and S-W)
 *   W neighbor → left edges (S-W and W-N)
 */
function edgeDistCardinal(px: number, py: number, direction: number): number {
  // Normalize pixel to [-1,1] range from diamond center
  const nx = (px - HALF_W + 0.5) / HALF_W;  // -1 at left, +1 at right
  const ny = (py - HALF_H + 0.5) / HALF_H;  // -1 at top, +1 at bottom

  // Distance from each diamond edge (positive = inside)
  // The diamond is |nx| + |ny| <= 1
  // Each edge corresponds to one quadrant of this constraint:
  //   N-E edge: nx + (-ny) = 1 → dist from this edge = 1 - nx + ny (for nx>0, ny<0 region)
  //   ... simpler: measure how close to the neighbor's side

  switch (direction) {
    case 0: return (1 + ny) / 2;  // N: 0 at top (ny=-1), 1 at bottom
    case 1: return (1 - nx) / 2;  // E: 0 at right (nx=+1), 1 at left
    case 2: return (1 - ny) / 2;  // S: 0 at bottom (ny=+1), 1 at top
    case 3: return (1 + nx) / 2;  // W: 0 at left (nx=-1), 1 at right
    default: return 1;
  }
}

/**
 * Distance from a pixel to a diagonal corner of the diamond.
 *   NE corner = E vertex (right): pixel at (TILE_W, HALF_H)
 *   SE corner = S vertex (bottom): pixel at (HALF_W, TILE_H)
 *   SW corner = W vertex (left): pixel at (0, HALF_H)
 *   NW corner = N vertex (top): pixel at (HALF_W, 0)
 */
function cornerDist(px: number, py: number, diagonal: number): number {
  let cx: number, cy: number;
  switch (diagonal) {
    case 0: cx = TILE_W; cy = HALF_H; break;  // NE → E vertex
    case 1: cx = HALF_W; cy = TILE_H; break;  // SE → S vertex
    case 2: cx = 0;      cy = HALF_H; break;  // SW → W vertex
    case 3: cx = HALF_W; cy = 0;      break;  // NW → N vertex
    default: cx = HALF_W; cy = HALF_H; break;
  }
  const dx = (px - cx) / TILE_W;
  const dy = (py - cy) / TILE_H;
  return Math.sqrt(dx * dx + dy * dy) * 2; // normalize so corner = 0, center ≈ 1
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Generate a single transition overlay for a cardinal direction.
 * The overlay contains the neighbor terrain's base color with alpha
 * fading from opaque at the edge to transparent at BLEED_DIST inward.
 */
function generateCardinalOverlay(terrainType: number, direction: number): OffscreenCanvas {
  const style = TERRAIN_STYLES[terrainType];
  const oc = new OffscreenCanvas(TILE_W, TILE_H);
  const ctx = oc.getContext('2d')!;
  const imageData = ctx.createImageData(TILE_W, TILE_H);
  const data = imageData.data;

  for (let py = 0; py < TILE_H; py++) {
    for (let px = 0; px < TILE_W; px++) {
      if (!isInsideDiamond(px, py)) continue;

      const d = edgeDistCardinal(px, py, direction);
      if (d >= BLEED_DIST) continue;

      const alpha = Math.round((1 - d / BLEED_DIST) * 180);
      const i = (py * TILE_W + px) * 4;
      data[i]     = clamp255(style.baseR);
      data[i + 1] = clamp255(style.baseG);
      data[i + 2] = clamp255(style.baseB);
      data[i + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return oc;
}

/**
 * Generate a diagonal corner transition overlay.
 * Bleeds the neighbor color from a corner inward.
 */
function generateDiagonalOverlay(terrainType: number, diagonal: number): OffscreenCanvas {
  const style = TERRAIN_STYLES[terrainType];
  const oc = new OffscreenCanvas(TILE_W, TILE_H);
  const ctx = oc.getContext('2d')!;
  const imageData = ctx.createImageData(TILE_W, TILE_H);
  const data = imageData.data;

  const bleedRadius = BLEED_DIST * 0.8; // slightly tighter for corners

  for (let py = 0; py < TILE_H; py++) {
    for (let px = 0; px < TILE_W; px++) {
      if (!isInsideDiamond(px, py)) continue;

      const d = cornerDist(px, py, diagonal);
      if (d >= bleedRadius) continue;

      const alpha = Math.round((1 - d / bleedRadius) * 140);
      const i = (py * TILE_W + px) * 4;
      data[i]     = clamp255(style.baseR);
      data[i + 1] = clamp255(style.baseG);
      data[i + 2] = clamp255(style.baseB);
      data[i + 3] = alpha;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return oc;
}

export interface TransitionOverlays {
  cardinal: SplitTile[][];  // [terrainType][direction] — 4 cardinal
  diagonal: SplitTile[][];  // [terrainType][diagonal] — 4 diagonal corners
}

/**
 * Pre-generate all transition overlays, pre-split for the quad renderer.
 */
export function generateTransitionOverlays(): TransitionOverlays {
  const cardinal: SplitTile[][] = [];
  const diagonal: SplitTile[][] = [];

  for (let t = 0; t < TERRAIN_COUNT; t++) {
    const cardDirs: SplitTile[] = [];
    const diagDirs: SplitTile[] = [];

    for (let d = 0; d < DIR_COUNT; d++) {
      cardDirs.push(splitTile(generateCardinalOverlay(t, d)));
    }
    for (let d = 0; d < DIAG_COUNT; d++) {
      diagDirs.push(splitTile(generateDiagonalOverlay(t, d)));
    }

    cardinal.push(cardDirs);
    diagonal.push(diagDirs);
  }

  return { cardinal, diagonal };
}

// Cardinal neighbor offsets: N, E, S, W
const CARD_DX = [0, 1, 0, -1];
const CARD_DY = [-1, 0, 1, 0];

// Diagonal neighbor offsets: NE, SE, SW, NW
const DIAG_DX = [1, 1, -1, -1];
const DIAG_DY = [-1, 1, 1, -1];

export interface TransitionEntry {
  terrainType: number;
  direction: number;
  isDiagonal: boolean;
}

/**
 * Determine which transition overlays to draw for a tile at (tx, ty).
 * Returns entries for each differing cardinal and diagonal neighbor.
 */
export function getTransitionsForTile(
  tx: number, ty: number,
  worldMap: WorldMap,
): TransitionEntry[] {
  const centerTerrain = worldMap.getTerrain(tx, ty) as number;
  const entries: TransitionEntry[] = [];

  // Cardinal neighbors
  for (let d = 0; d < DIR_COUNT; d++) {
    const nx = tx + CARD_DX[d];
    const ny = ty + CARD_DY[d];
    if (!worldMap.inBounds(nx, ny)) continue;
    const neighborTerrain = worldMap.getTerrain(nx, ny) as number;
    if (neighborTerrain !== centerTerrain) {
      entries.push({ terrainType: neighborTerrain, direction: d, isDiagonal: false });
    }
  }

  // Diagonal neighbors (for river connectivity and general polish)
  for (let d = 0; d < DIAG_COUNT; d++) {
    const nx = tx + DIAG_DX[d];
    const ny = ty + DIAG_DY[d];
    if (!worldMap.inBounds(nx, ny)) continue;
    const neighborTerrain = worldMap.getTerrain(nx, ny) as number;
    if (neighborTerrain === centerTerrain) continue;

    // Only draw diagonal transition if BOTH adjacent cardinal neighbors
    // differ from this diagonal neighbor — otherwise the cardinal
    // transitions already cover the bleed.
    // For diagonal d, the two relevant cardinals are d and (d+1)%4.
    const card1x = tx + CARD_DX[d];
    const card1y = ty + CARD_DY[d];
    const card2x = tx + CARD_DX[(d + 1) % DIR_COUNT];
    const card2y = ty + CARD_DY[(d + 1) % DIR_COUNT];

    const card1 = worldMap.inBounds(card1x, card1y)
      ? worldMap.getTerrain(card1x, card1y) as number
      : -1;
    const card2 = worldMap.inBounds(card2x, card2y)
      ? worldMap.getTerrain(card2x, card2y) as number
      : -1;

    // Draw the diagonal bleed when both cardinals are NOT the diagonal's
    // terrain type — i.e., the diagonal neighbor is only connected diagonally
    if (card1 !== neighborTerrain && card2 !== neighborTerrain) {
      entries.push({ terrainType: neighborTerrain, direction: d, isDiagonal: true });
    }
  }

  return entries;
}
