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
 *
 *  Entity placement (`newBuilding === null`): legal anywhere a player can
 *  stand. Floors are fine (furnish-the-house case); walls/fences are not;
 *  water/rock are not; bridged river is fine. Reuses `isWalkable` so the
 *  rule stays in lockstep.
 *
 *  Building-tile placement (`newBuilding !== null`): no stacking — existing
 *  building must be `None`. Water/rock never accept buildings. River only
 *  accepts floors (bridging). */
export function isPlaceable(
  terrain: Terrain,
  current: Building,
  newBuilding: Building | null,
): boolean {
  if (newBuilding === null) {
    return isWalkable(terrain, current);
  }
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
