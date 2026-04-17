import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Scene } from '../scene.js';
import type { ClientEntity } from '../entities/client-entity.js';
import type { Effect } from './effect.js';
import type { TextSurface, TextSurfaceFactory } from './text-surface.js';

const DAMAGE_DURATION_MS = 1200;
const FLOAT_SPEED_PX_PER_MS = 0.04;
const DAMAGE_FONT_PX = 16;
const DAMAGE_FONT_PX_SELF = 22;
/** Base vertical offset above entity tile center (px). */
const BASE_OFFSET_Y = 36;
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

export function createDamageNumber(
  entity: ClientEntity,
  amount: number,
  startTime: number,
  factory: TextSurfaceFactory,
  opts: DamageNumberOpts,
): Effect {
  const surface = createDamageSurface(factory, amount, opts.largeFont);
  // Snapshot entity position at spawn so if the entity disappears we still
  // have a location to float from.
  let anchorX = entity.visualX;
  let anchorY = entity.visualY;

  return {
    kind: 'damage',
    startTime,
    duration: DAMAGE_DURATION_MS,
    done: false,

    tick(scene) {
      // Follow entity if still alive.
      const live = scene.entities.get(entity.id);
      if (live) {
        anchorX = live.visualX;
        anchorY = live.visualY;
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
