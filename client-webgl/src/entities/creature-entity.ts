// Network-driven creature entity factory. Covers blueprint categories
// 'creature' and 'npc' — players, deer, wolves, NPCs, etc. Reads position,
// direction, currentAction, and statusEffects from server-delivered
// EntityComponents and renders via the shared 8-row directional walk sheet.
//
// Movement visuals use linear interpolation from the previous server
// checkpoint toward the latest `position`. Checkpointing happens in
// applyComponentsToEntity whenever position changes; the tick here just
// reads lerpFromX/Y + checkpointMs + position + blueprint.speed.
//
// Under per-tile server sync (current), each server update advances
// position by one tile and the lerp smoothly covers that tile over
// `1 / speed` seconds — natural per-tile smoothing. When the server switches
// to bend-only waypoints (see docs/plans/bend-only-waypoints.md), this same
// code will cover multi-tile straight runs between bends.

import { ActionType } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { TICK_RATE } from '@shared/constants.js';
import { Direction, isDiagonal } from '@shared/direction.js';
import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H, PX_PER_Z } from '../platform/config.js';
import type { EntityComponents } from '@shared/protocol/codec.js';
import type { ClientEntity } from './client-entity.js';
import type { SpriteRenderer } from './sprite-renderer.js';
import type { SpriteSheetRef } from './sprite-registry.js';
import type { Scene } from '../scene.js';

const WALK_FRAMES = 6;
const WALK_FRAME_DURATION = 0.08;
const DEFAULT_SPEED_TILES_PER_SEC = 3;

// Animation runs while the server says we're walking OR while the visual is
// still catching up to the latest position. Two signals because:
//  - currentAction === Walking covers the steady mid-path case (no flicker
//    in the ~10–100 ms gap between visual catching up and the next per-tile
//    delta arriving).
//  - On the final arrival tick the server flips Walking → Idle in the same
//    delta as the final position; the visual-lag check keeps the animation
//    running until the lerp actually completes (no silent slide-to-final).
function isMoving(e: ClientEntity): boolean {
  if (e.currentAction?.actionType === ActionType.Walking) return true;
  if (!e.position) return false;
  const dx = e.position.tileX - e.visualX;
  const dy = e.position.tileY - e.visualY;
  return dx * dx + dy * dy > 0.0001;
}

export function createCreatureEntity(
  id: number,
  components: EntityComponents,
  sheet: SpriteSheetRef,
): ClientEntity {
  const pos = components.position;
  const entity: ClientEntity = {
    id,
    blueprint: components.blueprint,
    position: pos,
    direction: components.direction ?? { dir: Direction.S },
    nextWaypoint: components.nextWaypoint,
    currentAction: components.currentAction,
    health: components.health,
    statusEffects: components.statusEffects,
    spriteSheet: sheet,
    walkFrame: 0,
    frameTimer: 0,
    // Snap to starting position — no lerp state is set, so the tick's
    // fallback produces t=1 on the first frame.
    visualX: pos?.tileX ?? 0,
    visualY: pos?.tileY ?? 0,
    screenX: 0,
    screenY: 0,
    screenW: 0,
    screenH: 0,

    tick(self, dt, scene) {
      if (self.position) {
        const targetX = self.position.tileX;
        const targetY = self.position.tileY;
        const fromX = self.lerpFromX ?? targetX;
        const fromY = self.lerpFromY ?? targetY;
        const checkpoint = self.checkpointMs ?? scene.time;
        const speed = getBlueprint(self.blueprint?.blueprintId ?? -1)?.speed
          ?? DEFAULT_SPEED_TILES_PER_SEC;
        const ticksPerStep = Math.max(1, Math.round(TICK_RATE / speed));
        const dir = self.direction?.dir;
        const diag = dir !== undefined && isDiagonal(dir);
        const stepTicks = diag ? Math.round(ticksPerStep * 1.4) : ticksPerStep;
        const durationMs = stepTicks * (1000 / TICK_RATE);
        const elapsed = scene.time - checkpoint;
        const t = Math.min(Math.max(elapsed / durationMs, 0), 1);
        self.visualX = fromX + (targetX - fromX) * t;
        self.visualY = fromY + (targetY - fromY) * t;
      }

      // Animation decision reads the post-lerp visual so the tick that
      // completes a lerp also resets walkFrame on the same pass.
      if (isMoving(self)) {

        self.frameTimer += dt;
        while (self.frameTimer >= WALK_FRAME_DURATION) {
          self.frameTimer -= WALK_FRAME_DURATION;
          self.walkFrame = (self.walkFrame + 1) % WALK_FRAMES;
        }
      } else {
        self.walkFrame = 0;
        self.frameTimer = 0;
      }
    },

    draw(self, sprites, gl, offsetX, offsetY, scene) {
      drawCreatureSprite(self, sprites, gl, offsetX, offsetY, isMoving(self), scene);
    },
  };

  return entity;
}

function drawCreatureSprite(
  e: ClientEntity,
  sprites: SpriteRenderer,
  gl: WebGL2RenderingContext,
  offsetX: number,
  offsetY: number,
  moving: boolean,
  scene: Scene,
): void {
  const sheet = e.spriteSheet;
  const screen = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
  const z = scene.getGroundZ(e.visualX, e.visualY);

  const dstX = screen.screenX + offsetX + TILE_W / 2 - sheet.footX;
  const dstY = screen.screenY + offsetY + TILE_H / 2 - sheet.footY - z * PX_PER_Z;

  // AABB bounding box — actual draw position in virtual-pixel space.
  e.screenX = dstX;
  e.screenY = dstY;
  e.screenW = sheet.renderW;
  e.screenH = sheet.renderH;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sheet.texture);
  sprites.setSpriteTile(e.visualX, e.visualY);

  if (sheet.isFallback) {
    sprites.drawSprite(dstX, dstY, sheet.renderW, sheet.renderH, 0, 0, 1, 1);
    return;
  }

  const dir = e.direction?.dir ?? Direction.S;
  const col = moving ? 1 + e.walkFrame : 0;
  const row = (dir + 1) % 8;
  const sx = col * sheet.frameW;
  const sy = row * sheet.frameH;

  sprites.drawSprite(
    dstX, dstY, sheet.renderW, sheet.renderH,
    sx / sheet.sheetW, sy / sheet.sheetH,
    sheet.frameW / sheet.sheetW, sheet.frameH / sheet.sheetH,
  );
}
