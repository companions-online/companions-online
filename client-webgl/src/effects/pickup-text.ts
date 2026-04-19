import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Scene } from '../scene.js';
import type { ClientEntity } from '../entities/client-entity.js';
import type { Effect } from './effect.js';
import type { TextSurface, TextSurfaceFactory } from './text-surface.js';

const PICKUP_DURATION_MS = 1500;
const FLOAT_SPEED_PX_PER_MS = 0.03;
const PICKUP_FONT_PX = 14;

export function createPickupText(
  entity: ClientEntity,
  text: string,
  startTime: number,
  factory: TextSurfaceFactory,
  offsetIndex: number,
): Effect {
  const surface = factory.create({
    text,
    fillColor: '#4f4',
    outlineColor: '#040',
    fontPx: PICKUP_FONT_PX,
    bold: true,
  });

  let anchorX = entity.visualX;
  let anchorY = entity.visualY;
  // Stagger multiple pickup texts vertically.
  const extraOffsetY = offsetIndex * (PICKUP_FONT_PX + 4);

  return {
    kind: 'pickup',
    startTime,
    duration: PICKUP_DURATION_MS,
    done: false,

    tick(scene) {
      const live = scene.entities.get(entity.id);
      if (live) {
        anchorX = live.visualX;
        anchorY = live.visualY;
      }
    },

    draw(sprites, gl, offsetX, offsetY, scene) {
      const elapsed = scene.time - startTime;
      const floatY = elapsed * FLOAT_SPEED_PX_PER_MS + extraOffsetY;
      const alpha = elapsed > PICKUP_DURATION_MS * 0.7
        ? 1 - (elapsed - PICKUP_DURATION_MS * 0.7) / (PICKUP_DURATION_MS * 0.3)
        : 1;
      if (alpha <= 0) return;

      const scr = tileToScreen(anchorX, anchorY, TILE_W, TILE_H);
      const dstX = scr.screenX + offsetX + TILE_W / 2 - surface.width / 2;
      const dstY = scr.screenY + offsetY - floatY - surface.height - 70;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, surface.texture);
      sprites.setAlpha(alpha);
      sprites.drawSprite(
        dstX, dstY, surface.width, surface.height,
        0, 0, 1, 1,
      );
      sprites.setAlpha(1);
    },

    dispose(gl) {
      factory.release(surface);
    },
  };
}
