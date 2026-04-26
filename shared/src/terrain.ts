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

/** Can an entity stand on and traverse this tile?
 *  - Water / Rock: never.
 *  - Wall / Fence: never.
 *  - River: only when bridged by a WoodenFloor / StoneFloor.
 *  - Everything else: walkable. */
export function isWalkable(terrain: Terrain, building: Building): boolean {
  if (terrain === Terrain.Water || terrain === Terrain.Rock) return false;
  if (building === Building.Wall || building === Building.Fence) return false;
  if (terrain === Terrain.River) {
    return building === Building.WoodenFloor || building === Building.StoneFloor;
  }
  return true;
}

/** Is this tile a valid surface for placing `newBuilding` (or `null` for an
 *  entity placement like Door / Chest / Campfire)?
 *  - No existing building on the tile (can't stack).
 *  - Water / Rock: never placeable on.
 *  - River: placeable only when the new building is a floor (bridging).
 *  - Other terrain: placeable. */
export function isPlaceable(
  terrain: Terrain,
  current: Building,
  newBuilding: Building | null,
): boolean {
  if (current !== Building.None) return false;
  if (terrain === Terrain.Water || terrain === Terrain.Rock) return false;
  if (terrain === Terrain.River) {
    return newBuilding === Building.WoodenFloor || newBuilding === Building.StoneFloor;
  }
  return true;
}

/** Does light pass through this tile during shadowcasting?
 *  - Walls / fences block.
 *  - Water / Rock block (preserves prior shadowcast behavior).
 *  - Grass / Dirt / Sand / River / floor tiles pass.
 *  Entity blockers (closed doors, chest, tree, campfire) are layered on top
 *  of this at the caller via its own blockerEntities set. */
export function isLightPassing(terrain: Terrain, building: Building): boolean {
  if (building === Building.Wall || building === Building.Fence) return false;
  return terrain !== Terrain.Water && terrain !== Terrain.Rock;
}
