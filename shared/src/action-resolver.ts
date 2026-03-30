import { ClientAction } from './actions.js';
import { getBlueprint } from './blueprints.js';
import type { DecodedAction } from './protocol/codec.js';

export interface ActionContext {
  targetX: number;
  targetY: number;
  isWalkable: boolean;
  entityAtTarget?: { entityId: number; blueprintId: number };
}

/** Determine the right action for a given target tile. Returns null if no action possible. */
export function resolveAction(ctx: ActionContext): DecodedAction | null {
  if (ctx.entityAtTarget) {
    const bp = getBlueprint(ctx.entityAtTarget.blueprintId);
    if (bp && (bp.category === 'item' || bp.category === 'resource')) {
      return { action: ClientAction.Pickup, entityId: ctx.entityAtTarget.entityId };
    }
  }

  if (!ctx.isWalkable) return null;
  return { action: ClientAction.MoveTo, tileX: ctx.targetX, tileY: ctx.targetY };
}
