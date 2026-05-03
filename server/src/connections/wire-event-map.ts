// Translates server-side GameEvents to wire events. Shared between
// WebSocketConnection (binary protocol over the network) and the standalone
// in-process bridge — both want the "spectator-visible" subset and identical
// shapes, since the client's onGameEvent dispatch keys on WireEventType.

import type { WireEvent } from '@shared/protocol/codec.js';
import { WireEventType } from '@shared/protocol/opcodes.js';
import type { GameEvent, GameEventType } from '../events.js';

/** Server-event → wire-event code mapping. Events absent from this map are
 *  MCP-only (action_interrupted, creature_aggro, trades, consume, etc.) and
 *  do not cross the wire. Add entries here to surface new visual events. */
export const WIRE_EVENT_MAP: Partial<Record<GameEventType, WireEventType>> = {
  combat_hit_dealt: WireEventType.CombatHitDealt,
  harvest_yield:    WireEventType.HarvestYield,
  craft_complete:   WireEventType.CraftComplete,
  entity_died:      WireEventType.EntityDied,
  player_healed:    WireEventType.PlayerHealed,
};

/** Translate a server-side GameEvent into a wire event, or `null` if the
 *  event type isn't wired to the browser client. */
export function toWireEvent(event: GameEvent): WireEvent | null {
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
