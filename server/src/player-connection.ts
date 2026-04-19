import type { WorldMap } from '@shared/world/world-map.js';
import type { DecodedEntityUpdate, DecodedTileUpdate, DecodedEnvironment } from '@shared/protocol/codec.js';
import type { MetaKey } from '@shared/entity-meta.js';
import type { EntityManager } from './ecs/entity-manager.js';
import type { InventoryManager } from './inventory-manager.js';
import type { OccupancyGrid } from './occupancy.js';
import type { GameEvent } from './events.js';

export interface TickDelta {
  tick: number;
  entered: number[];
  left: number[];
  updated: DecodedEntityUpdate[];
  tileUpdates: DecodedTileUpdate[];
  environment?: DecodedEnvironment;
}

export interface GameWorldView {
  readonly map: WorldMap;
  readonly entities: EntityManager;
  readonly inventoryMgr: InventoryManager;
  readonly occupancy: OccupancyGrid;
  readonly seed: number;
  readonly currentTick: number;
  readonly effectiveTick: number;
  readonly weather: number;
  readonly entityMeta: ReadonlyMap<number, ReadonlyMap<MetaKey, string>>;
}

export interface PlayerConnection {
  onInitialState(entityId: number, world: GameWorldView): void;
  onInventoryChanged(entityId: number, world: GameWorldView): void;
  onTick(entityId: number, world: GameWorldView, delta: TickDelta): void;
  onChunkNeeded(chunkX: number, chunkY: number, world: GameWorldView): void;
  onContainerOpen(entityId: number, containerEntityId: number, world: GameWorldView): void;
  onDialogueOpen(entityId: number, npcEntityId: number, dialogue: { greeting: string; options: { optionId: number; label: string; type: string; response?: string; trades?: { tradeId: number; givesBlueprint: number; givesQty: number; wantsBlueprint: number; wantsQty: number }[] }[] }): void;
  onChatMessage(entityId: number, senderEntityId: number, message: string): void;
  /** Point-to-point event (e.g. "you hit X" first-person). Delivered to the
   *  event's subject. MCP consumes these for narration. */
  onGameEvent(entityId: number, event: GameEvent): void;
  /** Spectator-range event (e.g. "someone nearby landed a hit"). Delivered to
   *  every player within INTEREST_RANGE of the event position. WS encodes as
   *  a wire GameEvent for client-side visual effects; MCP ignores (MCP
   *  narration uses point-to-point events only). */
  onBroadcastEvent(entityId: number, event: GameEvent): void;
  onEntityMeta(entityId: number, targetEntityId: number, key: MetaKey, value: string): void;
}
