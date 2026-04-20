import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { ActionType } from '@shared/actions.js';
import { Direction } from '@shared/direction.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { MAP_SIZE } from '@shared/constants.js';
import { Terrain } from '@shared/terrain.js';
import type { SystemState } from '../system-state.js';

const TREE_WOOD_AMOUNT = 5;
const TREE_RESPAWN_TICKS = 600;

export function initTreeResource(entityId: number, world: SystemState): void {
  world.treeResources.set(entityId, TREE_WOOD_AMOUNT);
}

export function getTreeResource(entityId: number, world: SystemState): number | undefined {
  return world.treeResources.get(entityId);
}

export function depleteTree(entityId: number, world: SystemState): number | undefined {
  const current = world.treeResources.get(entityId);
  if (current === undefined) return undefined;
  const remaining = current - 1;
  if (remaining <= 0) {
    world.treeResources.delete(entityId);
    world.respawnQueue.push({ tick: -1, blueprintType: BlueprintType.Tree });
  } else {
    world.treeResources.set(entityId, remaining);
  }
  return remaining;
}

function rand(world: SystemState): number {
  world.respawnRng = (world.respawnRng * 1664525 + 1013904223) >>> 0;
  return (world.respawnRng >>> 0) / 0x100000000;
}

export function runResourceRespawns(world: SystemState): void {
  // Set absolute tick for newly queued items
  for (const entry of world.respawnQueue) {
    if (entry.tick === -1) entry.tick = world.currentTick + TREE_RESPAWN_TICKS;
  }

  for (let i = world.respawnQueue.length - 1; i >= 0; i--) {
    const entry = world.respawnQueue[i];
    if (entry.tick > world.currentTick) continue;

    let placed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const rx = 1 + Math.floor(rand(world) * (MAP_SIZE - 2));
      const ry = 1 + Math.floor(rand(world) * (MAP_SIZE - 2));
      if (world.map.getTerrain(rx, ry) !== Terrain.Grass) continue;
      if (world.occupancy.isOccupied(rx, ry)) continue;

      const bp = getBlueprint(entry.blueprintType);
      if (!bp) break;

      const eid = world.entities.create();
      world.entities.position.set(eid, { tileX: rx, tileY: ry });
      world.entities.direction.set(eid, { dir: Direction.S });
      world.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
      world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
      if (bp.maxHp) world.entities.health.set(eid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
      const variantCount = bp.variantCount ?? 1;
      const variant = variantCount > 1 ? Math.floor(rand(world) * variantCount) : 0;
      world.entities.blueprint.set(eid, { blueprintId: entry.blueprintType, variant });
      world.entities.statusEffects.set(eid, { effects: 0 });
      world.occupancy.set(rx, ry, eid);

      if (entry.blueprintType === BlueprintType.Tree) {
        initTreeResource(eid, world);
      }

      placed = true;
      break;
    }

    world.respawnQueue.splice(i, 1);
  }
}
