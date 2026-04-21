import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND } from '@shared/inventory.js';
import {
  selectQuickSlot,
  clearQuickSlotSelection,
  selectedItem,
  selectedMode,
} from '@client-webgl/ui/quickslot.js';
import { createTestScene } from './harness.js';

describe('quickslot selection', () => {
  it('selecting an empty slot sends no action and sets selection to null', async () => {
    const { scene, conn } = await createTestScene();
    selectQuickSlot(scene, conn, 0);
    expect(scene.selectedQuickSlot).toBeNull();
    expect(conn.sent).toHaveLength(0);
  });

  it('selecting an equippable item sends Equip and records selection', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 7;
    selectQuickSlot(scene, conn, 0);
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.Equip, itemId: 7 });
    expect(scene.selectedQuickSlot).toBe(0);
  });

  it('selecting a non-equippable item (bandage) does NOT equip but records selection', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 9, blueprintId: BlueprintType.Bandage, quantity: 2, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 9;
    selectQuickSlot(scene, conn, 0);
    expect(conn.sent).toHaveLength(0);
    expect(scene.selectedQuickSlot).toBe(0);
  });

  it('selecting a non-equippable with another item in hand unequips first', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: EQUIP_SLOT_HAND },
        { itemId: 9, blueprintId: BlueprintType.Bandage, quantity: 2, equippedSlot: 0 },
      ],
    });
    scene.quickSlots[0] = 7;
    scene.quickSlots[1] = 9;
    scene.selectedQuickSlot = 0; // axe is "selected"
    selectQuickSlot(scene, conn, 1);
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
    expect(scene.selectedQuickSlot).toBe(1);
  });

  it('repeated select on the same slot is a no-op', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: EQUIP_SLOT_HAND }],
    });
    scene.quickSlots[0] = 7;
    scene.selectedQuickSlot = 0;
    selectQuickSlot(scene, conn, 0);
    expect(conn.sent).toHaveLength(0);
  });

  it('selecting empty slot after an equippable was selected sends Unequip', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: EQUIP_SLOT_HAND }],
    });
    scene.quickSlots[0] = 7;
    scene.selectedQuickSlot = 0;
    selectQuickSlot(scene, conn, 3); // empty slot
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
    expect(scene.selectedQuickSlot).toBeNull();
  });

  it('clearQuickSlotSelection unequips hand if something equippable is selected', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: EQUIP_SLOT_HAND }],
    });
    scene.quickSlots[0] = 7;
    scene.selectedQuickSlot = 0;
    clearQuickSlotSelection(scene, conn);
    expect(scene.selectedQuickSlot).toBeNull();
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
  });
});

describe('quickslot mode classification', () => {
  it('placement mode for hand-equippable placeables', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 1, blueprintId: BlueprintType.WoodenWall, quantity: 1, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 1;
    scene.selectedQuickSlot = 0;
    expect(selectedMode(scene)).toBe('placement');
  });

  it('cook mode for raw meat / raw fish even though they are hand-equippable', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.RawMeat, quantity: 2, equippedSlot: 0 },
        { itemId: 2, blueprintId: BlueprintType.RawFish, quantity: 3, equippedSlot: 0 },
      ],
    });
    scene.quickSlots[0] = 1;
    scene.selectedQuickSlot = 0;
    expect(selectedMode(scene)).toBe('cook');
    scene.quickSlots[1] = 2;
    scene.selectedQuickSlot = 1;
    expect(selectedMode(scene)).toBe('cook');
  });

  it('consumable mode for bandage and cooked food', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.Bandage, quantity: 1, equippedSlot: 0 },
        { itemId: 2, blueprintId: BlueprintType.CookedMeat, quantity: 1, equippedSlot: 0 },
      ],
    });
    scene.quickSlots[0] = 1;
    scene.selectedQuickSlot = 0;
    expect(selectedMode(scene)).toBe('consumable');
    scene.quickSlots[1] = 2;
    scene.selectedQuickSlot = 1;
    expect(selectedMode(scene)).toBe('consumable');
  });

  it('tool mode for weapons and tools', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 1, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 1;
    scene.selectedQuickSlot = 0;
    expect(selectedMode(scene)).toBe('tool');
  });

  it('none when no selection', async () => {
    const { scene } = await createTestScene();
    expect(selectedMode(scene)).toBe('none');
    expect(selectedItem(scene)).toBeNull();
  });
});

describe('inventorySync pruning', () => {
  it('clears quickslot binding when the itemId disappears', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 7;
    scene.selectedQuickSlot = 0;
    // Server deletes the item.
    conn.deliver({ type: 'inventorySync', items: [] });
    expect(scene.quickSlots[0]).toBeNull();
    expect(scene.selectedQuickSlot).toBeNull();
  });

  it('items bound to a quickslot are not auto-placed into the grid', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 },
        { itemId: 8, blueprintId: BlueprintType.Wood, quantity: 3, equippedSlot: 0 },
      ],
    });
    // Bind axe to a quickslot, then re-sync. Axe should NOT show up in gridOrder.
    scene.quickSlots[2] = 7;
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 },
        { itemId: 8, blueprintId: BlueprintType.Wood, quantity: 3, equippedSlot: 0 },
      ],
    });
    expect(scene.gridOrder.has(7)).toBe(false);
    expect(scene.gridOrder.has(8)).toBe(true);
  });
});
