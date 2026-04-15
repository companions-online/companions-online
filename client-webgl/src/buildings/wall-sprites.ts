import { CHUNK_SIZE } from '@shared/constants.js';
import { Building } from '@shared/terrain.js';
import { getTileCornersLocal } from '../terrain/elevation.js';
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
 * Build wall drawables for one 16×16 chunk. Reads adjacency one tile outside
 * the chunk so wall shapes at the chunk border pick up neighbor-chunk walls.
 * Since wall shape depends on the tile's SE and SW neighbors, a change in
 * an adjacent chunk requires a rebuild of the chunks that share a seam —
 * Scene handles that by marking neighbor chunks dirty on any mutation.
 */
export function buildWallDrawablesForChunk(
  worldMap: WorldMap,
  wallTextures: Map<WallShape, WebGLTexture>,
  elevationLocal: Float32Array,
  chunkX: number,
  chunkY: number,
): WallDrawable[] {
  const drawables: WallDrawable[] = [];
  const originX = chunkX * CHUNK_SIZE;
  const originY = chunkY * CHUNK_SIZE;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const tx = originX + lx;
      const ty = originY + ly;
      if (worldMap.getBuilding(tx, ty) !== Building.Wall) continue;

      // Hidden faces depend on whether the adjacent SE / SW tile is a wall.
      const hasWallSE = isWall(worldMap, tx + 1, ty);
      const hasWallSW = isWall(worldMap, tx, ty + 1);

      let shape: WallShape;
      if (!hasWallSE && !hasWallSW) shape = WallShape.BothFaces;
      else if (hasWallSE && !hasWallSW) shape = WallShape.LeftOnly;
      else if (!hasWallSE && hasWallSW) shape = WallShape.RightOnly;
      else shape = WallShape.NoFace;

      const texture = wallTextures.get(shape)!;

      const corners = getTileCornersLocal(tx, ty, lx, ly, elevationLocal, 0, 0);
      const dstX = corners.wx;
      const dstY = corners.ny - WALL_HEIGHT;

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

  return drawables;
}
