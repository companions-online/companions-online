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
import { spawnTrees, placeTree } from './entities/tree.js';
import { TREE_BLUEPRINT } from './entities/sprite-manifest.js';
import type { ClientEntity } from './entities/client-entity.js';
import { generateWallTextures } from './buildings/wall-texture.js';
import { buildWallDrawables, type WallDrawable } from './buildings/wall-sprites.js';

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
  wallDrawables: WallDrawable[];
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

  // Wall textures + drawable list for Y-sort rendering.
  const wallTextures = generateWallTextures(gl);
  const wallDrawables = buildWallDrawables(worldMap, wallTextures, elevationGrid);

  const camera = new Camera(SPAWN_X, SPAWN_Y);

  const entities = new Map<number, ClientEntity>();
  const terrainBlocked = (x: number, y: number) => !worldMap.isWalkable(x, y);

  // Trees first: they register occupied tiles that creature pathfinding must
  // avoid. Tree ids live in a high range (1000+) to stay out of the way of
  // future creature id growth.
  const { occupiedTiles: treeTiles } = spawnTrees(
    entities, terrainBlocked, spriteRegistry, 1000, seed,
  );
  const isBlocked = (x: number, y: number) =>
    terrainBlocked(x, y) || treeTiles.has(y * MAP_SIZE + x);

  // 3 showcase trees near spawn, one of each variant, side by side.
  for (let v = 0; v < 3; v++) {
    const id = 900 + v;
    const sheet = spriteRegistry.resolve(TREE_BLUEPRINT, v);
    entities.set(id, placeTree(id, SPAWN_X + 3 + v, SPAWN_Y - 3, sheet));
    treeTiles.add((SPAWN_Y - 3) * MAP_SIZE + (SPAWN_X + 3 + v));
  }

  // Player — becomes scene.myEntityId. Wander herd takes ids 2..6.
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
    wallDrawables,
    myEntityId: playerSpawn.id,
    playerControls: { moveTo: playerSpawn.moveTo },
    time: 0,
  };
}
