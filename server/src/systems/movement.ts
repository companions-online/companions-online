import { ActionType } from '@shared/actions.js';
import { Direction, DX, DY, isDiagonal } from '@shared/direction.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { TICK_RATE } from '@shared/constants.js';
import { findPath } from '@shared/pathfinding.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { EntityManager } from '../ecs/entity-manager.js';
import type { OccupancyGrid } from '../occupancy.js';

const WAIT_PATIENCE = 10;

interface MovementState {
  targetX: number;
  targetY: number;
  path: { x: number; y: number }[];
  pathIndex: number;
  waitTicks: number;
  cooldownRemaining: number;
  diagonalCheap: boolean;
}

const moveStates = new Map<number, MovementState>();

export function setMoveTarget(
  entityId: number, x: number, y: number,
  entities: EntityManager, map: WorldMap, occupancy: OccupancyGrid,
): void {
  const pos = entities.position.get(entityId);
  if (!pos) return;

  const result = findPath(
    pos.tileX, pos.tileY, x, y,
    (px, py) => !map.isWalkable(px, py) || (occupancy.isOccupied(px, py) && occupancy.get(px, py) !== entityId),
    map.width, map.height,
  );

  if (!result.found || result.path.length === 0) return;

  moveStates.set(entityId, {
    targetX: x, targetY: y,
    path: result.path,
    pathIndex: 0,
    waitTicks: 0,
    cooldownRemaining: 0,
    diagonalCheap: true,
  });

  // Set walking state
  const next = result.path[0];
  entities.currentAction.set(entityId, { actionType: ActionType.Walking });
  entities.nextWaypoint.set(entityId, { tileX: x, tileY: y });

  // Set initial direction
  const dx = next.x - pos.tileX;
  const dy = next.y - pos.tileY;
  const dir = directionFromDelta(dx, dy);
  if (dir !== undefined) entities.direction.set(entityId, { dir });
}

export function clearMoveTarget(entityId: number): void {
  moveStates.delete(entityId);
}

export function hasMoveTarget(entityId: number): boolean {
  return moveStates.has(entityId);
}

export function resetMovement(): void {
  moveStates.clear();
}

export function runMovement(entities: EntityManager, map: WorldMap, occupancy: OccupancyGrid): void {
  // Process in entity ID order for deterministic collision resolution
  const sorted = [...moveStates.entries()].sort((a, b) => a[0] - b[0]);

  for (const [eid, state] of sorted) {
    const pos = entities.position.get(eid);
    if (!pos) {
      moveStates.delete(eid);
      continue;
    }

    // Cooldown
    if (state.cooldownRemaining > 0) {
      state.cooldownRemaining--;
      continue;
    }

    // Reached end of path?
    if (state.pathIndex >= state.path.length) {
      arriveIdle(eid, entities);
      moveStates.delete(eid);
      continue;
    }

    const next = state.path[state.pathIndex];

    // Check occupancy
    if (occupancy.isOccupied(next.x, next.y) && occupancy.get(next.x, next.y) !== eid) {
      state.waitTicks++;
      if (state.waitTicks >= WAIT_PATIENCE) {
        // Re-path around blocker
        const result = findPath(
          pos.tileX, pos.tileY, state.targetX, state.targetY,
          (px, py) => !map.isWalkable(px, py) || (occupancy.isOccupied(px, py) && occupancy.get(px, py) !== eid),
          map.width, map.height,
        );
        if (result.found && result.path.length > 0) {
          state.path = result.path;
          state.pathIndex = 0;
          state.waitTicks = 0;
        } else {
          // No route — give up
          arriveIdle(eid, entities);
          moveStates.delete(eid);
        }
      }
      continue;
    }

    // Check terrain is still walkable (buildings can change)
    if (!map.isWalkable(next.x, next.y)) {
      // Re-path
      const result = findPath(
        pos.tileX, pos.tileY, state.targetX, state.targetY,
        (px, py) => !map.isWalkable(px, py) || (occupancy.isOccupied(px, py) && occupancy.get(px, py) !== eid),
        map.width, map.height,
      );
      if (result.found && result.path.length > 0) {
        state.path = result.path;
        state.pathIndex = 0;
        state.waitTicks = 0;
      } else {
        arriveIdle(eid, entities);
        moveStates.delete(eid);
      }
      continue;
    }

    // Move
    const dx = next.x - pos.tileX;
    const dy = next.y - pos.tileY;
    const dir = directionFromDelta(dx, dy);

    occupancy.move(pos.tileX, pos.tileY, next.x, next.y, eid);
    entities.position.set(eid, { tileX: next.x, tileY: next.y });
    if (dir !== undefined) entities.direction.set(eid, { dir });

    state.pathIndex++;
    state.waitTicks = 0;

    // Cooldown based on speed + diagonal cost
    const speed = entities.speed.get(eid) ?? 3;
    const ticksPerStep = Math.max(1, Math.round(TICK_RATE / speed));
    const diag = dir !== undefined && isDiagonal(dir);
    if (diag) {
      state.cooldownRemaining = state.diagonalCheap ? ticksPerStep - 1 : ticksPerStep * 2 - 1;
      state.diagonalCheap = !state.diagonalCheap;
    } else {
      state.cooldownRemaining = ticksPerStep - 1;
    }

    // Update waypoint/action
    entities.currentAction.set(eid, { actionType: ActionType.Walking });
    entities.nextWaypoint.set(eid, { tileX: state.targetX, tileY: state.targetY });

    // Check if we just arrived
    if (state.pathIndex >= state.path.length) {
      arriveIdle(eid, entities);
      moveStates.delete(eid);
    }
  }
}

function arriveIdle(eid: number, entities: EntityManager): void {
  entities.currentAction.set(eid, { actionType: ActionType.Idle });
  entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
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
