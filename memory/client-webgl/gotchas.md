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
optimization (`plans/plans/bend-only-waypoints.md`) changes the server
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

## Ground-item detection uses `StatusEffect.Placed`, not component presence

`buildCursorContext`, `mouse.ts`, `renderer.ts` all call `isPlaced(statusEffects)` from `@shared/status-effects`. Ground items lack the `Placed` bit; doors/chests/campfires/trees placed by `handleUseItemAt` or worldgen carry it. Don't regress to `!e.statusEffects` — that presence-based check silently mis-classified worldgen resources (which had `{effects:0}` from `spawnCreatureEntity`) as structures, and mis-classified reloaded ground items the same way after a save/load cycle. If you add a new placeable blueprint, set `StatusEffect.Placed` wherever you spawn it.

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

## Lighting: wall-sprite face predicate uses Math.floor

`wall-texture.ts`'s `inLeftFace`/`inRightFace` use `Math.floor(topY)`.
Without it, the diamond predicate (`|.|/W + |.|/H <= 1` with +0.5
pixel-center offset) and the face predicate (raw float `topY`) disagree
at row 31 cols 31/33 — 1-px transparent holes that revealed lit floor
through the wall. Seams of warm light show up when a campfire is
nearby. `Math.floor` starts the face one row earlier so the regions
overlap.

## Lighting: entity draw paths must `setSpriteTile` before drawing

The sprite FS samples the lightmap at `u_spriteTileXY` — a per-draw
uniform. Every draw path in `creature-entity.ts`, `static-entity.ts`,
and `buildings/wall-sprites.ts` calls `sprites.setSpriteTile(tileX,
tileY)` immediately before `drawSprite()`. Forgetting leaves the
previous draw's tile coords in place.

## Lighting: effects pass stays unlit via no-lightmap begin()

`effects/effect.ts` calls `sprites.begin(resolution)` WITHOUT the
optional lightmap arg. That drops `u_lit` to 0 and the FS skips the
multiply. Damage numbers, chat bubbles, pickup text render at full
brightness regardless of ambient tint. Don't "fix" by passing the
lightmap — you'll dim the UI.

## Lighting: walls + collides-entities block light but are themselves lit

Blocker predicate: `!worldMap.isLightPassing(x,y) || blockers.has(tile)`
where blockers = entities with `blueprint.collides && !(statusEffects
& Open)`. A wall adjacent to a campfire: the line from fire to wall
has no intermediate tiles, so the wall IS visited and gets its full
tint. Walls BEHIND that wall have the adjacent wall as a blocker and
stay dark. Relies on the seam fix above to not leak light through
sprite gaps.

`isLightPassing` (not `isWalkable`) because rivers became non-walkable
but must still transmit light; water/rock still block both. Swapping
to `!isWalkable` here would cast black shadows across every river.

## Lighting: terrain per-instance tileXY, not VS-derived

Instance stride grew: base 40→48, overlay 44→52. Per-instance
`a_tileXY: vec2` feeds the FS via `v_tileXY`. Could not derive tile
coords in the VS from corner positions because elevation is baked into
`cornerY`; the inverse is ambiguous. Simpler to pass explicit tile
coords.

## Lighting: tickOffset vs currentTick

`world.currentTick` is real ticks elapsed (for respawn timers, event
ages, save `meta.tick`). `world.effectiveTick = currentTick +
tickOffset` is what feeds the day/night formula. Only the time-of-day
path should read `effectiveTick`. New worlds start at
`TWILIGHT_TICK_OFFSET = 19 * TICKS_PER_GAME_HOUR` so the first scene
isn't pitch-black.

## Smoke sheet layout: index 0 is peak, not trough

`smoke-anim.png` is 3×3 with intensities descending row-major: row 0 =
9,8,7 (peak fog at (0,0)), row 2 = 3,2,1 (wispy at (2,2)). So **sheet
index 0 is the most intense frame**, not the least. `SMOKE_FRAME_SEQUENCE
= [3,2,1,0,1,2,3,4,5,6,7,8]` plays 6→9→1 in intensity terms. Easy to
get backwards if you assume "frame 0 = first in animation."

## Dead entities: sprite hidden, position snaps on respawn

`creature-entity.draw` early-returns when `currentAction?.actionType ===
Dead`. Player-death smoke puff covers the visual beat; after that the
sprite is invisible until respawn. **Don't** lerp across the respawn
position delta — that looks like the corpse is walking back to spawn.
`applyComponentsToEntity` checks the *previous* `currentAction` before
applying the new one; when it was Dead, `lerpFromX/Y` are set to the new
position (not the old visual) so the lerp computes `t=1` immediately
and the sprite snaps. HP bar + nameplate overlays also suppress on
Dead entities (same `currentAction` check).

## Overlay positioning: use `sheet.footY`, not a fixed offset

Earlier `drawNameplates` used `NAMEPLATE_OFFSET_Y = 60` — fine for a
64-px creature, but the player is 128 px tall so the nameplate drew
*inside* the sprite. `drawEntityOverlays` computes sprite top as
`screenY + TILE_H/2 - sheet.footY - z*PX_PER_Z` (same math as
`creature-entity.draw`) and stacks HP bar + nameplate above it with a
4-px gap. Any new overhead overlay should use `entitySpriteTopY` — a
fixed pixel offset will break on mixed sprite heights.

## Effect alpha/scale: pass via `SpriteAnimOpts`, not pre-baked

`createSpriteAnim` accepts optional `scale` and `alpha` multipliers.
Attack + harvest overlays use `scale: 0.5, alpha: 0.5` to read as
"light flourish" rather than "flashing card." Smoke puff uses defaults
(1.0/1.0) — deliberate, the smoke is the main visual of a death. Don't
re-export the sheet at half size; the scale param keeps asset authoring
decoupled from per-effect presentation.

## Floor top must redraw after overlay — water bite

Floor tiles render as raised slabs (lifted top diamond). Adjacent grass
tiles next to a floor-on-water get their corners pulled to
`SHORE_HEIGHT` by the elevation flatten pass, tilting their diamond in
screen space: the grass's N vertex lands several pixels higher than
its S, stretching the diamond upward. Water overlays painted on that
tilted grass (pass order: base → overlay → …) therefore extend into
screen-Y rows occupied by the floor's LIFTED top, and since the
overlay pass runs after base, water-colored pixels paint over the
floor's top surface — a triangular "bite" on the NW corner of the
slab.

Fix: `terrain-instances.ts` emits one top-redraw instance per floor
tile (copy of the base instance with lifted corners) into a dedicated
buffer; `terrain-renderer.ts` draws it with the base program AFTER the
overlay pass. The redraw overdraws any bite. Cost: one extra opaque
quad per visible floor tile — negligible. If you ever collapse the
top-redraw pass into the base pass, the bite will come back.

## Game events channel: point-to-point vs broadcast

`PlayerConnection` has two event channels — `onGameEvent` (point-to-
point, MCP consumes for first-person narration) and `onBroadcastEvent`
(spectator-range, WS encodes to wire for visual effects). `WebSocketConnection.onGameEvent`
is **deliberately a no-op today** because the browser client only cares
about broadcast events. `McpConnection.onBroadcastEvent` is a no-op for
the inverse reason — broadcasts would duplicate first-person events
into third-person buffer entries. Don't collapse the two into one
method; the asymmetry is load-bearing.
