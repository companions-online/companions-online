import { BlueprintType } from '@shared/blueprints.js';
import { ActionType } from '@shared/actions.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { Terrain } from '@shared/terrain.js';
import { MAX_HARVEST_YIELDS } from '@shared/constants.js';
import type { SystemState, HarvestContext } from '../system-state.js';
import { setMoveTarget, hasMoveTarget, clearMoveTarget } from './movement.js';
import { depleteTree } from './resources.js';

function resolveHarvestContext(
  targetX: number, targetY: number, world: SystemState,
  equippedBpId: number | undefined,
): { context: HarvestContext; targetEntityId?: number } | null {
  const targetEid = world.occupancy.get(targetX, targetY);
  if (targetEid) {
    const bpData = world.entities.blueprint.get(targetEid);
    if (bpData) {
      if (bpData.blueprintId === BlueprintType.Tree) {
        const tickCost = equippedBpId === BlueprintType.Axe ? 4 : 10;
        return { context: { yieldBlueprintId: BlueprintType.Wood, tickCost }, targetEntityId: targetEid };
      }
    }
  }

  const t = world.map.getTerrain(targetX, targetY);

  if (t === Terrain.Rock) {
    if (equippedBpId === BlueprintType.Pickaxe) {
      return { context: { yieldBlueprintId: BlueprintType.Rock, tickCost: 4, bonusChance: 0.3, bonusBlueprintId: BlueprintType.Iron } };
    }
    if (equippedBpId === BlueprintType.Axe) {
      return { context: { yieldBlueprintId: BlueprintType.Rock, tickCost: 6 } };
    }
    return { context: { yieldBlueprintId: BlueprintType.Rock, tickCost: 10 } };
  }

  if ((t === Terrain.Water || t === Terrain.River) && equippedBpId === BlueprintType.FishingRod) {
    const tickCost = 8 + ((targetX * 7 + targetY * 13) % 13);
    return { context: { yieldBlueprintId: BlueprintType.RawFish, tickCost } };
  }

  return null;
}

function isAdjacent(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1 && !(ax === bx && ay === by);
}

export function startHarvest(eid: number, tileX: number, tileY: number, world: SystemState): boolean {
  const inv = world.inventoryMgr.get(eid);
  const handItem = inv?.items.find(i => i.equippedSlot === 'hand');
  const equippedBpId = handItem?.blueprintId;

  const result = resolveHarvestContext(tileX, tileY, world, equippedBpId);
  if (!result) return false;

  clearMoveTarget(eid, world);

  const pos = world.entities.position.get(eid);
  if (!pos) return false;

  const adjacent = isAdjacent(pos.tileX, pos.tileY, tileX, tileY);

  world.harvestStates.set(eid, {
    targetX: tileX,
    targetY: tileY,
    targetEntityId: result.targetEntityId,
    ticksRemaining: result.context.tickCost,
    context: result.context,
    pathfinding: !adjacent,
    rng: (eid * 2654435761 + tileX * 7 + tileY) >>> 0,
    yieldsSoFar: 0,
  });

  if (!adjacent) {
    const candidates: { ax: number; ay: number; dist: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ax = tileX + dx;
        const ay = tileY + dy;
        if (world.map.isWalkable(ax, ay) && !world.occupancy.isOccupied(ax, ay)) {
          const dist = Math.abs(ax - pos.tileX) + Math.abs(ay - pos.tileY);
          candidates.push({ ax, ay, dist });
        }
      }
    }
    candidates.sort((a, b) => a.dist - b.dist);
    if (candidates.length > 0) {
      setMoveTarget(eid, candidates[0].ax, candidates[0].ay, world);
      return true;
    }
    world.harvestStates.delete(eid);
    return false;
  }

  world.entities.currentAction.set(eid, { actionType: ActionType.Harvesting });
  return true;
}

export function cancelHarvest(eid: number, world: SystemState): void {
  if (world.harvestStates.has(eid)) {
    world.harvestStates.delete(eid);
    world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
    world.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  }
}

export function isHarvesting(eid: number, world: SystemState): boolean {
  return world.harvestStates.has(eid);
}

export interface HarvestEvent {
  entityId: number;
  yieldBlueprintId: number;
  targetEntityId?: number;
  remaining?: number;
  depleted: boolean;
  bonusBlueprintId?: number;
}

/** Returns harvest events for this tick (need InventorySync for each entityId). */
export function runHarvest(world: SystemState): HarvestEvent[] {
  const events: HarvestEvent[] = [];

  for (const [eid, state] of world.harvestStates) {
    const pos = world.entities.position.get(eid);
    if (!pos || !world.entities.exists(eid)) {
      world.harvestStates.delete(eid);
      continue;
    }

    if (state.pathfinding) {
      if (hasMoveTarget(eid, world)) continue;
      if (isAdjacent(pos.tileX, pos.tileY, state.targetX, state.targetY)) {
        state.pathfinding = false;
        state.ticksRemaining = state.context.tickCost;
        world.entities.currentAction.set(eid, { actionType: ActionType.Harvesting });
      } else {
        world.harvestStates.delete(eid);
        world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
      }
      continue;
    }

    state.ticksRemaining--;
    if (state.ticksRemaining > 0) continue;

    const added = world.inventoryMgr.addItem(eid, state.context.yieldBlueprintId, 1);
    if (!added.success) {
      cancelHarvest(eid, world);
      continue;
    }

    let bonusBlueprintId: number | undefined;
    if (state.context.bonusChance && state.context.bonusBlueprintId) {
      state.rng = (state.rng * 1664525 + 1013904223) >>> 0;
      if ((state.rng >>> 0) / 0x100000000 < state.context.bonusChance) {
        world.inventoryMgr.addItem(eid, state.context.bonusBlueprintId, 1);
        bonusBlueprintId = state.context.bonusBlueprintId;
      }
    }

    let depleted = false;
    let remaining: number | undefined;
    if (state.targetEntityId !== undefined) {
      remaining = depleteTree(state.targetEntityId, world);
      if (remaining !== undefined && remaining <= 0) {
        depleted = true;
        const tpos = world.entities.position.get(state.targetEntityId);
        if (tpos) world.occupancy.clear(tpos.tileX, tpos.tileY);
        world.entities.destroy(state.targetEntityId);
      }
    }

    events.push({
      entityId: eid,
      yieldBlueprintId: state.context.yieldBlueprintId,
      targetEntityId: state.targetEntityId,
      remaining: remaining,
      depleted,
      bonusBlueprintId,
    });

    if (depleted) {
      cancelHarvest(eid, world);
      continue;
    }

    state.yieldsSoFar++;
    if (state.yieldsSoFar >= MAX_HARVEST_YIELDS) {
      cancelHarvest(eid, world);
      continue;
    }

    state.ticksRemaining = state.context.tickCost;
  }

  return events;
}
