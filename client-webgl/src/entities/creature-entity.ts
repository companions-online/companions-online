// Network-driven creature entity factory. Covers blueprint categories
// 'creature' and 'npc' — players, deer, wolves, NPCs, etc. Reads position,
// direction, currentAction, and statusEffects from server-delivered
// EntityComponents and renders via the shared 8-row directional walk sheet.
//
// Phase 5: snap-to-tile on every position update (no interp). Walk-cycle
// animation advances while currentAction.actionType === Walking. Phase 7
// replaces the snap with a lerp from lerpFromX/Y toward nextWaypoint at
// blueprint.speed.

import { ActionType } from '@shared/actions.js';
import { Direction } from '@shared/direction.js';
import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { EntityComponents } from '@shared/protocol/codec.js';
import type { ClientEntity } from './client-entity.js';
import type { SpriteRenderer } from './sprite-renderer.js';
import type { SpriteSheetRef } from './sprite-registry.js';

const WALK_FRAMES = 6;
const WALK_FRAME_DURATION = 0.08;

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
    visualX: pos?.tileX ?? 0,
    visualY: pos?.tileY ?? 0,
    screenY: 0,

    tick(self, dt) {
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
      // Snap-to-tile: visual position equals logical position. Phase 7
      // replaces this with a lerp from the previous checkpoint.
      if (self.position) {
        self.visualX = self.position.tileX;
        self.visualY = self.position.tileY;
      }
    },

    draw(self, sprites, gl, offsetX, offsetY) {
      drawCreatureSprite(self, sprites, gl, offsetX, offsetY, isMoving(self));
    },
  };

  return entity;
}

/**
 * Standard creature sprite draw: 8-row direction × (1+N)-col (idle, walk×N).
 * The `moving` argument determines idle vs walk-cycle frame selection.
 */
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
    // Unknown-entity sheet: single-frame image, no dir rows, no walk cols.
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
