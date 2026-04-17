import { tileToScreen } from '@shared/coordinates.js';
import { MAP_SIZE } from '@shared/constants.js';
import { TILE_W, TILE_H, GAME_X, GAME_Y, GAME_W, GAME_H, PX_PER_Z, GAME_ZOOM } from './config.js';

/**
 * Minimal follow camera. The getOffset() value is the world→screen pixel
 * translation applied uniformly to all tile corners and sprite positions.
 * Centers on the game viewport (GAME_X/Y/W/H), not the full canvas — the
 * HUD chrome regions sit outside the game area.
 */
export class Camera {
  /** Ground elevation under the followed tile. The viewport translates by
   *  -z * PX_PER_Z so the player's feet stay visually centered when walking
   *  over uneven terrain. Defaults to 0 → flat-iso behavior. */
  centerZ = 0;

  constructor(public centerTileX: number, public centerTileY: number) {}

  follow(tileX: number, tileY: number, z = 0): void {
    this.centerTileX = tileX;
    this.centerTileY = tileY;
    this.centerZ = z;
  }

  getOffset(): [number, number] {
    const center = tileToScreen(this.centerTileX, this.centerTileY, TILE_W, TILE_H);
    return [
      Math.floor(GAME_X / GAME_ZOOM + GAME_W / (2 * GAME_ZOOM) - center.screenX),
      Math.floor(GAME_Y / GAME_ZOOM + GAME_H / (2 * GAME_ZOOM) - center.screenY + this.centerZ * PX_PER_Z),
    ];
  }

  /**
   * Invert a canvas-pixel click into a world tile. Returns null if outside the
   * game viewport or off-map. Uses the flat-iso inverse — ignores elevation,
   * which can return the visually-adjacent tile on hilly terrain. Acceptable
   * for click-to-move picking in a prototype.
   */
  tileAt(canvasX: number, canvasY: number): { tx: number; ty: number } | null {
    if (canvasX < GAME_X || canvasX >= GAME_X + GAME_W) return null;
    if (canvasY < GAME_Y || canvasY >= GAME_Y + GAME_H) return null;

    const [offsetX, offsetY] = this.getOffset();
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    // N vertex of tile (0,0) sits at (HALF_W + offsetX, offsetY) — see
    // getTileCorners in elevation.ts. Subtract that origin to get world-iso
    // coords, then apply the inverse of tileToScreen.
    // Convert canvas coords to virtual-pixel space before inverse projection.
    const sx = canvasX / GAME_ZOOM - offsetX - hw;
    const sy = canvasY / GAME_ZOOM - offsetY;

    const tx = Math.floor((sx / hw + sy / hh) / 2);
    const ty = Math.floor((sy / hh - sx / hw) / 2);

    if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return null;
    return { tx, ty };
  }
}
