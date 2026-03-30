import { BlueprintType } from '@shared/blueprints.js';
import { MAP_SIZE } from '@shared/constants.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { EntityManager } from '../ecs/entity-manager.js';
import type { OccupancyGrid } from '../occupancy.js';
import { setMoveTarget, hasMoveTarget } from './movement.js';

interface WanderConfig {
  radius: number;
  idleMin: number; // ticks
  idleMax: number;
}

const WANDER_CONFIGS: Partial<Record<number, WanderConfig>> = {
  [BlueprintType.Deer]:   { radius: 8,  idleMin: 40,  idleMax: 120 },
  [BlueprintType.Rabbit]: { radius: 6,  idleMin: 20,  idleMax: 60 },
  [BlueprintType.Fox]:    { radius: 10, idleMin: 60,  idleMax: 160 },
  [BlueprintType.Wolf]:   { radius: 12, idleMin: 80,  idleMax: 200 },
};

interface CritterState {
  idleTicksRemaining: number;
  rng: number; // LCG state
}

const critterStates = new Map<number, CritterState>();

export function resetCritterAI(): void {
  critterStates.clear();
}

function lcgNext(state: number): number {
  return (state * 1664525 + 1013904223) >>> 0;
}

function randRange(state: { rng: number }, min: number, max: number): number {
  state.rng = lcgNext(state.rng);
  return min + (state.rng % (max - min + 1));
}

export function initCritterAI(entities: EntityManager): void {
  for (const eid of entities.getAllEntities()) {
    const bp = entities.blueprintId.get(eid);
    if (!bp) continue;
    const config = WANDER_CONFIGS[bp.blueprintId];
    if (!config) continue;

    // Seed RNG from entity ID, stagger initial idle so they don't all move at once
    const state: CritterState = { idleTicksRemaining: 0, rng: eid * 2654435761 };
    state.idleTicksRemaining = randRange(state, 1, config.idleMax);
    critterStates.set(eid, state);
  }
}

export function runCritterAI(entities: EntityManager, map: WorldMap, occupancy: OccupancyGrid): void {
  for (const [eid, state] of critterStates) {
    // Skip if already walking
    if (hasMoveTarget(eid)) continue;

    // Skip if entity was destroyed
    if (!entities.exists(eid)) {
      critterStates.delete(eid);
      continue;
    }

    // Idle countdown
    if (state.idleTicksRemaining > 0) {
      state.idleTicksRemaining--;
      continue;
    }

    // Time to pick a new destination
    const pos = entities.position.get(eid);
    const bp = entities.blueprintId.get(eid);
    if (!pos || !bp) continue;

    const config = WANDER_CONFIGS[bp.blueprintId];
    if (!config) continue;

    // Try to find a walkable target
    let found = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const dx = randRange(state, -config.radius, config.radius);
      const dy = randRange(state, -config.radius, config.radius);
      const tx = pos.tileX + dx;
      const ty = pos.tileY + dy;

      if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) continue;
      if (!map.isWalkable(tx, ty)) continue;
      if (occupancy.isOccupied(tx, ty)) continue;
      if (tx === pos.tileX && ty === pos.tileY) continue;

      setMoveTarget(eid, tx, ty, entities, map, occupancy);
      found = true;
      break;
    }

    if (!found) {
      // All attempts failed — idle briefly and try again
      state.idleTicksRemaining = randRange(state, 10, 30);
    } else {
      // Will enter idle after movement completes (checked next tick when hasMoveTarget is false)
      state.idleTicksRemaining = randRange(state, config.idleMin, config.idleMax);
    }
  }
}
