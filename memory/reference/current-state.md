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
- **Server migration** from raw ws to Hono (MCP + WS + static on one port)
- **Lighting + day/night** (shared keyframes, ambient tint, tickOffset on meta, twilight default, hourly env sync cadence)
- **Point lights** (per-blueprint lightRadius/Color, per-target raycast with wall occlusion, 80×80 RGB8 lightmap window)
- **Weather byte reserved** (wire field + GameWorld.weather, no rendering yet)
- **Dashboard time-of-day display** (HH:MM in header, updated per second)

**All 17 game actions + 21 MCP tools implemented.** (Action count
unchanged since server commands are modeled as `ClientAction.ServerCommand`
dispatched via a registry — one action opcode, N handlers. MCP tool count
rose by one with the new `identify` tool.)

## Tick loop order (as of identify/keepalive pass)

```
0. player respawns
1. actions              ← player decisions dispatched
2. critterAI            ← NPC decisions
3. tree respawns        ← world restoration
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

## 309 Tests across 28 files — all passing

## Known Issues
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
- WebGL client UI (HUD, inventory, dialogue panel, chat — state is all wired, UI is the next pass)
- Bend-only waypoint server optimization (plan in `docs/plans/bend-only-waypoints.md`)
- 2D asset pipeline (web client)
- Campfire burn timer
- More NPC types
- MCP combat interruption (getting attacked cancels non-attack actions for MCP players). Not fixed by the tick reorder — combat hits still don't transition `currentAction`, so a harvesting MCP player can't react until the channel ends or they die. Natural fix site is `McpConnection.onGameEvent` resolving on Critical-priority events, or `GameWorld` emitting an `action_interrupted` + Idle transition on non-combat hits.
- MCP player identity persistence across session drops (out of scope for the identify flow — sessions still lose state on DELETE / keepalive failure).
- Fix 3/4 from `docs/plans/mcp-server-keepalive.md`: grace period on disconnect + resumability via `eventStore`. Not needed today; captured if the keepalive-only approach ever proves insufficient.
- `formatEntities` should show the meta `Name` instead of `player#<id>` for other players.
