import { ActionType } from '@shared/actions.js';
import type { MetaKey } from '@shared/entity-meta.js';
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

export interface ActionResult {
  status: 'complete' | 'died' | 'timeout';
}

export class McpConnection implements PlayerConnection {
  entityId = 0;
  world: GameWorldView | null = null;
  readonly eventBuffer: EventBuffer;
  viewRange: number;

  dialogueState: { npcEntityId: number; dialogue: DialogueData } | null = null;
  containerEntityId: number | null = null;

  // Action blocking
  pendingAction: { resolve: (r: ActionResult) => void } | null = null;
  private ticksWaited = 0;

  constructor(viewRange = 8, bufferSize = 50, bufferAge = 60_000) {
    this.eventBuffer = new EventBuffer(bufferSize, bufferAge);
    this.viewRange = viewRange;
  }

  awaitAction(): Promise<ActionResult> {
    if (this.pendingAction) {
      this.pendingAction.resolve({ status: 'complete' });
    }
    return new Promise(resolve => {
      this.pendingAction = { resolve };
      this.ticksWaited = 0;
    });
  }

  private resolveAction(status: ActionResult['status']): void {
    if (this.pendingAction) {
      this.pendingAction.resolve({ status });
      this.pendingAction = null;
      this.ticksWaited = 0;
    }
  }

  onInitialState(entityId: number, world: GameWorldView): void {
    this.entityId = entityId;
    this.world = world;
  }

  onInventoryChanged(): void {}
  onChunkNeeded(): void {}
  onChatMessage(): void {}

  onTick(): void {
    if (!this.pendingAction || !this.world) return;
    this.ticksWaited++;

    const ca = this.world.entities.currentAction.get(this.entityId);
    const actionType = ca?.actionType ?? ActionType.Idle;

    if (this.ticksWaited === 1) {
      // First tick: action was just processed by GameWorld.
      // Idle = instant action (equip/craft/etc) or rejected. Resolve.
      // Dead = died during processing. Resolve.
      // Anything else = action in progress, keep waiting.
      if (actionType === ActionType.Idle) { this.resolveAction('complete'); return; }
      if (actionType === ActionType.Dead) { this.resolveAction('died'); return; }
      return;
    }

    // Subsequent ticks: resolve when action finishes or times out
    if (actionType === ActionType.Idle) this.resolveAction('complete');
    else if (actionType === ActionType.Dead) this.resolveAction('died');
    else if (this.ticksWaited >= 600) this.resolveAction('timeout');
  }

  onContainerOpen(_entityId: number, containerEntityId: number): void {
    this.containerEntityId = containerEntityId;
  }

  onDialogueOpen(_entityId: number, npcEntityId: number, dialogue: DialogueData): void {
    this.dialogueState = { npcEntityId, dialogue };
  }

  onGameEvent(_entityId: number, event: GameEvent): void {
    this.eventBuffer.push(event);
  }

  onBroadcastEvent(_entityId: number, _event: GameEvent): void {
    // MCP narration uses point-to-point events only; spectator broadcasts
    // would duplicate first-person events into third-person buffer entries.
  }

  onEntityMeta(_entityId: number, _targetEntityId: number, _key: MetaKey, _value: string): void {
    // MCP formatters read live from world.entityMeta; no buffering needed.
  }
}
