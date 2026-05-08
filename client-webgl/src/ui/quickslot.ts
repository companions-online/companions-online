// Quickbar selection + mode classification.
//
// The quickbar is a 9-entry client-local array; each entry is either an
// itemId bound to that slot or null. Binding is managed by the inventory
// panel (drag/drop onto a quickslot cell). This file owns *selection*:
// pressing `1`-`9` selects a slot, which in turn drives:
//   • The hand equip — if the slot holds a hand-equippable item, a server
//     Equip is sent; if the slot is empty or holds a non-equippable, any
//     currently-equipped hand item is Unequip'd.
//   • The context-sensitive click mode ('placement' / 'cook' / 'consumable'
//     / 'tool' / 'none') consumed by `controls/mouse.ts` for both the
//     left-click commit gesture (placement → UseItemAt; cook →
//     handleCookingClick) and the legacy right-click contextual mode.
//   • Consumables are special-cased: re-pressing the same slot fires
//     another `UseConsumable` so "press 2, press 2, press 2" eats three
//     bandages in a row. The first press also runs the equip dance.

import { ClientAction } from '@shared/actions.js';
import { getBlueprint, BlueprintType, type Blueprint } from '@shared/blueprints.js';
import { EQUIP_SLOT_HAND } from '@shared/inventory.js';
import type { SyncedInventoryItem } from '@shared/protocol/codec.js';
import type { Scene } from '../scene.js';
import type { Connection } from '../network/connection.js';

export type QuickslotMode = 'placement' | 'cook' | 'consumable' | 'tool' | 'none';

/** The inventory item backing the currently-selected quickslot, or null. */
export function selectedItem(scene: Scene): SyncedInventoryItem | null {
  if (scene.selectedQuickSlot === null) return null;
  const itemId = scene.quickSlots[scene.selectedQuickSlot];
  if (itemId === null) return null;
  return scene.inventory.find(i => i.itemId === itemId) ?? null;
}

function selectedBlueprint(scene: Scene): Blueprint | undefined {
  const item = selectedItem(scene);
  if (!item) return undefined;
  return getBlueprint(item.blueprintId);
}

/** Classify what "mode" the selected quickslot puts the world in. Drives
 *  right-click dispatch + which overlay (placement ghost / cooking
 *  highlight) renders. */
export function selectedMode(scene: Scene): QuickslotMode {
  const bp = selectedBlueprint(scene);
  if (!bp) return 'none';
  if (bp.id === BlueprintType.RawMeat || bp.id === BlueprintType.RawFish) {
    // Raw food — the cook-target highlight fires. Even though raw meat has
    // equipSlot 'hand', its primary gesture is "right-click campfire to
    // cook", not "place".
    return 'cook';
  }
  if (bp.consumeHeal !== undefined) return 'consumable';
  if (bp.category === 'placeable' && bp.equipSlot === 'hand') return 'placement';
  if (bp.equipSlot === 'hand') return 'tool';
  return 'none';
}

/** True iff any inventory item has the hand slot occupied. */
function isHandOccupied(scene: Scene): boolean {
  return scene.inventory.some(i => i.equippedSlot === EQUIP_SLOT_HAND);
}

/** Select quickbar slot `idx` (0..8). Handles the hand equip implicitly:
 *  picks up the referenced item if it's hand-equippable, unequips hand
 *  for non-equippables / empty slots. Idempotent for non-consumables.
 *
 *  Consumables are special-cased: pressing the slot key fires
 *  `UseConsumable` every time. The first press also runs the equip
 *  dance (Equip if hand-equippable, Unequip otherwise) so the gesture
 *  reads as "pick it up and use it"; repeat presses just keep eating. */
export function selectQuickSlot(
  scene: Scene,
  connection: Connection,
  idx: number,
): void {
  if (idx < 0 || idx >= scene.quickSlots.length) return;

  const itemId = scene.quickSlots[idx];

  if (itemId === null) {
    if (scene.selectedQuickSlot === idx) return;
    if (isHandOccupied(scene)) {
      connection.send({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
    }
    scene.selectedQuickSlot = null;
    return;
  }

  const item = scene.inventory.find(i => i.itemId === itemId);
  const bp = item ? getBlueprint(item.blueprintId) : undefined;
  if (!item || !bp) {
    // Stale binding — prune and bail.
    scene.quickSlots[idx] = null;
    scene.selectedQuickSlot = null;
    return;
  }

  if (bp.consumeHeal !== undefined) {
    if (scene.selectedQuickSlot !== idx) {
      if (bp.equipSlot === 'hand') {
        connection.send({ action: ClientAction.Equip, itemId: item.itemId });
      } else if (isHandOccupied(scene)) {
        connection.send({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
      }
      scene.selectedQuickSlot = idx;
    }
    connection.send({ action: ClientAction.UseConsumable, itemId: item.itemId });
    return;
  }

  if (scene.selectedQuickSlot === idx) return;

  if (bp.equipSlot === 'hand') {
    // Equippable: ask the server to place it in hand (idempotent server-
    // side — same itemId already equipped is a no-op).
    connection.send({ action: ClientAction.Equip, itemId: item.itemId });
  } else if (isHandOccupied(scene)) {
    connection.send({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
  }
  scene.selectedQuickSlot = idx;
}

/** Clear any active quickslot selection. Unequips hand if something is
 *  currently equipped there. Used by Esc and the panel-close path. */
export function clearQuickSlotSelection(
  scene: Scene,
  connection: Connection,
): void {
  if (scene.selectedQuickSlot === null) return;
  if (isHandOccupied(scene)) {
    connection.send({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
  }
  scene.selectedQuickSlot = null;
}
