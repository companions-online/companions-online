import { generateWorld } from '@shared/world/world-gen.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { Camera } from './camera.js';
import { generateTerrainTiles } from './texture.js';
import { buildElevationGrid } from './elevation.js';
import { generateTransitionOverlays, type TransitionOverlays } from './transitions.js';
import type { SplitTile } from './quad-renderer.js';
import type { Entity } from './entity.js';

export interface Scene {
  worldMap: WorldMap;
  terrainTiles: SplitTile[][][];       // [terrain][frame][variant]
  elevationGrid: Float32Array;
  transitions: TransitionOverlays;
  camera: Camera;
  entities: Entity[];
  time: number;                         // ms, drives water animation frame
}

export function createScene(seed: number): Scene {
  const { map: worldMap } = generateWorld(seed);
  const terrainTiles = generateTerrainTiles();
  const elevationGrid = buildElevationGrid(seed, worldMap.width, worldMap);
  const transitions = generateTransitionOverlays();

  const spawnX = Math.floor(worldMap.width / 2);
  const spawnY = Math.floor(worldMap.height / 2);
  const camera = new Camera(spawnX, spawnY);

  return { worldMap, terrainTiles, elevationGrid, transitions, camera, entities: [], time: 0 };
}
