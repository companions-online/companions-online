# WebGL Client Architecture

## Scene as a passive container

`Scene` (client-webgl/src/scene.ts) holds every piece of replicated
state: `worldMap`, `entities`, `wallDrawablesByChunk`, `inventory`,
`containerEntityId/Items`, `dialogueNpcId/dialogue`, `chatLog`,
`myEntityId`, `seed`. No piece of scene state is generated or simulated
locally; every mutator is an `on*()` method invoked by
`wire-scene.ts` when a server message arrives.

Boot produces an empty scene: empty entity map, empty worldMap
(`new WorldMap(MAP_SIZE, MAP_SIZE)`), zero-initialized terrain/wall
state, camera at `(SPAWN_X, SPAWN_Y)`. The scene does not follow
`loadSpriteRegistry`/`loadStaticAssets` itself from tests —
`createSceneOptions` accepts pre-built alternates so tests can inject
stubs (see [testing.md](testing.md)).

## Network path

`connection.ts`:
- Opens `ws://${location.host}/ws`, `binaryType = 'arraybuffer'`.
- Decodes inbound via shared `decodeServerMessage`, encodes outbound
  via `encodeAction`.
- Exposes a tiny `Connection` interface: `onMessage(handler)`,
  `send(action)`, `close()`, `isOpen`.
- Latency emulator: `?latency=N` query param wraps `setTimeout(..., N)`
  around both inbound delivery and outbound send. Symmetric; clamped
  to `[0, 2000]`.
- Queues outbound sends before socket open; flushes on open.

`wire-scene.ts` does one thing: a switch on message type routing each
decoded message into the matching `scene.on*()` mutator. Used by both
`main.ts` (against the real `Connection`) and tests (against
`FakeConnection`).

## Chunk-sparse rendering

The headline architectural piece. Terrain, elevation, and wall
drawables are all chunk-keyed, and the working set is bounded by the
player's interest range — **not by map size**. A 10 000×10 000 server
world uses the same GPU memory as a 128×128 one.

### Capacity

```ts
INTEREST_RADIUS_CHUNKS = ceil(INTEREST_RANGE / CHUNK_SIZE) + 1   // +1 for JIT overlap
PEAK_CONCURRENT_CHUNKS = (2 * INTEREST_RADIUS_CHUNKS + 1) ** 2
CHUNK_CAPACITY         = PEAK_CONCURRENT_CHUNKS + 4              // small margin
```

Current constants: `INTEREST_RANGE=32`, `CHUNK_SIZE=16` → radius 3,
peak 49, capacity **53**. See `scene.ts:46-49`.

Over-capacity is a **bug**, not a data issue. `uploadTerrain()` throws
when it sees `chunkTerrainData.size > CHUNK_CAPACITY` — that means
eviction is broken.

### Dirty + rebuild

`scene.ts` maintains `dirtyChunks: Set<chunkKey>`. `onChunk` and
`onTileUpdate` mark the affected chunk + 4 cardinal neighbors dirty
(wall shapes depend on adjacency across chunk seams).

`processDirtyChunks()` runs at the start of each frame via
`renderer.ts`:
1. Eviction sweep — when the player's containing chunk changes, drop
   any chunk outside `INTEREST_RADIUS_CHUNKS`. Only re-runs when the
   player chunk actually changes, not every frame.
2. For each dirty chunk still in-interest: rebuild elevation →
   build terrain instances + wall drawables.
3. If anything changed, concat all `chunkTerrainData` values into two
   big buffers and call `terrainRenderer.uploadInstances()`.

### Upload strategy

`TerrainRenderer.uploadInstances(baseData, baseCount, overlayData,
overlayCount)` is **full-replace** (`bufferData`, not `bufferSubData`).
Chunk changes are infrequent enough (initial stream + tile deltas)
that rebuild-on-any-change is simpler than tracking dense-packed slot
offsets. One draw call for base, one for overlays.

The render-side side of this is `renderer.ts` — drain dirty chunks →
`terrainRenderer.render` → flatten `wallDrawablesByChunk.values()`
into the Y-sort list alongside entities → sort → draw.

## Entity factories

`from-network.ts` dispatches on blueprint category:

- `creature | npc` → `createCreatureEntity` — 8-dir walk-cycle sheet,
  lerp tick, animation advances while `currentAction === Walking`.
- `placeable | item | resource | (default)` → `createStaticEntity` —
  single-frame draw. Doors branch on `blueprint.blueprintId ===
  WoodenDoor`: facing is recomputed **at draw time** from worldMap
  neighbors; open/closed column from `statusEffects.Open` bit.

Blueprints with no sprite manifest entry resolve to the
`unknown-entity.png` fallback sheet (`sprite-registry.ts`). That
sheet has `isFallback: true` on its `SpriteSheetRef`; creature draw
special-cases it to a single-frame blit instead of indexing into a
non-existent walk grid.

Every factory initializes `visualX/Y` to `position`, leaves lerpFrom
fields undefined. The tick's `?? targetX/Y` fallback produces `t=1`
on the first frame — effectively "snap to position on arrival".

## Interpolation

Lives in two places:

1. `applyComponentsToEntity(e, next, checkpointMs)` in
   `from-network.ts` — on every delta that changed `position`,
   snapshot current `visualX/Y` → `lerpFromX/Y` and record
   `checkpointMs`.
2. `creature-entity.ts` tick — lerp `visualX/Y` from `(lerpFromX,Y)`
   toward `position.tileX/Y` over `1000 / blueprint.speed` ms
   (clamped `[0, 1]`).

`scene.time` is set by the renderer each frame (to the RAF timestamp).
Tests drive it manually.

**Forward-compatible with bend-only waypoints.** Current server sync
is per-tile; client lerps between adjacent tiles each server tick.
When the server deferred optimization in
`docs/plans/bend-only-waypoints.md` lands, `position` becomes the
leg-start and `nextWaypoint` the bend, and the same lerp code covers
multi-tile straight runs. No client edit needed.

**Known limitation:** diagonal moves aren't sqrt(2)-compensated on
the client, so visuals run ~30 % fast on diagonals. Flagged in
creature-entity.ts; revisit if it looks bad.

## Controls

`controls/mouse.ts`:
1. `canvas.mousedown` → `camera.tileAt(cx, cy)` for world tile.
2. `buildCursorContext(scene, tx, ty)` (`controls/cursor-context.ts`)
   — reads `worldMap.getTerrain/getBuilding` for walkability,
   iterates `scene.entities` for entity-at-tile (skipping self),
   reads `scene.inventory.find(i => i.equippedSlot === 1)` for hand
   item.
3. Shared `resolveAction(ctx)` picks the action (MoveTo / Harvest /
   Attack / Interact / Pickup / null).
4. `applyTurnPrediction` — on MoveTo, computes 8-way direction from
   player tile to target via `DX/DY` lookup and writes
   `me.direction = { dir }` immediately. The next server delta
   overwrites it correctly.
5. `connection.send(action)`.

Same shared `resolveAction` the CLI uses. Inventory-equipped-hand
check lets fishing-rod clicks on water resolve to Harvest.

## Static asset boot

`createScene()` does one-shot work at boot:
- `generateRawTerrainTiles()` + `buildTerrainTextureArray` — procedural
  tile textures uploaded to a texture array.
- `generateBlendMasks()` + `buildMaskTextureArray` — blendomatic masks.
- `generateWallTextures(gl)` — procedural wall faces.
- `loadSpriteRegistry(gl)` — loads every PNG in the manifest + the
  fallback at boot (Promise.all).

All four are pure CPU + one GL upload each. No worldMap dependency —
they're render-time constants.

Factored into `loadStaticAssets(gl)` so tests can inject stubs via
`CreateSceneOptions.staticAssets`. Sprite registry is also
injectable via `CreateSceneOptions.spriteRegistry`.

## Debug hooks

`main.ts` assigns `window.__scene = scene` and `window.__conn = conn`.
Puppeteer probes + devtools console use these. Left in place during
development.

## What doesn't live here (yet)

- **HUD / inventory UI / status bar / dialogue UI / cursor hover.**
  All the data is in `scene.*`; only the UI layer is missing. When it
  lands, `ui/hud.ts` is the extension point.
- **Reconnection / session resume.** The socket closes and the page
  has no recovery path — the user must reload.
- **Interest-range chunk filtering on the server.** Server currently
  sends all entities; only chunk streaming is range-gated. Not a
  client concern, but affects load-testing.
