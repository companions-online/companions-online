import { tileToScreen } from '@shared/coordinates.js';
import { MAP_SIZE } from '@shared/constants.js';
import { TILE_W, TILE_H, CLIENT_VIEW_RANGE, GAME_X, GAME_Y, GAME_W, GAME_H } from './config.js';

export class Camera {
  constructor(public centerTileX: number, public centerTileY: number) {}

  follow(tileX: number, tileY: number) {
    this.centerTileX = tileX;
    this.centerTileY = tileY;
  }

  getOffset() {
    const center = tileToScreen(this.centerTileX, this.centerTileY, TILE_W, TILE_H);
    return {
      offsetX: Math.floor(GAME_X + GAME_W / 2 - center.screenX),
      offsetY: Math.floor(GAME_Y + GAME_H / 2 - center.screenY),
    };
  }

  getVisibleBounds() {
    const r = CLIENT_VIEW_RANGE;
    const pad = 3; // extra tiles for elevation overshoot
    return {
      minTileX: Math.max(0, Math.floor(this.centerTileX - r)),
      maxTileX: Math.min(MAP_SIZE - 1, Math.ceil(this.centerTileX + r)),
      minTileY: Math.max(0, Math.floor(this.centerTileY - r - pad)),
      maxTileY: Math.min(MAP_SIZE - 1, Math.ceil(this.centerTileY + r + pad)),
    };
  }
}
