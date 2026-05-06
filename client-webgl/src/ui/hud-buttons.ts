// Bottom-right HUD action bar — three tap-friendly buttons that surface
// the contextual right-click action plus shortcuts for the inventory and
// settings overlays. Designed for tap-only / mobile play; desktop users
// can still use right-click + `i` + Esc as before.
//
// Layout (canvas-pixel space, anchored to the bottom-right of the game
// area, same y as the centered HUD quickbar):
//
//   [ Action label  ] [ Inventory ] [ Settings ]
//
// The action button is conditionally visible based on the selected
// quickslot's mode (`selectedMode(scene)`):
//   • placement → "Place {Name}"   — tap arms; next world tap places.
//   • cook      → "Cook {Name}"    — tap arms; next world tap cooks.
//   • consumable→ "Eat {Name}"     — tap fires immediately on self.
//   • tool|none → no button.
//
// "Armed" placement / cook persists across taps so the user can keep
// building walls (or cooking raw fish, etc.) without re-arming each time.
// See `Scene.armedAction` for the lifecycle.

import { ClientAction } from '@shared/actions.js';
import { getBlueprint } from '@shared/blueprints.js';
import { GAME_X, GAME_Y, GAME_W, GAME_H } from '../platform/config.js';
import type { Scene } from '../scene.js';
import type { Connection } from '../network/connection.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { TextSurface, TextSurfaceFactory } from '../effects/text-surface.js';
import { createCanvasTexture } from '../platform/gl-utils.js';
import { selectedItem, selectedMode } from './quickslot.js';

export type HudButtonId = 'action' | 'inventory' | 'settings';

const BUTTON_H = 44;
const BUTTON_W = 140;
const BUTTON_GAP = 6;
const BUTTON_RIGHT_MARGIN = 8;
const BUTTON_Y = GAME_Y + GAME_H - BUTTON_H - 8;
const FONT_PX = 14;

/** Right-edge x of the rightmost (settings) button. */
const RIGHT_EDGE_X = GAME_X + GAME_W - BUTTON_RIGHT_MARGIN;

interface ButtonRect { x: number; y: number; w: number; h: number }

/** The three buttons live at fixed positions; the action slot is reserved
 *  even when the button is hidden so inventory + settings don't shuffle. */
function buttonRect(id: HudButtonId): ButtonRect {
  const stride = BUTTON_W + BUTTON_GAP;
  // Right→left: settings, inventory, action.
  const fromRight = id === 'settings' ? 0 : id === 'inventory' ? 1 : 2;
  return {
    x: RIGHT_EDGE_X - BUTTON_W - fromRight * stride,
    y: BUTTON_Y,
    w: BUTTON_W,
    h: BUTTON_H,
  };
}

// --- Solids + text cache (mirror of inventory-panel.ts patterns, kept
//     local so this module is self-contained) -------------------------

interface ButtonSolids {
  bg: WebGLTexture;
  bgArmed: WebGLTexture;
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
    bgArmed: mk('#a97a1c'),
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

/** Label for the contextual action button, or null when no action is
 *  available for the current selection. */
export function getActionButtonLabel(scene: Scene): string | null {
  const mode = selectedMode(scene);
  if (mode === 'tool' || mode === 'none') return null;
  const item = selectedItem(scene);
  if (!item) return null;
  const bp = getBlueprint(item.blueprintId);
  if (!bp) return null;
  const name = bp.name;
  if (mode === 'placement') return `Place ${name}`;
  if (mode === 'cook')      return `Cook ${name}`;
  if (mode === 'consumable') return `Eat ${name}`;
  return null;
}

export function isActionButtonVisible(scene: Scene): boolean {
  return getActionButtonLabel(scene) !== null;
}

/** True iff at least one HUD button needs to draw this frame. The HUD
 *  quickbar gating already covers the overlay-open case; this just lets
 *  the HUD pass start up when the inventory + settings buttons are
 *  always visible. */
export function hudButtonsVisible(_scene: Scene): boolean {
  // Inventory + Settings are always shown during free play; the action
  // button is shown when applicable. So during free play, the bar is
  // always visible.
  return true;
}

export function hitTestHudButton(
  canvasX: number, canvasY: number, scene: Scene,
): HudButtonId | null {
  if (canvasY < BUTTON_Y || canvasY >= BUTTON_Y + BUTTON_H) return null;
  for (const id of ['action', 'inventory', 'settings'] as const) {
    if (id === 'action' && !isActionButtonVisible(scene)) continue;
    const r = buttonRect(id);
    if (canvasX >= r.x && canvasX < r.x + r.w) return id;
  }
  return null;
}

export function handleHudButtonClick(
  scene: Scene,
  connection: Connection,
  id: HudButtonId,
): void {
  if (id === 'inventory') {
    scene.armedAction = null;
    scene.overlay = { kind: 'inventory' };
    return;
  }
  if (id === 'settings') {
    scene.armedAction = null;
    scene.overlay = { kind: 'menu', screen: 'settings', context: 'in-game' };
    return;
  }
  // Action button.
  const mode = selectedMode(scene);
  if (mode === 'consumable') {
    const item = selectedItem(scene);
    if (item) connection.send({ action: ClientAction.UseConsumable, itemId: item.itemId });
    return;
  }
  if (mode === 'placement' || mode === 'cook') {
    scene.armedAction = scene.armedAction === mode ? null : mode;
  }
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
  armed: boolean,
): void {
  // 1px border.
  drawSolid(gl, sprites, solids.border, rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2);
  drawSolid(gl, sprites, armed ? solids.bgArmed : solids.bg, rect.x, rect.y, rect.w, rect.h);
  const surface = text(factory, label);
  const tx = rect.x + (rect.w - surface.width) / 2;
  const ty = rect.y + (rect.h - surface.height) / 2;
  drawText(gl, sprites, surface, tx, ty);
}

/** Draw the HUD button bar. Caller must have `sprites.begin(resolution)`
 *  already active (HUD resolution, no lightmap). */
export function drawHudButtons(
  gl: WebGL2RenderingContext,
  scene: Scene,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
): void {
  const solids = getSolids(gl);

  const actionLabel = getActionButtonLabel(scene);
  if (actionLabel) {
    drawOneButton(
      gl, sprites, factory, solids,
      buttonRect('action'),
      actionLabel,
      scene.armedAction !== null,
    );
  }
  drawOneButton(gl, sprites, factory, solids, buttonRect('inventory'), 'Inventory', false);
  drawOneButton(gl, sprites, factory, solids, buttonRect('settings'), 'Settings', false);
}

// --- Test exports -------------------------------------------------------

/** Exported for tests. Mirrors `quickslotCellRect` etc. */
export function hudButtonRect(id: HudButtonId): ButtonRect {
  return buttonRect(id);
}
