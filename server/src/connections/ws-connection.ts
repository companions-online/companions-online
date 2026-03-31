import type { WebSocket } from 'ws';
import { MAP_SIZE, CHUNK_SIZE, INTEREST_RANGE } from '@shared/constants.js';
import {
  encodeWelcome, encodeChunk, encodeEntityFullState,
  encodeWorldDelta, encodeInventorySync,
} from '@shared/protocol/codec.js';
import type { PlayerConnection, TickDelta, GameWorldView } from '../player-connection.js';

export class WebSocketConnection implements PlayerConnection {
  constructor(private ws: WebSocket) {}

  onInitialState(entityId: number, world: GameWorldView): void {
    const { ws } = this;
    const playerPos = world.entities.position.get(entityId);
    if (!playerPos) return;

    ws.send(encodeWelcome(entityId));

    // Send all chunks
    const chunksPerSide = MAP_SIZE / CHUNK_SIZE;
    for (let cy = 0; cy < chunksPerSide; cy++) {
      for (let cx = 0; cx < chunksPerSide; cx++) {
        ws.send(encodeChunk(
          cx, cy,
          world.map.getChunkTerrain(cx, cy),
          world.map.getChunkBuildings(cx, cy),
          world.map.getChunkBuildingMeta(cx, cy),
        ));
      }
    }

    // Send EntityFullState for entities in interest range
    for (const eid of world.entities.getAllEntities()) {
      const pos = world.entities.position.get(eid);
      if (!pos) continue;
      if (Math.abs(pos.tileX - playerPos.tileX) <= INTEREST_RANGE &&
          Math.abs(pos.tileY - playerPos.tileY) <= INTEREST_RANGE) {
        const { components, speed } = world.entities.getFullState(eid);
        ws.send(encodeEntityFullState(eid, components, speed));
      }
    }

    // Send inventory
    ws.send(encodeInventorySync(world.inventoryMgr.getSyncData(entityId)));
  }

  onInventoryChanged(entityId: number, world: GameWorldView): void {
    this.ws.send(encodeInventorySync(world.inventoryMgr.getSyncData(entityId)));
  }

  onTick(entityId: number, world: GameWorldView, delta: TickDelta): void {
    const { ws } = this;

    // Send EntityFullState for entered entities
    for (const eid of delta.entered) {
      const { components, speed } = world.entities.getFullState(eid);
      ws.send(encodeEntityFullState(eid, components, speed));
    }

    // Send WorldDelta with updates + removals
    if (delta.updated.length > 0 || delta.left.length > 0) {
      ws.send(encodeWorldDelta(delta.tick, delta.updated, delta.left, []));
    }
  }
}
