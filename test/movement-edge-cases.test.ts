/**
 * Edge-case tests for the movement / pathfinding / combat-chase pipeline.
 *
 * Each block pins down one previously-observed defect.
 *
 *   1. MCP move_to into a building wall  -> tile_blocked rejection
 *   2. MCP move_to onto a closed door    -> tile_blocked by 'door'
 *   3. MCP move_to to unreachable tile   -> no_path rejection
 *   4. Critter whose path is fully blocked mid-walk reverts to Idle
 *   5. Aggro critter chasing an unreachable target gives up + Idle
 *   6. Door close guard against occupancy phasing
 *   7. Walled-in player + wolf in aggroRange: wolf stays in wander
 *   8. MCP pickup with player boxed in   -> no_path rejection
 *   9. MCP pickup with item boxed in     -> no_path rejection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GameWorld } from '../server/src/game-world.js';
import { HeadlessConnection } from '../server/src/connections/headless-connection.js';
import { EntityManager } from '../server/src/ecs/entity-manager.js';
import { OccupancyGrid } from '../server/src/occupancy.js';
import { InventoryManager } from '../server/src/inventory-manager.js';
import { setMoveTarget, runMovement, hasMoveTarget } from '../server/src/systems/movement.js';
import { initCritterForEntity, runCritterAI, notifyCritterAttacked } from '../server/src/systems/critter-ai.js';
import { WorldMap } from '@shared/world/world-map.js';
import { Building } from '@shared/terrain.js';
import { Direction } from '@shared/direction.js';
import { ActionType, ClientAction } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { StatusEffect } from '@shared/status-effects.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { MAP_SIZE } from '@shared/constants.js';
import type { SystemState } from '../server/src/system-state.js';

// -- Helpers -----------------------------------------------------------------

function makeGameWorld(): GameWorld {
  const map = new WorldMap(MAP_SIZE, MAP_SIZE);
  return new GameWorld(map, 1);
}

function makeBareWorld(): SystemState {
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
    respawnRng: 0,
    currentTick: 0,
  };
}

function placePlayerAt(w: GameWorld, conn: HeadlessConnection, x: number, y: number): number {
  const eid = w.addPlayer(conn);
  // Force the spawn to the tile we want.
  const old = w.entities.position.get(eid)!;
  w.occupancy.clear(old.tileX, old.tileY, eid);
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.occupancy.set(x, y, eid);
  return eid;
}

/** Manually create a closed-door entity that occupies its tile. */
function placeClosedDoor(w: SystemState, x: number, y: number): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.direction.set(eid, { dir: Direction.S });
  w.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  w.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  w.entities.health.set(eid, { currentHp: 30, maxHp: 30 });
  w.entities.blueprint.set(eid, { blueprintId: BlueprintType.WoodenDoor, variant: 0 });
  w.entities.statusEffects.set(eid, { effects: 0 }); // not Open
  w.occupancy.set(x, y, eid);
  return eid;
}

function spawnCritterAt(w: SystemState, bp: BlueprintType, x: number, y: number, speed = 3): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.direction.set(eid, { dir: Direction.S });
  w.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  w.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  w.entities.health.set(eid, { currentHp: 30, maxHp: 30 });
  w.entities.blueprint.set(eid, { blueprintId: bp, variant: 0 });
  w.entities.statusEffects.set(eid, { effects: 0 });
  w.entities.speed.set(eid, speed);
  w.occupancy.set(x, y, eid);
  return eid;
}

// ---------------------------------------------------------------------------

describe('Movement edge cases — MCP rejection plumbing', () => {
  let w: GameWorld;
  let conn: HeadlessConnection;
  let pid: number;

  beforeEach(() => {
    w = makeGameWorld();
    conn = new HeadlessConnection();
    pid = placePlayerAt(w, conn, 10, 10);
    conn.rejections.length = 0;
  });

  it('rejects MoveTo onto a building Wall tile with tile_blocked/wall', () => {
    w.map.setBuilding(13, 10, Building.Wall);
    w.setAction(pid, { action: ClientAction.MoveTo, tileX: 13, tileY: 10 } as any);
    w.runTick();

    expect(conn.rejections).toHaveLength(1);
    expect(conn.rejections[0]).toMatchObject({ code: 'tile_blocked', tileX: 13, tileY: 10, by: 'wall' });
    expect(hasMoveTarget(pid, w)).toBe(false);
  });

  it('rejects MoveTo onto a closed-door entity', () => {
    placeClosedDoor(w, 13, 10);
    w.setAction(pid, { action: ClientAction.MoveTo, tileX: 13, tileY: 10 } as any);
    w.runTick();

    // Spec: door-occupied tile is blocked; surface a structured rejection.
    // Today handleMoveTo only consults map.isWalkable; occupancy is ignored,
    // setMoveTarget then silently no-ops because findPath rejects the goal.
    expect(conn.rejections).toHaveLength(1);
    expect(conn.rejections[0]).toMatchObject({ code: 'tile_blocked', tileX: 13, tileY: 10 });
    expect(hasMoveTarget(pid, w)).toBe(false);
  });

  it('rejects MoveTo to an unreachable tile with no_path', () => {
    // Wall-ring around (20,20); player at (10,10) cannot reach inside.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        w.map.setBuilding(20 + dx, 20 + dy, Building.Wall);
      }
    }
    w.setAction(pid, { action: ClientAction.MoveTo, tileX: 20, tileY: 20 } as any);
    w.runTick();

    expect(conn.rejections).toHaveLength(1);
    expect(conn.rejections[0]).toMatchObject({ code: 'no_path', tileX: 20, tileY: 20 });
    expect(hasMoveTarget(pid, w)).toBe(false);
  });
});

describe('Movement edge cases — critter stuck animation', () => {
  let w: SystemState;

  beforeEach(() => { w = makeBareWorld(); });

  it('critter whose remaining path is walled off mid-walk reverts to Idle', () => {
    const c = spawnCritterAt(w, BlueprintType.Deer, 30, 30, 3);
    setMoveTarget(c, 36, 30, w);
    expect(hasMoveTarget(c, w)).toBe(true);

    runMovement(w); // take one step
    // Fully seal off the target by walling the entire column x=33 (and x=34 to
    // prevent diagonal corner-cut). Extends top-to-bottom so there's no
    // detour — replan must fail and the critter must give up to Idle.
    for (let y = 0; y < MAP_SIZE; y++) {
      w.map.setBuilding(33, y, Building.Wall);
      w.map.setBuilding(34, y, Building.Wall);
    }

    for (let i = 0; i < 60; i++) runMovement(w);

    expect(hasMoveTarget(c, w)).toBe(false);
    const ca = w.entities.currentAction.get(c);
    expect(ca?.actionType).toBe(ActionType.Idle);
    const wp = w.entities.nextWaypoint.get(c);
    expect(wp?.tileX).toBe(WAYPOINT_NONE);
    expect(wp?.tileY).toBe(WAYPOINT_NONE);
  });

  it('walled-in player + wolf in aggroRange: wolf stays in wander, keeps moving, never locks in Walking-without-moveState', () => {
    // Reproduction of the "wolf stuck walking in place" dump: player at
    // (40,30) walled into a 3x3 box; wolf at (44,30), within aggroRange=5
    // but no path to the player. Wolf must not enter aggro, must keep
    // wandering, and must never end a tick with currentAction=Walking while
    // holding no moveState.
    const wolf = spawnCritterAt(w, BlueprintType.Wolf, 44, 30, 2.5);
    spawnCritterAt(w, BlueprintType.Player, 40, 30, 3);
    // Register the player so critter-ai's `world.players` scan sees it.
    (w.players as Map<number, any>).set(
      // Re-use the spawnCritterAt'd entity id — it's the last one created.
      w.entities.getNextId() - 1,
      { entityId: w.entities.getNextId() - 1 },
    );
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        w.map.setBuilding(40 + dx, 30 + dy, Building.Wall);
      }
    }
    initCritterForEntity(wolf, w);

    const startPos = w.entities.position.get(wolf)!;
    const visited = new Set<string>();

    let stuckTicks = 0;
    for (let i = 0; i < 200; i++) {
      runCritterAI(w);
      runMovement(w);

      // Invariant: no entity should ever be in `Walking` without an owning
      // moveState. That's the precise condition the dump captured.
      const ca = w.entities.currentAction.get(wolf);
      if (ca?.actionType === ActionType.Walking && !w.moveStates.has(wolf)) {
        stuckTicks++;
      }

      const p = w.entities.position.get(wolf)!;
      visited.add(`${p.tileX},${p.tileY}`);
    }

    // Behavior: stays in wander (never commits to aggro against unreachable
    // target).
    expect(w.critterStates.get(wolf)?.behavior).toBe('wander');

    // Wolf is not frozen in the Walking-without-owner state at any point.
    expect(stuckTicks).toBe(0);

    // Wolf actually moved around — wander isn't being clobbered by repeated
    // probes. At minimum we expect more than one distinct tile across 200
    // ticks, and we shouldn't still be at the exact spawn tile forever.
    expect(visited.size).toBeGreaterThan(1);
    const endPos = w.entities.position.get(wolf)!;
    expect(endPos.tileX !== startPos.tileX || endPos.tileY !== startPos.tileY).toBe(true);
  });

  it('aggro critter against an unreachable target gives up', () => {
    // Skeleton at (30,30); player at (40,30) walled into a sealed room.
    const skel = spawnCritterAt(w, BlueprintType.Skeleton, 30, 30, 2.5);
    const player = spawnCritterAt(w, BlueprintType.Player, 40, 30, 3);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        w.map.setBuilding(40 + dx, 30 + dy, Building.Wall);
      }
    }
    initCritterForEntity(skel, w);
    notifyCritterAttacked(skel, player, w);

    for (let i = 0; i < 200; i++) {
      runCritterAI(w);
      runMovement(w);
    }

    // Spec: after the chase patience window expires, the critter drops aggro
    // and returns to a non-Attacking state.
    const ca = w.entities.currentAction.get(skel);
    expect(ca?.actionType).not.toBe(ActionType.Attacking);
    expect(w.combatStates.has(skel)).toBe(false);
  });
});


describe('Movement edge cases — door close guard (occupancy phasing)', () => {
  let w: GameWorld;
  let playerConn: HeadlessConnection;
  let player: number;
  let door: number;

  beforeEach(() => {
    w = makeGameWorld();
    playerConn = new HeadlessConnection();
    player = placePlayerAt(w, playerConn, 10, 10);
    // Door at (11,10), open from the start (Placed + Open, occupancy clear).
    door = w.entities.create();
    w.entities.position.set(door, { tileX: 11, tileY: 10 });
    w.entities.direction.set(door, { dir: Direction.S });
    w.entities.nextWaypoint.set(door, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
    w.entities.currentAction.set(door, { actionType: ActionType.Idle });
    w.entities.health.set(door, { currentHp: 30, maxHp: 30 });
    w.entities.blueprint.set(door, { blueprintId: BlueprintType.WoodenDoor, variant: 0 });
    w.entities.statusEffects.set(door, { effects: StatusEffect.Placed | StatusEffect.Open });
    playerConn.rejections.length = 0;
  });

  it('close succeeds + sets occupancy when door tile is empty', () => {
    w.setAction(player, { action: ClientAction.Interact, entityId: door } as any);
    w.runTick();

    const eff = w.entities.statusEffects.get(door)!;
    expect(eff.effects & StatusEffect.Open).toBe(0);
    expect(w.occupancy.get(11, 10)).toBe(door);
    expect(w.log.errorCount).toBe(0);
    expect(playerConn.rejections).toHaveLength(0);
  });

  it('close rejects with tile_blocked/entity when another entity stands on the door tile', () => {
    // Park a second player on the door tile (as if walking through).
    const walkerConn = new HeadlessConnection();
    const walker = placePlayerAt(w, walkerConn, 11, 10);
    playerConn.rejections.length = 0;

    w.setAction(player, { action: ClientAction.Interact, entityId: door } as any);
    w.runTick();

    // Door stays Open. Occupancy still belongs to the walker, not the door.
    const eff = w.entities.statusEffects.get(door)!;
    expect(eff.effects & StatusEffect.Open).toBe(StatusEffect.Open);
    expect(w.occupancy.get(11, 10)).toBe(walker);

    // Closer got a structured rejection.
    expect(playerConn.rejections).toHaveLength(1);
    expect(playerConn.rejections[0]).toMatchObject({
      code: 'tile_blocked', tileX: 11, tileY: 10, by: 'entity',
    });

    // No occupancy violations fired.
    expect(w.log.errorCount).toBe(0);
  });

  it('open → walker enters door tile → close refused → walker exits → tile stays closed', () => {
    // Close a path where the previous bug surfaced: walker traverses the open
    // door tile; if close-guard were missing, occupancy would get overwritten
    // and the walker's next step would zero the door slot. With the guard, the
    // close is rejected and state stays coherent.
    const walkerConn = new HeadlessConnection();
    const walker = placePlayerAt(w, walkerConn, 11, 10); // on door tile
    playerConn.rejections.length = 0;

    // Player tries to close while walker is on the tile — rejected.
    w.setAction(player, { action: ClientAction.Interact, entityId: door } as any);
    w.runTick();
    expect(playerConn.rejections).toHaveLength(1);

    // Walker steps east off the door tile.
    w.setAction(walker, { action: ClientAction.MoveTo, tileX: 12, tileY: 10 } as any);
    for (let i = 0; i < 10; i++) w.runTick();
    expect(w.entities.position.get(walker)).toMatchObject({ tileX: 12, tileY: 10 });

    // Now the tile is empty — door is still Open (we never successfully closed).
    const effMid = w.entities.statusEffects.get(door)!;
    expect(effMid.effects & StatusEffect.Open).toBe(StatusEffect.Open);
    expect(w.occupancy.get(11, 10)).toBe(0);

    // Second close attempt now succeeds.
    playerConn.rejections.length = 0;
    w.setAction(player, { action: ClientAction.Interact, entityId: door } as any);
    w.runTick();

    const effFinal = w.entities.statusEffects.get(door)!;
    expect(effFinal.effects & StatusEffect.Open).toBe(0);
    expect(w.occupancy.get(11, 10)).toBe(door);
    expect(playerConn.rejections).toHaveLength(0);

    // Entire flow: zero occupancy invariant violations.
    expect(w.log.errorCount).toBe(0);
  });
});

describe('Movement edge cases — pickup pathfinding rejection', () => {
  let w: GameWorld;
  let conn: HeadlessConnection;
  let pid: number;

  beforeEach(() => {
    w = makeGameWorld();
    conn = new HeadlessConnection();
    pid = placePlayerAt(w, conn, 10, 10);
    conn.rejections.length = 0;
  });

  /** Drop a ground item entity at (x,y). Mirrors handleDrop's footprint —
   *  position + blueprint, no occupancy. */
  function placeGroundItem(x: number, y: number, bp: BlueprintType = BlueprintType.Wood): number {
    const eid = w.entities.create();
    w.entities.position.set(eid, { tileX: x, tileY: y });
    w.entities.blueprint.set(eid, { blueprintId: bp, variant: 0 });
    return eid;
  }

  it('rejects Pickup with no_path when the player is boxed in', () => {
    // Wall the player into their tile — every neighbor of (10,10) blocked.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        w.map.setBuilding(10 + dx, 10 + dy, Building.Wall);
      }
    }
    const itemId = placeGroundItem(15, 15);

    w.setAction(pid, { action: ClientAction.Pickup, entityId: itemId } as any);
    w.runTick();

    expect(conn.rejections).toHaveLength(1);
    expect(conn.rejections[0]).toMatchObject({ code: 'no_path' });
    expect(hasMoveTarget(pid, w)).toBe(false);
    // Item still on the ground.
    expect(w.entities.exists(itemId)).toBe(true);
  });

  it('rejects Pickup with no_path when the item is boxed in', () => {
    // Player free to roam. Item walled into a 1x1 cell at (20,20) so no
    // walkable adjacent tile exists for the chase fallback to land on.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        w.map.setBuilding(20 + dx, 20 + dy, Building.Wall);
      }
    }
    const itemId = placeGroundItem(20, 20);

    w.setAction(pid, { action: ClientAction.Pickup, entityId: itemId } as any);
    w.runTick();

    expect(conn.rejections).toHaveLength(1);
    expect(conn.rejections[0]).toMatchObject({ code: 'no_path' });
    expect(hasMoveTarget(pid, w)).toBe(false);
    expect(w.entities.exists(itemId)).toBe(true);
  });
});

