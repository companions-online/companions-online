// Door entity. Static (no tick), renders one frame from a 2×2 spritesheet
// (cols: closed/open, rows: NE/SW facing). Facing is detected from adjacent
// walls at spawn time. Click toggles StatusEffect.Open and updates the
// pathfinding blocked set.

import { Building } from '@shared/terrain.js';
import { StatusEffect } from '@shared/status-effects.js';
import { BlueprintType } from '@shared/blueprints.js';
import { MAP_SIZE } from '@shared/constants.js';
import { TILE_H } from '../platform/config.js';
import { getTileCorners } from '../terrain/elevation.js';
import type { WorldMap } from '@shared/world/world-map.js';
import type { ClientEntity } from './client-entity.js';
import type { SpriteSheetRef } from './sprite-registry.js';

/** 0 = NE (wall runs along constant tx), 1 = SW (wall runs along constant ty) */
export type DoorFacing = 0 | 1;

export function detectDoorFacing(tx: number, ty: number, worldMap: WorldMap): DoorFacing {
  const wallAbove = worldMap.inBounds(tx, ty - 1) && worldMap.getBuilding(tx, ty - 1) === Building.Wall;
  const wallBelow = worldMap.inBounds(tx, ty + 1) && worldMap.getBuilding(tx, ty + 1) === Building.Wall;
  if (wallAbove || wallBelow) return 0; // NE
  return 1; // SW
}

export function placeDoor(
  id: number,
  tileX: number,
  tileY: number,
  facing: DoorFacing,
  sheet: SpriteSheetRef,
  elevationGrid: Float32Array,
  doorBlockedTiles: Set<number>,
): { entity: ClientEntity; toggle: () => void } {
  const tileKey = tileY * MAP_SIZE + tileX;

  // Starts closed — block pathfinding.
  doorBlockedTiles.add(tileKey);

  // Pre-compute position from elevation grid, same as wall-sprites.ts.
  const corners = getTileCorners(tileX, tileY, elevationGrid, 0, 0);
  const dstX = corners.wx;
  const dstY = corners.ny - (sheet.frameH - TILE_H);

  const entity: ClientEntity = {
    id,
    blueprintId: { blueprintId: BlueprintType.WoodenDoor },
    statusEffects: { effects: 0 },
    spriteSheet: sheet,
    walkFrame: 0,
    frameTimer: 0,
    visualX: tileX,
    visualY: tileY,
    screenY: corners.sy,

    draw(self, sprites, gl, offsetX, offsetY) {
      const s = self.spriteSheet;

      const isOpen = (self.statusEffects!.effects & StatusEffect.Open) ? 1 : 0;
      const uvW = s.frameW / s.sheetW;
      const uvH = s.frameH / s.sheetH;
      const uvX = isOpen * uvW;
      const uvY = facing * uvH;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, s.texture);
      sprites.drawSprite(dstX + offsetX, dstY + offsetY, s.frameW, s.frameH, uvX, uvY, uvW, uvH);
    },
  };

  function toggle() {
    const effects = entity.statusEffects!.effects;
    entity.statusEffects = { effects: effects ^ StatusEffect.Open };
    if (entity.statusEffects.effects & StatusEffect.Open) {
      doorBlockedTiles.delete(tileKey);
    } else {
      doorBlockedTiles.add(tileKey);
    }
  }

  return { entity, toggle };
}
