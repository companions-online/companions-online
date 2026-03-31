import type { WorldMap } from '@shared/world/world-map.js';
import type { EntityManager } from './ecs/entity-manager.js';
import type { OccupancyGrid } from './occupancy.js';
import type { InventoryManager } from './inventory-manager.js';

// Per-entity movement path state
export interface MovementState {
  targetX: number;
  targetY: number;
  path: { x: number; y: number }[];
  pathIndex: number;
  waitTicks: number;
  cooldownRemaining: number;
  diagonalCheap: boolean;
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
}

export interface HarvestContext {
  yieldBlueprintId: number;
  tickCost: number;
  bonusChance?: number;
  bonusBlueprintId?: number;
}

// Per-critter AI state
export interface CritterState {
  idleTicksRemaining: number;
  rng: number;
}

/** All mutable game state needed by systems. GameWorld implements this. */
export interface SystemState {
  readonly map: WorldMap;
  readonly entities: EntityManager;
  readonly occupancy: OccupancyGrid;
  readonly inventoryMgr: InventoryManager;

  readonly moveStates: Map<number, MovementState>;
  readonly harvestStates: Map<number, HarvestState>;
  readonly critterStates: Map<number, CritterState>;
  readonly treeResources: Map<number, number>;
  readonly respawnQueue: { tick: number; blueprintType: number }[];

  respawnRng: number;
  currentTick: number;
}
