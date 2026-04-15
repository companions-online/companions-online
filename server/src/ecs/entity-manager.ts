import { ComponentBit } from '@shared/components.js';
import type {
  PositionData, DirectionData, NextWaypointData,
  CurrentActionData, HealthData, BlueprintData, StatusEffectsData,
} from '@shared/components.js';
import type { EntityComponents } from '@shared/protocol/codec.js';
import { ComponentStore } from './component-store.js';

export class EntityManager {
  private nextId = 1;
  private alive = new Set<number>();
  private dirty = new Map<number, number>();
  private destroyed: number[] = [];

  // Synced components
  readonly position      = new ComponentStore<PositionData>(ComponentBit.Position, this.dirty);
  readonly direction     = new ComponentStore<DirectionData>(ComponentBit.Direction, this.dirty);
  readonly nextWaypoint  = new ComponentStore<NextWaypointData>(ComponentBit.NextWaypoint, this.dirty);
  readonly currentAction = new ComponentStore<CurrentActionData>(ComponentBit.CurrentAction, this.dirty);
  readonly health        = new ComponentStore<HealthData>(ComponentBit.Health, this.dirty);
  readonly blueprint     = new ComponentStore<BlueprintData>(ComponentBit.Blueprint, this.dirty);
  readonly statusEffects = new ComponentStore<StatusEffectsData>(ComponentBit.StatusEffects, this.dirty);

  // Server-only (no dirty tracking)
  readonly path  = new Map<number, { x: number; y: number }[]>();
  readonly speed = new Map<number, number>();

  create(): number {
    const id = this.nextId++;
    this.alive.add(id);
    return id;
  }

  createWithId(id: number): void {
    this.alive.add(id);
    if (id >= this.nextId) this.nextId = id + 1;
  }

  getNextId(): number { return this.nextId; }
  setNextId(id: number): void { this.nextId = id; }

  destroy(id: number): void {
    this.alive.delete(id);
    this.dirty.delete(id);
    this.destroyed.push(id);
    this.position.delete(id);
    this.direction.delete(id);
    this.nextWaypoint.delete(id);
    this.currentAction.delete(id);
    this.health.delete(id);
    this.blueprint.delete(id);
    this.statusEffects.delete(id);
    this.path.delete(id);
    this.speed.delete(id);
  }

  exists(id: number): boolean {
    return this.alive.has(id);
  }

  getDirtyEntities(): Map<number, number> {
    return this.dirty;
  }

  clearDirty(): void {
    this.dirty.clear();
  }

  getDestroyed(): readonly number[] {
    return this.destroyed;
  }

  clearDestroyed(): void {
    this.destroyed = [];
  }

  getEntityCount(): number {
    return this.alive.size;
  }

  getAllEntities(): ReadonlySet<number> {
    return this.alive;
  }

  getFullState(id: number): { components: EntityComponents; speed?: number } {
    const components: EntityComponents = {};
    const pos = this.position.get(id);
    if (pos) components.position = pos;
    const dir = this.direction.get(id);
    if (dir) components.direction = dir;
    const wp = this.nextWaypoint.get(id);
    if (wp) components.nextWaypoint = wp;
    const act = this.currentAction.get(id);
    if (act) components.currentAction = act;
    const hp = this.health.get(id);
    if (hp) components.health = hp;
    const bp = this.blueprint.get(id);
    if (bp) components.blueprint = bp;
    const se = this.statusEffects.get(id);
    if (se) components.statusEffects = se;

    const spd = this.speed.get(id);
    return { components, speed: spd };
  }

  getDeltaComponents(id: number, bitmask: number): EntityComponents {
    const components: EntityComponents = {};
    if (bitmask & (1 << ComponentBit.Position)) {
      const v = this.position.get(id);
      if (v) components.position = v;
    }
    if (bitmask & (1 << ComponentBit.Direction)) {
      const v = this.direction.get(id);
      if (v) components.direction = v;
    }
    if (bitmask & (1 << ComponentBit.NextWaypoint)) {
      const v = this.nextWaypoint.get(id);
      if (v) components.nextWaypoint = v;
    }
    if (bitmask & (1 << ComponentBit.CurrentAction)) {
      const v = this.currentAction.get(id);
      if (v) components.currentAction = v;
    }
    if (bitmask & (1 << ComponentBit.Health)) {
      const v = this.health.get(id);
      if (v) components.health = v;
    }
    if (bitmask & (1 << ComponentBit.Blueprint)) {
      const v = this.blueprint.get(id);
      if (v) components.blueprint = v;
    }
    if (bitmask & (1 << ComponentBit.StatusEffects)) {
      const v = this.statusEffects.get(id);
      if (v) components.statusEffects = v;
    }
    return components;
  }
}
