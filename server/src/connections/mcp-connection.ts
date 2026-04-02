import type { PlayerConnection, GameWorldView } from '../player-connection.js';
import type { GameEvent } from '../events.js';
import { EventBuffer } from '../events.js';

export type DialogueData = {
  greeting: string;
  options: {
    optionId: number;
    label: string;
    type: string;
    response?: string;
    trades?: { tradeId: number; givesBlueprint: number; givesQty: number; wantsBlueprint: number; wantsQty: number }[];
  }[];
};

export class McpConnection implements PlayerConnection {
  entityId = 0;
  world: GameWorldView | null = null;
  readonly eventBuffer: EventBuffer;
  viewRange: number;

  dialogueState: { npcEntityId: number; dialogue: DialogueData } | null = null;
  containerEntityId: number | null = null;

  constructor(viewRange = 8, bufferSize = 50, bufferAge = 60_000) {
    this.eventBuffer = new EventBuffer(bufferSize, bufferAge);
    this.viewRange = viewRange;
  }

  onInitialState(entityId: number, world: GameWorldView): void {
    this.entityId = entityId;
    this.world = world;
  }

  onInventoryChanged(): void {}
  onTick(): void {}
  onChunkNeeded(): void {}
  onChatMessage(): void {}

  onContainerOpen(_entityId: number, containerEntityId: number): void {
    this.containerEntityId = containerEntityId;
  }

  onDialogueOpen(_entityId: number, npcEntityId: number, dialogue: DialogueData): void {
    this.dialogueState = { npcEntityId, dialogue };
  }

  onGameEvent(_entityId: number, event: GameEvent): void {
    this.eventBuffer.push(event);
  }
}
