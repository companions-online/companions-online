import type { WebSocket } from 'ws';
import { INTEREST_RANGE } from '@shared/constants.js';
import {
  encodeWelcome, encodeChunk, encodeEntityFullState,
  encodeWorldDelta, encodeInventorySync, encodeContainerOpen, encodeDialogueOpen, encodeChatMessage,
  encodeEnvironmentSync,
} from '@shared/protocol/codec.js';
import { gameMinuteFromTick } from '@shared/lighting.js';
import type { PlayerConnection, TickDelta, GameWorldView } from '../player-connection.js';
import type { Telemetry } from '../telemetry.js';
import type { GameEvent } from '../events.js';

export class WebSocketConnection implements PlayerConnection {
  constructor(private ws: WebSocket, private telemetry: Telemetry) {}

  private send(buf: ArrayBuffer): void {
    this.ws.send(buf);
    this.telemetry.recordBytesSent('ws', buf.byteLength);
  }

  onChunkNeeded(chunkX: number, chunkY: number, world: GameWorldView): void {
    this.send(encodeChunk(
      chunkX, chunkY,
      world.map.getChunkTerrain(chunkX, chunkY),
      world.map.getChunkBuildings(chunkX, chunkY),
      world.map.getChunkBuildingMeta(chunkX, chunkY),
    ));
  }

  onInitialState(entityId: number, world: GameWorldView): void {
    const playerPos = world.entities.position.get(entityId);
    if (!playerPos) return;

    this.send(encodeWelcome(entityId, world.seed));
    this.send(encodeEnvironmentSync(
      gameMinuteFromTick(world.effectiveTick),
      world.weather,
      world.currentTick,
    ));

    // Chunks are sent by GameWorld via onChunkNeeded before this call

    // Send EntityFullState for entities in interest range
    for (const eid of world.entities.getAllEntities()) {
      const pos = world.entities.position.get(eid);
      if (!pos) continue;
      if (Math.abs(pos.tileX - playerPos.tileX) <= INTEREST_RANGE &&
          Math.abs(pos.tileY - playerPos.tileY) <= INTEREST_RANGE) {
        const { components, speed } = world.entities.getFullState(eid);
        this.send(encodeEntityFullState(eid, components, speed));
      }
    }

    // Send inventory
    this.send(encodeInventorySync(world.inventoryMgr.getSyncData(entityId)));
  }

  onInventoryChanged(entityId: number, world: GameWorldView): void {
    this.send(encodeInventorySync(world.inventoryMgr.getSyncData(entityId)));
  }

  onTick(entityId: number, world: GameWorldView, delta: TickDelta): void {

    // Send EntityFullState for entered entities
    for (const eid of delta.entered) {
      const { components, speed } = world.entities.getFullState(eid);
      this.send(encodeEntityFullState(eid, components, speed));
    }

    // Send WorldDelta with updates, removals, tile changes, and/or env.
    const hasContent = delta.updated.length > 0 || delta.left.length > 0
      || delta.tileUpdates.length > 0 || delta.environment !== undefined;
    if (hasContent) {
      this.send(encodeWorldDelta(
        delta.tick, delta.updated, delta.left, delta.tileUpdates, delta.environment,
      ));
    }
  }

  onContainerOpen(entityId: number, containerEntityId: number, world: GameWorldView): void {
    this.send(encodeContainerOpen(containerEntityId, world.inventoryMgr.getSyncData(containerEntityId)));
  }

  onDialogueOpen(_entityId: number, npcEntityId: number, dialogue: Parameters<PlayerConnection['onDialogueOpen']>[2]): void {
    this.send(encodeDialogueOpen(npcEntityId, JSON.stringify(dialogue)));
  }

  onChatMessage(_entityId: number, senderEntityId: number, message: string): void {
    this.send(encodeChatMessage(senderEntityId, message));
  }

  onGameEvent(_entityId: number, _event: GameEvent): void {}
}
