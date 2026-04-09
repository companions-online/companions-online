import { tileToScreen } from '@shared/coordinates.js';
import { SPAWN_X, SPAWN_Y, MAP_SIZE } from '@shared/constants.js';
import { DX, DY, Direction } from '@shared/direction.js';
import { findPath } from '@shared/pathfinding.js';
import { TILE_W, TILE_H } from './config.js';
import type { Entity, ControllableEntity } from './entity.js';
import type { Scene } from './scene.js';

const FRAME_W = 92;
const FRAME_H = 92;

const FOOT_X = 46;
const FOOT_Y = 70;

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

function randomWanderTarget(homeX: number, homeY: number, isBlocked: (x: number, y: number) => boolean): { x: number; y: number } {
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

export function createDeer(
  startX: number,
  startY: number,
  isBlocked: (x: number, y: number) => boolean,
  sprite: CanvasImageSource | null,
): Entity {
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

  let cachedScreenY = 0;
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

  function update(dt: number) {
    if (paused) {
      pauseTimer -= dt;
      if (pauseTimer <= 0) {
        paused = false;
        planNextSegment();
      }
      return;
    }

    if (!moving) {
      planNextSegment();
      return;
    }

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

    computeInterp();
  }

  function draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number) {
    computeInterp();
    const screen = tileToScreen(cachedInterpTileX, cachedInterpTileY, TILE_W, TILE_H);
    cachedScreenY = screen.screenY;

    if (!sprite) return;

    const col = moving ? 1 + walkFrame : 0;
    const row = (direction + 1) % 8;
    const sx = col * FRAME_W;
    const sy = row * FRAME_H;

    const dstX = screen.screenX + offsetX + TILE_W / 2 - FOOT_X;
    const dstY = screen.screenY + offsetY + TILE_H / 2 - FOOT_Y;

    ctx.drawImage(sprite, sx, sy, FRAME_W, FRAME_H, dstX, dstY, FRAME_W, FRAME_H);
  }

  return {
    update,
    draw,
    screenY: () => cachedScreenY,
    interpTileX: () => cachedInterpTileX,
    interpTileY: () => cachedInterpTileY,
  };
}

/**
 * Create a click-controlled deer. Starts idle and only moves when moveTo is
 * called. Shares the same walk/animation state machine as createDeer; the
 * only differences are:
 *   - no random-wander path planning
 *   - moveTo(tx, ty) enqueues a fresh A* path from the current tile
 *   - moveTo called mid-walk is deferred to the next segment boundary so the
 *     current step finishes cleanly (no visual teleport)
 */
export function createPlayerDeer(
  startX: number,
  startY: number,
  isBlocked: (x: number, y: number) => boolean,
  sprite: CanvasImageSource | null,
): ControllableEntity {
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

  // When set, consumed at the next segment boundary (or immediately if idle)
  // to replan from the current whole tile. Set by moveTo().
  let pendingCommand: { x: number; y: number } | null = null;

  let cachedScreenY = 0;
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

  function applyPendingCommand() {
    if (!pendingCommand) return;
    const target = pendingCommand;
    pendingCommand = null;
    if (target.x === tileX && target.y === tileY) {
      path = [];
      pathIndex = 0;
      moving = false;
      walkFrame = 0;
      return;
    }
    const result = findPath(tileX, tileY, target.x, target.y, isBlocked, MAP_SIZE, MAP_SIZE);
    if (result.path.length === 0) {
      // No reachable path — stay idle.
      path = [];
      pathIndex = 0;
      moving = false;
      walkFrame = 0;
      return;
    }
    path = result.path;
    pathIndex = 0;
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

  function update(dt: number) {
    if (!moving) {
      // Idle — apply any queued command, otherwise stay put.
      if (pendingCommand) applyPendingCommand();
      return;
    }

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

      // A new command during a walk overrides the remaining path — consume it
      // here on a clean tile boundary so we never teleport mid-step.
      if (pendingCommand) {
        applyPendingCommand();
      } else if (pathIndex < path.length) {
        startStep();
      } else {
        moving = false;
        walkFrame = 0;
      }
    }

    computeInterp();
  }

  function draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number) {
    computeInterp();
    const screen = tileToScreen(cachedInterpTileX, cachedInterpTileY, TILE_W, TILE_H);
    cachedScreenY = screen.screenY;

    if (!sprite) return;

    const col = moving ? 1 + walkFrame : 0;
    const row = (direction + 1) % 8;
    const sx = col * FRAME_W;
    const sy = row * FRAME_H;

    const dstX = screen.screenX + offsetX + TILE_W / 2 - FOOT_X;
    const dstY = screen.screenY + offsetY + TILE_H / 2 - FOOT_Y;

    ctx.drawImage(sprite, sx, sy, FRAME_W, FRAME_H, dstX, dstY, FRAME_W, FRAME_H);
  }

  function moveTo(targetX: number, targetY: number) {
    pendingCommand = { x: targetX, y: targetY };
  }

  return {
    update,
    draw,
    screenY: () => cachedScreenY,
    interpTileX: () => cachedInterpTileX,
    interpTileY: () => cachedInterpTileY,
    moveTo,
  };
}

/**
 * Spawn deer around the map center and add them to scene.entities.
 * The first deer is a player-controlled `createPlayerDeer` (stashed on
 * `scene.playerDeer` for click routing); the rest wander via `createDeer`.
 */
export function spawnDeer(
  scene: Scene,
  count: number,
  sprite: CanvasImageSource | null,
): void {
  const isBlocked = (x: number, y: number) => !scene.worldMap.isWalkable(x, y);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const dist = 3 + Math.random() * 10;
    const sx = Math.round(SPAWN_X + dist * Math.cos(angle));
    const sy = Math.round(SPAWN_Y + dist * Math.sin(angle));
    if (i === 0) {
      const player = createPlayerDeer(sx, sy, isBlocked, sprite);
      scene.entities.push(player);
      scene.playerDeer = player;
    } else {
      scene.entities.push(createDeer(sx, sy, isBlocked, sprite));
    }
  }
}
