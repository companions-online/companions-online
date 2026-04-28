/**
 * Path-aware blockage diagnosis.
 *
 * Called from `setMoveTarget`'s rejection branches. Runs a permissive A*
 * that ignores the two recipe-bypassable obstacle classes (unbridged water
 * and closed wooden doors). If that search succeeds, walks the resulting
 * path and emits one ObstacleSpan per contiguous water run + one per
 * closed door, bounded by per-class caps so token output stays small.
 *
 * Walls / fences / rock / non-door entity occupancy are NOT relaxed —
 * there's no in-game way to bypass them today, so naming them on the
 * route would just be noise. If the permissive search itself fails,
 * returns `[]` and the caller falls back to its bare `tile_blocked` /
 * `no_path` message.
 */

import { Terrain, Building } from '@shared/terrain.js';
import { BlueprintType } from '@shared/blueprints.js';
import { findPath } from '@shared/pathfinding.js';
import type { SystemState } from './system-state.js';
import type { ObstacleSpan } from './action-rejection.js';

const MAX_TILES_PER_WATER_SPAN = 4;
const MAX_DOORS_REPORTED = 3;

export function diagnoseBlockage(
  world: SystemState,
  fromX: number, fromY: number,
  toX: number, toY: number,
  eid: number,
): ObstacleSpan[] {
  const permissivelyBlocked = (x: number, y: number): boolean => {
    const t = world.map.getTerrain(x, y);
    const b = world.map.getBuilding(x, y);
    if (t === Terrain.Rock) return true;
    if (b === Building.Wall || b === Building.Fence) return true;
    if (world.occupancy.isOccupied(x, y) && world.occupancy.get(x, y) !== eid) {
      const occId = world.occupancy.get(x, y);
      const bp = world.entities.blueprint.get(occId);
      // Closed WoodenDoors occupy their tile; open doors don't. Treat
      // closed doors as bypassable so they show up on the diagnosed path.
      if (bp?.blueprintId === BlueprintType.WoodenDoor) return false;
      return true;
    }
    return false;
  };

  const r = findPath(
    fromX, fromY, toX, toY,
    permissivelyBlocked,
    world.map.width, world.map.height,
  );
  if (!r.found || r.path.length === 0) return [];

  const spans: ObstacleSpan[] = [];
  let waterRun: { x: number; y: number }[] | null = null;
  let doorCount = 0;

  for (const tile of r.path) {
    const terrain = world.map.getTerrain(tile.x, tile.y);
    const building = world.map.getBuilding(tile.x, tile.y);
    const isWaterUnbridged =
      (terrain === Terrain.Water || terrain === Terrain.River) &&
      building !== Building.WoodenFloor &&
      building !== Building.StoneFloor;

    if (isWaterUnbridged) {
      if (!waterRun) waterRun = [];
      if (waterRun.length < MAX_TILES_PER_WATER_SPAN) waterRun.push({ x: tile.x, y: tile.y });
      continue;
    }
    if (waterRun) {
      spans.push({ kind: 'water', tiles: waterRun });
      waterRun = null;
    }

    if (world.occupancy.isOccupied(tile.x, tile.y)) {
      const occId = world.occupancy.get(tile.x, tile.y);
      const bp = world.entities.blueprint.get(occId);
      if (bp?.blueprintId === BlueprintType.WoodenDoor && doorCount < MAX_DOORS_REPORTED) {
        spans.push({ kind: 'door', entityId: occId, x: tile.x, y: tile.y });
        doorCount++;
      }
    }
  }
  if (waterRun) spans.push({ kind: 'water', tiles: waterRun });

  return spans;
}
