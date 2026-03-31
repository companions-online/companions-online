import { describe, it, expect, beforeEach } from 'vitest';
import { EntityManager } from '../server/src/ecs/entity-manager.js';
import { initCritterAI, runCritterAI } from '../server/src/systems/critter-ai.js';
import { hasMoveTarget, runMovement } from '../server/src/systems/movement.js';
import { OccupancyGrid } from '../server/src/occupancy.js';
import { InventoryManager } from '../server/src/inventory-manager.js';
import { WorldMap } from '@shared/world/world-map.js';
import { Terrain } from '@shared/terrain.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { MAP_SIZE } from '@shared/constants.js';
import type { SystemState } from '../server/src/system-state.js';

function makeWorld(): SystemState {
  const map = new WorldMap(MAP_SIZE, MAP_SIZE);
  for (let i = 0; i < MAP_SIZE; i++) {
    map.setTerrain(0, i, Terrain.Water);
    map.setTerrain(MAP_SIZE - 1, i, Terrain.Water);
    map.setTerrain(i, 0, Terrain.Water);
    map.setTerrain(i, MAP_SIZE - 1, Terrain.Water);
  }
  return {
    map,
    entities: new EntityManager(),
    occupancy: new OccupancyGrid(MAP_SIZE, MAP_SIZE),
    inventoryMgr: new InventoryManager(),
    moveStates: new Map(),
    harvestStates: new Map(),
    critterStates: new Map(),
    treeResources: new Map(),
    respawnQueue: [],
    respawnRng: 0,
    currentTick: 0,
  };
}

function createCritter(w: SystemState, bp: BlueprintType, x: number, y: number, speed: number): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.direction.set(eid, { dir: Direction.S });
  w.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  w.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  w.entities.health.set(eid, { currentHp: 30, maxHp: 30 });
  w.entities.blueprintId.set(eid, { blueprintId: bp });
  w.entities.statusEffects.set(eid, { effects: 0 });
  w.entities.speed.set(eid, speed);
  w.occupancy.set(x, y, eid);
  return eid;
}

describe('Critter AI', () => {
  let w: SystemState;

  beforeEach(() => {
    w = makeWorld();
  });

  it('critters eventually get a move target after idle expires', () => {
    const deer = createCritter(w, BlueprintType.Deer, 64, 64, 3.5);
    w.entities.clearDirty();
    initCritterAI(w);

    for (let i = 0; i < 200; i++) {
      runCritterAI(w);
      if (hasMoveTarget(deer, w)) break;
    }

    expect(hasMoveTarget(deer, w)).toBe(true);
  });

  it('move targets are within wander radius', () => {
    const deer = createCritter(w, BlueprintType.Deer, 64, 64, 3.5);
    w.entities.clearDirty();
    initCritterAI(w);

    for (let i = 0; i < 200; i++) {
      runCritterAI(w);
      if (hasMoveTarget(deer, w)) break;
    }

    runMovement(w);
    const wp = w.entities.nextWaypoint.get(deer);
    if (wp && wp.tileX !== WAYPOINT_NONE) {
      expect(Math.abs(wp.tileX - 64)).toBeLessThanOrEqual(8);
      expect(Math.abs(wp.tileY - 64)).toBeLessThanOrEqual(8);
    }
  });

  it('move targets are on walkable tiles', () => {
    const deer = createCritter(w, BlueprintType.Deer, 5, 5, 3.5);
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        if (dx <= 0 && (5 + dx) >= 1 && (5 + dy) >= 1 && (5 + dy) < MAP_SIZE - 1) {
          w.map.setTerrain(5 + dx, 5 + dy, Terrain.Water);
        }
      }
    }
    w.map.setTerrain(5, 5, Terrain.Grass);

    w.entities.clearDirty();
    initCritterAI(w);

    for (let i = 0; i < 200; i++) {
      runCritterAI(w);
      runMovement(w);
    }

    const pos = w.entities.position.get(deer);
    expect(pos).toBeDefined();
    expect(w.map.isWalkable(pos!.tileX, pos!.tileY)).toBe(true);
  });

  it('non-critter entities are ignored', () => {
    const tree = w.entities.create();
    w.entities.position.set(tree, { tileX: 64, tileY: 64 });
    w.entities.blueprintId.set(tree, { blueprintId: BlueprintType.Tree });

    const player = w.entities.create();
    w.entities.position.set(player, { tileX: 60, tileY: 60 });
    w.entities.blueprintId.set(player, { blueprintId: BlueprintType.Player });

    w.entities.clearDirty();
    initCritterAI(w);

    for (let i = 0; i < 200; i++) {
      runCritterAI(w);
    }

    expect(hasMoveTarget(tree, w)).toBe(false);
    expect(hasMoveTarget(player, w)).toBe(false);
  });

  it('multiple critter types coexist', () => {
    createCritter(w, BlueprintType.Deer, 30, 30, 3.5);
    createCritter(w, BlueprintType.Rabbit, 40, 40, 4);
    createCritter(w, BlueprintType.Fox, 50, 50, 3);
    createCritter(w, BlueprintType.Wolf, 60, 60, 2.5);
    w.entities.clearDirty();
    initCritterAI(w);

    for (let i = 0; i < 250; i++) {
      runCritterAI(w);
      runMovement(w);
      w.entities.clearDirty();
    }

    let anyMoved = false;
    for (const eid of w.entities.getAllEntities()) {
      const pos = w.entities.position.get(eid);
      if (!pos) continue;
      const bp = w.entities.blueprintId.get(eid)?.blueprintId;
      if (bp === BlueprintType.Deer && (pos.tileX !== 30 || pos.tileY !== 30)) anyMoved = true;
      if (bp === BlueprintType.Rabbit && (pos.tileX !== 40 || pos.tileY !== 40)) anyMoved = true;
      if (bp === BlueprintType.Fox && (pos.tileX !== 50 || pos.tileY !== 50)) anyMoved = true;
      if (bp === BlueprintType.Wolf && (pos.tileX !== 60 || pos.tileY !== 60)) anyMoved = true;
    }
    expect(anyMoved).toBe(true);
  });
});
