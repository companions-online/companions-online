# Current State

## Completed — All Core Game Logic + MCP
- Scaffolding (esbuild, tsx, vitest, monorepo)
- Shared foundations (types, enums, constants, direction, terrain, coordinates)
- Binary protocol codec (all message types, round-trip tested)
- World generation (Perlin island, auto-scaling with MAP_SIZE, NPC placement)
- Server ECS (ComponentStore, EntityManager, GameLoop)
- A* pathfinding (8-dir, diagonal cost alternation, no corner cutting)
- Occupancy grid + collision (wait-and-repath pattern)
- CLI client (modular: state, connection, render, panels, input)
- CLI map viewer + map stats scripts
- Inventory system (add/remove/stack/weight/equip/unequip/drop)
- Crafting (17 recipes, material+tool validation)
- Harvest system (tree/rock/fish, channeled repeating, auto-pathfind to adjacent)
- Tree depletion + respawn (5 wood per tree, 30s respawn)
- UseItemAt (cooking at campfire, placing buildings/entities)
- UseConsumable (channeled healing: bandage 30HP/10t, food 15-20HP/3t, interruptible)
- Combat (attack action, weapon damage/speed, auto-follow fleeing targets)
- Death + loot drops (per-creature drop tables, probabilistic drops)
- Player death + respawn (5s dead state, drop equipped items, respawn at spawn)
- Critter AI behaviors (wander/flee/aggro/passive per blueprint, optimized to iterate players)
- Bear + Skeleton + NPC spawns in world gen
- GameWorld refactor (all state encapsulated, processAction as switch/dispatch)
- PlayerConnection abstraction (WebSocket + Headless + MCP)
- Chunk streaming (viewport-only on connect, stream as player moves)
- Tile delta system (building changes propagated to nearby players)
- Building layer for walls (static tiles, not entities)
- Door toggle, Container system, NPC dialogue + barter, Say/chat
- Auto-action resolver, Telemetry dashboard
- E2E test scaffold (GameWorld.runTicks, HeadlessConnection, test helpers)
- **Event system** (18 types, 3 priority tiers, EventBuffer with decay/age-out)
- **Event emission from authoritative sources** (onGameEvent on PlayerConnection, emitted from handlers + enriched system returns)
- **McpConnection** (thin PlayerConnection impl, live GameWorldView ref, EventBuffer, action blocking via onTick)
- **MCP text formatters** (self, map, entities, terrain, events, inventory, recipes, container, envelopes)
- **MCP server** (Hono on port 3001, Streamable HTTP with per-session McpServer/transport)
- **MCP tools** (15 action tools + 4 query tools, blocking execution model)
- **MCP session management** (create/destroy, session persistence)
- **MCP CLI test tool** (`scripts/mcp.ts`, session file persistence, tool enumeration + execution)
- **MCP response-shape system** — single `formatEnvelope(shape)` with 9 shapes (`full`, `full_inv`, `self_inv`, `transfer`, `dialogue`, `container`, `social`, `meta`, `rejected`); each action tool picks the shape matching what it actually changed. Harvest/pickup branch on pre/post position; interact branches on side effects. **`Rejected` is the minimal shape** (action + events only) used on every action-tool rejection path — no `<self>`/`<map>`/`<entities>`/`<terrain>`/`<inventory>` snapshot replay. **Empty `<events>` omitted globally**: `formatEvents` returns `''` on empty buffer and `formatEnvelope` filters empty parts before joining, so the stub `<events></events>` never ships.
- **Path-aware obstacle hints on movement rejections** — `tile_blocked` and `no_path` carry an optional `obstacles: ObstacleSpan[]` populated by `diagnoseBlockage(server/src/path-diagnose.ts)`. A second permissive `findPath` runs on the rejection path with unbridged water + closed `WoodenDoor` occupancy treated as walkable; if it succeeds, the resulting path is classified into water spans (≤4 tiles each) and per-tile door entries (≤3). `formatRejection` appends `"; water blocks at (X,Y), … — build a wooden floor to cross"` and `"; closed wooden door#NNN at (x,y) — interact to open"` after the base message. Walls / fences / rock / non-door entities stay unenriched (no recipe-bypassable mechanic). Every walk-to-act handler funneling through `setMoveTarget` inherits the enrichment automatically (move_to / pickup / interact / transfer / trade / dialogue_select / use_item_at). Tests in `test/path-diagnose.test.ts` (11) + extended `test/movement-edge-cases.test.ts` + `test/e2e/mcp-e2e.test.ts`.
- **MCP identify flow** — session + player decoupled. New MCP clients connect without a player entity and must call `identify(name)` first. All other tools reject pre-identify with `isError: true`. Name validated via shared `validateName` helper (same rules as `/nick`). `identify` spawns the player via `addPlayer` + names via `setEntityMeta` (broadcasts). 21 tools total.
- **MCP session keepalive** — Node HTTP `requestTimeout`/`headersTimeout` disabled (Fix 1), plus per-session 15s `McpServer.server.ping()` interval (Fix 2). Fixes the 5-minute session drop diagnosed in `plans/plans/mcp-server-keepalive.md`.
- **Nametag broadcast on spawn** — WS players' default `'Player'` name now rides via `setEntityMeta` (broadcasts + emits `entity_meta_changed`), not direct map mutation. `addPlayer`'s pre-emptive `knownEntities.add` loop removed so `broadcastTick`'s entered path fires `sendMetaFor` naturally. Existing nearby players see new entities with nameplates immediately.
- **Server-side harvest cap** (`MAX_HARVEST_YIELDS`=5, `shared/constants.ts`) applied to all players via `runHarvest`
- **`ACTION_BASE_TICKS` dial** (`shared/constants.ts`, currently `2`) multiplies every harvest `tickCost` and attack `attackSpeed` at resolution. Blueprint / harvest literals are base values; the dial scales the whole cadence uniformly. Tests parameterized on the constant.
- **Server migration** from raw ws to Hono (MCP + WS + static on one port)
- **Lighting + day/night** (shared keyframes, ambient tint, tickOffset on meta, twilight default, hourly env sync cadence)
- **Point lights** (per-blueprint lightRadius/Color, per-target raycast with wall occlusion, 80×80 RGB8 lightmap window)
- **Weather byte reserved** (wire field + GameWorld.weather, no rendering yet)
- **Dashboard time-of-day display** (HH:MM in header, updated per second)
- **Night skeletons** — dynamic creature spawning tied to day/night cycle. `systems/creature-lifecycle.ts` hosts both `runCreatureRespawns` (night: roll `SKELETON_NIGHT_SPAWN_PER_HOUR / TICKS_PER_GAME_HOUR` per tick, place a Skeleton on a walkable/unoccupied tile in `[SKELETON_MIN_PLAYER_DISTANCE, SKELETON_MAX_PLAYER_DISTANCE]` of any player where no `lightRadius` emitter's Chebyshev AABB reaches — no server shadowcast) and `runCreatureLifecycle` (daylight: `SKELETON_SUN_DAMAGE = 4` every `SKELETON_SUN_DAMAGE_TICKS = 25` to all living Skeletons; deaths route through `processEntityDeath` with `killerEntityId=0`, formatter drops the "killed by" clause). `runRespawns` → `runResourceRespawns`; tick-loop step 3 now a single `worldPulse` phase.
- **WebGL inventory / crafting / chest UI** — Minecraft-style drag-and-drop panel centered in the game viewport. Full cursor-held mechanics (left-pick-whole, right-pick-half, shift-toggle-equip / shift-quick-transfer, drag-out-to-drop), client-local grid order, optimistic in-flight decrements for flicker-free drops. Wire protocol gained optional `quantity` on `Drop` / `Transfer` / `Equip`. World placement mode (ghost sprite + `UseItemAt`) for equipped placeables. Full orientation in `memory/client-webgl/inventory-panel.md`.
- **Quickbar + context-sensitive right-click** — 9-slot quickbar below the 9×3 inventory grid; pressing `1`..`9` selects a slot (sends `Equip` for hand-equippables, `Unequip` for non-equippables / empty). Armor slots now head/body/boot top-down (hand no longer has a left-column widget — driven by quickslot selection). Right-click is mode-driven by the selected item: placeables place via `UseItemAt`, raw meat/fish cooks on the adjacent campfire (tinted red via a new sprite-shader `u_tint` uniform), consumables (bandage / cooked food) self-use via `UseConsumable`. Left-click still drives `resolveAction` in all modes. New `'boot'` equip slot (`EQUIP_SLOT_BOOT = 4`) wired through shared + server — no boot blueprints yet. Full orientation in `memory/client-webgl/inventory-panel.md`.
- **Always-visible HUD quickbar** — compact 9-cell bar pinned to the bottom of the game viewport when the inventory panel is closed; selected slot highlighted. Hidden when the panel is open (the panel's own quickbar row takes over). Keys `1`..`9` work in both states; **left-clicking a HUD cell** also selects (mirrors the keyboard path) — see `hudQuickbarCellRect` / `hitTestHudQuickbar` in `inventory-panel.ts`. Clicks are dispatched from `controls/mouse.ts` before the world-click pipeline so a tap never accidentally moves the player. See `memory/client-webgl/inventory-panel.md` for layout constants.
- **`player_healed` broadcast event** — new wire event (`WireEventType.PlayerHealed = 0x05`) emitted at consume completion alongside the existing `consume_complete`. Nearby players within `INTEREST_RANGE` see an `assets/healing-anim.png` puff on the healed entity (9 frames, 720ms, follows entity). MCP ignores broadcasts so its first-person narration is unaffected.
- **ActionResult migration** — every mutating system helper (`setMoveTarget`, `startAttack`, `startHarvest`, `startConsume`, and the six `inventoryMgr.{equip,unequip,drop,craft,transferToContainer,transferFromContainer}`) now returns `ActionResult = {ok:true} | {ok:false; reason: RejectionReason}` instead of `void` / `boolean`. Validation (bounds, walkable, target-exists, distance, weight, material, no-path) lives inside the helper; every `handle*` in the action dispatcher is a 3–8 line shim that forwards failures to `rejectAction`. Definitions + `Ok` / `OkValue` / `Err` constructors in `server/src/action-rejection.ts`; shared `requireAdjacentTarget(actorId, targetId, world)` helper in `server/src/action-helpers.ts` absorbs the `target_missing | wrong_target_kind | not_adjacent` triplet used by Transfer / DialogueSelect / Trade. `setMoveTarget` gained a `mode: 'exact' | 'near'` param — `'exact'` rejects a blocked destination tile (player `move_to`), `'near'` routes to an adjacent walkable tile via `findPath`'s blocked-goal fallback (pickup / interact / combat chase). As a side effect the migration closed two silent-failure bugs: `move_to` onto a closed-door tile now emits `tile_blocked/door` (was silent), and `move_to` to a sealed-off tile now emits `no_path` (was silent); combat chase mid-fight now cancels if the target becomes unreachable.
- **`world-actions.ts` extraction** — the entire action-dispatch layer moved out of `game-world.ts` into a flat sibling file `server/src/world-actions.ts` (~580 lines): `processAction`, `cancelConflictingStates`, `rejectAction`, all 17 `handle*`, plus `executeInteract` + `toggleDoor`. Handlers are free functions taking `world: GameWorld` — same shape as `systems/*`. `rejectAction` moved with them because all 35 callsites were inside handlers. `game-world.ts` exposes `emitEvent`, `broadcastEvent`, `makeEvent`, `bpName` publicly so the free functions can reach the world's event-routing primitives; everything else the handlers touch was already public/readonly. `game-world.ts` dropped from 1395 → ~860 lines. Tick extraction (`world-tick.ts`) is deferred.
- **`test/movement-edge-cases.test.ts`** — regression file covering: (1) `move_to` into building = `tile_blocked/wall`, (2) `move_to` onto closed door = `tile_blocked/door`, (3) `move_to` unreachable = `no_path`, (4) critter whose remaining path is walled off reverts to Idle, (5) aggro critter against sealed-in target gives up to Idle, (6) door close guard against occupancy phasing, (7) walled-in player + wolf in aggroRange stays in wander, (8) pickup with player boxed in = `no_path`, (9) pickup with item boxed in = `no_path`. All pass after the ActionResult + unified pendingActions work.
- **`StatusEffect.Placed` is the canonical ground-item-vs-structure signal.** Replaces the prior "absence of statusEffects component = ground item" convention, which had been silently broken by `spawnCreatureEntity` (worldgen's test-base resources) and persistence load (set `{effects:0}` on every reloaded entity). New rule: `handleUseItemAt` + `spawnCreatureEntity` set `StatusEffect.Placed` on placeable-category entities and Trees; worldgen `resource`/`item` spawns route through `spawnGroundItem` (no statusEffects component, no occupancy); `handleDrop` + loot drops leave the bit off. The MCP formatter `categorizeEntity`, WebGL `cursor-context`/`mouse`/`renderer`, and CLI `render.ts` all gate on `isPlaced(se)` from `shared/src/status-effects.ts`. Persistence round-trips the bit as part of the existing statusEffects byte — no schema change. Regression test at `test/e2e/mcp-worldgen-base.test.ts`.
- **OccupancyGrid single-blocker invariant** — the grid now carries an enforced semantic: one blocker per tile. `set/clear/move` check ownership; mismatches route to `world.log.error` via an injected `onViolation` callback. Fixed the "door phases out after a few open/close cycles" bug: `toggleDoor` close-branch refuses with `tile_blocked/entity` when a non-door entity stands on the tile, preventing the slot from getting overwritten and then blindly zeroed by the walker's next `occupancy.move`. Vestigial `occupancy.clear` on ground-item pickup deleted — ground items are not tracked. Full orientation: `memory/reference/occupancy-and-logger.md`.
- **Per-world `WorldLogger`** — structured log with info/warn/error + `assert(cond, msg, data)`. `createFileLogger` appends JSONL to `data/worlds/<id>/server.log`; `createMemoryLogger` retains entries for tests. Wired on `GameWorld` as `world.log`; emits `info` on world create/load/save + player join/disconnect. `expectCleanLog(world)` test helper asserts zero warn+error. `main.ts` awaits `world.log.close()` on shutdown.
- **Dashboard `d` key → reflective world dump** — writes `data/worlds/<id>/<ISO>-dump.json` with the entire server-side state tree. Route A reflective serializer (`server/src/world-dump.ts`) handles Map/Set/TypedArray/ComponentStore/Date/circular via markers; skiplist for `connection`/`telemetry`/`log` keys and `map.terrain`/`map.buildings`/`map.buildingMeta` paths; EntityManager dumped only at `world.entities`, elsewhere collapsed to `{__ref}`. New fields on GameWorld / PlayerSlot / system-state Maps appear in dumps automatically — no registration needed. Dashboard hint line now shows `[q] quit [s] save [p] pause [d] dump`.
- **Dashboard keys now usable under `npm run dev`** — `concurrently` removed from the dev script (server serves client-gl statics directly; run `npm run dev:client-gl` separately for a watch-mode bundler). Boot-time warning when `process.stdin.isTTY` is false so the failure mode is discoverable in Docker / piped contexts.
- **Walking-without-owner root-cause fix** — `clearMoveTarget` now mirrors the removed `arriveIdle`: resets `currentAction=Idle` + `nextWaypoint=WAYPOINT_NONE` when a moveState is actually deleted. `arriveIdle` collapsed away; its four callsites inside `runMovement` now call `clearMoveTarget` directly. Closes the "wolf walking in place for 2-3 seconds" class of bugs observed in world dumps.
- **Aggro reachability gate** — `runCritterAI` wander→aggro transition commits only when `startAttack` returns `Ok`. `startAttack` restructured so the non-adjacent branch is side-effect-free on `Err` (no more destroy-before-construct `clearMoveTarget` before the reachability probe); `clearMoveTarget` moved into the adjacent-only branch. `CritterState.aggroProbeCooldown` (DEFAULT = 20 ticks) throttles failed probes. `executeAggro` drops back to wander on `startAttack Err` (mid-chase unreachability). `notifyCritterAttacked` applies the same gate — unreachable attackers don't lock a critter into aggro.
- **`server/src/entity-spawn.ts`** — single source of truth for entity component shape. `spawnCreatureEntity` + `spawnGroundItem` (taking `SystemState`) replace the prior inline copies in `createNewWorld`, `loadWorld`, `runResourceRespawns`, `creature-lifecycle.spawnSkeleton`, `processEntityDeath` loot drops, `handlePlayerDeath` equipped drops, and `handleDrop`. The `GameWorld.spawn*` methods are gone — call sites are now free-function form. Fixes a load-time bug where ground items (skeleton-loot rocks/iron left overnight) re-acquired occupancy on world reload because `loadWorld` blindly called `occupancy.set` for every saved entity, blocking spawn-area movement after reload. Fix: `loadWorld` classifier-dispatches via `shouldRestoreAsGround(bp, statusEffects)` — Placed-bit-aware, so placeables saved without Placed (dropped from inventory) reload as ground items, with Placed (installed via `UseItemAt`) reload as structures. Open doors round-trip with cleared occupancy via the Open-bit gate inside `spawnCreatureEntity`. Also fixes a latent second bug: `runResourceRespawns` set `effects:0` on respawned trees, so MCP `categorizeEntity` / WebGL cursor-context/mouse/renderer / CLI render misclassified them as ground items — now picks up canonical `Placed` via the helper. Tests in `test/persistence.test.ts` cover ground-item occupancy round-trip, tree resources + Placed bit + occupancy, critter state, open-door walk-through round-trip, and createDefaultWorld vs createNewWorld isomorphism.
- **Unified `pendingActions` walk-to-act queue** — `server/src/pending-actions.ts` replaces the parallel `pendingPickups` + `pendingInteracts` maps with a single map + resolver, and extends the same pattern to `transfer`, `trade`, `dialogue_select`, and `use_item_at` (placement + cooking). Each handler dispatches via `scheduleOrExecute(world, eid, slot, kind, target, arrivalRange, execute)`: in-range cases run synchronously (preserves zero-tick MCP latency), out-of-range cases call `setMoveTarget('near')` and queue an entry whose `execute` closure re-validates on arrival. Resolver `runPendingActions` runs in the post-movement tick phase and detects arrival / target-destroyed (`target_missing`) / movement-gave-up (`no_path` after one retry) / mobile-target re-aim. Tick phase renamed `pickups` → `pendingActions` (dashboard `PHASE_ORDER` updated). Cancellation: `cancelConflictingStates` clears the queue on any new action and emits `action_interrupted` only when the new action's kind differs from the queued one (same-kind re-issue stays quiet). Closes the silent-pickup-when-boxed-in bug class — `handlePickup`/`handleInteractAction` previously ignored `setMoveTarget`'s `Err` so a sealed-off target produced no rejection, MCP `awaitAction` resolved `complete`. Also closes the river-floor case: `use_item_at(woodFloor, riverX, riverY)` from N tiles away now walks the player to a walkable shore tile within range 2 and places, instead of rejecting `not_adjacent`. Tests in `test/pending-actions.test.ts` (9 base + 6 interrupt cases). The orphan `requireAdjacentTarget` helper in `server/src/action-helpers.ts` is now dead code; superseded by the unified dispatch.
- **Client overlay refactor** — `client-webgl/src/overlay.ts` introduces a single discriminated union `Overlay = none | inventory | container{entityId,items} | dialogue{npcId,dialogue} | menu{screen}` replacing the prior parallel scene flags (`inventoryOpen`, `containerEntityId`, `containerItems`, `dialogueNpcId`, `dialogue`). Container/dialogue data lives inside the variant — closing an overlay drops its data atomically. Helpers `isInventoryShowing`, `isInputCaptured`, `getContainer` absorb callsite branching; mouse-input gate generalized to "any overlay swallows world clicks". `'menu'` variant reserved for upcoming main menu work. Mechanical migration across keyboard/mouse/hud/inventory-panel/placement/cooking-highlight + their tests. Detail in `memory/client-webgl/architecture.md::Overlay`.
- **Server bundles into the browser; standalone path moved into client** — the prior `standalone/standalone/` parallel build retired in favor of one `client-webgl/` bundle that mode-switches at boot. `client-webgl/build-shared.ts` exposes `makeAliasPlugin` resolving `@shared/*` + `@server/*` + `@client-webgl/*`; `build.ts` / `dev.ts` adopt it; new `dev-standalone.ts` runs esbuild serve mode on :3002. `client-webgl/src/network/standalone-connection.ts` houses the in-tab "virtual network" peer of `network/connection.ts`. `index.html` injects `window.GAME_SERVER_HOST = window.location.host` (networked path); `index-standalone.html` omits it (standalone path). Reachability check: `world-logger.ts` / `world-logger-file.ts` split kept node-only imports out of `createDefaultWorld`'s dependency tree. New npm script `dev:standalone`. Detail in `memory/client-webgl/overview.md::Boot flow` + `memory/client-webgl/architecture.md::Network path`.
- **Quickslot-driven left-click commit** (2026-05-07) — replaced the prior HUD action button + `scene.armedAction` sticky tap-to-act with a simpler model: selecting a quickslot *is* the mode, and left-click commits. `controls/mouse.ts` left-click ladder: sprite-AABB hit (entity actions resolve normally — clicking a deer attacks even with a wall selected; cook-mode + Campfire hit short-circuits to `handleCookingClick(hit.position.tileX, hit.position.tileY)` so above-tile sprite clicks still cook) → tile-fallback (`selectedMode === 'placement'` → `UseItemAt(handItem, tx, ty)`; `'cook'` → `handleCookingClick(tx, ty)` and on success done, off-target falls through to MoveTo per user choice; `'consumable'/'tool'/'none'` → fall through to `resolveAction`). Consumables (`bp.consumeHeal !== undefined`) are special-cased in `ui/quickslot.ts::selectQuickSlot`: first press of the slot runs the equip dance + sends `UseConsumable`; re-press of the same slot sends another `UseConsumable` so the gesture is "press 2 to drink, press 2 again to drink another." Stack-empty handled by the existing `inventorySync` quickslot-prune. HUD button bar narrowed to `[Inventory][Settings]`; right-click contextual mode preserved (desktop muscle memory). Removed: `scene.armedAction`, `getActionButtonLabel`/`isActionButtonVisible`, action-button rect/dispatch/draw, stale-arm self-clear branch, and the dead Esc-during-placement legacy unequip. Coverage: `test/client-gl/controls.test.ts` adds the quickslot-left-click ladder (placement-on-tile, placement-on-deer→Attack, cook-on-campfire-tile, cook-on-campfire-sprite-above-tile, cook-off-target→MoveTo); `quickslot.test.ts` + `consumable.test.ts` cover the consumable equip-dance / re-press path; `hud-buttons.test.ts` reduced to inventory+settings hit-test + dispatch.
- **Unified entity action cooldown** (2026-05-08) — replaces the four per-state timers (`MovementState.cooldownRemaining`, `HarvestState.ticksRemaining`, `CombatState.ticksRemaining`, `ConsumableState.ticksRemaining`) with `world.cooldowns: Map<eid, number>` decremented once per tick at the top of `runTick`. Closed the WASD/click-spam super-speed exploit: `setMoveTarget` no longer creates a fresh `cooldownRemaining=0` slot, and 1-tile path completions can't shed the rate residue. Cd is read as a gate by every `run*` system and written by every committing time-taking action; `processAction` and `cancelConflictingStates` are unchanged so click-tree-then-click-deer UX still routes through unobstructed (combat registers immediately, swing waits on cd). `cancelConsume` and explicit `handleCancel` clear cd. `cancelHarvest` clears cd only in the channel phase (responsive switch to other actions); pathfinding phase preserves it (movement-step residue, closes a Harvest↔MoveTo step-rate macro). `cancelCombat` always preserves cd (first swing is free — clearing would re-trigger it). Pre-commit cd writes use `value - 1` to preserve "N ticks of channeling" contract; post-commit writes use the full value. Companion fix on the client: `creature-entity.ts` lerp duration scales with Chebyshev distance from `lerpFromX/Y` to `position`, so batched server deltas (multiple ticks of WS messages arriving in one client frame) slide at constant tiles/sec instead of teleporting. New tests: `test/movement-rate-limit.test.ts`, `test/cooldown-cross-action.test.ts`, `test/cooldown-consume-cancel.test.ts`. Test mocks pick up the cd shape via the new `test/system-state-mock.ts` helper (`attachCooldowns`, `tickCooldowns`).
- **Observer mode** — `GameWorld.addObserver(connection, focusX, focusY)` registers a passive viewer with no in-world entity. Observer ids are negative (separate space from positive entityIds). Per-tick broadcast extracted into `streamToTarget(centerX, centerY, ...)` helper used by both player and observer loops; `broadcastEvent`, `setEntityMeta`, and `world-actions.ts::handleSay` extended with parallel observer iterations range-tested against `slot.focusX/focusY`. Observer is invisible to other players for free (no entity to broadcast). Client side: `scene.observerFocus: {tileX,tileY}` falls back as the camera/lighting/eviction interest center when `myEntityId === null`; `onWelcome(0, seed)` is the observer-channel sentinel. `controls/observer-camera.ts` is the autopilot driver — 8-direction random walk, 3-5s segments, edge buffer biases turns inward, throttled `setObserverFocus` push. `client-webgl/src/network/standalone-connection.ts::bootStandaloneObserver` is the standalone-mode boot factory: createDefaultWorld + GameLoop + StandaloneObserverConnection + addObserver + autopilot. Standalone mode now boots into observer (no player avatar). Coverage: `test/e2e/observer.test.ts` (10), `test/client-gl/observer.test.ts` (3), `test/client-gl/observer-camera.test.ts` (7). Detail in `memory/reference/architecture.md::Observer Mode`.

**All 17 game actions + 21 MCP tools implemented.** (Action count
unchanged since server commands are modeled as `ClientAction.ServerCommand`
dispatched via a registry — one action opcode, N handlers. MCP tool count
rose by one with the new `identify` tool.)

## Tick loop order (as of identify/keepalive pass)

```
0. player respawns
1. actions              ← player decisions dispatched
2. critterAI            ← NPC decisions
3. worldPulse           ← resource respawns + creature respawns + creature lifecycle (sun damage)
4. movement             ← translate (arriveIdle fires Idle)
5. pendingActions       ← arrival-triggered resolver (pickup/interact/transfer/trade/dialogue_select/use_item_at)
6. harvest              ← pathfinding→channel transition + tick (arrival-triggered)
7. consumables          ← channel tick
8. combat               ← damage resolution
9. broadcast            ← observe (MCP onTick resolves pending tools)
10. cleanup
```

Arrival-triggered resolvers (the unified `pendingActions` queue + harvest's
pathfinding→channel flip) sit right after movement so `hasMoveTarget` reflects
the post-move state. Prior to the reorder, harvest ran before movement, which
meant a distant `harvest(x,y)` tool call would resolve with `currentAction=Idle`
on the arrival tick before harvest could promote to `Harvesting` — the LLM saw
"complete, no yield" and had to call harvest a second time. Fixed.

## Server commands + entity meta

Generic observer-visible string-metadata layer (`shared/src/entity-meta.ts::MetaKey`)
with its own server-to-client message (`ServerOpcode.EntityMeta = 0x36`).
`ClientAction.ServerCommand = 0x11` carries `/name value`; a registry in
`server/src/server-commands.ts` dispatches to handlers. First built-in: `/nick` /
`/name` (1–16 chars, `[A-Za-z0-9_-]`, aliased). Every player spawns with
`MetaKey.Name = 'Player'`. MCP exposes a `server_command` tool. Errors return as
system chat (sender id 0). WebGL client renders nameplates above other players
(own suppressed). Full orientation: `memory/reference/server-commands.md`.

## WebGL client — fully network-driven

Second client under `client-webgl/`, alongside the CLI. Same backend,
same shared protocol. Boots into an empty scene and fills in from
server messages; no client-side world-gen, no local entity simulation.
Chunk-sparse rendering with player-distance eviction bounds GPU memory
to the interest-range working set (not map size). Movement
interpolation, shared action-resolver controls with local turn
prediction, inventory/container/dialogue/chat replication — full
parity with the CLI's logic, minus the UI.

Served same-origin by the game server (`app.ts` static handler), so
no cross-origin config and `PORT=3002` "just works" for a parallel
session.

Test harness at `test/client-gl/` — vitest with mock GL and fakes; no
browser needed for most work. Puppeteer reserved for actual rendering
regressions. See `memory/clientgl/` for full orientation.

## Game events channel + visual effects

Discrete server→client notification channel parallel to `WorldDelta`.
New `ServerOpcode.GameEvents = 0x37` carries batched `WireEvent[]`
(CombatHitDealt / HarvestYield / CraftComplete / EntityDied —
numeric subset of the server's string-union `GameEventType`).
`broadcastEvent(tileX, tileY, event)` on GameWorld delivers to players
within `INTEREST_RANGE` via `PlayerConnection.onBroadcastEvent`; MCP
ignores broadcasts (first-person narration uses point-to-point
`onGameEvent`), WS encodes a GameEvents batch per tick after its
WorldDelta. Full writeup in `memory/reference/architecture.md::Event
System`.

Client-side effects wired onto the channel:
- **Death smoke puff** — 9-frame `smoke-anim.png` sequence
  `[3,2,1,0,1,2,3,4,5,6,7,8]` (build to peak, fade). Fires on
  `EntityDied` wire event (creatures) and on `currentAction → Dead`
  transition (persisting player entities).
- **Attack / harvest / craft overlays** — `attack-anim.png` (6 frames),
  `harvest-craft-anim.png` (7 frames) spawned once per fired event at
  actor↔target midpoint; `scale: 0.5, alpha: 0.5` so they read as
  flourish rather than flash.
- **Action facing** — server sets actor direction on `startAttack`,
  per-swing re-face in `runCombat`, and on entering Harvesting state
  (shared `dirFromTo(fromX,fromY,toX,toY)` in `shared/direction.ts`).
- **Player death flow** — `creature-entity.draw` early-returns while
  Dead (sprite hidden); `applyComponentsToEntity` snaps position on
  Dead→non-Dead transition so respawn teleports instead of sliding.
- **AI target clearing on death** — `clearAiTargetsOn(deadEntityId)`
  called from both `handlePlayerDeath` + `processEntityDeath`; critter
  AI aggro scan skips Dead players.
- **HP bar overlay** — 24×3 red bar above any damaged creature/NPC/
  player (not Dead). `drawEntityOverlays` in `renderer.ts` runs one
  unlit pass for bar + nameplate, positioned off `sheet.footY` so
  128px and 32px sprites get consistent overhead placement.
- **WoodenFloor / StoneFloor placeables + floor-as-slab rendering.**
  1-wood / 2-rock recipes; placement goes through the building tile
  layer (like WoodenWall), not an entity. Rivers are non-walkable by
  default; floors bridge them (but not water/rock). Floor tiles render
  as a raised slab: top diamond lifted by `FLOOR_LIFT_Z = 0.25`, with
  SE/SW side quads filling the profile (shared interior edges between
  adjacent floors are suppressed). Floors opt out of blend overlays
  (`TERRAIN_NO_OVERLAY`) so the edge is sharp. A post-overlay top-redraw
  pass prevents neighbor water overlays from biting into the lifted top.
- **Three terrain predicates (split from one).** `shared/src/terrain.ts`
  exports `isWalkable`, `isPlaceable(curr, newBuilding|null)`, and
  `isLightPassing` — decouples movement, placement surface, and
  shadowcast transparency. Used to keep rivers non-walkable while still
  passing light, and to allow floors-on-river without allowing
  walls-on-river.
- **Bridge-click fix.** `shared/src/action-resolver.ts` now checks
  `isWalkable` for river/water tiles instead of returning null, so
  clicking a bridged river tile emits `MoveTo`. Fishing-rod branch
  still wins for rivers when the rod is equipped.
- **Main menu** — canvas-native menu drawn on top of a live observer
  pan in both standalone and game-server-served boots. Three screens
  (`landing`, `settings`, `create-join`) plus two transient join-flow
  screens (`connecting`, `connect-error`). Closure-factory widget kit
  (`makeButton`, `makeTextInput`, `makeLabel`, `makeDivider`,
  `makeImage`, `makeBackdropDim`, `makeSelectableTile`) backed by a
  pre-baked 1×1 solid-color palette + the existing `TextSurfaceFactory`
  — no new GL paths. Build version inlined from `.build-number` via
  esbuild `define`. Boot path now always runs `bootStandaloneObserver`
  for the menu backdrop; game-start happens through the menu —
  **Start World** tears down the observer, runs `bootStandalone(seed)`,
  applies `/nick` + `/avatar` if changed, dismisses; **Join World**
  runs `normalizeHost` + `connectTo` (8s timeout, categorized errors:
  `bad-url|refused|timeout|closed-pre-welcome|wrong-protocol`),
  transitions through Connecting → success | Connect-error with
  Retry/Back. `ConnectionRef implements Connection` is a swappable
  proxy so all 30+ `connection.send` callsites stay attached at boot
  while the underlying connection is replaced atomically. `connectTo`
  buffers pre-welcome chunk traffic (server's `addPlayer` streams
  `onChunkNeeded` before `onInitialState`'s welcome) and post-welcome
  traffic until `onMessage` is wired, replaying in arrival order so
  `wireSceneToConnection` initializes scene state normally.
  Avatar selection wires through the existing `BlueprintData.variant`
  component — new `/avatar <n>` server command validates against the
  Player blueprint's `variantCount`, sets the variant via
  `entities.blueprint.set` (auto-dirty marks for the next WorldDelta).
  No new MetaKey, no protocol change. Adding new player variants:
  bump `variantCount` in `shared/src/blueprints.ts`, ship
  `player-<n>.png`, add an entry to `KNOWN_VARIANTS` in
  `client-webgl/src/ui/avatar-selector.ts`. Keyboard polish (no Tab
  cycle, but Enter triggers screen `defaultAction`, Esc triggers
  `escapeAction`, clipboard-paste-denial focuses the host input).
  HUD quickbar hides whenever any overlay is up. Coverage:
  `test/client-gl/widgets.test.ts` (28), `test/client-gl/host-normalizer.test.ts`
  (18), `test/e2e/server-commands.test.ts` `/avatar` cases (4).
  Detail in `memory/client-webgl/menu.md`.

## Tests — all passing

## Known Issues
- **Entity anchoring on raised floors.** Floor tiles render as a lifted slab (`FLOOR_LIFT_Z = 0.25` via `client-webgl/src/terrain/terrain-instances.ts`) but entity sprites still anchor their foot at the natural ground elevation. A player standing on a floor appears ~4 px submerged in the slab. Fix: teach the entity-Y projection to pick up the lift when the standing tile is a floor.
- **Corner-diagonal clip-through.** `systems/combat.ts::isAdjacent` is pure Chebyshev and doesn't check walkability of the step between attacker and target. An attacker at (x,y) can land a swing on a target at (x+1,y+1) when both (x+1,y) and (x,y+1) are blocked (wall or closed door corner) — pathfinding forbids that diagonal but combat doesn't. `startAttack`'s reachability check closes the start-time case; runtime per-swing adjacency is still pure Chebyshev. Fix sketch: `isAdjacent` (or a new `canStrike`) requires the step to be walkable under the same no-corner-cut rules `findPath` uses.
- Rock terrain threshold (0.65) too high for MAP_SIZE=128 — zero rock tiles on most seeds. Fix: lower to ~0.50
- Large maps (1024+) still crawl on broadcastTick — O(entities×clients) visibility diff
- All critter AI runs globally even for critters far from all players
- Light ignores directional facing — walls uniformly tinted, no SW-face-in-shadow differentiation
- Entity lightmap sample uses `visualX/Y` (float); tile-center-only is fine today but mid-tile interpolation during movement samples neighbors via LINEAR filter

## Queued Work

### Scalability (deferred)
1. Rock terrain fix
2. Broadcast optimization: spatial index for visibility diff
3. Critter alive zones: only run AI for critters near players

### Future
- WebGL client HUD / dialogue panel (inventory + crafting + chest + placement mode landed; dialogue panel still text-only on CLI)
- Bend-only waypoint server optimization (plan in `plans/plans/bend-only-waypoints.md`)
- 2D asset pipeline (web client)
- Campfire burn timer
- More NPC types
- MCP combat interruption (getting attacked cancels non-attack actions for MCP players). Not fixed by the tick reorder — combat hits still don't transition `currentAction`, so a harvesting MCP player can't react until the channel ends or they die. Natural fix site is `McpConnection.onGameEvent` resolving on Critical-priority events, or `GameWorld` emitting an `action_interrupted` + Idle transition on non-combat hits.
- MCP player identity persistence across session drops (out of scope for the identify flow — sessions still lose state on DELETE / keepalive failure).
- Fix 3/4 from `plans/plans/mcp-server-keepalive.md`: grace period on disconnect + resumability via `eventStore`. Not needed today; captured if the keepalive-only approach ever proves insufficient.
- `formatEntities` should show the meta `Name` instead of `player#<id>` for other players.
