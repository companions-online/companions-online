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

**McpConnection** — thin PlayerConnection impl. Holds live `GameWorldView` reference for on-demand reads (no delta accumulation). EventBuffer for game events. Action blocking: `awaitAction()` returns Promise, resolved by `onTick` when player's currentAction returns to Idle/Dead or 30s timeout.

**mcp-tools.ts** — 19 tools (15 action + 4 query) registered on per-session McpServer. Action tools call `world.setAction()` + `await conn.awaitAction()`. Query tools return immediately.

**mcp-session.ts** — session lifecycle. One McpServer + transport + McpConnection per session. Sessions persist until explicit DELETE.

**mcp-formatters.ts** — pure functions producing XML-tagged text sections: `<self>`, `<map>`, `<entities>`, `<terrain>`, `<events>`, `<inventory>`, `<recipes>`, `<container>`, plus envelope composers.

## SystemState Interface

`server/src/system-state.ts` — subset of GameWorld that system functions accept. Unit tests can create plain objects satisfying it without needing full GameWorld. Exposes `players` for efficient critter AI (iterates players, not all entities).

## Tick Loop Order

```
0. Process player respawns (dead → alive after 5s timer)
1. Process pending player actions (switch dispatch → 17 handler methods)
2. Critter AI (wander / flee / aggro decisions) → returns CritterBehaviorChange[]
3. Run harvest (channeled gathering, yields on timer) → returns HarvestEvent[]
3.5. Run consumables (channeled healing) → returns ConsumeEvent[]
4. Run respawns (depleted trees respawn after 30s)
5. Run movement (A* pathfinding, occupancy collision, wait-and-repath)
6. Run combat (damage, death detection) → returns CombatResult { deaths, hits }
7. Process deaths → loot drops + player death handling
8. Resolve pending pickups + pending interacts
9. Per-player visibility diff + chunk streaming + tile deltas → broadcast via PlayerConnection
10. Clear dirty/destroyed + dirty tiles
```

20Hz tick rate (50ms budget).

## Action System (17 actions)

`processAction` uses a switch/dispatch to handler methods:
- **World**: MoveTo, Cancel, Attack, Harvest, Pickup, UseItemAt, Interact, Say
- **Inventory**: Equip, Unequip, Drop, UseConsumable, Craft, Transfer
- **NPC**: DialogueSelect, Trade

Say is instant and does NOT cancel other actions (can chat while harvesting).

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
