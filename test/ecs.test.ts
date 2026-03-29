import { describe, it, expect, beforeEach } from 'vitest';
import { EntityManager } from '../server/src/ecs/entity-manager.js';
import { ComponentBit, WAYPOINT_NONE } from '@shared/components.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';

let em: EntityManager;

beforeEach(() => {
  em = new EntityManager();
});

describe('Entity lifecycle', () => {
  it('creates entities with incrementing IDs', () => {
    const a = em.create();
    const b = em.create();
    expect(b).toBe(a + 1);
    expect(em.exists(a)).toBe(true);
    expect(em.exists(b)).toBe(true);
    expect(em.getEntityCount()).toBe(2);
  });

  it('destroy removes entity from all stores', () => {
    const id = em.create();
    em.position.set(id, { tileX: 5, tileY: 10 });
    em.direction.set(id, { dir: Direction.N });
    em.health.set(id, { currentHp: 50, maxHp: 100 });
    em.speed.set(id, 3);

    em.destroy(id);

    expect(em.exists(id)).toBe(false);
    expect(em.position.get(id)).toBeUndefined();
    expect(em.direction.get(id)).toBeUndefined();
    expect(em.health.get(id)).toBeUndefined();
    expect(em.speed.get(id)).toBeUndefined();
    expect(em.getEntityCount()).toBe(0);
  });

  it('destroy clears dirty entry', () => {
    const id = em.create();
    em.position.set(id, { tileX: 0, tileY: 0 });
    expect(em.getDirtyEntities().has(id)).toBe(true);

    em.destroy(id);
    expect(em.getDirtyEntities().has(id)).toBe(false);
  });
});

describe('Component get/set', () => {
  it('round-trips all synced component types', () => {
    const id = em.create();

    em.position.set(id, { tileX: 10, tileY: 20 });
    expect(em.position.get(id)).toEqual({ tileX: 10, tileY: 20 });

    em.direction.set(id, { dir: Direction.SE });
    expect(em.direction.get(id)).toEqual({ dir: Direction.SE });

    em.nextWaypoint.set(id, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    expect(em.nextWaypoint.get(id)).toEqual({ tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });

    em.currentAction.set(id, { actionType: ActionType.Walking });
    expect(em.currentAction.get(id)).toEqual({ actionType: ActionType.Walking });

    em.health.set(id, { currentHp: 80, maxHp: 100 });
    expect(em.health.get(id)).toEqual({ currentHp: 80, maxHp: 100 });

    em.blueprintId.set(id, { blueprintId: BlueprintType.Player });
    expect(em.blueprintId.get(id)).toEqual({ blueprintId: BlueprintType.Player });

    em.statusEffects.set(id, { effects: 0b0101 });
    expect(em.statusEffects.get(id)).toEqual({ effects: 0b0101 });
  });

  it('get returns undefined for missing components', () => {
    const id = em.create();
    expect(em.position.get(id)).toBeUndefined();
    expect(em.health.get(id)).toBeUndefined();
  });

  it('has returns correct boolean', () => {
    const id = em.create();
    expect(em.position.has(id)).toBe(false);
    em.position.set(id, { tileX: 0, tileY: 0 });
    expect(em.position.has(id)).toBe(true);
  });
});

describe('Dirty tracking', () => {
  it('setting a component marks the correct bit', () => {
    const id = em.create();
    em.position.set(id, { tileX: 1, tileY: 2 });
    const dirty = em.getDirtyEntities().get(id)!;
    expect(dirty & (1 << ComponentBit.Position)).toBeTruthy();
    expect(dirty & (1 << ComponentBit.Direction)).toBeFalsy();
  });

  it('setting multiple components ORs their bits', () => {
    const id = em.create();
    em.position.set(id, { tileX: 1, tileY: 2 });
    em.direction.set(id, { dir: Direction.E });
    em.health.set(id, { currentHp: 50, maxHp: 100 });

    const dirty = em.getDirtyEntities().get(id)!;
    expect(dirty & (1 << ComponentBit.Position)).toBeTruthy();
    expect(dirty & (1 << ComponentBit.Direction)).toBeTruthy();
    expect(dirty & (1 << ComponentBit.Health)).toBeTruthy();
    expect(dirty & (1 << ComponentBit.NextWaypoint)).toBeFalsy();
  });

  it('clearDirty resets all flags', () => {
    const id = em.create();
    em.position.set(id, { tileX: 1, tileY: 2 });
    em.clearDirty();
    expect(em.getDirtyEntities().size).toBe(0);
  });

  it('tracks dirty across multiple entities independently', () => {
    const a = em.create();
    const b = em.create();
    em.position.set(a, { tileX: 0, tileY: 0 });
    em.health.set(b, { currentHp: 10, maxHp: 10 });

    const dirtyA = em.getDirtyEntities().get(a)!;
    const dirtyB = em.getDirtyEntities().get(b)!;
    expect(dirtyA & (1 << ComponentBit.Position)).toBeTruthy();
    expect(dirtyA & (1 << ComponentBit.Health)).toBeFalsy();
    expect(dirtyB & (1 << ComponentBit.Health)).toBeTruthy();
    expect(dirtyB & (1 << ComponentBit.Position)).toBeFalsy();
  });
});

describe('getFullState', () => {
  it('returns all components and speed', () => {
    const id = em.create();
    em.position.set(id, { tileX: 5, tileY: 10 });
    em.direction.set(id, { dir: Direction.N });
    em.nextWaypoint.set(id, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    em.currentAction.set(id, { actionType: ActionType.Idle });
    em.health.set(id, { currentHp: 100, maxHp: 100 });
    em.blueprintId.set(id, { blueprintId: BlueprintType.Player });
    em.statusEffects.set(id, { effects: 0 });
    em.speed.set(id, 3);

    const state = em.getFullState(id);
    expect(state.components.position).toEqual({ tileX: 5, tileY: 10 });
    expect(state.components.direction).toEqual({ dir: Direction.N });
    expect(state.components.nextWaypoint).toEqual({ tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    expect(state.components.currentAction).toEqual({ actionType: ActionType.Idle });
    expect(state.components.health).toEqual({ currentHp: 100, maxHp: 100 });
    expect(state.components.blueprintId).toEqual({ blueprintId: BlueprintType.Player });
    expect(state.components.statusEffects).toEqual({ effects: 0 });
    expect(state.speed).toBe(3);
  });

  it('omits components that are not set', () => {
    const id = em.create();
    em.position.set(id, { tileX: 0, tileY: 0 });
    const state = em.getFullState(id);
    expect(state.components.position).toBeDefined();
    expect(state.components.direction).toBeUndefined();
    expect(state.components.health).toBeUndefined();
    expect(state.speed).toBeUndefined();
  });
});

describe('getDeltaComponents', () => {
  it('returns only components matching the bitmask', () => {
    const id = em.create();
    em.position.set(id, { tileX: 5, tileY: 10 });
    em.direction.set(id, { dir: Direction.E });
    em.health.set(id, { currentHp: 50, maxHp: 100 });

    // Only request Position + Health
    const mask = (1 << ComponentBit.Position) | (1 << ComponentBit.Health);
    const delta = em.getDeltaComponents(id, mask);

    expect(delta.position).toEqual({ tileX: 5, tileY: 10 });
    expect(delta.health).toEqual({ currentHp: 50, maxHp: 100 });
    expect(delta.direction).toBeUndefined();
  });

  it('returns empty object for zero bitmask', () => {
    const id = em.create();
    em.position.set(id, { tileX: 1, tileY: 2 });
    const delta = em.getDeltaComponents(id, 0);
    expect(delta).toEqual({});
  });
});
