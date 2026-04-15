import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { CHUNK_SIZE, MAP_SIZE, SPAWN_X, SPAWN_Y } from '@shared/constants.js';
import { ActionType, ClientAction } from '@shared/actions.js';
import { Terrain } from '@shared/terrain.js';
import { createTestScene } from './harness.js';

describe('scene network wiring', () => {
  it('welcome sets myEntityId and seed', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'welcome', entityId: 42, seed: 1337 });
    expect(scene.myEntityId).toBe(42);
    expect(scene.seed).toBe(1337);
  });

  it('chunk writes terrain + buildings into worldMap', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'welcome', entityId: 1, seed: 1 });

    const terrain = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(Terrain.Grass);
    const buildings = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const buildingMeta = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    terrain[0] = Terrain.Water;
    buildings[CHUNK_SIZE + 1] = 1; // Wall at local (1, 1)

    conn.deliver({
      type: 'chunk',
      data: { chunkX: 3, chunkY: 4, terrain, buildings, buildingMeta },
    });

    const originX = 3 * CHUNK_SIZE;
    const originY = 4 * CHUNK_SIZE;
    expect(scene.worldMap.getTerrain(originX, originY)).toBe(Terrain.Water);
    expect(scene.worldMap.getBuilding(originX + 1, originY + 1)).toBe(1);
  });

  it('entityFullState creates a creature entity from shared blueprint', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 7,
        components: {
          position: { tileX: 10, tileY: 12 },
          blueprint: { blueprintId: BlueprintType.Deer, variant: 0 },
        },
      },
    });
    const e = scene.entities.get(7);
    expect(e).toBeDefined();
    expect(e!.position).toEqual({ tileX: 10, tileY: 12 });
    expect(e!.blueprint).toEqual({ blueprintId: BlueprintType.Deer, variant: 0 });
    // Creature factory installs a tick + draw.
    expect(typeof e!.tick).toBe('function');
    expect(typeof e!.draw).toBe('function');
  });

  it('worldDelta merges component fields without clobbering absent ones', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 7,
        components: {
          position: { tileX: 5, tileY: 5 },
          blueprint: { blueprintId: BlueprintType.Deer, variant: 0 },
          currentAction: { actionType: ActionType.Idle },
        },
      },
    });
    conn.deliver({
      type: 'worldDelta',
      data: {
        tick: 1,
        entityUpdates: [{
          entityId: 7,
          components: { position: { tileX: 6, tileY: 5 } }, // only position
        }],
        entityRemovals: [],
        tileUpdates: [],
      },
    });
    const e = scene.entities.get(7)!;
    expect(e.position).toEqual({ tileX: 6, tileY: 5 });
    // Absent fields survive.
    expect(e.blueprint?.blueprintId).toBe(BlueprintType.Deer);
    expect(e.currentAction?.actionType).toBe(ActionType.Idle);
  });

  it('entity removal drops the entry', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 99,
        components: {
          position: { tileX: 0, tileY: 0 },
          blueprint: { blueprintId: BlueprintType.Tree, variant: 0 },
        },
      },
    });
    expect(scene.entities.has(99)).toBe(true);
    conn.deliver({
      type: 'worldDelta',
      data: { tick: 2, entityUpdates: [], entityRemovals: [99], tileUpdates: [] },
    });
    expect(scene.entities.has(99)).toBe(false);
  });
});

describe('scene chunk capacity + eviction', () => {
  it('rebuilds dirty chunks without exceeding CHUNK_CAPACITY', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'welcome', entityId: 1, seed: 7 });
    // Place the player at spawn so eviction uses a valid reference point.
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 1,
        components: {
          position: { tileX: SPAWN_X, tileY: SPAWN_Y },
          blueprint: { blueprintId: BlueprintType.Player, variant: 0 },
        },
      },
    });

    // Stream chunks in a 5×5 square around the player-chunk.
    const pcx = Math.floor(SPAWN_X / CHUNK_SIZE);
    const pcy = Math.floor(SPAWN_Y / CHUNK_SIZE);
    const terrain = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(Terrain.Grass);
    const buildings = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const buildingMeta = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        conn.deliver({
          type: 'chunk',
          data: { chunkX: pcx + dx, chunkY: pcy + dy, terrain, buildings, buildingMeta },
        });
      }
    }
    // Drain: should upload without throwing the capacity-exceeded error.
    scene.processDirtyChunks();
    // Wall set has one entry per built chunk (ignoring the seam-only
    // neighbor chunks that are outside the interest radius).
    expect(scene.wallDrawablesByChunk.size).toBeGreaterThan(0);
  });
});

describe('controls → outbound actions (harness check)', () => {
  it('send() captures outbound actions on the fake connection', async () => {
    const { conn } = await createTestScene();
    conn.send({ action: ClientAction.MoveTo, tileX: 10, tileY: 10 });
    conn.send({ action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    expect(conn.sent).toHaveLength(2);
    expect(conn.sent[0]).toEqual({ action: ClientAction.MoveTo, tileX: 10, tileY: 10 });
  });
});

// Suppress unused-import warning — MAP_SIZE is re-exported for future tests.
void MAP_SIZE;
