// World placement mode — active while inventory is closed AND the player
// has a placeable item equipped in the hand slot.
//
// Behavior:
//   • mousemove updates scene.placementHoverTile
//   • ghost sprite rendered at that tile (half alpha)
//   • left-click sends UseItemAt(itemId, tileX, tileY)
//   • right-click clears the hover tile for one frame (visual "cancel";
//     next mousemove repopulates it)
//
// Validity checking is deliberately left to the server — mismatched
// placements bounce back with no harm. A client-side green/red hint is a
// future enhancement once the sprite renderer grows a color-tint uniform.

import { ClientAction } from '@shared/actions.js';
import { getBlueprint } from '@shared/blueprints.js';
import { EQUIP_SLOT_HAND } from '@shared/inventory.js';
import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H, PX_PER_Z } from '../platform/config.js';
import type { Scene } from '../scene.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Connection } from '../network/connection.js';
import type { SyncedInventoryItem } from '@shared/protocol/codec.js';

/** The hand-equipped item if it's a placeable, or null. Drives whether
 *  placement mode is active. */
export function getPlacementHandItem(scene: Scene): SyncedInventoryItem | null {
  for (const item of scene.inventory) {
    if (item.equippedSlot !== EQUIP_SLOT_HAND) continue;
    const bp = getBlueprint(item.blueprintId);
    if (bp?.category === 'placeable') return item;
  }
  return null;
}

/** True when placement-mode gestures should be active. Inventory must be
 *  closed (so the panel doesn't swallow clicks) AND a placeable must be
 *  hand-equipped. */
export function isPlacementActive(scene: Scene): boolean {
  return !scene.inventoryOpen && getPlacementHandItem(scene) !== null;
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
 *  consumed (caller should skip the normal world-click pipeline). */
export function handlePlacementClick(
  scene: Scene,
  connection: Connection,
  button: 'left' | 'right',
): boolean {
  if (!isPlacementActive(scene)) return false;
  const handItem = getPlacementHandItem(scene);
  if (!handItem) return false;

  if (button === 'left') {
    if (!scene.placementHoverTile) return true;
    connection.send({
      action: ClientAction.UseItemAt,
      itemId: handItem.itemId,
      tileX: scene.placementHoverTile.tileX,
      tileY: scene.placementHoverTile.tileY,
    });
    return true;
  }

  if (button === 'right') {
    // Cancel: drop the hover for one frame. Next mousemove will repopulate
    // it. Item stays equipped — Esc unequips (handled in keyboard.ts).
    scene.placementHoverTile = null;
    return true;
  }

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
