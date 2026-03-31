import type { WorldMap } from '@shared/world/world-map.js';
import type { DecodedEntityUpdate } from '@shared/protocol/codec.js';
import type { EntityManager } from './ecs/entity-manager.js';
import type { InventoryManager } from './inventory-manager.js';
import type { OccupancyGrid } from './occupancy.js';

export interface TickDelta {
  tick: number;
  entered: number[];
  left: number[];
  updated: DecodedEntityUpdate[];
}

export interface GameWorldView {
  readonly map: WorldMap;
  readonly entities: EntityManager;
  readonly inventoryMgr: InventoryManager;
  readonly occupancy: OccupancyGrid;
}

export interface PlayerConnection {
  onInitialState(entityId: number, world: GameWorldView): void;
  onInventoryChanged(entityId: number, world: GameWorldView): void;
  onTick(entityId: number, world: GameWorldView, delta: TickDelta): void;
}
