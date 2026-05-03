import { describe, it, expect } from 'vitest';
import { CHUNK_SIZE } from '@shared/constants.js';
import { Terrain } from '@shared/terrain.js';
import { createTestScene } from './harness.js';

describe('scene observer mode', () => {
  it('onWelcome with entityId=0 leaves myEntityId null and stores seed', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'welcome', entityId: 0, seed: 1337 });
    expect(scene.myEntityId).toBeNull();
    expect(scene.seed).toBe(1337);
  });

  it('setObserverFocus updates the focus tile', async () => {
    const { scene } = await createTestScene();
    expect(scene.observerFocus).toBeNull();
    scene.setObserverFocus(50, 50);
    expect(scene.observerFocus).toEqual({ tileX: 50, tileY: 50 });
    scene.setObserverFocus(120, 30);
    expect(scene.observerFocus).toEqual({ tileX: 120, tileY: 30 });
  });

  it('processDirtyChunks rebuilds chunks within INTEREST of observerFocus when no player', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'welcome', entityId: 0, seed: 1 });
    scene.setObserverFocus(50, 50);

    const chunkX = Math.floor(50 / CHUNK_SIZE);
    const chunkY = Math.floor(50 / CHUNK_SIZE);
    const terrain = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(Terrain.Grass);
    const buildings = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const buildingMeta = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    conn.deliver({
      type: 'chunk',
      data: { chunkX, chunkY, terrain, buildings, buildingMeta },
    });

    // No throw; the rebuild path runs against observerFocus (myEntityId is
    // null). Eviction won't drop this chunk because it's right at the focus.
    expect(() => scene.processDirtyChunks()).not.toThrow();
  });
});
