import { generateWorld } from '@shared/world/world-gen.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { Camera } from './camera.js';
import { generateRawTerrainTiles, splitTerrainTiles } from './texture.js';
import { buildElevationGrid } from './elevation.js';
import { generateBlendMasks, type BlendMaskSet } from './blend-masks.js';
import { buildMaskedTerrain, type MaskedTerrainTiles } from './masked-terrain.js';
import type { SplitTile } from './quad-renderer.js';
import type { Entity } from './entity.js';

export interface Scene {
  worldMap: WorldMap;
  rawTerrainTiles: OffscreenCanvas[][][]; // [terrain][frame][variant] — kept for the Phase C debug atlas
  terrainTiles: SplitTile[][][];          // [terrain][frame][variant]
  maskedTerrain: MaskedTerrainTiles;      // [terrain][frame][variant][maskId]
  blendMasks: BlendMaskSet;
  elevationGrid: Float32Array;
  camera: Camera;
  entities: Entity[];
  time: number;                            // ms, drives water animation frame
}

export function createScene(seed: number): Scene {
  const { map: worldMap } = generateWorld(seed);
  const rawTerrainTiles = generateRawTerrainTiles();
  const terrainTiles = splitTerrainTiles(rawTerrainTiles);
  const blendMasks = generateBlendMasks();
  const maskedTerrain = buildMaskedTerrain(rawTerrainTiles, blendMasks);
  const elevationGrid = buildElevationGrid(seed, worldMap.width, worldMap);

  const spawnX = Math.floor(worldMap.width / 2);
  const spawnY = Math.floor(worldMap.height / 2);
  const camera = new Camera(spawnX, spawnY);

  return {
    worldMap,
    rawTerrainTiles,
    terrainTiles,
    maskedTerrain,
    blendMasks,
    elevationGrid,
    camera,
    entities: [],
    time: 0,
  };
}
