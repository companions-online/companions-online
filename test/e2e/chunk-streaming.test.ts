import { describe, it, expect } from 'vitest';
import {
  CHUNK_SIZE,
  CLIENT_EVICT_RADIUS_CHUNKS,
  MAP_SIZE,
  SERVER_NEEDED_RADIUS_CHUNKS,
} from '../../shared/src/constants.js';
import { HeadlessConnection } from '../../server/src/connections/headless-connection.js';
import type { GameWorldView } from '../../server/src/player-connection.js';
import { createTestWorld, expectCleanLog } from './helpers.js';

class RecordingConnection extends HeadlessConnection {
  readonly streamedChunks: { x: number; y: number }[] = [];
  onChunkNeeded(chunkX: number, chunkY: number, _world: GameWorldView): void {
    this.streamedChunks.push({ x: chunkX, y: chunkY });
  }
}

const chunkOf = (tile: number) => Math.floor(tile / CHUNK_SIZE);
// Mirrors the server's private chunkKey (cy * chunksPerSide + cx).
const chunksPerSide = MAP_SIZE / CHUNK_SIZE;
const keyOf = (cx: number, cy: number) => cy * chunksPerSide + cx;

describe('Server chunk streaming', () => {
  it('radius invariant: client evicts strictly later than the server forgets', () => {
    expect(CLIENT_EVICT_RADIUS_CHUNKS).toBeGreaterThan(SERVER_NEEDED_RADIUS_CHUNKS);
  });

  it('re-streams a chunk after the player walks out of and back into range', () => {
    const world = createTestWorld();
    const conn = new RecordingConnection();
    const eid = world.addPlayer(conn);
    const slot = world.players.get(eid)!;

    // Settle player at a known location.
    const homeX = 50;
    const homeY = 50;
    const homeCx = chunkOf(homeX);
    const homeCy = chunkOf(homeY);
    const homeKey = keyOf(homeCx, homeCy);

    world.entities.position.set(eid, { tileX: homeX, tileY: homeY });
    world.runTick(); // streamToTarget runs; sentChunks now reflects home.
    expect(slot.sentChunks.has(homeKey)).toBe(true);

    // Walk far enough that the home chunk falls outside the server's needed
    // radius (Chebyshev > SERVER_NEEDED_RADIUS_CHUNKS in chunk units).
    const farX = homeX + (SERVER_NEEDED_RADIUS_CHUNKS + 2) * CHUNK_SIZE;
    world.entities.position.set(eid, { tileX: farX, tileY: homeY });
    world.runTick();
    expect(slot.sentChunks.has(homeKey)).toBe(false);

    // Walk back. streamToTarget should re-issue onChunkNeeded for the home
    // chunk because it was pruned from sentChunks while we were away.
    const restreamMark = conn.streamedChunks.length;
    world.entities.position.set(eid, { tileX: homeX, tileY: homeY });
    world.runTick();

    const restreamed = conn.streamedChunks
      .slice(restreamMark)
      .find(c => c.x === homeCx && c.y === homeCy);
    expect(restreamed, 'home chunk should be re-streamed on re-entry').toBeDefined();
    expect(slot.sentChunks.has(homeKey)).toBe(true);

    expectCleanLog(world);
  });

  it('does not re-stream chunks while the player stays put', () => {
    const world = createTestWorld();
    const conn = new RecordingConnection();
    const eid = world.addPlayer(conn);

    world.entities.position.set(eid, { tileX: 50, tileY: 50 });
    world.runTick(); // settle

    const stableCount = conn.streamedChunks.length;
    for (let i = 0; i < 3; i++) world.runTick();
    expect(conn.streamedChunks.length).toBe(stableCount);

    expectCleanLog(world);
  });
});
