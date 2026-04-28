/**
 * Unit tests for diagnoseBlockage — the path-aware obstacle classifier
 * that powers the `obstacles` field on tile_blocked / no_path rejections.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntityManager } from '../server/src/ecs/entity-manager.js';
import { OccupancyGrid } from '../server/src/occupancy.js';
import { InventoryManager } from '../server/src/inventory-manager.js';
import { diagnoseBlockage } from '../server/src/path-diagnose.js';
import { WorldMap } from '@shared/world/world-map.js';
import { Terrain, Building } from '@shared/terrain.js';
import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { StatusEffect } from '@shared/status-effects.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { MAP_SIZE } from '@shared/constants.js';
import type { SystemState } from '../server/src/system-state.js';

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
    respawnRng: 0,
    currentTick: 0,
  };
}

function placeClosedDoor(w: SystemState, x: number, y: number): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.direction.set(eid, { dir: Direction.S });
  w.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  w.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  w.entities.health.set(eid, { currentHp: 30, maxHp: 30 });
  w.entities.blueprint.set(eid, { blueprintId: BlueprintType.WoodenDoor, variant: 0 });
  w.entities.statusEffects.set(eid, { effects: 0 });
  w.occupancy.set(x, y, eid);
  return eid;
}

function placeOpenDoor(w: SystemState, x: number, y: number): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.direction.set(eid, { dir: Direction.S });
  w.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  w.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  w.entities.health.set(eid, { currentHp: 30, maxHp: 30 });
  w.entities.blueprint.set(eid, { blueprintId: BlueprintType.WoodenDoor, variant: 0 });
  w.entities.statusEffects.set(eid, { effects: StatusEffect.Open });
  // Open doors are NOT registered in occupancy.
  return eid;
}

function placeTree(w: SystemState, x: number, y: number): number {
  const eid = w.entities.create();
  w.entities.position.set(eid, { tileX: x, tileY: y });
  w.entities.blueprint.set(eid, { blueprintId: BlueprintType.Tree, variant: 0 });
  w.entities.statusEffects.set(eid, { effects: StatusEffect.Placed });
  w.occupancy.set(x, y, eid);
  return eid;
}

const ACTOR_EID = 999;  // not registered anywhere — diagnose only uses it to skip self-occupancy

describe('diagnoseBlockage', () => {
  let w: SystemState;

  beforeEach(() => {
    w = makeWorld();
  });

  it('returns [] when the route is clear grass', () => {
    const spans = diagnoseBlockage(w, 10, 10, 15, 10, ACTOR_EID);
    expect(spans).toEqual([]);
  });

  it('returns [] when even the permissive search fails (rock-walled pocket)', () => {
    // Surround (20,20) with rock — diagnoseBlockage doesn't relax rock.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        w.map.setTerrain(20 + dx, 20 + dy, Terrain.Rock);
      }
    }
    const spans = diagnoseBlockage(w, 10, 10, 20, 20, ACTOR_EID);
    expect(spans).toEqual([]);
  });

  it('emits one water span when the path crosses one river tile', () => {
    // Vertical river at x=15, single tile.
    w.map.setTerrain(15, 10, Terrain.River);
    const spans = diagnoseBlockage(w, 10, 10, 20, 10, ACTOR_EID);
    const water = spans.filter(s => s.kind === 'water');
    expect(water).toHaveLength(1);
    const tiles = (water[0] as { kind: 'water'; tiles: { x: number; y: number }[] }).tiles;
    expect(tiles).toEqual([{ x: 15, y: 10 }]);
  });

  it('groups contiguous river tiles into one water span', () => {
    // A 1-wide strip of river running N-S that the path must cross.
    // Walls cordon off any detour so the diagonal route doesn't dodge it.
    for (let y = 0; y < MAP_SIZE; y++) w.map.setTerrain(15, y, Terrain.River);
    const spans = diagnoseBlockage(w, 10, 10, 20, 10, ACTOR_EID);
    const water = spans.filter(s => s.kind === 'water');
    expect(water).toHaveLength(1);
    // Single contiguous run; we don't pin the exact tile coords (path picks a row),
    // just that the run is a single span and contains at least one river tile.
    const tiles = (water[0] as { kind: 'water'; tiles: { x: number; y: number }[] }).tiles;
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.x).toBe(15);
    }
  });

  it('caps a long water run to MAX_TILES_PER_WATER_SPAN tiles', () => {
    // Wide river: 8 tiles across, path must cross all of them in one run.
    // Force a horizontal corridor by wall-ringing top + bottom.
    for (let x = 10; x < 30; x++) {
      w.map.setBuilding(x, 9, Building.Wall);
      w.map.setBuilding(x, 11, Building.Wall);
    }
    for (let x = 14; x <= 21; x++) w.map.setTerrain(x, 10, Terrain.River);
    const spans = diagnoseBlockage(w, 10, 10, 25, 10, ACTOR_EID);
    const water = spans.filter(s => s.kind === 'water');
    expect(water).toHaveLength(1);
    const tiles = (water[0] as { kind: 'water'; tiles: { x: number; y: number }[] }).tiles;
    expect(tiles.length).toBeLessThanOrEqual(4);
  });

  it('emits a door span for a closed WoodenDoor on the path', () => {
    // Force the path through (15,10): wall-corridor with a door at the gap.
    for (let x = 10; x < 25; x++) {
      w.map.setBuilding(x, 9, Building.Wall);
      w.map.setBuilding(x, 11, Building.Wall);
    }
    // Wall-ring everything except (15,10) so the door is the only way through.
    w.map.setBuilding(14, 10, Building.Wall);
    w.map.setBuilding(16, 10, Building.Wall);
    // Re-open the gap at the door tile itself.
    w.map.setBuilding(15, 10, Building.None);
    const doorEid = placeClosedDoor(w, 15, 10);

    // ...wait, walls on (14,10) and (16,10) plus a door at (15,10) means the
    // path goes through the door but can't get TO it. Drop the side walls.
    w.map.setBuilding(14, 10, Building.None);
    w.map.setBuilding(16, 10, Building.None);

    const spans = diagnoseBlockage(w, 10, 10, 20, 10, ACTOR_EID);
    const doors = spans.filter(s => s.kind === 'door');
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ kind: 'door', entityId: doorEid, x: 15, y: 10 });
  });

  it('does not emit a door span for an open WoodenDoor (not in occupancy)', () => {
    placeOpenDoor(w, 15, 10);
    const spans = diagnoseBlockage(w, 10, 10, 20, 10, ACTOR_EID);
    expect(spans.filter(s => s.kind === 'door')).toEqual([]);
  });

  it('does not emit a span for non-door entity occupancy (tree blocks but is not relaxed)', () => {
    // Tree on (15,10). Permissive search treats it as blocking, so the path
    // routes around it; no span emitted (the tree never appears on the path).
    placeTree(w, 15, 10);
    const spans = diagnoseBlockage(w, 10, 10, 20, 10, ACTOR_EID);
    expect(spans).toEqual([]);
  });

  it('does not classify a bridged river tile as a water obstacle', () => {
    w.map.setTerrain(15, 10, Terrain.River);
    w.map.setBuilding(15, 10, Building.WoodenFloor);
    const spans = diagnoseBlockage(w, 10, 10, 20, 10, ACTOR_EID);
    expect(spans).toEqual([]);
  });

  it('emits both a door and water span when both are on the route', () => {
    // Set up: corridor between walls, river in part of it, door in another.
    // Walls cordon the path along y=10 from x=10 to x=25.
    for (let x = 10; x < 26; x++) {
      w.map.setBuilding(x, 9, Building.Wall);
      w.map.setBuilding(x, 11, Building.Wall);
    }
    w.map.setTerrain(13, 10, Terrain.River);  // water early in the path
    const doorEid = placeClosedDoor(w, 18, 10);

    const spans = diagnoseBlockage(w, 10, 10, 25, 10, ACTOR_EID);
    const water = spans.filter(s => s.kind === 'water');
    const doors = spans.filter(s => s.kind === 'door');
    expect(water).toHaveLength(1);
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ kind: 'door', entityId: doorEid });
  });

  it('caps reported doors to MAX_DOORS_REPORTED', () => {
    // Corridor with 5 doors lined up; expect only the first 3 surfaced.
    for (let x = 10; x < 30; x++) {
      w.map.setBuilding(x, 9, Building.Wall);
      w.map.setBuilding(x, 11, Building.Wall);
    }
    const doorIds = [
      placeClosedDoor(w, 14, 10),
      placeClosedDoor(w, 16, 10),
      placeClosedDoor(w, 18, 10),
      placeClosedDoor(w, 20, 10),
      placeClosedDoor(w, 22, 10),
    ];
    const spans = diagnoseBlockage(w, 10, 10, 25, 10, ACTOR_EID);
    const doors = spans.filter(s => s.kind === 'door');
    expect(doors).toHaveLength(3);
    // First three by path order = first three placed.
    expect((doors[0] as any).entityId).toBe(doorIds[0]);
    expect((doors[1] as any).entityId).toBe(doorIds[1]);
    expect((doors[2] as any).entityId).toBe(doorIds[2]);
  });
});
