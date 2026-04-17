// HUD chrome: chat log, chat input, and debug overlay.
// Drawn after the game scissor pass is disabled, so it covers the
// HUD regions (bottom bar, top bar). Uses TextSurfaceFactory for
// text rendering + SpriteRenderer for blitting.

import { getBlueprint } from '@shared/blueprints.js';
import { CANVAS_W, CANVAS_H, HUD_BOTTOM_H } from '../platform/config.js';
import type { TextSurface, TextSurfaceFactory } from '../effects/text-surface.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Scene } from '../scene.js';
import type { KeyboardState } from '../controls/keyboard.js';

const CHAT_FONT_PX = 13;
const CHAT_LINE_H = CHAT_FONT_PX + 4;
const CHAT_MAX_LINES = 5;
const CHAT_PAD_X = 10;
const CHAT_PAD_Y = 8;
const DEBUG_FONT_PX = 14;

// Cached surfaces — released and re-created when text changes.
let cachedChatLines: { key: string; surface: TextSurface }[] = [];
let cachedInput: { key: string; surface: TextSurface } | null = null;
let cachedDebug: { key: string; surface: TextSurface } | null = null;

function getOrCreate(
  factory: TextSurfaceFactory,
  text: string,
  cached: { key: string; surface: TextSurface } | null,
  color: string,
  fontPx: number,
  outline?: string,
): { key: string; surface: TextSurface } {
  if (cached && cached.key === text) return cached;
  if (cached) factory.release(cached.surface);
  const surface = factory.create({
    text,
    fillColor: color,
    outlineColor: outline,
    fontPx,
  });
  return { key: text, surface };
}

function senderName(scene: Scene, entityId: number): string {
  const entity = scene.entities.get(entityId);
  if (!entity?.blueprint) return '???';
  const bp = getBlueprint(entity.blueprint.blueprintId);
  return bp?.name ?? '???';
}

export function drawHud(
  gl: WebGL2RenderingContext,
  scene: Scene,
  sprites: SpriteRenderer,
  keyboard: KeyboardState,
  resolution: readonly [number, number],
  debugLabel: string | null,
): void {
  const factory = scene.textSurfaceFactory;
  const needSprites =
    scene.chatLog.length > 0 || keyboard.chatActive || (keyboard.debugMode && debugLabel);

  if (!needSprites) return;

  sprites.begin(resolution);

  // --- Chat log (bottom-left, above the input line) ---
  const chatBaseY = CANVAS_H - HUD_BOTTOM_H + CHAT_PAD_Y;
  const visibleLog = scene.chatLog.slice(-CHAT_MAX_LINES);

  // Build chat line keys and sync cache.
  const newCachedLines: { key: string; surface: TextSurface }[] = [];
  for (let i = 0; i < visibleLog.length; i++) {
    const entry = visibleLog[i];
    const name = senderName(scene, entry.senderEntityId);
    const lineKey = `${entry.receivedAt}|${name}: ${entry.message}`;
    // Try to reuse from existing cache.
    const existing = cachedChatLines.find(c => c.key === lineKey);
    if (existing) {
      newCachedLines.push(existing);
    } else {
      const surface = factory.create({
        text: `${name}: ${entry.message}`,
        fillColor: '#fff',
        outlineColor: '#000',
        fontPx: CHAT_FONT_PX,
      });
      newCachedLines.push({ key: lineKey, surface });
    }
  }
  // Release any old surfaces no longer in the visible window.
  for (const old of cachedChatLines) {
    if (!newCachedLines.includes(old)) {
      factory.release(old.surface);
    }
  }
  cachedChatLines = newCachedLines;

  // Draw chat lines.
  for (let i = 0; i < cachedChatLines.length; i++) {
    const { surface } = cachedChatLines[i];
    const y = chatBaseY + i * CHAT_LINE_H;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, surface.texture);
    sprites.drawSprite(CHAT_PAD_X, y, surface.width, surface.height, 0, 0, 1, 1);
  }

  // --- Chat input ---
  if (keyboard.chatActive) {
    const inputY = chatBaseY + cachedChatLines.length * CHAT_LINE_H + 4;
    const inputText = `> ${keyboard.chatBuffer}_`;
    const inputKey = inputText;
    cachedInput = getOrCreate(factory, inputKey, cachedInput, '#ff0', CHAT_FONT_PX, '#000');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cachedInput.surface.texture);
    sprites.drawSprite(
      CHAT_PAD_X, inputY,
      cachedInput.surface.width, cachedInput.surface.height,
      0, 0, 1, 1,
    );
  }

  // --- Debug overlay (top bar) ---
  if (keyboard.debugMode && debugLabel) {
    cachedDebug = getOrCreate(factory, debugLabel, cachedDebug, '#0f0', DEBUG_FONT_PX, '#000');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cachedDebug.surface.texture);
    sprites.drawSprite(
      CHAT_PAD_X, CHAT_PAD_Y,
      cachedDebug.surface.width, cachedDebug.surface.height,
      0, 0, 1, 1,
    );
  }

  sprites.end();
}
