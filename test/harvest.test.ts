import { describe, it, expect, beforeEach } from 'vitest';
import { EntityManager } from '../server/src/ecs/entity-manager.js';
import { OccupancyGrid } from '../server/src/occupancy.js';
import { InventoryManager } from '../server/src/inventory-manager.js';
import { WorldMap } from '@shared/world/world-map.js';
import { Terrain } from '@shared/terrain.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { MAP_SIZE } from '@shared/constants.js';
import { startHarvest, runHarvest, cancelHarvest, isHarvesting } from '../server/src/systems/harvest.js';
import { initTreeResource, runRespawns } from '../server/src/systems/resources.js';
import { runMovement } from '../server/src/systems/movement.js';
import type { SystemState } from '../server/src/system-state.js';
import {
  encodeAction, decodeClientMessage, ClientAction,
} from '@shared/index.js';

function makeWorld(): SystemState {
  return {
    map: new WorldMap(MAP_SIZE, MAP_SIZE),
    entities: new EntityManager(),
    occupancy: new OccupancyGrid(MAP_SIZE, MAP_SIZE),
    inventoryMgr: new InventoryManager(),
    moveStates: new Map(),
    harvestStates: new Map(),
    combatStates: new Map(),
    consumableStates: new Map(),
    critterStates: new Map(),
    treeResources: new Map(),
    respawnQueue: [],
    players: new Map(),
    respawnRng: 12345,
    currentTick: 0,
  };
}

function createPlayer(w: SystemState, x: number, y: number): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.direction.set(eid, { dir: Direction.S });
  w.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  w.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  w.entities.health.set(eid, { currentHp: 100, maxHp: 100 });
  w.entities.blueprintId.set(eid, { blueprintId: BlueprintType.Player });
  w.entities.statusEffects.set(eid, { effects: 0 });
  w.entities.speed.set(eid, 20);
  w.occupancy.set(x, y, eid);
  w.inventoryMgr.create(eid, 100);
  return eid;
}

function createTree(w: SystemState, x: number, y: number): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.blueprintId.set(eid, { blueprintId: BlueprintType.Tree });
  w.entities.health.set(eid, { currentHp: 50, maxHp: 50 });
  w.entities.statusEffects.set(eid, { effects: 0 });
  w.occupancy.set(x, y, eid);
  initTreeResource(eid, w);
  return eid;
}

let w: SystemState;

beforeEach(() => {
  w = makeWorld();
});

describe('Harvest system', () => {
  it('harvests tree when adjacent: yields wood after tick cost', () => {
    const player = createPlayer(w, 10, 10);
    createTree(w, 11, 10);
    w.entities.clearDirty();

    expect(startHarvest(player, 11, 10, w)).toBe(true);
    expect(isHarvesting(player, w)).toBe(true);

    for (let i = 0; i < 10; i++) runHarvest(w);

    const inv = w.inventoryMgr.get(player)!;
    expect(inv.items.some(i => i.blueprintId === BlueprintType.Wood)).toBe(true);
  });

  it('harvests tree faster with axe', () => {
    const player = createPlayer(w, 10, 10);
    createTree(w, 11, 10);
    w.inventoryMgr.addItem(player, BlueprintType.Axe, 1);
    const axeItem = w.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    w.inventoryMgr.equip(player, axeItem.itemId);
    w.entities.clearDirty();

    startHarvest(player, 11, 10, w);
    for (let i = 0; i < 4; i++) runHarvest(w);

    const wood = w.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood);
    expect(wood).toBeDefined();
    expect(wood!.quantity).toBe(1);
  });

  it('tree depletes after 5 harvests and is destroyed', () => {
    const player = createPlayer(w, 10, 10);
    const tree = createTree(w, 11, 10);
    w.entities.clearDirty();

    startHarvest(player, 11, 10, w);
    for (let i = 0; i < 50; i++) runHarvest(w);

    const wood = w.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood);
    expect(wood?.quantity).toBe(5);
    expect(w.entities.exists(tree)).toBe(false);
    expect(w.occupancy.get(11, 10)).toBe(0);
  });

  it('cancel harvest sets idle', () => {
    const player = createPlayer(w, 10, 10);
    createTree(w, 11, 10);
    w.entities.clearDirty();

    startHarvest(player, 11, 10, w);
    cancelHarvest(player, w);

    expect(isHarvesting(player, w)).toBe(false);
    expect(w.entities.currentAction.get(player)?.actionType).toBe(ActionType.Idle);
  });

  it('mines rock terrain for rock', () => {
    const player = createPlayer(w, 10, 10);
    w.map.setTerrain(11, 10, Terrain.Rock);
    w.entities.clearDirty();

    startHarvest(player, 11, 10, w);
    for (let i = 0; i < 10; i++) runHarvest(w);

    const rock = w.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Rock);
    expect(rock).toBeDefined();
  });

  it('pathfinds to tree if not adjacent', () => {
    const player = createPlayer(w, 5, 10);
    createTree(w, 11, 10);
    w.entities.clearDirty();

    expect(startHarvest(player, 11, 10, w)).toBe(true);

    for (let i = 0; i < 30; i++) {
      runHarvest(w);
      runMovement(w);
      w.entities.clearDirty();
    }

    for (let i = 0; i < 15; i++) runHarvest(w);

    const wood = w.inventoryMgr.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood);
    expect(wood).toBeDefined();
  });
});

describe('Tree respawning', () => {
  it('depleted trees respawn after delay', () => {
    const player = createPlayer(w, 10, 10);
    createTree(w, 11, 10);
    w.entities.clearDirty();

    startHarvest(player, 11, 10, w);
    for (let i = 0; i < 50; i++) runHarvest(w);

    const countBefore = w.entities.getEntityCount();

    for (let tick = 1; tick <= 601; tick++) {
      (w as any).currentTick = tick;
      runRespawns(w);
    }

    expect(w.entities.getEntityCount()).toBeGreaterThan(countBefore);
  });
});

describe('Protocol: Harvest + UseItemAt', () => {
  it('round-trips Harvest', () => {
    const buf = encodeAction({ action: ClientAction.Harvest, tileX: 20, tileY: 30 });
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.Harvest);
      expect((msg.data as any).tileX).toBe(20);
      expect((msg.data as any).tileY).toBe(30);
    }
  });

  it('round-trips UseItemAt', () => {
    const buf = encodeAction({ action: ClientAction.UseItemAt, itemId: 5, tileX: 10, tileY: 15 });
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.UseItemAt);
      expect((msg.data as any).itemId).toBe(5);
      expect((msg.data as any).tileX).toBe(10);
      expect((msg.data as any).tileY).toBe(15);
    }
  });
});
