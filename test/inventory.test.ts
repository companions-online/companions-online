import { describe, it, expect, beforeEach } from 'vitest';
import { InventoryManager } from '../server/src/inventory-manager.js';
import { BlueprintType } from '@shared/blueprints.js';
import { getRecipe, getAllRecipes } from '@shared/recipes.js';
import { canCraft, getWeight } from '@shared/inventory.js';
import {
  encodeAction, encodeInventorySync, decodeClientMessage, decodeServerMessage,
  ClientAction,
} from '@shared/index.js';

let mgr: InventoryManager;

beforeEach(() => {
  mgr = new InventoryManager();
});

describe('InventoryManager', () => {
  it('create + addItem + get', () => {
    mgr.create(1);
    const result = mgr.addItem(1, BlueprintType.Wood, 3);
    expect(result.success).toBe(true);
    const inv = mgr.get(1)!;
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].blueprintId).toBe(BlueprintType.Wood);
    expect(inv.items[0].quantity).toBe(3);
  });

  it('stacking: same blueprint stacks', () => {
    mgr.create(1);
    mgr.addItem(1, BlueprintType.Wood, 2);
    mgr.addItem(1, BlueprintType.Wood, 3);
    const inv = mgr.get(1)!;
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].quantity).toBe(5);
  });

  it('non-stackable items get separate entries', () => {
    mgr.create(1);
    mgr.addItem(1, BlueprintType.Axe, 1);
    mgr.addItem(1, BlueprintType.Pickaxe, 1);
    const inv = mgr.get(1)!;
    expect(inv.items).toHaveLength(2);
  });

  it('weight limit enforced', () => {
    mgr.create(1, 5); // max weight 5
    // Wood weighs 1 each
    const r1 = mgr.addItem(1, BlueprintType.Wood, 5);
    expect(r1.success).toBe(true);
    const r2 = mgr.addItem(1, BlueprintType.Wood, 1);
    expect(r2.success).toBe(false);
  });

  it('removeItem partial quantity', () => {
    mgr.create(1);
    const { itemId } = mgr.addItem(1, BlueprintType.Wood, 5);
    mgr.removeItem(1, itemId!, 2);
    const inv = mgr.get(1)!;
    expect(inv.items[0].quantity).toBe(3);
  });

  it('removeItem full quantity removes entry', () => {
    mgr.create(1);
    const { itemId } = mgr.addItem(1, BlueprintType.Wood, 3);
    mgr.removeItem(1, itemId!);
    const inv = mgr.get(1)!;
    expect(inv.items).toHaveLength(0);
  });

  it('equip / unequip', () => {
    mgr.create(1);
    const { itemId } = mgr.addItem(1, BlueprintType.Axe, 1);
    expect(mgr.equip(1, itemId!).ok).toBe(true);
    const inv = mgr.get(1)!;
    expect(inv.items[0].equippedSlot).toBe('hand');

    // Equip again toggles off
    expect(mgr.equip(1, itemId!).ok).toBe(true);
    expect(inv.items[0].equippedSlot).toBeUndefined();
  });

  it('equip swaps slot occupant', () => {
    mgr.create(1);
    const { itemId: axeId } = mgr.addItem(1, BlueprintType.Axe, 1);
    const { itemId: swordId } = mgr.addItem(1, BlueprintType.IronSword, 1);
    mgr.equip(1, axeId!);
    mgr.equip(1, swordId!);
    const inv = mgr.get(1)!;
    const axe = inv.items.find(i => i.itemId === axeId)!;
    const sword = inv.items.find(i => i.itemId === swordId)!;
    expect(axe.equippedSlot).toBeUndefined();
    expect(sword.equippedSlot).toBe('hand');
  });

  it('drop returns item data', () => {
    mgr.create(1);
    const { itemId } = mgr.addItem(1, BlueprintType.Iron, 3);
    const dropped = mgr.drop(1, itemId!);
    expect(dropped).toEqual({ ok: true, value: { blueprintId: BlueprintType.Iron, quantity: 3 } });
    expect(mgr.get(1)!.items).toHaveLength(0);
  });

  it('craft: consumes inputs, produces output', () => {
    mgr.create(1, 50);
    mgr.addItem(1, BlueprintType.Wood, 5);
    mgr.addItem(1, BlueprintType.Rock, 3);

    // Craft an Axe (2 Wood + 1 Rock)
    const axeRecipe = getAllRecipes().find(r => r.output.blueprintId === BlueprintType.Axe)!;
    expect(mgr.craft(1, axeRecipe.id).ok).toBe(true);

    const inv = mgr.get(1)!;
    const wood = inv.items.find(i => i.blueprintId === BlueprintType.Wood);
    const rock = inv.items.find(i => i.blueprintId === BlueprintType.Rock);
    const axe = inv.items.find(i => i.blueprintId === BlueprintType.Axe);
    expect(wood?.quantity).toBe(3);
    expect(rock?.quantity).toBe(2);
    expect(axe?.quantity).toBe(1);
  });

  it('craft: fails without materials', () => {
    mgr.create(1);
    mgr.addItem(1, BlueprintType.Wood, 1); // need 2 for axe
    const axeRecipe = getAllRecipes().find(r => r.output.blueprintId === BlueprintType.Axe)!;
    expect(mgr.craft(1, axeRecipe.id).ok).toBe(false);
  });

  it('craft: fails without required tool', () => {
    mgr.create(1, 100);
    mgr.addItem(1, BlueprintType.Wood, 1);
    mgr.addItem(1, BlueprintType.Iron, 3);
    // Iron Sword requires Hammer
    const swordRecipe = getAllRecipes().find(r => r.output.blueprintId === BlueprintType.IronSword)!;
    expect(mgr.craft(1, swordRecipe.id).ok).toBe(false);

    // Add hammer, try again
    mgr.addItem(1, BlueprintType.Hammer, 1);
    expect(mgr.craft(1, swordRecipe.id).ok).toBe(true);
  });

  it('getSyncData returns correct structure', () => {
    mgr.create(1);
    mgr.addItem(1, BlueprintType.Wood, 3);
    const { itemId } = mgr.addItem(1, BlueprintType.Axe, 1);
    mgr.equip(1, itemId!);

    const sync = mgr.getSyncData(1);
    expect(sync).toHaveLength(2);
    const axeSync = sync.find(s => s.blueprintId === BlueprintType.Axe)!;
    expect(axeSync.equippedSlot).toBe(1); // hand
    const woodSync = sync.find(s => s.blueprintId === BlueprintType.Wood)!;
    expect(woodSync.equippedSlot).toBe(0); // none
  });

  it('destroy removes inventory', () => {
    mgr.create(1);
    mgr.addItem(1, BlueprintType.Wood, 5);
    mgr.destroy(1);
    expect(mgr.get(1)).toBeUndefined();
  });
});

describe('canCraft (shared pure function)', () => {
  it('returns true with sufficient materials', () => {
    const inv = {
      items: [{ itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5 }, { itemId: 2, blueprintId: BlueprintType.Rock, quantity: 3 }],
      maxWeight: 50,
    };
    const axeRecipe = getAllRecipes().find(r => r.output.blueprintId === BlueprintType.Axe)!;
    expect(canCraft(axeRecipe, inv)).toBe(true);
  });

  it('returns false with insufficient materials', () => {
    const inv = {
      items: [{ itemId: 1, blueprintId: BlueprintType.Wood, quantity: 1 }],
      maxWeight: 50,
    };
    const axeRecipe = getAllRecipes().find(r => r.output.blueprintId === BlueprintType.Axe)!;
    expect(canCraft(axeRecipe, inv)).toBe(false);
  });
});

describe('Protocol: new actions + InventorySync', () => {
  it('round-trips Pickup', () => {
    const buf = encodeAction({ action: ClientAction.Pickup, entityId: 42 });
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.Pickup);
      expect((msg.data as any).entityId).toBe(42);
    }
  });

  it('round-trips Equip', () => {
    const buf = encodeAction({ action: ClientAction.Equip, itemId: 7 });
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.Equip);
      expect((msg.data as any).itemId).toBe(7);
    }
  });

  it('round-trips Unequip', () => {
    const buf = encodeAction({ action: ClientAction.Unequip, slot: 1 });
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.Unequip);
      expect((msg.data as any).slot).toBe(1);
    }
  });

  it('round-trips Drop', () => {
    const buf = encodeAction({ action: ClientAction.Drop, itemId: 3 });
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.Drop);
      expect((msg.data as any).itemId).toBe(3);
    }
  });

  it('round-trips Craft', () => {
    const buf = encodeAction({ action: ClientAction.Craft, recipeId: 5 });
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.Craft);
      expect((msg.data as any).recipeId).toBe(5);
    }
  });

  it('round-trips InventorySync', () => {
    const items = [
      { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, equippedSlot: 0 },
      { itemId: 2, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 1 },
    ];
    const buf = encodeInventorySync(items);
    const msg = decodeServerMessage(buf);
    expect(msg.type).toBe('inventorySync');
    if (msg.type === 'inventorySync') {
      expect(msg.items).toEqual(items);
    }
  });
});
