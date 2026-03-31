import type { PlayerConnection, TickDelta, GameWorldView } from '../player-connection.js';

export interface ConnectionEvent {
  type: 'init' | 'inventory' | 'tick';
  entityId: number;
  data?: TickDelta;
}

export class HeadlessConnection implements PlayerConnection {
  readonly events: ConnectionEvent[] = [];

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
}
