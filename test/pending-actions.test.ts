/**
 * Tests for the unified `pendingActions` walk-to-then-act queue.
 *
 *   Base cases — each migrated handler arrives + executes when dist > range:
 *     pickup, interact (door + chest), transfer, dialogue_select, trade,
 *     use_item_at (place on walkable, place on river, cook).
 *   Already-adjacent fast path — same actions complete in one tick without
 *     scheduling a pending entry.
 *   Interrupt cases:
 *     target destroyed mid-walk           -> target_missing rejection
 *     path becomes unreachable mid-walk   -> no_path rejection
 *     player issues new action mid-walk   -> action_interrupted event
 *     player dies mid-walk                -> pendingAction cleared
 *     entity target moves (re-aim)        -> player follows + arrives
 *     inventory fills mid-walk            -> inventory_full on arrival
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameWorld } from '../server/src/game-world.js';
import { HeadlessConnection } from '../server/src/connections/headless-connection.js';
import { WorldMap } from '@shared/world/world-map.js';
import { Terrain, Building } from '@shared/terrain.js';
import { Direction } from '@shared/direction.js';
import { ActionType, ClientAction } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { StatusEffect } from '@shared/status-effects.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { MAP_SIZE } from '@shared/constants.js';

// -- Helpers (mirror movement-edge-cases.test.ts) -----------------------------

function makeWorld(): GameWorld {
  const map = new WorldMap(MAP_SIZE, MAP_SIZE);
  return new GameWorld(map, 1);
}

function placePlayerAt(w: GameWorld, conn: HeadlessConnection, x: number, y: number): number {
  const eid = w.addPlayer(conn);
  const old = w.entities.position.get(eid)!;
  w.occupancy.clear(old.tileX, old.tileY, eid);
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.occupancy.set(x, y, eid);
  return eid;
}

/** Drop a ground item entity (position + blueprint, no occupancy). */
function placeGroundItem(w: GameWorld, x: number, y: number, bp = BlueprintType.Wood): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.blueprint.set(eid, { blueprintId: bp, variant: 0 });
  return eid;
}

/** Place a structure entity (door/chest/campfire/NPC). Sets occupancy if the
 *  blueprint collides. */
function placeStructure(w: GameWorld, bp: BlueprintType, x: number, y: number, openDoor = false): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.direction.set(eid, { dir: Direction.S });
  w.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  w.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  w.entities.health.set(eid, { currentHp: 30, maxHp: 30 });
  w.entities.blueprint.set(eid, { blueprintId: bp, variant: 0 });
  w.entities.statusEffects.set(eid, { effects: openDoor ? StatusEffect.Placed | StatusEffect.Open : StatusEffect.Placed });
  // Doors clear occupancy when open; closed doors and other structures occupy.
  if (!(bp === BlueprintType.WoodenDoor && openDoor)) {
    w.occupancy.set(x, y, eid);
  }
  return eid;
}

// ---------------------------------------------------------------------------
//   Base cases
// ---------------------------------------------------------------------------

describe('pendingActions — base cases (walk-to-act arrives and executes)', () => {
  let w: GameWorld;
  let conn: HeadlessConnection;
  let pid: number;

  beforeEach(() => {
    w = makeWorld();
    conn = new HeadlessConnection();
    pid = placePlayerAt(w, conn, 10, 10);
    conn.rejections.length = 0;
    conn.gameEvents.length = 0;
  });

  it('pickup: player walks to a Wood item and picks it up', () => {
    const itemId = placeGroundItem(w, 15, 10, BlueprintType.Wood);
    const beforeWood = countItem(w, pid, BlueprintType.Wood);

    w.setAction(pid, { action: ClientAction.Pickup, entityId: itemId } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    expect(w.entities.exists(itemId)).toBe(false);
    expect(countItem(w, pid, BlueprintType.Wood)).toBe(beforeWood + 1);
    expect(w.pendingActions.has(pid)).toBe(false);
  });

  it('interact (door): player walks to a closed door and toggles it open', () => {
    const door = placeStructure(w, BlueprintType.WoodenDoor, 15, 10);

    w.setAction(pid, { action: ClientAction.Interact, entityId: door } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    const eff = w.entities.statusEffects.get(door)!;
    expect(eff.effects & StatusEffect.Open).toBe(StatusEffect.Open);
    expect(w.pendingActions.has(pid)).toBe(false);
  });

  it('interact (chest): player walks to a chest and onContainerOpen fires', () => {
    const chest = placeStructure(w, BlueprintType.StorageChest, 15, 10);
    w.inventoryMgr.create(chest, 100);

    w.setAction(pid, { action: ClientAction.Interact, entityId: chest } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    const opened = conn.events.find(e => e.type === 'containerOpen' && e.containerEntityId === chest);
    expect(opened).toBeTruthy();
  });

  it('transfer: player walks to a chest and pulls Wood out', () => {
    const chest = placeStructure(w, BlueprintType.StorageChest, 15, 10);
    w.inventoryMgr.create(chest, 100);
    const addResult = w.inventoryMgr.addItem(chest, BlueprintType.Wood, 3);
    expect(addResult.success).toBe(true);
    const itemId = addResult.itemId!;
    const beforeWood = countItem(w, pid, BlueprintType.Wood);

    w.setAction(pid, {
      action: ClientAction.Transfer,
      itemId, containerId: chest, quantity: 3, direction: 1,
    } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    expect(countItem(w, pid, BlueprintType.Wood)).toBe(beforeWood + 3);
  });

  it('dialogue_select: player walks to Hermit and the talk option opens dialogue', () => {
    const hermit = placeStructure(w, BlueprintType.Hermit, 15, 10);

    w.setAction(pid, {
      action: ClientAction.DialogueSelect,
      npcEntityId: hermit, optionId: 1, // Hermit "Tell me about this place" → talk
    } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    const dlgEvent = conn.events.find(e => e.type === 'dialogueOpen' && e.npcEntityId === hermit);
    expect(dlgEvent).toBeTruthy();
  });

  it('trade: player walks to Hermit and the free Wood gift completes', () => {
    const hermit = placeStructure(w, BlueprintType.Hermit, 15, 10);
    const beforeWood = countItem(w, pid, BlueprintType.Wood);

    w.setAction(pid, {
      action: ClientAction.Trade,
      npcEntityId: hermit, tradeId: 1, // Hermit free Wood gift (wantsBlueprint: 0)
    } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    expect(countItem(w, pid, BlueprintType.Wood)).toBe(beforeWood + 2);
  });

  it('use_item_at (placement on walkable tile): walks within 2, places WoodenFloor', () => {
    const inv = w.inventoryMgr.get(pid)!;
    const addResult = w.inventoryMgr.addItem(pid, BlueprintType.WoodenFloor, 1);
    const itemId = addResult.itemId!;

    w.setAction(pid, {
      action: ClientAction.UseItemAt,
      itemId, tileX: 15, tileY: 10,
    } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    expect(w.map.getBuilding(15, 10)).toBe(Building.WoodenFloor);
    expect(inv.items.find(i => i.itemId === itemId)).toBeUndefined();
  });

  it('use_item_at (river-floor case): WoodenFloor placed on a River tile from 5 tiles away', () => {
    // The original LLM scenario: target tile is unwalkable (River), so the
    // path must route the player to a walkable adjacent tile within range 2.
    w.map.setTerrain(15, 10, Terrain.River);
    const addResult = w.inventoryMgr.addItem(pid, BlueprintType.WoodenFloor, 1);
    const itemId = addResult.itemId!;

    w.setAction(pid, {
      action: ClientAction.UseItemAt,
      itemId, tileX: 15, tileY: 10,
    } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    expect(w.map.getBuilding(15, 10)).toBe(Building.WoodenFloor);

    // Player ended up on a walkable tile within range 2 of the river tile —
    // pathfinding picked an adjacent landing spot since the target itself is
    // unwalkable.
    const ppos = w.entities.position.get(pid)!;
    const dist = Math.max(Math.abs(ppos.tileX - 15), Math.abs(ppos.tileY - 10));
    expect(dist).toBeLessThanOrEqual(2);
    expect(w.map.isWalkable(ppos.tileX, ppos.tileY)).toBe(true);
  });

  it('use_item_at (cook): walks to a campfire and cooks RawFish to CookedFish', () => {
    const campfire = placeStructure(w, BlueprintType.Campfire, 15, 10);
    const addResult = w.inventoryMgr.addItem(pid, BlueprintType.RawFish, 1);
    const itemId = addResult.itemId!;
    const beforeRaw = countItem(w, pid, BlueprintType.RawFish);
    const beforeCooked = countItem(w, pid, BlueprintType.CookedFish);

    w.setAction(pid, {
      action: ClientAction.UseItemAt,
      itemId, tileX: 15, tileY: 10,
    } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    expect(countItem(w, pid, BlueprintType.RawFish)).toBe(beforeRaw - 1);
    expect(countItem(w, pid, BlueprintType.CookedFish)).toBe(beforeCooked + 1);
  });
});

describe('pendingActions — already-adjacent fast path (zero-tick completion)', () => {
  let w: GameWorld;
  let conn: HeadlessConnection;
  let pid: number;

  beforeEach(() => {
    w = makeWorld();
    conn = new HeadlessConnection();
    pid = placePlayerAt(w, conn, 10, 10);
    conn.rejections.length = 0;
  });

  it('pickup of an adjacent item completes in a single tick without scheduling', () => {
    const itemId = placeGroundItem(w, 11, 10, BlueprintType.Wood); // dist=1
    const beforeWood = countItem(w, pid, BlueprintType.Wood);

    w.setAction(pid, { action: ClientAction.Pickup, entityId: itemId } as any);
    w.runTick(); // single tick

    expect(conn.rejections).toHaveLength(0);
    expect(w.entities.exists(itemId)).toBe(false);
    expect(countItem(w, pid, BlueprintType.Wood)).toBe(beforeWood + 1);
    // Synchronous execution path — no entry should have been written to the
    // pending map at any point (verifiable post-hoc).
    expect(w.pendingActions.has(pid)).toBe(false);
  });

  it('interact with an adjacent door completes in a single tick', () => {
    const door = placeStructure(w, BlueprintType.WoodenDoor, 11, 10);

    w.setAction(pid, { action: ClientAction.Interact, entityId: door } as any);
    w.runTick();

    const eff = w.entities.statusEffects.get(door)!;
    expect(eff.effects & StatusEffect.Open).toBe(StatusEffect.Open);
    expect(w.pendingActions.has(pid)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
//   Interrupt cases
// ---------------------------------------------------------------------------

describe('pendingActions — interrupt cases', () => {
  let w: GameWorld;
  let conn: HeadlessConnection;
  let pid: number;

  beforeEach(() => {
    w = makeWorld();
    conn = new HeadlessConnection();
    pid = placePlayerAt(w, conn, 10, 10);
    conn.rejections.length = 0;
    conn.gameEvents.length = 0;
  });

  it('target destroyed mid-walk → target_missing rejection', () => {
    const itemId = placeGroundItem(w, 20, 10, BlueprintType.Wood);

    w.setAction(pid, { action: ClientAction.Pickup, entityId: itemId } as any);
    w.runTick(); // tick 1: schedule
    w.runTick(); // tick 2: walking
    expect(w.pendingActions.has(pid)).toBe(true);

    // Item destroyed by some other party
    w.entities.destroy(itemId);
    w.runTick(); // resolver detects missing target

    expect(w.pendingActions.has(pid)).toBe(false);
    expect(conn.rejections).toHaveLength(1);
    expect(conn.rejections[0]).toMatchObject({ code: 'target_missing', targetEntityId: itemId });
  });

  it('path becomes unreachable mid-walk → no_path rejection', () => {
    const itemId = placeGroundItem(w, 20, 10, BlueprintType.Wood);

    w.setAction(pid, { action: ClientAction.Pickup, entityId: itemId } as any);
    w.runTick();
    w.runTick();
    expect(w.pendingActions.has(pid)).toBe(true);

    // Wall the entire column between player and item top-to-bottom; movement
    // re-plans, fails, clears moveState. Resolver tries once more, also fails,
    // surfaces no_path.
    for (let y = 0; y < MAP_SIZE; y++) {
      w.map.setBuilding(15, y, Building.Wall);
      w.map.setBuilding(16, y, Building.Wall);
    }
    for (let i = 0; i < 30; i++) w.runTick();

    expect(w.pendingActions.has(pid)).toBe(false);
    const noPath = conn.rejections.find(r => r.code === 'no_path');
    expect(noPath).toBeTruthy();
  });

  it('player issues new action mid-walk → action_interrupted event, new action proceeds', () => {
    const itemId = placeGroundItem(w, 20, 10, BlueprintType.Wood);

    w.setAction(pid, { action: ClientAction.Pickup, entityId: itemId } as any);
    w.runTick();
    w.runTick();
    expect(w.pendingActions.has(pid)).toBe(true);

    // Player now wants to MoveTo somewhere else entirely.
    conn.gameEvents.length = 0;
    w.setAction(pid, { action: ClientAction.MoveTo, tileX: 5, tileY: 10 } as any);
    w.runTick(); // tick processes the new action

    // Pending pickup is gone, action_interrupted fired with kind = 'pickup'.
    expect(w.pendingActions.has(pid)).toBe(false);
    const interrupted = conn.gameEvents.find(e => e.type === 'action_interrupted');
    expect(interrupted).toBeTruthy();
    expect((interrupted as any).details.interruptedAction).toBe('pickup');

    // New MoveTo action proceeds: player walks toward (5,10).
    for (let i = 0; i < 60; i++) w.runTick();
    const ppos = w.entities.position.get(pid)!;
    expect(ppos.tileX).toBeLessThan(10); // moved west
  });

  it('player dies mid-walk → pendingAction cleared by resolver', () => {
    const itemId = placeGroundItem(w, 20, 10, BlueprintType.Wood);

    w.setAction(pid, { action: ClientAction.Pickup, entityId: itemId } as any);
    w.runTick();
    w.runTick();
    expect(w.pendingActions.has(pid)).toBe(true);

    // Flip currentAction to Dead — the resolver's death-cleanup branch runs on
    // the next tick. (Real death goes through handlePlayerDeath which also
    // deletes the entry; this test pins the resolver-side guard.)
    w.entities.currentAction.set(pid, { actionType: ActionType.Dead });
    w.runTick();

    expect(w.pendingActions.has(pid)).toBe(false);
  });

  it('entity target moves mid-walk → resolver re-aims, player follows + arrives', () => {
    // Mock NPC: place a Wanderer at (15,10), keep it stationary (speed=0 set
    // here so critter-AI/movement does not move it on its own).
    const npc = placeStructure(w, BlueprintType.Hermit, 15, 10);
    w.entities.speed.set(npc, 0);

    w.setAction(pid, {
      action: ClientAction.DialogueSelect,
      npcEntityId: npc, optionId: 1,
    } as any);
    w.runTick(); // tick 1: schedule
    w.runTick(); // tick 2: walking
    expect(w.pendingActions.has(pid)).toBe(true);

    // Move the NPC further south. The resolver should re-aim on the next tick.
    w.occupancy.clear(15, 10, npc);
    w.entities.position.set(npc, { tileX: 15, tileY: 18 });
    w.occupancy.set(15, 18, npc);

    for (let i = 0; i < 120; i++) w.runTick();

    expect(conn.rejections).toHaveLength(0);
    const dlgEvent = conn.events.find(e => e.type === 'dialogueOpen' && e.npcEntityId === npc);
    expect(dlgEvent).toBeTruthy();
    // Player ended up adjacent to the NPC's new position.
    const ppos = w.entities.position.get(pid)!;
    const dist = Math.max(Math.abs(ppos.tileX - 15), Math.abs(ppos.tileY - 18));
    expect(dist).toBeLessThanOrEqual(1);
  });

  it('inventory fills mid-walk → inventory_full rejection on arrival', () => {
    const itemId = placeGroundItem(w, 20, 10, BlueprintType.Wood);

    // Tighten the player's weight cap so the next +1 Wood (weight 1) would
    // overflow on arrival. Player starts with 2 Wood + 1 Rock = weight 4.
    const inv = w.inventoryMgr.get(pid)!;
    inv.maxWeight = 4;

    w.setAction(pid, { action: ClientAction.Pickup, entityId: itemId } as any);
    for (let i = 0; i < 60; i++) w.runTick();

    expect(w.pendingActions.has(pid)).toBe(false);
    expect(w.entities.exists(itemId)).toBe(true); // not picked up
    const full = conn.rejections.find(r => r.code === 'inventory_full');
    expect(full).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
//   Helpers (test-local)
// ---------------------------------------------------------------------------

function countItem(w: GameWorld, eid: number, blueprintId: number): number {
  const inv = w.inventoryMgr.get(eid);
  if (!inv) return 0;
  let n = 0;
  for (const item of inv.items) {
    if (item.blueprintId === blueprintId) n += item.quantity;
  }
  return n;
}
