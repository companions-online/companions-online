// TODO: delete this file once network sync provides server-side entities.
// The wandering deer is a placeholder NPC that wraps the shared creature state
// machine with random A* targets and a pause-between-segments behavior.

import { SPAWN_X, SPAWN_Y, MAP_SIZE } from '@shared/constants.js';
import { findPath } from '@shared/pathfinding.js';
import type { ClientEntity } from './client-entity.js';
import {
  createCreatureState,
  setCreaturePath,
  tickCreature,
  drawCreatureSprite,
} from './creature.js';
import type { SpriteRegistry, SpriteSheetRef } from './sprite-registry.js';
import { DEER_BLUEPRINT } from './sprite-manifest.js';

const MOVE_SPEED = 120;
const WALK_FRAMES = 6;
const PAUSE_CHANCE = 0.3;
const PAUSE_MIN = 1.0;
const PAUSE_MAX = 2.0;
const WANDER_RADIUS = 20;
const WANDER_STEP_MIN = 3;
const WANDER_STEP_MAX = 8;

function clampNum(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

function randomWanderTarget(
  homeX: number,
  homeY: number,
  isBlocked: (x: number, y: number) => boolean,
): { x: number; y: number } {
  for (let attempt = 0; attempt < 5; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = WANDER_STEP_MIN + Math.random() * (WANDER_STEP_MAX - WANDER_STEP_MIN);
    const tx = Math.round(homeX + dist * Math.cos(angle));
    const ty = Math.round(homeY + dist * Math.sin(angle));
    const cx = SPAWN_X, cy = SPAWN_Y;
    const x = clampNum(tx, Math.max(0, cx - WANDER_RADIUS), Math.min(MAP_SIZE - 1, cx + WANDER_RADIUS));
    const y = clampNum(ty, Math.max(0, cy - WANDER_RADIUS), Math.min(MAP_SIZE - 1, cy + WANDER_RADIUS));
    if (!isBlocked(x, y)) return { x, y };
  }
  return { x: homeX, y: homeY };
}

/**
 * Build a wandering deer ClientEntity. Wraps a CreatureState with random
 * wander-target planning and a paused/pauseTimer for between-segment idling.
 */
function createDeer(
  id: number,
  startX: number,
  startY: number,
  isBlocked: (x: number, y: number) => boolean,
  sheet: SpriteSheetRef,
): ClientEntity {
  const creature = createCreatureState(startX, startY, MOVE_SPEED, WALK_FRAMES);
  let paused = true;
  let pauseTimer = Math.random() * 2.0;

  function planNextSegment() {
    const target = randomWanderTarget(creature.tileX, creature.tileY, isBlocked);
    const result = findPath(creature.tileX, creature.tileY, target.x, target.y, isBlocked, MAP_SIZE, MAP_SIZE);
    if (result.path.length === 0) {
      paused = true;
      pauseTimer = 0.5;
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
      if (paused) {
        pauseTimer -= dt;
        if (pauseTimer <= 0) {
          paused = false;
          planNextSegment();
        }
      } else if (!creature.moving) {
        planNextSegment();
      }

      const wasMoving = creature.moving;
      tickCreature(creature, dt);
      // Just became idle this tick? Decide whether to enter pause.
      if (wasMoving && !creature.moving && !paused && Math.random() < PAUSE_CHANCE) {
        paused = true;
        pauseTimer = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
      }

      self.visualX = creature.visualX;
      self.visualY = creature.visualY;
      self.walkFrame = creature.walkFrame;
      self.direction = { dir: creature.direction };
    },

    draw(self, sprites, gl, offsetX, offsetY) {
      drawCreatureSprite(self, sprites, gl, offsetX, offsetY, creature.moving);
    },
  };

  return entity;
}

/**
 * Spawn `count` wandering deer around the map center, register them in the
 * entity Map under fresh sequential ids starting at `startId`, and return the
 * assigned ids.
 */
export function spawnDeer(
  entities: Map<number, ClientEntity>,
  count: number,
  isBlocked: (x: number, y: number) => boolean,
  registry: SpriteRegistry,
  startId: number = 1,
): number[] {
  const sheet = registry.resolve(DEER_BLUEPRINT, 0);
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const dist = 3 + Math.random() * 10;
    const sx = Math.round(SPAWN_X + dist * Math.cos(angle));
    const sy = Math.round(SPAWN_Y + dist * Math.sin(angle));
    const id = startId + i;
    entities.set(id, createDeer(id, sx, sy, isBlocked, sheet));
    ids.push(id);
  }
  return ids;
}
