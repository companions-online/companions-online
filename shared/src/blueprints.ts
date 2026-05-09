export type BlueprintCategory = 'creature' | 'item' | 'resource' | 'placeable' | 'npc';
export type EquipSlot = 'hand' | 'body' | 'head' | 'boot';

export interface Blueprint {
  id: number;
  name: string;
  category: BlueprintCategory;
  sprite: string;
  /** Number of visual variants available for this blueprint. Worldgen picks
   *  one at spawn time (0..variantCount-1) and stores it on the entity's
   *  BlueprintId component. Defaults to 1. */
  variantCount?: number;
  // Creature-specific
  maxHp?: number;
  speed?: number;
  damage?: number;
  attackSpeed?: number;
  collides?: boolean;
  // Item-specific
  stackable?: boolean;
  maxStack?: number;
  weight?: number;
  equipSlot?: EquipSlot;
  hpBonus?: number;
  weaponDamage?: number;
  weaponSpeed?: number;
  consumeHeal?: number;
  consumeTicks?: number;
  // Lighting
  /** Radius in tiles that this blueprint emits light. Omit for non-emitters. */
  lightRadius?: number;
  /** RGB color of emitted light (each channel 0..1). Defaults to warm if
   *  `lightRadius` is set without an explicit color. */
  lightColor?: readonly [number, number, number];
}

export const enum BlueprintType {
  // Creatures 0-19
  Player   = 0,
  Deer     = 1,
  Rabbit   = 2,
  Fox      = 3,
  Wolf     = 4,
  Bear     = 5,
  Skeleton = 6,

  // Resources 20-29
  Wood     = 20,
  Rock     = 21,
  Iron     = 22,
  Hide     = 23,
  RawMeat  = 24,
  RawFish  = 25,

  // Tools 30-39
  Axe        = 30,
  Pickaxe    = 31,
  Hammer     = 32,
  FishingRod = 33,

  // Weapons 40-49
  WoodenClub = 40,
  StoneKnife = 41,
  IronSword  = 42,
  IronSpear  = 43,

  // Armor 50-59
  HideVest        = 50,
  HideCap         = 51,
  IronChestplate  = 52,
  IronHelm        = 53,

  // Consumables 60-69
  CookedFish = 60,
  CookedMeat = 61,
  Bandage    = 62,

  // Placeables 70-79
  Campfire     = 70,
  WoodenWall   = 71,
  WoodenDoor   = 72,
  StorageChest = 73,
  WoodenFloor  = 74,
  StoneFloor   = 75,

  // World objects 80-89
  Tree     = 80,

  // NPCs 90-99
  Hermit   = 90,
  Trader   = 91,
  Wanderer = 92,

  // Special 100+
  Compass = 100,
}

const BLUEPRINTS: Blueprint[] = [
  // --- Creatures ---
  { id: BlueprintType.Player,   name: 'Player',   category: 'creature', sprite: 'player',   variantCount: 6, maxHp: 100, speed: 3,   damage: 1,  attackSpeed: 2,  collides: true },
  { id: BlueprintType.Deer,     name: 'Deer',     category: 'creature', sprite: 'deer',     maxHp: 12,  speed: 3.5, damage: 0,  attackSpeed: 0,  collides: true },
  { id: BlueprintType.Rabbit,   name: 'Rabbit',   category: 'creature', sprite: 'rabbit',   maxHp: 3,   speed: 4,   damage: 0,  attackSpeed: 0,  collides: true },
  { id: BlueprintType.Fox,      name: 'Fox',      category: 'creature', sprite: 'fox',      maxHp: 10,  speed: 3,   damage: 2,  attackSpeed: 3,  collides: true },
  { id: BlueprintType.Wolf,     name: 'Wolf',     category: 'creature', sprite: 'wolf',     maxHp: 20,  speed: 2.5, damage: 4,  attackSpeed: 4,  collides: true },
  { id: BlueprintType.Bear,     name: 'Bear',     category: 'creature', sprite: 'bear',     maxHp: 40,  speed: 2,   damage: 7,  attackSpeed: 5,  collides: true },
  { id: BlueprintType.Skeleton, name: 'Skeleton', category: 'creature', sprite: 'skeleton', maxHp: 25,  speed: 2.5, damage: 5,  attackSpeed: 4,  collides: true },

  // --- Resources ---
  { id: BlueprintType.Wood,    name: 'Wood',     category: 'resource', sprite: 'wood',     stackable: true, maxStack: 99, weight: 1 },
  { id: BlueprintType.Rock,    name: 'Rock',     category: 'resource', sprite: 'rock_i',   stackable: true, maxStack: 99, weight: 2 },
  { id: BlueprintType.Iron,    name: 'Iron',     category: 'resource', sprite: 'iron',     stackable: true, maxStack: 99, weight: 3 },
  { id: BlueprintType.Hide,    name: 'Hide',     category: 'resource', sprite: 'hide',     stackable: true, maxStack: 99, weight: 1 },
  { id: BlueprintType.RawMeat, name: 'Raw Meat', category: 'resource', sprite: 'rawmeat',  stackable: true, maxStack: 99, weight: 1, equipSlot: 'hand' },
  { id: BlueprintType.RawFish, name: 'Raw Fish', category: 'resource', sprite: 'rawfish',  stackable: true, maxStack: 99, weight: 1, equipSlot: 'hand' },

  // --- Tools ---
  { id: BlueprintType.Axe,        name: 'Axe',         category: 'item', sprite: 'axe',     stackable: true, maxStack: 10, weight: 3, equipSlot: 'hand', weaponDamage: 3, weaponSpeed: 4 },
  { id: BlueprintType.Pickaxe,    name: 'Pickaxe',     category: 'item', sprite: 'pickaxe', stackable: true, maxStack: 10, weight: 3, equipSlot: 'hand', weaponDamage: 2, weaponSpeed: 5 },
  { id: BlueprintType.Hammer,     name: 'Hammer',      category: 'item', sprite: 'hammer',  stackable: true, maxStack: 10, weight: 4, equipSlot: 'hand', weaponDamage: 2, weaponSpeed: 5 },
  { id: BlueprintType.FishingRod, name: 'Fishing Rod', category: 'item', sprite: 'fishrod', stackable: true, maxStack: 10, weight: 2, equipSlot: 'hand' },

  // --- Weapons ---
  { id: BlueprintType.WoodenClub, name: 'Wooden Club', category: 'item', sprite: 'club',   stackable: true, maxStack: 10, weight: 2, equipSlot: 'hand', weaponDamage: 3, weaponSpeed: 5 },
  { id: BlueprintType.StoneKnife, name: 'Stone Knife', category: 'item', sprite: 'knife',  stackable: true, maxStack: 10, weight: 1, equipSlot: 'hand', weaponDamage: 4, weaponSpeed: 3 },
  { id: BlueprintType.IronSword,  name: 'Iron Sword',  category: 'item', sprite: 'sword',  stackable: true, maxStack: 10, weight: 3, equipSlot: 'hand', weaponDamage: 7, weaponSpeed: 4 },
  { id: BlueprintType.IronSpear,  name: 'Iron Spear',  category: 'item', sprite: 'spear',  stackable: true, maxStack: 10, weight: 3, equipSlot: 'hand', weaponDamage: 6, weaponSpeed: 4 },

  // --- Armor ---
  { id: BlueprintType.HideVest,       name: 'Hide Vest',       category: 'item', sprite: 'hvest',  stackable: true, maxStack: 10, weight: 3, equipSlot: 'body', hpBonus: 10 },
  { id: BlueprintType.HideCap,        name: 'Hide Cap',        category: 'item', sprite: 'hcap',   stackable: true, maxStack: 10, weight: 1, equipSlot: 'head', hpBonus: 5 },
  { id: BlueprintType.IronChestplate, name: 'Iron Chestplate', category: 'item', sprite: 'ichest', stackable: true, maxStack: 10, weight: 6, equipSlot: 'body', hpBonus: 25 },
  { id: BlueprintType.IronHelm,       name: 'Iron Helm',       category: 'item', sprite: 'ihelm',  stackable: true, maxStack: 10, weight: 3, equipSlot: 'head', hpBonus: 10 },

  // --- Consumables ---
  { id: BlueprintType.CookedFish, name: 'Cooked Fish', category: 'item', sprite: 'cfish', stackable: true, maxStack: 10, weight: 1, consumeHeal: 15, consumeTicks: 3 },
  { id: BlueprintType.CookedMeat, name: 'Cooked Meat', category: 'item', sprite: 'cmeat', stackable: true, maxStack: 10, weight: 1, consumeHeal: 20, consumeTicks: 3 },
  { id: BlueprintType.Bandage,    name: 'Bandage',     category: 'item', sprite: 'band',  stackable: true, maxStack: 10, weight: 1, consumeHeal: 30, consumeTicks: 10 },

  // --- Placeables ---
  { id: BlueprintType.Campfire,     name: 'Campfire',      category: 'placeable', sprite: 'fire',  stackable: true, maxStack: 10, weight: 4, equipSlot: 'hand', collides: true, lightRadius: 6, lightColor: [1.0, 0.65, 0.3] },
  { id: BlueprintType.WoodenWall,   name: 'Wooden Wall',   category: 'placeable', sprite: 'wwall', stackable: true, maxStack: 10, weight: 4, equipSlot: 'hand', collides: true, maxHp: 30 },
  { id: BlueprintType.WoodenDoor,   name: 'Wooden Door',   category: 'placeable', sprite: 'wdoor', stackable: true, maxStack: 10, weight: 5, equipSlot: 'hand', collides: true, maxHp: 30 },
  { id: BlueprintType.StorageChest, name: 'Storage Chest', category: 'placeable', sprite: 'chest', stackable: true, maxStack: 10, weight: 6, equipSlot: 'hand', collides: true, maxHp: 50 },
  { id: BlueprintType.WoodenFloor,  name: 'Wooden Floor',  category: 'placeable', sprite: 'wfloor', stackable: true, maxStack: 10, weight: 2, equipSlot: 'hand' },
  { id: BlueprintType.StoneFloor,   name: 'Stone Floor',   category: 'placeable', sprite: 'sfloor', stackable: true, maxStack: 10, weight: 4, equipSlot: 'hand' },

  // --- World objects ---
  { id: BlueprintType.Tree,     name: 'Tree',      category: 'resource', sprite: 'tree', variantCount: 4, maxHp: 50, speed: 0, damage: 0, attackSpeed: 0, collides: true },
  // --- NPCs ---
  { id: BlueprintType.Hermit,   name: 'The Hermit',   category: 'npc', sprite: 'hermit',   maxHp: 999, speed: 0, damage: 0, attackSpeed: 0, collides: true },
  { id: BlueprintType.Trader,   name: 'The Trader',   category: 'npc', sprite: 'trader',   maxHp: 999, speed: 0, damage: 0, attackSpeed: 0, collides: true },
  { id: BlueprintType.Wanderer, name: 'The Wanderer', category: 'npc', sprite: 'wanderer', maxHp: 999, speed: 1, damage: 0, attackSpeed: 0, collides: true },

  // --- Special ---
  { id: BlueprintType.Compass, name: 'Compass', category: 'item', sprite: 'compass', weight: 1 },
];

const blueprintMap = new Map<number, Blueprint>();
const blueprintByName = new Map<string, Blueprint>();
for (const bp of BLUEPRINTS) {
  blueprintMap.set(bp.id, bp);
  blueprintByName.set(bp.name.toLowerCase(), bp);
}

export function getBlueprint(id: number): Blueprint | undefined {
  return blueprintMap.get(id);
}

/** Case-insensitive, whitespace-collapsed lookup by display name. */
export function getBlueprintByName(name: string): Blueprint | undefined {
  return blueprintByName.get(name.trim().toLowerCase().replace(/\s+/g, ' '));
}

import { Building } from './terrain.js';

export function blueprintToBuilding(bp: BlueprintType): Building | null {
  switch (bp) {
    case BlueprintType.WoodenWall:  return Building.Wall;
    case BlueprintType.WoodenFloor: return Building.WoodenFloor;
    case BlueprintType.StoneFloor:  return Building.StoneFloor;
    default: return null;
  }
}
