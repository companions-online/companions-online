import { ActionType } from '@shared/actions.js';
import { Direction, DX, DY, isDiagonal } from '@shared/direction.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { TICK_RATE } from '@shared/constants.js';
import { findPath } from '@shared/pathfinding.js';
import { Terrain, Building } from '@shared/terrain.js';
import { BlueprintType } from '@shared/blueprints.js';
import type { SystemState, MovementState } from '../system-state.js';
import { Ok, Err, type ActionResult } from '../action-rejection.js';

const WAIT_PATIENCE = 10;

/** Classify why a tile cannot be entered. Walls/terrain dominate over
 *  occupancy so the LLM hears the most actionable reason first. */
function classifyBlock(
  world: SystemState, x: number, y: number, eid: number,
): 'wall' | 'water' | 'rock' | 'door' | 'entity' {
  const building = world.map.getBuilding(x, y);
  if (building !== Building.None) return 'wall';
  const terrain = world.map.getTerrain(x, y);
  if (terrain === Terrain.Water || terrain === Terrain.River) return 'water';
  if (terrain === Terrain.Rock) return 'rock';
  const occ = world.occupancy.get(x, y);
  if (occ && occ !== eid) {
    const bp = world.entities.blueprint.get(occ);
    if (bp?.blueprintId === BlueprintType.WoodenDoor) return 'door';
  }
  return 'entity';
}

/** Mode controls how a blocked destination is treated.
 *
 *  - 'exact' (player MoveTo intent): reject if the goal tile itself is blocked.
 *    The user clicked *that tile*, not "near it" — surface tile_blocked so the
 *    LLM/client gets actionable feedback.
 *  - 'near' (chase intent — pickup, interact, attack chase, harvest approach):
 *    fall back to a walkable adjacent tile so the actor can stand next to a
 *    door/item/target. findPath handles the adjacent-fallback internally.
 */
export function setMoveTarget(
  entityId: number, x: number, y: number, world: SystemState,
  mode: 'exact' | 'near' = 'near',
): ActionResult {
  const pos = world.entities.position.get(entityId);
  if (!pos) return Err({ code: 'target_missing', targetEntityId: entityId });

  if (x < 0 || x >= world.map.width || y < 0 || y >= world.map.height) {
    return Err({ code: 'tile_out_of_bounds', tileX: x, tileY: y });
  }

  const isBlocked = (px: number, py: number): boolean =>
    !world.map.isWalkable(px, py) ||
    (world.occupancy.isOccupied(px, py) && world.occupancy.get(px, py) !== entityId);

  if (mode === 'exact' && isBlocked(x, y)) {
    return Err({ code: 'tile_blocked', tileX: x, tileY: y, by: classifyBlock(world, x, y, entityId) });
  }

  const result = findPath(pos.tileX, pos.tileY, x, y, isBlocked, world.map.width, world.map.height);

  if (!result.found || result.path.length === 0) {
    if (isBlocked(x, y)) {
      return Err({ code: 'tile_blocked', tileX: x, tileY: y, by: classifyBlock(world, x, y, entityId) });
    }
    return Err({ code: 'no_path', tileX: x, tileY: y });
  }

  world.moveStates.set(entityId, {
    targetX: x, targetY: y,
    path: result.path,
    pathIndex: 0,
    waitTicks: 0,
    cooldownRemaining: 0,
  });

  const next = result.path[0];
  world.entities.currentAction.set(entityId, { actionType: ActionType.Walking });
  world.entities.nextWaypoint.set(entityId, { tileX: x, tileY: y });

  const dx = next.x - pos.tileX;
  const dy = next.y - pos.tileY;
  const dir = directionFromDelta(dx, dy);
  if (dir !== undefined) world.entities.direction.set(entityId, { dir });

  return Ok;
}

/** Cancel an entity's current move. Mirrors `arriveIdle` — when a moveState
 *  actually existed, reset `currentAction` to Idle and clear the waypoint so
 *  clients don't keep rendering a stale Walking animation toward a target no
 *  system owns anymore. No-op (no action/waypoint change) if the entity had
 *  no pending move to begin with — otherwise this would clobber ongoing
 *  Harvesting/Attacking/Consuming states on entities that never moved. */
export function clearMoveTarget(entityId: number, world: SystemState): void {
  if (!world.moveStates.delete(entityId)) return;
  world.entities.currentAction.set(entityId, { actionType: ActionType.Idle });
  world.entities.nextWaypoint.set(entityId, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
}

export function hasMoveTarget(entityId: number, world: SystemState): boolean {
  return world.moveStates.has(entityId);
}

export function runMovement(world: SystemState): void {
  const sorted = [...world.moveStates.entries()].sort((a, b) => a[0] - b[0]);

  for (const [eid, state] of sorted) {
    const pos = world.entities.position.get(eid);
    if (!pos) {
      world.moveStates.delete(eid);
      continue;
    }

    if (state.cooldownRemaining > 0) {
      state.cooldownRemaining--;
      continue;
    }

    if (state.pathIndex >= state.path.length) {
      clearMoveTarget(eid, world);
      continue;
    }

    const next = state.path[state.pathIndex];

    if (world.occupancy.isOccupied(next.x, next.y) && world.occupancy.get(next.x, next.y) !== eid) {
      state.waitTicks++;
      if (state.waitTicks >= WAIT_PATIENCE) {
        const result = findPath(
          pos.tileX, pos.tileY, state.targetX, state.targetY,
          (px, py) => !world.map.isWalkable(px, py) || (world.occupancy.isOccupied(px, py) && world.occupancy.get(px, py) !== eid),
          world.map.width, world.map.height,
        );
        if (result.found && result.path.length > 0) {
          state.path = result.path;
          state.pathIndex = 0;
          state.waitTicks = 0;
        } else {
          clearMoveTarget(eid, world);
        }
      }
      continue;
    }

    if (!world.map.isWalkable(next.x, next.y)) {
      const result = findPath(
        pos.tileX, pos.tileY, state.targetX, state.targetY,
        (px, py) => !world.map.isWalkable(px, py) || (world.occupancy.isOccupied(px, py) && world.occupancy.get(px, py) !== eid),
        world.map.width, world.map.height,
      );
      if (result.found && result.path.length > 0) {
        state.path = result.path;
        state.pathIndex = 0;
        state.waitTicks = 0;
      } else {
        clearMoveTarget(eid, world);
      }
      continue;
    }

    const dx = next.x - pos.tileX;
    const dy = next.y - pos.tileY;
    const dir = directionFromDelta(dx, dy);

    world.occupancy.move(pos.tileX, pos.tileY, next.x, next.y, eid);
    world.entities.position.set(eid, { tileX: next.x, tileY: next.y });
    if (dir !== undefined) world.entities.direction.set(eid, { dir });

    state.pathIndex++;
    state.waitTicks = 0;

    const speed = world.entities.speed.get(eid) ?? 3;
    const ticksPerStep = Math.max(1, Math.round(TICK_RATE / speed));
    const diag = dir !== undefined && isDiagonal(dir);
    const stepTicks = diag ? Math.round(ticksPerStep * 1.4) : ticksPerStep;
    state.cooldownRemaining = stepTicks - 1;

    world.entities.currentAction.set(eid, { actionType: ActionType.Walking });
    world.entities.nextWaypoint.set(eid, { tileX: state.targetX, tileY: state.targetY });

    if (state.pathIndex >= state.path.length) {
      clearMoveTarget(eid, world);
    }
  }
}

function directionFromDelta(dx: number, dy: number): Direction | undefined {
  for (let d = 0; d < 8; d++) {
    if (DX[d] === Math.sign(dx) * (Math.abs(dx) > 0 ? 1 : 0) &&
        DY[d] === Math.sign(dy) * (Math.abs(dy) > 0 ? 1 : 0)) {
      return d as Direction;
    }
  }
  return undefined;
}
