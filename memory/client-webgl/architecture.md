# WebGL Client Architecture

## Scene as a passive container

`Scene` (client-webgl/src/scene.ts) holds every piece of replicated
state: `worldMap`, `entities`, `wallDrawablesByChunk`, `inventory`,
`overlay` (modal UI state — see Overlay below), `chatLog`,
`myEntityId`, `seed`, plus observer-mode fields (`observerFocus`,
`observerCamera`). No piece of scene state is generated or simulated
locally; every mutator is an `on*()` method invoked by
`wire-scene.ts` (networked path) or `StandaloneConnection`
(in-tab path) when a server callback fires.

Boot produces an empty scene: empty entity map, empty worldMap
(`new WorldMap(MAP_SIZE, MAP_SIZE)`), zero-initialized terrain/wall
state, camera at `(SPAWN_X, SPAWN_Y)`. The scene does not follow
`loadSpriteRegistry`/`loadStaticAssets` itself from tests —
`createSceneOptions` accepts pre-built alternates so tests can inject
stubs (see [testing.md](testing.md)).

## Network path

Two transports share one `Connection` interface (`onMessage`, `send`,
`close`, `isOpen`); `main.ts` picks at boot based on whether
`window.GAME_SERVER_HOST` was injected by the served HTML.

**Networked (`network/connection.ts`)** — the served HTML
(`index.html`) sets `window.GAME_SERVER_HOST = window.location.host`,
so `main.ts` calls `connect()`:
- Opens `ws://${location.host}/ws`, `binaryType = 'arraybuffer'`.
- Decodes inbound via shared `decodeServerMessage`, encodes outbound
  via `encodeAction`.
- Latency emulator: `?latency=N` query param wraps `setTimeout(..., N)`
  around both inbound delivery and outbound send. Symmetric; clamped
  to `[0, 2000]`.
- Queues outbound sends before socket open; flushes on open.

**Standalone (`network/standalone-connection.ts`)** — `index-standalone.html`
omits `GAME_SERVER_HOST`, so `main.ts` calls `bootStandaloneObserver(scene, seed)`:
- Spins up `createDefaultWorld(seed)` + `GameLoop` in the same browser tab.
- Registers a `StandaloneObserverConnection` (PlayerConnection peer of
  the WS connection) that forwards GameWorld callbacks straight into
  `scene.on*()` — no codec round-trip, no WebSocket.
- Adds an observer (not a player), starts the autopilot camera. See
  [observer mode](#observer-mode) below.
- `bootStandalone(scene, seed)` (player path, sibling factory) is
  available for future menu integration; not used today.

`wire-scene.ts` is the WS-only switch routing decoded messages into
`scene.on*()` mutators. Used by `main.ts` in networked mode and by
tests with `FakeConnection`. The standalone bridge bypasses it
entirely (its `onMessage` is a no-op; PlayerConnection callbacks call
scene mutators directly).

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
3. If anything changed, concat all `chunkTerrainData` values into four
   big buffers (base / overlay / side / top) and call
   `terrainRenderer.uploadInstances()`.

### Upload strategy

`TerrainRenderer.uploadInstances(baseData, baseCount, overlayData,
overlayCount, sideData, sideCount, topData, topCount)` is
**full-replace** (`bufferData`, not `bufferSubData`). Chunk changes
are infrequent enough (initial stream + tile deltas) that
rebuild-on-any-change is simpler than tracking dense-packed slot
offsets.

### Four-pass draw order

`TerrainRenderer.render()` runs four sub-passes per frame:
1. **Base** — one quad per tile (including floor tiles at lifted
   top-diamond corners). Opaque.
2. **Overlay** — neighbor-bleed blendomatic overlays onto lower-
   priority centers. `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`.
3. **Floor top-redraw** — one quad per floor tile, same lifted corners
   as the base, drawn with the base program. Overdraws any neighbor
   overlay that tilted into the floor's screen-Y band (e.g. water-on-
   grass bleeding into a bridged river slab). Opaque.
4. **Side** — floor SE/SW side quads via a dedicated side program
   (rectangular UVs, `SIDE_SHADE` darkening). Opaque.

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
`plans/plans/bend-only-waypoints.md` lands, `position` becomes the
leg-start and `nextWaypoint` the bend, and the same lerp code covers
multi-tile straight runs. No client edit needed.

**Known limitation:** diagonal moves aren't sqrt(2)-compensated on
the client, so visuals run ~30 % fast on diagonals. Flagged in
creature-entity.ts; revisit if it looks bad.

## Controls

`controls/mouse.ts`:
1. `canvas.mousedown` → `camera.tileAt(cx, cy)` for world tile.
2. `buildCursorContext(scene, tx, ty)` (`controls/cursor-context.ts`)
   — calls `worldMap.isWalkable(tx, ty)` (the shared predicate) for walkability,
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

## Lighting

Runs as a third concern alongside terrain and sprite rendering. Each
frame the renderer:

1. Calls `scene.lighting.update(playerTile, entities, worldMap, now)`
   which rebuilds a `80×80` RGB8 lightmap texture on the CPU and
   uploads it via `texSubImage2D`.
2. Passes the lightmap texture + origin + size to
   `terrainRenderer.render()` for the base + overlay passes.
3. Passes the same binding to `spriteRenderer.begin()` for the
   Y-sorted sprite pass (entities + walls). Each draw uses
   `setSpriteTile(tileX, tileY)` so the FS samples the lightmap at the
   sprite's foot.
4. Calls `spriteRenderer.begin(resolution)` WITHOUT the lightmap for
   the effects pass — `u_lit = 0`, UI stays bright.

Lightmap composition (`LightingManager.update`):
- Fill with ambient RGB from `ambientTint(gameMinute)` —
  `shared/src/lighting.ts` keyframes (deep-night / mid-sunrise / day /
  mid-sunset).
- Build blocker set from non-walkable tiles + collides-entities
  (closed doors exclude themselves via `StatusEffect.Open`).
- For each entity with `blueprint.lightRadius > 0`: `shadowcast(...)`
  adds `color * (1 - distSq/r²)` to visited tiles. `Uint8ClampedArray`
  handles saturation.

`gameMinute` advances locally between server syncs. On
`EnvironmentSync` (welcome + forced resyncs + keyframe-hour crossings)
the client stamps `baseGameMinute = received` at `performance.now()`
and extrapolates with `elapsed / REAL_MS_PER_GAME_MINUTE`.

See [lighting.md](lighting.md) for the full pipeline.

## Game events channel

Runs parallel to `WorldDelta` — a separate `ServerOpcode.GameEvents`
message carries discrete notifications (hit landed, yield popped, entity
died, craft complete). State vs notification split: `WorldDelta` answers
"what is true now" (replayable), `GameEvents` answers "what just
happened" (ephemeral).

`wire-scene.ts` routes each decoded event to `scene.onGameEvent(event,
tick)`, which spawns short-lived `createSpriteAnim` effects:

- `CombatHitDealt` → `attack-anim` at midpoint between attacker and
  target (attacker-only on killing hits — target already removed by the
  preceding WorldDelta). `scale: 0.5, alpha: 0.5`, 280ms.
- `HarvestYield` → `harvest-craft-anim` at harvester↔target midpoint
  (harvester-only when `targetId === 0xFFFF`). Same scale/alpha, 420ms.
- `CraftComplete` → `harvest-craft-anim` at crafter's tile, 420ms.
- `EntityDied` → smoke puff at `event.tileX, event.tileY`. Frame
  sequence `[3,2,1,0,1,2,3,4,5,6,7,8]` (build from intensity 6 to peak
  9 at sheet index 0, then fade to 1 at sheet index 8). 660ms.
- `PlayerHealed` → `healing-anim` (3×3 sheet, 9 frames played in order)
  at the healed entity's `visualX/Y`. 720ms. Follows the entity via
  `followEntityId` so the puff tracks movement during / after the heal.
  Lifted by `screenOffsetY = footY/2 - TILE_H/2` so tall sprites (player
  footY≈82 → +25 px) center the puff on the character's torso rather
  than at the tile line; short sprites sit just above tile center.

Events are a subset of the server's `GameEventType` union —
MCP-only events (`trade_complete`, `action_interrupted`, etc.) do not
cross the wire. The mapping lives in `server/src/connections/ws-connection.ts::WIRE_EVENT_MAP`.

## Death visuals

Two client-observable triggers — they cover both removal-based death
(creatures/NPCs are destroyed and disappear from entity updates) and
persistence-based death (player entities stay alive with
`currentAction = Dead` while awaiting respawn).

1. **`EntityDied` wire event** → smoke puff at the event's tile. The
   server broadcasts this via `broadcastEvent` to all players within
   `INTEREST_RANGE` of the death position, so spectators see the puff
   for any creature kill.
2. **`currentAction → Dead` transition** detected in `scene.onEntityUpdate`
   by snapshotting `existing.currentAction?.actionType` before
   `applyComponentsToEntity`. Spawns a smoke puff at the entity's
   current `visualX/Y`. Covers player death.

While `currentAction === Dead`, `creature-entity.draw` early-returns so
the dead sprite stays hidden. Respawn is handled by the snap path in
`applyComponentsToEntity`: when the previous `currentAction` was Dead
and a new `position` arrives, `lerpFromX/Y` are set to the new tile
(not the old visual position) so the next tick computes `t=1`
immediately — player teleports to spawn instead of sliding across the
map.

## HP bar + nameplate overlays

`renderer.ts::drawEntityOverlays` runs a single unlit sprite pass
before the effects pass. Iterates `scene.entities`, draws:

- **HP bar** for any `creature | npc` (including the local player) with
  `currentHp < maxHp` and not Dead. Solid 1×1 background texture (dark
  red) stretched to `24×3px`, foreground (bright red) at `24*ratio×3px`.
- **Nameplate** for any named entity except the local player (from
  `scene.entityMeta` via `MetaKey.Name`).

Positioning derives from the entity's sprite sheet — `entitySpriteTopY`
replicates `creature-entity.draw`'s foot math (`screenY +
TILE_H/2 - sheet.footY - z*PX_PER_Z`). HP bar sits `OVERLAY_GAP=4px`
above the sprite top; nameplate stacks another `HP_BAR_H + OVERLAY_GAP`
above that. A 128px player and a 32px deer get consistent overhead
overlays without a sprite-specific offset.

## Overlay

Modal UI state lives in a single discriminated union, not parallel
flags:

```ts
scene.overlay: Overlay =
  | { kind: 'none' }
  | { kind: 'inventory' }
  | { kind: 'container'; entityId: number; items: SyncedInventoryItem[] }
  | { kind: 'dialogue';  npcId: number; dialogue: unknown }
  | { kind: 'menu';      screen: 'landing' | 'create-join'
                                | 'connecting' | 'connect-error' }
  | { kind: 'menu';      screen: 'settings'; context: 'main-menu' | 'in-game' }
```

Helpers in `overlay.ts`:
- `isInventoryShowing(o)` — `'inventory'` or `'container'`. Both kinds
  draw the inventory panel; container pins items to the right column.
- `isInputCaptured(o)` — `o.kind !== 'none'`. Gates world clicks/keys.
- `getContainer(o)` — narrow to container variant data.

Container/dialogue data lives inside the variant — closing an overlay
drops its data atomically (the prior `containerEntityId` /
`containerItems` parallel fields used to leave stale items lingering).
The `'menu'` variant is reserved for the upcoming main menu work; no
code reads it yet.

Out of scope: chat-input focus (`keyboard.chatActive`) and placement
mode (`scene.placementHoverTile`) stay as their own fields — they're
input-routing modes, not modal screens.

## Observer mode

The renderer / lighting / chunk eviction support a "no player entity"
path used by the standalone build's background world. When
`scene.myEntityId === null`:

- Camera follow falls back to `scene.observerFocus: {tileX, tileY}` (float tile coords, mirror of `visualX/visualY`).
- Chunk eviction keys off the same focus tile.
- Lighting center uses the focus tile (or 0,0 if neither set).
- HP bars + nameplates draw normally; the "skip self" check is keyed on
  `myEntityId`, which is null, so nothing is skipped.

The autopilot in `controls/observer-camera.ts` advances `observerFocus`
(float tile coords) along an 8-direction random walk (3-5s segments,
edge-buffer biases turns inward) and pushes `setObserverFocus(tileX,
tileY)` to the server only when the rounded tile changes. The renderer ticks the
autopilot via `scene.observerCamera?.tick(now)` once per frame.

`onWelcome(0, seed)` (entityId 0 = observer sentinel) keeps
`myEntityId` null — `scene.ts` reads the sentinel and falls through.

Server-side observer concept lives in `memory/reference/architecture.md::Observer Mode`.

## What doesn't live here (yet)

- **HUD / inventory UI / status bar / dialogue UI / cursor hover.**
  All the data is in `scene.*`; only the UI layer is missing. When it
  lands, `ui/hud.ts` is the extension point.
- **Reconnection / session resume.** The socket closes and the page
  has no recovery path — the user must reload.
- **Interest-range chunk filtering on the server.** Server currently
  sends all entities; only chunk streaming is range-gated. Not a
  client concern, but affects load-testing.
