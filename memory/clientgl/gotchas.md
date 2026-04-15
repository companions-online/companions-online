# WebGL Client Gotchas

Non-obvious things worth knowing before you edit, in no particular order.

## No client-side world-gen

`client-webgl/` does not import `generateWorld`, `buildElevationGrid`
(full-map), or any world-gen function. Tiles arrive via `chunk`
messages; entities via `entityFullState`. If you find yourself
wanting to seed tiles client-side, you're going the wrong way.

## Camera doesn't fall back to "first entity"

Earlier iterations followed the first entity in iteration order when
`myEntityId` wasn't resolvable — that caused the camera to briefly
snap to a random tree during the welcome → full-state window. Gone.
Camera stays at `(SPAWN_X, SPAWN_Y)` until `scene.entities.get(scene.myEntityId)`
resolves. Brief blank frames at boot are expected.

## TerrainRenderer does full buffer replace, not sub-data

`uploadInstances()` calls `gl.bufferData` — not `bufferSubData` into
slot offsets. Reasoning: chunk changes are infrequent (initial stream
+ tile deltas), eviction is rare, and full-replace keeps the slot-
management code out of the renderer. The scene concatenates
`chunkTerrainData` values into one big buffer per rebuild. If this
ever becomes a hot path, sub-data into dense-packed slots + swap-
with-last eviction is the next step; the infrastructure is set up to
support it (chunk keys, dirty tracking).

## Diagonal interp is not sqrt(2)-compensated

Server movement uses alternating diagonal cooldown so diagonals take
~1.414× the time of cardinals. Client lerps at uniform `1/speed`
seconds per tile regardless of direction → visuals run ~30 % fast on
diagonals. Flagged in `creature-entity.ts`; acceptable for now.

## Door facing at draw time, not at create time

`static-entity.ts`'s door draw path looks at `worldMap.getBuilding(tx, ty±1)`
every frame — facing is whatever the current wall neighbors say. No
explicit invalidation is needed when a neighbor chunk streams in or
a wall is placed; the next draw just picks up the new facing.

Perf cost: 2 map reads per door per frame. Doors are rare.

## SpriteSheetRef.isFallback is load-bearing

Creatures (player, deer, wolf, bear, …) with no manifest entry
resolve to the unknown-entity sheet. Without the `isFallback` branch
in `drawCreatureSprite`, the walk-cycle math indexes `col = 1 + walkFrame`
and `row = (dir + 1) % 8` into a single-frame sheet — GL texture
clamping shows the right-edge pixel column stretched across the
frame. Ugly. The `isFallback` branch falls through to a full-sheet
single-frame blit. Both factories respect the flag.

## Per-tile sync vs bend-only

Server currently writes `position` to the dirty-tracked component
store every tile (`server/src/systems/movement.ts:116`). Client lerps
between adjacent tiles — correct but granular. The deferred
optimization (`docs/plans/bend-only-waypoints.md`) changes the server
to emit only at direction changes, with `nextWaypoint` as the bend.
**The client lerp code is already forward-compatible** — the only
change needed is the server side. Don't write client fixes
anticipating bend-only; it already handles it.

## Chunk capacity throws

`scene.uploadTerrain()` throws
`"chunk capacity exceeded: N > CHUNK_CAPACITY. Eviction broken?"` on
overflow. That's intentional — it means eviction isn't keeping up,
which is a logic bug, not a data bug. Don't "fix" by raising the
capacity; find why eviction didn't run.

`CHUNK_CAPACITY` is derived from `INTEREST_RANGE` / `CHUNK_SIZE` in
shared constants. If those change, capacity auto-adjusts.

## `scene.time` is set by the renderer

Each RAF tick: `scene.time = now` at the top of `frame()`. Interp
tick reads it. Tests drive it manually by setting `scene.time = N`
before calling `e.tick(e, dt, scene)`. The `dt` argument is for
animation timing (walk frame); the lerp uses `scene.time -
checkpointMs` directly, not `dt`.

## Scene is injected, not globally wired

`main.ts` is the only place that calls the real `connect()`,
`loadSpriteRegistry()`, `loadStaticAssets()`. `createScene` accepts
`CreateSceneOptions.spriteRegistry` and
`CreateSceneOptions.staticAssets` for tests. Don't add module-level
globals to the client — they break test injection.

## Inventory is replaced entirely on each sync

`scene.onInventorySync(items)` does `this.inventory = items`. Server
sends the full list every time (small, ≤ few dozen items). No delta
diffing on the client. Corollary: don't hold references to old
inventory items across syncs.

## Door `statusEffects` vs ground-item detection

`buildCursorContext` treats an entity without `statusEffects` as a
ground item (because ground items from Drop have only
`position + blueprintId`). Doors, chests, campfires always carry
`statusEffects` (even if `effects: 0`) so they're not ground items.
Careful if you add a new placeable type — remember to emit
`statusEffects` on the server side.

## Debug hooks in main.ts

`window.__scene` and `window.__conn` are wired in `main.ts` at the
end. Puppeteer probes + devtools depend on them. If you refactor
`main.ts`, keep the debug hooks — they're how headless tests
inspect live state.

## The CLI is the reference client

When in doubt about what a client should do with a server message,
read `cli/`. It's feature-complete (it has the UI the webgl client
lacks). Same decoded message types, same shared resolveAction, same
inventory semantics.
