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
import { startHarvest, runHarvest, cancelHarvest, isHarvesting, resetHarvest } from '../server/src/systems/harvest.js';
import { initTreeResource, getTreeResource, resetResources, runRespawns } from '../server/src/systems/resources.js';
import { resetMovement, runMovement } from '../server/src/systems/movement.js';
import {
  encodeAction, decodeClientMessage, ClientAction,
} from '@shared/index.js';

const SIZE = MAP_SIZE;
let em: EntityManager;
let occ: OccupancyGrid;
let inv: InventoryManager;
let map: WorldMap;

function createPlayer(x: number, y: number): number {
  const eid = em.create();
  em.position.set(eid, { tileX: x, tileY: y });
  em.direction.set(eid, { dir: Direction.S });
  em.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  em.currentAction.set(eid, { actionType: ActionType.Idle });
  em.health.set(eid, { currentHp: 100, maxHp: 100 });
  em.blueprintId.set(eid, { blueprintId: BlueprintType.Player });
  em.statusEffects.set(eid, { effects: 0 });
  em.speed.set(eid, 20); // fast for tests
  occ.set(x, y, eid);
  inv.create(eid, 100);
  return eid;
}

function createTree(x: number, y: number): number {
  const eid = em.create();
  em.position.set(eid, { tileX: x, tileY: y });
  em.blueprintId.set(eid, { blueprintId: BlueprintType.Tree });
  em.health.set(eid, { currentHp: 50, maxHp: 50 });
  em.statusEffects.set(eid, { effects: 0 });
  occ.set(x, y, eid);
  initTreeResource(eid);
  return eid;
}

function setRockTerrain(x: number, y: number): void {
  map.setTerrain(x, y, Terrain.Rock);
}

beforeEach(() => {
  em = new EntityManager();
  occ = new OccupancyGrid(SIZE, SIZE);
  inv = new InventoryManager();
  map = new WorldMap(SIZE, SIZE); // all grass by default
  resetHarvest();
  resetMovement();
  resetResources();
});

describe('Harvest system', () => {
  it('harvests tree when adjacent: yields wood after tick cost', () => {
    const player = createPlayer(10, 10);
    const tree = createTree(11, 10);
    em.clearDirty();

    const ok = startHarvest(player, 11, 10, em, map, occ, inv);
    expect(ok).toBe(true);
    expect(isHarvesting(player)).toBe(true);

    // Run 10 ticks (bare-hand tree harvest = 10 ticks)
    for (let i = 0; i < 10; i++) {
      runHarvest(em, map, occ, inv);
    }

    const playerInv = inv.get(player)!;
    expect(playerInv.items.some(i => i.blueprintId === BlueprintType.Wood)).toBe(true);
  });

  it('harvests tree faster with axe', () => {
    const player = createPlayer(10, 10);
    createTree(11, 10);
    inv.addItem(player, BlueprintType.Axe, 1);
    const axeItem = inv.get(player)!.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    inv.equip(player, axeItem.itemId);
    em.clearDirty();

    startHarvest(player, 11, 10, em, map, occ, inv);

    // Should yield in 4 ticks with axe
    for (let i = 0; i < 4; i++) {
      runHarvest(em, map, occ, inv);
    }

    const wood = inv.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood);
    expect(wood).toBeDefined();
    expect(wood!.quantity).toBe(1);
  });

  it('tree depletes after 5 harvests and is destroyed', () => {
    const player = createPlayer(10, 10);
    const tree = createTree(11, 10);
    em.clearDirty();

    startHarvest(player, 11, 10, em, map, occ, inv);

    // 5 cycles × 10 ticks = 50 ticks for bare-hand
    for (let i = 0; i < 50; i++) {
      runHarvest(em, map, occ, inv);
    }

    const wood = inv.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood);
    expect(wood?.quantity).toBe(5);
    expect(em.exists(tree)).toBe(false);
    expect(occ.get(11, 10)).toBe(0);
  });

  it('cancel harvest sets idle', () => {
    const player = createPlayer(10, 10);
    createTree(11, 10);
    em.clearDirty();

    startHarvest(player, 11, 10, em, map, occ, inv);
    cancelHarvest(player, em);

    expect(isHarvesting(player)).toBe(false);
    expect(em.currentAction.get(player)?.actionType).toBe(ActionType.Idle);
  });

  it('mines hill rock for rock', () => {
    const player = createPlayer(10, 10);
    setRockTerrain(11, 10);
    em.clearDirty();

    startHarvest(player, 11, 10, em, map, occ, inv);

    for (let i = 0; i < 10; i++) {
      runHarvest(em, map, occ, inv);
    }

    const rock = inv.get(player)!.items.find(i => i.blueprintId === BlueprintType.Rock);
    expect(rock).toBeDefined();
  });

  it('pathfinds to tree if not adjacent', () => {
    const player = createPlayer(5, 10);
    createTree(11, 10);
    em.clearDirty();

    const ok = startHarvest(player, 11, 10, em, map, occ, inv);
    expect(ok).toBe(true);

    // Run movement ticks to get there
    for (let i = 0; i < 30; i++) {
      runHarvest(em, map, occ, inv);
      runMovement(em, map, occ);
      em.clearDirty();
    }

    // Should have started channeling
    // Run more harvest ticks for actual yield
    for (let i = 0; i < 15; i++) {
      runHarvest(em, map, occ, inv);
    }

    const wood = inv.get(player)!.items.find(i => i.blueprintId === BlueprintType.Wood);
    expect(wood).toBeDefined();
  });
});

describe('Tree respawning', () => {
  it('depleted trees respawn after delay', () => {
    const player = createPlayer(10, 10);
    createTree(11, 10);
    em.clearDirty();

    startHarvest(player, 11, 10, em, map, occ, inv);

    // Deplete tree (5 × 10 = 50 ticks)
    for (let i = 0; i < 50; i++) {
      runHarvest(em, map, occ, inv);
    }

    const countBefore = em.getEntityCount();

    // Run respawns for 601 ticks (respawn at 600)
    for (let tick = 1; tick <= 601; tick++) {
      runRespawns(tick, em, map, occ);
    }

    // A new tree should have spawned somewhere
    expect(em.getEntityCount()).toBeGreaterThan(countBefore);
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
