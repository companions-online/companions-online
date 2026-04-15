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
import { getBlueprint } from '@shared/blueprints.js';
import { Direction } from '@shared/direction.js';
import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { EntityComponents } from '@shared/protocol/codec.js';
import type { ClientEntity } from './client-entity.js';
import type { SpriteRenderer } from './sprite-renderer.js';
import type { SpriteSheetRef } from './sprite-registry.js';

const WALK_FRAMES = 6;
const WALK_FRAME_DURATION = 0.08;
const DEFAULT_SPEED_TILES_PER_SEC = 3;

function isMoving(e: ClientEntity): boolean {
  return e.currentAction?.actionType === ActionType.Walking;
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
    screenY: 0,

    tick(self, dt, scene) {
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

      if (!self.position) return;

      const targetX = self.position.tileX;
      const targetY = self.position.tileY;
      const fromX = self.lerpFromX ?? targetX;
      const fromY = self.lerpFromY ?? targetY;
      const checkpoint = self.checkpointMs ?? scene.time;
      const speed = getBlueprint(self.blueprint?.blueprintId ?? -1)?.speed
        ?? DEFAULT_SPEED_TILES_PER_SEC;

      // Duration is one tile at `speed` tiles/sec. Under per-tile server
      // sync the next position update arrives ~1 tile/speed seconds later,
      // so the entity reaches target just as the next leg begins. Diagonal
      // moves are not sqrt(2)-compensated here — the visual ticks slightly
      // ahead on diagonals, a minor error we'll revisit if it looks bad.
      const durationMs = 1000 / speed;
      const elapsed = scene.time - checkpoint;
      const t = Math.min(Math.max(elapsed / durationMs, 0), 1);
      self.visualX = fromX + (targetX - fromX) * t;
      self.visualY = fromY + (targetY - fromY) * t;
    },

    draw(self, sprites, gl, offsetX, offsetY) {
      drawCreatureSprite(self, sprites, gl, offsetX, offsetY, isMoving(self));
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
): void {
  const sheet = e.spriteSheet;
  const screen = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
  e.screenY = screen.screenY;

  const dstX = screen.screenX + offsetX + TILE_W / 2 - sheet.footX;
  const dstY = screen.screenY + offsetY + TILE_H / 2 - sheet.footY;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sheet.texture);

  if (sheet.isFallback) {
    sprites.drawSprite(dstX, dstY, sheet.frameW, sheet.frameH, 0, 0, 1, 1);
    return;
  }

  const dir = e.direction?.dir ?? Direction.S;
  const col = moving ? 1 + e.walkFrame : 0;
  const row = (dir + 1) % 8;
  const sx = col * sheet.frameW;
  const sy = row * sheet.frameH;

  sprites.drawSprite(
    dstX, dstY, sheet.frameW, sheet.frameH,
    sx / sheet.sheetW, sy / sheet.sheetH,
    sheet.frameW / sheet.sheetW, sheet.frameH / sheet.sheetH,
  );
}
