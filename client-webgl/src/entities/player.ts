// The click-controlled player entity. Wraps a CreatureState with a
// pendingCommand slot consumed at idle and at every tile boundary, so that
// mid-walk clicks redirect cleanly without teleports. Currently uses the deer
// sprite (DEER_BLUEPRINT) since there's no real player sprite yet.
//
// TODO: when network sync arrives, the local pendingCommand pipeline becomes
// "send a server move action" and the entity becomes a remote-driven creature.

import { MAP_SIZE } from '@shared/constants.js';
import { findPath } from '@shared/pathfinding.js';
import type { ClientEntity } from './client-entity.js';
import {
  createCreatureState,
  setCreaturePath,
  stopCreature,
  tickCreature,
  drawCreatureSprite,
} from './creature.js';
import type { SpriteRegistry, SpriteSheetRef } from './sprite-registry.js';
import { DEER_BLUEPRINT } from './sprite-manifest.js';

const MOVE_SPEED = 120;
const WALK_FRAMES = 6;

/**
 * Build a click-controlled player entity. Returns the entity (for the scene
 * map) and a `moveTo` handle (for the controls subsystem).
 */
function createPlayer(
  id: number,
  startX: number,
  startY: number,
  isBlocked: (x: number, y: number) => boolean,
  sheet: SpriteSheetRef,
): { entity: ClientEntity; moveTo: (tileX: number, tileY: number) => void } {
  const creature = createCreatureState(startX, startY, MOVE_SPEED, WALK_FRAMES);
  let pendingCommand: { x: number; y: number } | null = null;

  function applyPending() {
    if (!pendingCommand) return;
    const { x, y } = pendingCommand;
    pendingCommand = null;
    if (x === creature.tileX && y === creature.tileY) {
      stopCreature(creature);
      return;
    }
    const result = findPath(creature.tileX, creature.tileY, x, y, isBlocked, MAP_SIZE, MAP_SIZE);
    if (result.path.length === 0) {
      stopCreature(creature);
      return;
    }
    setCreaturePath(creature, result.path);
  }

  const entity: ClientEntity = {
    id,
    blueprintId: { blueprintId: DEER_BLUEPRINT },
    direction: { dir: creature.direction },
    spriteSheet: sheet,
    walkFrame: 0,
    frameTimer: 0,
    visualX: startX,
    visualY: startY,
    screenY: 0,

    tick(self, dt) {
      // Idle + pending: start the new path before ticking.
      if (!creature.moving && pendingCommand) {
        applyPending();
      }

      tickCreature(creature, dt, () => {
        // Mid-walk interrupt: consume pending command at tile boundary.
        if (pendingCommand) applyPending();
      });

      self.visualX = creature.visualX;
      self.visualY = creature.visualY;
      self.walkFrame = creature.walkFrame;
      self.direction = { dir: creature.direction };
    },

    draw(self, sprites, gl, offsetX, offsetY) {
      drawCreatureSprite(self, sprites, gl, offsetX, offsetY, creature.moving);
    },
  };

  return {
    entity,
    moveTo(tileX, tileY) {
      pendingCommand = { x: tileX, y: tileY };
    },
  };
}

/**
 * Spawn the player entity at (startX, startY), register it in the entity Map
 * under `id`, and return the id + the moveTo handle for wiring into
 * scene.playerControls.
 */
export function spawnPlayer(
  entities: Map<number, ClientEntity>,
  startX: number,
  startY: number,
  isBlocked: (x: number, y: number) => boolean,
  registry: SpriteRegistry,
  id: number,
): { id: number; moveTo: (tileX: number, tileY: number) => void } {
  const sheet = registry.resolve(DEER_BLUEPRINT, 0);
  const { entity, moveTo } = createPlayer(id, startX, startY, isBlocked, sheet);
  entities.set(id, entity);
  return { id, moveTo };
}
