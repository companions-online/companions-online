export const enum Terrain {
  Grass = 0,
  Dirt  = 1,
  Rock  = 2,
  Sand  = 3,
  Water = 4,
  River = 5,
}

export const enum Building {
  None  = 0,
  Wall  = 1,
  Floor = 2,
  Door  = 3,
  Fence = 4,
}

export function isWalkable(terrain: Terrain, building: Building): boolean {
  if (terrain === Terrain.Water || terrain === Terrain.Rock) return false;
  if (building === Building.None || building === Building.Floor || building === Building.Door) return true;
  return false;
}
