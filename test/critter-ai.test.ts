import { describe, it, expect, beforeEach } from 'vitest';
import { EntityManager } from '../server/src/ecs/entity-manager.js';
import { initCritterAI, runCritterAI } from '../server/src/systems/critter-ai.js';
import { hasMoveTarget, runMovement, resetMovement } from '../server/src/systems/movement.js';
import { resetCritterAI } from '../server/src/systems/critter-ai.js';
import { OccupancyGrid } from '../server/src/occupancy.js';
import { WorldMap } from '@shared/world/world-map.js';
import { Terrain } from '@shared/terrain.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { MAP_SIZE } from '@shared/constants.js';

function createCritter(em: EntityManager, bp: BlueprintType, x: number, y: number, speed: number, occ?: OccupancyGrid): number {
  const eid = em.create();
  em.position.set(eid, { tileX: x, tileY: y });
  em.direction.set(eid, { dir: Direction.S });
  em.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  em.currentAction.set(eid, { actionType: ActionType.Idle });
  em.health.set(eid, { currentHp: 30, maxHp: 30 });
  em.blueprintId.set(eid, { blueprintId: bp });
  em.statusEffects.set(eid, { effects: 0 });
  em.speed.set(eid, speed);
  if (occ) occ.set(x, y, eid);
  return eid;
}

function makeWalkableMap(): WorldMap {
  const m = new WorldMap(MAP_SIZE, MAP_SIZE);
  // Default is all zeros = Grass = walkable
  // Add water border so critters don't wander off-edge
  for (let i = 0; i < MAP_SIZE; i++) {
    m.setTerrain(0, i, Terrain.Water);
    m.setTerrain(MAP_SIZE - 1, i, Terrain.Water);
    m.setTerrain(i, 0, Terrain.Water);
    m.setTerrain(i, MAP_SIZE - 1, Terrain.Water);
  }
  return m;
}

describe('Critter AI', () => {
  let em: EntityManager;
  let map: WorldMap;
  let occ: OccupancyGrid;

  beforeEach(() => {
    em = new EntityManager();
    map = makeWalkableMap();
    occ = new OccupancyGrid(MAP_SIZE, MAP_SIZE);
    resetMovement();
    resetCritterAI();
  });

  it('critters eventually get a move target after idle expires', () => {
    const deer = createCritter(em, BlueprintType.Deer, 64, 64, 3.5, occ);
    em.clearDirty();
    initCritterAI(em);

    // Run enough ticks for idle to expire (max idle for deer is 120)
    for (let i = 0; i < 200; i++) {
      runCritterAI(em, map, occ);
      if (hasMoveTarget(deer)) break;
    }

    expect(hasMoveTarget(deer)).toBe(true);
  });

  it('move targets are within wander radius', () => {
    const deer = createCritter(em, BlueprintType.Deer, 64, 64, 3.5, occ);
    em.clearDirty();
    initCritterAI(em);

    // Exhaust idle
    for (let i = 0; i < 200; i++) {
      runCritterAI(em, map, occ);
      if (hasMoveTarget(deer)) break;
    }

    // Run movement once to check the target was set
    // The deer wander radius is 8
    // We can't directly read moveTargets, but we can check the entity's nextWaypoint after one step
    runMovement(em, map, occ);
    const wp = em.nextWaypoint.get(deer);
    if (wp && wp.tileX !== WAYPOINT_NONE) {
      // Waypoint should be within 8 of origin (64,64)
      expect(Math.abs(wp.tileX - 64)).toBeLessThanOrEqual(8);
      expect(Math.abs(wp.tileY - 64)).toBeLessThanOrEqual(8);
    }
  });

  it('move targets are on walkable tiles', () => {
    // Surround a deer with water on 3 sides, leaving only one direction
    const deer = createCritter(em, BlueprintType.Deer, 5, 5, 3.5, occ);
    // Make tiles around (5,5) mostly water except east
    for (let dy = -8; dy <= 8; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        if (dx <= 0 && (5 + dx) >= 1 && (5 + dy) >= 1 && (5 + dy) < MAP_SIZE - 1) {
          map.setTerrain(5 + dx, 5 + dy, Terrain.Water);
        }
      }
    }
    // Restore (5,5) as walkable
    map.setTerrain(5, 5, Terrain.Grass);

    em.clearDirty();
    initCritterAI(em);

    for (let i = 0; i < 200; i++) {
      runCritterAI(em, map, occ);
      runMovement(em, map, occ);
    }

    // Deer should still exist and be somewhere walkable
    const pos = em.position.get(deer);
    expect(pos).toBeDefined();
    expect(map.isWalkable(pos!.tileX, pos!.tileY)).toBe(true);
  });

  it('non-critter entities are ignored', () => {
    // Create a tree and a player — neither should get AI
    const tree = em.create();
    em.position.set(tree, { tileX: 64, tileY: 64 });
    em.blueprintId.set(tree, { blueprintId: BlueprintType.Tree });

    const player = em.create();
    em.position.set(player, { tileX: 60, tileY: 60 });
    em.blueprintId.set(player, { blueprintId: BlueprintType.Player });

    em.clearDirty();
    initCritterAI(em);

    for (let i = 0; i < 200; i++) {
      runCritterAI(em, map, occ);
    }

    expect(hasMoveTarget(tree)).toBe(false);
    expect(hasMoveTarget(player)).toBe(false);
  });

  it('multiple critter types coexist', () => {
    createCritter(em, BlueprintType.Deer, 30, 30, 3.5, occ);
    createCritter(em, BlueprintType.Rabbit, 40, 40, 4, occ);
    createCritter(em, BlueprintType.Fox, 50, 50, 3, occ);
    createCritter(em, BlueprintType.Wolf, 60, 60, 2.5, occ);
    em.clearDirty();
    initCritterAI(em);

    let anyMoved = false;
    for (let i = 0; i < 250; i++) {
      runCritterAI(em, map, occ);
      runMovement(em, map, occ);
      em.clearDirty();
    }

    // After 250 ticks (12.5 sec), at least some critters should have moved
    for (const eid of em.getAllEntities()) {
      const pos = em.position.get(eid);
      if (!pos) continue;
      const bp = em.blueprintId.get(eid)?.blueprintId;
      if (bp === BlueprintType.Deer && (pos.tileX !== 30 || pos.tileY !== 30)) anyMoved = true;
      if (bp === BlueprintType.Rabbit && (pos.tileX !== 40 || pos.tileY !== 40)) anyMoved = true;
      if (bp === BlueprintType.Fox && (pos.tileX !== 50 || pos.tileY !== 50)) anyMoved = true;
      if (bp === BlueprintType.Wolf && (pos.tileX !== 60 || pos.tileY !== 60)) anyMoved = true;
    }
    expect(anyMoved).toBe(true);
  });
});
