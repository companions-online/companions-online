/**
 * Edge-case tests for the movement / pathfinding / combat-chase pipeline.
 *
 * Each block targets one observed defect and is written against the *desired*
 * behaviour. Tests that fail today are the spec for the upcoming fix.
 *
 *   1. MCP move_to into a building wall  -> tile_blocked rejection (works today)
 *   2. MCP move_to onto a closed door    -> tile_blocked by 'door'  (BUG: silent today)
 *   3. MCP move_to to unreachable tile   -> no_path rejection       (BUG: silent today)
 *   4. Critter whose path is fully blocked mid-walk reverts to Idle  (works today)
 *   5. Aggro critter chasing an unreachable target gives up + Idle   (BUG: chases forever)
 *   6. Attacker cannot damage target across a closed door            (BUG: clip-through)
 *   7. Pathfinding will not cross a 2-wide river                     (BUG: River walkable)
 *   8. Pathfinding will cross a 1-wide river                         (passes today; spec'd
 *      in case future fix over-corrects)
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
import { Terrain, Building } from '@shared/terrain.js';
import { Direction } from '@shared/direction.js';
import { ActionType, ClientAction } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { StatusEffect } from '@shared/status-effects.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { MAP_SIZE } from '@shared/constants.js';
import { findPath } from '@shared/pathfinding.js';
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

  it('rejects MoveTo onto a closed-door entity (BUG: currently silent)', () => {
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

  it('rejects MoveTo to an unreachable tile with no_path (BUG: currently silent)', () => {
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

  it('aggro critter against an unreachable target gives up (BUG: chases forever today)', () => {
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

describe('Movement edge cases — attack across closed door (clip-through)', () => {
  let w: GameWorld;
  let attackerConn: HeadlessConnection;
  let attacker: number;
  let target: number;

  beforeEach(() => {
    w = makeGameWorld();
    attackerConn = new HeadlessConnection();
    attacker = placePlayerAt(w, attackerConn, 20, 20);

    // Build a 1-tile-thick wall east of the attacker, with a closed door as
    // the only opening. Target lives on the far side, Chebyshev-adjacent to
    // the attacker around the door's corner.
    for (let y = 18; y <= 22; y++) {
      if (y === 20) continue; // door slot
      w.map.setBuilding(21, y, Building.Wall);
    }
    placeClosedDoor(w, 21, 20);

    // Target: a "dummy player" on the far side. Spawn via spawnCritterAt
    // helper but with Player blueprint so combat treats it as damageable.
    target = spawnCritterAt(w, BlueprintType.Player, 22, 21, 3);
    w.inventoryMgr.create(target, 50);
    w.entities.health.set(target, { currentHp: 10, maxHp: 10 });
  });

  it('attacker cannot land a swing through a closed door (BUG: lands today)', () => {
    // attacker (20,20) and target (22,21): Chebyshev = 2 (not adjacent), so
    // the chase fires; pathfinding has no route through the closed door.
    // After many ticks, target HP must remain 10 and combat must terminate.
    w.setAction(attacker, { action: ClientAction.Attack, entityId: target } as any);
    for (let i = 0; i < 100; i++) w.runTick();

    const hp = w.entities.health.get(target)!;
    expect(hp.currentHp).toBe(10);
    expect(w.combatStates.has(attacker)).toBe(false);
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

describe('Movement edge cases — river crossing', () => {
  it('refuses to cross a 2-tile-wide river (BUG: River walkable today)', () => {
    const map = new WorldMap(40, 40);
    // Vertical river 2 tiles wide at x=10,11
    for (let y = 0; y < 40; y++) {
      map.setTerrain(10, y, Terrain.River);
      map.setTerrain(11, y, Terrain.River);
    }
    const isBlocked = (x: number, y: number) => !map.isWalkable(x, y);
    const result = findPath(5, 20, 20, 20, isBlocked, 40, 40);

    // Spec: a 2+-wide river is uncrossable; pathfinding either fails or
    // produces a route that touches no river tiles.
    if (result.found) {
      const crossed = result.path.filter(p => map.getTerrain(p.x, p.y) === Terrain.River).length;
      expect(crossed).toBe(0);
    } else {
      expect(result.found).toBe(false);
    }
  });

  it('refuses to cross a 1-tile-wide river (rivers are non-walkable)', () => {
    const map = new WorldMap(40, 40);
    for (let y = 0; y < 40; y++) {
      map.setTerrain(10, y, Terrain.River);
    }
    const isBlocked = (x: number, y: number) => !map.isWalkable(x, y);
    const result = findPath(5, 20, 20, 20, isBlocked, 40, 40);

    // River tiles span the full map height with no gap; no path should exist.
    expect(result.found).toBe(false);
  });
});
