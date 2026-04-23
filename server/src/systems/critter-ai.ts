import { BlueprintType } from '@shared/blueprints.js';
import { MAP_SIZE } from '@shared/constants.js';
import { ActionType } from '@shared/actions.js';
import type { SystemState, CritterState } from '../system-state.js';
import { setMoveTarget, hasMoveTarget, clearMoveTarget } from './movement.js';
import { startAttack, isInCombat, cancelCombat } from './combat.js';

/** Ticks a critter waits before re-probing an unreachable aggro target.
 *  Without this, every wandering critter in aggroRange of a walled-in
 *  player would re-pathfind every tick. 20 ticks = 1s at TICK_RATE=20. */
const DEFAULT_AGGRO_PROBE_COOLDOWN = 20;

interface BehaviorConfig {
  wanderRadius: number;
  idleMin: number;
  idleMax: number;
  fleeRange?: number;    // flee when player within this range
  aggroRange?: number;   // aggro when player within this range
}

const BEHAVIOR_CONFIGS: Partial<Record<number, BehaviorConfig>> = {
  [BlueprintType.Deer]:     { wanderRadius: 8,  idleMin: 40,  idleMax: 120 },
  [BlueprintType.Rabbit]:   { wanderRadius: 6,  idleMin: 20,  idleMax: 60,  fleeRange: 3 },
  [BlueprintType.Fox]:      { wanderRadius: 10, idleMin: 60,  idleMax: 160, fleeRange: 5 },
  [BlueprintType.Wolf]:     { wanderRadius: 12, idleMin: 80,  idleMax: 200, aggroRange: 5 },
  [BlueprintType.Bear]:     { wanderRadius: 6,  idleMin: 80,  idleMax: 200, aggroRange: 4 },
  [BlueprintType.Skeleton]: { wanderRadius: 8,  idleMin: 60,  idleMax: 160, aggroRange: 8 },
  [BlueprintType.Wanderer]: { wanderRadius: 20, idleMin: 200, idleMax: 600 },
};

function lcgNext(state: number): number {
  return (state * 1664525 + 1013904223) >>> 0;
}

function randRange(state: { rng: number }, min: number, max: number): number {
  state.rng = lcgNext(state.rng);
  return min + (state.rng % (max - min + 1));
}

/** Initialize critter-AI state for a single entity. No-op if the entity has
 *  no blueprint or the blueprint has no BEHAVIOR_CONFIGS entry. */
export function initCritterForEntity(eid: number, world: SystemState): void {
  const bp = world.entities.blueprint.get(eid);
  if (!bp) return;
  const config = BEHAVIOR_CONFIGS[bp.blueprintId];
  if (!config) return;

  const state: CritterState = { idleTicksRemaining: 0, rng: eid * 2654435761, behavior: 'wander' };
  state.idleTicksRemaining = randRange(state, 1, config.idleMax);
  world.critterStates.set(eid, state);
}

export function initCritterAI(world: SystemState): void {
  for (const eid of world.entities.getAllEntities()) {
    initCritterForEntity(eid, world);
  }
}

export interface CritterBehaviorChange {
  type: 'aggro' | 'flee';
  creatureEntityId: number;
  targetPlayerEntityId: number;
}

/** Called when a critter takes damage — triggers flee or aggro response. */
export function notifyCritterAttacked(entityId: number, attackerEntityId: number, world: SystemState): CritterBehaviorChange | undefined {
  const state = world.critterStates.get(entityId);
  if (!state) return;
  const bp = world.entities.blueprint.get(entityId);
  if (!bp) return;
  const config = BEHAVIOR_CONFIGS[bp.blueprintId];
  if (!config) return;

  if (config.fleeRange) {
    const wasFleeing = state.behavior === 'flee' && state.targetEntityId === attackerEntityId;
    state.behavior = 'flee';
    state.targetEntityId = attackerEntityId;
    clearMoveTarget(entityId, world);
    return wasFleeing ? undefined : { type: 'flee', creatureEntityId: entityId, targetPlayerEntityId: attackerEntityId };
  } else if (config.aggroRange) {
    const wasAggro = state.behavior === 'aggro' && state.targetEntityId === attackerEntityId;
    // Try to commit combat first — if the attacker is unreachable, stay in
    // wander so we don't lock the critter into an aggro state it can never
    // execute. startAttack is side-effect-free on Err.
    if (isInCombat(entityId, world)) {
      state.behavior = 'aggro';
      state.targetEntityId = attackerEntityId;
      return wasAggro ? undefined : { type: 'aggro', creatureEntityId: entityId, targetPlayerEntityId: attackerEntityId };
    }
    const r = startAttack(entityId, attackerEntityId, world);
    if (r.ok) {
      state.behavior = 'aggro';
      state.targetEntityId = attackerEntityId;
      return wasAggro ? undefined : { type: 'aggro', creatureEntityId: entityId, targetPlayerEntityId: attackerEntityId };
    }
    // Unreachable — cooldown the next proactive probe so we don't pathfind
    // every tick through runCritterAI either.
    state.aggroProbeCooldown = DEFAULT_AGGRO_PROBE_COOLDOWN;
    return undefined;
  }
  // Deer: passive — no behavior change
  return undefined;
}

export function runCritterAI(world: SystemState): CritterBehaviorChange[] {
  const changes: CritterBehaviorChange[] = [];
  for (const [eid, state] of world.critterStates) {
    if (!world.entities.exists(eid)) {
      world.critterStates.delete(eid);
      continue;
    }

    const bp = world.entities.blueprint.get(eid);
    if (!bp) continue;
    const config = BEHAVIOR_CONFIGS[bp.blueprintId];
    if (!config) continue;

    const pos = world.entities.position.get(eid);
    if (!pos) continue;

    // Find nearest living player (skip Dead — their entity persists but they
    // aren't a valid aggression target).
    let nearestPlayerId: number | undefined;
    let nearestDist = Infinity;
    for (const [playerEid] of world.players) {
      const otherPos = world.entities.position.get(playerEid);
      if (!otherPos) continue;
      if (world.entities.currentAction.get(playerEid)?.actionType === ActionType.Dead) continue;
      const dist = Math.max(Math.abs(pos.tileX - otherPos.tileX), Math.abs(pos.tileY - otherPos.tileY));
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPlayerId = playerEid;
      }
    }

    // Aggro probe cooldown — decremented every tick the critter is in
    // wander, gates the reachability probe below.
    if (state.aggroProbeCooldown !== undefined && state.aggroProbeCooldown > 0) {
      state.aggroProbeCooldown--;
    }

    // Behavior decision (unless already reacting to being attacked)
    if (state.behavior === 'wander') {
      if (config.fleeRange && nearestPlayerId !== undefined && nearestDist <= config.fleeRange) {
        state.behavior = 'flee';
        state.targetEntityId = nearestPlayerId;
        clearMoveTarget(eid, world);
        changes.push({ type: 'flee', creatureEntityId: eid, targetPlayerEntityId: nearestPlayerId });
      } else if (config.aggroRange && nearestPlayerId !== undefined && nearestDist <= config.aggroRange) {
        // Only commit to aggro if we can actually reach the target. A player
        // standing inside a walled-off base would otherwise lock the critter
        // into perpetual failed chase attempts. startAttack is side-effect-
        // free on Err, so this probe is safe to run from wander.
        if ((state.aggroProbeCooldown ?? 0) === 0) {
          const r = startAttack(eid, nearestPlayerId, world);
          if (r.ok) {
            state.behavior = 'aggro';
            state.targetEntityId = nearestPlayerId;
            changes.push({ type: 'aggro', creatureEntityId: eid, targetPlayerEntityId: nearestPlayerId });
          } else {
            // Unreachable for now — cool off before re-probing so we don't
            // pathfind every tick for every wandering critter near the
            // player.
            state.aggroProbeCooldown = DEFAULT_AGGRO_PROBE_COOLDOWN;
          }
        }
      }
    }

    // If fleeing/aggro target is gone or out of range, return to wander
    if ((state.behavior === 'flee' || state.behavior === 'aggro') && state.targetEntityId !== undefined) {
      if (!world.entities.exists(state.targetEntityId)) {
        state.behavior = 'wander';
        state.targetEntityId = undefined;
        cancelCombat(eid, world);
      } else {
        const targetPos = world.entities.position.get(state.targetEntityId);
        if (targetPos) {
          const dist = Math.max(Math.abs(pos.tileX - targetPos.tileX), Math.abs(pos.tileY - targetPos.tileY));
          const range = config.fleeRange ?? config.aggroRange ?? 10;
          if (dist > range * 2) {
            // Lost interest — target too far
            state.behavior = 'wander';
            state.targetEntityId = undefined;
            cancelCombat(eid, world);
          }
        }
      }
    }

    // Execute behavior
    switch (state.behavior) {
      case 'flee':
        executeFlee(eid, state, world);
        break;
      case 'aggro':
        executeAggro(eid, state, world);
        break;
      case 'wander':
        executeWander(eid, state, config, world);
        break;
      // 'passive': do nothing
    }
  }
  return changes;
}

function executeFlee(eid: number, state: CritterState, world: SystemState): void {
  if (hasMoveTarget(eid, world)) return; // already running

  // Brief pause between flee segments to prevent super-speed appearance
  if (state.idleTicksRemaining > 0) {
    state.idleTicksRemaining--;
    return;
  }

  const pos = world.entities.position.get(eid);
  const targetPos = state.targetEntityId !== undefined ? world.entities.position.get(state.targetEntityId) : undefined;
  if (!pos || !targetPos) return;

  // Run in opposite direction from threat
  const dx = pos.tileX - targetPos.tileX;
  const dy = pos.tileY - targetPos.tileY;
  const dist = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
  const fleeX = Math.max(1, Math.min(MAP_SIZE - 2, pos.tileX + Math.round(dx / dist * 8)));
  const fleeY = Math.max(1, Math.min(MAP_SIZE - 2, pos.tileY + Math.round(dy / dist * 8)));

  let fled = false;
  if (world.map.isWalkable(fleeX, fleeY)) {
    setMoveTarget(eid, fleeX, fleeY, world);
    fled = true;
  } else {
    // Try random nearby tile
    const rx = Math.max(1, Math.min(MAP_SIZE - 2, pos.tileX + randRange(state, -6, 6)));
    const ry = Math.max(1, Math.min(MAP_SIZE - 2, pos.tileY + randRange(state, -6, 6)));
    if (world.map.isWalkable(rx, ry)) {
      setMoveTarget(eid, rx, ry, world);
      fled = true;
    }
  }

  // Pause before next flee decision (prevents non-stop sprinting)
  state.idleTicksRemaining = fled ? 10 : 5; // 0.5s after run, 0.25s after fail
}

function executeAggro(eid: number, state: CritterState, world: SystemState): void {
  if (state.targetEntityId === undefined) return;
  if (isInCombat(eid, world)) return;
  // Combat may have been cancelled by runCombat's chase-unreachable branch
  // (door closed behind target, etc.). Try to re-engage; if the target has
  // become unreachable, drop back to wander so the critter doesn't idle in
  // an aggro state it can never act on.
  const r = startAttack(eid, state.targetEntityId, world);
  if (!r.ok) {
    state.behavior = 'wander';
    state.targetEntityId = undefined;
    state.aggroProbeCooldown = DEFAULT_AGGRO_PROBE_COOLDOWN;
  }
}

function executeWander(eid: number, state: CritterState, config: BehaviorConfig, world: SystemState): void {
  if (hasMoveTarget(eid, world) || isInCombat(eid, world)) return;

  if (state.idleTicksRemaining > 0) {
    state.idleTicksRemaining--;
    return;
  }

  const pos = world.entities.position.get(eid);
  if (!pos) return;

  let found = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const dx = randRange(state, -config.wanderRadius, config.wanderRadius);
    const dy = randRange(state, -config.wanderRadius, config.wanderRadius);
    const tx = pos.tileX + dx;
    const ty = pos.tileY + dy;

    if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) continue;
    if (!world.map.isWalkable(tx, ty)) continue;
    if (world.occupancy.isOccupied(tx, ty)) continue;
    if (tx === pos.tileX && ty === pos.tileY) continue;

    setMoveTarget(eid, tx, ty, world);
    found = true;
    break;
  }

  state.idleTicksRemaining = found
    ? randRange(state, config.idleMin, config.idleMax)
    : randRange(state, 10, 30);
}
