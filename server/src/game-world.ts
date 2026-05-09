import { SPAWN_X, SPAWN_Y, MAP_SIZE, CHUNK_SIZE, INTEREST_RANGE } from '@shared/constants.js';
import { gameMinuteFromTick, gameHourFromTick, KEYFRAME_HOURS, MORNING_TICK_OFFSET } from '@shared/lighting.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { generateWorld } from '@shared/world/world-gen.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { DecodedAction, DecodedEntityUpdate, DecodedTileUpdate } from '@shared/protocol/codec.js';
import { MetaKey } from '@shared/entity-meta.js';
import { MAX_PLAYER_WEIGHT } from '@shared/inventory.js';
import { getLootTable } from '@shared/loot-tables.js';
import { EntityManager } from './ecs/entity-manager.js';
import { OccupancyGrid } from './occupancy.js';
import { InventoryManager } from './inventory-manager.js';
import type { PlayerConnection, TickDelta } from './player-connection.js';
import type { SystemState, MovementState, HarvestState, CritterState, CombatState } from './system-state.js';
import { clearMoveTarget, runMovement } from './systems/movement.js';
import { cancelHarvest, runHarvest } from './systems/harvest.js';
import { initCritterAI, runCritterAI, notifyCritterAttacked } from './systems/critter-ai.js';
import { cancelCombat, runCombat } from './systems/combat.js';
import { cancelConsume, runConsume, type ConsumableState } from './systems/consumable.js';
import { initTreeResource, runResourceRespawns } from './systems/resources.js';
import { runCreatureRespawns, runCreatureLifecycle } from './systems/creature-lifecycle.js';
import { Telemetry } from './telemetry.js';
import { EVENT_PRIORITY, type GameEvent } from './events.js';
import { processAction } from './world-actions.js';
import { runPendingActions, type PendingAction } from './pending-actions.js';
import { createMemoryLogger, type WorldLogger } from './world-logger.js';
import { isGroundItemBlueprint, spawnCreatureEntity, spawnGroundItem } from './entity-spawn.js';

const chunksPerSide = MAP_SIZE / CHUNK_SIZE;

function chunkKey(cx: number, cy: number): number {
  return cy * chunksPerSide + cx;
}

function getNeededChunks(tileX: number, tileY: number): [number, number][] {
  const minCx = Math.max(0, Math.floor((tileX - INTEREST_RANGE) / CHUNK_SIZE));
  const maxCx = Math.min(chunksPerSide - 1, Math.floor((tileX + INTEREST_RANGE) / CHUNK_SIZE));
  const minCy = Math.max(0, Math.floor((tileY - INTEREST_RANGE) / CHUNK_SIZE));
  const maxCy = Math.min(chunksPerSide - 1, Math.floor((tileY + INTEREST_RANGE) / CHUNK_SIZE));
  const result: [number, number][] = [];
  for (let cy = minCy; cy <= maxCy; cy++)
    for (let cx = minCx; cx <= maxCx; cx++)
      result.push([cx, cy]);
  return result;
}

export interface PlayerSlot {
  entityId: number;
  connection: PlayerConnection;
  knownEntities: Set<number>;
  sentChunks: Set<number>;
  playerFlags: Set<string>;
  pendingAction: DecodedAction | null;
}

/** A passive viewer with no in-world entity. Receives the same broadcast
 *  surface as a player (chunks, tick deltas, broadcast events, entity meta,
 *  chat-in-range) keyed off `focusX/focusY` instead of an entity position.
 *  Cannot act, has no inventory, no occupancy, and is not visible to other
 *  players (no entity to enter their interest range). Used by the standalone
 *  main menu's background world and any future god-view tooling. */
export interface ObserverSlot {
  observerId: number;
  connection: PlayerConnection;
  focusX: number;
  focusY: number;
  knownEntities: Set<number>;
  sentChunks: Set<number>;
}

export class GameWorld implements SystemState {
  readonly entities = new EntityManager();
  readonly occupancy: OccupancyGrid;
  readonly inventoryMgr = new InventoryManager();

  readonly players = new Map<number, PlayerSlot>();
  readonly observers = new Map<number, ObserverSlot>();
  readonly pendingActions = new Map<number, PendingAction>();
  /** Counter for observer ids — starts at -1, decrements. Negative space
   *  keeps observer ids from ever colliding with entityIds (which are
   *  positive). */
  private nextObserverId = -1;

  readonly moveStates = new Map<number, MovementState>();
  readonly harvestStates = new Map<number, HarvestState>();
  readonly combatStates = new Map<number, CombatState>();
  readonly consumableStates = new Map<number, ConsumableState>();
  readonly critterStates = new Map<number, CritterState>();
  readonly treeResources = new Map<number, number>();
  readonly respawnQueue: { tick: number; blueprintType: number }[] = [];
  readonly playerRespawnTimers = new Map<number, number>();
  readonly entityMeta = new Map<number, Map<MetaKey, string>>();

  readonly telemetry = new Telemetry();

  private _tick = 0;
  private spawnRng: number;
  respawnRng: number;

  /** Current weather byte (0 = clear). Persists across saves once save
   *  format supports it; currently ephemeral. */
  weather = 0;
  /** Time-of-day offset added to `_tick` before feeding the day/night
   *  schedule. Persisted on meta so restarts resume the same time. Shift
   *  at runtime via `setTickOffset` — forces the next broadcast to emit a
   *  fresh Environment section so clients snap. */
  tickOffset = 0;
  /** Last in-game hour we broadcast an Environment section for, used to
   *  emit exactly once per keyframe crossing. */
  private _lastEnvEmitHour = -1;
  /** Last weather value we broadcast an Environment section for. */
  private _lastEnvEmitWeather = 0;

  readonly log: WorldLogger;

  private eventObserver: (entityId: number, event: GameEvent, channel: 'emit' | 'broadcast') => void = () => {};

  constructor(readonly map: WorldMap, readonly seed = 0, logger?: WorldLogger) {
    this.log = logger ?? createMemoryLogger();
    this.occupancy = new OccupancyGrid(map.width, map.height, (msg, data) =>
      this.log.error(msg, data),
    );
    this.spawnRng = seed;
    this.respawnRng = seed + 12345;
  }

  get currentTick(): number { return this._tick; }

  /** Tick value fed into the day/night schedule (currentTick + tickOffset).
   *  Kept distinct from `currentTick` so respawn timers, event ages, and
   *  save metadata continue to use the raw tick counter. */
  get effectiveTick(): number { return this._tick + this.tickOffset; }

  /** Update the day/night offset and force the next broadcast to emit a
   *  fresh Environment section so clients re-sync immediately. */
  setTickOffset(n: number): void {
    this.tickOffset = n;
    this._lastEnvEmitHour = -1;
  }

  /** Register a single observer notified for every emitEvent / broadcastEvent.
   *  Eval and test code use this to score behavioral checkpoints. Default is
   *  a no-op; observer errors are swallowed so a misbehaving observer can't
   *  break the tick. */
  setEventObserver(fn: (entityId: number, event: GameEvent, channel: 'emit' | 'broadcast') => void): void {
    this.eventObserver = fn;
  }

  emitEvent(entityId: number, event: GameEvent): void {
    const slot = this.players.get(entityId);
    if (slot) slot.connection.onGameEvent(entityId, event);
    try { this.eventObserver(entityId, event, 'emit'); } catch { /* swallow */ }
  }

  /** Deliver a spectator-visible notification to every player within
   *  INTEREST_RANGE of the given tile. Routes via `onBroadcastEvent` — a
   *  channel separate from point-to-point `onGameEvent` — so MCP narration
   *  stays first-person while WS clients receive visual events for anyone
   *  nearby (including the actor themselves). Use for hit-landed,
   *  yield-popped, entity-died. Keep hit_received / item_picked_up / trades
   *  on `emitEvent`. */
  broadcastEvent(tileX: number, tileY: number, event: GameEvent): void {
    for (const [eid, slot] of this.players) {
      const p = this.entities.position.get(eid);
      if (!p) continue;
      if (Math.abs(tileX - p.tileX) <= INTEREST_RANGE &&
          Math.abs(tileY - p.tileY) <= INTEREST_RANGE) {
        slot.connection.onBroadcastEvent(eid, event);
        try { this.eventObserver(eid, event, 'broadcast'); } catch { /* swallow */ }
      }
    }
    // Observers receive broadcasts whose tile is within their focus range,
    // same as players. eventObserver gets entityId=0 for observer-channel
    // events; eval/test scoring filters on the 'emit' channel only so this
    // is harmless to existing tests.
    for (const slot of this.observers.values()) {
      if (Math.abs(tileX - slot.focusX) <= INTEREST_RANGE &&
          Math.abs(tileY - slot.focusY) <= INTEREST_RANGE) {
        slot.connection.onBroadcastEvent(0, event);
        try { this.eventObserver(0, event, 'broadcast'); } catch { /* swallow */ }
      }
    }
  }

  makeEvent<T extends GameEvent['type']>(
    type: T,
    details: Extract<GameEvent, { type: T }>['details'],
  ): GameEvent {
    return {
      type,
      details,
      priority: EVENT_PRIORITY[type],
      tick: this._tick,
      timestamp: Date.now(),
    } as GameEvent;
  }

  bpName(blueprintId: number): string {
    return getBlueprint(blueprintId)?.name ?? 'Unknown';
  }

  // --- Entity meta (names, titles, ownership, etc.) ---

  getEntityMeta(eid: number, key: MetaKey): string | undefined {
    return this.entityMeta.get(eid)?.get(key);
  }

  setEntityMeta(eid: number, key: MetaKey, value: string): void {
    const bucket = this.entityMeta.get(eid);
    const oldValue = bucket?.get(key);
    if (oldValue === value) return;

    if (value === '') {
      if (!bucket) return;
      bucket.delete(key);
      if (bucket.size === 0) this.entityMeta.delete(eid);
    } else {
      if (bucket) bucket.set(key, value);
      else this.entityMeta.set(eid, new Map([[key, value]]));
    }

    const pos = this.entities.position.get(eid);
    if (!pos) return;
    for (const [otherEid, otherSlot] of this.players) {
      const otherPos = this.entities.position.get(otherEid);
      if (!otherPos) continue;
      if (Math.abs(pos.tileX - otherPos.tileX) > INTEREST_RANGE ||
          Math.abs(pos.tileY - otherPos.tileY) > INTEREST_RANGE) continue;
      otherSlot.connection.onEntityMeta(otherEid, eid, key, value);
      this.emitEvent(otherEid, this.makeEvent('entity_meta_changed', {
        entityId: eid, key, oldValue, newValue: value,
      }));
    }
    // Observers near the renamed entity also see the new nameplate. No
    // entity_meta_changed event — that's a point-to-point narration channel
    // observers don't subscribe to.
    for (const slot of this.observers.values()) {
      if (Math.abs(pos.tileX - slot.focusX) > INTEREST_RANGE ||
          Math.abs(pos.tileY - slot.focusY) > INTEREST_RANGE) continue;
      slot.connection.onEntityMeta(0, eid, key, value);
    }
  }

  // --- Player lifecycle ---

  addPlayer(connection: PlayerConnection): number {
    const bp = getBlueprint(BlueprintType.Player)!;
    const eid = this.entities.create();

    let sx = SPAWN_X + this.nextSpawnOffset();
    let sy = SPAWN_Y + this.nextSpawnOffset();
    for (let attempts = 0; attempts < 20; attempts++) {
      if (this.map.isWalkable(sx, sy) && !this.occupancy.isOccupied(sx, sy)) break;
      sx = SPAWN_X + this.nextSpawnOffset();
      sy = SPAWN_Y + this.nextSpawnOffset();
    }

    this.entities.position.set(eid, { tileX: sx, tileY: sy });
    this.entities.direction.set(eid, { dir: Direction.S });
    this.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    this.entities.currentAction.set(eid, { actionType: ActionType.Idle });
    this.entities.health.set(eid, { currentHp: bp.maxHp ?? 100, maxHp: bp.maxHp ?? 100 });
    this.entities.blueprint.set(eid, { blueprintId: BlueprintType.Player, variant: 0 });
    this.entities.statusEffects.set(eid, { effects: 0 });
    this.entities.speed.set(eid, bp.speed ?? 3);
    this.occupancy.set(sx, sy, eid);

    this.inventoryMgr.create(eid, MAX_PLAYER_WEIGHT);
    this.inventoryMgr.addItem(eid, BlueprintType.Wood, 2);
    this.inventoryMgr.addItem(eid, BlueprintType.Rock, 1);

    // No default name — each caller decides via setEntityMeta so the change
    // broadcasts to nearby players and emits entity_meta_changed.

    const slot: PlayerSlot = {
      entityId: eid,
      connection,
      knownEntities: new Set(),
      sentChunks: new Set(),
      playerFlags: new Set(),
      pendingAction: null,
    };
    this.players.set(eid, slot);

    // Send nearby chunks, then initial state
    const needed = getNeededChunks(sx, sy);
    for (const [cx, cy] of needed) {
      connection.onChunkNeeded(cx, cy, this);
      slot.sentChunks.add(chunkKey(cx, cy));
    }
    connection.onInitialState(eid, this);

    // Other nearby players learn about this entity via broadcastTick's
    // "entered" detection on the next tick — that path triggers the full-state
    // + sendMetaFor emission. No pre-seeding of knownEntities.

    this.log.info('player joined', {
      entityId: eid,
      connectionType: connection.constructor.name,
      tileX: sx,
      tileY: sy,
    });

    return eid;
  }

  removePlayer(entityId: number): void {
    const pos = this.entities.position.get(entityId);
    if (pos) this.occupancy.clear(pos.tileX, pos.tileY, entityId);
    this.entities.destroy(entityId);
    clearMoveTarget(entityId, this);
    this.pendingActions.delete(entityId);
    this.inventoryMgr.destroy(entityId);
    this.entityMeta.delete(entityId);
    this.players.delete(entityId);
    this.log.info('player disconnected', { entityId });
  }

  // --- Observer lifecycle ---

  /** Register a passive viewer at `(focusX, focusY)`. Streams initial
   *  chunks synchronously then calls `connection.onInitialState(0, this)`.
   *  Entities in interest range arrive on the first tick via the same
   *  `entered` channel players use. Returns the observer id used for
   *  `setObserverFocus` / `removeObserver`. */
  addObserver(connection: PlayerConnection, focusX: number, focusY: number): number {
    const observerId = this.nextObserverId--;
    const slot: ObserverSlot = {
      observerId, connection, focusX, focusY,
      knownEntities: new Set(), sentChunks: new Set(),
    };
    this.observers.set(observerId, slot);

    for (const [cx, cy] of getNeededChunks(focusX, focusY)) {
      connection.onChunkNeeded(cx, cy, this);
      slot.sentChunks.add(chunkKey(cx, cy));
    }
    // Sentinel entityId=0: observer impls treat this as "no player entity";
    // they send seed + env only, no inventory, no entity-by-id reads.
    connection.onInitialState(0, this);

    this.log.info('observer joined', {
      observerId, focusX, focusY,
      connectionType: connection.constructor.name,
    });
    return observerId;
  }

  removeObserver(observerId: number): void {
    if (!this.observers.delete(observerId)) return;
    this.log.info('observer left', { observerId });
  }

  /** Move an observer's interest center. Chunks for the new focus stream
   *  on the next tick via the same path players walk through. */
  setObserverFocus(observerId: number, focusX: number, focusY: number): void {
    const slot = this.observers.get(observerId);
    if (!slot) return;
    slot.focusX = focusX;
    slot.focusY = focusY;
  }

  setAction(entityId: number, action: DecodedAction): void {
    const slot = this.players.get(entityId);
    if (slot) slot.pendingAction = action;
  }

  // --- Tick ---

  runTick(): void {
    this._tick++;
    const t = this.telemetry;

    // 0. Process player respawns
    for (const [eid, respawnTick] of this.playerRespawnTimers) {
      if (this._tick >= respawnTick) {
        this.respawnPlayer(eid);
        this.playerRespawnTimers.delete(eid);
      }
    }

    // 1. Process pending actions
    t.beginPhase('actions');
    for (const [eid, slot] of this.players) {
      const action = slot.pendingAction;
      if (!action) continue;
      slot.pendingAction = null;
      processAction(this, eid, slot, action);
    }
    t.endPhase('actions');

    // 2. Critter AI
    t.beginPhase('critterAI');
    const critterChanges = runCritterAI(this);
    for (const change of critterChanges) {
      const bp = this.entities.blueprint.get(change.creatureEntityId);
      const creatureName = bp ? this.bpName(bp.blueprintId) : 'Unknown';
      if (change.type === 'aggro') {
        this.emitEvent(change.targetPlayerEntityId, this.makeEvent('creature_aggro', {
          creatureEntityId: change.creatureEntityId,
          creatureName,
        }));
      } else {
        this.emitEvent(change.targetPlayerEntityId, this.makeEvent('creature_fleeing', {
          creatureEntityId: change.creatureEntityId,
          creatureName,
        }));
      }
    }
    t.endPhase('critterAI');

    // 3. World pulse — resource respawns + creature respawns + creature lifecycle.
    //    Creature lifecycle returns deaths routed through processEntityDeath
    //    so loot + death events fire through the same path as combat kills.
    t.beginPhase('worldPulse');
    runResourceRespawns(this);
    runCreatureRespawns(this);
    const lifecycleDeaths = runCreatureLifecycle(this);
    for (const d of lifecycleDeaths) {
      this.processEntityDeath(d.entityId, d.killerEntityId);
    }
    t.endPhase('worldPulse');

    // 4. Movement
    t.beginPhase('movement');
    runMovement(this);
    t.endPhase('movement');

    // 5. Resolve arrival-triggered actions (pickup, interact, transfer,
    //    trade, dialogue, use_item_at). Must run after movement so
    //    hasMoveTarget reflects post-movement state. Sits before harvest so
    //    its pathfinding→channel transition runs with the same view.
    t.beginPhase('pendingActions');
    runPendingActions(this);
    t.endPhase('pendingActions');

    // 6. Harvest (after movement so pathfinding→channel transition happens
    //    on arrival tick, not the tick after)
    t.beginPhase('harvest');
    const harvestEvents = runHarvest(this);
    for (const he of harvestEvents) {
      const slot = this.players.get(he.entityId);
      const yieldEvent = this.makeEvent('harvest_yield', {
        harvesterEntityId: he.entityId,
        blueprintId: he.yieldBlueprintId,
        resourceName: this.bpName(he.yieldBlueprintId),
        targetEntityId: he.targetEntityId,
        targetName: he.targetEntityId !== undefined ? this.bpName(BlueprintType.Tree) : undefined,
        remaining: he.remaining,
      });
      if (slot) {
        slot.connection.onInventoryChanged(he.entityId, this);
        this.emitEvent(he.entityId, yieldEvent);
        if (he.depleted && he.targetEntityId !== undefined) {
          this.emitEvent(he.entityId, this.makeEvent('resource_depleted', {
            entityId: he.targetEntityId,
            entityName: this.bpName(BlueprintType.Tree),
            tileX: 0, tileY: 0, // position already cleared by system
          }));
        }
      }
      // Visual broadcast to nearby WS clients (MCP already got the first-person event above).
      const harvesterPos = this.entities.position.get(he.entityId);
      if (harvesterPos) {
        this.broadcastEvent(harvesterPos.tileX, harvesterPos.tileY, yieldEvent);
      }
    }
    t.endPhase('harvest');

    // 7. Consumable channels
    const consumeEvents = runConsume(this);
    for (const ce of consumeEvents) {
      const slot = this.players.get(ce.entityId);
      if (slot) {
        slot.connection.onInventoryChanged(ce.entityId, this);
        this.emitEvent(ce.entityId, this.makeEvent('consume_complete', {
          blueprintId: ce.blueprintId,
          itemName: this.bpName(ce.blueprintId),
          healAmount: ce.healAmount,
          currentHp: ce.currentHp,
          maxHp: ce.maxHp,
        }));
      }
      // Spectator-visible heal puff. Broadcast on the player's current
      // tile so nearby observers see the same visual as the healer.
      const pos = this.entities.position.get(ce.entityId);
      if (pos && ce.healAmount > 0) {
        this.broadcastEvent(pos.tileX, pos.tileY, this.makeEvent('player_healed', {
          entityId: ce.entityId,
          tileX: pos.tileX,
          tileY: pos.tileY,
          healAmount: ce.healAmount,
          currentHp: ce.currentHp,
          maxHp: ce.maxHp,
        }));
      }
    }

    // 8. Combat
    t.beginPhase('combat');
    const combatResult = runCombat(this);
    // Emit combat hit events
    for (const hit of combatResult.hits) {
      const targetBp = this.entities.blueprint.get(hit.targetEntityId);
      const attackerBp = this.entities.blueprint.get(hit.attackerEntityId);
      const hitDealtEvent = this.makeEvent('combat_hit_dealt', {
        attackerEntityId: hit.attackerEntityId,
        targetEntityId: hit.targetEntityId,
        targetName: targetBp ? this.bpName(targetBp.blueprintId) : 'Unknown',
        damage: hit.damage,
        targetCurrentHp: hit.targetCurrentHp,
        targetMaxHp: hit.targetMaxHp,
      });
      if (this.players.has(hit.attackerEntityId)) {
        this.emitEvent(hit.attackerEntityId, hitDealtEvent);
      }
      // Visual broadcast to nearby WS clients (covers spectators + non-player attackers).
      const attackerPos = this.entities.position.get(hit.attackerEntityId);
      if (attackerPos) {
        this.broadcastEvent(attackerPos.tileX, attackerPos.tileY, hitDealtEvent);
      }
      if (this.players.has(hit.targetEntityId)) {
        this.emitEvent(hit.targetEntityId, this.makeEvent('combat_hit_received', {
          attackerEntityId: hit.attackerEntityId,
          attackerName: attackerBp ? this.bpName(attackerBp.blueprintId) : 'Unknown',
          damage: hit.damage,
          currentHp: hit.targetCurrentHp,
          maxHp: hit.targetMaxHp,
        }));
      }
    }
    // Notify critters of being attacked
    for (const [attackerId, state] of this.combatStates) {
      const targetState = this.critterStates.get(state.targetEntityId);
      if (targetState) {
        const change = notifyCritterAttacked(state.targetEntityId, attackerId, this);
        if (change) {
          const bp = this.entities.blueprint.get(change.creatureEntityId);
          const creatureName = bp ? this.bpName(bp.blueprintId) : 'Unknown';
          if (change.type === 'aggro') {
            this.emitEvent(change.targetPlayerEntityId, this.makeEvent('creature_aggro', {
              creatureEntityId: change.creatureEntityId, creatureName,
            }));
          } else {
            this.emitEvent(change.targetPlayerEntityId, this.makeEvent('creature_fleeing', {
              creatureEntityId: change.creatureEntityId, creatureName,
            }));
          }
        }
      }
    }
    for (const death of combatResult.deaths) {
      if (this.players.has(death.entityId)) {
        this.handlePlayerDeath(death.entityId);
      } else {
        this.processEntityDeath(death.entityId, death.killerEntityId);
      }
    }
    t.endPhase('combat');

    // 9. Broadcast
    t.beginPhase('broadcast');
    this.broadcastTick();
    t.endPhase('broadcast');

    // 9. Cleanup
    t.beginPhase('cleanup');
    this.entities.clearDirty();
    this.entities.clearDestroyed();
    this.map.clearDirtyTiles();
    t.endPhase('cleanup');

    t.tick = this._tick;
    t.entityCount = this.entities.getEntityCount();
    t.playerCount = this.players.size;
    t.endTick();
  }

  runTicks(n: number): void {
    for (let i = 0; i < n; i++) this.runTick();
  }

  private processEntityDeath(entityId: number, killerEntityId: number): void {
    const pos = this.entities.position.get(entityId);
    const bp = this.entities.blueprint.get(entityId);
    if (!pos || !bp) return;

    // Spawn loot drops and collect for event
    const drops = getLootTable(bp.blueprintId);
    const actualDrops: { blueprintId: number; name: string; quantity: number }[] = [];
    let rng = (entityId * 2654435761) >>> 0;
    for (const drop of drops) {
      if (drop.chance !== undefined) {
        rng = (rng * 1664525 + 1013904223) >>> 0;
        if ((rng >>> 0) / 0x100000000 >= drop.chance) continue;
      }
      actualDrops.push({ blueprintId: drop.blueprintId, name: this.bpName(drop.blueprintId), quantity: drop.quantity });
      for (let q = 0; q < drop.quantity; q++) {
        spawnGroundItem(this, drop.blueprintId, pos.tileX, pos.tileY);
      }
    }

    const entityName = this.bpName(bp.blueprintId);

    // Emit entity_died to killer (if player) for first-person MCP narration
    const entityDiedEvent = this.makeEvent('entity_died', {
      entityId, entityName, killerEntityId,
      drops: actualDrops, tileX: pos.tileX, tileY: pos.tileY,
    });
    if (this.players.has(killerEntityId)) {
      this.emitEvent(killerEntityId, entityDiedEvent);
    }
    // Visual broadcast to nearby WS clients (including any player-killer —
    // attacker is in range of their own kill position).
    this.broadcastEvent(pos.tileX, pos.tileY, entityDiedEvent);

    // Emit creature_died to nearby players (excluding the killer)
    const killerBp = this.entities.blueprint.get(killerEntityId);
    const killerName = killerBp ? this.bpName(killerBp.blueprintId) : 'Unknown';
    for (const [playerEid, playerSlot] of this.players) {
      if (playerEid === killerEntityId) continue;
      const playerPos = this.entities.position.get(playerEid);
      if (!playerPos) continue;
      if (Math.abs(pos.tileX - playerPos.tileX) <= INTEREST_RANGE &&
          Math.abs(pos.tileY - playerPos.tileY) <= INTEREST_RANGE) {
        this.emitEvent(playerEid, this.makeEvent('creature_died', {
          entityId, entityName, killerEntityId, killerName,
          tileX: pos.tileX, tileY: pos.tileY,
        }));
      }
    }

    // Cleanup
    this.occupancy.clear(pos.tileX, pos.tileY, entityId);
    this.critterStates.delete(entityId);
    this.combatStates.delete(entityId);
    this.clearAiTargetsOn(entityId);
    this.entities.destroy(entityId);
  }


  private handlePlayerDeath(entityId: number): void {
    // Don't re-process if already dead
    const ca = this.entities.currentAction.get(entityId);
    if (ca && ca.actionType === ActionType.Dead) return;

    const pos = this.entities.position.get(entityId);
    if (!pos) return;
    const slot = this.players.get(entityId);

    // Drop equipped items as ground entities
    const inv = this.inventoryMgr.get(entityId);
    if (inv) {
      for (const item of [...inv.items]) {
        if (item.equippedSlot) {
          this.inventoryMgr.unequip(entityId, item.equippedSlot);
          for (let q = 0; q < item.quantity; q++) {
            spawnGroundItem(this, item.blueprintId, pos.tileX, pos.tileY);
          }
          this.inventoryMgr.removeItem(entityId, item.itemId, item.quantity);
        }
      }
    }

    // Clear occupancy — corpse is walk-through
    this.occupancy.clear(pos.tileX, pos.tileY, entityId);

    // Cancel all active states
    clearMoveTarget(entityId, this);
    cancelHarvest(entityId, this);
    cancelCombat(entityId, this);
    cancelConsume(entityId, this);
    this.pendingActions.delete(entityId);

    // Set dead state
    this.entities.currentAction.set(entityId, { actionType: ActionType.Dead });
    this.entities.health.set(entityId, { currentHp: 0, maxHp: 100 });

    // Drop AI targets pointing at this player — the entity persists with
    // currentAction=Dead, so critter-ai's entities.exists() check wouldn't
    // catch it. Without this, wolves keep swinging at a corpse.
    this.clearAiTargetsOn(entityId);

    // Schedule respawn in 5 seconds (100 ticks at 20Hz)
    this.playerRespawnTimers.set(entityId, this._tick + 100);

    if (slot) {
      slot.connection.onInventoryChanged(entityId, this);
      this.emitEvent(entityId, this.makeEvent('player_died', {}));
    }
  }

  /** Clear any critter AI and combat state that was targeting `deadEntityId`.
   *  Called from the two death paths — players (handlePlayerDeath, persists)
   *  and creatures (processEntityDeath, destroyed). For destroyed entities
   *  this is redundant with critter-ai's entities.exists() check, but
   *  clearing upfront stops aggression instantly rather than next tick. */
  private clearAiTargetsOn(deadEntityId: number): void {
    for (const [cid, state] of this.critterStates) {
      if (state.targetEntityId === deadEntityId) {
        state.behavior = 'wander';
        state.targetEntityId = undefined;
        cancelCombat(cid, this);
      }
    }
    for (const [cid, state] of this.combatStates) {
      if (state.targetEntityId === deadEntityId) cancelCombat(cid, this);
    }
  }

  private respawnPlayer(entityId: number): void {
    let sx = SPAWN_X + this.nextSpawnOffset();
    let sy = SPAWN_Y + this.nextSpawnOffset();
    for (let attempts = 0; attempts < 20; attempts++) {
      if (this.map.isWalkable(sx, sy) && !this.occupancy.isOccupied(sx, sy)) break;
      sx = SPAWN_X + this.nextSpawnOffset();
      sy = SPAWN_Y + this.nextSpawnOffset();
    }

    this.entities.position.set(entityId, { tileX: sx, tileY: sy });
    this.occupancy.set(sx, sy, entityId);
    this.entities.health.set(entityId, { currentHp: 100, maxHp: 100 });
    this.entities.currentAction.set(entityId, { actionType: ActionType.Idle });

    const slot = this.players.get(entityId);
    if (slot) {
      slot.connection.onInventoryChanged(entityId, this);
      this.emitEvent(entityId, this.makeEvent('player_respawned', {
        tileX: sx, tileY: sy, currentHp: 100, maxHp: 100,
      }));
    }
  }

  private broadcastTick(): void {
    const dirty = this.entities.getDirtyEntities();
    const destroyed = this.entities.getDestroyed();

    // Collect dirty tiles once (shared across all players)
    const mapDirtyTiles: DecodedTileUpdate[] = [];
    for (const idx of this.map.dirtyTiles) {
      const tileX = idx % this.map.width;
      const tileY = Math.floor(idx / this.map.width);
      mapDirtyTiles.push({ tileX, tileY, building: this.map.buildings[idx] });
    }

    // Emit an Environment section on keyframe crossings (where the schedule
    // slope changes) or on weather changes. Day/night spans are flat so no
    // mid-span broadcast is needed; client extrapolates the minute locally.
    // Reads effectiveTick so the tickOffset feeds the time-of-day path.
    const eff = this.effectiveTick;
    const currentHour = Math.floor(gameHourFromTick(eff));
    const crossedKeyframe = currentHour !== this._lastEnvEmitHour
      && KEYFRAME_HOURS.includes(currentHour as number);
    const weatherChanged = this.weather !== this._lastEnvEmitWeather;
    // A setTickOffset call resets _lastEnvEmitHour to -1, so post-shift the
    // next broadcast emits even if the new hour is not a keyframe.
    const forcedResync = this._lastEnvEmitHour === -1;
    const envPayload = (crossedKeyframe || weatherChanged || forcedResync)
      ? { gameMinute: gameMinuteFromTick(eff), weather: this.weather }
      : undefined;
    if (envPayload) {
      this._lastEnvEmitHour = currentHour;
      this._lastEnvEmitWeather = this.weather;
    }

    for (const [eid, slot] of this.players) {
      const playerPos = this.entities.position.get(eid);
      if (!playerPos) continue;
      const delta = this.streamToTarget(
        playerPos.tileX, playerPos.tileY,
        slot.knownEntities, slot.sentChunks,
        dirty, destroyed, mapDirtyTiles, envPayload,
        slot.connection,
      );
      slot.connection.onTick(eid, this, delta);
    }
    // Observers ride the same broadcast plumbing keyed off their focus
    // point. entityId=0 is the observer-channel sentinel — observer
    // PlayerConnection impls treat it as "no player entity, you're a
    // viewer."
    for (const slot of this.observers.values()) {
      const delta = this.streamToTarget(
        slot.focusX, slot.focusY,
        slot.knownEntities, slot.sentChunks,
        dirty, destroyed, mapDirtyTiles, envPayload,
        slot.connection,
      );
      slot.connection.onTick(0, this, delta);
    }
  }

  /** Compute one viewer's TickDelta against an interest center, streaming
   *  any new chunks via `connection.onChunkNeeded` as a side effect.
   *  Shared between the player and observer broadcast loops; keeping the
   *  body in one place stops the two paths from drifting (entered/left
   *  detection, tile-update chunk filter, etc.). */
  private streamToTarget(
    centerX: number, centerY: number,
    knownEntities: Set<number>, sentChunks: Set<number>,
    dirty: ReadonlyMap<number, number>, destroyed: readonly number[],
    mapDirtyTiles: readonly DecodedTileUpdate[],
    envPayload: { gameMinute: number; weather: number } | undefined,
    connection: PlayerConnection,
  ): TickDelta {
    // Stream any unsent chunks now in range, and prune chunks no longer
    // needed so the client's re-entry triggers a fresh onChunkNeeded. The
    // client evicts at a strictly larger radius (CLIENT_EVICT_RADIUS_CHUNKS
    // = SERVER_NEEDED_RADIUS_CHUNKS + 1) so a chunk we drop here is still
    // resident on the client until it too leaves client range — see the
    // invariant in shared/src/constants.ts.
    const stillNeeded = new Set<number>();
    for (const [cx, cy] of getNeededChunks(centerX, centerY)) {
      const key = chunkKey(cx, cy);
      stillNeeded.add(key);
      if (!sentChunks.has(key)) {
        connection.onChunkNeeded(cx, cy, this);
        sentChunks.add(key);
      }
    }
    for (const key of sentChunks) {
      if (!stillNeeded.has(key)) sentChunks.delete(key);
    }

    const entered: number[] = [];
    const left: number[] = [];
    const updates: DecodedEntityUpdate[] = [];

    for (const entityId of this.entities.getAllEntities()) {
      const pos = this.entities.position.get(entityId);
      if (!pos) continue;
      const inRange = Math.abs(pos.tileX - centerX) <= INTEREST_RANGE
                   && Math.abs(pos.tileY - centerY) <= INTEREST_RANGE;

      if (inRange && !knownEntities.has(entityId)) {
        entered.push(entityId);
        knownEntities.add(entityId);
      } else if (!inRange && knownEntities.has(entityId)) {
        left.push(entityId);
        knownEntities.delete(entityId);
      }
    }

    for (const destroyedEid of destroyed) {
      if (knownEntities.has(destroyedEid)) {
        left.push(destroyedEid);
        knownEntities.delete(destroyedEid);
      }
    }

    for (const [dirtyEid, bitmask] of dirty) {
      if (knownEntities.has(dirtyEid)) {
        updates.push({ entityId: dirtyEid, components: this.entities.getDeltaComponents(dirtyEid, bitmask) });
      }
    }

    const tileUpdates = mapDirtyTiles.filter(tu => {
      const cx = Math.floor(tu.tileX / CHUNK_SIZE);
      const cy = Math.floor(tu.tileY / CHUNK_SIZE);
      return sentChunks.has(chunkKey(cx, cy));
    });

    return {
      tick: this._tick, entered, left, updated: updates, tileUpdates,
      environment: envPayload,
    };
  }

  private nextSpawnOffset(): number {
    this.spawnRng = (this.spawnRng * 1664525 + 1013904223) >>> 0;
    return (this.spawnRng % 5) - 2;
  }

  /** Chebyshev-ring search outward from (cx,cy) up to `radius`, returning the
   *  first walkable tile (optionally also unoccupied). Deterministic iteration
   *  order. Returns null if no tile qualifies within range. */
  findOpenTileNear(cx: number, cy: number, radius: number, requireUnoccupied: boolean): { x: number; y: number } | null {
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!this.map.isWalkable(x, y)) continue;
          if (requireUnoccupied && this.occupancy.isOccupied(x, y)) continue;
          return { x, y };
        }
      }
    }
    return null;
  }
}

/** Create a fully initialized world with terrain, entities, critter AI, tree resources. */
export function createDefaultWorld(seed: number): GameWorld {
  const { map, entitySpawns } = generateWorld(seed);
  const world = new GameWorld(map, seed);
  // Match createNewWorld's morning start so eval / test worlds don't boot at
  // midnight (tickOffset=0 = 00:00 = night, which triggers skeleton spawning).
  world.tickOffset = MORNING_TICK_OFFSET;

  for (const spawn of entitySpawns) {
    if (isGroundItemBlueprint(spawn.blueprint)) {
      spawnGroundItem(world, spawn.blueprint, spawn.x, spawn.y);
    } else {
      const eid = spawnCreatureEntity(world, spawn.blueprint, spawn.x, spawn.y, { variant: spawn.variant });
      if (spawn.blueprint === BlueprintType.Tree) initTreeResource(eid, world);
    }
  }
  world.entities.clearDirty();

  initCritterAI(world);
  return world;
}
