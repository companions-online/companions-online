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

  /**
   * Invert a canvas click into a world tile. Returns null if the click is
   * outside the game viewport or the computed tile is off-map.
   *
   * Uses the flat iso inverse — ignores PX_PER_Z elevation deformation, so on
   * hilly tiles the result may be the visually-adjacent tile. Acceptable for
   * click-to-move picking in a prototype.
   */
  tileAt(canvasX: number, canvasY: number): { tx: number; ty: number } | null {
    if (canvasX < GAME_X || canvasX >= GAME_X + GAME_W) return null;
    if (canvasY < GAME_Y || canvasY >= GAME_Y + GAME_H) return null;

    const { offsetX, offsetY } = this.getOffset();
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // N vertex of tile (0,0) sits at (HALF_W + offsetX, offsetY) — see
    // getTileCorners in elevation.ts. Subtract that origin to get world-iso
    // coords, then apply the inverse of tileToScreen.
    const sx = canvasX - offsetX - hw;
    const sy = canvasY - offsetY;

    const tx = Math.floor((sx / hw + sy / hh) / 2);
    const ty = Math.floor((sy / hh - sx / hw) / 2);

    if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return null;
    return { tx, ty };
  }
}
