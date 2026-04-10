// TODO: delete this file once network sync provides server-side entities.
// The local-wander deer is a placeholder so the renderer + camera-follow path
// has something to exercise during development. The wander state machine is
// preserved verbatim from the previous Entity-interface implementation; only
// the wrapper around it changed (now produces a ClientEntity).

import { tileToScreen } from '@shared/coordinates.js';
import { SPAWN_X, SPAWN_Y, MAP_SIZE } from '@shared/constants.js';
import { DX, DY, Direction } from '@shared/direction.js';
import { findPath } from '@shared/pathfinding.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { ClientEntity } from './client-entity.js';
import type { SpriteRenderer } from './sprite-renderer.js';
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

function deltaToDirection(dx: number, dy: number): number {
  for (let d = 0; d < 8; d++) {
    if (DX[d] === dx && DY[d] === dy) return d;
  }
  return Direction.S;
}

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
 * Build a wandering deer ClientEntity. The wander state lives in this
 * function's closure (paused, pauseTimer, path, pathIndex, walkFrame, walkTimer,
 * moveProgress, etc.); the entity's `tick` callback runs the state machine each
 * frame and copies the resulting visual position out to `e.visualX/visualY`.
 */
function createDeer(
  id: number,
  startX: number,
  startY: number,
  isBlocked: (x: number, y: number) => boolean,
  sheet: SpriteSheetRef,
): ClientEntity {
  let tileX = startX;
  let tileY = startY;
  let prevTileX = tileX;
  let prevTileY = tileY;
  let direction = Direction.S as number;
  let moving = false;
  let moveProgress = 0;
  let moveDuration = 0.3;

  let walkFrame = 0;
  let walkTimer = 0;
  let walkFrameDuration = 0.2;

  let path: { x: number; y: number }[] = [];
  let pathIndex = 0;

  let paused = true;
  let pauseTimer = Math.random() * 2.0;

  let cachedInterpTileX = startX;
  let cachedInterpTileY = startY;

  function startStep() {
    const target = path[pathIndex];
    prevTileX = tileX;
    prevTileY = tileY;
    const dx = target.x - tileX;
    const dy = target.y - tileY;
    direction = deltaToDirection(dx, dy);
    const from = tileToScreen(tileX, tileY, TILE_W, TILE_H);
    const to = tileToScreen(target.x, target.y, TILE_W, TILE_H);
    const sdx = to.screenX - from.screenX;
    const sdy = to.screenY - from.screenY;
    moveDuration = Math.sqrt(sdx * sdx + sdy * sdy) / MOVE_SPEED;
    walkFrameDuration = moveDuration / WALK_FRAMES;
    moveProgress = 0;
    moving = true;
    walkTimer = 0;
  }

  function planNextSegment() {
    const target = randomWanderTarget(tileX, tileY, isBlocked);
    const result = findPath(tileX, tileY, target.x, target.y, isBlocked, MAP_SIZE, MAP_SIZE);
    path = result.path;
    pathIndex = 0;

    if (path.length === 0) {
      paused = true;
      pauseTimer = 0.5;
      return;
    }

    startStep();
  }

  function computeInterp() {
    if (moving) {
      const target = path[pathIndex];
      const t = Math.min(moveProgress, 1);
      cachedInterpTileX = prevTileX + (target.x - prevTileX) * t;
      cachedInterpTileY = prevTileY + (target.y - prevTileY) * t;
    } else {
      cachedInterpTileX = tileX;
      cachedInterpTileY = tileY;
    }
  }

  const entity: ClientEntity = {
    id,
    blueprintId: { blueprintId: DEER_BLUEPRINT },
    direction: { dir: direction },
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
      } else if (!moving) {
        planNextSegment();
      } else {
        moveProgress += dt / moveDuration;

        walkTimer += dt;
        if (walkTimer >= walkFrameDuration) {
          walkTimer -= walkFrameDuration;
          walkFrame = (walkFrame + 1) % WALK_FRAMES;
        }

        if (moveProgress >= 1.0) {
          const target = path[pathIndex];
          tileX = target.x;
          tileY = target.y;
          pathIndex++;

          if (pathIndex < path.length) {
            startStep();
          } else {
            moving = false;
            walkFrame = 0;

            if (Math.random() < PAUSE_CHANCE) {
              paused = true;
              pauseTimer = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
            }
          }
        }
      }

      computeInterp();
      self.visualX = cachedInterpTileX;
      self.visualY = cachedInterpTileY;
      self.walkFrame = walkFrame;
      self.direction = { dir: direction };
    },

    draw(self, sprites, gl, offsetX, offsetY) {
      const screen = tileToScreen(self.visualX, self.visualY, TILE_W, TILE_H);
      self.screenY = screen.screenY;

      const dir = self.direction?.dir ?? Direction.S;
      const col = moving ? 1 + self.walkFrame : 0;
      const row = (dir + 1) % 8;
      const sx = col * sheet.frameW;
      const sy = row * sheet.frameH;

      const dstX = screen.screenX + offsetX + TILE_W / 2 - sheet.footX;
      const dstY = screen.screenY + offsetY + TILE_H / 2 - sheet.footY;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sheet.texture);
      sprites.drawSprite(
        dstX, dstY, sheet.frameW, sheet.frameH,
        sx / sheet.sheetW, sy / sheet.sheetH,
        sheet.frameW / sheet.sheetW, sheet.frameH / sheet.sheetH,
      );
    },
  };

  return entity;
}

/**
 * Spawn `count` wandering deer around the map center, register them in the
 * entity Map under fresh sequential ids, and return the assigned ids so the
 * caller can pick (e.g.) the first deer as the camera-follow target.
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
