import { Terrain, Building } from './terrain.js';
import { BlueprintType } from './blueprints.js';

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
    case Building.Floor: return '_';
    case Building.Door:  return '+';
    case Building.Fence: return '|';
    default:             return '?';
  }
}

export function blueprintChar(bp: BlueprintType): string {
  switch (bp) {
    case BlueprintType.Player: return '@';
    case BlueprintType.Deer:   return 'd';
    case BlueprintType.Rabbit: return 'r';
    case BlueprintType.Fox:    return 'f';
    case BlueprintType.Wolf:   return 'w';
    case BlueprintType.Tree:   return 'T';
    case BlueprintType.Rock:   return 'O';
    default:                   return '?';
  }
}

/** Covering priority: entity > building > ground */
export function tileChar(terrain: Terrain, building: Building, entity?: BlueprintType): string {
  if (entity !== undefined) return blueprintChar(entity);
  const bc = buildingChar(building);
  if (bc) return bc;
  return terrainChar(terrain);
}
