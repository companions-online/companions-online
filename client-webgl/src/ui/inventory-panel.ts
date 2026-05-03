// Minecraft-style inventory panel for the WebGL client.
//
// Drawn by the HUD pass when `isInventoryShowing(scene.overlay)`. Sections
// over a translucent backdrop:
//   • LEFT     — player stats (name, HP, weight) + head/body/boot armor
//                slot widgets (hand is driven by the quickbar below)
//   • CENTER   — 9×3 grid of inventory cells (icon + quantity badge),
//                slot layout comes from `scene.gridOrder`
//   • QUICKBAR — 9-cell row beneath the grid. Binds itemIds to slots
//                1..9; items bound here are NOT shown in the main grid.
//                Selection highlight reflects `scene.selectedQuickSlot`.
//   • RIGHT    — recipe cards (when no chest open) OR container items.
//
// Hit-testing and click routing live alongside the draw path — the mouse
// controller calls `hitTestInventoryPanel` and `handleInventoryPanelClick`.

import { getBlueprint, BlueprintType } from '@shared/blueprints.js';
import { getAllRecipes } from '@shared/recipes.js';
import { canCraft, getWeight, getEquipped, numberToEquipSlot, equipSlotToNumber, type EquipSlot } from '@shared/inventory.js';
import { ClientAction } from '@shared/actions.js';
import { MetaKey } from '@shared/entity-meta.js';
import { CANVAS_W, CANVAS_H, GAME_X, GAME_Y, GAME_W, GAME_H } from '../platform/config.js';
import type { Scene } from '../scene.js';
import type { Connection } from '../network/connection.js';
import type { SpriteRenderer } from '../entities/sprite-renderer.js';
import type { SpriteRegistry, SpriteSheetRef } from '../entities/sprite-registry.js';
import type { TextSurface, TextSurfaceFactory } from '../effects/text-surface.js';
import { createCanvasTexture } from '../platform/gl-utils.js';
import { getContainer } from '../overlay.js';

// In-flight removal entries (Drop / Transfer / Equip-with-quantity)
// expire after this long if the server never sends a confirming sync —
// covers the case where the action was rejected silently.
const PENDING_DECREMENT_TTL_MS = 1000;

/** Note that `qty` of `itemId` is about to vanish from the inventory.
 *  Used so the source slot stays empty during the round-trip instead of
 *  flickering back to its full count for one frame. */
export function markPendingDecrement(scene: Scene, itemId: number, qty: number): void {
  const existing = scene.pendingItemDecrements.get(itemId);
  scene.pendingItemDecrements.set(itemId, {
    quantity: (existing?.quantity ?? 0) + qty,
    timestamp: Date.now(),
  });
}

/** Effective decrement, GC'ing entries past the TTL so a rejected action
 *  doesn't strand the slot. */
function pendingDecrement(scene: Scene, itemId: number): number {
  const p = scene.pendingItemDecrements.get(itemId);
  if (!p) return 0;
  if (Date.now() - p.timestamp > PENDING_DECREMENT_TTL_MS) {
    scene.pendingItemDecrements.delete(itemId);
    return 0;
  }
  return p.quantity;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

export const PANEL_W = 1024;
export const PANEL_H = 640;
// Center inside the game viewport (not the full canvas) so the panel
// doesn't drift under the right-side HUD chrome.
export const PANEL_X = GAME_X + (GAME_W - PANEL_W) / 2;
export const PANEL_Y = GAME_Y + (GAME_H - PANEL_H) / 2;

const PAD = 16;

const LEFT_X = PANEL_X + PAD;
const LEFT_W = 220;

const GRID_COLS = 9;
const GRID_ROWS = 3;
export const GRID_SLOT_COUNT = GRID_COLS * GRID_ROWS;
const CELL_SIZE = 48;
const CELL_GAP = 6;
const GRID_W = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * CELL_GAP;
const GRID_H = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * CELL_GAP;
const GRID_X = LEFT_X + LEFT_W + PAD;
const GRID_Y = PANEL_Y + PAD + 36; // leave room for a section title

// Quickbar: a 9-cell row beneath the grid with a small visual gap.
const QUICKBAR_GAP = 24;
export const QUICKSLOT_COUNT = 9;
const QUICKBAR_X = GRID_X;
const QUICKBAR_Y = GRID_Y + GRID_H + QUICKBAR_GAP;
const QUICKBAR_W = GRID_W;

const RIGHT_X = GRID_X + GRID_W + PAD;
const RIGHT_W = PANEL_W - (RIGHT_X - PANEL_X) - PAD;

const RECIPE_ROW_H = 42;
const RECIPE_GAP = 4;

// Container grid uses the same cell size as the player grid, laid out in
// the right-hand column when a container is open. Rows are sized for the
// right-column capacity, decoupled from GRID_ROWS.
const CONTAINER_COLS = Math.max(1, Math.floor((RIGHT_W + CELL_GAP) / (CELL_SIZE + CELL_GAP)));
const CONTAINER_ROWS = 5;
export const CONTAINER_SLOT_COUNT = CONTAINER_COLS * CONTAINER_ROWS;

// Armor slots only — top-down head → body → boot. The hand slot is now
// driven by the quickbar and has no left-column widget.
const EQUIP_SLOTS: EquipSlot[] = ['head', 'body', 'boot'];
const EQUIP_LABEL: Record<EquipSlot, string> = {
  hand: 'HAND', body: 'BODY', head: 'HEAD', boot: 'BOOT',
};

// ---------------------------------------------------------------------------
// Shared solid-color textures (generated lazily on first draw)
// ---------------------------------------------------------------------------

interface Solids {
  backdrop: WebGLTexture;
  cellBg: WebGLTexture;
  cellEquipped: WebGLTexture;
  cellHover: WebGLTexture;
  cellSelected: WebGLTexture;
  divider: WebGLTexture;
  barFill: WebGLTexture;
  barBg: WebGLTexture;
}

let cachedSolids: Solids | null = null;

function getSolids(gl: WebGL2RenderingContext): Solids {
  if (cachedSolids) return cachedSolids;

  const mk = (color: string) => {
    const c = new OffscreenCanvas(4, 4);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 4, 4);
    return createCanvasTexture(gl, c);
  };

  cachedSolids = {
    backdrop: mk('#1a1e28'),
    cellBg: mk('#3a3f4c'),
    cellEquipped: mk('#6e5416'),
    cellHover: mk('#4a5468'),
    cellSelected: mk('#a97a1c'),
    divider: mk('#2a2e38'),
    barFill: mk('#7ec850'),
    barBg: mk('#2a2e38'),
  };
  return cachedSolids;
}

// ---------------------------------------------------------------------------
// Text surface cache (key → surface); released lazily when unreferenced
// for N frames. In practice the panel's text set churns slowly so we keep
// things simple — hang on to every cached surface for the panel's lifetime.
// ---------------------------------------------------------------------------

const textCache = new Map<string, TextSurface>();

function text(factory: TextSurfaceFactory, key: string, opts: Parameters<TextSurfaceFactory['create']>[0]): TextSurface {
  const existing = textCache.get(key);
  if (existing) return existing;
  const surface = factory.create(opts);
  textCache.set(key, surface);
  return surface;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export interface GridCellRect { x: number; y: number; w: number; h: number; slotIndex: number }

export function gridCellRect(slotIndex: number): GridCellRect {
  const col = slotIndex % GRID_COLS;
  const row = Math.floor(slotIndex / GRID_COLS);
  return {
    x: GRID_X + col * (CELL_SIZE + CELL_GAP),
    y: GRID_Y + row * (CELL_SIZE + CELL_GAP),
    w: CELL_SIZE,
    h: CELL_SIZE,
    slotIndex,
  };
}

export interface EquipSlotRect { x: number; y: number; w: number; h: number; slot: EquipSlot }

export function equipSlotRect(slot: EquipSlot): EquipSlotRect {
  const idx = EQUIP_SLOTS.indexOf(slot);
  return {
    x: LEFT_X,
    y: PANEL_Y + PAD + 180 + idx * (CELL_SIZE + 18),
    w: CELL_SIZE,
    h: CELL_SIZE,
    slot,
  };
}

export interface ContainerCellRect { x: number; y: number; w: number; h: number; slotIndex: number }

export function containerCellRect(slotIndex: number): ContainerCellRect {
  const col = slotIndex % CONTAINER_COLS;
  const row = Math.floor(slotIndex / CONTAINER_COLS);
  return {
    x: RIGHT_X + col * (CELL_SIZE + CELL_GAP),
    y: GRID_Y + row * (CELL_SIZE + CELL_GAP),
    w: CELL_SIZE,
    h: CELL_SIZE,
    slotIndex,
  };
}

export interface QuickslotCellRect { x: number; y: number; w: number; h: number; slotIndex: number }

export function quickslotCellRect(slotIndex: number): QuickslotCellRect {
  return {
    x: QUICKBAR_X + slotIndex * (CELL_SIZE + CELL_GAP),
    y: QUICKBAR_Y,
    w: CELL_SIZE,
    h: CELL_SIZE,
    slotIndex,
  };
}

export interface RecipeRowRect { x: number; y: number; w: number; h: number; recipeId: number }

/** Position-only — caller passes the recipeId since the visible-recipe
 *  list is filtered by craftability and not stable across syncs. */
export function recipeRowRectAt(index: number, recipeId: number): RecipeRowRect {
  return {
    x: RIGHT_X,
    y: GRID_Y + index * (RECIPE_ROW_H + RECIPE_GAP),
    w: RIGHT_W,
    h: RECIPE_ROW_H,
    recipeId,
  };
}

/** Build the list of recipes the player can currently craft. Used by
 *  both the draw path and the hit-test so they index the same set. */
function visibleRecipes(scene: Scene) {
  const inv = toLogicalInventory(scene);
  return getAllRecipes().filter(r => canCraft(r, inv));
}

// ---------------------------------------------------------------------------
// Draw primitives
// ---------------------------------------------------------------------------

function drawSolid(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  tex: WebGLTexture,
  x: number, y: number, w: number, h: number,
  alpha = 1,
): void {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  sprites.setAlpha(alpha);
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

/** Draw the frame-0 icon of a blueprint's sprite sheet into a fixed-size
 *  square, preserving aspect ratio via a contain-fit. Handles three sheet
 *  shapes: animation grids (slice the first frame), creature walk-cycle
 *  sheets (slice top-left), and single-image sprites (whole texture). */
function drawItemIcon(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  registry: SpriteRegistry,
  blueprintId: number,
  x: number, y: number, boxSize: number,
): void {
  const sheet: SpriteSheetRef = registry.resolve(blueprintId, 0);

  // Resolve UV rect for the icon. Mirrors the world-renderer dispatch
  // in static-entity.ts: animation grids slice 1/cols × 1/rows; the door
  // is special-cased (its 2×2 sheet has no `animation` field but isn't a
  // single image either); everything else (static-layout sprites + tree)
  // samples the whole texture.
  let uvU = 0, uvV = 0, uvDU = 1, uvDV = 1;
  if (sheet.animation) {
    uvDU = 1 / sheet.animation.cols;
    uvDV = 1 / sheet.animation.rows;
  } else if (blueprintId === BlueprintType.WoodenDoor) {
    uvDU = 0.5;
    uvDV = 0.5;
  }

  // Contain-fit into the box using the rendered display size, not the
  // source-pixel size — `renderW/H` is what other draw paths use, so the
  // inventory icon ends up at the same visual scale as the world sprite.
  const ratio = Math.min(boxSize / sheet.renderW, boxSize / sheet.renderH) * 0.9;
  const drawW = sheet.renderW * ratio;
  const drawH = sheet.renderH * ratio;
  const drawX = x + (boxSize - drawW) / 2;
  const drawY = y + (boxSize - drawH) / 2;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sheet.texture);
  sprites.setAlpha(1);
  sprites.drawSprite(drawX, drawY, drawW, drawH, uvU, uvV, uvDU, uvDV);
}

// ---------------------------------------------------------------------------
// Section draws
// ---------------------------------------------------------------------------

function drawPlayerSection(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
  scene: Scene,
  solids: Solids,
): void {
  // Title
  drawText(gl, sprites, text(factory, 'title:player', {
    text: 'PLAYER', fillColor: '#e8d48a', fontPx: 16, bold: true,
  }), LEFT_X, PANEL_Y + PAD);

  // Name
  const me = scene.myEntityId !== null ? scene.entities.get(scene.myEntityId) : undefined;
  const nameStr = (scene.myEntityId !== null
    ? scene.entityMeta.get(scene.myEntityId)?.get(MetaKey.Name)
    : undefined) ?? 'Player';
  drawText(gl, sprites, text(factory, `name:${nameStr}`, {
    text: nameStr, fillColor: '#fff', fontPx: 18, bold: true,
  }), LEFT_X, PANEL_Y + PAD + 28);

  // HP bar
  const health = me?.health;
  const curHp = health?.currentHp ?? 0;
  const maxHp = health?.maxHp ?? 0;
  const hpLabel = `HP  ${curHp}/${maxHp}`;
  drawText(gl, sprites, text(factory, `hp:${hpLabel}`, {
    text: hpLabel, fillColor: '#fff', fontPx: 13,
  }), LEFT_X, PANEL_Y + PAD + 60);

  const barY = PANEL_Y + PAD + 80;
  const barW = LEFT_W;
  const barH = 10;
  drawSolid(gl, sprites, solids.barBg, LEFT_X, barY, barW, barH);
  if (maxHp > 0) {
    drawSolid(gl, sprites, solids.barFill, LEFT_X, barY, barW * (curHp / maxHp), barH);
  }

  // Weight
  const inv = { items: scene.inventory.map(i => ({
    itemId: i.itemId, blueprintId: i.blueprintId, quantity: i.quantity,
    equippedSlot: numberToEquipSlot(i.equippedSlot),
  })), maxWeight: 50 };
  const weight = getWeight(inv);
  const wtLabel = `Weight  ${weight}/50`;
  drawText(gl, sprites, text(factory, `wt:${wtLabel}`, {
    text: wtLabel, fillColor: '#fff', fontPx: 13,
  }), LEFT_X, PANEL_Y + PAD + 102);

  // Equipment slot header
  drawText(gl, sprites, text(factory, 'title:equipped', {
    text: 'EQUIPPED', fillColor: '#e8d48a', fontPx: 13, bold: true,
  }), LEFT_X, PANEL_Y + PAD + 150);

  // Three equipment slot cells.
  for (const slot of EQUIP_SLOTS) {
    const rect = equipSlotRect(slot);
    const occupant = getEquipped(inv, slot);
    drawSolid(gl, sprites, occupant ? solids.cellEquipped : solids.cellBg, rect.x, rect.y, rect.w, rect.h);
    if (occupant) {
      drawItemIcon(gl, sprites, scene.spriteRegistry, occupant.blueprintId, rect.x, rect.y, rect.w);
      if (occupant.quantity > 1) {
        drawQuantityBadge(gl, sprites, factory, occupant.quantity, rect.x, rect.y, rect.w, rect.h);
      }
    }
    // Label beside the slot.
    drawText(gl, sprites, text(factory, `eqlabel:${slot}`, {
      text: EQUIP_LABEL[slot], fillColor: '#aab4c2', fontPx: 11,
    }), rect.x + rect.w + 8, rect.y + rect.h / 2 - 6);
  }
}

function drawQuantityBadge(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
  quantity: number,
  cellX: number, cellY: number, cellW: number, cellH: number,
): void {
  const surface = text(factory, `qty:${quantity}`, {
    text: String(quantity), fillColor: '#fff', outlineColor: '#000', fontPx: 12, bold: true,
  });
  drawText(gl, sprites, surface, cellX + cellW - surface.width - 2, cellY + cellH - surface.height - 2);
}

function drawGridSection(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
  scene: Scene,
  solids: Solids,
): void {
  // Title
  drawText(gl, sprites, text(factory, 'title:inventory', {
    text: 'INVENTORY', fillColor: '#e8d48a', fontPx: 16, bold: true,
  }), GRID_X, PANEL_Y + PAD);

  // Empty cells first.
  for (let i = 0; i < GRID_SLOT_COUNT; i++) {
    const r = gridCellRect(i);
    drawSolid(gl, sprites, solids.cellBg, r.x, r.y, r.w, r.h);
  }

  // Items bound to the quickbar are NOT drawn in the grid.
  const inQuickbar = new Set<number>();
  for (const id of scene.quickSlots) if (id !== null) inQuickbar.add(id);

  // Items in their gridOrder-assigned slots.
  for (const item of scene.inventory) {
    if (inQuickbar.has(item.itemId)) continue;
    const slot = scene.gridOrder.get(item.itemId);
    if (slot === undefined || slot < 0 || slot >= GRID_SLOT_COUNT) continue;
    const r = gridCellRect(slot);
    const heldQty = scene.heldStack && scene.heldStack.itemId === item.itemId
      ? scene.heldStack.quantity : 0;
    const pendingQty = pendingDecrement(scene, item.itemId);
    const shownQty = item.quantity - heldQty - pendingQty;
    if (shownQty <= 0) continue;
    drawItemIcon(gl, sprites, scene.spriteRegistry, item.blueprintId, r.x, r.y, r.w);
    if (shownQty > 1) {
      drawQuantityBadge(gl, sprites, factory, shownQty, r.x, r.y, r.w, r.h);
    }
  }
}

function drawQuickbarSection(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
  scene: Scene,
  solids: Solids,
): void {
  // Section label sits just above the row.
  drawText(gl, sprites, text(factory, 'title:quickbar', {
    text: 'QUICKSLOTS', fillColor: '#e8d48a', fontPx: 13, bold: true,
  }), QUICKBAR_X, QUICKBAR_Y - 18);

  drawQuickbarCells(gl, sprites, factory, scene, solids, {
    x: QUICKBAR_X,
    y: QUICKBAR_Y,
    cellSize: CELL_SIZE,
    cellGap: CELL_GAP,
  });
}

export interface QuickbarCellsOpts {
  x: number;
  y: number;
  cellSize: number;
  cellGap: number;
}

/** Shared quickbar cell-draw helper. Renders 9 cells in a row starting at
 *  `(x, y)`, each of size `cellSize × cellSize` separated by `cellGap`.
 *  The selected slot uses `solids.cellSelected`. Items are drawn as icons
 *  with quantity badges; empty slots show only the numeric label. Used by
 *  both the in-panel quickbar row and the always-visible HUD quickbar. */
export function drawQuickbarCells(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
  scene: Scene,
  solids: Solids,
  opts: QuickbarCellsOpts,
): void {
  const { x: baseX, y: baseY, cellSize, cellGap } = opts;
  const stride = cellSize + cellGap;
  for (let i = 0; i < QUICKSLOT_COUNT; i++) {
    const cx = baseX + i * stride;
    const cy = baseY;
    const bg = scene.selectedQuickSlot === i ? solids.cellSelected : solids.cellBg;
    drawSolid(gl, sprites, bg, cx, cy, cellSize, cellSize);

    // Slot number label in the top-left of the cell.
    drawText(gl, sprites, text(factory, `qsnum:${i + 1}`, {
      text: String(i + 1), fillColor: '#d8dde5', outlineColor: '#000', fontPx: 10, bold: true,
    }), cx + 3, cy + 2);

    const itemId = scene.quickSlots[i];
    if (itemId === null) continue;
    const item = scene.inventory.find(it => it.itemId === itemId);
    if (!item) continue;
    const heldQty = scene.heldStack && scene.heldStack.itemId === item.itemId
      ? scene.heldStack.quantity : 0;
    const pendingQty = pendingDecrement(scene, item.itemId);
    const shownQty = item.quantity - heldQty - pendingQty;
    if (shownQty <= 0) continue;
    drawItemIcon(gl, sprites, scene.spriteRegistry, item.blueprintId, cx, cy, cellSize);
    if (shownQty > 1) {
      drawQuantityBadge(gl, sprites, factory, shownQty, cx, cy, cellSize, cellSize);
    }
  }
}

// --- Always-visible HUD quickbar ---

/** Compact HUD quickbar geometry — 9 cells pinned to the bottom of the
 *  game viewport. Smaller than the in-panel version so it doesn't crowd
 *  the play area. */
const HUD_QUICKBAR_CELL = 44;
const HUD_QUICKBAR_GAP = 4;
const HUD_QUICKBAR_W = QUICKSLOT_COUNT * HUD_QUICKBAR_CELL + (QUICKSLOT_COUNT - 1) * HUD_QUICKBAR_GAP;
const HUD_QUICKBAR_X = GAME_X + (GAME_W - HUD_QUICKBAR_W) / 2;
const HUD_QUICKBAR_Y = GAME_Y + GAME_H - HUD_QUICKBAR_CELL - 8;

/** Draw the always-visible quickbar at the bottom of the game viewport.
 *  Caller must have `sprites.begin(resolution)` active for the HUD pass.
 *  Gated elsewhere to only fire when `isInventoryShowing(scene.overlay)`
 *  is false so it doesn't render underneath the inventory panel's own
 *  quickbar row. */
export function drawQuickbarHud(
  gl: WebGL2RenderingContext,
  scene: Scene,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
): void {
  const solids = getSolids(gl);
  drawQuickbarCells(gl, sprites, factory, scene, solids, {
    x: HUD_QUICKBAR_X,
    y: HUD_QUICKBAR_Y,
    cellSize: HUD_QUICKBAR_CELL,
    cellGap: HUD_QUICKBAR_GAP,
  });
}

function drawRecipesSection(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
  scene: Scene,
  solids: Solids,
): void {
  drawText(gl, sprites, text(factory, 'title:craft', {
    text: 'CRAFTING', fillColor: '#e8d48a', fontPx: 16, bold: true,
  }), RIGHT_X, PANEL_Y + PAD);

  const recipes = visibleRecipes(scene);
  if (recipes.length === 0) {
    drawText(gl, sprites, text(factory, 'craft:empty', {
      text: '(gather more resources)',
      fillColor: '#8a8f98', fontPx: 12,
    }), RIGHT_X, GRID_Y + 4);
    return;
  }

  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i];
    const r = recipeRowRectAt(i, recipe.id);
    if (r.y + r.h > PANEL_Y + PANEL_H - PAD) break;
    drawSolid(gl, sprites, solids.cellBg, r.x, r.y, r.w, r.h);

    // Output icon.
    drawItemIcon(gl, sprites, scene.spriteRegistry, recipe.output.blueprintId, r.x + 2, r.y + 2, r.h - 4);

    // Output name + quantity.
    const outBp = getBlueprint(recipe.output.blueprintId);
    const outName = `${outBp?.name ?? '?'}${recipe.output.quantity > 1 ? ` x${recipe.output.quantity}` : ''}`;
    const nameSurface = text(factory, `rname:${recipe.id}`, {
      text: outName, fillColor: '#fff', fontPx: 13, bold: true,
    });
    drawText(gl, sprites, nameSurface, r.x + r.h + 4, r.y + 4);

    // Input list — only craftable recipes are shown so no dim treatment.
    const inputsText = recipe.inputs
      .map(inp => `${inp.quantity}× ${getBlueprint(inp.blueprintId)?.name ?? '?'}`)
      .join(', ')
      + (recipe.requiresTool !== undefined
        ? ` (needs ${getBlueprint(recipe.requiresTool)?.name ?? '?'})`
        : '');
    const inpSurface = text(factory, `rinp:${recipe.id}`, {
      text: inputsText, fillColor: '#c2ccd6', fontPx: 11,
    });
    drawText(gl, sprites, inpSurface, r.x + r.h + 4, r.y + r.h - inpSurface.height - 4);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Draw the entire inventory panel. Caller must have `sprites.begin()`
 * already active with the HUD resolution and no lightmap.
 */
export function drawInventoryPanel(
  gl: WebGL2RenderingContext,
  scene: Scene,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
): void {
  const solids = getSolids(gl);

  // Dim the whole screen slightly so the world isn't distracting.
  drawSolid(gl, sprites, solids.backdrop, 0, 0, CANVAS_W, CANVAS_H, 0.55);
  // Panel body.
  drawSolid(gl, sprites, solids.backdrop, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 0.95);
  // Vertical dividers between the three sections.
  drawSolid(gl, sprites, solids.divider, GRID_X - PAD / 2, PANEL_Y + PAD, 1, PANEL_H - 2 * PAD);
  drawSolid(gl, sprites, solids.divider, RIGHT_X - PAD / 2, PANEL_Y + PAD, 1, PANEL_H - 2 * PAD);

  drawPlayerSection(gl, sprites, factory, scene, solids);
  drawGridSection(gl, sprites, factory, scene, solids);
  drawQuickbarSection(gl, sprites, factory, scene, solids);
  if (getContainer(scene.overlay)) {
    drawContainerSection(gl, sprites, factory, scene, solids);
  } else {
    drawRecipesSection(gl, sprites, factory, scene, solids);
  }
}

function drawContainerSection(
  gl: WebGL2RenderingContext,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
  scene: Scene,
  solids: Solids,
): void {
  drawText(gl, sprites, text(factory, 'title:container', {
    text: 'CHEST', fillColor: '#e8d48a', fontPx: 16, bold: true,
  }), RIGHT_X, PANEL_Y + PAD);

  // Empty cells first.
  for (let i = 0; i < CONTAINER_SLOT_COUNT; i++) {
    const r = containerCellRect(i);
    drawSolid(gl, sprites, solids.cellBg, r.x, r.y, r.w, r.h);
  }

  // Items by index.
  const container = getContainer(scene.overlay);
  const items = container?.items ?? [];
  for (let i = 0; i < items.length && i < CONTAINER_SLOT_COUNT; i++) {
    const item = items[i];
    if (!item) continue;
    const r = containerCellRect(i);
    const heldQty = scene.heldStack && scene.heldStack.source === 'container'
      && scene.heldStack.itemId === item.itemId
      ? scene.heldStack.quantity : 0;
    const pendingQty = pendingDecrement(scene, item.itemId);
    const shownQty = item.quantity - heldQty - pendingQty;
    if (shownQty <= 0) continue;
    drawItemIcon(gl, sprites, scene.spriteRegistry, item.blueprintId, r.x, r.y, r.w);
    if (shownQty > 1) {
      drawQuantityBadge(gl, sprites, factory, shownQty, r.x, r.y, r.w, r.h);
    }
  }
}

export function isInsidePanel(x: number, y: number): boolean {
  return x >= PANEL_X && x < PANEL_X + PANEL_W && y >= PANEL_Y && y < PANEL_Y + PANEL_H;
}

/** Draw the ghost of a held stack under the cursor. Caller must have
 *  sprites.begin() active with the HUD resolution. Nothing is drawn if
 *  `scene.heldStack` is null. */
export function drawHeldCursor(
  gl: WebGL2RenderingContext,
  scene: Scene,
  sprites: SpriteRenderer,
  factory: TextSurfaceFactory,
): void {
  if (!scene.heldStack) return;
  const box = CELL_SIZE;
  const x = scene.cursorScreenX - box / 2;
  const y = scene.cursorScreenY - box / 2;
  drawItemIcon(gl, sprites, scene.spriteRegistry, scene.heldStack.blueprintId, x, y, box);
  if (scene.heldStack.quantity > 1) {
    drawQuantityBadge(gl, sprites, factory, scene.heldStack.quantity, x, y, box, box);
  }
}

// ---------------------------------------------------------------------------
// Hit-test + click dispatch
// ---------------------------------------------------------------------------

export type PanelHit =
  | { kind: 'grid'; slotIndex: number }
  | { kind: 'equip'; slot: EquipSlot }
  | { kind: 'quickslot'; slotIndex: number }
  | { kind: 'recipe'; recipeId: number }
  | { kind: 'container'; slotIndex: number }
  | { kind: 'inside' }
  | { kind: 'outside' };

/** Hit-test a panel-space (x, y). When `containerOpen` is true, the right
 *  column contains container cells instead of recipe rows. The recipe
 *  list is filtered to currently-craftable items, so `scene` is needed
 *  to know what's hittable in that column. */
export function hitTestInventoryPanel(x: number, y: number, scene: Scene): PanelHit {
  if (!isInsidePanel(x, y)) return { kind: 'outside' };

  // Grid cells
  for (let i = 0; i < GRID_SLOT_COUNT; i++) {
    const r = gridCellRect(i);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      return { kind: 'grid', slotIndex: i };
    }
  }

  // Quickbar cells
  for (let i = 0; i < QUICKSLOT_COUNT; i++) {
    const r = quickslotCellRect(i);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      return { kind: 'quickslot', slotIndex: i };
    }
  }

  // Equipment slots
  for (const slot of EQUIP_SLOTS) {
    const r = equipSlotRect(slot);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      return { kind: 'equip', slot };
    }
  }

  if (getContainer(scene.overlay)) {
    for (let i = 0; i < CONTAINER_SLOT_COUNT; i++) {
      const r = containerCellRect(i);
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        return { kind: 'container', slotIndex: i };
      }
    }
  } else {
    const recipes = visibleRecipes(scene);
    for (let i = 0; i < recipes.length; i++) {
      const r = recipeRowRectAt(i, recipes[i].id);
      if (r.y + r.h > PANEL_Y + PANEL_H - PAD) break;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        return { kind: 'recipe', recipeId: recipes[i].id };
      }
    }
  }

  return { kind: 'inside' };
}

/** Resolve which inventory item occupies a given grid slot (via gridOrder),
 *  or undefined if empty. */
export function itemInSlot(scene: Scene, slotIndex: number) {
  for (const item of scene.inventory) {
    if (scene.gridOrder.get(item.itemId) === slotIndex) return item;
  }
  return undefined;
}

export interface ClickModifiers { button: 'left' | 'right'; shift: boolean }

export function handleInventoryPanelClick(
  scene: Scene,
  connection: Connection,
  hit: PanelHit,
  mods: ClickModifiers,
): void {
  // Held-stack released outside the panel = drop into world at player's
  // tile. The panel stays open; user can continue dragging.
  if (hit.kind === 'outside') {
    if (scene.heldStack) {
      markPendingDecrement(scene, scene.heldStack.itemId, scene.heldStack.quantity);
      connection.send({
        action: ClientAction.Drop,
        itemId: scene.heldStack.itemId,
        quantity: scene.heldStack.quantity,
      });
      scene.heldStack = null;
    }
    return;
  }

  // Bare click into panel whitespace with no held stack = no-op. With a
  // held stack treat it like a grid drop-empty (merges back into source
  // if possible — handled in grid path below via a virtual "return to
  // source" slot).
  if (hit.kind === 'inside') return;

  if (hit.kind === 'recipe') {
    if (mods.button !== 'left') return;
    if (scene.heldStack) return; // can't craft while holding
    connection.send({ action: ClientAction.Craft, recipeId: hit.recipeId });
    return;
  }

  if (hit.kind === 'grid') {
    handleGridClick(scene, connection, hit.slotIndex, mods);
    return;
  }

  if (hit.kind === 'equip') {
    handleEquipClick(scene, connection, hit.slot, mods);
    return;
  }

  if (hit.kind === 'quickslot') {
    handleQuickslotClick(scene, hit.slotIndex, mods);
    return;
  }

  if (hit.kind === 'container') {
    handleContainerClick(scene, connection, hit.slotIndex, mods);
  }
}

/** Drag dispatch for a quickbar cell. Pure client-side: no wire actions
 *  — the binding just records "this itemId lives in that slot". The
 *  grid/quickbar mutual exclusion is maintained here so the item never
 *  double-renders. */
function handleQuickslotClick(
  scene: Scene,
  slotIndex: number,
  mods: ClickModifiers,
): void {
  if (mods.button !== 'left') return; // no split/pickup-half on quickbar

  const occupantId = scene.quickSlots[slotIndex];

  // --- No held stack ---
  if (!scene.heldStack) {
    if (occupantId === null) return;
    const item = scene.inventory.find(i => i.itemId === occupantId);
    if (!item) {
      // Stale binding (should have been pruned on sync). Drop it now.
      scene.quickSlots[slotIndex] = null;
      return;
    }
    // Pick up whole stack. The binding remains — when the user drops
    // the held stack into another location, that location becomes the
    // new home (and the old quickslot is cleared below in the held-drop
    // path, or in this branch if they re-click the same slot).
    scene.heldStack = {
      itemId: item.itemId,
      blueprintId: item.blueprintId,
      quantity: item.quantity,
      source: 'inventory',
    };
    scene.quickSlots[slotIndex] = null;
    if (scene.selectedQuickSlot === slotIndex) scene.selectedQuickSlot = null;
    return;
  }

  // --- Have held stack ---
  // Only allow whole-stack drops into the quickbar (partial held = no-op,
  // matches cross-item partial-drop behavior elsewhere).
  const sourceItem = scene.inventory.find(i => i.itemId === scene.heldStack!.itemId);
  if (!sourceItem) { scene.heldStack = null; return; }
  if (scene.heldStack.quantity < sourceItem.quantity) return;

  // Clear any previous quickslot binding for this itemId (an item lives
  // in at most one quickslot).
  for (let i = 0; i < scene.quickSlots.length; i++) {
    if (scene.quickSlots[i] === scene.heldStack.itemId) scene.quickSlots[i] = null;
  }
  // Swap in; displaced item returns to the grid with a fresh auto-slot.
  const displacedId = scene.quickSlots[slotIndex];
  scene.quickSlots[slotIndex] = scene.heldStack.itemId;
  scene.gridOrder.delete(scene.heldStack.itemId);
  if (displacedId !== null) {
    const taken = new Set(scene.gridOrder.values());
    let free = 0;
    while (taken.has(free)) free++;
    scene.gridOrder.set(displacedId, free);
  }
  scene.heldStack = null;
}

function handleGridClick(
  scene: Scene,
  connection: Connection,
  slotIndex: number,
  mods: ClickModifiers,
): void {
  const item = itemInSlot(scene, slotIndex);

  // --- No held stack ---
  if (!scene.heldStack) {
    if (!item) return;
    if (mods.shift && mods.button === 'left') {
      const container = getContainer(scene.overlay);
      if (container) {
        // Container open → quick-transfer whole stack to chest.
        markPendingDecrement(scene, item.itemId, item.quantity);
        connection.send({
          action: ClientAction.Transfer,
          itemId: item.itemId,
          containerId: container.entityId,
          direction: 0,
        });
        return;
      }
      // No container: equip/unequip toggle for equippable items.
      const bp = getBlueprint(item.blueprintId);
      if (bp?.equipSlot) {
        if (item.equippedSlot > 0) {
          connection.send({ action: ClientAction.Unequip, slot: item.equippedSlot });
        } else {
          connection.send({ action: ClientAction.Equip, itemId: item.itemId });
        }
      }
      return;
    }
    if (mods.button === 'left') {
      // Pick up whole stack.
      scene.heldStack = { itemId: item.itemId, blueprintId: item.blueprintId, quantity: item.quantity, source: 'inventory' };
    } else if (mods.button === 'right') {
      // Pick up half (ceiling). Source stack visually retains the remainder
      // — rendered via `item.quantity - heldStack.quantity` in the grid
      // draw path. No server action yet; the split only becomes real when
      // the held is placed somewhere that actually persists (Equip, Drop,
      // Transfer).
      const half = Math.ceil(item.quantity / 2);
      scene.heldStack = { itemId: item.itemId, blueprintId: item.blueprintId, quantity: half, source: 'inventory' };
    }
    return;
  }

  // --- Have held stack ---

  // Held stack came from the container: dropping onto any inventory grid
  // cell means Transfer chest→player with quantity.
  const heldContainer = getContainer(scene.overlay);
  if (scene.heldStack.source === 'container' && heldContainer) {
    markPendingDecrement(scene, scene.heldStack.itemId, scene.heldStack.quantity);
    connection.send({
      action: ClientAction.Transfer,
      itemId: scene.heldStack.itemId,
      containerId: heldContainer.entityId,
      direction: 1,
      quantity: scene.heldStack.quantity,
    });
    scene.heldStack = null;
    return;
  }

  // Empty cell: drop held (or partial held) into this slot (local reorder).
  if (!item) {
    const source = scene.inventory.find(i => i.itemId === scene.heldStack!.itemId);
    if (source) scene.gridOrder.set(source.itemId, slotIndex);
    scene.heldStack = null;
    return;
  }

  // Occupied cell with same item as held: visual return-to-source — the
  // server already stacks by blueprintId so there's nothing to do. Just
  // clear the held ghost.
  if (scene.heldStack.itemId === item.itemId) {
    scene.heldStack = null;
    return;
  }

  // Occupied cell with a different item.
  // Full-stack held (quantity == source.quantity) → swap positions, held
  // becomes the displaced item (Minecraft swap). Partial-held → no-op
  // (Minecraft refuses cross-item partial drops).
  if (mods.button === 'left') {
    const sourceItem = scene.inventory.find(i => i.itemId === scene.heldStack!.itemId);
    if (!sourceItem) return;
    const partial = scene.heldStack.quantity < sourceItem.quantity;
    if (partial) return;
    const sourceSlot = scene.gridOrder.get(sourceItem.itemId);
    scene.gridOrder.set(item.itemId, sourceSlot ?? 0);
    scene.gridOrder.set(sourceItem.itemId, slotIndex);
    scene.heldStack = { itemId: item.itemId, blueprintId: item.blueprintId, quantity: item.quantity, source: 'inventory' };
  }
}

function handleContainerClick(
  scene: Scene,
  connection: Connection,
  slotIndex: number,
  mods: ClickModifiers,
): void {
  const container = getContainer(scene.overlay);
  if (!container) return;
  const containerId = container.entityId;
  const item = container.items[slotIndex];

  // --- No held stack ---
  if (!scene.heldStack) {
    if (!item) return;
    if (mods.shift && mods.button === 'left') {
      // Quick-transfer chest → player.
      markPendingDecrement(scene, item.itemId, item.quantity);
      connection.send({
        action: ClientAction.Transfer,
        itemId: item.itemId,
        containerId,
        direction: 1,
      });
      return;
    }
    if (mods.button === 'left') {
      scene.heldStack = {
        itemId: item.itemId, blueprintId: item.blueprintId, quantity: item.quantity,
        source: 'container',
      };
    } else if (mods.button === 'right') {
      const half = Math.ceil(item.quantity / 2);
      scene.heldStack = {
        itemId: item.itemId, blueprintId: item.blueprintId, quantity: half,
        source: 'container',
      };
    }
    return;
  }

  // --- Held stack ---

  // Held from player inventory → drop on container cell = Transfer
  // player → chest with quantity.
  if (scene.heldStack.source === 'inventory') {
    markPendingDecrement(scene, scene.heldStack.itemId, scene.heldStack.quantity);
    connection.send({
      action: ClientAction.Transfer,
      itemId: scene.heldStack.itemId,
      containerId,
      direction: 0,
      quantity: scene.heldStack.quantity,
    });
    scene.heldStack = null;
    return;
  }

  // Held from container → same-container drop = return to source (visual
  // only; server already has the stack intact).
  scene.heldStack = null;
}

function handleEquipClick(
  scene: Scene,
  connection: Connection,
  slot: EquipSlot,
  mods: ClickModifiers,
): void {
  const inv = toLogicalInventory(scene);
  const occupant = getEquipped(inv, slot);

  if (!scene.heldStack) {
    if (mods.button === 'left' && occupant) {
      connection.send({ action: ClientAction.Unequip, slot: equipSlotToNumber(slot) });
    }
    return;
  }

  const heldItem = scene.inventory.find(i => i.itemId === scene.heldStack!.itemId);
  const heldBp = heldItem ? getBlueprint(heldItem.blueprintId) : undefined;
  if (!heldItem || !heldBp || heldBp.equipSlot !== slot) {
    // Mismatched slot — Phase F will add a red-tint hint; for now no-op.
    return;
  }
  // Partial equip splits the source stack server-side; mark the
  // decrement so the source slot doesn't flicker for a frame.
  if (scene.heldStack.quantity < heldItem.quantity) {
    markPendingDecrement(scene, heldItem.itemId, scene.heldStack.quantity);
  }
  connection.send({
    action: ClientAction.Equip,
    itemId: heldItem.itemId,
    quantity: scene.heldStack.quantity,
  });
  scene.heldStack = null;
}

function toLogicalInventory(scene: Scene) {
  return {
    items: scene.inventory.map(i => ({
      itemId: i.itemId,
      blueprintId: i.blueprintId,
      quantity: i.quantity,
      equippedSlot: numberToEquipSlot(i.equippedSlot),
    })),
    maxWeight: 50,
  };
}
