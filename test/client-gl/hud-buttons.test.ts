import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND } from '@shared/inventory.js';
import {
  hitTestHudButton,
  handleHudButtonClick,
  getActionButtonLabel,
  isActionButtonVisible,
  hudButtonRect,
} from '@client-webgl/ui/hud-buttons.js';
import { createTestScene } from './harness.js';

function bindWall(scene: any, conn: any, qty = 5) {
  conn.deliver({
    type: 'inventorySync',
    items: [{ itemId: 1, blueprintId: BlueprintType.WoodenWall, quantity: qty, equippedSlot: 0 }],
  });
  scene.quickSlots[0] = 1;
  scene.selectedQuickSlot = 0;
}

function bindCookedMeat(scene: any, conn: any) {
  conn.deliver({
    type: 'inventorySync',
    items: [{ itemId: 2, blueprintId: BlueprintType.CookedMeat, quantity: 3, equippedSlot: 0 }],
  });
  scene.quickSlots[0] = 2;
  scene.selectedQuickSlot = 0;
}

function bindRawMeat(scene: any, conn: any) {
  conn.deliver({
    type: 'inventorySync',
    items: [{ itemId: 3, blueprintId: BlueprintType.RawMeat, quantity: 2, equippedSlot: 0 }],
  });
  scene.quickSlots[0] = 3;
  scene.selectedQuickSlot = 0;
}

describe('HUD action button label', () => {
  it('returns null when no quickslot selected', async () => {
    const { scene } = await createTestScene();
    expect(getActionButtonLabel(scene)).toBeNull();
    expect(isActionButtonVisible(scene)).toBe(false);
  });

  it('returns "Place ..." for placeable selection', async () => {
    const { scene, conn } = await createTestScene();
    bindWall(scene, conn);
    expect(getActionButtonLabel(scene)).toBe('Place Wooden Wall');
  });

  it('returns "Cook ..." for raw food selection', async () => {
    const { scene, conn } = await createTestScene();
    bindRawMeat(scene, conn);
    expect(getActionButtonLabel(scene)).toBe('Cook Raw Meat');
  });

  it('returns "Eat ..." for consumable selection', async () => {
    const { scene, conn } = await createTestScene();
    bindCookedMeat(scene, conn);
    expect(getActionButtonLabel(scene)).toBe('Eat Cooked Meat');
  });

  it('returns null for tool (axe) selection', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 9, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: EQUIP_SLOT_HAND }],
    });
    scene.quickSlots[0] = 9;
    scene.selectedQuickSlot = 0;
    expect(getActionButtonLabel(scene)).toBeNull();
  });
});

describe('HUD button hit-test', () => {
  it('returns the matching id for a point inside each button', async () => {
    const { scene, conn } = await createTestScene();
    bindWall(scene, conn); // makes action button visible
    for (const id of ['action', 'inventory', 'settings'] as const) {
      const r = hudButtonRect(id);
      expect(hitTestHudButton(r.x + 1, r.y + 1, scene)).toBe(id);
      expect(hitTestHudButton(r.x + r.w - 1, r.y + r.h - 1, scene)).toBe(id);
    }
  });

  it('returns null in the gap between buttons', async () => {
    const { scene, conn } = await createTestScene();
    bindWall(scene, conn);
    const a = hudButtonRect('action');
    const i = hudButtonRect('inventory');
    const gapX = (a.x + a.w + i.x) / 2;
    expect(hitTestHudButton(gapX, a.y + 4, scene)).toBeNull();
  });

  it('returns null outside the button row vertically', async () => {
    const { scene, conn } = await createTestScene();
    bindWall(scene, conn);
    const r = hudButtonRect('settings');
    expect(hitTestHudButton(r.x + 4, r.y - 1, scene)).toBeNull();
    expect(hitTestHudButton(r.x + 4, r.y + r.h, scene)).toBeNull();
  });

  it('skips the action button when no action is available', async () => {
    const { scene } = await createTestScene();
    // No selection → action invisible.
    const r = hudButtonRect('action');
    expect(hitTestHudButton(r.x + 4, r.y + 4, scene)).toBeNull();
    // Inventory + settings still hit.
    const inv = hudButtonRect('inventory');
    expect(hitTestHudButton(inv.x + 4, inv.y + 4, scene)).toBe('inventory');
  });
});

describe('HUD button dispatch', () => {
  it('inventory button opens the inventory overlay', async () => {
    const { scene, conn } = await createTestScene();
    handleHudButtonClick(scene, conn, 'inventory');
    expect(scene.overlay).toEqual({ kind: 'inventory' });
  });

  it('settings button opens the in-game settings menu', async () => {
    const { scene, conn } = await createTestScene();
    handleHudButtonClick(scene, conn, 'settings');
    expect(scene.overlay).toEqual({ kind: 'menu', screen: 'settings', context: 'in-game' });
  });

  it('inventory/settings clear an active arm', async () => {
    const { scene, conn } = await createTestScene();
    bindWall(scene, conn);
    scene.armedAction = 'placement';
    handleHudButtonClick(scene, conn, 'inventory');
    expect(scene.armedAction).toBeNull();
  });

  it('action button on consumable fires UseConsumable, no arming', async () => {
    const { scene, conn } = await createTestScene();
    bindCookedMeat(scene, conn);
    handleHudButtonClick(scene, conn, 'action');
    expect(conn.sent).toEqual([{ action: ClientAction.UseConsumable, itemId: 2 }]);
    expect(scene.armedAction).toBeNull();
  });

  it('action button on placeable arms placement; second tap toggles off', async () => {
    const { scene, conn } = await createTestScene();
    bindWall(scene, conn);
    handleHudButtonClick(scene, conn, 'action');
    expect(scene.armedAction).toBe('placement');
    handleHudButtonClick(scene, conn, 'action');
    expect(scene.armedAction).toBeNull();
  });

  it('action button on raw food arms cook', async () => {
    const { scene, conn } = await createTestScene();
    bindRawMeat(scene, conn);
    handleHudButtonClick(scene, conn, 'action');
    expect(scene.armedAction).toBe('cook');
  });
});

describe('selection-change clears arming', () => {
  it('selectQuickSlot clears armedAction', async () => {
    const { scene, conn } = await createTestScene();
    bindWall(scene, conn);
    scene.armedAction = 'placement';
    // Bind a different item to slot 1 and select it.
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.WoodenWall, quantity: 5, equippedSlot: 0 },
        { itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 },
      ],
    });
    scene.quickSlots[1] = 7;
    const { selectQuickSlot } = await import('@client-webgl/ui/quickslot.js');
    selectQuickSlot(scene, conn, 1);
    expect(scene.armedAction).toBeNull();
  });
});
