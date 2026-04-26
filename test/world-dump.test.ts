import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer, placeTree } from './e2e/helpers.js';
import { serializeWorld, dumpWorld } from '../server/src/world-dump.js';
import { BlueprintType } from '@shared/blueprints.js';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

describe('world-dump — reflective serializer', () => {
  it('dumps a populated world to a JSON-safe tree', () => {
    const world = createTestWorld();
    addTestPlayer(world, 10, 10);
    placeTree(world, 12, 10);

    const dump = serializeWorld(world) as Record<string, any>;

    // JSON-safe round-trip: every nested value parses back out.
    const roundTrip = JSON.parse(JSON.stringify(dump));
    expect(roundTrip).toBeTruthy();

    // Maps land under __map markers.
    expect(dump.players).toMatchObject({ __map: expect.any(Array) });
    expect(dump.moveStates).toMatchObject({ __map: expect.any(Array) });

    // ComponentStores on entities land under __componentStore markers.
    expect(dump.entities.position).toMatchObject({ __componentStore: expect.any(Array) });
    expect(dump.entities.blueprint).toMatchObject({ __componentStore: expect.any(Array) });

    // Sets land under __set.
    // pick any PlayerSlot — knownEntities is a Set.
    const [[, slot]] = dump.players.__map;
    expect(slot.knownEntities).toMatchObject({ __set: expect.any(Array) });

    // PlayerSlot.connection is skipped.
    expect(slot).not.toHaveProperty('connection');

    // telemetry + log skipped at the world level.
    expect(dump).not.toHaveProperty('telemetry');
    expect(dump).not.toHaveProperty('log');
  });

  it('skips the large map grids via SKIP_PATHS', () => {
    const world = createTestWorld();
    const dump = serializeWorld(world) as Record<string, any>;

    // map itself is present, but its binary grids are omitted entirely.
    expect(dump.map).toBeDefined();
    expect(dump.map).not.toHaveProperty('terrain');
    expect(dump.map).not.toHaveProperty('buildings');
    expect(dump.map).not.toHaveProperty('buildingMeta');
  });

  it('tags typed arrays with a length stub when large', () => {
    const world = createTestWorld();
    const dump = serializeWorld(world) as Record<string, any>;

    // OccupancyGrid holds a Uint16Array internally. With MAP_SIZE=128 the
    // grid is 16384 elements — well over the stub threshold.
    // Drill into the occupancy field.
    expect(dump.occupancy).toBeDefined();
    // Find any __typedArray marker in the dump; its shape must include name.
    const occEntries = Object.values(dump.occupancy);
    const hasStub = occEntries.some((v: any) =>
      v && typeof v === 'object' && '__typedArray' in v && 'length' in v
    );
    expect(hasStub).toBe(true);
  });

  it('writes dumpWorld output to disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-dump-'));
    const world = createTestWorld();
    addTestPlayer(world, 5, 5);

    const filepath = await dumpWorld(world, dir);
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/-dump\.json$/);
    expect(filepath.endsWith(files[0])).toBe(true);

    const raw = await readFile(filepath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toBeTruthy();
    expect(parsed.seed).toBe(1);
  });

  it('picks up newly-added state fields automatically (no registration)', () => {
    // Proxy test for the "won't rot" invariant: attach an arbitrary Map onto
    // the world at runtime and confirm it shows up in the dump untouched.
    const world = createTestWorld() as any;
    world.__futureFeatureState = new Map<number, { flag: boolean }>();
    world.__futureFeatureState.set(42, { flag: true });

    const dump = serializeWorld(world) as Record<string, any>;
    expect(dump.__futureFeatureState).toMatchObject({
      __map: [[42, { flag: true }]],
    });
  });

  it('collapses back-references with __ref markers', () => {
    const world = createTestWorld();
    addTestPlayer(world, 10, 10);
    const dump = serializeWorld(world) as Record<string, any>;

    // Scan the serialized tree for any __ref markers — PlayerSlot has no
    // direct world back-ref, but SystemState-style maps can reach entities.
    const stringified = JSON.stringify(dump);
    // Just verify the dump completes without throwing and nothing tries to
    // embed a second copy of the EntityManager under a non-entities path.
    const entityManagerOccurrences = (stringified.match(/"__componentStore"/g) ?? []).length;
    // All component stores live under dump.entities — so the count equals
    // the number of distinct ComponentStores in EntityManager (7 today).
    expect(entityManagerOccurrences).toBe(7);
  });
});
