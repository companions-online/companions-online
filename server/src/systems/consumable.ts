import type { SystemState } from '../system-state.js';
import { ActionType } from '@shared/actions.js';
import { getBlueprint } from '@shared/blueprints.js';
import { findItem } from '@shared/inventory.js';

export interface ConsumableState {
  itemId: number;
  blueprintId: number;
  ticksRemaining: number;
  healAmount: number;
}

export function startConsume(eid: number, itemId: number, world: SystemState): void {
  const inv = world.inventoryMgr.get(eid);
  if (!inv) return;
  const item = findItem(inv, itemId);
  if (!item) return;
  const bp = getBlueprint(item.blueprintId);
  if (!bp || !bp.consumeHeal || !bp.consumeTicks) return;

  world.consumableStates.set(eid, {
    itemId,
    blueprintId: item.blueprintId,
    ticksRemaining: bp.consumeTicks,
    healAmount: bp.consumeHeal,
  });
  world.entities.currentAction.set(eid, { actionType: ActionType.Consuming });
}

export function cancelConsume(eid: number, world: SystemState): void {
  if (!world.consumableStates.has(eid)) return;
  world.consumableStates.delete(eid);
  world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
}

export function isConsuming(eid: number, world: SystemState): boolean {
  return world.consumableStates.has(eid);
}

export interface ConsumeEvent {
  entityId: number;
  blueprintId: number;
  healAmount: number;
  currentHp: number;
  maxHp: number;
}

/** Returns consume events for entities that finished consuming (need inventory sync). */
export function runConsume(world: SystemState): ConsumeEvent[] {
  const finished: ConsumeEvent[] = [];
  for (const [eid, state] of world.consumableStates) {
    if (!world.entities.exists(eid)) {
      world.consumableStates.delete(eid);
      continue;
    }
    state.ticksRemaining--;
    if (state.ticksRemaining <= 0) {
      // Apply heal
      const health = world.entities.health.get(eid);
      let currentHp = 0;
      let maxHp = 100;
      if (health) {
        health.currentHp = Math.min(health.currentHp + state.healAmount, health.maxHp);
        world.entities.health.set(eid, health);
        currentHp = health.currentHp;
        maxHp = health.maxHp;
      }
      // Consume item
      world.inventoryMgr.removeItem(eid, state.itemId, 1);
      // Clear state
      world.consumableStates.delete(eid);
      world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
      finished.push({
        entityId: eid,
        blueprintId: state.blueprintId,
        healAmount: state.healAmount,
        currentHp,
        maxHp,
      });
    }
  }
  return finished;
}
