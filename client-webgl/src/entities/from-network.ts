// Network entity dispatch. Given a server-delivered entity id + components,
// pick the right factory by blueprint category and return a ClientEntity.
// Categories without a dedicated factory fall through to the static factory
// (single-frame draw); blueprints with no sprite manifest entry use the
// unknown-entity sheet via spriteRegistry.resolve's fallback.

import { getBlueprint } from '@shared/blueprints.js';
import type { EntityComponents } from '@shared/protocol/codec.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { ClientEntity } from './client-entity.js';
import type { SpriteRegistry } from './sprite-registry.js';
import { createCreatureEntity } from './creature-entity.js';
import { createStaticEntity } from './static-entity.js';

export function createEntityFromNetwork(
  id: number,
  components: EntityComponents,
  spriteRegistry: SpriteRegistry,
  worldMap: WorldMap,
): ClientEntity {
  const bp = components.blueprint;
  const blueprint = bp ? getBlueprint(bp.blueprintId) : undefined;
  const sheet = spriteRegistry.resolve(bp?.blueprintId ?? -1, bp?.variant ?? 0);

  switch (blueprint?.category) {
    case 'creature':
    case 'npc':
      return createCreatureEntity(id, components, sheet);
    case 'placeable':
    case 'item':
    case 'resource':
    default:
      return createStaticEntity(id, components, sheet, worldMap);
  }
}

/** Merge a partial component update into an existing entity. Only fields
 *  present in `next` overwrite — undefined fields preserve current state. */
export function applyComponentsToEntity(e: ClientEntity, next: EntityComponents): void {
  if (next.position !== undefined) e.position = next.position;
  if (next.direction !== undefined) e.direction = next.direction;
  if (next.nextWaypoint !== undefined) e.nextWaypoint = next.nextWaypoint;
  if (next.currentAction !== undefined) e.currentAction = next.currentAction;
  if (next.health !== undefined) e.health = next.health;
  if (next.statusEffects !== undefined) e.statusEffects = next.statusEffects;
  if (next.blueprint !== undefined) e.blueprint = next.blueprint;
}
