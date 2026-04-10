import type { SpriteRenderer } from './sprite-renderer.js';

/**
 * Minimal entity interface for the WebGL prototype. Update runs on every
 * frame, draw emits sprite draw calls via the shared SpriteRenderer. Entities
 * also expose their interpolated tile position so the camera can follow them
 * and a Y-sort key for rendering.
 */
export interface Entity {
  update(dt: number): void;
  draw(sprites: SpriteRenderer, offsetX: number, offsetY: number): void;
  screenY(): number;
  interpTileX(): number;
  interpTileY(): number;
}
