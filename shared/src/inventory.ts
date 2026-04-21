import { getBlueprint, type EquipSlot } from './blueprints.js';
import type { Recipe } from './recipes.js';

export type { EquipSlot } from './blueprints.js';

export interface InventoryItem {
  itemId: number;
  blueprintId: number;
  quantity: number;
  equippedSlot?: EquipSlot;
}

export interface Inventory {
  items: InventoryItem[];
  maxWeight: number;
}

export function getWeight(inv: Inventory): number {
  let total = 0;
  for (const item of inv.items) {
    const bp = getBlueprint(item.blueprintId);
    total += (bp?.weight ?? 0) * item.quantity;
  }
  return total;
}

export function findItem(inv: Inventory, itemId: number): InventoryItem | undefined {
  return inv.items.find(i => i.itemId === itemId);
}

export function getEquipped(inv: Inventory, slot: EquipSlot): InventoryItem | undefined {
  return inv.items.find(i => i.equippedSlot === slot);
}

export function hasItems(inv: Inventory, blueprintId: number, quantity: number): boolean {
  let total = 0;
  for (const item of inv.items) {
    if (item.blueprintId === blueprintId) total += item.quantity;
  }
  return total >= quantity;
}

export function canCraft(recipe: Recipe, inv: Inventory): boolean {
  for (const input of recipe.inputs) {
    if (!hasItems(inv, input.blueprintId, input.quantity)) return false;
  }
  if (recipe.requiresTool !== undefined) {
    if (!inv.items.some(i => i.blueprintId === recipe.requiresTool)) return false;
  }
  return true;
}

export const EQUIP_SLOT_NONE = 0;
export const EQUIP_SLOT_HAND = 1;
export const EQUIP_SLOT_BODY = 2;
export const EQUIP_SLOT_HEAD = 3;
export const EQUIP_SLOT_BOOT = 4;

export function equipSlotToNumber(slot?: EquipSlot): number {
  if (!slot) return EQUIP_SLOT_NONE;
  switch (slot) {
    case 'hand': return EQUIP_SLOT_HAND;
    case 'body': return EQUIP_SLOT_BODY;
    case 'head': return EQUIP_SLOT_HEAD;
    case 'boot': return EQUIP_SLOT_BOOT;
  }
}

export function numberToEquipSlot(n: number): EquipSlot | undefined {
  switch (n) {
    case EQUIP_SLOT_HAND: return 'hand';
    case EQUIP_SLOT_BODY: return 'body';
    case EQUIP_SLOT_HEAD: return 'head';
    case EQUIP_SLOT_BOOT: return 'boot';
    default: return undefined;
  }
}
