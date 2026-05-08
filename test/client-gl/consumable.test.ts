import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { selectedItem, selectedMode, selectQuickSlot } from '@client-webgl/ui/quickslot.js';
import { createTestScene } from './harness.js';

// Consumables: pressing the bound quickslot fires `UseConsumable` every
// press. First press also runs the equip dance (Equip if hand-equippable,
// Unequip otherwise) so the gesture reads as "pick it up and use it".
// Right-click on a consumable quickslot remains a UseConsumable shortcut
// — the building blocks are here too.

describe('consumable mode', () => {
  it('bandage selection reports consumable mode', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 4, blueprintId: BlueprintType.Bandage, quantity: 2, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 4;
    scene.selectedQuickSlot = 0;
    expect(selectedMode(scene)).toBe('consumable');
    const item = selectedItem(scene);
    expect(item?.itemId).toBe(4);
  });

  it('cooked meat selection reports consumable mode', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 5, blueprintId: BlueprintType.CookedMeat, quantity: 1, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 5;
    scene.selectedQuickSlot = 0;
    expect(selectedMode(scene)).toBe('consumable');
  });

  it('UseConsumable payload uses the selected item id', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 7, blueprintId: BlueprintType.Bandage, quantity: 1, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 7;
    scene.selectedQuickSlot = 0;
    const item = selectedItem(scene);
    expect(item).not.toBeNull();
    // Simulate what mouse.ts does on right-click in consumable mode.
    conn.send({ action: ClientAction.UseConsumable, itemId: item!.itemId });
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.UseConsumable, itemId: 7 });
  });

  it('selectQuickSlot on a consumable fires UseConsumable, then again on re-select', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 9, blueprintId: BlueprintType.Bandage, quantity: 3, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 9;
    selectQuickSlot(scene, conn, 0);
    expect(conn.sent).toEqual([{ action: ClientAction.UseConsumable, itemId: 9 }]);
    selectQuickSlot(scene, conn, 0);
    expect(conn.sent).toEqual([
      { action: ClientAction.UseConsumable, itemId: 9 },
      { action: ClientAction.UseConsumable, itemId: 9 },
    ]);
  });
});
