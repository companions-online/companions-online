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
/** Target "soft" line width for above-head bubbles. After this many
 *  characters, break at the first separator (whitespace or punctuation). */
const WRAP_MIN_CHARS = 20;

export interface ChatBubbleEffect extends Effect {
  senderEntityId: number;
  /** Full vertical extent of the rendered bubble in virtual pixels — used by
   *  the next chat-bubble from the same sender to stack above this one
   *  without overlap (multi-line messages get proportional spacing). */
  bubbleH: number;
}

export function isChatBubble(e: Effect): e is ChatBubbleEffect {
  return e.kind === 'chat';
}

/** Chars that end a "soft" wrap: whitespace or common punctuation. */
const SEPARATOR_RE = /[\s\-,;:/|\\!?.]/;
const WHITESPACE_RE = /\s/;

/**
 * Break `text` into lines for the above-head bubble. Each line is grown
 * greedily: once the line length passes `minChars`, we break at the next
 * separator (whitespace OR punctuation). Whitespace separators are consumed
 * (dropped); punctuation stays on the preceding line. Words are never split
 * mid-token. If no separator is found past `minChars`, the remainder stays
 * as a single line.
 */
export function wrapChatMessage(text: string, minChars: number = WRAP_MIN_CHARS): string[] {
  if (text.length <= minChars) return [text];

  const lines: string[] = [];
  let i = 0;
  while (i < text.length) {
    const remaining = text.length - i;
    if (remaining <= minChars) {
      lines.push(text.slice(i));
      break;
    }
    // Scan forward from i+minChars for the first separator.
    let j = minChars;
    while (j < remaining && !SEPARATOR_RE.test(text[i + j])) j++;
    if (j >= remaining) {
      lines.push(text.slice(i));
      break;
    }
    const sep = text[i + j];
    if (WHITESPACE_RE.test(sep)) {
      // Consume the whitespace.
      lines.push(text.slice(i, i + j));
      i += j + 1;
    } else {
      // Punctuation: keep on the preceding line.
      lines.push(text.slice(i, i + j + 1));
      i += j + 1;
    }
  }
  return lines;
}

export function createChatBubble(
  senderEntityId: number,
  message: string,
  startTime: number,
  factory: TextSurfaceFactory,
): ChatBubbleEffect {
  const lines = wrapChatMessage(message);
  const surfaces: TextSurface[] = lines.map(line =>
    factory.create({
      text: line,
      fillColor: '#ff0',
      outlineColor: '#000',
      fontPx: CHAT_FONT_PX,
      bold: false,
    }),
  );
  const bubbleH = lines.length * LINE_HEIGHT;

  let anchorX = 0;
  let anchorY = 0;
  let anchored = false;

  const self: ChatBubbleEffect = {
    kind: 'chat',
    senderEntityId,
    startTime,
    duration: CHAT_DURATION_MS,
    done: false,
    bubbleH,

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

      // Newer bubbles from the same sender push this one upward by their
      // bubbleH so multi-line stacks never overlap.
      let stackOffsetPx = 0;
      const effects = scene.effects.active;
      const myIdx = effects.indexOf(self);
      for (let i = myIdx + 1; i < effects.length; i++) {
        const other = effects[i];
        if (isChatBubble(other) && other.senderEntityId === senderEntityId) {
          stackOffsetPx += other.bubbleH;
        }
      }

      const elapsed = scene.time - startTime;
      const alpha = elapsed > CHAT_DURATION_MS * 0.8
        ? 1 - (elapsed - CHAT_DURATION_MS * 0.8) / (CHAT_DURATION_MS * 0.2)
        : 1;
      if (alpha <= 0) return;

      const scr = tileToScreen(anchorX, anchorY, TILE_W, TILE_H);
      const bubbleBottomY = scr.screenY + offsetY - BASE_OFFSET_Y - stackOffsetPx;
      const bubbleTopY = bubbleBottomY - bubbleH;
      const centerX = scr.screenX + offsetX + TILE_W / 2;

      sprites.setAlpha(alpha);
      for (let i = 0; i < surfaces.length; i++) {
        const s = surfaces[i];
        const dstX = centerX - s.width / 2;
        const dstY = bubbleTopY + i * LINE_HEIGHT;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, s.texture);
        sprites.drawSprite(dstX, dstY, s.width, s.height, 0, 0, 1, 1);
      }
      sprites.setAlpha(1);
    },

    dispose(_gl) {
      for (const s of surfaces) factory.release(s);
    },
  };

  return self;
}
