import type { WorldMap } from '@shared/world/world-map.js';
import type { DecodedEntityUpdate, DecodedTileUpdate } from '@shared/protocol/codec.js';
import type { EntityManager } from './ecs/entity-manager.js';
import type { InventoryManager } from './inventory-manager.js';
import type { OccupancyGrid } from './occupancy.js';

export interface TickDelta {
  tick: number;
  entered: number[];
  left: number[];
  updated: DecodedEntityUpdate[];
  tileUpdates: DecodedTileUpdate[];
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
  onChunkNeeded(chunkX: number, chunkY: number, world: GameWorldView): void;
  onContainerOpen(entityId: number, containerEntityId: number, world: GameWorldView): void;
  onDialogueOpen(entityId: number, npcEntityId: number, dialogue: { greeting: string; options: { optionId: number; label: string; type: string; response?: string; trades?: { tradeId: number; givesBlueprint: number; givesQty: number; wantsBlueprint: number; wantsQty: number }[] }[] }): void;
  onChatMessage(entityId: number, senderEntityId: number, message: string): void;
}
