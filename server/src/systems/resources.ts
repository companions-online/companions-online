import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { ActionType } from '@shared/actions.js';
import { Direction } from '@shared/direction.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { MAP_SIZE } from '@shared/constants.js';
import { Terrain } from '@shared/terrain.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { EntityManager } from '../ecs/entity-manager.js';
import type { OccupancyGrid } from '../occupancy.js';

const TREE_WOOD_AMOUNT = 5;
const TREE_RESPAWN_TICKS = 600; // 30 seconds at 20Hz

// Tree resource pools: entityId → wood remaining
const treeResources = new Map<number, number>();

// Respawn queue
const respawnQueue: { tick: number; blueprintType: number }[] = [];

// Simple seeded RNG for respawn placement
let respawnRng = 12345;
function rand(): number {
  respawnRng = (respawnRng * 1664525 + 1013904223) >>> 0;
  return (respawnRng >>> 0) / 0x100000000;
}

export function initTreeResource(entityId: number): void {
  treeResources.set(entityId, TREE_WOOD_AMOUNT);
}

export function getTreeResource(entityId: number): number | undefined {
  return treeResources.get(entityId);
}

/** Decrement tree resource, return remaining. Returns undefined if not tracked. */
export function depleteTree(entityId: number): number | undefined {
  const current = treeResources.get(entityId);
  if (current === undefined) return undefined;
  const remaining = current - 1;
  if (remaining <= 0) {
    treeResources.delete(entityId);
    scheduleRespawn(BlueprintType.Tree);
  } else {
    treeResources.set(entityId, remaining);
  }
  return remaining;
}

function scheduleRespawn(blueprintType: number): void {
  // We don't know the current tick here, so store a relative delay
  // The tick will be set when runRespawns checks it
  respawnQueue.push({ tick: -1, blueprintType });
}

export function runRespawns(
  currentTick: number, entities: EntityManager, map: WorldMap, occupancy: OccupancyGrid,
): void {
  // Set absolute tick for newly queued items
  for (const entry of respawnQueue) {
    if (entry.tick === -1) entry.tick = currentTick + TREE_RESPAWN_TICKS;
  }

  // Process due respawns
  for (let i = respawnQueue.length - 1; i >= 0; i--) {
    const entry = respawnQueue[i];
    if (entry.tick > currentTick) continue;

    // Find a random walkable grass tile
    let placed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const rx = 1 + Math.floor(rand() * (MAP_SIZE - 2));
      const ry = 1 + Math.floor(rand() * (MAP_SIZE - 2));
      if (map.getTerrain(rx, ry) !== Terrain.Grass) continue;
      if (occupancy.isOccupied(rx, ry)) continue;

      const bp = getBlueprint(entry.blueprintType);
      if (!bp) break;

      const eid = entities.create();
      entities.position.set(eid, { tileX: rx, tileY: ry });
      entities.direction.set(eid, { dir: Direction.S });
      entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
      entities.currentAction.set(eid, { actionType: ActionType.Idle });
      if (bp.maxHp) entities.health.set(eid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
      entities.blueprintId.set(eid, { blueprintId: entry.blueprintType });
      entities.statusEffects.set(eid, { effects: 0 });
      occupancy.set(rx, ry, eid);

      if (entry.blueprintType === BlueprintType.Tree) {
        initTreeResource(eid);
      }

      placed = true;
      break;
    }

    respawnQueue.splice(i, 1);
  }
}

export function resetResources(): void {
  treeResources.clear();
  respawnQueue.length = 0;
}
