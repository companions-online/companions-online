import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND } from '@shared/inventory.js';
import {
  isPlacementActive,
  getPlacementHandItem,
  handlePlacementClick,
} from '@client-webgl/ui/placement.js';
import { createTestScene, type FakeConnection } from './harness.js';
import type { Scene } from '@client-webgl/scene.js';

/** Put `itemId` in quickslot 0 and select it, so the selected-quickslot
 *  driven helpers in placement.ts see the item as "in hand". */
function equipViaQuickslot(scene: Scene, itemId: number): void {
  scene.quickSlots[0] = itemId;
  scene.selectedQuickSlot = 0;
}

describe('placement mode', () => {
  it('inactive when no quickslot is selected', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.WoodenWall, quantity: 3, equippedSlot: EQUIP_SLOT_HAND }],
    });
    expect(isPlacementActive(scene)).toBe(false);
    expect(getPlacementHandItem(scene)).toBeNull();
  });

  it('inactive when the selected quickslot holds a non-placeable', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 1, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: EQUIP_SLOT_HAND }],
    });
    equipViaQuickslot(scene, 1);
    expect(isPlacementActive(scene)).toBe(false);
  });

  it('active when the selected quickslot holds a placeable (WoodenWall)', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.WoodenWall, quantity: 3, equippedSlot: EQUIP_SLOT_HAND }],
    });
    equipViaQuickslot(scene, 5);
    expect(isPlacementActive(scene)).toBe(true);
    expect(getPlacementHandItem(scene)?.itemId).toBe(5);
  });

  it('inactive when inventory is open even with placeable selected', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.Campfire, quantity: 1, equippedSlot: EQUIP_SLOT_HAND }],
    });
    equipViaQuickslot(scene, 5);
    scene.overlay = { kind: 'inventory' };
    expect(isPlacementActive(scene)).toBe(false);
  });

  it('right-click sends UseItemAt with the selected itemId and hover tile', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.WoodenWall, quantity: 3, equippedSlot: EQUIP_SLOT_HAND }],
    });
    equipViaQuickslot(scene, 5);
    scene.placementHoverTile = { tileX: 42, tileY: 30 };
    const consumed = handlePlacementClick(scene, conn, 'right');
    expect(consumed).toBe(true);
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({
      action: ClientAction.UseItemAt, itemId: 5, tileX: 42, tileY: 30,
    });
  });

  it('left-click is NOT consumed (falls through to world resolveAction)', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.WoodenWall, quantity: 3, equippedSlot: EQUIP_SLOT_HAND }],
    });
    equipViaQuickslot(scene, 5);
    scene.placementHoverTile = { tileX: 42, tileY: 30 };
    const consumed = handlePlacementClick(scene, conn, 'left');
    expect(consumed).toBe(false);
    expect(conn.sent).toHaveLength(0);
  });

  it('right-click with no hover tile consumes the event but sends nothing', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.WoodenWall, quantity: 3, equippedSlot: EQUIP_SLOT_HAND }],
    });
    equipViaQuickslot(scene, 5);
    scene.placementHoverTile = null;
    const consumed = handlePlacementClick(scene, conn, 'right');
    expect(consumed).toBe(true);
    expect(conn.sent).toHaveLength(0);
  });

  it('returns false when placement mode is inactive (click falls through)', async () => {
    const { scene, conn } = await createTestScene();
    expect(handlePlacementClick(scene, conn, 'right')).toBe(false);
    expect(handlePlacementClick(scene, conn, 'left')).toBe(false);
  });
});
