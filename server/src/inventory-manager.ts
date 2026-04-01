import { getBlueprint, type EquipSlot } from '@shared/blueprints.js';
import { getRecipe } from '@shared/recipes.js';
import { getWeight, findItem, getEquipped, canCraft, equipSlotToNumber } from '@shared/inventory.js';
import type { Inventory, InventoryItem } from '@shared/inventory.js';
import type { Recipe } from '@shared/recipes.js';
import type { SyncedInventoryItem } from '@shared/protocol/codec.js';

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

  equip(entityId: number, itemId: number): boolean {
    const inv = this.inventories.get(entityId);
    if (!inv) return false;

    const item = findItem(inv, itemId);
    if (!item) return false;

    const bp = getBlueprint(item.blueprintId);
    if (!bp?.equipSlot) return false;

    // If already equipped in the same slot, unequip
    if (item.equippedSlot) {
      item.equippedSlot = undefined;
      return true;
    }

    // Unequip current item in that slot
    const current = getEquipped(inv, bp.equipSlot);
    if (current) {
      current.equippedSlot = undefined;
    }

    item.equippedSlot = bp.equipSlot;
    return true;
  }

  unequip(entityId: number, slot: EquipSlot): boolean {
    const inv = this.inventories.get(entityId);
    if (!inv) return false;

    const item = getEquipped(inv, slot);
    if (!item) return false;

    item.equippedSlot = undefined;
    return true;
  }

  drop(entityId: number, itemId: number): { blueprintId: number; quantity: number } | null {
    const inv = this.inventories.get(entityId);
    if (!inv) return null;

    const idx = inv.items.findIndex(i => i.itemId === itemId);
    if (idx === -1) return null;

    const item = inv.items[idx];
    const result = { blueprintId: item.blueprintId, quantity: item.quantity };
    inv.items.splice(idx, 1);
    return result;
  }

  craft(entityId: number, recipeId: number): boolean {
    const inv = this.inventories.get(entityId);
    if (!inv) return false;

    const recipe = getRecipe(recipeId);
    if (!recipe) return false;

    if (!canCraft(recipe, inv)) return false;

    // Check weight of output
    const outBp = getBlueprint(recipe.output.blueprintId);
    const outputWeight = (outBp?.weight ?? 0) * recipe.output.quantity;
    let inputWeight = 0;
    for (const input of recipe.inputs) {
      const ibp = getBlueprint(input.blueprintId);
      inputWeight += (ibp?.weight ?? 0) * input.quantity;
    }
    if (getWeight(inv) - inputWeight + outputWeight > inv.maxWeight) return false;

    // Consume inputs
    for (const input of recipe.inputs) {
      this.consumeByBlueprint(inv, input.blueprintId, input.quantity);
    }

    // Produce output
    this.addItem(entityId, recipe.output.blueprintId, recipe.output.quantity);
    return true;
  }

  destroy(entityId: number): void {
    this.inventories.delete(entityId);
  }

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

  transferToContainer(playerEid: number, containerEid: number, itemId: number): boolean {
    const playerInv = this.get(playerEid);
    const containerInv = this.get(containerEid);
    if (!playerInv || !containerInv) return false;
    const item = findItem(playerInv, itemId);
    if (!item) return false;
    const result = this.addItem(containerEid, item.blueprintId, 1);
    if (!result.success) return false;
    this.removeItem(playerEid, itemId, 1);
    return true;
  }

  transferFromContainer(playerEid: number, containerEid: number, itemId: number): boolean {
    const containerInv = this.get(containerEid);
    const playerInv = this.get(playerEid);
    if (!containerInv || !playerInv) return false;
    const item = findItem(containerInv, itemId);
    if (!item) return false;
    const result = this.addItem(playerEid, item.blueprintId, 1);
    if (!result.success) return false;
    this.removeItem(containerEid, itemId, 1);
    return true;
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
