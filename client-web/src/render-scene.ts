import { WATER_ANIM_FRAMES, WATER_FRAME_MS, TERRAIN_VARIANT_COUNTS } from './config.js';
import { tileVariant } from './texture.js';
import { getTileCorners } from './elevation.js';
import { drawDeformedTile } from './quad-renderer.js';
import {
  gatherInfluences,
  pickAdjacentMaskId,
  pickDiagonalMaskIds,
  edgeMaskVariant,
} from './terrain-blend.js';
import type { Scene } from './scene.js';

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Render one frame: terrain + transitions + Y-sorted entities.
 * Pure drawing — caller is responsible for updating entities before calling.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  width: number,
  height: number,
  viewport?: Viewport,
): void {
  const vp = viewport ?? { x: 0, y: 0, w: width, h: height };
  const { worldMap, terrainTiles, maskedTerrain, elevationGrid, camera, entities, time } = scene;

  const { offsetX, offsetY } = camera.getOffset();
  const bounds = camera.getVisibleBounds();
  const waterFrameIdx = Math.floor(time / WATER_FRAME_MS) % WATER_ANIM_FRAMES;

  // Clear
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  // Nearest-neighbor sampling — avoids anti-alias fringing along tile diamond
  // edges, which would otherwise show as dark-grey seams between adjacent
  // tiles when the affine transform maps source pixels to fractional dest
  // coordinates.
  // ctx.imageSmoothingEnabled = false;
  ctx.beginPath();
  ctx.rect(vp.x, vp.y, vp.w, vp.h);
  ctx.clip();

  // Terrain pass — base tile first, then blendomatic overlays sorted by
  // ascending neighbor priority so higher-priority terrain wins on top.
  for (let ty = bounds.minTileY; ty <= bounds.maxTileY; ty++) {
    for (let tx = bounds.minTileX; tx <= bounds.maxTileX; tx++) {
      const terrain = worldMap.getTerrain(tx, ty) as number;
      const isAnimated = terrain === 4 || terrain === 5;
      const frameIdx = isAnimated ? waterFrameIdx : 0;
      const vi = tileVariant(tx, ty, TERRAIN_VARIANT_COUNTS[terrain]);

      const corners = getTileCorners(tx, ty, elevationGrid, offsetX, offsetY);
      drawDeformedTile(ctx, terrainTiles[terrain][frameIdx][vi], corners);

      // Per-neighbor blend overlays. gatherInfluences groups 8-neighbor bits
      // by terrain type (suppressing iso-diagonals whose iso-adjacents already
      // fire) and returns them sorted ascending by priority.
      const influences = gatherInfluences(tx, ty, worldMap);
      if (influences.length === 0) continue;

      const variantOffset = edgeMaskVariant(tx, ty);

      for (const inf of influences) {
        const nt = inf.terrainId;
        const nAnimated = nt === 4 || nt === 5;
        const nFrame = nAnimated ? waterFrameIdx : 0;
        const nVariant = tileVariant(tx, ty, TERRAIN_VARIANT_COUNTS[nt]);
        const stack = maskedTerrain[nt][nFrame][nVariant];

        const adjBase = pickAdjacentMaskId(inf.bits);
        if (adjBase !== undefined) {
          // Edge masks 0..15 have 4 noise variants; combination masks 20..30 don't.
          const maskId = adjBase < 16 ? adjBase + variantOffset : adjBase;
          drawDeformedTile(ctx, stack[maskId], corners);
        }

        const diagIds = pickDiagonalMaskIds(inf.bits);
        for (let i = 0; i < diagIds.length; i++) {
          drawDeformedTile(ctx, stack[diagIds[i]], corners);
        }
      }
    }
  }

  // Entity pass (Y-sorted)
  if (entities.length > 0) {
    const sorted = entities.slice().sort((a, b) => a.screenY() - b.screenY());
    for (const e of sorted) {
      e.draw(ctx, offsetX, offsetY);
    }
  }

  ctx.restore();
}
