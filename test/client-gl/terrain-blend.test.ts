import { describe, it, expect } from 'vitest';
import { Terrain } from '@shared/terrain.js';
import { gatherInfluences, type TerrainGrid } from '@client-webgl/terrain/terrain-blend.js';

function grid(w: number, h: number, cells: Terrain[]): TerrainGrid {
  return {
    getTerrain: (x, y) => cells[y * w + x],
    inBounds: (x, y) => x >= 0 && x < w && y >= 0 && y < h,
  };
}

describe('gatherInfluences', () => {
  it('floor neighbor does not overlay onto grass (sharp floor edge)', () => {
    // 3×3 grid: grass everywhere except the center which is WoodenFloor.
    const g = grid(3, 3, [
      Terrain.Grass, Terrain.Grass,      Terrain.Grass,
      Terrain.Grass, Terrain.WoodenFloor, Terrain.Grass,
      Terrain.Grass, Terrain.Grass,      Terrain.Grass,
    ]);
    // Gather influences for an adjacent grass tile (top-left). Without the
    // no-overlay flag, the WoodenFloor center would contribute as a
    // higher-priority neighbor. With the flag it must not appear.
    const influences = gatherInfluences(0, 0, g);
    expect(influences.find(i => i.terrainId === Terrain.WoodenFloor)).toBeUndefined();
  });

  it('stone floor neighbor also skipped (hard edge)', () => {
    const g = grid(3, 3, [
      Terrain.Grass, Terrain.Grass,     Terrain.Grass,
      Terrain.Grass, Terrain.StoneFloor, Terrain.Grass,
      Terrain.Grass, Terrain.Grass,     Terrain.Grass,
    ]);
    const influences = gatherInfluences(1, 0, g);
    expect(influences.find(i => i.terrainId === Terrain.StoneFloor)).toBeUndefined();
  });

  it('non-floor higher-priority neighbors still overlay normally', () => {
    // Rock (priority 40) next to Grass (priority 10) — rock should still
    // contribute so natural terrain transitions remain soft.
    const g = grid(3, 3, [
      Terrain.Grass, Terrain.Rock,  Terrain.Grass,
      Terrain.Grass, Terrain.Grass, Terrain.Grass,
      Terrain.Grass, Terrain.Grass, Terrain.Grass,
    ]);
    const influences = gatherInfluences(0, 0, g);
    expect(influences.find(i => i.terrainId === Terrain.Rock)).toBeDefined();
  });
});
