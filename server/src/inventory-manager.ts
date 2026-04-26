import { getBlueprint, type EquipSlot } from '@shared/blueprints.js';
import { getRecipe } from '@shared/recipes.js';
import { getWeight, findItem, getEquipped, canCraft, equipSlotToNumber } from '@shared/inventory.js';
import type { Inventory, InventoryItem } from '@shared/inventory.js';
import type { Recipe } from '@shared/recipes.js';
import type { SyncedInventoryItem } from '@shared/protocol/codec.js';
import { Ok, OkValue, Err, type ActionResult, type ActionResultOf } from './action-rejection.js';

export class InventoryManager {
  private inventories = new Map<number, Inventory>();
  private nextItemId = 1;

  create(entityId: number, maxWeight = 50): void {
    this.inventories.set(entityId, { items: [], maxWeight });
  }

  get(entityId: number): Inventory | undefined {
    return this.inventories.get(entityId);
  }

  addItem(entityId: number, blueprintId: number, quantity: number): { success: boolean; itemId?: number } {
    const inv = this.inventories.get(entityId);
    if (!inv) return { success: false };

    const bp = getBlueprint(blueprintId);
    if (!bp) return { success: false };

    const addedWeight = (bp.weight ?? 0) * quantity;
    if (getWeight(inv) + addedWeight > inv.maxWeight) return { success: false };

    // Stack if possible
    if (bp.stackable) {
      const existing = inv.items.find(i => i.blueprintId === blueprintId && !i.equippedSlot);
      if (existing) {
        const maxStack = bp.maxStack ?? 99;
        const space = maxStack - existing.quantity;
        if (space >= quantity) {
          existing.quantity += quantity;
          return { success: true, itemId: existing.itemId };
        }
      }
    }

    const itemId = this.nextItemId++;
    inv.items.push({ itemId, blueprintId, quantity });
    return { success: true, itemId };
  }

  removeItem(entityId: number, itemId: number, quantity?: number): boolean {
    const inv = this.inventories.get(entityId);
    if (!inv) return false;

    const idx = inv.items.findIndex(i => i.itemId === itemId);
    if (idx === -1) return false;

    const item = inv.items[idx];
    const removeQty = quantity ?? item.quantity;
    if (removeQty >= item.quantity) {
      inv.items.splice(idx, 1);
    } else {
      item.quantity -= removeQty;
    }
    return true;
  }

  equip(entityId: number, itemId: number, quantity?: number): ActionResult {
    const inv = this.inventories.get(entityId);
    if (!inv) return Err({ code: 'item_missing', itemId });

    const item = findItem(inv, itemId);
    if (!item) return Err({ code: 'item_missing', itemId });

    const bp = getBlueprint(item.blueprintId);
    if (!bp?.equipSlot) return Err({ code: 'not_equippable', itemId });

    // If already equipped in the same slot, unequip (whole stack)
    if (item.equippedSlot) {
      item.equippedSlot = undefined;
      return Ok;
    }

    // Split-equip: if caller requested fewer than the full stack, peel off
    // `quantity` into a new inventory entry marked equipped. The remainder
    // stays in the source stack, unequipped.
    if (quantity !== undefined && quantity > 0 && quantity < item.quantity) {
      const current = getEquipped(inv, bp.equipSlot);
      if (current) current.equippedSlot = undefined;
      item.quantity -= quantity;
      inv.items.push({
        itemId: this.nextItemId++,
        blueprintId: item.blueprintId,
        quantity,
        equippedSlot: bp.equipSlot,
      });
      return Ok;
    }

    const current = getEquipped(inv, bp.equipSlot);
    if (current) {
      current.equippedSlot = undefined;
    }

    item.equippedSlot = bp.equipSlot;
    return Ok;
  }

  unequip(entityId: number, slot: EquipSlot): ActionResult {
    const inv = this.inventories.get(entityId);
    if (!inv) return Err({ code: 'slot_empty', slot });

    const item = getEquipped(inv, slot);
    if (!item) return Err({ code: 'slot_empty', slot });

    item.equippedSlot = undefined;
    return Ok;
  }

  drop(entityId: number, itemId: number, quantity?: number): ActionResultOf<{ blueprintId: number; quantity: number }> {
    const inv = this.inventories.get(entityId);
    if (!inv) return Err({ code: 'item_missing', itemId });

    const idx = inv.items.findIndex(i => i.itemId === itemId);
    if (idx === -1) return Err({ code: 'item_missing', itemId });

    const item = inv.items[idx];
    const take = quantity !== undefined && quantity > 0 && quantity < item.quantity
      ? quantity
      : item.quantity;
    const result = { blueprintId: item.blueprintId, quantity: take };
    if (take >= item.quantity) {
      inv.items.splice(idx, 1);
    } else {
      item.quantity -= take;
    }
    return OkValue(result);
  }

  craft(entityId: number, recipeId: number): ActionResult {
    const inv = this.inventories.get(entityId);
    if (!inv) return Err({ code: 'recipe_unknown', recipeId });

    const recipe = getRecipe(recipeId);
    if (!recipe) return Err({ code: 'recipe_unknown', recipeId });

    if (!canCraft(recipe, inv)) return Err({ code: 'missing_materials', recipeId });

    const outBp = getBlueprint(recipe.output.blueprintId);
    const outputWeight = (outBp?.weight ?? 0) * recipe.output.quantity;
    let inputWeight = 0;
    for (const input of recipe.inputs) {
      const ibp = getBlueprint(input.blueprintId);
      inputWeight += (ibp?.weight ?? 0) * input.quantity;
    }
    if (getWeight(inv) - inputWeight + outputWeight > inv.maxWeight) {
      return Err({ code: 'inventory_full', weight: getWeight(inv), maxWeight: inv.maxWeight });
    }

    for (const input of recipe.inputs) {
      this.consumeByBlueprint(inv, input.blueprintId, input.quantity);
    }

    this.addItem(entityId, recipe.output.blueprintId, recipe.output.quantity);
    return Ok;
  }

  destroy(entityId: number): void {
    this.inventories.delete(entityId);
  }

  getAll(): ReadonlyMap<number, Inventory> { return this.inventories; }
  getNextItemId(): number { return this.nextItemId; }
  setNextItemId(id: number): void { this.nextItemId = id; }

  getSyncData(entityId: number): SyncedInventoryItem[] {
    const inv = this.inventories.get(entityId);
    if (!inv) return [];
    return inv.items.map(i => ({
      itemId: i.itemId,
      blueprintId: i.blueprintId,
      quantity: i.quantity,
      equippedSlot: equipSlotToNumber(i.equippedSlot),
    }));
  }

  transferToContainer(playerEid: number, containerEid: number, itemId: number, quantity?: number): ActionResult {
    const playerInv = this.get(playerEid);
    const containerInv = this.get(containerEid);
    if (!playerInv || !containerInv) return Err({ code: 'target_missing', targetEntityId: containerEid });
    const item = findItem(playerInv, itemId);
    if (!item) return Err({ code: 'item_missing', itemId });
    const take = quantity !== undefined && quantity > 0 && quantity < item.quantity ? quantity : item.quantity;
    const result = this.addItem(containerEid, item.blueprintId, take);
    if (!result.success) {
      return Err({ code: 'inventory_full', weight: getWeight(containerInv), maxWeight: containerInv.maxWeight });
    }
    this.removeItem(playerEid, itemId, take);
    return Ok;
  }

  transferFromContainer(playerEid: number, containerEid: number, itemId: number, quantity?: number): ActionResult {
    const containerInv = this.get(containerEid);
    const playerInv = this.get(playerEid);
    if (!containerInv || !playerInv) return Err({ code: 'target_missing', targetEntityId: containerEid });
    const item = findItem(containerInv, itemId);
    if (!item) return Err({ code: 'item_missing', itemId });
    const take = quantity !== undefined && quantity > 0 && quantity < item.quantity ? quantity : item.quantity;
    const result = this.addItem(playerEid, item.blueprintId, take);
    if (!result.success) {
      return Err({ code: 'inventory_full', weight: getWeight(playerInv), maxWeight: playerInv.maxWeight });
    }
    this.removeItem(containerEid, itemId, take);
    return Ok;
  }

  private consumeByBlueprint(inv: Inventory, blueprintId: number, quantity: number): void {
    let remaining = quantity;
    for (let i = inv.items.length - 1; i >= 0 && remaining > 0; i--) {
      const item = inv.items[i];
      if (item.blueprintId !== blueprintId) continue;
      if (item.quantity <= remaining) {
        remaining -= item.quantity;
        inv.items.splice(i, 1);
      } else {
        item.quantity -= remaining;
        remaining = 0;
      }
    }
  }
}
