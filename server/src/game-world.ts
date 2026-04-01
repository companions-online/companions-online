import { SPAWN_X, SPAWN_Y, MAP_SIZE, CHUNK_SIZE, INTEREST_RANGE } from '@shared/constants.js';
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
import type { DecodedAction, DecodedEntityUpdate, DecodedTileUpdate, DecodedActionInteract, DecodedActionPickup, DecodedActionEquip, DecodedActionUnequip, DecodedActionDrop, DecodedActionCraft, DecodedActionHarvest, DecodedActionUseItemAt, DecodedActionAttack, DecodedActionTransfer, DecodedActionDialogueSelect, DecodedActionTrade } from '@shared/protocol/codec.js';
import { getDialogue } from './npc-dialogues.js';
import { getLootTable } from '@shared/loot-tables.js';
import { EntityManager } from './ecs/entity-manager.js';
import { OccupancyGrid } from './occupancy.js';
import { InventoryManager } from './inventory-manager.js';
import type { PlayerConnection, TickDelta } from './player-connection.js';
import type { SystemState, MovementState, HarvestState, CritterState, CombatState } from './system-state.js';
import { setMoveTarget, clearMoveTarget, hasMoveTarget, runMovement } from './systems/movement.js';
import { startHarvest, cancelHarvest, isHarvesting, runHarvest } from './systems/harvest.js';
import { initCritterAI, runCritterAI, notifyCritterAttacked } from './systems/critter-ai.js';
import { startAttack, cancelCombat, isInCombat, runCombat } from './systems/combat.js';
import { initTreeResource, runRespawns } from './systems/resources.js';
import { Telemetry } from './telemetry.js';

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
  readonly critterStates = new Map<number, CritterState>();
  readonly treeResources = new Map<number, number>();
  readonly respawnQueue: { tick: number; blueprintType: number }[] = [];

  readonly telemetry = new Telemetry();

  private _tick = 0;
  private spawnRng: number;
  respawnRng: number;

  constructor(readonly map: WorldMap, seed = 0) {
    this.occupancy = new OccupancyGrid(map.width, map.height);
    this.spawnRng = seed;
    this.respawnRng = seed + 12345;
  }

  get currentTick(): number { return this._tick; }

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
    this.entities.blueprintId.set(eid, { blueprintId: BlueprintType.Player });
    this.entities.statusEffects.set(eid, { effects: 0 });
    this.entities.speed.set(eid, bp.speed ?? 3);
    this.occupancy.set(sx, sy, eid);

    this.inventoryMgr.create(eid, 50);
    this.inventoryMgr.addItem(eid, BlueprintType.Wood, 2);
    this.inventoryMgr.addItem(eid, BlueprintType.Rock, 1);

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

    // Notify other players about this new entity
    for (const [otherEid, otherSlot] of this.players) {
      if (otherEid === eid) continue;
      const otherPos = this.entities.position.get(otherEid);
      if (!otherPos) continue;
      if (Math.abs(sx - otherPos.tileX) <= INTEREST_RANGE &&
          Math.abs(sy - otherPos.tileY) <= INTEREST_RANGE) {
        otherSlot.knownEntities.add(eid);
        // The next tick's onTick will handle sending the full state via 'entered'
      }
    }

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
    runCritterAI(this);
    t.endPhase('critterAI');

    // 3. Harvest
    t.beginPhase('harvest');
    const harvestYielded = runHarvest(this);
    for (const eid of harvestYielded) {
      const slot = this.players.get(eid);
      if (slot) slot.connection.onInventoryChanged(eid, this);
    }
    t.endPhase('harvest');

    // 4. Respawns
    t.beginPhase('respawns');
    runRespawns(this);
    t.endPhase('respawns');

    // 5. Movement
    t.beginPhase('movement');
    runMovement(this);
    t.endPhase('movement');

    // 6. Combat
    t.beginPhase('combat');
    const deaths = runCombat(this);
    for (const [attackerId, state] of this.combatStates) {
      const targetState = this.critterStates.get(state.targetEntityId);
      if (targetState) {
        notifyCritterAttacked(state.targetEntityId, attackerId, this);
      }
    }
    for (const death of deaths) {
      this.processEntityDeath(death.entityId, death.killerEntityId);
    }
    t.endPhase('combat');

    // 7. Pickups
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
        const bp = this.entities.blueprintId.get(pending.targetEntityId);
        if (bp) {
          const result = this.inventoryMgr.addItem(eid, bp.blueprintId, 1);
          if (result.success) {
            this.occupancy.clear(targetPos.tileX, targetPos.tileY);
            this.entities.destroy(pending.targetEntityId);
            const slot = this.players.get(eid);
            if (slot) slot.connection.onInventoryChanged(eid, this);
          }
        }
      }
      this.pendingPickups.delete(eid);
    }

    // 7b. Resolve pending interacts (walk-to then interact)
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

    // 8. Broadcast
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
    // Cancel harvest on any non-harvest action
    if (action.action !== ClientAction.Harvest && isHarvesting(eid, this)) {
      cancelHarvest(eid, this);
    }
    // Cancel combat on any non-attack action
    if (action.action !== ClientAction.Attack && isInCombat(eid, this)) {
      cancelCombat(eid, this);
    }
    // Cancel pending pickup on any non-pickup action
    if (action.action !== ClientAction.Pickup) {
      this.pendingPickups.delete(eid);
    }
    // Cancel pending interact on any non-interact action
    if (action.action !== ClientAction.Interact) {
      this.pendingInteracts.delete(eid);
    }

    if (action.action === ClientAction.MoveTo) {
      const a = action as { action: number; tileX: number; tileY: number };
      if (this.map.isWalkable(a.tileX, a.tileY)) {
        setMoveTarget(eid, a.tileX, a.tileY, this);
      }
    } else if (action.action === ClientAction.Cancel) {
      clearMoveTarget(eid, this);
    } else if (action.action === ClientAction.Pickup) {
      const a = action as DecodedActionPickup;
      const targetPos = this.entities.position.get(a.entityId);
      const playerPos = this.entities.position.get(eid);
      if (targetPos && playerPos) {
        const bp = this.entities.blueprintId.get(a.entityId);
        const bpDef = bp ? getBlueprint(bp.blueprintId) : undefined;
        if (bpDef && (bpDef.category === 'item' || bpDef.category === 'resource' || bpDef.category === 'placeable')) {
          const dist = Math.max(Math.abs(targetPos.tileX - playerPos.tileX), Math.abs(targetPos.tileY - playerPos.tileY));
          if (dist <= 1) {
            const result = this.inventoryMgr.addItem(eid, bp!.blueprintId, 1);
            if (result.success) {
              this.occupancy.clear(targetPos.tileX, targetPos.tileY);
              this.entities.destroy(a.entityId);
              slot.connection.onInventoryChanged(eid, this);
            }
          } else {
            this.pendingPickups.set(eid, { targetEntityId: a.entityId });
            setMoveTarget(eid, targetPos.tileX, targetPos.tileY, this);
          }
        }
      }
    } else if (action.action === ClientAction.Equip) {
      const a = action as DecodedActionEquip;
      if (this.inventoryMgr.equip(eid, a.itemId)) {
        slot.connection.onInventoryChanged(eid, this);
      }
    } else if (action.action === ClientAction.Unequip) {
      const a = action as DecodedActionUnequip;
      const eqSlot = numberToEquipSlot(a.slot);
      if (eqSlot && this.inventoryMgr.unequip(eid, eqSlot)) {
        slot.connection.onInventoryChanged(eid, this);
      }
    } else if (action.action === ClientAction.Drop) {
      const a = action as DecodedActionDrop;
      const dropped = this.inventoryMgr.drop(eid, a.itemId);
      if (dropped) {
        const playerPos = this.entities.position.get(eid);
        if (playerPos) {
          const groundEid = this.entities.create();
          this.entities.position.set(groundEid, { tileX: playerPos.tileX, tileY: playerPos.tileY });
          this.entities.blueprintId.set(groundEid, { blueprintId: dropped.blueprintId });
        }
        slot.connection.onInventoryChanged(eid, this);
      }
    } else if (action.action === ClientAction.Craft) {
      const a = action as DecodedActionCraft;
      if (this.inventoryMgr.craft(eid, a.recipeId)) {
        slot.connection.onInventoryChanged(eid, this);
      }
    } else if (action.action === ClientAction.Harvest) {
      const a = action as DecodedActionHarvest;
      clearMoveTarget(eid, this);
      startHarvest(eid, a.tileX, a.tileY, this);
    } else if (action.action === ClientAction.UseItemAt) {
      const a = action as DecodedActionUseItemAt;
      this.handleUseItemAt(eid, slot, a.itemId, a.tileX, a.tileY);
    } else if (action.action === ClientAction.Attack) {
      const a = action as DecodedActionAttack;
      clearMoveTarget(eid, this);
      startAttack(eid, a.entityId, this);
    } else if (action.action === ClientAction.Interact) {
      const a = action as DecodedActionInteract;
      const targetPos = this.entities.position.get(a.entityId);
      const playerPos = this.entities.position.get(eid);
      if (targetPos && playerPos) {
        const dist = Math.max(Math.abs(targetPos.tileX - playerPos.tileX),
                              Math.abs(targetPos.tileY - playerPos.tileY));
        if (dist <= 1) {
          this.executeInteract(eid, slot, a.entityId);
        } else {
          this.pendingInteracts.set(eid, { targetEntityId: a.entityId });
          setMoveTarget(eid, targetPos.tileX, targetPos.tileY, this);
        }
      }
    } else if (action.action === ClientAction.Transfer) {
      const a = action as DecodedActionTransfer;
      const containerPos = this.entities.position.get(a.containerId);
      const playerPos = this.entities.position.get(eid);
      if (containerPos && playerPos) {
        const dist = Math.max(Math.abs(containerPos.tileX - playerPos.tileX),
                              Math.abs(containerPos.tileY - playerPos.tileY));
        if (dist <= 1) {
          const bp = this.entities.blueprintId.get(a.containerId);
          if (bp && bp.blueprintId === BlueprintType.StorageChest) {
            let ok: boolean;
            if (a.direction === 0) {
              ok = this.inventoryMgr.transferToContainer(eid, a.containerId, a.itemId);
            } else {
              ok = this.inventoryMgr.transferFromContainer(eid, a.containerId, a.itemId);
            }
            if (ok) {
              slot.connection.onInventoryChanged(eid, this);
              slot.connection.onContainerOpen(eid, a.containerId, this);
            }
          }
        }
      }
    } else if (action.action === ClientAction.DialogueSelect) {
      const a = action as DecodedActionDialogueSelect;
      const npcPos = this.entities.position.get(a.npcEntityId);
      const playerPos = this.entities.position.get(eid);
      if (npcPos && playerPos) {
        const dist = Math.max(Math.abs(npcPos.tileX - playerPos.tileX), Math.abs(npcPos.tileY - playerPos.tileY));
        if (dist <= 1) {
          const npcBp = this.entities.blueprintId.get(a.npcEntityId);
          if (npcBp) {
            const dialogue = getDialogue(npcBp.blueprintId);
            if (dialogue) {
              const option = dialogue.options.find(o => o.optionId === a.optionId);
              if (option) {
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
            }
          }
        }
      }
    } else if (action.action === ClientAction.Trade) {
      const a = action as DecodedActionTrade;
      const npcPos = this.entities.position.get(a.npcEntityId);
      const playerPos = this.entities.position.get(eid);
      if (npcPos && playerPos) {
        const dist = Math.max(Math.abs(npcPos.tileX - playerPos.tileX), Math.abs(npcPos.tileY - playerPos.tileY));
        if (dist <= 1) {
          const npcBp = this.entities.blueprintId.get(a.npcEntityId);
          if (npcBp) {
            const dialogue = getDialogue(npcBp.blueprintId);
            if (dialogue) {
              // Find the trade across all options
              let trade: { tradeId: number; givesBlueprint: number; givesQty: number; wantsBlueprint: number; wantsQty: number } | undefined;
              for (const opt of dialogue.options) {
                if (opt.trades) trade = opt.trades.find(t => t.tradeId === a.tradeId);
                if (trade) break;
              }
              if (trade) {
                // Hermit first-time free gift check
                if (npcBp.blueprintId === BlueprintType.Hermit && trade.wantsBlueprint === 0) {
                  if (slot.playerFlags.has('hermit_gift')) return; // already claimed
                  this.inventoryMgr.addItem(eid, trade.givesBlueprint, trade.givesQty);
                  slot.playerFlags.add('hermit_gift');
                  slot.connection.onInventoryChanged(eid, this);
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
                }
              }
            }
          }
        }
      }
    }
  }

  private processEntityDeath(entityId: number, _killerEntityId: number): void {
    const pos = this.entities.position.get(entityId);
    const bp = this.entities.blueprintId.get(entityId);
    if (!pos || !bp) return;

    // Spawn loot drops
    const drops = getLootTable(bp.blueprintId);
    let rng = (entityId * 2654435761) >>> 0;
    for (const drop of drops) {
      if (drop.chance !== undefined) {
        rng = (rng * 1664525 + 1013904223) >>> 0;
        if ((rng >>> 0) / 0x100000000 >= drop.chance) continue;
      }
      for (let q = 0; q < drop.quantity; q++) {
        const groundEid = this.entities.create();
        this.entities.position.set(groundEid, { tileX: pos.tileX, tileY: pos.tileY });
        this.entities.blueprintId.set(groundEid, { blueprintId: drop.blueprintId });
      }
    }

    // Cleanup
    this.occupancy.clear(pos.tileX, pos.tileY);
    this.critterStates.delete(entityId);
    this.combatStates.delete(entityId);
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
      const campBp = this.entities.blueprintId.get(campfireEid);
      if (!campBp || campBp.blueprintId !== BlueprintType.Campfire) return;
      if (Math.max(Math.abs(playerPos.tileX - tileX), Math.abs(playerPos.tileY - tileY)) > 1) return;

      const outputBp = item.blueprintId === BlueprintType.RawFish ? BlueprintType.CookedFish : BlueprintType.CookedMeat;
      this.inventoryMgr.removeItem(eid, itemId, 1);
      this.inventoryMgr.addItem(eid, outputBp, 1);
      slot.connection.onInventoryChanged(eid, this);
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
        // Interactive placeables (campfire, door, chest) — remain entities
        this.inventoryMgr.removeItem(eid, itemId, 1);
        const newEid = this.entities.create();
        this.entities.position.set(newEid, { tileX, tileY });
        this.entities.blueprintId.set(newEid, { blueprintId: item.blueprintId });
        this.entities.statusEffects.set(newEid, { effects: 0 });
        if (bp.maxHp) this.entities.health.set(newEid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
        if (bp.collides) this.occupancy.set(tileX, tileY, newEid);
        if (item.blueprintId === BlueprintType.StorageChest) this.inventoryMgr.create(newEid, 100);
      }
      slot.connection.onInventoryChanged(eid, this);
    }
  }

  private executeInteract(eid: number, slot: PlayerSlot, targetEntityId: number): void {
    const bp = this.entities.blueprintId.get(targetEntityId);
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
        const npcBp = this.entities.blueprintId.get(targetEntityId);
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

      const delta: TickDelta = { tick: this._tick, entered, left, updated: updates, tileUpdates };
      slot.connection.onTick(eid, this, delta);
    }
  }

  private nextSpawnOffset(): number {
    this.spawnRng = (this.spawnRng * 1664525 + 1013904223) >>> 0;
    return (this.spawnRng % 5) - 2;
  }
}

/** Create a fully initialized world with terrain, entities, critter AI, tree resources. */
export function createDefaultWorld(seed: number): GameWorld {
  const { map, entitySpawns } = generateWorld(seed);
  const world = new GameWorld(map, seed);

  for (const spawn of entitySpawns) {
    const bp = getBlueprint(spawn.blueprint);
    if (!bp) continue;
    const eid = world.entities.create();
    world.entities.position.set(eid, { tileX: spawn.x, tileY: spawn.y });
    world.entities.direction.set(eid, { dir: Direction.S });
    world.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
    if (bp.maxHp) world.entities.health.set(eid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
    world.entities.blueprintId.set(eid, { blueprintId: spawn.blueprint });
    world.entities.statusEffects.set(eid, { effects: 0 });
    if (bp.speed) world.entities.speed.set(eid, bp.speed);
    world.occupancy.set(spawn.x, spawn.y, eid);
    if (spawn.blueprint === BlueprintType.Tree) initTreeResource(eid, world);
  }
  world.entities.clearDirty();

  initCritterAI(world);
  return world;
}
