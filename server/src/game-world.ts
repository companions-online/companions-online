import { SPAWN_X, SPAWN_Y, MAP_SIZE, CHUNK_SIZE, INTEREST_RANGE } from '@shared/constants.js';
import { gameMinuteFromTick, gameHourFromTick, KEYFRAME_HOURS } from '@shared/lighting.js';
import { Direction } from '@shared/direction.js';
import { ActionType, ClientAction } from '@shared/actions.js';
import { BlueprintType, getBlueprint, blueprintToBuilding } from '@shared/blueprints.js';
import { Building } from '@shared/terrain.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { findItem } from '@shared/inventory.js';
import { numberToEquipSlot } from '@shared/inventory.js';
import { generateWorld } from '@shared/world/world-gen.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { StatusEffect } from '@shared/status-effects.js';
import type { DecodedAction, DecodedEntityUpdate, DecodedTileUpdate, DecodedActionInteract, DecodedActionPickup, DecodedActionEquip, DecodedActionUnequip, DecodedActionDrop, DecodedActionCraft, DecodedActionHarvest, DecodedActionUseItemAt, DecodedActionAttack, DecodedActionTransfer, DecodedActionDialogueSelect, DecodedActionTrade, DecodedActionUseConsumable, DecodedActionSay, DecodedActionServerCommand } from '@shared/protocol/codec.js';
import { MetaKey } from '@shared/entity-meta.js';
import { dispatchServerCommand } from './server-commands.js';
import { getDialogue } from './npc-dialogues.js';
import { getLootTable } from '@shared/loot-tables.js';
import { getRecipe } from '@shared/recipes.js';
import { EntityManager } from './ecs/entity-manager.js';
import { OccupancyGrid } from './occupancy.js';
import { InventoryManager } from './inventory-manager.js';
import type { PlayerConnection, TickDelta } from './player-connection.js';
import type { SystemState, MovementState, HarvestState, CritterState, CombatState } from './system-state.js';
import { setMoveTarget, clearMoveTarget, hasMoveTarget, runMovement } from './systems/movement.js';
import { startHarvest, cancelHarvest, isHarvesting, runHarvest } from './systems/harvest.js';
import { initCritterAI, runCritterAI, notifyCritterAttacked } from './systems/critter-ai.js';
import { startAttack, cancelCombat, isInCombat, runCombat } from './systems/combat.js';
import { startConsume, cancelConsume, isConsuming, runConsume, type ConsumableState } from './systems/consumable.js';
import { initTreeResource, runResourceRespawns } from './systems/resources.js';
import { runCreatureRespawns, runCreatureLifecycle } from './systems/creature-lifecycle.js';
import { Telemetry } from './telemetry.js';
import { EventPriority, EVENT_PRIORITY, type GameEvent } from './events.js';

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

export class GameWorld implements SystemState {
  readonly entities = new EntityManager();
  readonly occupancy: OccupancyGrid;
  readonly inventoryMgr = new InventoryManager();

  readonly players = new Map<number, PlayerSlot>();
  readonly pendingPickups = new Map<number, { targetEntityId: number }>();
  readonly pendingInteracts = new Map<number, { targetEntityId: number }>();

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

  constructor(readonly map: WorldMap, readonly seed = 0) {
    this.occupancy = new OccupancyGrid(map.width, map.height);
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

  private emitEvent(entityId: number, event: GameEvent): void {
    const slot = this.players.get(entityId);
    if (slot) slot.connection.onGameEvent(entityId, event);
  }

  /** Deliver a spectator-visible notification to every player within
   *  INTEREST_RANGE of the given tile. Routes via `onBroadcastEvent` — a
   *  channel separate from point-to-point `onGameEvent` — so MCP narration
   *  stays first-person while WS clients receive visual events for anyone
   *  nearby (including the actor themselves). Use for hit-landed,
   *  yield-popped, entity-died. Keep hit_received / item_picked_up / trades
   *  on `emitEvent`. */
  private broadcastEvent(tileX: number, tileY: number, event: GameEvent): void {
    for (const [eid, slot] of this.players) {
      const p = this.entities.position.get(eid);
      if (!p) continue;
      if (Math.abs(tileX - p.tileX) <= INTEREST_RANGE &&
          Math.abs(tileY - p.tileY) <= INTEREST_RANGE) {
        slot.connection.onBroadcastEvent(eid, event);
      }
    }
  }

  private makeEvent<T extends GameEvent['type']>(
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

  private bpName(blueprintId: number): string {
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

    this.inventoryMgr.create(eid, 50);
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

    return eid;
  }

  removePlayer(entityId: number): void {
    const pos = this.entities.position.get(entityId);
    if (pos) this.occupancy.clear(pos.tileX, pos.tileY);
    this.entities.destroy(entityId);
    clearMoveTarget(entityId, this);
    this.pendingPickups.delete(entityId);
    this.pendingInteracts.delete(entityId);
    this.inventoryMgr.destroy(entityId);
    this.entityMeta.delete(entityId);
    this.players.delete(entityId);
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
      this.processAction(eid, slot, action);
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

    // 5. Resolve arrival-triggered actions: pickups + pending interacts.
    //    Must run after movement so hasMoveTarget reflects post-movement state.
    //    Sits before harvest so its pathfinding→channel transition in the
    //    same phase group runs with the same post-movement view.
    t.beginPhase('pickups');
    for (const [eid, pending] of this.pendingPickups) {
      if (hasMoveTarget(eid, this)) continue;
      const playerPos = this.entities.position.get(eid);
      const targetPos = this.entities.position.get(pending.targetEntityId);
      if (!playerPos || !targetPos || !this.entities.exists(pending.targetEntityId)) {
        this.pendingPickups.delete(eid);
        continue;
      }
      const dist = Math.max(Math.abs(targetPos.tileX - playerPos.tileX), Math.abs(targetPos.tileY - playerPos.tileY));
      if (dist <= 1) {
        const bp = this.entities.blueprint.get(pending.targetEntityId);
        if (bp) {
          const result = this.inventoryMgr.addItem(eid, bp.blueprintId, 1);
          if (result.success) {
            this.occupancy.clear(targetPos.tileX, targetPos.tileY);
            this.entities.destroy(pending.targetEntityId);
            const slot = this.players.get(eid);
            if (slot) {
              slot.connection.onInventoryChanged(eid, this);
              this.emitEvent(eid, this.makeEvent('item_picked_up', {
                blueprintId: bp.blueprintId, itemName: this.bpName(bp.blueprintId), quantity: 1,
              }));
            }
          }
        }
      }
      this.pendingPickups.delete(eid);
    }

    // 5b. Resolve pending interacts (walk-to then interact)
    for (const [eid, pending] of this.pendingInteracts) {
      if (hasMoveTarget(eid, this)) continue;
      const playerPos = this.entities.position.get(eid);
      const targetPos = this.entities.position.get(pending.targetEntityId);
      if (!playerPos || !targetPos || !this.entities.exists(pending.targetEntityId)) {
        this.pendingInteracts.delete(eid);
        continue;
      }
      const dist = Math.max(Math.abs(targetPos.tileX - playerPos.tileX), Math.abs(targetPos.tileY - playerPos.tileY));
      if (dist <= 1) {
        const slot = this.players.get(eid);
        if (slot) this.executeInteract(eid, slot, pending.targetEntityId);
      }
      this.pendingInteracts.delete(eid);
    }
    t.endPhase('pickups');

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

  // --- Private ---

  private processAction(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    // Dead players can't act
    const ca = this.entities.currentAction.get(eid);
    if (ca && ca.actionType === ActionType.Dead) return;

    // Say is instant and must not cancel other actions
    if (action.action === ClientAction.Say) {
      this.handleSay(eid, slot, action);
      return;
    }

    // Server commands (/nick, etc.) are instant and must not cancel other actions
    if (action.action === ClientAction.ServerCommand) {
      this.handleServerCommand(eid, slot, action);
      return;
    }

    this.cancelConflictingStates(eid, action);

    switch (action.action) {
      case ClientAction.MoveTo:    this.handleMoveTo(eid, action); break;
      case ClientAction.Cancel:    this.handleCancel(eid); break;
      case ClientAction.Pickup:    this.handlePickup(eid, slot, action); break;
      case ClientAction.Equip:     this.handleEquip(eid, slot, action); break;
      case ClientAction.Unequip:   this.handleUnequip(eid, slot, action); break;
      case ClientAction.Drop:      this.handleDrop(eid, slot, action); break;
      case ClientAction.Craft:     this.handleCraft(eid, slot, action); break;
      case ClientAction.Harvest:   this.handleHarvest(eid, action); break;
      case ClientAction.UseItemAt: {
        const a = action as DecodedActionUseItemAt;
        this.handleUseItemAt(eid, slot, a.itemId, a.tileX, a.tileY);
        break;
      }
      case ClientAction.Attack:          this.handleAttack(eid, action); break;
      case ClientAction.Interact:        this.handleInteractAction(eid, slot, action); break;
      case ClientAction.Transfer:        this.handleTransfer(eid, slot, action); break;
      case ClientAction.DialogueSelect:  this.handleDialogueSelect(eid, slot, action); break;
      case ClientAction.Trade:           this.handleTrade(eid, slot, action); break;
      case ClientAction.UseConsumable:   this.handleUseConsumable(eid, slot, action); break;
    }
  }

  private cancelConflictingStates(eid: number, action: DecodedAction): void {
    if (action.action !== ClientAction.Harvest && isHarvesting(eid, this)) {
      this.emitEvent(eid, this.makeEvent('action_interrupted', {
        interruptedAction: 'harvesting', reason: 'new action',
      }));
      cancelHarvest(eid, this);
    }
    if (action.action !== ClientAction.Attack && isInCombat(eid, this)) {
      this.emitEvent(eid, this.makeEvent('action_interrupted', {
        interruptedAction: 'attacking', reason: 'new action',
      }));
      cancelCombat(eid, this);
    }
    if (action.action !== ClientAction.Pickup) {
      this.pendingPickups.delete(eid);
    }
    if (action.action !== ClientAction.Interact) {
      this.pendingInteracts.delete(eid);
    }
    if (action.action !== ClientAction.UseConsumable && isConsuming(eid, this)) {
      this.emitEvent(eid, this.makeEvent('action_interrupted', {
        interruptedAction: 'consuming', reason: 'new action',
      }));
      cancelConsume(eid, this);
    }
  }

  private handleMoveTo(eid: number, action: DecodedAction): void {
    const a = action as { action: number; tileX: number; tileY: number };
    if (this.map.isWalkable(a.tileX, a.tileY)) {
      setMoveTarget(eid, a.tileX, a.tileY, this);
    }
  }

  private handleCancel(eid: number): void {
    clearMoveTarget(eid, this);
  }

  private handlePickup(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionPickup;
    const targetPos = this.entities.position.get(a.entityId);
    const playerPos = this.entities.position.get(eid);
    if (!targetPos || !playerPos) return;

    const bp = this.entities.blueprint.get(a.entityId);
    const bpDef = bp ? getBlueprint(bp.blueprintId) : undefined;
    if (!bpDef || (bpDef.category !== 'item' && bpDef.category !== 'resource' && bpDef.category !== 'placeable')) return;

    const dist = Math.max(Math.abs(targetPos.tileX - playerPos.tileX), Math.abs(targetPos.tileY - playerPos.tileY));
    if (dist <= 1) {
      const result = this.inventoryMgr.addItem(eid, bp!.blueprintId, 1);
      if (result.success) {
        this.occupancy.clear(targetPos.tileX, targetPos.tileY);
        this.entities.destroy(a.entityId);
        slot.connection.onInventoryChanged(eid, this);
        this.emitEvent(eid, this.makeEvent('item_picked_up', {
          blueprintId: bp!.blueprintId, itemName: this.bpName(bp!.blueprintId), quantity: 1,
        }));
      }
    } else {
      this.pendingPickups.set(eid, { targetEntityId: a.entityId });
      setMoveTarget(eid, targetPos.tileX, targetPos.tileY, this);
    }
  }

  private handleEquip(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionEquip;
    if (this.inventoryMgr.equip(eid, a.itemId, a.quantity)) {
      slot.connection.onInventoryChanged(eid, this);
    }
  }

  private handleUnequip(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionUnequip;
    const eqSlot = numberToEquipSlot(a.slot);
    if (eqSlot && this.inventoryMgr.unequip(eid, eqSlot)) {
      slot.connection.onInventoryChanged(eid, this);
    }
  }

  private handleDrop(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionDrop;
    const dropped = this.inventoryMgr.drop(eid, a.itemId, a.quantity);
    if (dropped) {
      const playerPos = this.entities.position.get(eid);
      if (playerPos) {
        const groundEid = this.entities.create();
        this.entities.position.set(groundEid, { tileX: playerPos.tileX, tileY: playerPos.tileY });
        this.entities.blueprint.set(groundEid, { blueprintId: dropped.blueprintId, variant: 0 });
      }
      slot.connection.onInventoryChanged(eid, this);
    }
  }

  private handleCraft(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionCraft;
    if (this.inventoryMgr.craft(eid, a.recipeId)) {
      slot.connection.onInventoryChanged(eid, this);
      const recipe = getRecipe(a.recipeId);
      if (recipe) {
        const event = this.makeEvent('craft_complete', {
          crafterEntityId: eid,
          blueprintId: recipe.output.blueprintId,
          itemName: this.bpName(recipe.output.blueprintId),
          quantity: recipe.output.quantity,
        });
        this.emitEvent(eid, event);
        const pos = this.entities.position.get(eid);
        if (pos) this.broadcastEvent(pos.tileX, pos.tileY, event);
      }
    }
  }

  private handleHarvest(eid: number, action: DecodedAction): void {
    const a = action as DecodedActionHarvest;
    clearMoveTarget(eid, this);
    startHarvest(eid, a.tileX, a.tileY, this);
  }

  private handleUseConsumable(eid: number, _slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionUseConsumable;
    clearMoveTarget(eid, this);
    startConsume(eid, a.itemId, this);
  }

  private handleAttack(eid: number, action: DecodedAction): void {
    const a = action as DecodedActionAttack;
    clearMoveTarget(eid, this);
    startAttack(eid, a.entityId, this);
  }

  private handleSay(eid: number, _slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionSay;
    const msg = a.message.slice(0, 200);
    const pos = this.entities.position.get(eid);
    if (!pos) return;
    const senderName = this.getEntityMeta(eid, MetaKey.Name) ?? 'Player';
    for (const [otherEid, otherSlot] of this.players) {
      const otherPos = this.entities.position.get(otherEid);
      if (!otherPos) continue;
      if (Math.abs(pos.tileX - otherPos.tileX) <= INTEREST_RANGE &&
          Math.abs(pos.tileY - otherPos.tileY) <= INTEREST_RANGE) {
        otherSlot.connection.onChatMessage(otherEid, eid, msg);
        this.emitEvent(otherEid, this.makeEvent('player_say', {
          senderEntityId: eid, senderName, message: msg,
        }));
      }
    }
  }

  private handleServerCommand(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionServerCommand;
    const result = dispatchServerCommand(this, eid, slot, a.command, a.parameter);
    if (!result.ok) {
      slot.connection.onChatMessage(eid, 0, `[system] ${result.error}`);
    }
  }

    private handleInteractAction(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionInteract;
    const targetPos = this.entities.position.get(a.entityId);
    const playerPos = this.entities.position.get(eid);
    if (!targetPos || !playerPos) return;

    const dist = Math.max(Math.abs(targetPos.tileX - playerPos.tileX),
                          Math.abs(targetPos.tileY - playerPos.tileY));
    if (dist <= 1) {
      this.executeInteract(eid, slot, a.entityId);
    } else {
      this.pendingInteracts.set(eid, { targetEntityId: a.entityId });
      setMoveTarget(eid, targetPos.tileX, targetPos.tileY, this);
    }
  }

  private handleTransfer(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionTransfer;
    const containerPos = this.entities.position.get(a.containerId);
    const playerPos = this.entities.position.get(eid);
    if (!containerPos || !playerPos) return;

    const dist = Math.max(Math.abs(containerPos.tileX - playerPos.tileX),
                          Math.abs(containerPos.tileY - playerPos.tileY));
    if (dist > 1) return;

    const bp = this.entities.blueprint.get(a.containerId);
    if (!bp || bp.blueprintId !== BlueprintType.StorageChest) return;

    const ok = a.direction === 0
      ? this.inventoryMgr.transferToContainer(eid, a.containerId, a.itemId, a.quantity)
      : this.inventoryMgr.transferFromContainer(eid, a.containerId, a.itemId, a.quantity);
    if (ok) {
      slot.connection.onInventoryChanged(eid, this);
      slot.connection.onContainerOpen(eid, a.containerId, this);
    }
  }

  private handleDialogueSelect(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionDialogueSelect;
    const npcPos = this.entities.position.get(a.npcEntityId);
    const playerPos = this.entities.position.get(eid);
    if (!npcPos || !playerPos) return;

    const dist = Math.max(Math.abs(npcPos.tileX - playerPos.tileX), Math.abs(npcPos.tileY - playerPos.tileY));
    if (dist > 1) return;

    const npcBp = this.entities.blueprint.get(a.npcEntityId);
    if (!npcBp) return;

    const dialogue = getDialogue(npcBp.blueprintId);
    if (!dialogue) return;

    const option = dialogue.options.find(o => o.optionId === a.optionId);
    if (!option) return;

    if (option.type === 'talk' && option.response) {
      slot.connection.onDialogueOpen(eid, a.npcEntityId, {
        greeting: option.response,
        options: dialogue.options,
      });
    } else if (option.type === 'trade' && option.trades) {
      slot.connection.onDialogueOpen(eid, a.npcEntityId, {
        greeting: dialogue.greeting,
        options: [{ ...option }],
      });
    }
  }

  private handleTrade(eid: number, slot: PlayerSlot, action: DecodedAction): void {
    const a = action as DecodedActionTrade;
    const npcPos = this.entities.position.get(a.npcEntityId);
    const playerPos = this.entities.position.get(eid);
    if (!npcPos || !playerPos) return;

    const dist = Math.max(Math.abs(npcPos.tileX - playerPos.tileX), Math.abs(npcPos.tileY - playerPos.tileY));
    if (dist > 1) return;

    const npcBp = this.entities.blueprint.get(a.npcEntityId);
    if (!npcBp) return;

    const dialogue = getDialogue(npcBp.blueprintId);
    if (!dialogue) return;

    // Find the trade across all options
    let trade: { tradeId: number; givesBlueprint: number; givesQty: number; wantsBlueprint: number; wantsQty: number } | undefined;
    for (const opt of dialogue.options) {
      if (opt.trades) trade = opt.trades.find(t => t.tradeId === a.tradeId);
      if (trade) break;
    }
    if (!trade) return;

    // Hermit first-time free gift check
    if (npcBp.blueprintId === BlueprintType.Hermit && trade.wantsBlueprint === 0) {
      if (slot.playerFlags.has('hermit_gift')) return; // already claimed
      this.inventoryMgr.addItem(eid, trade.givesBlueprint, trade.givesQty);
      slot.playerFlags.add('hermit_gift');
      slot.connection.onInventoryChanged(eid, this);
      this.emitEvent(eid, this.makeEvent('trade_complete', {
        npcEntityId: a.npcEntityId, npcName: this.bpName(npcBp.blueprintId),
        gaveBlueprintId: 0, gaveName: '', gaveQuantity: 0,
        receivedBlueprintId: trade.givesBlueprint, receivedName: this.bpName(trade.givesBlueprint),
        receivedQuantity: trade.givesQty,
      }));
      return;
    }

    // Normal trade: check player has the required items
    if (trade.wantsBlueprint > 0) {
      const inv = this.inventoryMgr.get(eid);
      if (!inv) return;
      let have = 0;
      for (const item of inv.items) {
        if (item.blueprintId === trade.wantsBlueprint) have += item.quantity;
      }
      if (have < trade.wantsQty) return;
      // Consume wants, give gives
      let remaining = trade.wantsQty;
      for (let i = inv.items.length - 1; i >= 0 && remaining > 0; i--) {
        if (inv.items[i].blueprintId === trade.wantsBlueprint) {
          const take = Math.min(inv.items[i].quantity, remaining);
          this.inventoryMgr.removeItem(eid, inv.items[i].itemId, take);
          remaining -= take;
        }
      }
      this.inventoryMgr.addItem(eid, trade.givesBlueprint, trade.givesQty);
      slot.connection.onInventoryChanged(eid, this);
      this.emitEvent(eid, this.makeEvent('trade_complete', {
        npcEntityId: a.npcEntityId, npcName: this.bpName(npcBp.blueprintId),
        gaveBlueprintId: trade.wantsBlueprint, gaveName: this.bpName(trade.wantsBlueprint),
        gaveQuantity: trade.wantsQty,
        receivedBlueprintId: trade.givesBlueprint, receivedName: this.bpName(trade.givesBlueprint),
        receivedQuantity: trade.givesQty,
      }));
    }
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
        const groundEid = this.entities.create();
        this.entities.position.set(groundEid, { tileX: pos.tileX, tileY: pos.tileY });
        this.entities.blueprint.set(groundEid, { blueprintId: drop.blueprintId, variant: 0 });
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
    this.occupancy.clear(pos.tileX, pos.tileY);
    this.critterStates.delete(entityId);
    this.combatStates.delete(entityId);
    this.clearAiTargetsOn(entityId);
    this.entities.destroy(entityId);
  }

  private handleUseItemAt(eid: number, slot: PlayerSlot, itemId: number, tileX: number, tileY: number): void {
    const inv = this.inventoryMgr.get(eid);
    if (!inv) return;
    const item = findItem(inv, itemId);
    if (!item) return;

    const bp = getBlueprint(item.blueprintId);
    if (!bp) return;

    // Cooking
    if (item.blueprintId === BlueprintType.RawFish || item.blueprintId === BlueprintType.RawMeat) {
      const playerPos = this.entities.position.get(eid);
      if (!playerPos) return;
      const campfireEid = this.occupancy.get(tileX, tileY);
      if (!campfireEid) return;
      const campBp = this.entities.blueprint.get(campfireEid);
      if (!campBp || campBp.blueprintId !== BlueprintType.Campfire) return;
      if (Math.max(Math.abs(playerPos.tileX - tileX), Math.abs(playerPos.tileY - tileY)) > 1) return;

      const outputBp = item.blueprintId === BlueprintType.RawFish ? BlueprintType.CookedFish : BlueprintType.CookedMeat;
      this.inventoryMgr.removeItem(eid, itemId, 1);
      this.inventoryMgr.addItem(eid, outputBp, 1);
      slot.connection.onInventoryChanged(eid, this);
      this.emitEvent(eid, this.makeEvent('item_cooked', {
        inputBlueprintId: item.blueprintId, inputName: this.bpName(item.blueprintId),
        outputBlueprintId: outputBp, outputName: this.bpName(outputBp),
      }));
      return;
    }

    // Placing
    if (bp.category === 'placeable') {
      if (!this.map.isWalkable(tileX, tileY) || this.occupancy.isOccupied(tileX, tileY)) return;
      const playerPos = this.entities.position.get(eid);
      if (!playerPos) return;
      if (Math.max(Math.abs(playerPos.tileX - tileX), Math.abs(playerPos.tileY - tileY)) > 2) return;

      const buildingType = blueprintToBuilding(item.blueprintId);
      if (buildingType !== null) {
        // Static building tile (walls) — write to map layer
        if (this.map.getBuilding(tileX, tileY) !== Building.None) return;
        this.inventoryMgr.removeItem(eid, itemId, 1);
        this.map.setBuilding(tileX, tileY, buildingType);
      } else {
        // Doors must stand in a wall gap — floor underneath, walls on opposite
        // sides. Relied on for both elevation flattening (floor corners are
        // flattened in Pass 3) and facing detection (two-wall neighbors).
        if (item.blueprintId === BlueprintType.WoodenDoor) {
          const floor = this.map.getBuilding(tileX, tileY);
          if (floor !== Building.WoodenFloor && floor !== Building.StoneFloor) return;
          const wallAt = (x: number, y: number) =>
            this.map.inBounds(x, y) && this.map.getBuilding(x, y) === Building.Wall;
          const ns = wallAt(tileX, tileY - 1) && wallAt(tileX, tileY + 1);
          const ew = wallAt(tileX - 1, tileY) && wallAt(tileX + 1, tileY);
          if (!ns && !ew) return;
        }
        // Interactive placeables (campfire, door, chest) — remain entities
        this.inventoryMgr.removeItem(eid, itemId, 1);
        const newEid = this.entities.create();
        this.entities.position.set(newEid, { tileX, tileY });
        this.entities.blueprint.set(newEid, { blueprintId: item.blueprintId, variant: 0 });
        this.entities.statusEffects.set(newEid, { effects: 0 });
        if (bp.maxHp) this.entities.health.set(newEid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
        if (bp.collides) this.occupancy.set(tileX, tileY, newEid);
        if (item.blueprintId === BlueprintType.StorageChest) this.inventoryMgr.create(newEid, 100);
      }
      slot.connection.onInventoryChanged(eid, this);
      this.emitEvent(eid, this.makeEvent('building_placed', {
        blueprintId: item.blueprintId, itemName: this.bpName(item.blueprintId),
        tileX, tileY,
      }));
    }
  }

  private executeInteract(eid: number, slot: PlayerSlot, targetEntityId: number): void {
    const bp = this.entities.blueprint.get(targetEntityId);
    if (!bp) return;
    switch (bp.blueprintId) {
      case BlueprintType.WoodenDoor:
        this.toggleDoor(targetEntityId);
        break;
      case BlueprintType.StorageChest:
        slot.connection.onContainerOpen(eid, targetEntityId, this);
        break;
      case BlueprintType.Hermit:
      case BlueprintType.Trader:
      case BlueprintType.Wanderer: {
        const npcBp = this.entities.blueprint.get(targetEntityId);
        if (npcBp) {
          const dialogue = getDialogue(npcBp.blueprintId);
          if (dialogue) slot.connection.onDialogueOpen(eid, targetEntityId, dialogue);
        }
        break;
      }
    }
  }

  private toggleDoor(doorEntityId: number): void {
    const pos = this.entities.position.get(doorEntityId);
    const effects = this.entities.statusEffects.get(doorEntityId);
    if (!pos || !effects) return;

    const isOpen = (effects.effects & StatusEffect.Open) !== 0;
    if (isOpen) {
      this.occupancy.set(pos.tileX, pos.tileY, doorEntityId);
      this.entities.statusEffects.set(doorEntityId, { effects: effects.effects & ~StatusEffect.Open });
    } else {
      this.occupancy.clear(pos.tileX, pos.tileY);
      this.entities.statusEffects.set(doorEntityId, { effects: effects.effects | StatusEffect.Open });
    }
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
            const groundEid = this.entities.create();
            this.entities.position.set(groundEid, { tileX: pos.tileX, tileY: pos.tileY });
            this.entities.blueprint.set(groundEid, { blueprintId: item.blueprintId, variant: 0 });
          }
          this.inventoryMgr.removeItem(entityId, item.itemId, item.quantity);
        }
      }
    }

    // Clear occupancy — corpse is walk-through
    this.occupancy.clear(pos.tileX, pos.tileY);

    // Cancel all active states
    clearMoveTarget(entityId, this);
    cancelHarvest(entityId, this);
    cancelCombat(entityId, this);
    cancelConsume(entityId, this);
    this.pendingPickups.delete(entityId);
    this.pendingInteracts.delete(entityId);

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

      // Stream any unsent chunks now in range
      const needed = getNeededChunks(playerPos.tileX, playerPos.tileY);
      for (const [cx, cy] of needed) {
        const key = chunkKey(cx, cy);
        if (!slot.sentChunks.has(key)) {
          slot.connection.onChunkNeeded(cx, cy, this);
          slot.sentChunks.add(key);
        }
      }

      const entered: number[] = [];
      const left: number[] = [];
      const updates: DecodedEntityUpdate[] = [];

      for (const entityId of this.entities.getAllEntities()) {
        const pos = this.entities.position.get(entityId);
        if (!pos) continue;
        const inRange = Math.abs(pos.tileX - playerPos.tileX) <= INTEREST_RANGE
                     && Math.abs(pos.tileY - playerPos.tileY) <= INTEREST_RANGE;

        if (inRange && !slot.knownEntities.has(entityId)) {
          entered.push(entityId);
          slot.knownEntities.add(entityId);
        } else if (!inRange && slot.knownEntities.has(entityId)) {
          left.push(entityId);
          slot.knownEntities.delete(entityId);
        }
      }

      for (const destroyedEid of destroyed) {
        if (slot.knownEntities.has(destroyedEid)) {
          left.push(destroyedEid);
          slot.knownEntities.delete(destroyedEid);
        }
      }

      for (const [dirtyEid, bitmask] of dirty) {
        if (slot.knownEntities.has(dirtyEid)) {
          updates.push({ entityId: dirtyEid, components: this.entities.getDeltaComponents(dirtyEid, bitmask) });
        }
      }

      // Filter tile updates to chunks this player has received
      const tileUpdates = mapDirtyTiles.filter(tu => {
        const cx = Math.floor(tu.tileX / CHUNK_SIZE);
        const cy = Math.floor(tu.tileY / CHUNK_SIZE);
        return slot.sentChunks.has(chunkKey(cx, cy));
      });

      const delta: TickDelta = {
        tick: this._tick, entered, left, updated: updates, tileUpdates,
        environment: envPayload,
      };
      slot.connection.onTick(eid, this, delta);
    }
  }

  private nextSpawnOffset(): number {
    this.spawnRng = (this.spawnRng * 1664525 + 1013904223) >>> 0;
    return (this.spawnRng % 5) - 2;
  }

  // --- Generic entity spawn helpers (used by worldgen + /spawn command) ---

  /** Spawn a creature/NPC/tree entity with the full component shape used by
   *  `createDefaultWorld`. Sets occupancy unconditionally (callers ensure the
   *  tile is free). Does NOT init critter-AI state — call
   *  `initCritterForEntity` separately when appropriate. */
  spawnCreatureEntity(blueprintType: BlueprintType, tileX: number, tileY: number, variant = 0): number {
    const bp = getBlueprint(blueprintType);
    if (!bp) throw new Error(`unknown blueprint ${blueprintType}`);
    const eid = this.entities.create();
    this.entities.position.set(eid, { tileX, tileY });
    this.entities.direction.set(eid, { dir: Direction.S });
    this.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    this.entities.currentAction.set(eid, { actionType: ActionType.Idle });
    if (bp.maxHp) this.entities.health.set(eid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
    this.entities.blueprint.set(eid, { blueprintId: blueprintType, variant });
    this.entities.statusEffects.set(eid, { effects: 0 });
    if (bp.speed) this.entities.speed.set(eid, bp.speed);
    this.occupancy.set(tileX, tileY, eid);
    return eid;
  }

  /** Spawn a ground-item entity: position + blueprint only, no statusEffects
   *  (that absence is what distinguishes ground items from placed entities).
   *  No occupancy. Mirrors the drop handler's shape. */
  spawnGroundItem(blueprintType: BlueprintType, tileX: number, tileY: number): number {
    const eid = this.entities.create();
    this.entities.position.set(eid, { tileX, tileY });
    this.entities.blueprint.set(eid, { blueprintId: blueprintType, variant: 0 });
    return eid;
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

  for (const spawn of entitySpawns) {
    if (!getBlueprint(spawn.blueprint)) continue;
    const eid = world.spawnCreatureEntity(spawn.blueprint, spawn.x, spawn.y, spawn.variant);
    if (spawn.blueprint === BlueprintType.Tree) initTreeResource(eid, world);
  }
  world.entities.clearDirty();

  initCritterAI(world);
  return world;
}
