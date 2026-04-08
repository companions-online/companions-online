import { tileToScreen } from '@shared/coordinates.js';
import { SPAWN_X, SPAWN_Y, MAP_SIZE } from '@shared/constants.js';
import { DX, DY, Direction } from '@shared/direction.js';
import { findPath } from '@shared/pathfinding.js';
import { TILE_W, TILE_H } from './config.js';

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

// Shared sprite sheet across all deer
const spriteSheet = new Image();
spriteSheet.src = '/assets/deer.png';
let spriteLoaded = false;
spriteSheet.onload = () => { spriteLoaded = true; };

function deltaToDirection(dx: number, dy: number): number {
  for (let d = 0; d < 8; d++) {
    if (DX[d] === dx && DY[d] === dy) return d;
  }
  return Direction.S;
}

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

function randomWanderTarget(homeX: number, homeY: number): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const dist = WANDER_STEP_MIN + Math.random() * (WANDER_STEP_MAX - WANDER_STEP_MIN);
  const tx = Math.round(homeX + dist * Math.cos(angle));
  const ty = Math.round(homeY + dist * Math.sin(angle));
  // Keep within wander radius of center and map bounds
  const cx = SPAWN_X, cy = SPAWN_Y;
  return {
    x: clamp(tx, Math.max(0, cx - WANDER_RADIUS), Math.min(MAP_SIZE - 1, cx + WANDER_RADIUS)),
    y: clamp(ty, Math.max(0, cy - WANDER_RADIUS), Math.min(MAP_SIZE - 1, cy + WANDER_RADIUS)),
  };
}

interface Deer {
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void;
  screenY(): number;
  interpTileX(): number;
  interpTileY(): number;
}

function createDeer(startX: number, startY: number): Deer {
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

  let paused = false;
  let pauseTimer = 0;

  // Stagger initial pause so deer don't all start moving at once
  paused = true;
  pauseTimer = Math.random() * 2.0;

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
    const target = randomWanderTarget(tileX, tileY);
    const result = findPath(tileX, tileY, target.x, target.y, () => false, MAP_SIZE, MAP_SIZE);
    path = result.path;
    pathIndex = 0;

    if (path.length === 0) {
      // Nowhere to go, pause and retry
      paused = true;
      pauseTimer = 0.5;
      return;
    }

    startStep();
  }

  function update(dt: number) {
    if (!spriteLoaded) return;

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

  let cachedScreenY = 0;
  let cachedInterpTileX = startX;
  let cachedInterpTileY = startY;

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

  function draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number) {
    if (!spriteLoaded) return;

    computeInterp();
    const screen = tileToScreen(cachedInterpTileX, cachedInterpTileY, TILE_W, TILE_H);
    const screenX = screen.screenX;
    const screenY = screen.screenY;

    cachedScreenY = screenY;

    const col = moving ? 1 + walkFrame : 0;
    const row = (direction + 1) % 8;
    const sx = col * FRAME_W;
    const sy = row * FRAME_H;

    const dstX = screenX + offsetX + TILE_W / 2 - FOOT_X;
    const dstY = screenY + offsetY + TILE_H / 2 - FOOT_Y;

    ctx.drawImage(spriteSheet, sx, sy, FRAME_W, FRAME_H, dstX, dstY, FRAME_W, FRAME_H);
  }

  return {
    update,
    draw,
    screenY: () => cachedScreenY,
    interpTileX: () => cachedInterpTileX,
    interpTileY: () => cachedInterpTileY,
  };
}

export function createDeerHerd(count: number) {
  const deer: Deer[] = [];
  for (let i = 0; i < count; i++) {
    // Spread starting positions around center
    const angle = (i / count) * Math.PI * 2;
    const dist = 3 + Math.random() * 10;
    const sx = Math.round(SPAWN_X + dist * Math.cos(angle));
    const sy = Math.round(SPAWN_Y + dist * Math.sin(angle));
    deer.push(createDeer(sx, sy));
  }

  return {
    player: deer[0],
    update(dt: number) {
      for (const d of deer) d.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number) {
      deer.sort((a, b) => a.screenY() - b.screenY());
      for (const d of deer) d.draw(ctx, offsetX, offsetY);
    },
  };
}
