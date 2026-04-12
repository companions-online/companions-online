// Static tree entity. Unlike deer/player, trees have no direction, no walk
// cycle, and no tick — they just blit a single 64×128 sprite frame at a fixed
// tile each render pass. The render loop already handles `tick` being
// undefined (renderer.ts uses `e.tick?.(…)`), so there is no no-op stub.
//
// spawnTrees returns the set of occupied tiles so the scene can layer it into
// the `isBlocked` callback the creature spawners consume, making pathfinding
// route around trees.

import { tileToScreen } from '@shared/coordinates.js';
import { MAP_SIZE, SPAWN_X, SPAWN_Y } from '@shared/constants.js';
import { TILE_W, TILE_H } from '../platform/config.js';
import type { ClientEntity } from './client-entity.js';
import type { SpriteRegistry, SpriteSheetRef } from './sprite-registry.js';
import { TREE_BLUEPRINT } from './sprite-manifest.js';

// Keep the area right around the player spawn visually open. World-gen
// guarantees a 5-tile-radius grass circle around SPAWN; we use 6 so trees
// also stay just outside that circle.
const SPAWN_CLEAR_RADIUS = 6;

function createTree(
  id: number,
  tileX: number,
  tileY: number,
  sheet: SpriteSheetRef,
): ClientEntity {
  const entity: ClientEntity = {
    id,
    blueprintId: { blueprintId: TREE_BLUEPRINT },
    spriteSheet: sheet,
    walkFrame: 0,
    frameTimer: 0,
    visualX: tileX,
    visualY: tileY,
    screenY: 0,

    // No tick: trees never move. Field left undefined.

    draw(self, sprites, gl, offsetX, offsetY) {
      const s = self.spriteSheet;
      const screen = tileToScreen(self.visualX, self.visualY, TILE_W, TILE_H);
      self.screenY = screen.screenY;

      const dstX = screen.screenX + offsetX + TILE_W / 2 - s.footX;
      const dstY = screen.screenY + offsetY + TILE_H / 2 - s.footY;

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, s.texture);
      // Single-frame sheet: UV rect is the whole texture.
      sprites.drawSprite(dstX, dstY, s.frameW, s.frameH, 0, 0, 1, 1);
    },
  };

  return entity;
}

// Each entry produces a dense rectangular patch of trees (2*radius+1)² tiles.
const FOREST_PATCHES = [
  { radius: 5 },   // 11×11
  { radius: 4 },   //  9×9
  { radius: 4 },   //  9×9
];
// Minimum distance between forest centers so patches don't overlap.
const MIN_FOREST_DIST_SQ = 15 * 15;

/**
 * Place dense rectangular forest patches on walkable tiles using a seeded LCG.
 * Returns the assigned ids and the Set of occupied tile keys (y * MAP_SIZE + x)
 * so the caller can OR them into `isBlocked`.
 *
 * The LCG is the same recipe world-gen uses (shared/src/world/world-gen.ts).
 * We XOR the seed with a constant so tree placement is a different stream
 * from the one world-gen already consumed off the same seed.
 */
export function spawnTrees(
  entities: Map<number, ClientEntity>,
  isBlocked: (x: number, y: number) => boolean,
  registry: SpriteRegistry,
  startId: number,
  seed: number,
): { ids: number[]; occupiedTiles: Set<number> } {
  let rng = (seed ^ 0xA5A5A5A5) >>> 0;
  const rand = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 0x100000000;
  };

  const occupiedTiles = new Set<number>();
  const ids: number[] = [];
  const centers: { x: number; y: number }[] = [];

  for (const patch of FOREST_PATCHES) {
    // Find a valid center for this forest patch.
    let cx = 0, cy = 0, found = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      cx = Math.floor(rand() * MAP_SIZE);
      cy = Math.floor(rand() * MAP_SIZE);

      if (isBlocked(cx, cy)) continue;

      const sdx = cx - SPAWN_X;
      const sdy = cy - SPAWN_Y;
      if (sdx * sdx + sdy * sdy <= SPAWN_CLEAR_RADIUS * SPAWN_CLEAR_RADIUS) continue;

      let tooClose = false;
      for (const c of centers) {
        const ddx = cx - c.x;
        const ddy = cy - c.y;
        if (ddx * ddx + ddy * ddy < MIN_FOREST_DIST_SQ) { tooClose = true; break; }
      }
      if (tooClose) continue;

      found = true;
      break;
    }
    if (!found) continue;
    centers.push({ x: cx, y: cy });

    // Fill the patch rectangle with trees on every eligible tile.
    for (let dy = -patch.radius; dy <= patch.radius; dy++) {
      for (let dx = -patch.radius; dx <= patch.radius; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= MAP_SIZE || y < 0 || y >= MAP_SIZE) continue;
        if (isBlocked(x, y)) continue;

        const sdx = x - SPAWN_X;
        const sdy = y - SPAWN_Y;
        if (sdx * sdx + sdy * sdy <= SPAWN_CLEAR_RADIUS * SPAWN_CLEAR_RADIUS) continue;

        const key = y * MAP_SIZE + x;
        if (occupiedTiles.has(key)) continue;

        const variant = Math.floor(rand() * 3);
        const sheet = registry.resolve(TREE_BLUEPRINT, variant);

        const id = startId + ids.length;
        entities.set(id, createTree(id, x, y, sheet));
        occupiedTiles.add(key);
        ids.push(id);
      }
    }
  }

  return { ids, occupiedTiles };
}
