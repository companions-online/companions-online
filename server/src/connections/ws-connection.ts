import type { WebSocket } from 'ws';
import { INTEREST_RANGE } from '@shared/constants.js';
import {
  encodeWelcome, encodeChunk, encodeEntityFullState,
  encodeWorldDelta, encodeInventorySync, encodeContainerOpen, encodeDialogueOpen, encodeChatMessage,
  encodeEnvironmentSync, encodeEntityMeta, encodeGameEvents,
} from '@shared/protocol/codec.js';
import type { WireEvent } from '@shared/protocol/codec.js';
import { WireEventType } from '@shared/protocol/opcodes.js';
import { gameMinuteFromTick } from '@shared/lighting.js';
import type { MetaKey } from '@shared/entity-meta.js';
import type { PlayerConnection, TickDelta, GameWorldView } from '../player-connection.js';
import type { Telemetry } from '../telemetry.js';
import type { GameEvent, GameEventType } from '../events.js';

/** Server-event → wire-event code mapping. Events absent from this map are
 *  MCP-only (action_interrupted, creature_aggro, trades, consume, etc.) and
 *  do not cross the wire. Add entries here to surface new visual events. */
const WIRE_EVENT_MAP: Partial<Record<GameEventType, WireEventType>> = {
  combat_hit_dealt: WireEventType.CombatHitDealt,
  harvest_yield:    WireEventType.HarvestYield,
  craft_complete:   WireEventType.CraftComplete,
  entity_died:      WireEventType.EntityDied,
  player_healed:    WireEventType.PlayerHealed,
};

/** Translate a server-side GameEvent into a wire event, or `null` if the
 *  event type isn't wired to the browser client. */
function toWireEvent(event: GameEvent): WireEvent | null {
  const wireType = WIRE_EVENT_MAP[event.type];
  if (wireType === undefined) return null;
  const d = event.details as any;
  switch (wireType) {
    case WireEventType.CombatHitDealt:
      return {
        type: WireEventType.CombatHitDealt,
        attackerId: d.attackerEntityId,
        targetId: d.targetEntityId,
        damage: d.damage,
        targetHp: d.targetCurrentHp,
        targetMaxHp: d.targetMaxHp,
      };
    case WireEventType.HarvestYield:
      return {
        type: WireEventType.HarvestYield,
        harvesterId: d.harvesterEntityId,
        targetId: d.targetEntityId ?? 0xFFFF,
        yieldBlueprintId: d.blueprintId,
      };
    case WireEventType.CraftComplete:
      return {
        type: WireEventType.CraftComplete,
        crafterId: d.crafterEntityId,
        blueprintId: d.blueprintId,
        quantity: d.quantity,
      };
    case WireEventType.EntityDied:
      return {
        type: WireEventType.EntityDied,
        entityId: d.entityId,
        killerId: d.killerEntityId,
        tileX: d.tileX,
        tileY: d.tileY,
      };
    case WireEventType.PlayerHealed:
      return {
        type: WireEventType.PlayerHealed,
        entityId: d.entityId,
        tileX: d.tileX,
        tileY: d.tileY,
        healAmount: d.healAmount,
      };
  }
  return null;
}

export class WebSocketConnection implements PlayerConnection {
  private pendingEvents: WireEvent[] = [];

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

    // Send EntityFullState (and any meta) for entities in interest range
    for (const eid of world.entities.getAllEntities()) {
      const pos = world.entities.position.get(eid);
      if (!pos) continue;
      if (Math.abs(pos.tileX - playerPos.tileX) <= INTEREST_RANGE &&
          Math.abs(pos.tileY - playerPos.tileY) <= INTEREST_RANGE) {
        const { components, speed } = world.entities.getFullState(eid);
        this.send(encodeEntityFullState(eid, components, speed));
        this.sendMetaFor(eid, world);
      }
    }

    // Send inventory
    this.send(encodeInventorySync(world.inventoryMgr.getSyncData(entityId)));
  }

  private sendMetaFor(eid: number, world: GameWorldView): void {
    const bucket = world.entityMeta.get(eid);
    if (!bucket) return;
    for (const [key, value] of bucket) {
      this.send(encodeEntityMeta(eid, key, value));
    }
  }

  onInventoryChanged(entityId: number, world: GameWorldView): void {
    this.send(encodeInventorySync(world.inventoryMgr.getSyncData(entityId)));
  }

  onTick(_entityId: number, world: GameWorldView, delta: TickDelta): void {

    // Send EntityFullState (and any meta) for entered entities
    for (const eid of delta.entered) {
      const { components, speed } = world.entities.getFullState(eid);
      this.send(encodeEntityFullState(eid, components, speed));
      this.sendMetaFor(eid, world);
    }

    // Send WorldDelta with updates, removals, tile changes, and/or env.
    const hasContent = delta.updated.length > 0 || delta.left.length > 0
      || delta.tileUpdates.length > 0 || delta.environment !== undefined;
    if (hasContent) {
      this.send(encodeWorldDelta(
        delta.tick, delta.updated, delta.left, delta.tileUpdates, delta.environment,
      ));
    }

    // Flush queued broadcast events. WorldDelta sent first so referenced
    // entity ids exist client-side by the time events arrive.
    if (this.pendingEvents.length > 0) {
      this.send(encodeGameEvents(delta.tick, this.pendingEvents));
      this.pendingEvents = [];
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

  onGameEvent(_entityId: number, _event: GameEvent): void {
    // Point-to-point events are MCP-only today (first-person narration to the
    // subject). Visual events reach the wire via onBroadcastEvent.
  }

  onBroadcastEvent(_entityId: number, event: GameEvent): void {
    const wire = toWireEvent(event);
    if (wire) this.pendingEvents.push(wire);
  }

  onEntityMeta(_entityId: number, targetEntityId: number, key: MetaKey, value: string): void {
    this.send(encodeEntityMeta(targetEntityId, key, value));
  }
}
