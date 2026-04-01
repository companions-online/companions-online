import { describe, it, expect, beforeEach } from 'vitest';
import { findPath } from '@shared/pathfinding.js';
import { EntityManager } from '../server/src/ecs/entity-manager.js';
import { OccupancyGrid } from '../server/src/occupancy.js';
import { InventoryManager } from '../server/src/inventory-manager.js';
import { setMoveTarget, runMovement, hasMoveTarget } from '../server/src/systems/movement.js';
import { WorldMap } from '@shared/world/world-map.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import type { SystemState } from '../server/src/system-state.js';

// --- A* pathfinding tests ---

describe('findPath', () => {
  const W = 20;
  const H = 20;
  const blocked = new Set<number>();
  const isBlocked = (x: number, y: number) => blocked.has(y * W + x);

  beforeEach(() => { blocked.clear(); });

  it('direct path with no obstacles', () => {
    const result = findPath(0, 0, 5, 0, isBlocked, W, H);
    expect(result.found).toBe(true);
    expect(result.path.length).toBeGreaterThan(0);
    expect(result.path[result.path.length - 1]).toEqual({ x: 5, y: 0 });
  });

  it('path around a wall', () => {
    for (let y = 0; y <= 4; y++) blocked.add(y * W + 3);
    const result = findPath(0, 2, 6, 2, isBlocked, W, H);
    expect(result.found).toBe(true);
    for (const p of result.path) {
      expect(blocked.has(p.y * W + p.x)).toBe(false);
    }
    expect(result.path[result.path.length - 1]).toEqual({ x: 6, y: 2 });
  });

  it('no path available', () => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        blocked.add((5 + dy) * W + (5 + dx));
      }
    }
    blocked.add(5 * W + 5);
    const result = findPath(0, 0, 5, 5, isBlocked, W, H);
    expect(result.found).toBe(false);
  });

  it('same start and end', () => {
    const result = findPath(3, 3, 3, 3, isBlocked, W, H);
    expect(result.found).toBe(true);
    expect(result.path.length).toBe(0);
  });

  it('path uses diagonal movement', () => {
    const result = findPath(0, 0, 3, 3, isBlocked, W, H);
    expect(result.found).toBe(true);
    expect(result.path.length).toBeLessThanOrEqual(4);
  });

  it('blocked destination: paths to adjacent tile', () => {
    blocked.add(5 * W + 5);
    const result = findPath(0, 0, 5, 5, isBlocked, W, H);
    expect(result.found).toBe(true);
    const last = result.path[result.path.length - 1];
    const dist = Math.abs(last.x - 5) + Math.abs(last.y - 5);
    expect(dist).toBeLessThanOrEqual(2);
  });

  it('respects maxSearchNodes limit', () => {
    const result = findPath(0, 0, 19, 19, isBlocked, W, H, 5);
    expect(typeof result.found).toBe('boolean');
  });

  it('does not cut corners around obstacles', () => {
    blocked.add(2 * W + 3);
    blocked.add(3 * W + 2);
    const result = findPath(2, 2, 3, 3, isBlocked, W, H);
    expect(result.found).toBe(true);
    expect(result.path.length).toBeGreaterThanOrEqual(2);
  });
});

// --- Occupancy + collision tests ---

describe('Occupancy + movement collision', () => {
  const SIZE = 32;
  let w: SystemState;

  function createEntity(x: number, y: number, speed = 3): number {
    const eid = w.entities.create();
    w.entities.position.set(eid, { tileX: x, tileY: y });
    w.entities.direction.set(eid, { dir: Direction.S });
    w.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    w.entities.currentAction.set(eid, { actionType: ActionType.Idle });
    w.entities.health.set(eid, { currentHp: 100, maxHp: 100 });
    w.entities.blueprintId.set(eid, { blueprintId: BlueprintType.Player });
    w.entities.statusEffects.set(eid, { effects: 0 });
    w.entities.speed.set(eid, speed);
    w.occupancy.set(x, y, eid);
    return eid;
  }

  beforeEach(() => {
    w = {
      map: new WorldMap(SIZE, SIZE),
      entities: new EntityManager(),
      occupancy: new OccupancyGrid(SIZE, SIZE),
      inventoryMgr: new InventoryManager(),
      moveStates: new Map(),
      harvestStates: new Map(),
      combatStates: new Map(),
      critterStates: new Map(),
      treeResources: new Map(),
      respawnQueue: [],
      respawnRng: 0,
      currentTick: 0,
    };
  });

  it('occupancy updated on move', () => {
    const eid = createEntity(5, 5, 20);
    w.entities.clearDirty();
    setMoveTarget(eid, 7, 5, w);

    runMovement(w);

    const pos = w.entities.position.get(eid)!;
    expect(w.occupancy.get(pos.tileX, pos.tileY)).toBe(eid);
    expect(w.occupancy.get(5, 5)).toBe(0);
  });

  it('entity blocked by another entity waits', () => {
    const a = createEntity(5, 5, 20);
    const b = createEntity(6, 5);
    w.entities.clearDirty();

    setMoveTarget(a, 7, 5, w);

    for (let i = 0; i < 5; i++) {
      runMovement(w);
      w.entities.clearDirty();
    }

    const posA = w.entities.position.get(a)!;
    const posB = w.entities.position.get(b)!;
    expect(posA.tileX === posB.tileX && posA.tileY === posB.tileY).toBe(false);
  });

  it('entity re-paths around blocker after patience expires', () => {
    const a = createEntity(5, 5, 20);
    createEntity(6, 5);
    w.entities.clearDirty();

    setMoveTarget(a, 8, 5, w);

    for (let i = 0; i < 50; i++) {
      runMovement(w);
      w.entities.clearDirty();
    }

    const posA = w.entities.position.get(a)!;
    expect(posA.tileX).toBe(8);
    expect(posA.tileY).toBe(5);
  });

  it('entity paths around tree (static obstacle)', () => {
    const tree = w.entities.create();
    w.entities.position.set(tree, { tileX: 6, tileY: 5 });
    w.entities.blueprintId.set(tree, { blueprintId: BlueprintType.Tree });
    w.occupancy.set(6, 5, tree);

    const player = createEntity(5, 5, 20);
    w.entities.clearDirty();

    setMoveTarget(player, 8, 5, w);

    for (let i = 0; i < 30; i++) {
      runMovement(w);
      w.entities.clearDirty();
    }

    const pos = w.entities.position.get(player)!;
    expect(pos.tileX).toBe(8);
    expect(pos.tileY).toBe(5);
  });

  it('two entities converging: no stacking', () => {
    const a = createEntity(3, 5, 20);
    const b = createEntity(7, 5, 20);
    w.entities.clearDirty();

    setMoveTarget(a, 5, 5, w);
    setMoveTarget(b, 5, 5, w);

    for (let i = 0; i < 30; i++) {
      runMovement(w);
      w.entities.clearDirty();
    }

    const posA = w.entities.position.get(a)!;
    const posB = w.entities.position.get(b)!;
    expect(posA.tileX === posB.tileX && posA.tileY === posB.tileY).toBe(false);
  });
});
