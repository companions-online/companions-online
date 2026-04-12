import { Building } from '@shared/terrain.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import { getTileCorners } from '../terrain/elevation.js';
import { WallShape, WALL_HEIGHT, WALL_SPRITE_W, WALL_SPRITE_H } from './wall-texture.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';

export interface WallDrawable {
  screenY: number;
  draw: (
    sprites: SpriteRenderer,
    gl: WebGL2RenderingContext,
    offsetX: number,
    offsetY: number,
  ) => void;
}

function isWall(worldMap: WorldMap, x: number, y: number): boolean {
  if (!worldMap.inBounds(x, y)) return false;
  return worldMap.getBuilding(x, y) === Building.Wall;
}

/**
 * Walk the world map, find all wall tiles, determine their auto-tile shape,
 * and produce a pre-sorted array of drawable wall sprites for the Y-sort pass.
 *
 * Positions are derived from getTileCorners — the same function the terrain
 * renderer uses to bake instance geometry — so walls align pixel-perfectly
 * with the terrain grid.
 */
export function buildWallDrawables(
  worldMap: WorldMap,
  wallTextures: Map<WallShape, WebGLTexture>,
  elevationGrid: Float32Array,
): WallDrawable[] {
  const drawables: WallDrawable[] = [];
  const W = worldMap.width;
  const H = worldMap.height;

  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      if (worldMap.getBuilding(tx, ty) !== Building.Wall) continue;

      // Determine which faces are visible. The two visible faces in iso are:
      //   Left face  (SW edge): hidden if SW neighbour (tx, ty+1) is also a wall
      //   Right face (SE edge): hidden if SE neighbour (tx+1, ty) is also a wall
      const hasWallSE = isWall(worldMap, tx + 1, ty);
      const hasWallSW = isWall(worldMap, tx, ty + 1);

      let shape: WallShape;
      if (!hasWallSE && !hasWallSW) shape = WallShape.BothFaces;
      else if (hasWallSE && !hasWallSW) shape = WallShape.LeftOnly;
      else if (!hasWallSE && hasWallSW) shape = WallShape.RightOnly;
      else shape = WallShape.NoFace;

      const texture = wallTextures.get(shape)!;

      // Use getTileCorners with offset=0 — same baked-world-space coordinates
      // the terrain renderer uses. The sprite's ground-level diamond (at sprite
      // row WALL_HEIGHT) must align with the terrain tile. So the sprite top
      // (the elevated wall-top face) sits WALL_HEIGHT pixels ABOVE the tile.
      const corners = getTileCorners(tx, ty, elevationGrid, 0, 0);
      const dstX = corners.wx;                // W corner X = left edge of diamond
      const dstY = corners.ny - WALL_HEIGHT;  // shift up so ground aligns with tile

      drawables.push({
        screenY: corners.ny,
        draw(sprites, gl, offsetX, offsetY) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          sprites.drawSprite(
            dstX + offsetX, dstY + offsetY,
            WALL_SPRITE_W, WALL_SPRITE_H,
            0, 0, 1, 1,
          );
        },
      });
    }
  }

  // Pre-sort by screenY — walls are static, so sort order never changes.
  drawables.sort((a, b) => a.screenY - b.screenY);
  return drawables;
}
