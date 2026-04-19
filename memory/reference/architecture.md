# Architecture

## Monorepo Layout

```
shared/src/     Shared types, constants, protocol codec, pathfinding, world gen, inventory logic
server/src/     Game server: GameWorld, ECS, systems, connections, MCP, telemetry, NPC dialogues
client/src/     Web client (esbuild, placeholder — CLI is primary client)
cli/            CLI game client: state, rendering, input, panels, connection handler (6 modules)
scripts/        Dev tools: map viewer, map stats, MCP CLI test tool
test/           Unit tests + test/e2e/ for behavioral E2E tests
docs/           Design seed documents (may be outdated — code is authoritative)
memory/         These orientation docs
```

## Server Stack

Hono HTTP server on port 3001, serving three concerns on one port:

```
POST/GET/DELETE /mcp  →  MCP Streamable HTTP (LLM players)
GET /ws               →  WebSocket upgrade (human/CLI players)
GET /*                →  static files (web client)
```

Dependencies: `hono`, `@hono/node-server`, `ws`, `@modelcontextprotocol/sdk`, `zod`

## Core Abstraction: GameWorld

`server/src/game-world.ts` — ALL mutable game state in one class. No module-level globals anywhere.

```
GameWorld implements SystemState {
  map: WorldMap              // terrain, buildings (tile layers with dirty tracking)
  entities: EntityManager    // ECS components
  occupancy: OccupancyGrid   // tile → entityId (Uint16Array)
  inventoryMgr: InventoryManager
  players: Map<entityId, PlayerSlot>
  telemetry: Telemetry       // per-phase CPU timing + network bytes

  // System state Maps
  moveStates, harvestStates, combatStates, consumableStates, critterStates
  treeResources, respawnQueue, playerRespawnTimers

  // Pending async actions (walk-to-then-do)
  pendingPickups, pendingInteracts

  addPlayer(connection: PlayerConnection): entityId
  removePlayer(entityId)
  setAction(entityId, action)  // → processAction switch dispatch
  runTick() / runTicks(n)
}
```

Multiple GameWorld instances can coexist (tests create isolated worlds).

`createDefaultWorld(seed)` — factory that generates terrain, spawns entities + NPCs, inits AI.

## PlayerConnection Interface

`server/src/player-connection.ts` — abstract I/O boundary. GameWorld calls these; never encodes wire format itself.

```
interface PlayerConnection {
  onInitialState(entityId, world)
  onInventoryChanged(entityId, world)
  onTick(entityId, world, delta: TickDelta)
  onChunkNeeded(chunkX, chunkY, world)
  onContainerOpen(entityId, containerEntityId, world)
  onDialogueOpen(entityId, npcEntityId, dialogue)
  onChatMessage(entityId, senderEntityId, message)
  onGameEvent(entityId, event: GameEvent)
}
```

Four implementations:
- **WebSocketConnection** (`connections/ws-connection.ts`) — binary protocol encoding
- **HeadlessConnection** (`connections/headless-connection.ts`) — test spy, captures events
- **McpConnection** (`connections/mcp-connection.ts`) — MCP player, holds live GameWorldView ref + EventBuffer, action blocking via onTick

## Event System

`server/src/events.ts` — 18 event types across 3 priority tiers (Critical/High/Medium). EventBuffer with priority-based decay and age-out.

Events emitted at authoritative sources: GameWorld handlers emit directly via `slot.connection.onGameEvent()`. System functions (combat, harvest, consumable, critter-ai) return enriched data, GameWorld translates to events.

Design principle: only emit events NOT inferrable from state snapshots (damage causality, ephemeral chat, action interruption reasons). LLM experience is "constant teleportation" — full snapshot per response.

## MCP Layer

**McpConnection** — thin PlayerConnection impl. Holds live `GameWorldView` reference for on-demand reads (no delta accumulation). EventBuffer for game events. Action blocking: `awaitAction()` returns Promise, resolved by `onTick` when player's currentAction returns to Idle/Dead or 30s timeout. `sessionId` field set by `app.ts` on session init; used by `identify` to upgrade the session's entityId after spawning.

**mcp-tools.ts** — 21 tools (17 action + 4 query). `identify` is the only tool that runs pre-spawn; every other tool is wrapped by the `guarded(...)` helper that returns `NOT_IDENTIFIED` with `isError: true` when `conn.entityId === 0`. Action tools call `world.setAction()` + `await conn.awaitAction()`, then format the response using the shape matching what actually changed (see below). Query tools return immediately. Error returns use the CallToolResult `isError: true` field per MCP spec.

**mcp-session.ts** — session lifecycle. One McpServer + transport + McpConnection per session. `McpSession.entityId` starts at `0` (sentinel for "not identified"); `setSessionEntity` promotes it when `identify` spawns the player. `keepaliveTimer` holds a per-session `setInterval` that issues `server.server.ping()` every 15s (`.unref()`'d so it doesn't keep the process alive). `destroySession` clears the timer, resolves any pending action, and calls `removePlayer` only if `entityId !== 0`. Sessions persist until explicit DELETE or transport close.

**mcp-formatters.ts** — pure section functions (`formatSelf`, `formatMap`, `formatEntities`, `formatTerrain`, `formatEvents`, `formatInventory`, `formatRecipes`, `formatContainer`, `formatDialogue`) composed by a single `formatEnvelope(conn, actionText, shape)` function. `ResponseShape` is an 8-variant union (`full`, `full_inv`, `self_inv`, `transfer`, `dialogue`, `container`, `social`, `meta`) — each action tool picks the shape that reflects what its action actually changed. Pathfound actions (`harvest`, `pickup`) pick between compact (`self_inv`) and full (`full_inv`) by comparing player position pre/post. `interact` branches on side effects (dialogue/container/world). Cuts token usage on instant inventory-only actions and surfaces container/dialogue state directly in action responses.

**Identify + keepalive contract.** New MCP sessions stay entity-less until the client calls `identify(name)`. Pre-identify tool calls return an `isError` text block steering to identify. Node HTTP timeouts (`requestTimeout`, `headersTimeout`) are disabled in `main.ts` to keep long-lived SSE streams alive; a 15s MCP-native `ping()` interval per session produces real bytes on the standalone SSE stream so upstream proxies / harness liveness checks don't tear the stream down either. Background in `docs/plans/mcp-server-keepalive.md`.

## SystemState Interface

`server/src/system-state.ts` — subset of GameWorld that system functions accept. Unit tests can create plain objects satisfying it without needing full GameWorld. Exposes `players` for efficient critter AI (iterates players, not all entities).

## Tick Loop Order

```
0. Process player respawns (dead → alive after 5s timer)
1. Process pending player actions (switch dispatch → 17 handler methods)
2. Critter AI (wander / flee / aggro decisions) → returns CritterBehaviorChange[]
3. Tree respawns (depleted trees respawn after 30s)
4. Movement (A* pathfinding, occupancy collision, wait-and-repath; arriveIdle fires Idle)
5. Arrival-triggered resolvers (walk-to-then-do):
   5a. Pending pickups — dist check, pick up if adjacent
   5b. Pending interacts — dist check, execute interact if adjacent
6. Harvest — pathfinding→channel transition (arrival flip) + channel tick + yield
7. Consumables — channel tick + heal
8. Combat (damage, death detection) → returns CombatResult { deaths, hits }
9. Broadcast (per-player visibility diff + chunk streaming + tile deltas) via PlayerConnection
10. Cleanup (clear dirty/destroyed + dirty tiles)
```

20Hz tick rate (50ms budget).

**Why arrival-triggered resolvers sit together right after movement**: all three
(pickups, interacts, harvest's pathfinding→channel flip) check `hasMoveTarget`
to see whether the player has actually finished walking. Before this order,
harvest ran *before* movement, so on the arrival tick it saw a still-pending
move target, skipped the transition, and let `arriveIdle` flip the player to
`Idle`. The MCP tool then saw `Idle` on broadcast and resolved as complete —
with no yield. Placing harvest after movement lets the flip happen atomically
in the same tick as arrival, so the MCP player sees `Harvesting` and keeps
awaiting. Pickups and interacts already lived here for the same reason.

## Action System (17 actions)

`processAction` uses a switch/dispatch to handler methods:
- **World**: MoveTo, Cancel, Attack, Harvest, Pickup, UseItemAt, Interact, Say
- **Inventory**: Equip, Unequip, Drop, UseConsumable, Craft, Transfer
- **NPC**: DialogueSelect, Trade

Say is instant and does NOT cancel other actions (can chat while harvesting).

Harvest has a server-side yield cap (`MAX_HARVEST_YIELDS` in `shared/constants.ts`, currently 5) — applies to all connection types. Prevents unbounded action duration on non-depleting targets (rock/water) and gives LLMs predictable pacing. For trees, natural depletion (5 wood) still wins on the same tick; for rocks/fish the cap terminates the channel.

## ECS

- `ComponentStore<T>` — generic Map<entityId, T> with auto-dirty on set()
- All 7 stores share one dirty Map (bitmask per entity)
- `EntityManager` — create/destroy + component stores + getFullState/getDeltaComponents

## Binary Protocol

Custom compact binary over WebSocket. Opcodes:
- Client→Server: Action (variable payload for 17 action types), Ping
- Server→Client: Welcome, Pong, WorldDelta, EntityFullState, Chunk, InventorySync, ContainerOpen, DialogueOpen, ChatMessage, EnvironmentSync
- Component bitmask delta compression — only changed components sent
- RLE chunk compression for terrain
- Chunk streaming: only viewport chunks on connect, stream as player moves
- Environment section inside WorldDelta (gameMinute u16, weather u8) — emitted on keyframe-hour crossings, weather change, or forced resync after `setTickOffset`

## World Generation

Perlin noise, auto-scales with `MAP_SIZE / 128` ratio. Noise frequencies, spawn zones all proportional. Spawn density per-tile is constant. Currently MAP_SIZE=128.

NPCs spawned: Hermit (near spawn), Trader (near spawn), Wanderer (far, roams with critter AI).

## Building Layer vs Entities

Static structures (WoodenWall) → building tile layer (`map.setBuilding()`), synced via chunk/tile deltas.
Interactive placeables (Door, Campfire, StorageChest) → entities with components (statusEffects, optional health).

## Player Death + Respawn

Players don't get destroyed on death. Instead: `ActionType.Dead` set, equipped items dropped as ground entities, occupancy cleared, 100-tick respawn timer. On respawn: teleport to spawn, HP restored, action set to Idle.

## Telemetry

`server/src/telemetry.ts` — per-phase CPU timing (circular buffer, rolling averages), network bytes by connection type.
`server/src/dashboard.ts` — ANSI dashboard rendering, refreshes every second.
