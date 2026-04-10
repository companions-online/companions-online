import { MAP_SIZE, SPAWN_X, SPAWN_Y } from '@shared/constants.js';
import { generateWorld } from '@shared/world/world-gen.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { Camera } from './platform/camera.js';
import { generateRawTerrainTiles } from './terrain/texture.js';
import { generateBlendMasks } from './terrain/blend-masks.js';
import { buildElevationGrid, buildShadeGrid } from './terrain/elevation.js';
import { buildTerrainTextureArray, buildMaskTextureArray, type TerrainTextureArray, type MaskTextureArray } from './terrain/texture-arrays.js';
import { buildTerrainInstances } from './terrain/terrain-instances.js';
import { TerrainRenderer } from './terrain/terrain-renderer.js';
import { SpriteRenderer } from './entities/sprite-renderer.js';
import { createImageTexture } from './platform/gl-utils.js';
import { spawnDeer, type SpriteSheetInfo } from './entities/deer.js';
import type { Entity } from './entities/entity.js';

export interface Scene {
  gl: WebGL2RenderingContext;
  worldMap: WorldMap;
  camera: Camera;
  terrainTexture: TerrainTextureArray;
  maskTexture: MaskTextureArray;
  terrainRenderer: TerrainRenderer;
  spriteRenderer: SpriteRenderer;
  deerTexture: WebGLTexture;
  deerSheet: SpriteSheetInfo;
  entities: Entity[];
  time: number;
}

/**
 * One-shot async scene build: world-gen + terrain/mask texture uploads +
 * instance buffers + sprite sheet upload + deer spawn.
 */
export async function createScene(
  gl: WebGL2RenderingContext,
  seed: number,
  deerImage: HTMLImageElement,
): Promise<Scene> {
  const { map: worldMap } = generateWorld(seed);

  // CPU-side texture + mask generation — pure logic, no GL calls.
  const rawTiles = generateRawTerrainTiles();
  const masks = generateBlendMasks();

  // Upload to GL as texture arrays.
  const terrainTexture = await buildTerrainTextureArray(gl, rawTiles);
  const maskTexture = await buildMaskTextureArray(gl, masks);

  // Elevation grid + shade grid + instance buffers (one-time CPU walk over the map).
  const elevationGrid = buildElevationGrid(seed, MAP_SIZE, worldMap);
  const shadeGrid = buildShadeGrid(seed, MAP_SIZE);
  const instances = buildTerrainInstances(worldMap, elevationGrid, shadeGrid, terrainTexture.layerIndex);

  const terrainRenderer = new TerrainRenderer(gl, instances);
  const spriteRenderer = new SpriteRenderer(gl);

  const deerTexture = createImageTexture(gl, deerImage);
  const deerSheet: SpriteSheetInfo = {
    width: deerImage.naturalWidth,
    height: deerImage.naturalHeight,
  };

  const camera = new Camera(SPAWN_X, SPAWN_Y);

  const entities: Entity[] = [];
  spawnDeer(entities, 6, (x, y) => !worldMap.isWalkable(x, y), deerSheet);

  return {
    gl,
    worldMap,
    camera,
    terrainTexture,
    maskTexture,
    terrainRenderer,
    spriteRenderer,
    deerTexture,
    deerSheet,
    entities,
    time: 0,
  };
}
