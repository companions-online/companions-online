import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Scene } from '../scene.js';
import type { Effect } from './effect.js';
import type { TextSurface, TextSurfaceFactory } from './text-surface.js';

const CHAT_DURATION_MS = 5000;
const CHAT_FONT_PX = 13;
const LINE_HEIGHT = CHAT_FONT_PX + 4;
/** Vertical offset above the entity's tile north vertex — high enough to
 *  clear the player sprite (92px frame, footY 82 → head at ~66px above). */
const BASE_OFFSET_Y = 76;

export interface ChatBubbleEffect extends Effect {
  senderEntityId: number;
}

export function isChatBubble(e: Effect): e is ChatBubbleEffect {
  return e.kind === 'chat';
}

export function createChatBubble(
  senderEntityId: number,
  message: string,
  startTime: number,
  factory: TextSurfaceFactory,
): ChatBubbleEffect {
  const surface = factory.create({
    text: message,
    fillColor: '#ff0',
    outlineColor: '#000',
    fontPx: CHAT_FONT_PX,
    bold: false,
  });

  let anchorX = 0;
  let anchorY = 0;
  let anchored = false;

  const self: ChatBubbleEffect = {
    kind: 'chat',
    senderEntityId,
    startTime,
    duration: CHAT_DURATION_MS,
    done: false,

    tick(scene) {
      const sender = scene.entities.get(senderEntityId);
      if (sender) {
        anchorX = sender.visualX;
        anchorY = sender.visualY;
        anchored = true;
      } else if (anchored) {
        // Sender removed — expire early.
        this.done = true;
      }
    },

    draw(sprites, gl, offsetX, offsetY, scene) {
      if (!anchored) return;

      // Stack index: count chat bubbles for same sender that are NEWER
      // (appear later in the active list). Newer = lower (closer to entity).
      let stackIndex = 0;
      const effects = scene.effects.active;
      const myIdx = effects.indexOf(self);
      for (let i = myIdx + 1; i < effects.length; i++) {
        const other = effects[i];
        if (isChatBubble(other) && other.senderEntityId === senderEntityId) {
          stackIndex++;
        }
      }

      const elapsed = scene.time - startTime;
      const alpha = elapsed > CHAT_DURATION_MS * 0.8
        ? 1 - (elapsed - CHAT_DURATION_MS * 0.8) / (CHAT_DURATION_MS * 0.2)
        : 1;
      if (alpha <= 0) return;

      const scr = tileToScreen(anchorX, anchorY, TILE_W, TILE_H);
      const dstX = scr.screenX + offsetX + TILE_W / 2 - surface.width / 2;
      const dstY = scr.screenY + offsetY - BASE_OFFSET_Y - stackIndex * LINE_HEIGHT - surface.height;

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

  return self;
}
