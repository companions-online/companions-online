import type { WorldMap } from '@shared/world/world-map.js';
import type { EntityManager } from './ecs/entity-manager.js';
import type { OccupancyGrid } from './occupancy.js';
import type { InventoryManager } from './inventory-manager.js';
import type { ConsumableState } from './systems/consumable.js';

// Per-entity movement path state. Step pacing lives on `world.cooldowns`,
// not on this struct — see SystemState.setCooldown.
export interface MovementState {
  targetX: number;
  targetY: number;
  path: { x: number; y: number }[];
  pathIndex: number;
  waitTicks: number;
}

// Per-entity harvest channel state. Yield pacing lives on `world.cooldowns`.
export interface HarvestState {
  targetX: number;
  targetY: number;
  targetEntityId?: number;
  context: HarvestContext;
  pathfinding: boolean;
  rng: number;
  yieldsSoFar: number;
}

export interface HarvestContext {
  yieldBlueprintId: number;
  tickCost: number;
  bonusChance?: number;
  bonusBlueprintId?: number;
}

// Per-entity combat state. Swing pacing lives on `world.cooldowns`.
export interface CombatState {
  targetEntityId: number;
  attackSpeed: number;
  damage: number;
}

// Per-critter AI state
export interface CritterState {
  idleTicksRemaining: number;
  rng: number;
  behavior: 'wander' | 'flee' | 'aggro' | 'passive';
  targetEntityId?: number;
  /** Ticks until the next wander→aggro reachability probe is allowed. Set
   *  to DEFAULT_AGGRO_PROBE_COOLDOWN whenever a probe fails so we don't
   *  pathfind every tick against an unreachable player. */
  aggroProbeCooldown?: number;
}

/** All mutable game state needed by systems. GameWorld implements this. */
export interface SystemState {
  readonly map: WorldMap;
  readonly entities: EntityManager;
  readonly occupancy: OccupancyGrid;
  readonly inventoryMgr: InventoryManager;

  readonly moveStates: Map<number, MovementState>;
  readonly harvestStates: Map<number, HarvestState>;
  readonly combatStates: Map<number, CombatState>;
  readonly consumableStates: Map<number, ConsumableState>;
  readonly critterStates: Map<number, CritterState>;
  readonly treeResources: Map<number, number>;
  readonly respawnQueue: { tick: number; blueprintType: number }[];
  readonly players: ReadonlyMap<number, { entityId: number }>;

  /** Unified per-entity action cooldown. Ticks until the next time-taking
   *  action commit (movement step, harvest yield, combat swing, consume
   *  completion) can fire. Decremented once per tick at the top of `runTick`,
   *  read as a gate by every `run*` system, written by every committing
   *  action via `setCooldown`. Missing entry == 0 (free to commit). Replaces
   *  the per-state timers that used to live on MovementState /
   *  HarvestState / CombatState / ConsumableState. */
  readonly cooldowns: Map<number, number>;
  /** Max-write helper. Sets `cooldowns[eid] = max(current, ticks)` so that
   *  multiple systems writing in the same tick (e.g. movement step's
   *  `stepTicks` + harvest pathfinding→active's `tickCost` on the arrival
   *  tick) compose intuitively: the longest in-flight commit wins. */
  setCooldown(eid: number, ticks: number): void;
  /** Drop the cooldown entry. Called from cancelConsume and explicit
   *  ClientAction.Cancel — the in-flight commit won't happen, so the rate
   *  residue should not linger. */
  clearCooldown(eid: number): void;

  respawnRng: number;
  currentTick: number;
  /** currentTick + tickOffset — feeds day/night schedule lookups. */
  readonly effectiveTick: number;
}
