import { describe, it, expect } from 'vitest';
import { CHUNK_SIZE } from '@shared/constants.js';
import { WorldMap } from '@shared/world/world-map.js';
import { Terrain, Building } from '@shared/terrain.js';
import {
  buildChunkTerrainData,
  BASE_INSTANCE_STRIDE,
  SIDE_INSTANCE_STRIDE,
  TOP_INSTANCE_STRIDE,
  FLOOR_LIFT_Z,
} from '@client-webgl/terrain/terrain-instances.js';
import { TERRAIN_VARIANT_COUNTS, PX_PER_Z } from '@client-webgl/platform/config.js';
import type { TerrainLayerIndex } from '@client-webgl/terrain/texture-arrays.js';

/** Minimal stub: one layer per (terrain, frame, variant) — value doesn't
 *  matter for geometry assertions, only for the builder not to crash. */
function stubLayerIndex(): TerrainLayerIndex {
  const idx: TerrainLayerIndex = [];
  for (let t = 0; t < TERRAIN_VARIANT_COUNTS.length; t++) {
    idx.push([new Array(TERRAIN_VARIANT_COUNTS[t]).fill(0)]);
  }
  return idx;
}

/** 17×17 zero elevation grid — all corners at world-Z 0. */
function flatElevation(): Float32Array {
  return new Float32Array((CHUNK_SIZE + 1) * (CHUNK_SIZE + 1));
}

function makeMap(): WorldMap {
  return new WorldMap(CHUNK_SIZE * 2, CHUNK_SIZE * 2);
}

describe('floor platform side instances', () => {
  it('lone wooden floor emits SE + SW sides with lifted top edge', () => {
    const map = makeMap();
    map.setBuilding(4, 4, Building.WoodenFloor);
    const data = buildChunkTerrainData(map, flatElevation(), 0, 0, stubLayerIndex());

    expect(data.sideCount).toBe(2);

    // Inspect the floor tile's base-instance top Y values — they must be
    // lifted (smaller in screen-Y) by FLOOR_LIFT_Z * PX_PER_Z relative to a
    // non-floor tile at the same corner position.
    const baseF32 = new Float32Array(data.baseData);
    const floorBaseF = (4 * CHUNK_SIZE + 4) * 12;
    const grassBaseF = (0 * CHUNK_SIZE + 0) * 12;
    // Both tiles share the same elevation grid (all zeros), so the lift is the
    // only source of the Y delta. Compare N corner (offset +4) between floor
    // and grass tile — the floor should be `FLOOR_LIFT_Z * PX_PER_Z` smaller.
    const nyFloor = baseF32[floorBaseF + 4];
    const nyGrass = baseF32[grassBaseF + 4];
    // Grass tile (0,0) and floor tile (4,4) have different natural screen Y
    // because (tx+ty) differs — compute the expected non-lift component.
    const HALF_H = 16;  // TILE_H / 2 = 32 / 2
    const expectedGrassNy = (0 + 0) * HALF_H;       // (tx + ty) * HALF_H - zN*PX_PER_Z
    const expectedFloorNy = (4 + 4) * HALF_H - FLOOR_LIFT_Z * PX_PER_Z;
    expect(nyGrass).toBeCloseTo(expectedGrassNy);
    expect(nyFloor).toBeCloseTo(expectedFloorNy);
  });

  it('floor strip suppresses the shared interior edge', () => {
    // Two floors side-by-side: (4,4) and (5,4). (5,4) is the SE neighbor of
    // (4,4), so (4,4)'s SE face should be suppressed (1 side instead of 2).
    // (5,4) has no floor SE neighbor, so it still emits both sides.
    // Total: 1 (for 4,4 SW) + 2 (for 5,4 SE+SW) = 3.
    const map = makeMap();
    map.setBuilding(4, 4, Building.WoodenFloor);
    map.setBuilding(5, 4, Building.WoodenFloor);
    const data = buildChunkTerrainData(map, flatElevation(), 0, 0, stubLayerIndex());

    expect(data.sideCount).toBe(3);
  });

  it('stone floor gets the same treatment', () => {
    const map = makeMap();
    map.setBuilding(4, 4, Building.StoneFloor);
    const data = buildChunkTerrainData(map, flatElevation(), 0, 0, stubLayerIndex());

    expect(data.sideCount).toBe(2);
  });

  it('non-floor tiles emit zero side and top instances', () => {
    const map = makeMap();
    // All grass, no buildings — no sides, no top redraws.
    const data = buildChunkTerrainData(map, flatElevation(), 0, 0, stubLayerIndex());
    expect(data.sideCount).toBe(0);
    expect(data.topCount).toBe(0);
  });

  it('emits one top-redraw instance per floor tile (fixes overlay bite)', () => {
    const map = makeMap();
    map.setBuilding(4, 4, Building.WoodenFloor);
    map.setBuilding(5, 4, Building.StoneFloor);
    const data = buildChunkTerrainData(map, flatElevation(), 0, 0, stubLayerIndex());
    expect(data.topCount).toBe(2);

    // Top instance mirrors the base for its tile — corners must match the
    // floor tile's LIFTED N/E/S/W Y values, not the natural grid values.
    const topF32 = new Float32Array(data.topData);
    const tyVal = topF32[4]; // N screen-Y of first top instance (offset 4 within its 12 floats).
    const HALF_H = 16;
    const expectedN = (4 + 4) * HALF_H - FLOOR_LIFT_Z * PX_PER_Z;
    expect(tyVal).toBeCloseTo(expectedN);
  });

  it('instance layout strides match documented sizes', () => {
    const map = makeMap();
    map.setBuilding(4, 4, Building.WoodenFloor);
    const data = buildChunkTerrainData(map, flatElevation(), 0, 0, stubLayerIndex());

    expect(data.sideData.byteLength).toBe(data.sideCount * SIDE_INSTANCE_STRIDE);
    expect(data.topData.byteLength).toBe(data.topCount * TOP_INSTANCE_STRIDE);
    expect(SIDE_INSTANCE_STRIDE).toBe(44);
    expect(BASE_INSTANCE_STRIDE).toBe(48);
    expect(TOP_INSTANCE_STRIDE).toBe(48);
  });
});
