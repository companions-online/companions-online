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
  onGameEvent(entityId, event: GameEvent)         // point-to-point (MCP first-person)
  onBroadcastEvent(entityId, event: GameEvent)    // spectator-range (WS visuals)
  onEntityMeta(entityId, targetEntityId, key, value)
}
```

Three implementations:
- **WebSocketConnection** (`connections/ws-connection.ts`) — binary protocol encoding. `onGameEvent` is a no-op (point-to-point events are MCP-only); `onBroadcastEvent` translates to `WireEvent` via `WIRE_EVENT_MAP`, queues in `pendingEvents`, flushes one `ServerOpcode.GameEvents` batch per tick after `WorldDelta`.
- **HeadlessConnection** (`connections/headless-connection.ts`) — test spy. Captures point-to-point events into `gameEvents[]` and broadcasts into `broadcastEvents[]` separately.
- **McpConnection** (`connections/mcp-connection.ts`) — MCP player, holds live GameWorldView ref + EventBuffer, action blocking via onTick. `onBroadcastEvent` is a no-op — MCP narration stays first-person.

## Event System

`server/src/events.ts` — 18 event types across 3 priority tiers (Critical/High/Medium). EventBuffer with priority-based decay and age-out.

Events emitted at authoritative sources: GameWorld handlers emit via **two channels**:

- `emitEvent(entityId, event)` — point-to-point to the subject. MCP consumes these for first-person narration (`"You hit X for 5 dmg"`). WS ignores (no-op today).
- `broadcastEvent(tileX, tileY, event)` — delivers to every player within `INTEREST_RANGE` of the event tile. Used for visual-impact events (hit landed, yield popped, entity died) so spectators' clients can render animations. MCP ignores broadcasts to avoid double-emission in its narration buffer.

The two channels are separate `PlayerConnection` methods (`onGameEvent` / `onBroadcastEvent`) so the MCP/WS consumer asymmetry is explicit per connection type. Migrating an emit site to broadcast is **additive** — keep the existing `emitEvent` call for MCP narration and add a `broadcastEvent` call for spectator visuals.

Wire format: `ServerOpcode.GameEvents = 0x37` carries a batched `WireEvent[]`. `WireEventType` is a numeric subset of `GameEventType` — only visual events cross the wire (combat hit dealt, harvest yield, craft complete, entity died). MCP-only events (`action_interrupted`, `creature_aggro`, `trade_complete`) stay off the wire. Mapping in `server/src/connections/ws-connection.ts::WIRE_EVENT_MAP`.

Design principle: only emit events NOT inferrable from state snapshots (damage causality, ephemeral chat, action interruption reasons). LLM experience is "constant teleportation" — full snapshot per response.

## MCP Layer

**McpConnection** — thin PlayerConnection impl. Holds live `GameWorldView` reference for on-demand reads (no delta accumulation). EventBuffer for game events. Action blocking: `awaitAction()` returns Promise, resolved by `onTick` when player's currentAction returns to Idle/Dead or 30s timeout.

**mcp-tools.ts** — 20 tools (16 action + 4 query) registered on per-session McpServer. Action tools call `world.setAction()` + `await conn.awaitAction()`, then format the response using the shape matching what actually changed (see below). Query tools return immediately.

**mcp-session.ts** — session lifecycle. One McpServer + transport + McpConnection per session. Sessions persist until explicit DELETE.

**mcp-formatters.ts** — pure section functions (`formatSelf`, `formatMap`, `formatEntities`, `formatTerrain`, `formatEvents`, `formatInventory`, `formatRecipes`, `formatContainer`, `formatDialogue`) composed by a single `formatEnvelope(conn, actionText, shape)` function. `ResponseShape` is an 8-variant union (`full`, `full_inv`, `self_inv`, `transfer`, `dialogue`, `container`, `social`, `meta`) — each action tool picks the shape that reflects what its action actually changed. Pathfound actions (`harvest`, `pickup`) pick between compact (`self_inv`) and full (`full_inv`) by comparing player position pre/post. `interact` branches on side effects (dialogue/container/world). Cuts token usage on instant inventory-only actions and surfaces container/dialogue state directly in action responses.

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

Harvest has a server-side yield cap (`MAX_HARVEST_YIELDS` in `shared/constants.ts`, currently 5) — applies to all connection types. Prevents unbounded action duration on non-depleting targets (rock/water) and gives LLMs predictable pacing. For trees, natural depletion (5 wood) still wins on the same tick; for rocks/fish the cap terminates the channel.

## ECS

- `ComponentStore<T>` — generic Map<entityId, T> with auto-dirty on set()
- All 7 stores share one dirty Map (bitmask per entity)
- `EntityManager` — create/destroy + component stores + getFullState/getDeltaComponents

## Binary Protocol

Custom compact binary over WebSocket. Opcodes:
- Client→Server: Action (variable payload for 17 action types), Ping
- Server→Client: Welcome, Pong, WorldDelta, EntityFullState, Chunk, InventorySync, ContainerOpen, DialogueOpen, ChatMessage, EnvironmentSync, EntityMeta, GameEvents
- Component bitmask delta compression — only changed components sent
- RLE chunk compression for terrain
- Chunk streaming: only viewport chunks on connect, stream as player moves
- Environment section inside WorldDelta (gameMinute u16, weather u8) — emitted on keyframe-hour crossings, weather change, or forced resync after `setTickOffset`
- `GameEvents` batches discrete notifications (`WireEventType` — CombatHitDealt / HarvestYield / CraftComplete / EntityDied today). Flushed per-tick after WorldDelta so referenced entity ids are in-scope client-side. Separate channel from state replication — see Event System above.

## World Generation

Perlin noise, auto-scales with `MAP_SIZE / 128` ratio. Noise frequencies, spawn zones all proportional. Spawn density per-tile is constant. Currently MAP_SIZE=128.

NPCs spawned: Hermit (near spawn), Trader (near spawn), Wanderer (far, roams with critter AI).

## Building Layer vs Entities

Static structures (WoodenWall) → building tile layer (`map.setBuilding()`), synced via chunk/tile deltas.
Interactive placeables (Door, Campfire, StorageChest) → entities with components (statusEffects, optional health).

## Player Death + Respawn

Players don't get destroyed on death. Instead: `ActionType.Dead` set, equipped items dropped as ground entities, occupancy cleared, 100-tick respawn timer. On respawn: teleport to spawn, HP restored, action set to Idle.

Server-side AI cleanup on death: `clearAiTargetsOn(deadEntityId)` iterates `critterStates` + `combatStates` and clears targets pointing at the dead entity. Called from both `handlePlayerDeath` (player entity persists, so critter-ai's `entities.exists()` check wouldn't catch it) and `processEntityDeath` (upfront cleanup is immediate rather than waiting for next-tick scan). `critter-ai.ts` also skips Dead players when scanning for nearest aggro target, so a revived player won't be re-aggroed.

Client-side death visuals: see `memory/client-webgl/architecture.md::Death visuals` — smoke puff spawned on both `EntityDied` wire event (creatures) and `currentAction → Dead` transition (player entity persists). Respawn position deltas snap instead of lerping.

## Telemetry

`server/src/telemetry.ts` — per-phase CPU timing (circular buffer, rolling averages), network bytes by connection type.
`server/src/dashboard.ts` — ANSI dashboard rendering, refreshes every second.
