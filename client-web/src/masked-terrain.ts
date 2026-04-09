import { TILE_W, TILE_H, TERRAIN_COUNT } from './config.js';
import { splitTile, type SplitTile } from './quad-renderer.js';
import { MASKS_PER_MODE, type BlendMaskSet } from './blend-masks.js';
import { TERRAIN_BLEND_MODE } from './terrain-blend.js';

/**
 * Pre-computed, alpha-masked terrain tiles ready for the quad renderer.
 * Indexed as `[terrainId][frame][variant][maskId]` → SplitTile.
 *
 * At render time, the renderer picks the maskId(s) for an influencing
 * neighbor (via terrain-blend.gatherInfluences / pickAdjacentMaskId /
 * pickDiagonalMaskIds) and draws the corresponding SplitTile through
 * drawDeformedTile on top of the base tile, using the base tile's deformed
 * corners so transitions track elevation.
 */
export type MaskedTerrainTiles = SplitTile[][][][];

/**
 * Compose one masked tile: draw the terrain tile onto a fresh canvas, then
 * composite the mask with 'destination-in' so only pixels where the mask has
 * alpha > 0 survive. Caller typically splitTile()s the result.
 */
function maskTile(terrainTile: OffscreenCanvas, mask: OffscreenCanvas): OffscreenCanvas {
  const oc = new OffscreenCanvas(TILE_W, TILE_H);
  const ctx = oc.getContext('2d')!;
  ctx.drawImage(terrainTile, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return oc;
}

/**
 * Pre-compute the masked tile set for every terrain. Each terrain gets 31
 * masked tiles per (frame, variant) — one per mask id — using only the mask
 * set for its blend mode (so we never mask grass through the short-shore
 * falloff, for example).
 *
 * Memory envelope on the default terrain set (grass/dirt/rock/sand 1 frame,
 * water/river 4 frames): ~900 SplitTiles, each 2 canvases → ~1800 canvases of
 * 64×32×4B ≈ 15 MB. Acceptable for a Phase-C prototype; can be trimmed later
 * by computing masked tiles on demand if needed.
 */
export function buildMaskedTerrain(
  rawTerrainTiles: OffscreenCanvas[][][],
  masks: BlendMaskSet,
): MaskedTerrainTiles {
  const result: MaskedTerrainTiles = [];

  for (let t = 0; t < TERRAIN_COUNT; t++) {
    const modeMasks = masks[TERRAIN_BLEND_MODE[t]];
    const frames = rawTerrainTiles[t];
    const byFrame: SplitTile[][][] = [];

    for (let f = 0; f < frames.length; f++) {
      const variants = frames[f];
      const byVariant: SplitTile[][] = [];

      for (let v = 0; v < variants.length; v++) {
        const base = variants[v];
        const byMask: SplitTile[] = new Array(MASKS_PER_MODE);
        for (let k = 0; k < MASKS_PER_MODE; k++) {
          const composite = maskTile(base, modeMasks[k]);
          byMask[k] = splitTile(composite);
        }
        byVariant.push(byMask);
      }
      byFrame.push(byVariant);
    }
    result.push(byFrame);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Debug helper — sanity-check that masking produces sensible per-terrain tiles
// before Phase D wires the renderer. Shows frame 0 / variant 0 for every
// terrain, across the 31 mask ids, alongside the unmasked base tile.
// ---------------------------------------------------------------------------

const ATLAS_PADDING = 6;
const ATLAS_LABEL_W = 48;
const ATLAS_HEADER_H = 16;

const TERRAIN_NAMES = ['grass', 'dirt', 'rock', 'sand', 'water', 'river'];

/**
 * Draw a 6 × 32 atlas (terrain rows × [base + 31 masks]). Base tiles render
 * onto a dark background so masked-away regions are visibly transparent.
 */
export function drawMaskedTerrainAtlas(
  ctx: CanvasRenderingContext2D,
  rawTerrainTiles: OffscreenCanvas[][][],
  maskedTerrain: MaskedTerrainTiles,
  width: number,
  height: number,
): void {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, width, height);

  const cellW = TILE_W + ATLAS_PADDING;
  const cellH = TILE_H + ATLAS_PADDING;

  ctx.font = '10px monospace';
  ctx.textBaseline = 'top';

  // Column headers: "base", then mask ids 0..30.
  ctx.fillStyle = '#888';
  ctx.fillText('base', ATLAS_LABEL_W + 4, 2);
  for (let k = 0; k < MASKS_PER_MODE; k++) {
    ctx.fillText(String(k), ATLAS_LABEL_W + cellW + k * cellW + 2, 2);
  }

  for (let t = 0; t < TERRAIN_COUNT; t++) {
    const rowY = ATLAS_HEADER_H + t * cellH;

    ctx.fillStyle = '#888';
    ctx.fillText(TERRAIN_NAMES[t] ?? `t${t}`, 4, rowY + TILE_H / 2 - 5);

    // Base tile at col 0 for reference.
    ctx.fillStyle = '#262626';
    ctx.fillRect(ATLAS_LABEL_W, rowY, TILE_W, TILE_H);
    ctx.drawImage(rawTerrainTiles[t][0][0], ATLAS_LABEL_W, rowY);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(ATLAS_LABEL_W + 0.5, rowY + 0.5, TILE_W - 1, TILE_H - 1);

    // Masked tiles at cols 1..31. Rebuilt from the two SplitTile halves.
    for (let k = 0; k < MASKS_PER_MODE; k++) {
      const cellX = ATLAS_LABEL_W + cellW + k * cellW;
      ctx.fillStyle = '#262626';
      ctx.fillRect(cellX, rowY, TILE_W, TILE_H);

      const split = maskedTerrain[t][0][0][k];
      ctx.drawImage(split.left, cellX, rowY);
      ctx.drawImage(split.right, cellX, rowY);

      ctx.strokeStyle = '#333';
      ctx.strokeRect(cellX + 0.5, rowY + 0.5, TILE_W - 1, TILE_H - 1);
    }
  }
}
