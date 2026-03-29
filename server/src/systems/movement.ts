import { ActionType } from '@shared/actions.js';
import { Direction } from '@shared/direction.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { TICK_RATE } from '@shared/constants.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { EntityManager } from '../ecs/entity-manager.js';

interface MoveTarget {
  x: number;
  y: number;
}

const moveTargets = new Map<number, MoveTarget>();
const moveCooldowns = new Map<number, number>();

export function setMoveTarget(entityId: number, x: number, y: number): void {
  moveTargets.set(entityId, { x, y });
  moveCooldowns.set(entityId, 0); // ready to step immediately
}

export function clearMoveTarget(entityId: number): void {
  moveTargets.delete(entityId);
  moveCooldowns.delete(entityId);
}

export function runMovement(entities: EntityManager, map: WorldMap): void {
  for (const [eid, target] of moveTargets) {
    const pos = entities.position.get(eid);
    if (!pos) {
      moveTargets.delete(eid);
      continue;
    }

    // Cooldown: how many ticks between steps
    const speed = entities.speed.get(eid) ?? 3;
    const ticksPerStep = Math.max(1, Math.round(TICK_RATE / speed));

    let cd = moveCooldowns.get(eid) ?? 0;
    if (cd > 0) {
      moveCooldowns.set(eid, cd - 1);
      continue;
    }

    // Already at target?
    if (pos.tileX === target.x && pos.tileY === target.y) {
      entities.currentAction.set(eid, { actionType: ActionType.Idle });
      entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
      moveTargets.delete(eid);
      moveCooldowns.delete(eid);
      continue;
    }

    // Pick direction toward target
    const dx = target.x - pos.tileX;
    const dy = target.y - pos.tileY;

    // Try primary axis first (greater distance), then secondary
    const tryAxes: { nx: number; ny: number; dir: Direction }[] = [];

    if (Math.abs(dx) >= Math.abs(dy)) {
      // Primary: horizontal
      if (dx !== 0) tryAxes.push({ nx: pos.tileX + Math.sign(dx), ny: pos.tileY, dir: dx > 0 ? Direction.E : Direction.W });
      if (dy !== 0) tryAxes.push({ nx: pos.tileX, ny: pos.tileY + Math.sign(dy), dir: dy > 0 ? Direction.S : Direction.N });
    } else {
      // Primary: vertical
      if (dy !== 0) tryAxes.push({ nx: pos.tileX, ny: pos.tileY + Math.sign(dy), dir: dy > 0 ? Direction.S : Direction.N });
      if (dx !== 0) tryAxes.push({ nx: pos.tileX + Math.sign(dx), ny: pos.tileY, dir: dx > 0 ? Direction.E : Direction.W });
    }

    let moved = false;
    for (const attempt of tryAxes) {
      if (map.isWalkable(attempt.nx, attempt.ny)) {
        entities.position.set(eid, { tileX: attempt.nx, tileY: attempt.ny });
        entities.direction.set(eid, { dir: attempt.dir });
        entities.nextWaypoint.set(eid, { tileX: target.x, tileY: target.y });
        entities.currentAction.set(eid, { actionType: ActionType.Walking });
        moveCooldowns.set(eid, ticksPerStep - 1);
        moved = true;
        break;
      }
    }

    if (!moved) {
      // Blocked on both axes — cancel
      entities.currentAction.set(eid, { actionType: ActionType.Idle });
      entities.nextWaypoint.set(eid, { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
      moveTargets.delete(eid);
      moveCooldowns.delete(eid);
    }
  }
}
