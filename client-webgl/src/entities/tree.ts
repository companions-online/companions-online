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

/**
 * Scatter `count` trees across walkable tiles using a seeded LCG, skipping
 * the tile around spawn. Returns the assigned ids and the Set of occupied
 * tile keys (y * MAP_SIZE + x) so the caller can OR them into `isBlocked`.
 *
 * The LCG is the same recipe world-gen uses (shared/src/world/world-gen.ts).
 * We XOR the seed with a constant so tree placement is a different stream
 * from the one world-gen already consumed off the same seed.
 */
export function spawnTrees(
  entities: Map<number, ClientEntity>,
  count: number,
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
  const maxAttempts = count * 20;
  let attempts = 0;

  while (ids.length < count && attempts < maxAttempts) {
    attempts++;
    const x = Math.floor(rand() * MAP_SIZE);
    const y = Math.floor(rand() * MAP_SIZE);

    if (isBlocked(x, y)) continue;

    const dx = x - SPAWN_X;
    const dy = y - SPAWN_Y;
    if (dx * dx + dy * dy <= SPAWN_CLEAR_RADIUS * SPAWN_CLEAR_RADIUS) continue;

    const key = y * MAP_SIZE + x;
    if (occupiedTiles.has(key)) continue;

    const variant = Math.floor(rand() * 3);
    const sheet = registry.resolve(TREE_BLUEPRINT, variant);

    const id = startId + ids.length;
    entities.set(id, createTree(id, x, y, sheet));
    occupiedTiles.add(key);
    ids.push(id);
  }

  return { ids, occupiedTiles };
}
