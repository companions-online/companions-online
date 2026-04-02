import type { PlayerConnection, TickDelta, GameWorldView } from '../player-connection.js';
import type { GameEvent } from '../events.js';

export interface ConnectionEvent {
  type: 'init' | 'inventory' | 'tick' | 'containerOpen' | 'dialogueOpen' | 'chatMessage';
  entityId: number;
  data?: TickDelta;
  containerEntityId?: number;
  npcEntityId?: number;
  dialogue?: unknown;
  senderEntityId?: number;
  chatMessage?: string;
}

export class HeadlessConnection implements PlayerConnection {
  readonly events: ConnectionEvent[] = [];
  readonly gameEvents: GameEvent[] = [];

  onInitialState(entityId: number, _world: GameWorldView): void {
    this.events.push({ type: 'init', entityId });
  }

  onInventoryChanged(entityId: number, _world: GameWorldView): void {
    this.events.push({ type: 'inventory', entityId });
  }

  onTick(entityId: number, _world: GameWorldView, delta: TickDelta): void {
    if (delta.entered.length || delta.left.length || delta.updated.length) {
      this.events.push({ type: 'tick', entityId, data: delta });
    }
  }

  onChunkNeeded(_chunkX: number, _chunkY: number, _world: GameWorldView): void {
    // no-op for tests
  }

  onContainerOpen(entityId: number, containerEntityId: number, _world: GameWorldView): void {
    this.events.push({ type: 'containerOpen', entityId, containerEntityId });
  }

  onDialogueOpen(entityId: number, npcEntityId: number, dialogue: unknown): void {
    this.events.push({ type: 'dialogueOpen', entityId, npcEntityId, dialogue });
  }

  onChatMessage(entityId: number, senderEntityId: number, message: string): void {
    this.events.push({ type: 'chatMessage', entityId, senderEntityId, chatMessage: message });
  }

  onGameEvent(_entityId: number, event: GameEvent): void {
    this.gameEvents.push(event);
  }
}
