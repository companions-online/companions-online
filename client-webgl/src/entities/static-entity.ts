// Network-driven static entity factory. Covers blueprint categories
// 'placeable', 'item', and 'resource' — trees, doors, ground items, chests,
// campfires, etc. No animation; just a single sprite blit at the tile.
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
      } else {
        drawSingleFrame(self, sprites, gl, offsetX, offsetY, scene);
      }
    },
  };

  return entity;
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
  e.screenW = s.frameW;
  e.screenH = s.frameH;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.texture);
  sprites.drawSprite(dstX, dstY, s.frameW, s.frameH, 0, 0, 1, 1);
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
  const dstY = screen.screenY + offsetY - (s.frameH - TILE_H) - z * PX_PER_Z;

  e.screenX = dstX;
  e.screenY = dstY;
  e.screenW = s.frameW;
  e.screenH = s.frameH;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, s.texture);
  sprites.drawSprite(dstX, dstY, s.frameW, s.frameH, uvX, uvY, uvW, uvH);
}
