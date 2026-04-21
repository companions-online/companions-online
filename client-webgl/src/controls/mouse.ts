// Mouse input — converts canvas clicks into an ActionContext, lets the
// shared resolveAction decide what to send (move/harvest/attack/interact/
// pickup), and ships the action to the server.
//
// Sprite-first hit testing: before falling back to tile-based resolution,
// the click is tested against each entity's screen-space AABB (populated
// during draw). Clicking anywhere on a deer's sprite resolves to "attack
// deer", even tiles above its actual position.
//
// Local turn prediction: on a MoveTo the player entity's direction is
// updated to face the target tile immediately, so the sprite faces the
// click without waiting for the server checkpoint. The first delta from
// the server overwrites `direction` and corrects it.

import { ClientAction } from '@shared/actions.js';
import { dirFromTo } from '@shared/direction.js';
import { isPlaced } from '@shared/status-effects.js';
import { resolveAction } from '@shared/action-resolver.js';
import type { DecodedAction, DecodedActionMoveTo } from '@shared/protocol/codec.js';
import { GAME_ZOOM } from '../platform/config.js';
import type { Scene } from '../scene.js';
import type { ClientEntity } from '../entities/client-entity.js';
import type { Connection } from '../network/connection.js';
import { buildCursorContext, buildContextFromEntity } from './cursor-context.js';
import { hitTestInventoryPanel, handleInventoryPanelClick } from '../ui/inventory-panel.js';
import { updatePlacementHover, handlePlacementClick, isPlacementActive } from '../ui/placement.js';
import { selectedItem, selectedMode } from '../ui/quickslot.js';
import { handleCookingClick, isCookingActive } from '../ui/cooking-highlight.js';

function applyTurnPrediction(scene: Scene, action: DecodedAction): void {
  if (action.action !== ClientAction.MoveTo) return;
  if (scene.myEntityId === null) return;
  const me = scene.entities.get(scene.myEntityId);
  if (!me?.position) return;
  const mv = action as DecodedActionMoveTo;
  const dir = dirFromTo(me.position.tileX, me.position.tileY, mv.tileX, mv.tileY);
  if (dir !== undefined) me.direction = { dir };
}

/**
 * Test a virtual-pixel position against all entity AABBs.
 * Returns the frontmost (highest screenY) hit, or null.
 */
export function hitTestEntities(
  scene: Scene,
  virtualX: number,
  virtualY: number,
): ClientEntity | null {
  let best: ClientEntity | null = null;
  for (const [eid, e] of scene.entities) {
    if (eid === scene.myEntityId) continue;
    if (!e.blueprint) continue;
    if (e.screenW === 0) continue; // not yet drawn
    if (virtualX >= e.screenX && virtualX < e.screenX + e.screenW &&
        virtualY >= e.screenY && virtualY < e.screenY + e.screenH) {
      if (!best || e.screenY > best.screenY) {
        best = e;
      }
    }
  }
  return best;
}

export function attachMouseControls(
  canvas: HTMLCanvasElement,
  scene: Scene,
  connection: Connection,
): void {
  // Suppress the native context menu so right-click on the canvas becomes
  // our own input gesture (split-stack, drop-one, cancel placement).
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  // Track cursor position in canvas pixels. Consumed by the ghost-sprite
  // draw path (inventory held stack) and placement-mode preview.
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (ev.clientY - rect.top) * (canvas.height / rect.height);
    scene.cursorScreenX = cx;
    scene.cursorScreenY = cy;
    updatePlacementHover(scene, cx, cy);
  });

  canvas.addEventListener('mousedown', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (ev.clientY - rect.top) * (canvas.height / rect.height);

    const button = ev.button === 2 ? 'right' : 'left';

    // Inventory panel swallows all world input while open.
    if (scene.inventoryOpen) {
      const hit = hitTestInventoryPanel(cx, cy, scene);
      handleInventoryPanelClick(scene, connection, hit, { button, shift: ev.shiftKey });
      return;
    }

    // Right-click is context-sensitive based on the selected quickslot:
    //   • consumable → UseConsumable on self (no tile needed)
    //   • placement → UseItemAt at the hover tile (placement.ts handles it)
    //   • cook → UseItemAt on an adjacent campfire (cooking-highlight.ts)
    //   • tool/none → falls through to no-op
    if (button === 'right') {
      const mode = selectedMode(scene);
      if (mode === 'consumable') {
        const item = selectedItem(scene);
        if (item) {
          connection.send({ action: ClientAction.UseConsumable, itemId: item.itemId });
        }
        return;
      }
      if (mode === 'placement') {
        if (handlePlacementClick(scene, connection, button)) return;
      }
      if (mode === 'cook') {
        const tile = scene.camera.tileAt(cx, cy);
        if (tile && handleCookingClick(scene, connection, tile.tx, tile.ty)) return;
        return; // cook mode swallows right-clicks even when off-target
      }
      return; // right-click has no default world action
    }

    // Left-click path. Placement mode is intentionally a pass-through for
    // left-clicks so movement / attack / interact still work while a
    // placeable ghost is up. (handlePlacementClick returns false on left.)
    if (isPlacementActive(scene)) {
      if (handlePlacementClick(scene, connection, button)) return;
    }

    if (scene.myEntityId === null) return;

    // Sprite-first: check AABB hit in virtual-pixel space.
    const vx = cx / GAME_ZOOM;
    const vy = cy / GAME_ZOOM;
    const hit = hitTestEntities(scene, vx, vy);
    if (hit && hit.blueprint) {
      const isGroundItem = !isPlaced(hit.statusEffects);
      const ctx = buildContextFromEntity(scene, {
        entityId: hit.id,
        blueprintId: hit.blueprint.blueprintId,
        isGroundItem,
      });
      if (ctx) {
        const action = resolveAction(ctx);
        if (action) {
          applyTurnPrediction(scene, action);
          connection.send(action);
          return;
        }
      }
    }

    // Fallback: tile-based resolution.
    const tile = scene.camera.tileAt(cx, cy);
    if (!tile) return;

    const ctx = buildCursorContext(scene, tile.tx, tile.ty);
    if (!ctx) return;
    const action = resolveAction(ctx);
    if (!action) return;

    applyTurnPrediction(scene, action);
    connection.send(action);
  });
}
