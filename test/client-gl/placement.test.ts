import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND } from '@shared/inventory.js';
import {
  isPlacementActive,
  getPlacementHandItem,
  handlePlacementClick,
} from '@client-webgl/ui/placement.js';
import { createTestScene } from './harness.js';

describe('placement mode', () => {
  it('inactive when nothing is hand-equipped', async () => {
    const { scene } = await createTestScene();
    expect(isPlacementActive(scene)).toBe(false);
    expect(getPlacementHandItem(scene)).toBeNull();
  });

  it('inactive when the hand-equipped item is not a placeable', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 1, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: EQUIP_SLOT_HAND }],
    });
    expect(isPlacementActive(scene)).toBe(false);
  });

  it('active when a placeable (WoodenWall) is hand-equipped and inventory closed', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.WoodenWall, quantity: 3, equippedSlot: EQUIP_SLOT_HAND }],
    });
    expect(isPlacementActive(scene)).toBe(true);
    expect(getPlacementHandItem(scene)?.itemId).toBe(5);
  });

  it('inactive when inventory is open even with placeable equipped', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.Campfire, quantity: 1, equippedSlot: EQUIP_SLOT_HAND }],
    });
    scene.inventoryOpen = true;
    expect(isPlacementActive(scene)).toBe(false);
  });

  it('left-click sends UseItemAt with the equipped itemId and hover tile', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.WoodenWall, quantity: 3, equippedSlot: EQUIP_SLOT_HAND }],
    });
    scene.placementHoverTile = { tileX: 42, tileY: 30 };
    const consumed = handlePlacementClick(scene, conn, 'left');
    expect(consumed).toBe(true);
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({
      action: ClientAction.UseItemAt, itemId: 5, tileX: 42, tileY: 30,
    });
  });

  it('right-click cancels (clears hover), does not send an action', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.WoodenWall, quantity: 3, equippedSlot: EQUIP_SLOT_HAND }],
    });
    scene.placementHoverTile = { tileX: 10, tileY: 10 };
    const consumed = handlePlacementClick(scene, conn, 'right');
    expect(consumed).toBe(true);
    expect(scene.placementHoverTile).toBeNull();
    expect(conn.sent).toHaveLength(0);
  });

  it('left-click with no hover tile consumes the event but sends nothing', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.WoodenWall, quantity: 3, equippedSlot: EQUIP_SLOT_HAND }],
    });
    scene.placementHoverTile = null;
    const consumed = handlePlacementClick(scene, conn, 'left');
    expect(consumed).toBe(true);
    expect(conn.sent).toHaveLength(0);
  });

  it('returns false when placement mode is inactive (click falls through)', async () => {
    const { scene, conn } = await createTestScene();
    const consumed = handlePlacementClick(scene, conn, 'left');
    expect(consumed).toBe(false);
  });
});
