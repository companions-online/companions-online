// HUD overlay — chat log, chat input, debug label, quickbar, inventory panel.
// Drawn in-game at canvas resolution (after the game scissor pass is disabled)
// so it sits on top of the play area. Uses TextSurfaceFactory for text
// rendering + SpriteRenderer for blitting.

import { getBlueprint } from '@shared/blueprints.js';
import { MetaKey } from '@shared/entity-meta.js';
import { GAME_X, GAME_Y, GAME_W, GAME_H } from '../platform/config.js';
import type { TextSurface, TextSurfaceFactory } from '../effects/text-surface.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { Scene } from '../scene.js';
import type { KeyboardState } from '../controls/keyboard.js';
import { drawInventoryPanel, drawHeldCursor, drawQuickbarHud } from './inventory-panel.js';

const CHAT_FONT_PX = 13;
const CHAT_LINE_H = CHAT_FONT_PX + 4;
const CHAT_MAX_VISIBLE = 8;
const CHAT_PAD_X = 10;
const CHAT_PAD_Y = 8;
/** A chat line stays full opacity for CHAT_FULL_MS then fades over CHAT_FADE_MS. */
const CHAT_FULL_MS = 30_000;
const CHAT_FADE_MS = 5_000;
const CHAT_LIFETIME_MS = CHAT_FULL_MS + CHAT_FADE_MS;
const DEBUG_FONT_PX = 14;
const DEBUG_PAD = 6;

/** Per-line opacity for chat-log overlay. Full opacity until `CHAT_FULL_MS`,
 *  linear fade to zero over the next `CHAT_FADE_MS`. Exported for tests. */
export function chatLineAlpha(ageMs: number): number {
  if (ageMs <= CHAT_FULL_MS) return 1;
  if (ageMs >= CHAT_LIFETIME_MS) return 0;
  return 1 - (ageMs - CHAT_FULL_MS) / CHAT_FADE_MS;
}

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
  const meta = scene.entityMeta.get(entityId)?.get(MetaKey.Name);
  if (meta) return meta;
  const entity = scene.entities.get(entityId);
  if (!entity?.blueprint) return '???';
  const bp = getBlueprint(entity.blueprint.blueprintId);
  return bp?.name ?? '???';
}

function formatChatLine(scene: Scene, senderEntityId: number, message: string): string {
  if (senderEntityId === 0) return message;
  return `${senderName(scene, senderEntityId)}: ${message}`;
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
  // The HUD quickbar is always shown when the inventory panel is closed,
  // so force a sprites.begin() pass even if chat + debug are quiet.
  const showHudQuickbar = !scene.inventoryOpen;
  const needSprites =
    scene.chatLog.length > 0 || keyboard.chatActive || (keyboard.debugMode && debugLabel) || scene.inventoryOpen || showHudQuickbar;

  if (!needSprites) return;

  sprites.begin(resolution);

  // --- Chat input (pinned to bottom-left of play area) + chat log above it ---
  const inputY = GAME_Y + GAME_H - CHAT_PAD_Y - CHAT_FONT_PX;
  const inputX = GAME_X + CHAT_PAD_X;
  const chatBottomY = inputY - CHAT_LINE_H; // y of the newest chat line

  // Age-filter + cap. Oldest retained entry sits highest; newest sits at chatBottomY.
  const now = Date.now();
  const live: typeof scene.chatLog = [];
  for (const entry of scene.chatLog) {
    if (now - entry.receivedAt < CHAT_LIFETIME_MS) live.push(entry);
  }
  const visibleLog = live.slice(-CHAT_MAX_VISIBLE);

  // Build chat line keys and sync cache.
  const newCachedLines: { key: string; surface: TextSurface }[] = [];
  for (let i = 0; i < visibleLog.length; i++) {
    const entry = visibleLog[i];
    const text = formatChatLine(scene, entry.senderEntityId, entry.message);
    const lineKey = `${entry.receivedAt}|${text}`;
    const existing = cachedChatLines.find(c => c.key === lineKey);
    if (existing) {
      newCachedLines.push(existing);
    } else {
      const surface = factory.create({
        text,
        fillColor: entry.senderEntityId === 0 ? '#fa0' : '#fff',
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

  // Draw chat lines: newest (index visibleLog.length-1) at chatBottomY,
  // older stacked upward.
  for (let i = 0; i < cachedChatLines.length; i++) {
    const { surface } = cachedChatLines[i];
    const age = now - visibleLog[i].receivedAt;
    const alpha = chatLineAlpha(age);
    if (alpha <= 0) continue;
    const stackFromBottom = cachedChatLines.length - 1 - i;
    const y = chatBottomY - stackFromBottom * CHAT_LINE_H;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, surface.texture);
    sprites.setAlpha(alpha);
    sprites.drawSprite(inputX, y, surface.width, surface.height, 0, 0, 1, 1);
  }
  sprites.setAlpha(1);

  // --- Chat input (drawn below the chat log, pinned to bottom) ---
  if (keyboard.chatActive) {
    const inputText = `> ${keyboard.chatBuffer}_`;
    cachedInput = getOrCreate(factory, inputText, cachedInput, '#ff0', CHAT_FONT_PX, '#000');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cachedInput.surface.texture);
    sprites.drawSprite(
      inputX, inputY,
      cachedInput.surface.width, cachedInput.surface.height,
      0, 0, 1, 1,
    );
  }

  // --- Debug overlay (top-left of play area) ---
  if (keyboard.debugMode && debugLabel) {
    cachedDebug = getOrCreate(factory, debugLabel, cachedDebug, '#ff0', DEBUG_FONT_PX, '#000');
    const dstX = GAME_X + DEBUG_PAD;
    const dstY = GAME_Y + DEBUG_PAD;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cachedDebug.surface.texture);
    sprites.drawSprite(
      dstX, dstY,
      cachedDebug.surface.width, cachedDebug.surface.height,
      0, 0, 1, 1,
    );
  }

  // --- HUD quickbar (visible when inventory panel is closed) ---
  if (showHudQuickbar) {
    drawQuickbarHud(gl, scene, sprites, factory);
  }

  // --- Inventory panel (overlays everything else when open) ---
  if (scene.inventoryOpen) {
    drawInventoryPanel(gl, scene, sprites, factory);
    // Held-stack ghost follows the mouse on top of the panel.
    drawHeldCursor(gl, scene, sprites, factory);
  }

  sprites.end();
}
