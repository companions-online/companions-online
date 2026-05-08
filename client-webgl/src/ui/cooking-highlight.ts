// Cooking-mode visual cue + click dispatch.
//
// When the selected quickslot holds raw meat or raw fish, the Campfire
// adjacent to the player (Chebyshev ≤ 1) is tinted red via the sprite
// shader's `u_tint` uniform (applied inside `drawAnimatedStatic`, not as
// a second draw). Clicking that adjacent campfire (left- or right-,
// dispatched from `controls/mouse.ts`) sends UseItemAt(itemId, tileX,
// tileY). The server enforces the same adjacency rule in
// `game-world.ts::handleUseItemAt`, so this mirror keeps distant clicks
// from producing a silent server-side reject.
//
// Distant campfires get no visual treatment by design — only what the
// player can act on *right now* stands out.
//
// No highlight rendering lives here anymore; the visual is owned by
// `entities/static-entity.ts::drawAnimatedStatic`, which consults
// `shouldTintCampfire(scene, entity)` per draw.

import { ClientAction } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import type { Scene } from '../scene.js';
import type { Connection } from '../network/connection.js';
import type { ClientEntity } from '../entities/client-entity.js';
import { selectedItem, selectedMode } from './quickslot.js';
import { isInventoryShowing } from '../overlay.js';

/** True when cooking mode is active (inventory closed + raw-food quickslot). */
export function isCookingActive(scene: Scene): boolean {
  return !isInventoryShowing(scene.overlay) && selectedMode(scene) === 'cook';
}

function myPosition(scene: Scene): { tileX: number; tileY: number } | null {
  if (scene.myEntityId === null) return null;
  const me = scene.entities.get(scene.myEntityId);
  return me?.position ? { tileX: me.position.tileX, tileY: me.position.tileY } : null;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Per-entity check used by the campfire's draw path: true iff cooking
 *  mode is active AND `e` is a Campfire AND the player is adjacent. */
export function shouldTintCampfire(scene: Scene, e: ClientEntity): boolean {
  if (!e.blueprint || e.blueprint.blueprintId !== BlueprintType.Campfire) return false;
  if (!e.position) return false;
  if (!isCookingActive(scene)) return false;
  const me = myPosition(scene);
  if (!me) return false;
  return chebyshev(me.tileX, me.tileY, e.position.tileX, e.position.tileY) <= 1;
}

/** Dispatch a click in cooking mode. Only fires when the click lands on
 *  a campfire tile AND the player is adjacent (Chebyshev ≤ 1). Returns
 *  true if the click was consumed. Used by both the right-click and
 *  left-click branches in `controls/mouse.ts`. */
export function handleCookingClick(
  scene: Scene,
  connection: Connection,
  tileX: number,
  tileY: number,
): boolean {
  if (!isCookingActive(scene)) return false;
  const item = selectedItem(scene);
  if (!item) return false;
  const me = myPosition(scene);
  if (!me) return false;

  // Match a campfire entity at that tile.
  let campfire: ClientEntity | null = null;
  for (const e of scene.entities.values()) {
    if (!e.blueprint || e.blueprint.blueprintId !== BlueprintType.Campfire) continue;
    if (!e.position) continue;
    if (e.position.tileX === tileX && e.position.tileY === tileY) { campfire = e; break; }
  }
  if (!campfire) return false;

  // Server demands adjacency; client mirrors it so distant clicks don't
  // produce a silent server-side reject.
  if (chebyshev(me.tileX, me.tileY, tileX, tileY) > 1) return true;

  connection.send({
    action: ClientAction.UseItemAt,
    itemId: item.itemId,
    tileX,
    tileY,
  });
  return true;
}
