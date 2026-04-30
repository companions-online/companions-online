import { Direction } from '@shared/direction.js';
import { ActionType } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { WAYPOINT_NONE } from '@shared/components.js';
import { StatusEffect } from '@shared/status-effects.js';
import type { SystemState } from './system-state.js';

/** Worldgen/spawn-path classifier: does this blueprint default to ground-item
 *  shape when freshly spawned (no Placed bit context)? True for the pure-
 *  pickup categories (resource/item, excluding Tree). False for placeable —
 *  worldgen places placeables as installed structures (Placed bit set), and
 *  /spawn rejects placeable category outright. The drop / loot paths spawn
 *  any blueprint as a ground item directly via spawnGroundItem and do not
 *  consult this predicate. */
export function isGroundItemBlueprint(blueprintId: BlueprintType): boolean {
  const bp = getBlueprint(blueprintId);
  if (!bp) return false;
  if (blueprintId === BlueprintType.Tree) return false;
  return bp.category === 'resource' || bp.category === 'item';
}

/** Load-path classifier: should a saved entity reload as a ground item
 *  (no statusEffects component, no occupancy)? The Placed bit on the saved
 *  statusEffects byte is the canonical signal. A placeable saved with Placed
 *  reloads as an installed structure; a placeable saved without (i.e. dropped
 *  from inventory) reloads as a ground item. Pure-pickup blueprints (resource
 *  and item categories — Wood, Rock, Iron, tools, weapons, armor,
 *  consumables) always reload as ground items. Tree, creature, NPC always
 *  reload as creatures. */
export function shouldRestoreAsGround(blueprintId: BlueprintType, statusEffects: number): boolean {
  const bp = getBlueprint(blueprintId);
  if (!bp) return false;
  if (blueprintId === BlueprintType.Tree) return false;
  const isPickupCategorical = bp.category === 'resource' || bp.category === 'item' || bp.category === 'placeable';
  if (!isPickupCategorical) return false;
  return (statusEffects & StatusEffect.Placed) === 0;
}

/** Optional saved-value overrides for the load path. Fresh spawns omit them
 *  and resolve defaults from the blueprint. */
export interface CreatureOverrides {
  /** Pre-supplied entity id (loadWorld restores by saved id via createWithId).
   *  Omit for fresh spawns to mint via entities.create(). */
  id?: number;
  variant?: number;
  direction?: Direction;
  waypoint?: { tileX: number; tileY: number };
  action?: { actionType: number; targetEntity?: number; targetTileX?: number; targetTileY?: number };
  health?: { currentHp: number; maxHp: number };
  /** Raw effects byte. Default: StatusEffect.Placed for placeable+Tree, 0 otherwise. */
  statusEffects?: number;
  speed?: number;
}

/** Spawn a creature, NPC, or placed structure. Sets the full creature/
 *  structure component shape (position, direction, waypoint, action, health,
 *  blueprint, statusEffects, speed) and registers occupancy.
 *
 *  Open-door restore: if the resolved statusEffects has StatusEffect.Open
 *  set, the entity is NOT registered in the occupancy grid — open doors
 *  are walk-through. This matters on load: a saved open door must reload
 *  with cleared occupancy, otherwise it'd phase back into a blocker.
 *
 *  No category guard — caller decides shape. Pure-pickup blueprints (Rock,
 *  Iron, etc.) shouldn't normally come through here, but the helper trusts
 *  the caller rather than throwing. */
export function spawnCreatureEntity(
  world: SystemState,
  blueprintId: BlueprintType,
  tileX: number,
  tileY: number,
  overrides: CreatureOverrides = {},
): number {
  const bp = getBlueprint(blueprintId);
  if (!bp) throw new Error(`unknown blueprint ${blueprintId}`);

  let eid: number;
  if (overrides.id !== undefined) {
    world.entities.createWithId(overrides.id);
    eid = overrides.id;
  } else {
    eid = world.entities.create();
  }

  world.entities.position.set(eid, { tileX, tileY });
  world.entities.direction.set(eid, { dir: overrides.direction ?? Direction.S });
  world.entities.nextWaypoint.set(eid, overrides.waypoint ?? { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE });
  world.entities.currentAction.set(eid, overrides.action ?? { actionType: ActionType.Idle });

  if (overrides.health) {
    world.entities.health.set(eid, overrides.health);
  } else if (bp.maxHp) {
    world.entities.health.set(eid, { currentHp: bp.maxHp, maxHp: bp.maxHp });
  }

  world.entities.blueprint.set(eid, { blueprintId, variant: overrides.variant ?? 0 });

  // Default effects: structures (placeable category + Tree) carry the Placed
  // bit so MCP/WebGL/CLI classifiers distinguish them from ground items.
  // Creatures and NPCs default to 0.
  const isStructure = bp.category === 'placeable' || blueprintId === BlueprintType.Tree;
  const defaultEffects = isStructure ? StatusEffect.Placed : 0;
  const effects = overrides.statusEffects ?? defaultEffects;
  world.entities.statusEffects.set(eid, { effects });

  if (overrides.speed !== undefined) {
    world.entities.speed.set(eid, overrides.speed);
  } else if (bp.speed) {
    world.entities.speed.set(eid, bp.speed);
  }

  // Open doors are walk-through — skip occupancy registration. Fresh spawns
  // never have the Open bit, so this gate is a no-op for them; it's the
  // load-path correctness for saved open doors.
  const isOpen = (effects & StatusEffect.Open) !== 0;
  if (!isOpen) {
    world.occupancy.set(tileX, tileY, eid);
  }

  return eid;
}

/** Spawn a ground-item entity (dropped pickup). Position + blueprint only —
 *  no statusEffects component, no occupancy. The absence of StatusEffect.Placed
 *  is what distinguishes ground items from placed structures.
 *
 *  Accepts any pickup-categorical blueprint (resource/item/placeable). Drop
 *  and loot paths spawn placeables this way (e.g. dropping a Campfire from
 *  inventory creates a ground entity until UseItemAt placed it). */
export function spawnGroundItem(
  world: SystemState,
  blueprintId: BlueprintType,
  tileX: number,
  tileY: number,
  id?: number,
): number {
  let eid: number;
  if (id !== undefined) {
    world.entities.createWithId(id);
    eid = id;
  } else {
    eid = world.entities.create();
  }
  world.entities.position.set(eid, { tileX, tileY });
  world.entities.blueprint.set(eid, { blueprintId, variant: 0 });
  return eid;
}
