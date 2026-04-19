import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { EQUIP_SLOT_HAND } from '@shared/inventory.js';
import {
  hitTestInventoryPanel,
  handleInventoryPanelClick,
  gridCellRect,
  equipSlotRect,
  recipeRowRectAt,
  PANEL_X, PANEL_Y, PANEL_W, PANEL_H,
} from '@client-webgl/ui/inventory-panel.js';
import { createTestScene } from './harness.js';

function centerOf(r: { x: number; y: number; w: number; h: number }) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

describe('inventory panel hit-test', () => {
  it('identifies grid cells by position', async () => {
    const { scene } = await createTestScene();
    const r = gridCellRect(0);
    const { x, y } = centerOf(r);
    expect(hitTestInventoryPanel(x, y, scene)).toEqual({ kind: 'grid', slotIndex: 0 });
  });

  it('identifies equipment slots', async () => {
    const { scene } = await createTestScene();
    const r = equipSlotRect('hand');
    const { x, y } = centerOf(r);
    expect(hitTestInventoryPanel(x, y, scene)).toEqual({ kind: 'equip', slot: 'hand' });
  });

  it('identifies recipe rows when player has inputs', async () => {
    const { scene, conn } = await createTestScene();
    // Recipe id 14 = WoodenWall (4 wood). Give the player 4 wood so the
    // recipe shows up in the visible list.
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 1, blueprintId: BlueprintType.Wood, quantity: 4, equippedSlot: 0 }],
    });
    // First visible recipe with 4 wood is WoodenClub (3 wood) — index 0.
    const r = recipeRowRectAt(0, 0);
    const { x, y } = centerOf(r);
    const hit = hitTestInventoryPanel(x, y, scene);
    expect(hit.kind).toBe('recipe');
  });

  it('hides recipes the player cannot afford', async () => {
    const { scene } = await createTestScene();
    // Empty inventory → nothing craftable → recipe hit-test misses.
    const r = recipeRowRectAt(0, 0);
    const { x, y } = centerOf(r);
    expect(hitTestInventoryPanel(x, y, scene).kind).toBe('inside');
  });

  it('returns outside for coords outside the panel', async () => {
    const { scene } = await createTestScene();
    expect(hitTestInventoryPanel(PANEL_X - 10, PANEL_Y + 10, scene).kind).toBe('outside');
    expect(hitTestInventoryPanel(PANEL_X + PANEL_W + 1, PANEL_Y + 10, scene).kind).toBe('outside');
    expect(hitTestInventoryPanel(PANEL_X + 10, PANEL_Y - 1, scene).kind).toBe('outside');
    expect(hitTestInventoryPanel(PANEL_X + 10, PANEL_Y + PANEL_H + 5, scene).kind).toBe('outside');
  });
});

describe('inventory panel click dispatch', () => {
  async function setup() {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, equippedSlot: 0 },
        { itemId: 2, blueprintId: BlueprintType.FishingRod, quantity: 1, equippedSlot: 0 },
      ],
    });
    return { scene, conn };
  }

  it('left-click on an occupied grid cell picks up the whole stack', async () => {
    const { scene, conn } = await setup();
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'left', shift: false });
    expect(scene.heldStack).toEqual({ itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, source: 'inventory' });
    expect(conn.sent).toHaveLength(0);
  });

  it('left-click on an empty cell with held stack places into that slot', async () => {
    const { scene, conn } = await setup();
    // Hold the wood stack.
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'left', shift: false });
    // Drop into slot 5 (empty).
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 5 },
      { button: 'left', shift: false });
    expect(scene.heldStack).toBeNull();
    expect(scene.gridOrder.get(1)).toBe(5);
  });

  it('left-click recipe card sends Craft', async () => {
    const { scene, conn } = await setup();
    // Recipe id 14 = WoodenWall (4 wood)
    handleInventoryPanelClick(scene, conn, { kind: 'recipe', recipeId: 14 },
      { button: 'left', shift: false });
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.Craft, recipeId: 14 });
  });

  it('left-click equipment slot with occupant sends Unequip', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: EQUIP_SLOT_HAND },
      ],
    });
    handleInventoryPanelClick(scene, conn, { kind: 'equip', slot: 'hand' },
      { button: 'left', shift: false });
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
  });

  it('drop held stack on matching equipment slot sends Equip with quantity', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 }],
    });
    scene.heldStack = { itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, source: 'inventory' };
    handleInventoryPanelClick(scene, conn, { kind: 'equip', slot: 'hand' },
      { button: 'left', shift: false });
    expect(scene.heldStack).toBeNull();
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toMatchObject({
      action: ClientAction.Equip, itemId: 7, quantity: 1,
    });
  });

  it('drop held stack on wrong equipment slot is a no-op', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 1, blueprintId: BlueprintType.Wood, quantity: 3, equippedSlot: 0 }],
    });
    scene.heldStack = { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 3, source: 'inventory' };
    handleInventoryPanelClick(scene, conn, { kind: 'equip', slot: 'hand' },
      { button: 'left', shift: false });
    expect(scene.heldStack).not.toBeNull();
    expect(conn.sent).toHaveLength(0);
  });

  it('click outside panel with held stack sends Drop with quantity and clears held', async () => {
    const { scene, conn } = await setup();
    scene.heldStack = { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 4, source: 'inventory' };
    handleInventoryPanelClick(scene, conn, { kind: 'outside' },
      { button: 'left', shift: false });
    expect(scene.heldStack).toBeNull();
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toMatchObject({
      action: ClientAction.Drop, itemId: 1, quantity: 4,
    });
  });

  it('right-click on a stack picks up half (ceiling)', async () => {
    const { scene, conn } = await setup();
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'right', shift: false });
    expect(scene.heldStack).toEqual({
      itemId: 1, blueprintId: BlueprintType.Wood, quantity: 3, source: 'inventory',   // ceil(5/2)
    });
    expect(conn.sent).toHaveLength(0);
  });

  it('shift+left on an unequipped equippable sends Equip', async () => {
    const { scene, conn } = await setup();
    // FishingRod is at slotIndex 1 (itemId 2, bp FishingRod has equipSlot hand)
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 1 },
      { button: 'left', shift: true });
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.Equip, itemId: 2 });
    expect(scene.heldStack).toBeNull();
  });

  it('shift+left on an equipped item sends Unequip', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: EQUIP_SLOT_HAND }],
    });
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'left', shift: true });
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.Unequip, slot: EQUIP_SLOT_HAND });
  });

  it('left-click with held (different item, full stack) swaps — held becomes displaced', async () => {
    const { scene, conn } = await setup();
    // Pick up wood (full stack).
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'left', shift: false });
    expect(scene.heldStack?.itemId).toBe(1);
    // Click on FishingRod (itemId 2 at slot 1).
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 1 },
      { button: 'left', shift: false });
    // Wood moved to slot 1; FishingRod came up onto cursor; slot 0 now holds FishingRod.
    expect(scene.gridOrder.get(1)).toBe(1);
    expect(scene.gridOrder.get(2)).toBe(0);
    expect(scene.heldStack).toEqual({ itemId: 2, blueprintId: BlueprintType.FishingRod, quantity: 1, source: 'inventory' });
  });

  it('left-click with held (same item) returns to source and clears held', async () => {
    const { scene, conn } = await setup();
    // Pick up wood.
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'left', shift: false });
    // Click back on wood slot.
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'left', shift: false });
    expect(scene.heldStack).toBeNull();
  });

  it('left-click with partial held on different item is a no-op', async () => {
    const { scene, conn } = await setup();
    // Right-click wood to pick up half.
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'right', shift: false });
    expect(scene.heldStack?.quantity).toBe(3);
    // Try to swap onto FishingRod slot: Minecraft partial+different = refuse.
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 1 },
      { button: 'left', shift: false });
    expect(scene.heldStack?.itemId).toBe(1);
    expect(scene.gridOrder.get(1)).toBe(0); // unchanged
    expect(scene.gridOrder.get(2)).toBe(1); // unchanged
  });
});

describe('container mode', () => {
  async function setupContainer() {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, equippedSlot: 0 },
      ],
    });
    conn.deliver({
      type: 'containerOpen',
      containerEntityId: 99,
      items: [
        { itemId: 20, blueprintId: BlueprintType.Rock, quantity: 8, equippedSlot: 0 },
      ],
    });
    return { scene, conn };
  }

  it('containerOpen also pops the inventory panel', async () => {
    const { scene } = await setupContainer();
    expect(scene.inventoryOpen).toBe(true);
    expect(scene.containerEntityId).toBe(99);
  });

  it('shift+left on inventory item (container open) sends Transfer player→chest', async () => {
    const { scene, conn } = await setupContainer();
    conn.sent.length = 0;
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'left', shift: true });
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toMatchObject({
      action: ClientAction.Transfer, itemId: 1, containerId: 99, direction: 0,
    });
  });

  it('shift+left on container item sends Transfer chest→player', async () => {
    const { scene, conn } = await setupContainer();
    conn.sent.length = 0;
    handleInventoryPanelClick(scene, conn, { kind: 'container', slotIndex: 0 },
      { button: 'left', shift: true });
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toMatchObject({
      action: ClientAction.Transfer, itemId: 20, containerId: 99, direction: 1,
    });
  });

  it('pick up container item (source=container), drop on inventory cell = Transfer with quantity', async () => {
    const { scene, conn } = await setupContainer();
    conn.sent.length = 0;
    // Left-click container cell → held with source=container.
    handleInventoryPanelClick(scene, conn, { kind: 'container', slotIndex: 0 },
      { button: 'left', shift: false });
    expect(scene.heldStack?.source).toBe('container');
    // Drop on any inventory grid cell → Transfer chest→player, quantity=8.
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 4 },
      { button: 'left', shift: false });
    expect(scene.heldStack).toBeNull();
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toMatchObject({
      action: ClientAction.Transfer, itemId: 20, containerId: 99, direction: 1, quantity: 8,
    });
  });

  it('pick up inventory item, drop on container cell = Transfer player→chest', async () => {
    const { scene, conn } = await setupContainer();
    conn.sent.length = 0;
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'left', shift: false });
    expect(scene.heldStack?.source).toBe('inventory');
    handleInventoryPanelClick(scene, conn, { kind: 'container', slotIndex: 3 },
      { button: 'left', shift: false });
    expect(scene.heldStack).toBeNull();
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toMatchObject({
      action: ClientAction.Transfer, itemId: 1, containerId: 99, direction: 0, quantity: 5,
    });
  });

  it('right-click container cell picks up half', async () => {
    const { scene, conn } = await setupContainer();
    conn.sent.length = 0;
    handleInventoryPanelClick(scene, conn, { kind: 'container', slotIndex: 0 },
      { button: 'right', shift: false });
    expect(scene.heldStack).toEqual({
      itemId: 20, blueprintId: BlueprintType.Rock, quantity: 4,  // ceil(8/2)
      source: 'container',
    });
  });

  it('drop-to-chest records a pending decrement; cleared on InventorySync', async () => {
    const { scene, conn } = await setupContainer();
    conn.sent.length = 0;
    // Pick up wood from inventory, drop on chest cell.
    handleInventoryPanelClick(scene, conn, { kind: 'grid', slotIndex: 0 },
      { button: 'left', shift: false });
    handleInventoryPanelClick(scene, conn, { kind: 'container', slotIndex: 3 },
      { button: 'left', shift: false });
    // Optimistic: pending decrement covers the full source stack until
    // the server's InventorySync arrives.
    expect(scene.pendingItemDecrements.get(1)?.quantity).toBe(5);
    // Server reply lands → pending cleared.
    conn.deliver({ type: 'inventorySync', items: [] });
    expect(scene.pendingItemDecrements.size).toBe(0);
  });
});
