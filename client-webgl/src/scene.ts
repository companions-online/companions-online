// The scene is a passive container for replicated server state plus the
// rendering machinery that draws it. createScene() generates the static
// rendering assets (tile textures, blend masks, wall textures) up front —
// these have no worldMap dependency. Everything else fills in via the on*()
// mutators fed by connection.ts.
//
// Chunk visuals (terrain instances + wall drawables) are chunk-sparse: the
// scene holds at most CHUNK_CAPACITY chunks worth of data, sized for the
// player's interest range plus a just-in-time overlap margin. Eviction on
// player movement keeps the working set bounded regardless of map size.

import { CHUNK_SIZE, INTEREST_RANGE, MAP_SIZE, SPAWN_X, SPAWN_Y } from '@shared/constants.js';
import { WorldMap } from '@shared/world/world-map.js';
import type {
  DecodedChunk, DecodedEntityFullState, DecodedEntityUpdate, DecodedTileUpdate,
  SyncedInventoryItem,
} from '@shared/protocol/codec.js';
import { Camera } from './platform/camera.js';
import { SpriteRenderer } from './entities/sprite-renderer.js';
import { loadSpriteRegistry, type SpriteRegistry } from './entities/sprite-registry.js';
import type { ClientEntity } from './entities/client-entity.js';
import { createEntityFromNetwork, applyComponentsToEntity } from './entities/from-network.js';

import { generateRawTerrainTiles } from './terrain/texture.js';
import { generateBlendMasks } from './terrain/blend-masks.js';
import {
  buildTerrainTextureArray,
  buildMaskTextureArray,
  type TerrainTextureArray,
  type MaskTextureArray,
} from './terrain/texture-arrays.js';
import { TerrainRenderer } from './terrain/terrain-renderer.js';
import { buildElevationGridChunk, CHUNK_CORNER_SIZE } from './terrain/elevation.js';
import {
  buildChunkTerrainData,
  BASE_INSTANCE_STRIDE,
  OVERLAY_INSTANCE_STRIDE,
  type ChunkTerrainData,
} from './terrain/terrain-instances.js';
import { generateWallTextures } from './buildings/wall-texture.js';
import type { WallShape } from './buildings/wall-texture.js';
import { buildWallDrawablesForChunk, type WallDrawable } from './buildings/wall-sprites.js';

/** Chunks needed in each direction at a given instant: full interest range
 *  plus one extra ring so new chunks load just-in-time as the player's
 *  chunk slides. Squared → peak concurrent chunks. Plus a small margin for
 *  safety. At INTEREST_RANGE=32 CHUNK_SIZE=16 → radius 3, peak 49, +4 = 53. */
const INTEREST_RADIUS_CHUNKS = Math.ceil(INTEREST_RANGE / CHUNK_SIZE) + 1;
const PEAK_CONCURRENT_CHUNKS = (2 * INTEREST_RADIUS_CHUNKS + 1) ** 2;
const CHUNK_CAPACITY = PEAK_CONCURRENT_CHUNKS + 4;
const TILES_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

function chunkKey(cx: number, cy: number): number {
  return cy * 1024 + cx;
}

/** Chat log cap — matches the CLI's 50-entry rolling window. */
const CHAT_LOG_MAX = 50;

export interface ChatLogEntry {
  senderEntityId: number;
  message: string;
  /** `Date.now()` at arrival. UI uses this to age-out recent-chat overlays. */
  receivedAt: number;
}

export interface Scene {
  gl: WebGL2RenderingContext;
  camera: Camera;
  worldMap: WorldMap;
  spriteRegistry: SpriteRegistry;
  spriteRenderer: SpriteRenderer;
  terrainRenderer: TerrainRenderer;
  terrainTexture: TerrainTextureArray;
  maskTexture: MaskTextureArray;
  wallTextures: Map<WallShape, WebGLTexture>;
  entities: Map<number, ClientEntity>;
  wallDrawablesByChunk: Map<number, WallDrawable[]>;
  /** Per-chunk corner elevation grid ((CHUNK_SIZE+1)² floats). Stored so
   *  sprite draw paths + camera follow can sample ground z under a tile —
   *  terrain + walls already bake elevation at build time via
   *  getTileCornersLocal, but sprites anchor at draw time. */
  chunkElevation: Map<number, Float32Array>;
  myEntityId: number | null;
  seed: number | null;
  time: number;

  // --- Replicated sync state (Phase 9) ---
  /** The player's inventory. Empty until the server's first InventorySync. */
  inventory: SyncedInventoryItem[];
  /** Open container entity id + its items; null while no container is open. */
  containerEntityId: number | null;
  containerItems: SyncedInventoryItem[];
  /** NPC whose dialogue is currently open + the server-sent dialogue blob.
   *  Shape lives server-side (`onDialogueOpen` param) — kept here as
   *  unknown until the UI pass pulls in the exact type. */
  dialogueNpcId: number | null;
  dialogue: unknown;
  /** Rolling chat log, capped at CHAT_LOG_MAX (oldest dropped first). */
  chatLog: ChatLogEntry[];

  // --- Network mutators ---
  onWelcome(entityId: number, seed: number): void;
  onChunk(data: DecodedChunk): void;
  onEntityFull(data: DecodedEntityFullState): void;
  onEntityUpdate(update: DecodedEntityUpdate): void;
  onEntityRemoval(entityId: number): void;
  onTileUpdate(tu: DecodedTileUpdate): void;
  onInventorySync(items: SyncedInventoryItem[]): void;
  onContainerOpen(containerEntityId: number, items: SyncedInventoryItem[]): void;
  onDialogueOpen(npcEntityId: number, dialogue: unknown): void;
  onChatMessage(senderEntityId: number, message: string): void;

  /** Process dirty chunks: rebuild elevation/instances/walls, reconcile
   *  eviction based on player chunk position, upload to GPU. Called once
   *  per frame by the renderer. */
  processDirtyChunks(): void;

  /** Bilinearly interpolated ground elevation under tile (tileX, tileY),
   *  sampled at the tile center. Returns 0 if the chunk is not loaded —
   *  the caller (sprite draw / camera) falls through to baseline iso. */
  getGroundZ(tileX: number, tileY: number): number;
}

export interface StaticAssets {
  terrainTexture: TerrainTextureArray;
  maskTexture: MaskTextureArray;
  wallTextures: Map<WallShape, WebGLTexture>;
}

/**
 * Generate the render-time static assets: terrain tile textures, blend
 * masks, wall face textures. Pure CPU + GL uploads; no worldMap
 * dependency. Split out from createScene so tests can inject stubs.
 */
export async function loadStaticAssets(gl: WebGL2RenderingContext): Promise<StaticAssets> {
  const rawTiles = generateRawTerrainTiles();
  const blendMasks = generateBlendMasks();
  const terrainTexture = await buildTerrainTextureArray(gl, rawTiles);
  const maskTexture = await buildMaskTextureArray(gl, blendMasks);
  const wallTextures = generateWallTextures(gl);
  return { terrainTexture, maskTexture, wallTextures };
}

export interface CreateSceneOptions {
  /** Pre-built sprite registry. Tests inject a fake registry that skips
   *  PNG fetching + Image decoding; production omits this and boots the
   *  real registry from /assets/. */
  spriteRegistry?: SpriteRegistry;
  /** Pre-built static render assets. Tests inject stubs that skip
   *  OffscreenCanvas / image-bitmap generation; production omits this and
   *  builds them on the fly. */
  staticAssets?: StaticAssets;
}

export async function createScene(
  gl: WebGL2RenderingContext,
  opts: CreateSceneOptions = {},
): Promise<Scene> {
  const worldMap = new WorldMap(MAP_SIZE, MAP_SIZE);
  const camera = new Camera(SPAWN_X, SPAWN_Y);
  const spriteRenderer = new SpriteRenderer(gl);
  const spriteRegistry = opts.spriteRegistry ?? await loadSpriteRegistry(gl);

  const { terrainTexture, maskTexture, wallTextures } =
    opts.staticAssets ?? await loadStaticAssets(gl);
  const terrainRenderer = new TerrainRenderer(gl);

  const entities = new Map<number, ClientEntity>();
  const wallDrawablesByChunk = new Map<number, WallDrawable[]>();

  // Per-chunk CPU-side terrain data. Concatenated into GPU buffers on
  // terrain rebuild.
  const chunkTerrainData = new Map<number, ChunkTerrainData>();
  // Per-chunk corner elevation. Same lifecycle as chunkTerrainData —
  // populated in rebuildChunk, cleared on eviction. Read at draw time by
  // getGroundZ.
  const chunkElevation = new Map<number, Float32Array>();
  const dirtyChunks = new Set<number>();
  /** True when eviction or chunk removal changed the active set — forces a
   *  full GPU buffer re-concat even if no dirty chunks are rebuilding. */
  let layoutDirty = false;
  /** Last player-chunk we evicted against. Re-run eviction only when this
   *  changes, not every frame. Null means "eviction not yet run". */
  let lastEvictionChunk: { cx: number; cy: number } | null = null;

  function markChunkAndNeighborsDirty(cx: number, cy: number): void {
    dirtyChunks.add(chunkKey(cx, cy));
    dirtyChunks.add(chunkKey(cx - 1, cy));
    dirtyChunks.add(chunkKey(cx + 1, cy));
    dirtyChunks.add(chunkKey(cx, cy - 1));
    dirtyChunks.add(chunkKey(cx, cy + 1));
  }

  function evictOutOfRange(playerChunkX: number, playerChunkY: number): void {
    let evicted = 0;
    for (const key of [...chunkTerrainData.keys()]) {
      const cx = key % 1024;
      const cy = (key - cx) / 1024;
      if (Math.max(Math.abs(cx - playerChunkX), Math.abs(cy - playerChunkY)) > INTEREST_RADIUS_CHUNKS) {
        chunkTerrainData.delete(key);
        wallDrawablesByChunk.delete(key);
        chunkElevation.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) layoutDirty = true;
  }

  function rebuildChunk(cx: number, cy: number): void {
    // Only rebuild chunks actually inside the map. Negative or out-of-range
    // neighbors fall through silently — they were marked only because a
    // valid chunk at the edge has them as neighbors.
    const cols = Math.ceil(MAP_SIZE / CHUNK_SIZE);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= cols) return;

    if (scene.seed === null) return; // seed required for elevation noise
    const elevation = buildElevationGridChunk(scene.seed, worldMap, cx, cy);
    const terrainData = buildChunkTerrainData(
      worldMap, elevation, cx, cy, terrainTexture.layerIndex,
    );
    const key = chunkKey(cx, cy);
    chunkTerrainData.set(key, terrainData);
    chunkElevation.set(key, elevation);
    wallDrawablesByChunk.set(
      key,
      buildWallDrawablesForChunk(worldMap, wallTextures, elevation, cx, cy),
    );
  }

  /**
   * Rebuild GPU buffers from every chunk's CPU data. Called when any chunk
   * was (re)built or a chunk was evicted. Over-capacity is a correctness
   * bug: eviction should keep the active set bounded by CHUNK_CAPACITY.
   */
  function uploadTerrain(): void {
    const count = chunkTerrainData.size;
    if (count > CHUNK_CAPACITY) {
      throw new Error(
        `chunk capacity exceeded: ${count} > ${CHUNK_CAPACITY}. Eviction broken?`,
      );
    }
    if (count === 0) {
      terrainRenderer.uploadInstances(new ArrayBuffer(0), 0, new ArrayBuffer(0), 0);
      return;
    }

    const baseCount = count * TILES_PER_CHUNK;
    const baseBuf = new ArrayBuffer(baseCount * BASE_INSTANCE_STRIDE);
    const baseBytes = new Uint8Array(baseBuf);
    let baseOff = 0;

    let totalOverlays = 0;
    for (const cd of chunkTerrainData.values()) totalOverlays += cd.overlayCount;
    const overlayBuf = new ArrayBuffer(totalOverlays * OVERLAY_INSTANCE_STRIDE);
    const overlayBytes = new Uint8Array(overlayBuf);
    let overlayOff = 0;

    for (const cd of chunkTerrainData.values()) {
      baseBytes.set(new Uint8Array(cd.baseData), baseOff);
      baseOff += cd.baseData.byteLength;
      overlayBytes.set(new Uint8Array(cd.overlayData), overlayOff);
      overlayOff += cd.overlayData.byteLength;
    }

    terrainRenderer.uploadInstances(baseBuf, baseCount, overlayBuf, totalOverlays);
  }

  // Corner-grid sampler. Corner (cornerX, cornerY) is shared across the
  // chunks that border it — pick whichever chunk owns the integer corner.
  // Unloaded chunks return 0, so partial-map edges degrade to baseline iso.
  function sampleCorner(cornerX: number, cornerY: number): number {
    const ccx = Math.floor(cornerX / CHUNK_SIZE);
    const ccy = Math.floor(cornerY / CHUNK_SIZE);
    const grid = chunkElevation.get(chunkKey(ccx, ccy));
    if (!grid) return 0;
    const lx = cornerX - ccx * CHUNK_SIZE;
    const ly = cornerY - ccy * CHUNK_SIZE;
    return grid[ly * CHUNK_CORNER_SIZE + lx];
  }

  const scene: Scene = {
    gl,
    camera,
    worldMap,
    spriteRegistry,
    spriteRenderer,
    terrainRenderer,
    terrainTexture,
    maskTexture,
    wallTextures,
    entities,
    wallDrawablesByChunk,
    chunkElevation,
    myEntityId: null,
    seed: null,
    time: 0,

    inventory: [],
    containerEntityId: null,
    containerItems: [],
    dialogueNpcId: null,
    dialogue: null,
    chatLog: [],

    onWelcome(entityId, seed) {
      this.myEntityId = entityId;
      this.seed = seed;
    },

    onInventorySync(items) {
      this.inventory = items;
    },

    onContainerOpen(containerEntityId, items) {
      this.containerEntityId = containerEntityId;
      this.containerItems = items;
    },

    onDialogueOpen(npcEntityId, dialogue) {
      this.dialogueNpcId = npcEntityId;
      this.dialogue = dialogue;
    },

    onChatMessage(senderEntityId, message) {
      this.chatLog.push({ senderEntityId, message, receivedAt: Date.now() });
      if (this.chatLog.length > CHAT_LOG_MAX) {
        this.chatLog.splice(0, this.chatLog.length - CHAT_LOG_MAX);
      }
    },

    onChunk(data) {
      const { chunkX, chunkY, terrain, buildings, buildingMeta } = data;
      const sx = chunkX * CHUNK_SIZE;
      const sy = chunkY * CHUNK_SIZE;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const gi = (sy + ly) * MAP_SIZE + (sx + lx);
          const ci = ly * CHUNK_SIZE + lx;
          worldMap.terrain[gi] = terrain[ci];
          worldMap.buildings[gi] = buildings[ci];
          worldMap.buildingMeta[gi] = buildingMeta[ci];
        }
      }
      markChunkAndNeighborsDirty(chunkX, chunkY);
    },

    onEntityFull(data) {
      const e = createEntityFromNetwork(data.entityId, data.components, spriteRegistry, worldMap);
      entities.set(data.entityId, e);
    },

    onEntityUpdate(update) {
      const existing = entities.get(update.entityId);
      if (existing) {
        applyComponentsToEntity(existing, update.components, this.time);
        return;
      }
      if (update.components.blueprint) {
        entities.set(update.entityId,
          createEntityFromNetwork(update.entityId, update.components, spriteRegistry, worldMap));
      }
    },

    onEntityRemoval(entityId) {
      entities.delete(entityId);
    },

    onTileUpdate(tu) {
      const gi = tu.tileY * MAP_SIZE + tu.tileX;
      if (tu.terrain !== undefined) worldMap.terrain[gi] = tu.terrain;
      if (tu.building !== undefined) worldMap.buildings[gi] = tu.building;
      if (tu.buildingMeta !== undefined) worldMap.buildingMeta[gi] = tu.buildingMeta;
      markChunkAndNeighborsDirty(
        Math.floor(tu.tileX / CHUNK_SIZE),
        Math.floor(tu.tileY / CHUNK_SIZE),
      );
    },

    processDirtyChunks() {
      // Eviction step: if the player moved into a new chunk, drop anything
      // outside the interest radius.
      if (this.myEntityId !== null) {
        const me = entities.get(this.myEntityId);
        if (me?.position) {
          const pcx = Math.floor(me.position.tileX / CHUNK_SIZE);
          const pcy = Math.floor(me.position.tileY / CHUNK_SIZE);
          if (!lastEvictionChunk || lastEvictionChunk.cx !== pcx || lastEvictionChunk.cy !== pcy) {
            evictOutOfRange(pcx, pcy);
            lastEvictionChunk = { cx: pcx, cy: pcy };
          }
        }
      }

      // Rebuild each dirty chunk that still has worldMap data. A chunk is
      // "interesting" if we've received a chunk message for it — i.e. we
      // have terrain bytes set non-zero somewhere in it. We use the
      // presence of the chunk in chunkTerrainData OR a non-Grass terrain
      // byte as a cheap proxy. Simpler: rebuild whenever dirty; rebuilds
      // for untouched chunks produce zero-data quickly.
      let didWork = false;
      if (dirtyChunks.size > 0) {
        for (const key of dirtyChunks) {
          const cx = key % 1024;
          const cy = (key - cx) / 1024;
          // Only rebuild chunks that are in-interest — the player may not
          // yet be positioned, in which case no eviction has happened and
          // all received chunks are valid.
          if (this.myEntityId !== null && lastEvictionChunk) {
            if (Math.max(Math.abs(cx - lastEvictionChunk.cx),
                         Math.abs(cy - lastEvictionChunk.cy)) > INTEREST_RADIUS_CHUNKS) {
              continue;
            }
          }
          rebuildChunk(cx, cy);
          didWork = true;
        }
        dirtyChunks.clear();
      }

      if (didWork || layoutDirty) {
        uploadTerrain();
        layoutDirty = false;
      }
    },

    getGroundZ(tileX, tileY) {
      // Sprite feet anchor at the tile center (screen.screenY + TILE_H/2),
      // so sample the corner grid at tile center in world-corner coords.
      const cx = tileX + 0.5;
      const cy = tileY + 0.5;
      const cx0 = Math.floor(cx);
      const cy0 = Math.floor(cy);
      const fx = cx - cx0;
      const fy = cy - cy0;
      const z00 = sampleCorner(cx0,     cy0);
      const z10 = sampleCorner(cx0 + 1, cy0);
      const z01 = sampleCorner(cx0,     cy0 + 1);
      const z11 = sampleCorner(cx0 + 1, cy0 + 1);
      return (z00 * (1 - fx) + z10 * fx) * (1 - fy)
           + (z01 * (1 - fx) + z11 * fx) * fy;
    },
  };

  return scene;
}
