import { describe, it, expect } from 'vitest';
import { WorldMap } from '@shared/world/world-map.js';
import { Terrain } from '@shared/terrain.js';
import {
  gatherInfluences,
  pickAdjacentMaskId,
  pickDiagonalMaskIds,
  edgeMaskVariant,
  TERRAIN_PRIORITY,
} from '../client-web/src/terrain-blend.js';
import { BlendMode } from '../client-web/src/blend-masks.js';

function fillMap(size: number, terrain: Terrain): WorldMap {
  const m = new WorldMap(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      m.setTerrain(x, y, terrain);
    }
  }
  return m;
}

describe('pickAdjacentMaskId', () => {
  it('returns the single-edge base id for each of the 4 adjacents', () => {
    expect(pickAdjacentMaskId(0b00001000)).toBe(0);  // SE → lower-right
    expect(pickAdjacentMaskId(0b00000010)).toBe(4);  // NE → upper-right
    expect(pickAdjacentMaskId(0b00100000)).toBe(8);  // SW → lower-left
    expect(pickAdjacentMaskId(0b10000000)).toBe(12); // NW → upper-left
  });

  it('returns 20 for NE + SW (opposite diagonals)', () => {
    expect(pickAdjacentMaskId(0b00100010)).toBe(20);
  });

  it('returns 21 for SE + NW (opposite diagonals)', () => {
    expect(pickAdjacentMaskId(0b10001000)).toBe(21);
  });

  it('returns 30 when all four adjacents are set', () => {
    expect(pickAdjacentMaskId(0b10101010)).toBe(30);
  });

  it('ignores diagonal (bits 0,2,4,6) when picking the adjacent mask', () => {
    // Bit 3 (SE) is the only adjacent — the extra diagonal bits must not perturb the result.
    expect(pickAdjacentMaskId(0b00001000 | 0b01010101)).toBe(0);
  });

  it('returns undefined when no adjacent bits set', () => {
    expect(pickAdjacentMaskId(0)).toBeUndefined();
    expect(pickAdjacentMaskId(0b01010101)).toBeUndefined(); // only diagonals
  });
});

describe('pickDiagonalMaskIds', () => {
  it('maps each diagonal bit to its point mask id', () => {
    expect(pickDiagonalMaskIds(0b00000100)).toEqual([16]); // E
    expect(pickDiagonalMaskIds(0b00010000)).toEqual([17]); // S
    expect(pickDiagonalMaskIds(0b00000001)).toEqual([18]); // N
    expect(pickDiagonalMaskIds(0b01000000)).toEqual([19]); // W
  });

  it('returns all four point masks when every diagonal bit is set', () => {
    expect(pickDiagonalMaskIds(0b01010101)).toEqual([16, 17, 18, 19]);
  });

  it('ignores adjacent bits', () => {
    expect(pickDiagonalMaskIds(0b10101010)).toEqual([]);
  });

  it('empty bits returns empty', () => {
    expect(pickDiagonalMaskIds(0)).toEqual([]);
  });
});

describe('gatherInfluences', () => {
  it('returns nothing when all neighbors are the same terrain', () => {
    const m = fillMap(5, Terrain.Grass);
    expect(gatherInfluences(2, 2, m)).toEqual([]);
  });

  it('ignores lower- or equal-priority neighbors', () => {
    // Center Dirt (prio 20), surrounded by Grass (prio 10) — grass cannot
    // bleed onto higher-priority dirt.
    const m = fillMap(5, Terrain.Grass);
    m.setTerrain(2, 2, Terrain.Dirt);
    expect(gatherInfluences(2, 2, m)).toEqual([]);
  });

  it('records a single iso-adjacent (SE) neighbor', () => {
    // Grass center, Water at SE screen direction = tile offset (1, 0).
    const m = fillMap(5, Terrain.Grass);
    m.setTerrain(3, 2, Terrain.Water);
    const infs = gatherInfluences(2, 2, m);
    expect(infs).toHaveLength(1);
    expect(infs[0].terrainId).toBe(Terrain.Water);
    expect(infs[0].bits).toBe(1 << 3); // SE bit
    expect(infs[0].priority).toBe(TERRAIN_PRIORITY[Terrain.Water]);
    expect(infs[0].blendMode).toBe(BlendMode.Short);
  });

  it('sorts multiple influences ascending by priority', () => {
    // Grass center; SE = Dirt (20), NE = Water (60).
    const m = fillMap(5, Terrain.Grass);
    m.setTerrain(3, 2, Terrain.Dirt);  // SE
    m.setTerrain(2, 1, Terrain.Water); // NE
    const infs = gatherInfluences(2, 2, m);
    expect(infs.map((i) => i.terrainId)).toEqual([Terrain.Dirt, Terrain.Water]);
  });

  it('full iso-adjacent surround collapses to mask 30', () => {
    const m = fillMap(5, Terrain.Grass);
    m.setTerrain(3, 2, Terrain.Water); // SE
    m.setTerrain(2, 1, Terrain.Water); // NE
    m.setTerrain(2, 3, Terrain.Water); // SW
    m.setTerrain(1, 2, Terrain.Water); // NW
    const infs = gatherInfluences(2, 2, m);
    expect(infs).toHaveLength(1);
    expect(infs[0].bits & 0b10101010).toBe(0b10101010);
    expect(pickAdjacentMaskId(infs[0].bits)).toBe(30);
  });

  it('pure iso-diagonal (N screen) neighbor produces a point mask', () => {
    // N screen direction is tile offset (-1, -1).
    const m = fillMap(5, Terrain.Grass);
    m.setTerrain(1, 1, Terrain.Water);
    const infs = gatherInfluences(2, 2, m);
    expect(infs).toHaveLength(1);
    expect(infs[0].bits).toBe(1 << 0);
    expect(pickAdjacentMaskId(infs[0].bits)).toBeUndefined();
    expect(pickDiagonalMaskIds(infs[0].bits)).toEqual([18]);
  });

  it('suppresses a diagonal when an iso-adjacent of the same terrain already contributes', () => {
    // NE (bit 1) of water AND N (bit 0) of water. Since N is a diagonal whose
    // adjacent neighbors are NE (bit 1) and NW (bit 7), and NE is already
    // water, the N bit must be suppressed.
    const m = fillMap(5, Terrain.Grass);
    m.setTerrain(2, 1, Terrain.Water); // NE
    m.setTerrain(1, 1, Terrain.Water); // N
    const infs = gatherInfluences(2, 2, m);
    expect(infs).toHaveLength(1);
    expect(infs[0].bits & (1 << 0)).toBe(0);         // N suppressed
    expect(infs[0].bits & (1 << 1)).toBe(1 << 1);    // NE kept
  });

  it('does not suppress across different terrains', () => {
    // NE = Water, N = Rock. Different terrain groups → no suppression.
    const m = fillMap(5, Terrain.Grass);
    m.setTerrain(2, 1, Terrain.Water); // NE
    m.setTerrain(1, 1, Terrain.Rock);  // N
    const infs = gatherInfluences(2, 2, m);
    const water = infs.find((i) => i.terrainId === Terrain.Water)!;
    const rock = infs.find((i) => i.terrainId === Terrain.Rock)!;
    expect(water.bits).toBe(1 << 1); // NE bit
    expect(rock.bits).toBe(1 << 0);  // N bit
  });

  it('treats out-of-bounds neighbors as no-influence', () => {
    // Tile at (0, 0) — half of its neighbors are off-map. The remaining
    // in-bounds neighbors (SE, S, SW, E) can still contribute normally.
    const m = fillMap(5, Terrain.Grass);
    m.setTerrain(1, 0, Terrain.Water); // SE
    const infs = gatherInfluences(0, 0, m);
    expect(infs).toHaveLength(1);
    expect(infs[0].bits).toBe(1 << 3);
  });
});

describe('edgeMaskVariant', () => {
  it('returns a value in [0, 3]', () => {
    for (let y = -5; y < 20; y++) {
      for (let x = -5; x < 20; x++) {
        const v = edgeMaskVariant(x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(4);
      }
    }
  });

  it('is deterministic', () => {
    expect(edgeMaskVariant(3, 7)).toBe(edgeMaskVariant(3, 7));
  });
});
