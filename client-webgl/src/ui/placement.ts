// World placement mode — active while inventory is closed AND the
// currently-selected quickslot holds a hand-equippable placeable.
//
// Control scheme:
//   • mousemove updates scene.placementHoverTile
//   • ghost sprite rendered at that tile (half alpha)
//   • LEFT-click is deliberately NOT consumed — falls through to the
//     normal resolveAction pipeline (MoveTo / Attack / etc.)
//   • RIGHT-click sends UseItemAt(itemId, tileX, tileY) to place
//
// Validity checking is deliberately left to the server — mismatched
// placements bounce back with no harm. A client-side green/red hint is a
// future enhancement once the sprite renderer grows a color-tint uniform.

import { ClientAction } from '@shared/actions.js';
import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H, PX_PER_Z } from '../platform/config.js';
import type { Scene } from '../scene.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Connection } from '../network/connection.js';
import type { SyncedInventoryItem } from '@shared/protocol/codec.js';
import { selectedItem, selectedMode } from './quickslot.js';

/** The quickslot-selected item when placement mode is active, else null. */
export function getPlacementHandItem(scene: Scene): SyncedInventoryItem | null {
  if (selectedMode(scene) !== 'placement') return null;
  return selectedItem(scene);
}

/** True when placement-mode gestures should be active: inventory closed
 *  AND the selected quickslot holds a placeable. */
export function isPlacementActive(scene: Scene): boolean {
  return !scene.inventoryOpen && selectedMode(scene) === 'placement';
}

/** Update `scene.placementHoverTile` from canvas-pixel coords. Called from
 *  the mousemove handler; no-op when placement mode is inactive. */
export function updatePlacementHover(scene: Scene, canvasX: number, canvasY: number): void {
  if (!isPlacementActive(scene)) {
    scene.placementHoverTile = null;
    return;
  }
  const tile = scene.camera.tileAt(canvasX, canvasY);
  scene.placementHoverTile = tile ? { tileX: tile.tx, tileY: tile.ty } : null;
}

/** Handle a mousedown in placement mode. Returns true if the click was
 *  consumed (caller should skip the normal world-click pipeline).
 *
 *  Only right-click places — left-click is intentionally not consumed so
 *  the player can still move / attack / interact while a placeable is
 *  selected. */
export function handlePlacementClick(
  scene: Scene,
  connection: Connection,
  button: 'left' | 'right',
): boolean {
  if (!isPlacementActive(scene)) return false;
  const handItem = getPlacementHandItem(scene);
  if (!handItem) return false;

  if (button === 'right') {
    if (!scene.placementHoverTile) return true;
    connection.send({
      action: ClientAction.UseItemAt,
      itemId: handItem.itemId,
      tileX: scene.placementHoverTile.tileX,
      tileY: scene.placementHoverTile.tileY,
    });
    return true;
  }

  // Left-click: NOT consumed — fall through to resolveAction so the
  // player can move around even with a placeable ghost up.
  return false;
}

/** Draw the placement ghost. Caller is inside the game-space sprite pass
 *  (lit, with offsetX/offsetY set). No-op if placement mode inactive. */
export function drawPlacementGhost(
  gl: WebGL2RenderingContext,
  scene: Scene,
  sprites: SpriteRenderer,
  offsetX: number,
  offsetY: number,
): void {
  if (!scene.placementHoverTile) return;
  const handItem = getPlacementHandItem(scene);
  if (!handItem) return;
  const sheet = scene.spriteRegistry.resolve(handItem.blueprintId, 0);
  const { tileX, tileY } = scene.placementHoverTile;
  const { screenX, screenY } = tileToScreen(tileX, tileY, TILE_W, TILE_H);
  const z = scene.getGroundZ(tileX, tileY);
  // Anchor: `south` → foot sits on the south vertex of the tile diamond.
  // Mirrors static-entity.ts draw conventions.
  const footScreenX = screenX + TILE_W / 2;
  const footScreenY = screenY + TILE_H - z * PX_PER_Z;
  const dstX = footScreenX - sheet.footX + offsetX;
  const dstY = footScreenY - sheet.footY + offsetY;
  const uvDU = sheet.frameW / sheet.sheetW;
  const uvDV = sheet.frameH / sheet.sheetH;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sheet.texture);
  sprites.setAlpha(0.55);
  sprites.drawSprite(dstX, dstY, sheet.renderW, sheet.renderH, 0, 0, uvDU, uvDV);
  sprites.setAlpha(1);
}
