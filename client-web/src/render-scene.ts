import { WATER_ANIM_FRAMES, WATER_FRAME_MS, TERRAIN_VARIANT_COUNTS } from './config.js';
import { tileVariant } from './texture.js';
import { getTileCorners } from './elevation.js';
import { drawDeformedTile } from './quad-renderer.js';
import { getTransitionsForTile } from './transitions.js';
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
  const { worldMap, terrainTiles, elevationGrid, transitions, camera, entities, time } = scene;

  const { offsetX, offsetY } = camera.getOffset();
  const bounds = camera.getVisibleBounds();
  const waterFrameIdx = Math.floor(time / WATER_FRAME_MS) % WATER_ANIM_FRAMES;

  // Clear
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(vp.x, vp.y, vp.w, vp.h);
  ctx.clip();

  // Terrain pass
  for (let ty = bounds.minTileY; ty <= bounds.maxTileY; ty++) {
    for (let tx = bounds.minTileX; tx <= bounds.maxTileX; tx++) {
      const terrain = worldMap.getTerrain(tx, ty) as number;
      const isAnimated = terrain === 4 || terrain === 5;
      const frameIdx = isAnimated ? waterFrameIdx : 0;
      const variantCount = TERRAIN_VARIANT_COUNTS[terrain];
      const vi = tileVariant(tx, ty, variantCount);

      const corners = getTileCorners(tx, ty, elevationGrid, offsetX, offsetY);
      const tile = terrainTiles[terrain][frameIdx][vi];

      drawDeformedTile(ctx, tile, corners);

      const tileTransitions = getTransitionsForTile(tx, ty, worldMap);
      for (const t of tileTransitions) {
        const overlay = t.isDiagonal
          ? transitions.diagonal[t.terrainType][t.direction]
          : transitions.cardinal[t.terrainType][t.direction];
        drawDeformedTile(ctx, overlay, corners);
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
