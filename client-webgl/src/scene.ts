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
  SyncedInventoryItem, WireEvent,
} from '@shared/protocol/codec.js';
import type { MetaKey } from '@shared/entity-meta.js';
import { WireEventType } from '@shared/protocol/opcodes.js';
import type { TextSurface } from './effects/text-surface.js';
import { Camera } from './platform/camera.js';
import { TILE_H } from './platform/config.js';
import { SpriteRenderer } from './entities/sprite-renderer.js';
import { loadSpriteRegistry, type SpriteRegistry } from './entities/sprite-registry.js';
import { EffectManager } from './effects/effect.js';
import { LightingManager } from './lighting/lighting.js';
import { createTextSurfaceFactory, type TextSurfaceFactory } from './effects/text-surface.js';
import { createDamageNumber } from './effects/damage-number.js';
import { createPickupText } from './effects/pickup-text.js';
import { createChatBubble } from './effects/chat-bubble.js';
import { loadEffectSprites, type EffectSprites } from './effects/effect-sprites.js';
import { createSpriteAnim } from './effects/sprite-anim.js';
import { ActionType } from '@shared/actions.js';
import { getBlueprint } from '@shared/blueprints.js';
import type { ClientEntity } from './entities/client-entity.js';
import { createEntityFromNetwork, applyComponentsToEntity } from './entities/from-network.js';
import type { Overlay } from './overlay.js';
import type { ObserverCamera } from './controls/observer-camera.js';

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
  SIDE_INSTANCE_STRIDE,
  TOP_INSTANCE_STRIDE,
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

/** Frame order for the 9-frame smoke sheet: build from intensity 6→9, fade
 *  to 1. Sheet layout: row 0 holds intensities 9,8,7; row 1 holds 6,5,4;
 *  row 2 holds 3,2,1 — so sheet index 0 is peak intensity, index 8 is
 *  wispiest. Sequence below is the intensity labels translated to sheet
 *  indices: 6→9 means 3→0, then fade to 1 means 0→8. ~55ms per frame. */
const SMOKE_FRAME_SEQUENCE = [3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 8];
const SMOKE_DURATION_MS = 660;
const ATTACK_DURATION_MS = 280;
const HARVEST_CRAFT_DURATION_MS = 420;
/** Healing puff plays through all 9 frames in order. Follows the healed
 *  entity so it tracks if the player moves during / after the channel. */
const HEALING_FRAME_SEQUENCE = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const HEALING_DURATION_MS = 720;

function createSmokePuff(effectSprites: EffectSprites, tileX: number, tileY: number, startTime: number) {
  return createSpriteAnim({
    sheet: effectSprites.smoke,
    anchorX: tileX,
    anchorY: tileY,
    startTime,
    totalDurationMs: SMOKE_DURATION_MS,
    frameSequence: SMOKE_FRAME_SEQUENCE,
  });
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
  /** Observer-mode interest center (float tile coords; mirrors how
   *  `ClientEntity.visualX/visualY` work for the player follow path). Set
   *  when the client is acting as an observer (no player entity); drives
   *  camera follow + chunk eviction (via Math.floor of chunk size) +
   *  lighting center as the fallback when `myEntityId === null`. Mutated
   *  by the autopilot camera (or any future god-view driver). The server
   *  chunk-streaming call (`world.setObserverFocus`) is throttled to
   *  rounded-tile transitions inside the driver. */
  observerFocus: { tileX: number; tileY: number } | null;
  /** Active autopilot driver for observer mode, ticked by the renderer
   *  each frame. Null in player mode (no observer to drive). */
  observerCamera: ObserverCamera | null;
  seed: number | null;
  time: number;
  effects: EffectManager;
  textSurfaceFactory: TextSurfaceFactory;
  effectSprites: EffectSprites;
  lighting: LightingManager;

  // --- Replicated sync state (Phase 9) ---
  /** The player's inventory. Empty until the server's first InventorySync. */
  inventory: SyncedInventoryItem[];
  /** Currently active modal overlay. See `overlay.ts` for the union and
   *  helpers (isInventoryShowing, isInputCaptured, getContainer). Replaces
   *  the prior parallel inventoryOpen / containerEntityId / containerItems /
   *  dialogueNpcId / dialogue fields — the data each variant needs is
   *  carried inside the variant. */
  overlay: Overlay;
  /** Rolling chat log, capped at CHAT_LOG_MAX (oldest dropped first). */
  chatLog: ChatLogEntry[];
  /** Entity meta dict per entity (name, title, etc.). Sparse — only entities
   *  with meta appear; only set keys appear. Populated via onEntityMeta. */
  entityMeta: Map<number, Map<MetaKey, string>>;
  /** TextSurface cache keyed by display name. Avoids per-frame raster+upload
   *  for nameplates; entries outlive any specific entity. */
  nameplateCache: Map<string, TextSurface>;

  // --- Inventory / crafting UI state ---
  /** Minecraft-style held stack on the cursor. Null when nothing held.
   *  `source` tells the click dispatcher which inventory (player vs. open
   *  container) the stack originated in — needed so that dropping onto
   *  the other inventory produces a Transfer in the correct direction. */
  heldStack: {
    itemId: number;
    blueprintId: number;
    quantity: number;
    source: 'inventory' | 'container';
  } | null;
  /** Last-seen cursor position in canvas pixels. Updated on mousemove,
   *  consumed by the ghost-sprite + placement-mode draws. */
  cursorScreenX: number;
  cursorScreenY: number;
  /** Client-local inventory grid layout: itemId → slot index. Preserved
   *  across InventorySync by pruning ids no longer present and assigning
   *  newcomers to the lowest free slot. Lost on page reload. */
  gridOrder: Map<number, number>;
  /** Optimistic in-flight removals: when a click sends Drop / Transfer /
   *  Equip-with-quantity, we record the about-to-vanish amount here so
   *  the source slot stays visually empty until the server's
   *  InventorySync confirms. Cleared on every InventorySync; entries
   *  older than `PENDING_DECREMENT_TTL_MS` are GC'd by the draw path so
   *  a rejected action self-heals. */
  pendingItemDecrements: Map<number, { quantity: number; timestamp: number }>;
  /** World tile under the cursor while placement mode is active, or null
   *  when placement mode is off. Placement is active iff inventory is
   *  closed AND the selected quickslot holds a placeable. */
  placementHoverTile: { tileX: number; tileY: number } | null;

  /** Quickbar: fixed-length array of 9 slots. Each entry is the itemId
   *  bound to that slot, or null if empty. Items bound here are hidden
   *  from the main grid (gridOrder ignores them) — a quickbar slot and
   *  a grid cell are mutually exclusive placements for the same itemId.
   *  Pruned on InventorySync when the referenced itemId disappears. */
  quickSlots: (number | null)[];
  /** Index (0..8) of the currently selected quickslot, or null if none.
   *  Driven by the `1`..`9` keys. Selection controls: the hand equip
   *  (sent to server when an equippable is selected) and the context-
   *  sensitive right-click mode (placement / cook / consumable). */
  selectedQuickSlot: number | null;

  // --- Observer-mode mutator ---
  /** Set the observer's interest center. Pure scene-state set; the
   *  server-side `setObserverFocus` push is the caller's responsibility
   *  (the autopilot camera does both). */
  setObserverFocus(tileX: number, tileY: number): void;

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
  onEnvironmentSync(gameMinute: number, weather: number, serverTick: number): void;
  onEntityMeta(entityId: number, key: MetaKey, value: string): void;
  /** Dispatched per event in a GameEvents batch. Animation layer hooks in
   *  here by switching on `event.type`. `tick` is the server tick the batch
   *  was flushed at (batches are tick-aligned with the preceding WorldDelta). */
  onGameEvent(event: WireEvent, tick: number): void;

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
  /** Text surface factory for effects. Tests inject a fake that skips
   *  OffscreenCanvas; production omits this and uses the real implementation. */
  textSurfaceFactory?: TextSurfaceFactory;
  /** Pre-built effect sprite sheets (smoke, attack, harvest-craft) + HP-bar
   *  solid-color textures. Tests inject stubs; production omits this and
   *  boots the real loader from /assets/. */
  effectSprites?: EffectSprites;
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

  const effects = new EffectManager();
  const textSurfaceFactory = opts.textSurfaceFactory ?? createTextSurfaceFactory(gl);
  const effectSprites = opts.effectSprites ?? await loadEffectSprites(gl);
  const lighting = new LightingManager(gl);

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
      terrainRenderer.uploadInstances(
        new ArrayBuffer(0), 0,
        new ArrayBuffer(0), 0,
        new ArrayBuffer(0), 0,
        new ArrayBuffer(0), 0,
      );
      return;
    }

    const baseCount = count * TILES_PER_CHUNK;
    const baseBuf = new ArrayBuffer(baseCount * BASE_INSTANCE_STRIDE);
    const baseBytes = new Uint8Array(baseBuf);
    let baseOff = 0;

    let totalOverlays = 0;
    let totalSides = 0;
    let totalTops = 0;
    for (const cd of chunkTerrainData.values()) {
      totalOverlays += cd.overlayCount;
      totalSides += cd.sideCount;
      totalTops += cd.topCount;
    }
    const overlayBuf = new ArrayBuffer(totalOverlays * OVERLAY_INSTANCE_STRIDE);
    const overlayBytes = new Uint8Array(overlayBuf);
    let overlayOff = 0;
    const sideBuf = new ArrayBuffer(totalSides * SIDE_INSTANCE_STRIDE);
    const sideBytes = new Uint8Array(sideBuf);
    let sideOff = 0;
    const topBuf = new ArrayBuffer(totalTops * TOP_INSTANCE_STRIDE);
    const topBytes = new Uint8Array(topBuf);
    let topOff = 0;

    for (const cd of chunkTerrainData.values()) {
      baseBytes.set(new Uint8Array(cd.baseData), baseOff);
      baseOff += cd.baseData.byteLength;
      overlayBytes.set(new Uint8Array(cd.overlayData), overlayOff);
      overlayOff += cd.overlayData.byteLength;
      sideBytes.set(new Uint8Array(cd.sideData), sideOff);
      sideOff += cd.sideData.byteLength;
      topBytes.set(new Uint8Array(cd.topData), topOff);
      topOff += cd.topData.byteLength;
    }

    terrainRenderer.uploadInstances(
      baseBuf, baseCount,
      overlayBuf, totalOverlays,
      sideBuf, totalSides,
      topBuf, totalTops,
    );
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
    observerFocus: null,
    observerCamera: null,
    seed: null,
    time: 0,
    effects,
    textSurfaceFactory,
    effectSprites,
    lighting,

    inventory: [],
    overlay: { kind: 'none' },
    chatLog: [],
    entityMeta: new Map(),
    nameplateCache: new Map(),

    heldStack: null,
    cursorScreenX: 0,
    cursorScreenY: 0,
    gridOrder: new Map(),
    pendingItemDecrements: new Map(),
    placementHoverTile: null,
    quickSlots: Array<number | null>(9).fill(null),
    selectedQuickSlot: null,

    onWelcome(entityId, seed) {
      // entityId === 0 is the observer-channel sentinel (see GameWorld
      // addObserver). Leave myEntityId null so the camera + chunk eviction +
      // lighting fall through to their observerFocus paths; the autopilot
      // (or any future god-view driver) populates observerFocus.
      this.myEntityId = entityId === 0 ? null : entityId;
      this.seed = seed;
    },

    setObserverFocus(tileX, tileY) {
      this.observerFocus = { tileX, tileY };
    },

    onInventorySync(items) {
      // Diff by blueprintId total quantity — spawn pickup text for increases.
      if (this.myEntityId !== null) {
        const me = entities.get(this.myEntityId);
        if (me) {
          const prevQty = new Map<number, number>();
          for (const it of this.inventory) {
            prevQty.set(it.blueprintId, (prevQty.get(it.blueprintId) ?? 0) + it.quantity);
          }
          const newQty = new Map<number, number>();
          for (const it of items) {
            newQty.set(it.blueprintId, (newQty.get(it.blueprintId) ?? 0) + it.quantity);
          }
          let offsetIndex = 0;
          for (const [bpId, qty] of newQty) {
            const prev = prevQty.get(bpId) ?? 0;
            if (qty > prev) {
              const delta = qty - prev;
              const name = getBlueprint(bpId)?.name ?? 'item';
              effects.spawn(createPickupText(
                me, `+${delta} ${name}`, this.time, textSurfaceFactory, offsetIndex++,
              ));
            }
          }
        }
      }
      this.inventory = items;

      // Reconcile UI-local grid layout + held stack + quickbar bindings
      // against the new server-authoritative inventory.
      const presentIds = new Set(items.map(i => i.itemId));

      // Drop any quickslot binding whose itemId no longer exists.
      for (let i = 0; i < this.quickSlots.length; i++) {
        const id = this.quickSlots[i];
        if (id !== null && !presentIds.has(id)) this.quickSlots[i] = null;
      }
      // Clear selection if the selected slot is empty.
      if (this.selectedQuickSlot !== null
        && this.quickSlots[this.selectedQuickSlot] === null) {
        this.selectedQuickSlot = null;
      }

      // Items bound to the quickbar are NOT laid out in the grid.
      const inQuickbar = new Set<number>();
      for (const id of this.quickSlots) if (id !== null) inQuickbar.add(id);

      for (const itemId of [...this.gridOrder.keys()]) {
        if (!presentIds.has(itemId) || inQuickbar.has(itemId)) {
          this.gridOrder.delete(itemId);
        }
      }
      const takenSlots = new Set(this.gridOrder.values());
      let nextSlot = 0;
      for (const item of items) {
        if (inQuickbar.has(item.itemId)) continue;
        if (this.gridOrder.has(item.itemId)) continue;
        while (takenSlots.has(nextSlot)) nextSlot++;
        this.gridOrder.set(item.itemId, nextSlot);
        takenSlots.add(nextSlot);
      }
      if (this.heldStack && !presentIds.has(this.heldStack.itemId)) {
        this.heldStack = null;
      }
      // Server's view is authoritative — any optimistic in-flight
      // decrements are now superseded.
      this.pendingItemDecrements.clear();
    },

    onContainerOpen(containerEntityId, items) {
      // The container variant is itself "inventory-showing" (see
      // isInventoryShowing) so the player's inventory panel renders
      // alongside the chest items — same UX as before, fewer fields.
      this.overlay = { kind: 'container', entityId: containerEntityId, items };
    },

    onDialogueOpen(npcEntityId, dialogue) {
      this.overlay = { kind: 'dialogue', npcId: npcEntityId, dialogue };
    },

    onEnvironmentSync(gameMinute, weather, serverTick) {
      lighting.onEnvironmentSync(gameMinute, weather, serverTick, performance.now());
    },

    onChatMessage(senderEntityId, message) {
      this.chatLog.push({ senderEntityId, message, receivedAt: Date.now() });
      if (this.chatLog.length > CHAT_LOG_MAX) {
        this.chatLog.splice(0, this.chatLog.length - CHAT_LOG_MAX);
      }
      effects.spawn(createChatBubble(senderEntityId, message, this.time, textSurfaceFactory));
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
        const prevHp = existing.health?.currentHp;
        const prevActionType = existing.currentAction?.actionType;
        applyComponentsToEntity(existing, update.components, this.time);

        // Damage number: spawn when HP decreased.
        if (prevHp !== undefined
          && update.components.health !== undefined
          && update.components.health.currentHp < prevHp) {
          const delta = prevHp - update.components.health.currentHp;
          effects.spawn(createDamageNumber(
            existing, delta, this.time, textSurfaceFactory,
            { largeFont: existing.id === this.myEntityId },
          ));
        }

        // Death smoke puff: currentAction transitioned into Dead. Covers the
        // player-death case where the entity persists (no EntityDied event
        // fires for players; only currentAction replicates).
        const nextActionType = update.components.currentAction?.actionType;
        if (nextActionType === ActionType.Dead && prevActionType !== ActionType.Dead) {
          effects.spawn(createSmokePuff(effectSprites, existing.visualX, existing.visualY, this.time));
        }
        return;
      }
      if (update.components.blueprint) {
        entities.set(update.entityId,
          createEntityFromNetwork(update.entityId, update.components, spriteRegistry, worldMap));
      }
    },

    onEntityRemoval(entityId) {
      entities.delete(entityId);
      this.entityMeta.delete(entityId);
    },

    onEntityMeta(entityId, key, value) {
      const bucket = this.entityMeta.get(entityId);
      if (value === '') {
        if (!bucket) return;
        bucket.delete(key);
        if (bucket.size === 0) this.entityMeta.delete(entityId);
      } else if (bucket) {
        bucket.set(key, value);
      } else {
        this.entityMeta.set(entityId, new Map([[key, value]]));
      }
    },

    onGameEvent(event, _tick) {
      switch (event.type) {
        case WireEventType.CombatHitDealt: {
          const attacker = entities.get(event.attackerId);
          const target = entities.get(event.targetId);
          // Midpoint when both alive; attacker-only on the killing hit (target
          // already removed by the preceding WorldDelta — smoke puff covers the
          // moment of kill anyway).
          const ax = target
            ? ((attacker?.visualX ?? target.visualX) + target.visualX) / 2
            : attacker?.visualX;
          const ay = target
            ? ((attacker?.visualY ?? target.visualY) + target.visualY) / 2
            : attacker?.visualY;
          if (ax !== undefined && ay !== undefined) {
            effects.spawn(createSpriteAnim({
              sheet: effectSprites.attack,
              anchorX: ax, anchorY: ay,
              startTime: this.time,
              totalDurationMs: ATTACK_DURATION_MS,
              scale: 0.5,
              alpha: 0.5,
            }));
          }
          break;
        }
        case WireEventType.HarvestYield: {
          const harvester = entities.get(event.harvesterId);
          const target = event.targetId === 0xFFFF ? undefined : entities.get(event.targetId);
          const ax = target && harvester
            ? (harvester.visualX + target.visualX) / 2
            : harvester?.visualX;
          const ay = target && harvester
            ? (harvester.visualY + target.visualY) / 2
            : harvester?.visualY;
          if (ax !== undefined && ay !== undefined) {
            effects.spawn(createSpriteAnim({
              sheet: effectSprites.harvestCraft,
              anchorX: ax, anchorY: ay,
              startTime: this.time,
              totalDurationMs: HARVEST_CRAFT_DURATION_MS,
              scale: 0.5,
              alpha: 0.5,
            }));
          }
          break;
        }
        case WireEventType.CraftComplete: {
          const crafter = entities.get(event.crafterId);
          if (crafter) {
            effects.spawn(createSpriteAnim({
              sheet: effectSprites.harvestCraft,
              anchorX: crafter.visualX,
              anchorY: crafter.visualY,
              startTime: this.time,
              totalDurationMs: HARVEST_CRAFT_DURATION_MS,
              scale: 0.5,
              alpha: 0.5,
            }));
          }
          break;
        }
        case WireEventType.EntityDied:
          effects.spawn(createSmokePuff(effectSprites, event.tileX, event.tileY, this.time));
          break;
        case WireEventType.PlayerHealed: {
          // Anchor on the live entity when possible so the puff follows a
          // moving target; fall back to the event tile if the entity row
          // hasn't arrived yet (race across channels). The sprite-anim is
          // lifted by `footY/2 - TILE_H/2` (render-pixel space) so it
          // centers on the middle of the sprite body rather than the tile
          // — tall sprites like the 92-px player get the puff on their
          // torso, short creatures get it just above tile center.
          const target = entities.get(event.entityId);
          const ax = target?.visualX ?? event.tileX;
          const ay = target?.visualY ?? event.tileY;
          const footY = target?.spriteSheet?.footY ?? 0;
          const screenOffsetY = footY > 0 ? footY / 2 - TILE_H / 2 : 0;
          effects.spawn(createSpriteAnim({
            sheet: effectSprites.healing,
            anchorX: ax,
            anchorY: ay,
            startTime: this.time,
            totalDurationMs: HEALING_DURATION_MS,
            frameSequence: HEALING_FRAME_SEQUENCE,
            followEntityId: target ? event.entityId : undefined,
            screenOffsetY,
          }));
          break;
        }
      }
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
      // Eviction step: if the interest center moved into a new chunk, drop
      // anything outside the interest radius. Player position takes
      // precedence; in observer mode we fall back to observerFocus.
      let pcx: number | null = null;
      let pcy: number | null = null;
      if (this.myEntityId !== null) {
        const me = entities.get(this.myEntityId);
        if (me?.position) {
          pcx = Math.floor(me.position.tileX / CHUNK_SIZE);
          pcy = Math.floor(me.position.tileY / CHUNK_SIZE);
        }
      } else if (this.observerFocus) {
        pcx = Math.floor(this.observerFocus.tileX / CHUNK_SIZE);
        pcy = Math.floor(this.observerFocus.tileY / CHUNK_SIZE);
      }
      if (pcx !== null && pcy !== null) {
        if (!lastEvictionChunk || lastEvictionChunk.cx !== pcx || lastEvictionChunk.cy !== pcy) {
          evictOutOfRange(pcx, pcy);
          lastEvictionChunk = { cx: pcx, cy: pcy };
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
          // Only rebuild chunks that are in-interest. lastEvictionChunk is
          // set whenever we have an interest center (player position OR
          // observer focus); when null no eviction has happened and all
          // received chunks are valid.
          if (lastEvictionChunk) {
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
