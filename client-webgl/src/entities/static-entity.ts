// Network-driven static entity factory. Covers blueprint categories
// 'placeable', 'item', and 'resource' — trees, doors, ground items, chests,
// campfires, etc.
//
// Three draw paths, picked at construction:
//   - Door (BlueprintType.WoodenDoor): own 2×2 sheet, facing detected from
//     worldMap, open/closed picks the column.
//   - Animated (sheet.animation present): looping cols×rows sheet. The
//     entity's tick advances `walkFrame` and the draw slices UVs by col/row.
//     Used for placeables like the campfire.
//   - Single-frame (default): one blit, full-sheet UV.
//
// Doors: facing is detected at draw time from adjacent building tiles in
// the worldMap (NE if a wall sits above or below, SW otherwise). The
// statusEffects.Open bit picks the frame column in the 2×2 sheet.

import { BlueprintType } from '@shared/blueprints.js';
import { Building } from '@shared/terrain.js';
import { StatusEffect } from '@shared/status-effects.js';
import { tileToScreen } from '@shared/coordinates.js';
import { TILE_W, TILE_H, PX_PER_Z } from '../platform/config.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { EntityComponents } from '@shared/protocol/codec.js';
import type { ClientEntity } from './client-entity.js';
import type { SpriteRenderer } from './sprite-renderer.js';
import type { SpriteSheetRef } from './sprite-registry.js';
import type { Scene } from '../scene.js';

export function createStaticEntity(
  id: number,
  components: EntityComponents,
  sheet: SpriteSheetRef,
  worldMap: WorldMap,
): ClientEntity {
  const pos = components.position;
  const entity: ClientEntity = {
    id,
    blueprint: components.blueprint,
    position: pos,
    statusEffects: components.statusEffects,
    spriteSheet: sheet,
    walkFrame: 0,
    frameTimer: 0,
    visualX: pos?.tileX ?? 0,
    visualY: pos?.tileY ?? 0,
    screenX: 0,
    screenY: 0,
    screenW: 0,
    screenH: 0,

    draw(self, sprites, gl, offsetX, offsetY, scene) {
      if (self.blueprint?.blueprintId === BlueprintType.WoodenDoor) {
        drawDoor(self, sprites, gl, offsetX, offsetY, worldMap, scene);
      } else if (self.spriteSheet.animation) {
        drawAnimatedStatic(self, sprites, gl, offsetX, offsetY, scene);
      } else {
        drawSingleFrame(self, sprites, gl, offsetX, offsetY, scene);
      }
    },
  };

  if (sheet.animation) {
    entity.tick = tickAnimatedStatic;
  }

  return entity;
}

/** Tick for entities whose sheet has an animation block. Advances
 *  `walkFrame` modulo `frameCount`. `dt` is in seconds. */
function tickAnimatedStatic(self: ClientEntity, dt: number): void {
  const a = self.spriteSheet.animation;
  if (!a) return;
  self.frameTimer += dt * 1000;
  while (self.frameTimer >= a.frameMs) {
    self.frameTimer -= a.frameMs;
    self.walkFrame = (self.walkFrame + 1) % a.frameCount;
  }
}

function drawSingleFrame(
  e: ClientEntity,
  sprites: SpriteRenderer,
  gl: WebGL2RenderingContext,
  offsetX: number,
  offsetY: number,
  scene: Scene,
): void {
  const s = e.spriteSheet;
  const screen = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
  const z = scene.getGroundZ(e.visualX, e.visualY);

  const anchorY = s.align === 'south' ? TILE_H : TILE_H / 2;
  const dstX = screen.screenX + offsetX + TILE_W / 2 - s.footX;
  const dstY = screen.screenY + offsetY + anchorY - s.footY - z * PX_PER_Z;

  e.screenX = dstX;
  e.screenY = dstY;
  e.screenW = s.renderW;
  e.screenH = s.renderH;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.texture);
  sprites.setSpriteTile(e.visualX, e.visualY);
  sprites.drawSprite(dstX, dstY, s.renderW, s.renderH, 0, 0, 1, 1);
}

/** Same anchor math as drawSingleFrame, but slices UVs by the entity's
 *  current frame index. Frame layout is left-to-right, top-to-bottom. */
function drawAnimatedStatic(
  e: ClientEntity,
  sprites: SpriteRenderer,
  gl: WebGL2RenderingContext,
  offsetX: number,
  offsetY: number,
  scene: Scene,
): void {
  const s = e.spriteSheet;
  const a = s.animation;
  if (!a) {
    drawSingleFrame(e, sprites, gl, offsetX, offsetY, scene);
    return;
  }
  const screen = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
  const z = scene.getGroundZ(e.visualX, e.visualY);

  const anchorY = s.align === 'south' ? TILE_H : TILE_H / 2;
  const dstX = screen.screenX + offsetX + TILE_W / 2 - s.footX;
  const dstY = screen.screenY + offsetY + anchorY - s.footY - z * PX_PER_Z;

  e.screenX = dstX;
  e.screenY = dstY;
  e.screenW = s.renderW;
  e.screenH = s.renderH;

  const col = e.walkFrame % a.cols;
  const row = Math.floor(e.walkFrame / a.cols);
  const uvW = s.frameW / s.sheetW;
  const uvH = s.frameH / s.sheetH;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.texture);
  sprites.setSpriteTile(e.visualX, e.visualY);
  sprites.drawSprite(dstX, dstY, s.renderW, s.renderH, col * uvW, row * uvH, uvW, uvH);
}

/** Facing row in the 2×2 door sheet: 0 = NE (wall runs horizontally),
 *  1 = SW (wall runs vertically). */
function doorFacing(worldMap: WorldMap, tx: number, ty: number): 0 | 1 {
  const wallAbove = worldMap.inBounds(tx, ty - 1) && worldMap.getBuilding(tx, ty - 1) === Building.Wall;
  const wallBelow = worldMap.inBounds(tx, ty + 1) && worldMap.getBuilding(tx, ty + 1) === Building.Wall;
  return (wallAbove || wallBelow) ? 0 : 1;
}

function drawDoor(
  e: ClientEntity,
  sprites: SpriteRenderer,
  gl: WebGL2RenderingContext,
  offsetX: number,
  offsetY: number,
  worldMap: WorldMap,
  scene: Scene,
): void {
  const s = e.spriteSheet;
  const screen = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
  const z = scene.getGroundZ(e.visualX, e.visualY);

  const tx = e.position?.tileX ?? Math.round(e.visualX);
  const ty = e.position?.tileY ?? Math.round(e.visualY);
  const facing = doorFacing(worldMap, tx, ty);
  const isOpen = e.statusEffects && (e.statusEffects.effects & StatusEffect.Open) ? 1 : 0;
  const uvW = s.frameW / s.sheetW;
  const uvH = s.frameH / s.sheetH;
  const uvX = isOpen * uvW;
  const uvY = facing * uvH;

  // Anchor the door so its bottom sits at the tile's south vertex (wall line),
  // not tile center. The door now honors sampled ground elevation; Pass 3's
  // flatten under buildings keeps interior doors visually level but is no
  // longer load-bearing for correctness.
  const dstX = screen.screenX + offsetX;
  const dstY = screen.screenY + offsetY - (s.renderH - TILE_H) - z * PX_PER_Z;

  e.screenX = dstX;
  e.screenY = dstY;
  e.screenW = s.renderW;
  e.screenH = s.renderH;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.texture);
  sprites.setSpriteTile(tx, ty);
  sprites.drawSprite(dstX, dstY, s.renderW, s.renderH, uvX, uvY, uvW, uvH);
}
