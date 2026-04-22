import { ActionType } from '@shared/actions.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { getBlueprint } from '@shared/blueprints.js';
import { dirFromTo } from '@shared/direction.js';
import { ACTION_BASE_TICKS } from '@shared/constants.js';
import type { SystemState } from '../system-state.js';
import { setMoveTarget, hasMoveTarget, clearMoveTarget } from './movement.js';
import { Ok, Err, type ActionResult } from '../action-rejection.js';

function isAdjacent(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1 && !(ax === bx && ay === by);
}

export function startAttack(attackerId: number, targetId: number, world: SystemState): ActionResult {
  if (!world.entities.exists(targetId)) {
    return Err({ code: 'target_missing', targetEntityId: targetId });
  }
  const attackerPos = world.entities.position.get(attackerId);
  const targetPos = world.entities.position.get(targetId);
  if (!attackerPos || !targetPos) {
    return Err({ code: 'target_missing', targetEntityId: targetId });
  }

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
    const bp = world.entities.blueprint.get(attackerId);
    if (bp) {
      const bpDef = getBlueprint(bp.blueprintId);
      if (bpDef?.damage) damage = bpDef.damage;
      if (bpDef?.attackSpeed) attackSpeed = bpDef.attackSpeed;
    }
  }

  attackSpeed = Math.round(attackSpeed * ACTION_BASE_TICKS);

  if (damage <= 0 || attackSpeed <= 0) {
    return Err({ code: 'target_missing', targetEntityId: targetId });
  }

  clearMoveTarget(attackerId, world);

  // If not adjacent, validate that we can actually reach the target before
  // committing to combat state. setMoveTarget('near') routes to an adjacent
  // walkable tile; if it fails, the target is sealed off — no combat.
  if (!isAdjacent(attackerPos.tileX, attackerPos.tileY, targetPos.tileX, targetPos.tileY)) {
    const r = setMoveTarget(attackerId, targetPos.tileX, targetPos.tileY, world);
    if (!r.ok) return r;
  }

  world.combatStates.set(attackerId, {
    targetEntityId: targetId,
    ticksRemaining: 0, // ready to swing immediately if adjacent
    attackSpeed,
    damage,
  });

  world.entities.currentAction.set(attackerId, { actionType: ActionType.Attacking, targetEntity: targetId });

  const dir = dirFromTo(attackerPos.tileX, attackerPos.tileY, targetPos.tileX, targetPos.tileY);
  if (dir !== undefined) world.entities.direction.set(attackerId, { dir });

  return Ok;
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

export interface CombatHit {
  attackerEntityId: number;
  targetEntityId: number;
  damage: number;
  targetCurrentHp: number;
  targetMaxHp: number;
}

export interface CombatResult {
  deaths: DeathEvent[];
  hits: CombatHit[];
}

export function runCombat(world: SystemState): CombatResult {
  const deaths: DeathEvent[] = [];
  const hits: CombatHit[] = [];

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
      // Chase: re-pathfind to target if not already moving toward them.
      // If the target is now unreachable (closed door, walled in), give up.
      if (!hasMoveTarget(attackerId, world)) {
        const r = setMoveTarget(attackerId, targetPos.tileX, targetPos.tileY, world);
        if (!r.ok) {
          cancelCombat(attackerId, world);
        }
      }
      continue;
    }

    // Adjacent — swing timer
    if (state.ticksRemaining > 0) {
      state.ticksRemaining--;
      continue;
    }

    // Re-face target each swing so the swing animation lines up if the
    // target has moved around the attacker.
    const dirAtSwing = dirFromTo(attackerPos.tileX, attackerPos.tileY, targetPos.tileX, targetPos.tileY);
    if (dirAtSwing !== undefined) world.entities.direction.set(attackerId, { dir: dirAtSwing });

    // Deal damage
    const targetHealth = world.entities.health.get(state.targetEntityId);
    if (!targetHealth) {
      cancelCombat(attackerId, world);
      continue;
    }

    targetHealth.currentHp = Math.max(0, targetHealth.currentHp - state.damage);
    world.entities.health.set(state.targetEntityId, targetHealth);

    hits.push({
      attackerEntityId: attackerId,
      targetEntityId: state.targetEntityId,
      damage: state.damage,
      targetCurrentHp: targetHealth.currentHp,
      targetMaxHp: targetHealth.maxHp,
    });

    if (targetHealth.currentHp <= 0) {
      deaths.push({ entityId: state.targetEntityId, killerEntityId: attackerId });
      world.combatStates.delete(attackerId);
      world.entities.currentAction.set(attackerId, { actionType: ActionType.Idle });
    } else {
      state.ticksRemaining = state.attackSpeed;
    }
  }

  return { deaths, hits };
}
