import { describe, it, expect } from 'vitest';
import { WorldMap } from '../shared/src/world/world-map.js';
import { generateWorld } from '../shared/src/world/world-gen.js';
import { PerlinNoise } from '../shared/src/world/noise.js';
import { Terrain, Building } from '@shared/terrain.js';
import { BlueprintType } from '@shared/blueprints.js';
import { MAP_SIZE, CHUNK_SIZE, SPAWN_X, SPAWN_Y } from '@shared/constants.js';
import { tileChar, terrainChar, buildingChar, blueprintChar } from '@shared/ascii.js';
import { rleEncode, rleDecode, BufferReader } from '@shared/protocol/codec.js';

describe('PerlinNoise', () => {
  it('same seed produces same values', () => {
    const a = new PerlinNoise(123);
    const b = new PerlinNoise(123);
    expect(a.noise2d(1.5, 2.5)).toBe(b.noise2d(1.5, 2.5));
    expect(a.octave2d(3.0, 4.0, 4, 0.5)).toBe(b.octave2d(3.0, 4.0, 4, 0.5));
  });

  it('different seeds produce different values', () => {
    const a = new PerlinNoise(1);
    const b = new PerlinNoise(2);
    // Use non-integer coords (Perlin returns 0 at integer grid points)
    expect(a.noise2d(5.7, 3.2)).not.toBe(b.noise2d(5.7, 3.2));
  });

  it('returns values in roughly -1..1 range', () => {
    const n = new PerlinNoise(42);
    for (let i = 0; i < 100; i++) {
      const v = n.noise2d(i * 0.1, i * 0.17);
      expect(v).toBeGreaterThanOrEqual(-1.5);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('WorldMap', () => {
  it('get/set terrain round-trips', () => {
    const m = new WorldMap(32, 32);
    m.setTerrain(5, 10, Terrain.Water);
    expect(m.getTerrain(5, 10)).toBe(Terrain.Water);
    expect(m.getTerrain(0, 0)).toBe(Terrain.Grass); // default 0
  });

  it('get/set building round-trips', () => {
    const m = new WorldMap(32, 32);
    m.setBuilding(3, 7, Building.Wall);
    expect(m.getBuilding(3, 7)).toBe(Building.Wall);
  });

  it('isWalkable delegates correctly', () => {
    const m = new WorldMap(32, 32);
    m.setTerrain(0, 0, Terrain.Grass);
    expect(m.isWalkable(0, 0)).toBe(true);

    m.setTerrain(1, 1, Terrain.Water);
    expect(m.isWalkable(1, 1)).toBe(false);

    m.setTerrain(2, 2, Terrain.Grass);
    m.setBuilding(2, 2, Building.Wall);
    expect(m.isWalkable(2, 2)).toBe(false);
  });

  it('out of bounds is not walkable', () => {
    const m = new WorldMap(16, 16);
    expect(m.isWalkable(-1, 0)).toBe(false);
    expect(m.isWalkable(16, 0)).toBe(false);
  });

  it('chunk extraction matches flat array', () => {
    const m = new WorldMap(32, 32);
    // Set a specific tile in chunk (1, 0)
    m.setTerrain(CHUNK_SIZE + 3, 5, Terrain.Sand);

    const chunk = m.getChunkTerrain(1, 0);
    expect(chunk.length).toBe(CHUNK_SIZE * CHUNK_SIZE);
    expect(chunk[5 * CHUNK_SIZE + 3]).toBe(Terrain.Sand);
    expect(chunk[0]).toBe(Terrain.Grass);
  });
});

describe('generateWorld', () => {
  it('same seed produces identical results', () => {
    const a = generateWorld(99);
    const b = generateWorld(99);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.entitySpawns.length).toBe(b.entitySpawns.length);
  });

  it('has water or sand at map edges', () => {
    const { map } = generateWorld(42);
    const edgeTerrain = [Terrain.Water, Terrain.Sand];
    expect(edgeTerrain).toContain(map.getTerrain(0, 0));
    expect(edgeTerrain).toContain(map.getTerrain(MAP_SIZE - 1, 0));
    expect(edgeTerrain).toContain(map.getTerrain(0, MAP_SIZE - 1));
    expect(edgeTerrain).toContain(map.getTerrain(MAP_SIZE - 1, MAP_SIZE - 1));
  });

  it('spawn point is walkable', () => {
    const { map } = generateWorld(42);
    expect(map.isWalkable(SPAWN_X, SPAWN_Y)).toBe(true);
  });

  it('spawns trees, and trees are only on grass', () => {
    const { map, entitySpawns } = generateWorld(42);
    const trees = entitySpawns.filter(s => s.blueprint === BlueprintType.Tree);
    expect(trees.length).toBeGreaterThan(0);
    for (const t of trees) {
      expect(map.getTerrain(t.x, t.y)).toBe(Terrain.Grass);
    }
  });

  it('no trees within spawn clear zone', () => {
    const { entitySpawns } = generateWorld(42);
    const trees = entitySpawns.filter(s => s.blueprint === BlueprintType.Tree);
    for (const t of trees) {
      const dx = t.x - SPAWN_X;
      const dy = t.y - SPAWN_Y;
      expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(25);
    }
  });

  it('tree spacing: no two trees are cardinal neighbors', () => {
    const { entitySpawns } = generateWorld(42);
    const treeSet = new Set<number>();
    const trees = entitySpawns.filter(s => s.blueprint === BlueprintType.Tree);
    for (const t of trees) {
      treeSet.add(t.y * MAP_SIZE + t.x);
    }
    for (const t of trees) {
      const k = t.y * MAP_SIZE + t.x;
      expect(treeSet.has(k - 1) || treeSet.has(k + 1) ||
             treeSet.has(k - MAP_SIZE) || treeSet.has(k + MAP_SIZE)).toBe(false);
    }
  });
});

describe('ASCII mapping', () => {
  it('terrainChar returns expected characters', () => {
    expect(terrainChar(Terrain.Grass)).toBe('.');
    expect(terrainChar(Terrain.Water)).toBe('~');
    expect(terrainChar(Terrain.Rock)).toBe('^');
    expect(terrainChar(Terrain.Sand)).toBe(':');
  });

  it('buildingChar returns empty for None', () => {
    expect(buildingChar(Building.None)).toBe('');
    expect(buildingChar(Building.Wall)).toBe('#');
  });

  it('blueprintChar maps all types', () => {
    expect(blueprintChar(BlueprintType.Player)).toBe('@');
    expect(blueprintChar(BlueprintType.Tree)).toBe('T');
    expect(blueprintChar(BlueprintType.Wolf)).toBe('w');
  });

  it('tileChar covering: entity > building > ground', () => {
    // Ground only
    expect(tileChar(Terrain.Grass, Building.None)).toBe('.');
    // Building covers ground
    expect(tileChar(Terrain.Grass, Building.Wall)).toBe('#');
    // Entity covers everything
    expect(tileChar(Terrain.Grass, Building.Wall, BlueprintType.Player)).toBe('@');
  });
});

describe('Chunk RLE round-trip with generated data', () => {
  it('generated chunk survives RLE encode/decode', () => {
    const { map } = generateWorld(42);
    const terrain = map.getChunkTerrain(4, 4); // center chunk
    const encoded = rleEncode(terrain);
    const r = new BufferReader(encoded.buffer);
    const decoded = rleDecode(r);
    expect(decoded).toEqual(terrain);
  });
});
