import { ActionType } from '@shared/actions.js';
import { Direction, DX, DY, isDiagonal } from '@shared/direction.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { TICK_RATE } from '@shared/constants.js';
import { findPath } from '@shared/pathfinding.js';
import type { SystemState, MovementState } from '../system-state.js';

const WAIT_PATIENCE = 10;

export function setMoveTarget(
  entityId: number, x: number, y: number, world: SystemState,
): void {
  const pos = world.entities.position.get(entityId);
  if (!pos) return;

  const result = findPath(
    pos.tileX, pos.tileY, x, y,
    (px, py) => !world.map.isWalkable(px, py) || (world.occupancy.isOccupied(px, py) && world.occupancy.get(px, py) !== entityId),
    world.map.width, world.map.height,
  );

  if (!result.found || result.path.length === 0) return;

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
}

export function clearMoveTarget(entityId: number, world: SystemState): void {
  world.moveStates.delete(entityId);
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
      arriveIdle(eid, world);
      world.moveStates.delete(eid);
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
          arriveIdle(eid, world);
          world.moveStates.delete(eid);
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
        arriveIdle(eid, world);
        world.moveStates.delete(eid);
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
      arriveIdle(eid, world);
      world.moveStates.delete(eid);
    }
  }
}

function arriveIdle(eid: number, world: SystemState): void {
  world.entities.currentAction.set(eid, { actionType: ActionType.Idle });
  world.entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
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
