import { SPAWN_X, SPAWN_Y, MAP_SIZE, INTEREST_RANGE } from '@shared/constants.js';
import { Direction } from '@shared/direction.js';
import { ActionType, ClientAction } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { findItem } from '@shared/inventory.js';
import { numberToEquipSlot } from '@shared/inventory.js';
import { generateWorld } from '@shared/world/world-gen.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { DecodedAction, DecodedEntityUpdate, DecodedActionPickup, DecodedActionEquip, DecodedActionUnequip, DecodedActionDrop, DecodedActionCraft, DecodedActionHarvest, DecodedActionUseItemAt } from '@shared/protocol/codec.js';
import { EntityManager } from './ecs/entity-manager.js';
import { OccupancyGrid } from './occupancy.js';
import { InventoryManager } from './inventory-manager.js';
import type { PlayerConnection, TickDelta } from './player-connection.js';
import type { SystemState, MovementState, HarvestState, CritterState } from './system-state.js';
import { setMoveTarget, clearMoveTarget, hasMoveTarget, runMovement } from './systems/movement.js';
import { startHarvest, cancelHarvest, isHarvesting, runHarvest } from './systems/harvest.js';
import { initCritterAI, runCritterAI } from './systems/critter-ai.js';
import { initTreeResource, runRespawns } from './systems/resources.js';

export interface PlayerSlot {
  entityId: number;
  connection: PlayerConnection;
  knownEntities: Set<number>;
  pendingAction: DecodedAction | null;
}

export class GameWorld implements SystemState {
  readonly entities = new EntityManager();
  readonly occupancy: OccupancyGrid;
  readonly inventoryMgr = new InventoryManager();

  readonly players = new Map<number, PlayerSlot>();
  readonly pendingPickups = new Map<number, { targetEntityId: number }>();

  readonly moveStates = new Map<number, MovementState>();
  readonly harvestStates = new Map<number, HarvestState>();
  readonly critterStates = new Map<number, CritterState>();
  readonly treeResources = new Map<number, number>();
  readonly respawnQueue: { tick: number; blueprintType: number }[] = [];

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
      pendingAction: null,
    };
    this.players.set(eid, slot);

    // Send initial state
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

    // 1. Process pending actions
    for (const [eid, slot] of this.players) {
      const action = slot.pendingAction;
      if (!action) continue;
      slot.pendingAction = null;
      this.processAction(eid, slot, action);
    }

    // 2. Critter AI
    runCritterAI(this);

    // 2.5 Run harvest
    const harvestYielded = runHarvest(this);
    for (const eid of harvestYielded) {
      const slot = this.players.get(eid);
      if (slot) slot.connection.onInventoryChanged(eid, this);
    }

    // 2.6 Run respawns
    runRespawns(this);

    // 3. Run movement
    runMovement(this);

    // 3.5 Resolve pending pickups
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

    // 4. Per-player visibility + broadcast
    this.broadcastTick();

    // 5. Clear
    this.entities.clearDirty();
    this.entities.clearDestroyed();
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
    // Cancel pending pickup on any non-pickup action
    if (action.action !== ClientAction.Pickup) {
      this.pendingPickups.delete(eid);
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
        if (bpDef && (bpDef.category === 'item' || bpDef.category === 'resource')) {
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
    }
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

      this.inventoryMgr.removeItem(eid, itemId, 1);

      const newEid = this.entities.create();
      this.entities.position.set(newEid, { tileX, tileY });
      this.entities.blueprintId.set(newEid, { blueprintId: item.blueprintId });
      if (bp.maxHp) this.entities.health.set(newEid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
      if (bp.collides) this.occupancy.set(tileX, tileY, newEid);

      slot.connection.onInventoryChanged(eid, this);
    }
  }

  private broadcastTick(): void {
    const dirty = this.entities.getDirtyEntities();
    const destroyed = this.entities.getDestroyed();

    for (const [eid, slot] of this.players) {
      const playerPos = this.entities.position.get(eid);
      if (!playerPos) continue;

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

      const delta: TickDelta = { tick: this._tick, entered, left, updated: updates };
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
