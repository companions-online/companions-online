// Shared locomotion + walk-cycle animation state machine for any tile-stepping
// entity. Both wander deer and click-controlled players drive the same
// CreatureState; they only differ in how they decide which path to walk next.
//
// CreatureState is plain data. Wrappers own the state and call the free
// functions below to advance it. Visual position (visualX/visualY) is
// computed from the current step's lerp; wrappers copy it to their
// ClientEntity each tick so the renderer can read it.

import { tileToScreen } from '@shared/coordinates.js';
import { DX, DY, Direction } from '@shared/direction.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { ClientEntity } from './client-entity.js';
import type { SpriteRenderer } from './sprite-renderer.js';

export interface CreatureState {
  // Logical tile (advances when a step completes)
  tileX: number;
  tileY: number;
  prevTileX: number;
  prevTileY: number;
  // Facing direction, 0..7
  direction: number;
  // Step state
  moving: boolean;
  moveProgress: number;
  moveDuration: number;
  // Walk-cycle animation
  walkFrame: number;
  walkTimer: number;
  walkFrameDuration: number;
  // Path state
  path: { x: number; y: number }[];
  pathIndex: number;
  // Fractional visual tile position the renderer reads
  visualX: number;
  visualY: number;
  // Tunables
  speed: number;          // pixels/sec
  framesPerStep: number;  // walk-cycle frames per step
}

export function createCreatureState(
  startX: number,
  startY: number,
  speed: number,
  framesPerStep: number,
): CreatureState {
  return {
    tileX: startX,
    tileY: startY,
    prevTileX: startX,
    prevTileY: startY,
    direction: Direction.S,
    moving: false,
    moveProgress: 0,
    moveDuration: 0.3,
    walkFrame: 0,
    walkTimer: 0,
    walkFrameDuration: 0.05,
    path: [],
    pathIndex: 0,
    visualX: startX,
    visualY: startY,
    speed,
    framesPerStep,
  };
}

function deltaToDirection(dx: number, dy: number): number {
  for (let d = 0; d < 8; d++) {
    if (DX[d] === dx && DY[d] === dy) return d;
  }
  return Direction.S;
}

/** Internal: begin the next step toward `path[pathIndex]`. */
function startStep(state: CreatureState): void {
  const target = state.path[state.pathIndex];
  state.prevTileX = state.tileX;
  state.prevTileY = state.tileY;
  const dx = target.x - state.tileX;
  const dy = target.y - state.tileY;
  state.direction = deltaToDirection(dx, dy);
  const from = tileToScreen(state.tileX, state.tileY, TILE_W, TILE_H);
  const to = tileToScreen(target.x, target.y, TILE_W, TILE_H);
  const sdx = to.screenX - from.screenX;
  const sdy = to.screenY - from.screenY;
  state.moveDuration = Math.sqrt(sdx * sdx + sdy * sdy) / state.speed;
  state.walkFrameDuration = state.moveDuration / state.framesPerStep;
  state.moveProgress = 0;
  state.moving = true;
  state.walkTimer = 0;
}

/** Internal: write visualX/Y from the current step's interpolation. */
function computeInterp(state: CreatureState): void {
  if (state.moving) {
    const target = state.path[state.pathIndex];
    const t = Math.min(state.moveProgress, 1);
    state.visualX = state.prevTileX + (target.x - state.prevTileX) * t;
    state.visualY = state.prevTileY + (target.y - state.prevTileY) * t;
  } else {
    state.visualX = state.tileX;
    state.visualY = state.tileY;
  }
}

/**
 * Begin walking the given path from the creature's current tile. Snaps the
 * step state and starts the first step immediately. If the path is empty the
 * creature stops.
 */
export function setCreaturePath(state: CreatureState, path: { x: number; y: number }[]): void {
  state.path = path;
  state.pathIndex = 0;
  if (path.length === 0) {
    stopCreature(state);
    return;
  }
  startStep(state);
}

/** Stop walking; clear path; remain at current tile. */
export function stopCreature(state: CreatureState): void {
  state.path = [];
  state.pathIndex = 0;
  state.moving = false;
  state.walkFrame = 0;
  computeInterp(state);
}

/**
 * Advance the creature by `dt` seconds. Calls `onStepComplete` (if provided)
 * once per tile boundary crossing — *between* completing the previous step and
 * starting the next one — so the wrapper can interrupt the path mid-walk
 * (e.g. player click during a long traversal). The callback may call
 * setCreaturePath/stopCreature to replace the rest of the path; if it does,
 * the new path takes effect immediately on the same tick.
 */
export function tickCreature(
  state: CreatureState,
  dt: number,
  onStepComplete?: () => void,
): void {
  if (!state.moving) {
    computeInterp(state);
    return;
  }

  state.moveProgress += dt / state.moveDuration;

  state.walkTimer += dt;
  if (state.walkTimer >= state.walkFrameDuration) {
    state.walkTimer -= state.walkFrameDuration;
    state.walkFrame = (state.walkFrame + 1) % state.framesPerStep;
  }

  if (state.moveProgress >= 1.0) {
    const target = state.path[state.pathIndex];
    state.tileX = target.x;
    state.tileY = target.y;
    state.pathIndex++;

    // Step boundary hook: wrapper may inject a new path or stop.
    // Snapshot the path reference so we can detect callback-driven replacement.
    const pathBefore = state.path;
    onStepComplete?.();

    if (state.path !== pathBefore) {
      // Callback called setCreaturePath or stopCreature — state is now either
      // mid-first-step on the new path or stopped. Don't run old-path logic.
    } else if (state.pathIndex < state.path.length) {
      startStep(state);
    } else {
      state.moving = false;
      state.walkFrame = 0;
    }
  }

  computeInterp(state);
}

/**
 * Standard creature sprite draw: 8-row direction × N-col walk cycle, idle = col 0.
 * The wrapper passes its captured `moving` flag (read from CreatureState) since
 * it isn't on the entity itself.
 */
export function drawCreatureSprite(
  e: ClientEntity,
  sprites: SpriteRenderer,
  gl: WebGL2RenderingContext,
  offsetX: number,
  offsetY: number,
  moving: boolean,
): void {
  const sheet = e.spriteSheet;
  const screen = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
  e.screenY = screen.screenY;

  const dir = e.direction?.dir ?? Direction.S;
  const col = moving ? 1 + e.walkFrame : 0;
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
}
