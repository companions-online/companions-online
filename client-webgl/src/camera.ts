import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H, CANVAS_W, CANVAS_H } from './config.js';

/**
 * Minimal follow camera. The getOffset() value is the world→screen pixel
 * translation applied uniformly to all tile corners and sprite positions.
 * No elevation awareness, no viewport culling — the whole map is drawn.
 */
export class Camera {
  constructor(public centerTileX: number, public centerTileY: number) {}

  follow(tileX: number, tileY: number): void {
    this.centerTileX = tileX;
    this.centerTileY = tileY;
  }

  getOffset(): [number, number] {
    const center = tileToScreen(this.centerTileX, this.centerTileY, TILE_W, TILE_H);
    return [
      Math.floor(CANVAS_W / 2 - center.screenX),
      Math.floor(CANVAS_H / 2 - center.screenY),
    ];
  }
}
