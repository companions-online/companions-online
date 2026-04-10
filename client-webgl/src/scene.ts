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
import { loadSpriteRegistry, type SpriteRegistry } from './entities/sprite-registry.js';
import { spawnDeer } from './entities/deer.js';
import type { ClientEntity } from './entities/client-entity.js';

export interface Scene {
  gl: WebGL2RenderingContext;
  worldMap: WorldMap;
  camera: Camera;
  terrainTexture: TerrainTextureArray;
  maskTexture: MaskTextureArray;
  terrainRenderer: TerrainRenderer;
  spriteRenderer: SpriteRenderer;
  spriteRegistry: SpriteRegistry;
  entities: Map<number, ClientEntity>;
  myEntityId: number | null;
  time: number;
}

/**
 * One-shot async scene build: world-gen + terrain/mask texture uploads +
 * instance buffers + sprite registry load + deer spawn.
 */
export async function createScene(
  gl: WebGL2RenderingContext,
  seed: number,
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

  // Load every sprite PNG declared in sprite-manifest.ts in parallel.
  const spriteRegistry = await loadSpriteRegistry(gl);

  const camera = new Camera(SPAWN_X, SPAWN_Y);

  const entities = new Map<number, ClientEntity>();
  const deerIds = spawnDeer(entities, 6, (x, y) => !worldMap.isWalkable(x, y), spriteRegistry);
  // Temporary: follow the first local deer as if it were the player. Once
  // network sync arrives, the welcome message will set scene.myEntityId.
  const myEntityId = deerIds[0] ?? null;

  return {
    gl,
    worldMap,
    camera,
    terrainTexture,
    maskTexture,
    terrainRenderer,
    spriteRenderer,
    spriteRegistry,
    entities,
    myEntityId,
    time: 0,
  };
}
