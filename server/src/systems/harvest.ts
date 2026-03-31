import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { ActionType } from '@shared/actions.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { Terrain } from '@shared/terrain.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { EntityManager } from '../ecs/entity-manager.js';
import type { OccupancyGrid } from '../occupancy.js';
import type { InventoryManager } from '../inventory-manager.js';
import { setMoveTarget, hasMoveTarget, clearMoveTarget } from './movement.js';
import { getTreeResource, depleteTree } from './resources.js';

interface HarvestContext {
  yieldBlueprintId: number;
  tickCost: number;
  bonusChance?: number;
  bonusBlueprintId?: number;
}

interface HarvestState {
  targetX: number;
  targetY: number;
  targetEntityId?: number;
  ticksRemaining: number;
  context: HarvestContext;
  pathfinding: boolean;
  rng: number;
}

const harvestStates = new Map<number, HarvestState>();

function resolveHarvestContext(
  targetX: number, targetY: number,
  entities: EntityManager, occupancy: OccupancyGrid, map: WorldMap,
  equippedBpId: number | undefined,
): { context: HarvestContext; targetEntityId?: number } | null {
  // Check for entity at target (tree or hillrock)
  const targetEid = occupancy.get(targetX, targetY);
  if (targetEid) {
    const bpData = entities.blueprintId.get(targetEid);
    if (bpData) {
      if (bpData.blueprintId === BlueprintType.Tree) {
        const tickCost = equippedBpId === BlueprintType.Axe ? 4 : 10;
        return { context: { yieldBlueprintId: BlueprintType.Wood, tickCost }, targetEntityId: targetEid };
      }
      if (bpData.blueprintId === BlueprintType.HillRock) {
        if (equippedBpId === BlueprintType.Pickaxe) {
          return { context: { yieldBlueprintId: BlueprintType.Rock, tickCost: 4, bonusChance: 0.3, bonusBlueprintId: BlueprintType.Iron } };
        }
        if (equippedBpId === BlueprintType.Axe) {
          return { context: { yieldBlueprintId: BlueprintType.Rock, tickCost: 6 } };
        }
        return { context: { yieldBlueprintId: BlueprintType.Rock, tickCost: 10 } };
      }
    }
  }

  // Check terrain-based resources (no entity needed)
  const t = map.getTerrain(targetX, targetY);

  // Rock terrain = mineable hill (infinite resource)
  if (t === Terrain.Rock) {
    if (equippedBpId === BlueprintType.Pickaxe) {
      return { context: { yieldBlueprintId: BlueprintType.Rock, tickCost: 4, bonusChance: 0.3, bonusBlueprintId: BlueprintType.Iron } };
    }
    if (equippedBpId === BlueprintType.Axe) {
      return { context: { yieldBlueprintId: BlueprintType.Rock, tickCost: 6 } };
    }
    return { context: { yieldBlueprintId: BlueprintType.Rock, tickCost: 10 } };
  }

  // Water tile = fishing
  if ((t === Terrain.Water || t === Terrain.River) && equippedBpId === BlueprintType.FishingRod) {
    // Random 8-20 ticks, seeded from position
    const tickCost = 8 + ((targetX * 7 + targetY * 13) % 13);
    return { context: { yieldBlueprintId: BlueprintType.RawFish, tickCost } };
  }

  return null;
}

function isAdjacent(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1 && !(ax === bx && ay === by);
}

export function startHarvest(
  eid: number, tileX: number, tileY: number,
  entities: EntityManager, map: WorldMap, occupancy: OccupancyGrid, inventoryMgr: InventoryManager,
): boolean {
  // Get equipped hand item
  const inv = inventoryMgr.get(eid);
  const handItem = inv?.items.find(i => i.equippedSlot === 'hand');
  const equippedBpId = handItem?.blueprintId;

  const result = resolveHarvestContext(tileX, tileY, entities, occupancy, map, equippedBpId);
  if (!result) return false;

  // Cancel existing movement/harvest
  clearMoveTarget(eid);

  const pos = entities.position.get(eid);
  if (!pos) return false;

  const adjacent = isAdjacent(pos.tileX, pos.tileY, tileX, tileY);

  const state: HarvestState = {
    targetX: tileX,
    targetY: tileY,
    targetEntityId: result.targetEntityId,
    ticksRemaining: result.context.tickCost,
    context: result.context,
    pathfinding: !adjacent,
    rng: (eid * 2654435761 + tileX * 7 + tileY) >>> 0,
  };

  harvestStates.set(eid, state);

  if (!adjacent) {
    // Find the closest walkable adjacent tile to the player
    const candidates: { ax: number; ay: number; dist: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ax = tileX + dx;
        const ay = tileY + dy;
        if (map.isWalkable(ax, ay) && !occupancy.isOccupied(ax, ay)) {
          const dist = Math.abs(ax - pos.tileX) + Math.abs(ay - pos.tileY);
          candidates.push({ ax, ay, dist });
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    if (candidates.length > 0) {
      setMoveTarget(eid, candidates[0].ax, candidates[0].ay, entities, map, occupancy);
      return true;
    }
    // No adjacent tile available
    harvestStates.delete(eid);
    return false;
  }

  // Already adjacent — start channeling
  entities.currentAction.set(eid, { actionType: ActionType.Harvesting });
  return true;
}

export function cancelHarvest(eid: number, entities: EntityManager): void {
  if (harvestStates.has(eid)) {
    harvestStates.delete(eid);
    entities.currentAction.set(eid, { actionType: ActionType.Idle });
    entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  }
}

export function isHarvesting(eid: number): boolean {
  return harvestStates.has(eid);
}

export function resetHarvest(): void {
  harvestStates.clear();
}

/** Returns entity IDs that yielded this tick (need InventorySync). */
export function runHarvest(
  entities: EntityManager, map: WorldMap, occupancy: OccupancyGrid, inventoryMgr: InventoryManager,
): number[] {
  const yielded: number[] = [];

  for (const [eid, state] of harvestStates) {
    const pos = entities.position.get(eid);
    if (!pos || !entities.exists(eid)) {
      harvestStates.delete(eid);
      continue;
    }

    // Still pathfinding to adjacent tile?
    if (state.pathfinding) {
      if (hasMoveTarget(eid)) continue; // still walking
      // Arrived — check adjacency
      if (isAdjacent(pos.tileX, pos.tileY, state.targetX, state.targetY)) {
        state.pathfinding = false;
        state.ticksRemaining = state.context.tickCost;
        entities.currentAction.set(eid, { actionType: ActionType.Harvesting });
      } else {
        // Failed to reach adjacent
        harvestStates.delete(eid);
        entities.currentAction.set(eid, { actionType: ActionType.Idle });
      }
      continue;
    }

    // Channeling
    state.ticksRemaining--;
    if (state.ticksRemaining > 0) continue;

    // Yield!
    const added = inventoryMgr.addItem(eid, state.context.yieldBlueprintId, 1);
    if (!added.success) {
      // Inventory full — cancel
      cancelHarvest(eid, entities);
      continue;
    }
    yielded.push(eid);

    // Bonus roll
    if (state.context.bonusChance && state.context.bonusBlueprintId) {
      state.rng = (state.rng * 1664525 + 1013904223) >>> 0;
      if ((state.rng >>> 0) / 0x100000000 < state.context.bonusChance) {
        inventoryMgr.addItem(eid, state.context.bonusBlueprintId, 1);
      }
    }

    // Tree depletion
    if (state.targetEntityId !== undefined) {
      const remaining = depleteTree(state.targetEntityId);
      if (remaining !== undefined && remaining <= 0) {
        // Tree exhausted
        const tpos = entities.position.get(state.targetEntityId);
        if (tpos) occupancy.clear(tpos.tileX, tpos.tileY);
        entities.destroy(state.targetEntityId);
        cancelHarvest(eid, entities);
        continue;
      }
    }

    // Restart cycle
    state.ticksRemaining = state.context.tickCost;
  }

  return yielded;
}
