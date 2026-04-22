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
- **MCP response-shape system** — single `formatEnvelope(shape)` with 8 shapes (`full`, `full_inv`, `self_inv`, `transfer`, `dialogue`, `container`, `social`, `meta`); each action tool picks the shape matching what it actually changed. Harvest/pickup branch on pre/post position; interact branches on side effects.
- **MCP identify flow** — session + player decoupled. New MCP clients connect without a player entity and must call `identify(name)` first. All other tools reject pre-identify with `isError: true`. Name validated via shared `validateName` helper (same rules as `/nick`). `identify` spawns the player via `addPlayer` + names via `setEntityMeta` (broadcasts). 21 tools total.
- **MCP session keepalive** — Node HTTP `requestTimeout`/`headersTimeout` disabled (Fix 1), plus per-session 15s `McpServer.server.ping()` interval (Fix 2). Fixes the 5-minute session drop diagnosed in `docs/plans/mcp-server-keepalive.md`.
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
- **Always-visible HUD quickbar** — compact 9-cell bar pinned to the bottom of the game viewport when the inventory panel is closed; selected slot highlighted. Hidden when the panel is open (the panel's own quickbar row takes over). Keys `1`..`9` work in both states so the player can swap hand items while browsing inventory. See `memory/client-webgl/inventory-panel.md` for layout constants.
- **`player_healed` broadcast event** — new wire event (`WireEventType.PlayerHealed = 0x05`) emitted at consume completion alongside the existing `consume_complete`. Nearby players within `INTEREST_RANGE` see an `assets/healing-anim.png` puff on the healed entity (9 frames, 720ms, follows entity). MCP ignores broadcasts so its first-person narration is unaffected.
- **ActionResult migration** — every mutating system helper (`setMoveTarget`, `startAttack`, `startHarvest`, `startConsume`, and the six `inventoryMgr.{equip,unequip,drop,craft,transferToContainer,transferFromContainer}`) now returns `ActionResult = {ok:true} | {ok:false; reason: RejectionReason}` instead of `void` / `boolean`. Validation (bounds, walkable, target-exists, distance, weight, material, no-path) lives inside the helper; every `handle*` in the action dispatcher is a 3–8 line shim that forwards failures to `rejectAction`. Definitions + `Ok` / `OkValue` / `Err` constructors in `server/src/action-rejection.ts`; shared `requireAdjacentTarget(actorId, targetId, world)` helper in `server/src/action-helpers.ts` absorbs the `target_missing | wrong_target_kind | not_adjacent` triplet used by Transfer / DialogueSelect / Trade. `setMoveTarget` gained a `mode: 'exact' | 'near'` param — `'exact'` rejects a blocked destination tile (player `move_to`), `'near'` routes to an adjacent walkable tile via `findPath`'s blocked-goal fallback (pickup / interact / combat chase). As a side effect the migration closed two silent-failure bugs: `move_to` onto a closed-door tile now emits `tile_blocked/door` (was silent), and `move_to` to a sealed-off tile now emits `no_path` (was silent); combat chase mid-fight now cancels if the target becomes unreachable.
- **`world-actions.ts` extraction** — the entire action-dispatch layer moved out of `game-world.ts` into a flat sibling file `server/src/world-actions.ts` (~580 lines): `processAction`, `cancelConflictingStates`, `rejectAction`, all 17 `handle*`, plus `executeInteract` + `toggleDoor`. Handlers are free functions taking `world: GameWorld` — same shape as `systems/*`. `rejectAction` moved with them because all 35 callsites were inside handlers. `game-world.ts` exposes `emitEvent`, `broadcastEvent`, `makeEvent`, `bpName` publicly so the free functions can reach the world's event-routing primitives; everything else the handlers touch was already public/readonly. `game-world.ts` dropped from 1395 → ~860 lines. Tick extraction (`world-tick.ts`) is deferred.
- **`test/movement-edge-cases.test.ts`** — regression + spec file covering five in-game observations: (1) `move_to` into building = `tile_blocked/wall`, (2) `move_to` onto closed door = `tile_blocked/door`, (3) `move_to` unreachable = `no_path`, (4) critter whose remaining path is walled off reverts to Idle, (5) aggro critter against sealed-in target gives up to Idle, (6) attacker cannot swing through a closed door, (7) pathfinding refuses a 2-wide river, (8) pathfinding allows a 1-wide river. 1–5 + 8 pass after the ActionResult + world-actions work; 6 and 7 remain as the two unfixed product bugs (see Known Issues).
- **`StatusEffect.Placed` is the canonical ground-item-vs-structure signal.** Replaces the prior "absence of statusEffects component = ground item" convention, which had been silently broken by `spawnCreatureEntity` (worldgen's test-base resources) and persistence load (set `{effects:0}` on every reloaded entity). New rule: `handleUseItemAt` + `spawnCreatureEntity` set `StatusEffect.Placed` on placeable-category entities and Trees; worldgen `resource`/`item` spawns route through `spawnGroundItem` (no statusEffects component, no occupancy); `handleDrop` + loot drops leave the bit off. The MCP formatter `categorizeEntity`, WebGL `cursor-context`/`mouse`/`renderer`, and CLI `render.ts` all gate on `isPlaced(se)` from `shared/src/status-effects.ts`. Persistence round-trips the bit as part of the existing statusEffects byte — no schema change. Regression test at `test/e2e/mcp-worldgen-base.test.ts`.

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
5. pickups + interacts  ← arrival-triggered resolvers
6. harvest              ← pathfinding→channel transition + tick (arrival-triggered)
7. consumables          ← channel tick
8. combat               ← damage resolution
9. broadcast            ← observe (MCP onTick resolves pending tools)
10. cleanup
```

Arrival-triggered resolvers (pickups/interacts/harvest's pathfinding→channel
flip) all sit right after movement so `hasMoveTarget` reflects the post-move
state. Prior to the reorder, harvest ran before movement, which meant a
distant `harvest(x,y)` tool call would resolve with `currentAction=Idle` on
the arrival tick before harvest could promote to `Harvesting` — the LLM saw
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

## Tests — all passing

## Known Issues
- **Wide rivers are crossable.** `Terrain.River` is missing from `shared/src/terrain.ts::isWalkable`'s blocked list, so A* treats river tiles as free and happily walks a straight path across a 2+-wide river. Desired behavior: rivers crossable only when the crossing is ≤1 tile wide. Fix sketch: context-aware blocker in `setMoveTarget` that rejects `river → river` transitions. Repro: `test/movement-edge-cases.test.ts`'s "refuses to cross a 2-tile-wide river" test.
- **Attacks can clip through closed doors.** `systems/combat.ts::isAdjacent` is pure Chebyshev (`max(|dx|,|dy|) <= 1`) and does not check whether the path between attacker and target is walkable. An attacker diagonally-adjacent to a target around the corner of a closed-door tile lands swings through the door. `startAttack`'s new reachability check closes the *start-time* case (no combat begins if there's no path), but the runtime swing check in `runCombat` is unchanged. Fix sketch: before the `adjacent` swing branch, require a short walkable path between attacker and target. Repro: `test/movement-edge-cases.test.ts`'s "attacker cannot land a swing through a closed door" test.
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
- Bend-only waypoint server optimization (plan in `docs/plans/bend-only-waypoints.md`)
- 2D asset pipeline (web client)
- Campfire burn timer
- More NPC types
- MCP combat interruption (getting attacked cancels non-attack actions for MCP players). Not fixed by the tick reorder — combat hits still don't transition `currentAction`, so a harvesting MCP player can't react until the channel ends or they die. Natural fix site is `McpConnection.onGameEvent` resolving on Critical-priority events, or `GameWorld` emitting an `action_interrupted` + Idle transition on non-combat hits.
- MCP player identity persistence across session drops (out of scope for the identify flow — sessions still lose state on DELETE / keepalive failure).
- Fix 3/4 from `docs/plans/mcp-server-keepalive.md`: grace period on disconnect + resumability via `eventStore`. Not needed today; captured if the keepalive-only approach ever proves insufficient.
- `formatEntities` should show the meta `Name` instead of `player#<id>` for other players.
