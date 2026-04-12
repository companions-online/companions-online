import { Terrain, Building } from './terrain.js';
import { BlueprintType } from './blueprints.js';
import { StatusEffect } from './status-effects.js';

export function terrainChar(t: Terrain): string {
  switch (t) {
    case Terrain.Grass: return '.';
    case Terrain.Dirt:  return ',';
    case Terrain.Rock:  return '^';
    case Terrain.Sand:  return ':';
    case Terrain.Water: return '~';
    case Terrain.River: return '~';
    default:            return '?';
  }
}

export function buildingChar(b: Building): string {
  switch (b) {
    case Building.None:  return '';
    case Building.Wall:  return '#';
    case Building.WoodenFloor: return '_';
    case Building.StoneFloor:  return '=';
    case Building.Fence: return '|';
    default:             return '?';
  }
}

export function blueprintChar(bp: BlueprintType, effects?: number): string {
  if (bp === BlueprintType.WoodenDoor && effects !== undefined && (effects & StatusEffect.Open)) return '/';
  switch (bp) {
    // Creatures
    case BlueprintType.Player:   return '@';
    case BlueprintType.Deer:     return 'd';
    case BlueprintType.Rabbit:   return 'r';
    case BlueprintType.Fox:      return 'f';
    case BlueprintType.Wolf:     return 'w';
    case BlueprintType.Bear:     return 'B';
    case BlueprintType.Skeleton: return 'Z';
    // Resources
    case BlueprintType.Wood:     return 'w';
    case BlueprintType.Rock:     return 'o';
    case BlueprintType.Iron:     return 'i';
    case BlueprintType.Hide:     return 'h';
    case BlueprintType.RawMeat:  return 'm';
    case BlueprintType.RawFish:  return 'n';
    // Tools
    case BlueprintType.Axe:        return 'a';
    case BlueprintType.Pickaxe:    return 'p';
    case BlueprintType.Hammer:     return 'k';
    case BlueprintType.FishingRod: return 'j';
    // Weapons
    case BlueprintType.WoodenClub: return 'c';
    case BlueprintType.StoneKnife: return 's';
    case BlueprintType.IronSword:  return 'S';
    case BlueprintType.IronSpear:  return '/';
    // Armor
    case BlueprintType.HideVest:       return 'v';
    case BlueprintType.HideCap:        return 'u';
    case BlueprintType.IronChestplate: return 'V';
    case BlueprintType.IronHelm:       return 'U';
    // Consumables
    case BlueprintType.CookedFish: return 'F';
    case BlueprintType.CookedMeat: return 'C';
    case BlueprintType.Bandage:    return 'b';
    // Placeables
    case BlueprintType.Campfire:     return '*';
    case BlueprintType.WoodenWall:   return '#';
    case BlueprintType.WoodenDoor:   return '+';
    case BlueprintType.StorageChest: return '$';
    // World objects
    case BlueprintType.Tree:     return 'T';
    // HillRock removed — Terrain.Rock handles mining directly
    // NPCs
    case BlueprintType.Hermit:   return 'H';
    case BlueprintType.Trader:   return 'M';
    case BlueprintType.Wanderer: return 'W';
    // Special
    case BlueprintType.Compass: return '!';
    default:                    return '?';
  }
}

/** Covering priority: entity > building > ground */
export function tileChar(terrain: Terrain, building: Building, entity?: BlueprintType, effects?: number): string {
  if (entity !== undefined) return blueprintChar(entity, effects);
  const bc = buildingChar(building);
  if (bc) return bc;
  return terrainChar(terrain);
}
