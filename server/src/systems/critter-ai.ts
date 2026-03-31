import { BlueprintType } from '@shared/blueprints.js';
import { MAP_SIZE } from '@shared/constants.js';
import type { SystemState, CritterState } from '../system-state.js';
import { setMoveTarget, hasMoveTarget } from './movement.js';

interface WanderConfig {
  radius: number;
  idleMin: number;
  idleMax: number;
}

const WANDER_CONFIGS: Partial<Record<number, WanderConfig>> = {
  [BlueprintType.Deer]:   { radius: 8,  idleMin: 40,  idleMax: 120 },
  [BlueprintType.Rabbit]: { radius: 6,  idleMin: 20,  idleMax: 60 },
  [BlueprintType.Fox]:    { radius: 10, idleMin: 60,  idleMax: 160 },
  [BlueprintType.Wolf]:   { radius: 12, idleMin: 80,  idleMax: 200 },
};

function lcgNext(state: number): number {
  return (state * 1664525 + 1013904223) >>> 0;
}

function randRange(state: { rng: number }, min: number, max: number): number {
  state.rng = lcgNext(state.rng);
  return min + (state.rng % (max - min + 1));
}

export function initCritterAI(world: SystemState): void {
  for (const eid of world.entities.getAllEntities()) {
    const bp = world.entities.blueprintId.get(eid);
    if (!bp) continue;
    const config = WANDER_CONFIGS[bp.blueprintId];
    if (!config) continue;

    const state: CritterState = { idleTicksRemaining: 0, rng: eid * 2654435761 };
    state.idleTicksRemaining = randRange(state, 1, config.idleMax);
    world.critterStates.set(eid, state);
  }
}

export function runCritterAI(world: SystemState): void {
  for (const [eid, state] of world.critterStates) {
    if (hasMoveTarget(eid, world)) continue;

    if (!world.entities.exists(eid)) {
      world.critterStates.delete(eid);
      continue;
    }

    if (state.idleTicksRemaining > 0) {
      state.idleTicksRemaining--;
      continue;
    }

    const pos = world.entities.position.get(eid);
    const bp = world.entities.blueprintId.get(eid);
    if (!pos || !bp) continue;

    const config = WANDER_CONFIGS[bp.blueprintId];
    if (!config) continue;

    let found = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const dx = randRange(state, -config.radius, config.radius);
      const dy = randRange(state, -config.radius, config.radius);
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

    if (!found) {
      state.idleTicksRemaining = randRange(state, 10, 30);
    } else {
      state.idleTicksRemaining = randRange(state, config.idleMin, config.idleMax);
    }
  }
}
