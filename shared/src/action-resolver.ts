import { ClientAction } from './actions.js';
import { getBlueprint, BlueprintType } from './blueprints.js';
import { Terrain } from './terrain.js';
import type { DecodedAction } from './protocol/codec.js';

export interface ActionContext {
  targetX: number;
  targetY: number;
  isWalkable: boolean;
  terrainType?: Terrain;
  entityAtTarget?: { entityId: number; blueprintId: number; isGroundItem?: boolean };
  equippedHandBlueprintId?: number;
}

/** Determine the right action for a given target tile. Returns null if no action possible. */
export function resolveAction(ctx: ActionContext): DecodedAction | null {
  if (ctx.entityAtTarget) {
    const bp = getBlueprint(ctx.entityAtTarget.blueprintId);
    if (bp) {
      // Placed Tree → Harvest. Must precede the generic resource→Pickup below,
      // since Tree's category is 'resource' (same as dropped Wood/Rock/etc).
      if (ctx.entityAtTarget.blueprintId === BlueprintType.Tree) {
        return { action: ClientAction.Harvest, tileX: ctx.targetX, tileY: ctx.targetY };
      }
      if (bp.category === 'item' || bp.category === 'resource' || (bp.category === 'placeable' && ctx.entityAtTarget.isGroundItem)) {
        return { action: ClientAction.Pickup, entityId: ctx.entityAtTarget.entityId };
      }
      // Living creature (not tree, not player) → Attack
      if (bp.category === 'creature' && ctx.entityAtTarget.blueprintId !== BlueprintType.Player) {
        return { action: ClientAction.Attack, entityId: ctx.entityAtTarget.entityId };
      }
      // Interactive placeables → Interact
      if (ctx.entityAtTarget.blueprintId === BlueprintType.WoodenDoor ||
          ctx.entityAtTarget.blueprintId === BlueprintType.StorageChest) {
        return { action: ClientAction.Interact, entityId: ctx.entityAtTarget.entityId };
      }
      // NPCs → Interact
      if (bp.category === 'npc') {
        return { action: ClientAction.Interact, entityId: ctx.entityAtTarget.entityId };
      }
    }
  }

  // Rock terrain = mineable hill
  if (ctx.terrainType === Terrain.Rock) {
    return { action: ClientAction.Harvest, tileX: ctx.targetX, tileY: ctx.targetY };
  }

  // Water / River with fishing rod → Fish. Otherwise fall through to the
  // walkability check so bridged rivers (river + floor) route to MoveTo.
  if ((ctx.terrainType === Terrain.Water || ctx.terrainType === Terrain.River) &&
      ctx.equippedHandBlueprintId === BlueprintType.FishingRod) {
    return { action: ClientAction.Harvest, tileX: ctx.targetX, tileY: ctx.targetY };
  }

  if (!ctx.isWalkable) return null;
  return { action: ClientAction.MoveTo, tileX: ctx.targetX, tileY: ctx.targetY };
}

/** Human-readable label for an action (for status bar display). */
export function describeAction(action: DecodedAction | null, ctx?: ActionContext): string {
  if (!action) return '---';
  switch (action.action) {
    case ClientAction.MoveTo: return 'move';
    case ClientAction.Pickup: {
      if (ctx?.entityAtTarget) {
        const bp = getBlueprint(ctx.entityAtTarget.blueprintId);
        if (bp) return `pickup ${bp.name}`;
      }
      return 'pickup';
    }
    case ClientAction.Harvest: {
      if (ctx?.entityAtTarget) {
        if (ctx.entityAtTarget.blueprintId === BlueprintType.Tree) return 'chop';
        // HillRock removed — terrain-based mining handled below
      }
      if (ctx?.terrainType === Terrain.Rock) return 'mine';
      if (ctx?.terrainType === Terrain.Water || ctx?.terrainType === Terrain.River) return 'fish';
      return 'harvest';
    }
    case ClientAction.Attack: {
      if (ctx?.entityAtTarget) {
        const bp = getBlueprint(ctx.entityAtTarget.blueprintId);
        if (bp) return `attack ${bp.name}`;
      }
      return 'attack';
    }
    case ClientAction.Interact: {
      if (ctx?.entityAtTarget) {
        const ibp = getBlueprint(ctx.entityAtTarget.blueprintId);
        if (ibp) {
          if (ctx.entityAtTarget.blueprintId === BlueprintType.WoodenDoor) return 'toggle door';
          if (ctx.entityAtTarget.blueprintId === BlueprintType.StorageChest) return 'open chest';
          if (ibp.category === 'npc') return `talk to ${ibp.name}`;
        }
      }
      return 'interact';
    }
    case ClientAction.Cancel: return 'cancel';
    default: return 'act';
  }
}
