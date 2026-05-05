# WebGL Client ↔ Server Network Integration

Wire `client-webgl/` up to the existing authoritative server, matching the
patterns already proven in `cli/`. Drop all client-side world-gen and
local entity simulation; make the client a pure renderer of server state,
with client-side interpolation for smooth visuals.

## Architectural decisions

- **No client world-gen.** Terrain, buildings, entity spawns all flow
  from the server via `chunk` / `worldDelta` / `entityFullState`
  messages. `generateWorld` is not called on the client.
- **Authoritative state + client interpolation.** Network is the source
  of truth for `position`, `nextWaypoint`, `direction`, `statusEffects`,
  etc. Client maintains its own `visualX/visualY` (fractional) and lerps
  toward the next waypoint at the blueprint's `speed`.
- **Per-tile sync for now.** The bend-only-waypoint optimization is
  [deferred](./bend-only-waypoints.md). Client interp is designed for
  bend-only but works correctly under per-tile sync — it just
  re-checkpoints every tile.
- **Camera bootstrap.** Camera starts at `(SPAWN_X, SPAWN_Y)` and does
  not move until `welcome.entityId` arrives and that entity has a
  position. No loading spinner; world fills in as chunks stream.
- **Local turn prediction.** On click resolving to `MoveTo`, immediately
  face the player entity toward the target tile (update `direction`
  locally). Server's first checkpoint will clobber it, which is fine.
  No visual position prediction — server decides where we are.
- **Blueprint variant merged into the BlueprintId component.** One
  source of truth; see Phase 1.
- **Per-chunk regeneration + seam.** On chunk arrival or building
  tile-delta, regenerate the affected chunk's elevation slice, terrain
  instance slice, and wall drawables — plus a 1-tile seam into each
  neighbor chunk (since wall shape depends on adjacency). Not a
  full-map rebuild.
- **Unknown-entity fallback.** Any blueprint without a sprite manifest
  entry resolves to a procedurally generated blue isometric diamond so
  network entity arrival never crashes the render.
- **No HUD/inventory/status-bar/hover UI this round.** Just get render
  + controls onto the network.
- **Latency emulator lives in `connection.ts`.** Not a separate
  abstraction — the single connection file wraps `setTimeout` around
  inbound and outbound bytes when enabled by a URL param.

## Phases

Each phase is intended as a shippable milestone that leaves `master`
in a coherent state.

### Phase 1 — Shared: variant component + seed in Welcome

Tightly-coupled shared-type edits. Land as one commit.

- `shared/src/blueprints.ts`: add `variantCount?: number` to `Blueprint`.
  Set `Tree.variantCount = 3`, everything else `1` (explicit or
  default-to-1). This is the single source of truth for "how many
  variants does this blueprint have"; server uses it at spawn time,
  client cross-checks at manifest-load time.
- `shared/src/components.ts`: the component data is now named
  `BlueprintData` (was `BlueprintIdData`) with shape
  `{ blueprintId: number; variant: number }`. The `ComponentBit` member
  is `Blueprint`; the `EntityManager` store and the decoded
  `EntityComponents` field are both named `blueprint`.
- `shared/src/protocol/codec.ts`: encode/decode one extra `u8` for
  variant in the BlueprintId component body.
- `shared/src/protocol/opcodes.ts` + codec: extend Welcome to carry
  `seed: u32` after `entityId`.
- Update all call sites that construct BlueprintId (server worldgen,
  spawn helpers, tests, CLI unpacking) to include `variant`. Default
  to `0`.

Deliverable: tests green, CLI still works unchanged except for the new
fields flowing through.

### Phase 2 — Server: assign variants + emit seed

- Worldgen: where entities are created (trees, creatures, NPCs), if
  `variantCount > 1`, pick a deterministic variant based on
  `(entityId + seed)` or a cheap hash. Trees get 0/1/2; everything
  else 0 until it has more sprites.
- `WsConnection.onInitialState`: include the world's seed in the
  Welcome packet.
- `GameWorld` exposes its seed (it must already be stored somewhere
  for regen; if not, thread it through).

Deliverable: CLI ignores seed (stays working); variant field flows on
wire and is visible in `entityFullState`/`worldDelta`.

### Phase 3 — Client: connection + latency emulator

New files, no scene changes yet. Client still runs its local demo.

- `client-webgl/src/network/connection.ts`:
  - Opens `ws://${host}/ws`, `binaryType = 'arraybuffer'`.
  - Decodes incoming messages via `decodeServerMessage`.
  - Exposes `send(action: DecodedAction)` → `encodeAction`.
  - Dispatches decoded messages to a handler registered by the scene.
  - Optional latency emulator: reads `?latency=N` from the page URL;
    wraps `setTimeout(..., N)` around both inbound dispatch and
    outbound send. Symmetric so round-trip is `2N`.
- A standalone sanity harness (or a dev console log path) that
  verifies welcome + chunks + a few entity updates decode correctly
  before wiring into the scene.

Deliverable: `connection.ts` lands + is exercised; scene is unchanged.

### Phase 4 — Client: sprite manifest alignment + unknown fallback

- `client-webgl/src/entities/sprite-manifest.ts`: replace placeholder
  blueprint constants with imports from `BlueprintType` (Player=0,
  Deer=1, Tree=80, WoodenDoor=72). Drop the local `variantCount`
  field on entries — read it from `getBlueprint(id).variantCount`;
  assert match at load.
- `sprite-registry.ts`: at boot, generate a 64×64 canvas blue
  isometric diamond and upload as a texture. `resolve(bpId, variant)`
  returns it when no manifest entry exists or the variant is out of
  range, rather than throwing.
- Local scene still runs — this phase is a no-op at render time
  except the fallback path is exercised by a deliberate test spawn.

Deliverable: render still works with current local entities; any
unknown blueprint renders as a blue diamond.

### Phase 5 — Client: scene gutted, network-driven entities

This is the big one. After this phase, the client boots into an empty
world and fills in from the server.

- `client-webgl/src/scene.ts`:
  - `createScene(gl)` — no seed parameter. World map starts empty
    (all `Terrain.Grass` sentinel or similar). `entities` map empty.
    `wallDrawables` empty. Camera at `(SPAWN_X, SPAWN_Y)`.
  - Remove `generateWorld`, `buildElevationGrid` (full-map),
    `buildTerrainInstances` (full-map), `buildWallDrawables`
    (full-map), and all `spawn*` calls.
  - Expose `applyWelcome`, `applyChunk`, `applyEntityFull`,
    `applyEntityUpdate`, `applyEntityRemoval`, `applyTileUpdate` —
    mutators called by `connection.ts`.
- Collapse per-type entity files into two factories:
  - `entities/creature-entity.ts` (categories `creature` + `npc`):
    walk-cycle animation, directional sprite rows, interp toward
    nextWaypoint.
  - `entities/static-entity.ts` (categories `placeable` + `item` +
    `resource`): single frame, `statusEffects.Open` bit selects
    door frame column.
  - `entities/from-network.ts`: dispatches to the right factory
    based on the blueprint category, falls back to unknown sprite
    for missing manifest.
- Delete `player.ts`, `deer.ts`, `tree.ts`, `door.ts` (merged into
  the factories above; door facing detection moves to the static
  factory reading worldMap neighbors).
- `main.ts`: `createScene(gl)` → connect via `connection.ts` → start
  renderer. Controls attachment waits for `myEntityId` to be set.

Deliverable: client connects, renders whatever the server sends.
Terrain/walls still missing visuals because Phase 6 hasn't landed —
entities float on a blank backdrop. Movement is snap-to-tile (no
interp yet — Phase 7).

### Phase 6 — Client: per-chunk terrain + elevation + walls

With `seed` from welcome, regenerate the visual layers incrementally
as chunks arrive or tile deltas mutate buildings.

- Track `worldMap` as a live Uint8Array-backed grid populated from
  chunk / tile-delta messages.
- Elevation: per-chunk regeneration function that computes elevation
  for one 16×16 chunk using `seed` + that chunk's terrain/building
  data. Water-flattening and building-flatten points stay correct
  because they're local to the chunk.
- Terrain instances: keep the instance buffer in chunk-aligned
  slices. On chunk update, rebuild that slice and `bufferSubData`
  the affected range. `TerrainRenderer` gains an
  `updateChunk(cx, cy)` method.
- Wall drawables: stored as `Map<chunkKey, WallDrawable[]>`. On
  chunk change, rebuild entries for the changed chunk **plus** the
  1-tile seam into each of 4 neighbors (wall shape depends on
  adjacency). Updated drawables are merged into the render pass'
  Y-sort list each frame.
- Tile deltas (user placements at runtime): map the tile to its
  chunk, invoke the same per-chunk regen.

Deliverable: terrain and walls render correctly as the world streams
in; placing a wall at runtime updates visuals without a full rebuild.

### Phase 7 — Client: interpolation

With network entities and terrain both in place, smooth out movement.

- Every entity update from `worldDelta` with a changed `position` or
  `nextWaypoint`:
  - Snapshot current `visualX/visualY` → `lerpFromX/lerpFromY`.
  - Set `checkpointMs = scene.time`.
- In `creature-entity` tick:
  - Target tile is `nextWaypoint` if set and not WAYPOINT_NONE,
    else `position`.
  - `t = (now - checkpointMs) * speed / tileDistance(from, target)`
    clamped to `[0, 1]`.
  - `visualX = lerp(lerpFromX, targetX, t)`, same for Y.
  - Walk-cycle animation advances while `t < 1`; idle frame when
    arrived.
- Under current per-tile sync, the client re-checkpoints every tile
  and effectively lerps between adjacent tiles — correct but
  granular. When bend-only-waypoints ships, the same code seamlessly
  covers multi-tile straight runs.

Deliverable: entity movement looks smooth, not teleport-y, at
realistic latencies.

### Phase 8 — Client: action-resolver controls + turn prediction

- Port `buildCursorContext` logic from `cli/render.ts:11-47` into
  `client-webgl/src/controls/cursor-context.ts`. Same inputs
  (entities at tile, terrain, equipped hand item) sourced from
  `scene`.
- `controls/mouse.ts`: on canvas click
  → `tileAt(screenX, screenY)`
  → `buildCursorContext(tx, ty)`
  → `resolveAction(ctx)`
  → `connection.send(action)`.
- Drop `scene.toggleDoorAt` — doors now go through server via
  `Interact`, `statusEffects.Open` bit flips back in a delta.
- Local turn prediction for MoveTo: when a MoveTo is sent, compute
  the 8-way direction from player tile to target tile and assign
  `scene.entities[myEntityId].direction` immediately. Next server
  delta overwrites it, which is correct.
- Inventory is not yet held (Phase 9), so
  `ActionContext.equippedHandBlueprintId` stays `undefined` — fishing
  on water resolves to no-op until Phase 9.

Deliverable: clicking a tree harvests, clicking a deer attacks,
clicking a door interacts, clicking a tile moves. Networked and
authoritative.

### Phase 9 (optional, follow-up) — Inventory + misc sync

- Hold `inventory: SyncedInventoryItem[]` on scene; populate from
  `inventorySync` messages.
- Enables fishing-rod check in the action resolver.
- Also apply `containerOpen` / `dialogueOpen` / `chatMessage` to
  scene state (even without UI) so state is consistent — UI lands in
  a later pass.

Deliverable: the client holds enough state to drive a UI; visual UI
still out of scope.

## Out of scope for this pass

- HUD, status bar, cursor hover, inventory panel, chat UI, dialogue
  UI.
- Action prediction beyond the local turn facing.
- Bend-only waypoint sync on the server (see
  [bend-only-waypoints.md](./bend-only-waypoints.md)).
- Reconnection, session resume.
- Interest-range filtering improvements.

## Order of landing

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8, then optionally 9.

Phases 1–2 land first because everything downstream depends on the
shared type changes. Phase 3 can be developed in parallel with 4 but
lands after 2. Phases 5–7 are sequential (each depends on the prior).
Phase 8 needs 5 for entity data in the cursor context.
