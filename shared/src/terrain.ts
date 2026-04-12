export const enum Terrain {
  Grass = 0,
  Dirt  = 1,
  Rock  = 2,
  Sand  = 3,
  Water = 4,
  River = 5,
  /** Rendering-only — never stored in worldMap.terrain. */
  WoodenFloor = 6,
  /** Rendering-only — never stored in worldMap.terrain. */
  StoneFloor  = 7,
}

export const enum Building {
  None        = 0,
  Wall        = 1,
  WoodenFloor = 2,
  StoneFloor  = 3,
  Fence       = 4,
}

export function isWalkable(terrain: Terrain, building: Building): boolean {
  if (terrain === Terrain.Water || terrain === Terrain.Rock) return false;
  if (building === Building.None || building === Building.WoodenFloor || building === Building.StoneFloor) return true;
  return false;
}
