// Bottom-right HUD button bar — Inventory + Settings shortcuts. Designed
// for tap-only / mobile play; desktop users still have `i` and Esc.
//
// Layout (canvas-pixel space, anchored to the bottom-right of the game
// area, same y as the centered HUD quickbar):
//
//   [ Inventory ] [ Settings ]
//
// The world action (place / cook / eat) used to live as a third "action"
// button to the left, but the quickslot+left-click contract replaced it:
// selecting a placeable/cookable quickslot makes left-click commit the
// action directly, and selecting a consumable quickslot fires the use
// inline. See `controls/mouse.ts` and `ui/quickslot.ts`.

import { GAME_X, GAME_Y, GAME_W, GAME_H } from '../platform/config.js';
import type { Scene } from '../scene.js';
import type { Connection } from '../network/connection.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { TextSurface, TextSurfaceFactory } from '../effects/text-surface.js';
import { createCanvasTexture } from '../platform/gl-utils.js';

export type HudButtonId = 'inventory' | 'settings';

const BUTTON_H = 44;
const SIDE_BUTTON_W = 100;
const BUTTON_GAP = 6;
const BUTTON_RIGHT_MARGIN = 8;
const BUTTON_Y = GAME_Y + GAME_H - BUTTON_H - 8;
const FONT_PX = 14;

/** Right-edge x of the rightmost (settings) button. */
const RIGHT_EDGE_X = GAME_X + GAME_W - BUTTON_RIGHT_MARGIN;

interface ButtonRect { x: number; y: number; w: number; h: number }

function buttonRect(id: HudButtonId): ButtonRect {
  const settingsX = RIGHT_EDGE_X - SIDE_BUTTON_W;
  const inventoryX = settingsX - BUTTON_GAP - SIDE_BUTTON_W;
  if (id === 'settings')  return { x: settingsX,  y: BUTTON_Y, w: SIDE_BUTTON_W, h: BUTTON_H };
  return                         { x: inventoryX, y: BUTTON_Y, w: SIDE_BUTTON_W, h: BUTTON_H };
}

// --- Solids + text cache -----------------------------------------------

interface ButtonSolids {
  bg: WebGLTexture;
  border: WebGLTexture;
}

let cachedSolids: ButtonSolids | null = null;

function getSolids(gl: WebGL2RenderingContext): ButtonSolids {
  if (cachedSolids) return cachedSolids;
  const mk = (color: string): WebGLTexture => {
    const c = new OffscreenCanvas(4, 4);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 4, 4);
    return createCanvasTexture(gl, c);
  };
  cachedSolids = {
    bg: mk('#3a3f4c'),
    border: mk('#1a1e28'),
  };
  return cachedSolids;
}

const textCache = new Map<string, TextSurface>();

function text(factory: TextSurfaceFactory, label: string): TextSurface {
  const existing = textCache.get(label);
  if (existing) return existing;
  const surface = factory.create({
    text: label,
    fillColor: '#fff',
    outlineColor: '#000',
    fontPx: FONT_PX,
    bold: true,
  });
  textCache.set(label, surface);
  return surface;
}

// --- Public API ---------------------------------------------------------

/** Inventory + Settings are always shown during free play. */
export function hudButtonsVisible(_scene: Scene): boolean {
  return true;
}

export function hitTestHudButton(
  canvasX: number, canvasY: number, _scene: Scene,
): HudButtonId | null {
  if (canvasY < BUTTON_Y || canvasY >= BUTTON_Y + BUTTON_H) return null;
  for (const id of ['inventory', 'settings'] as const) {
    const r = buttonRect(id);
    if (canvasX >= r.x && canvasX < r.x + r.w) return id;
  }
  return null;
}

export function handleHudButtonClick(
  scene: Scene,
  _connection: Connection,
  id: HudButtonId,
): void {
  if (id === 'inventory') {
    scene.overlay = { kind: 'inventory' };
    return;
  }
  scene.overlay = { kind: 'menu', screen: 'settings', context: 'in-game' };
}

// --- Draw ---------------------------------------------------------------

function drawSolid(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  tex: WebGLTexture,
  x: number, y: number, w: number, h: number,
): void {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  sprites.setAlpha(1);
  sprites.drawSprite(x, y, w, h, 0, 0, 1, 1);
}

function drawText(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  surface: TextSurface,
  x: number, y: number,
): void {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, surface.texture);
  sprites.setAlpha(1);
  sprites.drawSprite(x, y, surface.width, surface.height, 0, 0, 1, 1);
}

function drawOneButton(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
  solids: ButtonSolids,
  rect: ButtonRect,
  label: string,
): void {
  drawSolid(gl, sprites, solids.border, rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
  drawSolid(gl, sprites, solids.bg, rect.x, rect.y, rect.w, rect.h);
  const surface = text(factory, label);
  const tx = rect.x + (rect.w - surface.width) / 2;
  const ty = rect.y + (rect.h - surface.height) / 2;
  drawText(gl, sprites, surface, tx, ty);
}

/** Draw the HUD button bar. Caller must have `sprites.begin(resolution)`
 *  already active (HUD resolution, no lightmap). */
export function drawHudButtons(
  gl: WebGL2RenderingContext,
  _scene: Scene,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
): void {
  const solids = getSolids(gl);
  drawOneButton(gl, sprites, factory, solids, buttonRect('inventory'), 'Inventory');
  drawOneButton(gl, sprites, factory, solids, buttonRect('settings'), 'Settings');
}

// --- Test exports -------------------------------------------------------

export function hudButtonRect(id: HudButtonId): ButtonRect {
  return buttonRect(id);
}
