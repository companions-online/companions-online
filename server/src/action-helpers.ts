import { getBlueprint, type BlueprintCategory } from '@shared/blueprints.js';
import type { SystemState } from './system-state.js';
import { Err, type RejectionReason } from './action-rejection.js';

export type TargetCheck =
  | { ok: true; pos: { tileX: number; tileY: number }; blueprintId: number; bpCategory: BlueprintCategory }
  | { ok: false; reason: RejectionReason };

/** Look up a target entity that the actor must stand adjacent to (Chebyshev≤1).
 *
 *  Centralizes the four-step preamble shared by Pickup, Interact, Transfer,
 *  DialogueSelect, and Trade: target_missing → wrong_target_kind →
 *  not_adjacent → return resolved (pos, blueprint).
 *
 *  Pass `expectedCategory` to enforce a category filter (e.g. 'placeable' for
 *  containers). Omit it for Interact/Pickup which accept multiple categories.
 */
export function requireAdjacentTarget(
  actorId: number,
  targetId: number,
  world: SystemState,
  opts?: { expectedCategory?: BlueprintCategory; expectedLabel?: string },
): TargetCheck {
  const actorPos = world.entities.position.get(actorId);
  if (!actorPos) return Err({ code: 'target_missing', targetEntityId: actorId });

  const targetPos = world.entities.position.get(targetId);
  const bp = world.entities.blueprint.get(targetId);
  if (!targetPos || !bp) return Err({ code: 'target_missing', targetEntityId: targetId });

  const bpDef = getBlueprint(bp.blueprintId);
  if (opts?.expectedCategory && (!bpDef || bpDef.category !== opts.expectedCategory)) {
    return Err({
      code: 'wrong_target_kind', targetEntityId: targetId,
      expected: opts.expectedLabel ?? opts.expectedCategory,
      got: bpDef?.category ?? 'unknown',
    });
  }

  const dist = Math.max(Math.abs(targetPos.tileX - actorPos.tileX), Math.abs(targetPos.tileY - actorPos.tileY));
  if (dist > 1) {
    return Err({ code: 'not_adjacent', targetEntityId: targetId, dist });
  }

  return {
    ok: true,
    pos: targetPos,
    blueprintId: bp.blueprintId,
    bpCategory: bpDef?.category ?? 'unknown' as BlueprintCategory,
  };
}
