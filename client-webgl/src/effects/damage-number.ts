import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Scene } from '../scene.js';
import type { Effect } from './effect.js';
import type { TextSurface, TextSurfaceFactory } from './text-surface.js';

const DAMAGE_DURATION_MS = 1200;
const FLOAT_SPEED_PX_PER_MS = 0.04;
const DAMAGE_FONT_PX = 8;
const DAMAGE_FONT_PX_SELF = 11;
/** Base vertical offset above entity tile center (px). */
const BASE_OFFSET_Y = 18;
/** Starting opacity — fades further toward end of life. */
const BASE_ALPHA = 0.6;

/**
 * Draw a "many-edged star" (spiky burst) behind the damage number into
 * an OffscreenCanvas and return it as a TextSurface via the factory.
 *
 * Falls back to just the number text when running under the fake factory
 * (tests), since fake factories don't support the star — but that's fine;
 * tests only assert spawn/lifecycle, not pixels.
 */
function createDamageSurface(
  factory: TextSurfaceFactory,
  amount: number,
  largeFont: boolean,
): TextSurface {
  return factory.create({
    text: String(amount),
    fillColor: '#fff',
    fontPx: largeFont ? DAMAGE_FONT_PX_SELF : DAMAGE_FONT_PX,
    bold: true,
    background: 'star',
    backgroundColor: '#c00',
  });
}

export interface DamageNumberOpts {
  largeFont: boolean;
}

/**
 * Spawn a floating damage number anchored at a tile-space position.
 *
 * If `followEntityId` is non-null, the anchor tracks that entity's
 * `visualX/Y` each tick while it remains in `scene.entities`; when the
 * entity is removed, the anchor sticks at its last known position.
 */
export function createDamageNumber(
  amount: number,
  initialAnchorX: number,
  initialAnchorY: number,
  followEntityId: number | null,
  startTime: number,
  factory: TextSurfaceFactory,
  opts: DamageNumberOpts,
): Effect {
  const surface = createDamageSurface(factory, amount, opts.largeFont);
  let anchorX = initialAnchorX;
  let anchorY = initialAnchorY;

  return {
    kind: 'damage',
    startTime,
    duration: DAMAGE_DURATION_MS,
    done: false,

    tick(scene) {
      if (followEntityId !== null) {
        const live = scene.entities.get(followEntityId);
        if (live) {
          anchorX = live.visualX;
          anchorY = live.visualY;
        }
      }
    },

    draw(sprites, gl, offsetX, offsetY, scene) {
      const elapsed = scene.time - startTime;
      const floatY = elapsed * FLOAT_SPEED_PX_PER_MS;
      const fade = elapsed > DAMAGE_DURATION_MS * 0.7
        ? 1 - (elapsed - DAMAGE_DURATION_MS * 0.7) / (DAMAGE_DURATION_MS * 0.3)
        : 1;
      const alpha = BASE_ALPHA * fade;
      if (alpha <= 0) return;

      const scr = tileToScreen(anchorX, anchorY, TILE_W, TILE_H);
      const dstX = scr.screenX + offsetX + TILE_W / 2 - surface.width / 2;
      const dstY = scr.screenY + offsetY - BASE_OFFSET_Y - floatY - surface.height;

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
