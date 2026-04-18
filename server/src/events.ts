import type { MetaKey } from '@shared/entity-meta.js';

// --- Priority ---

export const enum EventPriority {
  Critical = 0,
  High     = 1,
  Medium   = 2,
}

// --- Event types ---

export type GameEventType =
  // Critical
  | 'combat_hit_received'
  | 'entity_died'
  | 'player_died'
  | 'player_respawned'
  | 'player_say'
  | 'action_interrupted'
  | 'creature_aggro'
  // High
  | 'combat_hit_dealt'
  | 'harvest_yield'
  | 'resource_depleted'
  | 'item_picked_up'
  | 'craft_complete'
  | 'trade_complete'
  | 'item_cooked'
  | 'consume_complete'
  | 'building_placed'
  // Medium
  | 'creature_fleeing'
  | 'creature_died'
  | 'entity_meta_changed';

// --- Detail interfaces ---

export interface CombatHitReceivedDetails {
  attackerEntityId: number;
  attackerName: string;
  damage: number;
  currentHp: number;
  maxHp: number;
}

export interface CombatHitDealtDetails {
  targetEntityId: number;
  targetName: string;
  damage: number;
  targetCurrentHp: number;
  targetMaxHp: number;
}

export interface EntityDiedDetails {
  entityId: number;
  entityName: string;
  killerEntityId: number;
  drops: { blueprintId: number; name: string; quantity: number }[];
  tileX: number;
  tileY: number;
}

export interface PlayerDiedDetails {}

export interface PlayerRespawnedDetails {
  tileX: number;
  tileY: number;
  currentHp: number;
  maxHp: number;
}

export interface PlayerSayDetails {
  senderEntityId: number;
  senderName: string;
  message: string;
}

export interface ActionInterruptedDetails {
  interruptedAction: string;
  reason: string;
  causeEntityId?: number;
}

export interface CreatureAggroDetails {
  creatureEntityId: number;
  creatureName: string;
}

export interface HarvestYieldDetails {
  blueprintId: number;
  resourceName: string;
  targetEntityId?: number;
  targetName?: string;
  remaining?: number;
}

export interface ResourceDepletedDetails {
  entityId: number;
  entityName: string;
  tileX: number;
  tileY: number;
}

export interface ItemPickedUpDetails {
  blueprintId: number;
  itemName: string;
  quantity: number;
}

export interface CraftCompleteDetails {
  blueprintId: number;
  itemName: string;
  quantity: number;
}

export interface TradeCompleteDetails {
  npcEntityId: number;
  npcName: string;
  gaveBlueprintId: number;
  gaveName: string;
  gaveQuantity: number;
  receivedBlueprintId: number;
  receivedName: string;
  receivedQuantity: number;
}

export interface ItemCookedDetails {
  inputBlueprintId: number;
  inputName: string;
  outputBlueprintId: number;
  outputName: string;
}

export interface ConsumeCompleteDetails {
  blueprintId: number;
  itemName: string;
  healAmount: number;
  currentHp: number;
  maxHp: number;
}

export interface BuildingPlacedDetails {
  blueprintId: number;
  itemName: string;
  tileX: number;
  tileY: number;
}

export interface CreatureFleeingDetails {
  creatureEntityId: number;
  creatureName: string;
}

export interface CreatureDiedDetails {
  entityId: number;
  entityName: string;
  killerEntityId: number;
  killerName: string;
  tileX: number;
  tileY: number;
}

export interface EntityMetaChangedDetails {
  entityId: number;
  key: MetaKey;
  oldValue?: string;
  newValue: string;
}

// --- Discriminated union ---

export type GameEventDetails =
  | { type: 'combat_hit_received';  details: CombatHitReceivedDetails }
  | { type: 'combat_hit_dealt';     details: CombatHitDealtDetails }
  | { type: 'entity_died';          details: EntityDiedDetails }
  | { type: 'player_died';          details: PlayerDiedDetails }
  | { type: 'player_respawned';     details: PlayerRespawnedDetails }
  | { type: 'player_say';           details: PlayerSayDetails }
  | { type: 'action_interrupted';   details: ActionInterruptedDetails }
  | { type: 'creature_aggro';       details: CreatureAggroDetails }
  | { type: 'harvest_yield';        details: HarvestYieldDetails }
  | { type: 'resource_depleted';    details: ResourceDepletedDetails }
  | { type: 'item_picked_up';       details: ItemPickedUpDetails }
  | { type: 'craft_complete';       details: CraftCompleteDetails }
  | { type: 'trade_complete';       details: TradeCompleteDetails }
  | { type: 'item_cooked';          details: ItemCookedDetails }
  | { type: 'consume_complete';     details: ConsumeCompleteDetails }
  | { type: 'building_placed';      details: BuildingPlacedDetails }
  | { type: 'creature_fleeing';     details: CreatureFleeingDetails }
  | { type: 'creature_died';        details: CreatureDiedDetails }
  | { type: 'entity_meta_changed';  details: EntityMetaChangedDetails };

export type GameEvent = GameEventDetails & {
  priority: EventPriority;
  tick: number;
  timestamp: number;
};

// --- Priority lookup ---

export const EVENT_PRIORITY: Record<GameEventType, EventPriority> = {
  combat_hit_received: EventPriority.Critical,
  entity_died:         EventPriority.Critical,
  player_died:         EventPriority.Critical,
  player_respawned:    EventPriority.Critical,
  player_say:          EventPriority.Critical,
  action_interrupted:  EventPriority.Critical,
  creature_aggro:      EventPriority.Critical,
  combat_hit_dealt:    EventPriority.High,
  harvest_yield:       EventPriority.High,
  resource_depleted:   EventPriority.High,
  item_picked_up:      EventPriority.High,
  craft_complete:      EventPriority.High,
  trade_complete:      EventPriority.High,
  item_cooked:         EventPriority.High,
  consume_complete:    EventPriority.High,
  building_placed:     EventPriority.High,
  creature_fleeing:    EventPriority.Medium,
  creature_died:       EventPriority.Medium,
  entity_meta_changed: EventPriority.Medium,
};

// --- EventBuffer ---

export class EventBuffer {
  private buffer: GameEvent[] = [];
  private readonly maxSize: number;
  private readonly maxAge: number;

  constructor(maxSize = 50, maxAge = 60_000) {
    this.maxSize = maxSize;
    this.maxAge = maxAge;
  }

  get length(): number {
    return this.buffer.length;
  }

  push(event: GameEvent): void {
    this.ageOut();
    if (this.buffer.length >= this.maxSize) {
      this.evictOne();
    }
    this.buffer.push(event);
  }

  flush(): GameEvent[] {
    this.ageOut();
    const events = this.buffer;
    this.buffer = [];
    return events;
  }

  peek(): readonly GameEvent[] {
    return this.buffer;
  }

  private ageOut(): void {
    const cutoff = Date.now() - this.maxAge;
    this.buffer = this.buffer.filter(e => e.timestamp > cutoff);
  }

  private evictOne(): void {
    // Find the lowest-importance event (highest priority number).
    // Within the same tier, evict the oldest (first in array order).
    // Critical events are never evicted.
    let worstPriority = -1;
    let evictIdx = -1;

    for (let i = 0; i < this.buffer.length; i++) {
      const p = this.buffer[i].priority;
      if (p === EventPriority.Critical) continue;
      if (p > worstPriority) {
        worstPriority = p;
        evictIdx = i;
      }
    }

    if (evictIdx >= 0) {
      this.buffer.splice(evictIdx, 1);
    }
    // If all events are Critical, no eviction — buffer grows by 1.
  }
}
