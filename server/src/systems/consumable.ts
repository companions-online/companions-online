import type { SystemState } from '../system-state.js';
import { ActionType } from '@shared/actions.js';
import { getBlueprint } from '@shared/blueprints.js';
import { findItem } from '@shared/inventory.js';
import { Ok, Err, type ActionResult } from '../action-rejection.js';

export interface ConsumableState {
  itemId: number;
  blueprintId: number;
  healAmount: number;
}

export function startConsume(eid: number, itemId: number, world: SystemState): ActionResult {
  const inv = world.inventoryMgr.get(eid);
  if (!inv) return Err({ code: 'item_missing', itemId });
  const item = findItem(inv, itemId);
  if (!item) return Err({ code: 'item_missing', itemId });
  const bp = getBlueprint(item.blueprintId);
  if (!bp || !bp.consumeHeal || !bp.consumeTicks) {
    return Err({ code: 'not_consumable', itemId });
  }

  world.consumableStates.set(eid, {
    itemId,
    blueprintId: item.blueprintId,
    healAmount: bp.consumeHeal,
  });
  // Pre-commit (channel) cd: write consumeTicks-1 because the start tick
  // is already "tick 1 of the channel" — the runConsume gate won't see
  // the cd until the next top-of-tick decrement runs. Writing the full
  // consumeTicks would push the heal one tick past the configured budget.
  world.setCooldown(eid, Math.max(0, bp.consumeTicks - 1));
  world.entities.currentAction.set(eid, { actionType: ActionType.Consuming });
  return Ok;
}

export function cancelConsume(eid: number, world: SystemState): void {
  if (!world.consumableStates.has(eid)) return;
  world.consumableStates.delete(eid);
  // Consume's cooldown represents the in-flight channel, not a post-commit
  // residue, so cancelling drops it. Without this, cancelling a Bandage
  // (consumeTicks=10 = 500ms) would leave the player frozen for that long
  // before any next action could commit.
  world.clearCooldown(eid);
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
    if ((world.cooldowns.get(eid) ?? 0) === 0) {
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
