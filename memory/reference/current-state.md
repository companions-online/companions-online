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
- **Server migration** from raw ws to Hono (MCP + WS + static on one port)
- **Lighting + day/night** (shared keyframes, ambient tint, tickOffset on meta, twilight default, hourly env sync cadence)
- **Point lights** (per-blueprint lightRadius/Color, per-target raycast with wall occlusion, 80×80 RGB8 lightmap window)
- **Weather byte reserved** (wire field + GameWorld.weather, no rendering yet)
- **Dashboard time-of-day display** (HH:MM in header, updated per second)

**All 17 game actions + 19 MCP tools implemented.**

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

## 268 Tests across 25 files — all passing

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
- MCP combat interruption (getting attacked cancels non-attack actions for MCP players)
