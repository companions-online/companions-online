import { describe, it, expect, beforeEach } from 'vitest';
import { findPath } from '@shared/pathfinding.js';
import { EntityManager } from '../server/src/ecs/entity-manager.js';
import { OccupancyGrid } from '../server/src/occupancy.js';
import { setMoveTarget, runMovement, resetMovement, hasMoveTarget } from '../server/src/systems/movement.js';
import { WorldMap } from '@shared/world/world-map.js';
import { Terrain } from '@shared/terrain.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';

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
    // Vertical wall at x=3, y=0..4
    for (let y = 0; y <= 4; y++) blocked.add(y * W + 3);

    const result = findPath(0, 2, 6, 2, isBlocked, W, H);
    expect(result.found).toBe(true);
    // Path must go around the wall — should avoid x=3,y=0..4
    for (const p of result.path) {
      expect(blocked.has(p.y * W + p.x)).toBe(false);
    }
    expect(result.path[result.path.length - 1]).toEqual({ x: 6, y: 2 });
  });

  it('no path available', () => {
    // Completely surround target
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        blocked.add((5 + dy) * W + (5 + dx));
      }
    }
    blocked.add(5 * W + 5); // target itself

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
    // Diagonal path should be shorter than 6 steps (pure cardinal would be 6)
    expect(result.path.length).toBeLessThanOrEqual(4);
  });

  it('blocked destination: paths to adjacent tile', () => {
    blocked.add(5 * W + 5);
    const result = findPath(0, 0, 5, 5, isBlocked, W, H);
    expect(result.found).toBe(true);
    const last = result.path[result.path.length - 1];
    // Should end adjacent to (5,5), not on it
    const dist = Math.abs(last.x - 5) + Math.abs(last.y - 5);
    expect(dist).toBeLessThanOrEqual(2); // adjacent (including diagonal)
  });

  it('respects maxSearchNodes limit', () => {
    const result = findPath(0, 0, 19, 19, isBlocked, W, H, 5);
    // With only 5 search nodes, probably can't find a long path
    // (may or may not find it depending on heuristic, but shouldn't crash)
    expect(typeof result.found).toBe('boolean');
  });

  it('does not cut corners around obstacles', () => {
    // Wall at (3,2) and (2,3) — diagonal from (2,2) to (3,3) should be blocked
    blocked.add(2 * W + 3); // (3,2)
    blocked.add(3 * W + 2); // (2,3)

    const result = findPath(2, 2, 3, 3, isBlocked, W, H);
    expect(result.found).toBe(true);
    // Path should not go directly diagonal (corner cut)
    // It must go (2,2) → some cardinal step → (3,3)
    expect(result.path.length).toBeGreaterThanOrEqual(2);
  });
});

// --- Occupancy + collision tests ---

describe('Occupancy + movement collision', () => {
  const SIZE = 32;
  let em: EntityManager;
  let map: WorldMap;
  let occ: OccupancyGrid;

  function createEntity(x: number, y: number, speed = 3): number {
    const eid = em.create();
    em.position.set(eid, { tileX: x, tileY: y });
    em.direction.set(eid, { dir: Direction.S });
    em.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    em.currentAction.set(eid, { actionType: ActionType.Idle });
    em.health.set(eid, { currentHp: 100, maxHp: 100 });
    em.blueprintId.set(eid, { blueprintId: BlueprintType.Player });
    em.statusEffects.set(eid, { effects: 0 });
    em.speed.set(eid, speed);
    occ.set(x, y, eid);
    return eid;
  }

  beforeEach(() => {
    em = new EntityManager();
    map = new WorldMap(SIZE, SIZE);
    occ = new OccupancyGrid(SIZE, SIZE);
    resetMovement();
  });

  it('occupancy updated on move', () => {
    const eid = createEntity(5, 5, 20); // speed=20 so steps every tick
    em.clearDirty();
    setMoveTarget(eid, 7, 5, em, map, occ);

    runMovement(em, map, occ);

    const pos = em.position.get(eid)!;
    expect(occ.get(pos.tileX, pos.tileY)).toBe(eid);
    expect(occ.get(5, 5)).toBe(0); // old position cleared
  });

  it('entity blocked by another entity waits', () => {
    const a = createEntity(5, 5, 20);
    const b = createEntity(6, 5); // blocker, not moving
    em.clearDirty();

    setMoveTarget(a, 7, 5, em, map, occ);

    // A wants to go through (6,5) where B sits
    // Run several ticks — A should wait, not stack on B
    for (let i = 0; i < 5; i++) {
      runMovement(em, map, occ);
      em.clearDirty();
    }

    const posA = em.position.get(a)!;
    const posB = em.position.get(b)!;
    // A and B should NOT be on the same tile
    expect(posA.tileX === posB.tileX && posA.tileY === posB.tileY).toBe(false);
  });

  it('entity re-paths around blocker after patience expires', () => {
    const a = createEntity(5, 5, 20);
    const _b = createEntity(6, 5); // blocker in the way
    em.clearDirty();

    setMoveTarget(a, 8, 5, em, map, occ);

    // Run enough ticks for wait patience + re-path + movement
    for (let i = 0; i < 50; i++) {
      runMovement(em, map, occ);
      em.clearDirty();
    }

    const posA = em.position.get(a)!;
    // A should have eventually reached (8,5) by going around B
    expect(posA.tileX).toBe(8);
    expect(posA.tileY).toBe(5);
  });

  it('entity paths around tree (static obstacle)', () => {
    // Place a tree on the occupancy grid
    const tree = em.create();
    em.position.set(tree, { tileX: 6, tileY: 5 });
    em.blueprintId.set(tree, { blueprintId: BlueprintType.Tree });
    occ.set(6, 5, tree);

    const player = createEntity(5, 5, 20);
    em.clearDirty();

    setMoveTarget(player, 8, 5, em, map, occ);

    for (let i = 0; i < 30; i++) {
      runMovement(em, map, occ);
      em.clearDirty();
    }

    const pos = em.position.get(player)!;
    expect(pos.tileX).toBe(8);
    expect(pos.tileY).toBe(5);
  });

  it('two entities converging: no stacking', () => {
    const a = createEntity(3, 5, 20);
    const b = createEntity(7, 5, 20);
    em.clearDirty();

    // Both want tile (5, 5)
    setMoveTarget(a, 5, 5, em, map, occ);
    setMoveTarget(b, 5, 5, em, map, occ);

    for (let i = 0; i < 30; i++) {
      runMovement(em, map, occ);
      em.clearDirty();
    }

    const posA = em.position.get(a)!;
    const posB = em.position.get(b)!;
    // They should NOT be on the same tile
    expect(posA.tileX === posB.tileX && posA.tileY === posB.tileY).toBe(false);
  });
});
