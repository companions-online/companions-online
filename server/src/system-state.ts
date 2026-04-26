import type { WorldMap } from '@shared/world/world-map.js';
import type { EntityManager } from './ecs/entity-manager.js';
import type { OccupancyGrid } from './occupancy.js';
import type { InventoryManager } from './inventory-manager.js';
import type { ConsumableState } from './systems/consumable.js';

// Per-entity movement path state
export interface MovementState {
  targetX: number;
  targetY: number;
  path: { x: number; y: number }[];
  pathIndex: number;
  waitTicks: number;
  cooldownRemaining: number;
}

// Per-entity harvest channel state
export interface HarvestState {
  targetX: number;
  targetY: number;
  targetEntityId?: number;
  ticksRemaining: number;
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

// Per-entity combat state
export interface CombatState {
  targetEntityId: number;
  ticksRemaining: number;
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

  respawnRng: number;
  currentTick: number;
  /** currentTick + tickOffset — feeds day/night schedule lookups. */
  readonly effectiveTick: number;
}
