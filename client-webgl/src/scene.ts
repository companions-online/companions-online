import { MAP_SIZE, SPAWN_X, SPAWN_Y } from '@shared/constants.js';
import { generateWorld } from '@shared/world/world-gen.js';
import type { WorldMap } from '@shared/world/world-map.js';
import { Camera } from './platform/camera.js';
import { generateRawTerrainTiles } from './terrain/texture.js';
import { generateBlendMasks } from './terrain/blend-masks.js';
import { buildElevationGrid } from './terrain/elevation.js';
import { buildTerrainTextureArray, buildMaskTextureArray, type TerrainTextureArray, type MaskTextureArray } from './terrain/texture-arrays.js';
import { buildTerrainInstances } from './terrain/terrain-instances.js';
import { TerrainRenderer } from './terrain/terrain-renderer.js';
import { SpriteRenderer } from './entities/sprite-renderer.js';
import { loadSpriteRegistry, type SpriteRegistry } from './entities/sprite-registry.js';
import { spawnDeer } from './entities/deer.js';
import { spawnPlayer } from './entities/player.js';
import type { ClientEntity } from './entities/client-entity.js';

export interface PlayerControls {
  moveTo: (tileX: number, tileY: number) => void;
}

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
  playerControls: PlayerControls | null;
  time: number;
}

/**
 * One-shot async scene build: world-gen + terrain/mask texture uploads +
 * instance buffers + sprite registry load + player + wander deer spawn.
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

  // Elevation grid + instance buffers (one-time CPU walk over the map).
  const elevationGrid = buildElevationGrid(seed, MAP_SIZE, worldMap);
  const instances = buildTerrainInstances(worldMap, elevationGrid, terrainTexture.layerIndex);

  const terrainRenderer = new TerrainRenderer(gl, instances);
  const spriteRenderer = new SpriteRenderer(gl);

  // Load every sprite PNG declared in sprite-manifest.ts in parallel.
  const spriteRegistry = await loadSpriteRegistry(gl);

  const camera = new Camera(SPAWN_X, SPAWN_Y);

  const entities = new Map<number, ClientEntity>();
  const isBlocked = (x: number, y: number) => !worldMap.isWalkable(x, y);

  // Player first — becomes scene.myEntityId. Wander herd takes ids 2..6.
  const playerSpawn = spawnPlayer(entities, SPAWN_X, SPAWN_Y, isBlocked, spriteRegistry, 1);
  spawnDeer(entities, 5, isBlocked, spriteRegistry, 2);

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
    myEntityId: playerSpawn.id,
    playerControls: { moveTo: playerSpawn.moveTo },
    time: 0,
  };
}
