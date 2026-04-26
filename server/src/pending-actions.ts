/**
 * Unified "walk to target, then perform an effect" queue.
 *
 * Replaces the per-action `pendingPickups` / `pendingInteracts` maps and
 * extends the same pattern to Transfer, Trade, DialogueSelect, and UseItemAt
 * (placement). One map + one resolver = one place where every walk-to-act
 * failure surfaces a structured rejection.
 *
 * `setMoveTarget('near')` already routes the actor to a walkable adjacent
 * tile when the goal itself is unwalkable (see findPath's adjacent-fallback
 * in shared/src/pathfinding.ts), so unwalkable targets like a river tile
 * (place wooden floor on river) Just Work without per-handler neighbor
 * enumeration.
 */

import { ClientAction, ActionType } from '@shared/actions.js';
import type { GameWorld, PlayerSlot } from './game-world.js';
import { setMoveTarget, hasMoveTarget } from './systems/movement.js';
import { rejectAction } from './world-actions.js';
import { type ActionResult } from './action-rejection.js';

export type PendingTarget =
  | { kind: 'entity'; entityId: number }      // re-aim if it moves
  | { kind: 'tile';   x: number; y: number }; // adjacent-fallback handles unwalkable

export type ExecuteFn = (world: GameWorld, eid: number, slot: PlayerSlot) => ActionResult;

export interface PendingAction {
  kind: ClientAction;                       // for cancel diagnostics + interrupted events
  target: PendingTarget;
  arrivalRange: 1 | 2;                      // 1 for adjacency; 2 for placement
  execute: ExecuteFn;
  /** Last target tile we pathfound toward — used to detect entity drift and
   *  re-aim. Bounded by target movement rate (entities have a `speed`
   *  component and step at ticks-per-step), not by server tick rate. */
  lastAimedAt: { x: number; y: number };
}

/** Map ClientAction → readable label for `action_interrupted` event payloads.
 *  Mirrors the labels the LLM sees in MCP tool descriptions. */
export function actionKindLabel(kind: ClientAction): string {
  switch (kind) {
    case ClientAction.Pickup:         return 'pickup';
    case ClientAction.Interact:       return 'interact';
    case ClientAction.Transfer:       return 'transfer';
    case ClientAction.DialogueSelect: return 'dialogue';
    case ClientAction.Trade:          return 'trade';
    case ClientAction.UseItemAt:      return 'use item';
    default:                          return 'action';
  }
}

function resolveTargetPos(world: GameWorld, t: PendingTarget): { x: number; y: number } | null {
  if (t.kind === 'tile') return { x: t.x, y: t.y };
  const p = world.entities.position.get(t.entityId);
  if (!p || !world.entities.exists(t.entityId)) return null;
  return { x: p.tileX, y: p.tileY };
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Dispatch helper used by every walk-to-act handler.
 *
 * - If the actor is already in range, run `execute` synchronously (zero-tick
 *   completion — preserves MCP awaitAction's same-tick resolve).
 * - Otherwise schedule a pending action and start movement. If movement
 *   itself rejects (no_path / tile_out_of_bounds / etc.), surface the
 *   rejection — this is the bug the unified path was designed to fix.
 */
export function scheduleOrExecute(
  world: GameWorld, eid: number, slot: PlayerSlot,
  kind: ClientAction,
  target: PendingTarget,
  arrivalRange: 1 | 2,
  execute: ExecuteFn,
): void {
  const playerPos = world.entities.position.get(eid);
  if (!playerPos) return;

  const targetPos = resolveTargetPos(world, target);
  if (!targetPos) {
    const tid = target.kind === 'entity' ? target.entityId : 0;
    rejectAction(world, eid, { code: 'target_missing', targetEntityId: tid });
    return;
  }

  const dist = chebyshev(playerPos.tileX, playerPos.tileY, targetPos.x, targetPos.y);
  if (dist <= arrivalRange) {
    const r = execute(world, eid, slot);
    if (!r.ok) rejectAction(world, eid, r.reason);
    return;
  }

  const mr = setMoveTarget(eid, targetPos.x, targetPos.y, world, 'near');
  if (!mr.ok) {
    rejectAction(world, eid, mr.reason);
    return;
  }

  world.pendingActions.set(eid, {
    kind, target, arrivalRange, execute,
    lastAimedAt: { x: targetPos.x, y: targetPos.y },
  });
}

/**
 * Tick-loop resolver. Runs once per tick after movement so `hasMoveTarget`
 * reflects post-movement state. Single source of truth for arrival, target
 * loss, path failure, and entity re-aim.
 */
export function runPendingActions(world: GameWorld): void {
  for (const [eid, pa] of world.pendingActions) {
    const ca = world.entities.currentAction.get(eid);
    if (!ca || ca.actionType === ActionType.Dead) {
      // Death cleanup (handlePlayerDeath) deletes too, but defend against
      // edge cases where currentAction flips Dead between phases.
      world.pendingActions.delete(eid);
      continue;
    }

    const playerPos = world.entities.position.get(eid);
    if (!playerPos) {
      world.pendingActions.delete(eid);
      continue;
    }

    const targetPos = resolveTargetPos(world, pa.target);
    if (!targetPos) {
      world.pendingActions.delete(eid);
      const tid = pa.target.kind === 'entity' ? pa.target.entityId : 0;
      rejectAction(world, eid, { code: 'target_missing', targetEntityId: tid });
      continue;
    }

    const dist = chebyshev(playerPos.tileX, playerPos.tileY, targetPos.x, targetPos.y);
    if (dist <= pa.arrivalRange) {
      const slot = world.players.get(eid);
      world.pendingActions.delete(eid);
      if (slot) {
        const r = pa.execute(world, eid, slot);
        if (!r.ok) rejectAction(world, eid, r.reason);
      }
      continue;
    }

    if (!hasMoveTarget(eid, world)) {
      // Movement system gave up (tried to repath, failed, cleared moveState).
      // Try once more from here; if it also fails, surface no_path so the
      // pending action doesn't sit in the map forever.
      const r = setMoveTarget(eid, targetPos.x, targetPos.y, world, 'near');
      if (!r.ok) {
        world.pendingActions.delete(eid);
        rejectAction(world, eid, r.reason);
      } else {
        pa.lastAimedAt = { x: targetPos.x, y: targetPos.y };
      }
      continue;
    }

    if (pa.target.kind === 'entity' &&
        (pa.lastAimedAt.x !== targetPos.x || pa.lastAimedAt.y !== targetPos.y)) {
      const r = setMoveTarget(eid, targetPos.x, targetPos.y, world, 'near');
      if (r.ok) {
        pa.lastAimedAt = { x: targetPos.x, y: targetPos.y };
      } else {
        world.pendingActions.delete(eid);
        rejectAction(world, eid, r.reason);
      }
    }
  }
}
