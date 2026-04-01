import { ActionType } from '@shared/actions.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { getBlueprint } from '@shared/blueprints.js';
import type { SystemState } from '../system-state.js';
import { setMoveTarget, hasMoveTarget, clearMoveTarget } from './movement.js';

function isAdjacent(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1 && !(ax === bx && ay === by);
}

export function startAttack(attackerId: number, targetId: number, world: SystemState): boolean {
  if (!world.entities.exists(targetId)) return false;
  const attackerPos = world.entities.position.get(attackerId);
  const targetPos = world.entities.position.get(targetId);
  if (!attackerPos || !targetPos) return false;

  // Determine damage + speed from equipped weapon or fist
  let damage = 1;
  let attackSpeed = 2;

  const inv = world.inventoryMgr.get(attackerId);
  if (inv) {
    const handItem = inv.items.find(i => i.equippedSlot === 'hand');
    if (handItem) {
      const weaponBp = getBlueprint(handItem.blueprintId);
      if (weaponBp?.weaponDamage) damage = weaponBp.weaponDamage;
      if (weaponBp?.weaponSpeed) attackSpeed = weaponBp.weaponSpeed;
    }
  } else {
    // Critter attacking — use blueprint stats
    const bp = world.entities.blueprintId.get(attackerId);
    if (bp) {
      const bpDef = getBlueprint(bp.blueprintId);
      if (bpDef?.damage) damage = bpDef.damage;
      if (bpDef?.attackSpeed) attackSpeed = bpDef.attackSpeed;
    }
  }

  if (damage <= 0 || attackSpeed <= 0) return false;

  clearMoveTarget(attackerId, world);

  world.combatStates.set(attackerId, {
    targetEntityId: targetId,
    ticksRemaining: 0, // ready to swing immediately if adjacent
    attackSpeed,
    damage,
  });

  world.entities.currentAction.set(attackerId, { actionType: ActionType.Attacking, targetEntity: targetId });

  // If not adjacent, pathfind to target
  if (!isAdjacent(attackerPos.tileX, attackerPos.tileY, targetPos.tileX, targetPos.tileY)) {
    setMoveTarget(attackerId, targetPos.tileX, targetPos.tileY, world);
  }

  return true;
}

export function cancelCombat(entityId: number, world: SystemState): void {
  if (world.combatStates.has(entityId)) {
    world.combatStates.delete(entityId);
    world.entities.currentAction.set(entityId, { actionType: ActionType.Idle });
    world.entities.nextWaypoint.set(entityId, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  }
}

export function isInCombat(entityId: number, world: SystemState): boolean {
  return world.combatStates.has(entityId);
}

export interface DeathEvent {
  entityId: number;
  killerEntityId: number;
}

export function runCombat(world: SystemState): DeathEvent[] {
  const deaths: DeathEvent[] = [];

  for (const [attackerId, state] of world.combatStates) {
    const attackerPos = world.entities.position.get(attackerId);
    if (!attackerPos || !world.entities.exists(attackerId)) {
      world.combatStates.delete(attackerId);
      continue;
    }

    // Target gone?
    if (!world.entities.exists(state.targetEntityId)) {
      cancelCombat(attackerId, world);
      continue;
    }

    const targetPos = world.entities.position.get(state.targetEntityId);
    if (!targetPos) {
      cancelCombat(attackerId, world);
      continue;
    }

    const adjacent = isAdjacent(attackerPos.tileX, attackerPos.tileY, targetPos.tileX, targetPos.tileY);

    if (!adjacent) {
      // Chase: re-pathfind to target if not already moving toward them
      if (!hasMoveTarget(attackerId, world)) {
        setMoveTarget(attackerId, targetPos.tileX, targetPos.tileY, world);
      }
      continue;
    }

    // Adjacent — swing timer
    if (state.ticksRemaining > 0) {
      state.ticksRemaining--;
      continue;
    }

    // Deal damage
    const targetHealth = world.entities.health.get(state.targetEntityId);
    if (!targetHealth) {
      cancelCombat(attackerId, world);
      continue;
    }

    targetHealth.currentHp = Math.max(0, targetHealth.currentHp - state.damage);
    world.entities.health.set(state.targetEntityId, targetHealth);

    if (targetHealth.currentHp <= 0) {
      deaths.push({ entityId: state.targetEntityId, killerEntityId: attackerId });
      world.combatStates.delete(attackerId);
      world.entities.currentAction.set(attackerId, { actionType: ActionType.Idle });
    } else {
      state.ticksRemaining = state.attackSpeed;
    }
  }

  return deaths;
}
