// Build an ActionContext for a target tile so the shared resolveAction can
// decide what the click should do (move, harvest, attack, interact, pickup).
// Mirrors cli/render.ts's buildCursorContext but sources state from the
// webgl Scene (entities Map + WorldMap + inventory) instead of flat grids.

import { Terrain, Building } from '@shared/terrain.js';
import type { ActionContext } from '@shared/action-resolver.js';
import type { Scene } from '../scene.js';

/**
 * Build an ActionContext from a known entity hit (from AABB sprite
 * hit testing). Reads terrain/building at the entity's tile for
 * isWalkable + equipped hand item, but skips the entity-at-tile scan.
 */
export function buildContextFromEntity(
  scene: Scene,
  entity: { entityId: number; blueprintId: number; isGroundItem: boolean },
): ActionContext | null {
  const e = scene.entities.get(entity.entityId);
  if (!e?.position) return null;
  const tx = e.position.tileX;
  const ty = e.position.tileY;
  if (!scene.worldMap.inBounds(tx, ty)) return null;

  const t = scene.worldMap.getTerrain(tx, ty) as Terrain;
  const b = scene.worldMap.getBuilding(tx, ty) as Building;
  const isWalkable =
    !(t === Terrain.Water || t === Terrain.Rock || t === Terrain.River)
    && (b === Building.None || b === Building.WoodenFloor || b === Building.StoneFloor);

  const handItem = scene.inventory.find(i => i.equippedSlot === 1);

  return {
    targetX: tx,
    targetY: ty,
    isWalkable,
    terrainType: t,
    entityAtTarget: entity,
    equippedHandBlueprintId: handItem?.blueprintId,
  };
}

function entityAtTile(
  scene: Scene,
  tx: number,
  ty: number,
): ActionContext['entityAtTarget'] {
  for (const [eid, e] of scene.entities) {
    if (!e.position || e.blueprint === undefined) continue;
    if (e.position.tileX !== tx || e.position.tileY !== ty) continue;
    if (eid === scene.myEntityId) continue;
    // Ground items (spawned by Drop) have only position + blueprint.
    // Placed entities (doors, chests, creatures) always carry statusEffects.
    const isGroundItem = !e.statusEffects;
    return { entityId: eid, blueprintId: e.blueprint.blueprintId, isGroundItem };
  }
  return undefined;
}

export function buildCursorContext(
  scene: Scene,
  tileX: number,
  tileY: number,
): ActionContext | null {
  if (!scene.worldMap.inBounds(tileX, tileY)) return null;

  const t = scene.worldMap.getTerrain(tileX, tileY) as Terrain;
  const b = scene.worldMap.getBuilding(tileX, tileY) as Building;
  const isWalkable =
    !(t === Terrain.Water || t === Terrain.Rock || t === Terrain.River)
    && (b === Building.None || b === Building.WoodenFloor || b === Building.StoneFloor);

  // Hand slot = 1 (matches the CLI convention); fishing rod on water
  // resolves to Harvest via the shared resolver.
  const handItem = scene.inventory.find(i => i.equippedSlot === 1);

  return {
    targetX: tileX,
    targetY: tileY,
    isWalkable,
    terrainType: t,
    entityAtTarget: entityAtTile(scene, tileX, tileY),
    equippedHandBlueprintId: handItem?.blueprintId,
  };
}
