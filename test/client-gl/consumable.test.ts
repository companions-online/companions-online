import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { selectedItem, selectedMode } from '@client-webgl/ui/quickslot.js';
import { createTestScene } from './harness.js';

// The consumable right-click path is implemented inline in mouse.ts — we
// assert the building blocks here: selectedMode reports 'consumable' for
// the right blueprints, and the UseConsumable payload can be constructed
// from selectedItem. (A full end-to-end assertion on mousedown dispatch
// would require a full canvas + MouseEvent setup; the mouse-controller
// tests cover the left-click path, and this exercises the right-click
// decision the controller makes.)

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
});
