# Architecture

## Monorepo Layout

```
shared/src/     Shared types, constants, protocol codec, pathfinding, world gen, inventory logic
server/src/     Game server: GameWorld, ECS, systems, connections, telemetry, NPC dialogues
client/src/     Web client (esbuild, placeholder — CLI is primary client)
cli/            CLI game client: state, rendering, input, panels, connection handler
scripts/        Dev tools: map viewer, map stats
test/           Unit tests + test/e2e/ for behavioral E2E tests
docs/           Design seed documents (may be outdated — code is authoritative)
memory/         These orientation docs
```

## Core Abstraction: GameWorld

`server/src/game-world.ts` — ALL mutable game state in one class. No module-level globals anywhere.

```
GameWorld implements SystemState {
  map: WorldMap              // terrain, buildings (tile layers)
  entities: EntityManager    // ECS components
  occupancy: OccupancyGrid   // tile → entityId (Uint16Array)
  inventoryMgr: InventoryManager
  players: Map<entityId, PlayerSlot>
  telemetry: Telemetry       // per-phase CPU timing + network bytes

  // System state Maps
  moveStates, harvestStates, combatStates, critterStates
  treeResources, respawnQueue, playerRespawnTimers

  // Pending async actions (walk-to-then-do)
  pendingPickups, pendingInteracts

  addPlayer(connection: PlayerConnection): entityId
  removePlayer(entityId)
  setAction(entityId, action)
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
}
```

Four implementations:
- **WebSocketConnection** (`connections/ws-connection.ts`) — binary protocol encoding
- **HeadlessConnection** (`connections/headless-connection.ts`) — test spy, captures events
- **MCP Connection** — future, pull-based

## SystemState Interface

`server/src/system-state.ts` — subset of GameWorld that system functions accept. Unit tests can create plain objects satisfying it without needing full GameWorld. Exposes `players` for efficient critter AI (iterates players, not all entities).

## Tick Loop Order

```
0. Process player respawns (dead → alive after 5s timer)
1. Process pending player actions (switch dispatch → handler methods)
2. Critter AI (wander / flee / aggro decisions, iterates world.players for nearest-player)
3. Run harvest (channeled gathering, yields on timer)
4. Run respawns (depleted trees respawn after 30s)
5. Run movement (A* pathfinding, occupancy collision, wait-and-repath)
6. Run combat (damage, death detection — players get death state, critters get destroyed)
7. Process deaths → loot drops (per-creature drop tables) + player equipped item drops
8. Resolve pending pickups + pending interacts (walk-to-item/door/chest/NPC then auto-do)
9. Per-player visibility diff + chunk streaming + tile deltas → broadcast via PlayerConnection
10. Clear dirty/destroyed + dirty tiles
```

20Hz tick rate (50ms budget).

## ECS

- `ComponentStore<T>` — generic Map<entityId, T> with auto-dirty on set()
- All 7 stores share one dirty Map (bitmask per entity)
- `EntityManager` — create/destroy + component stores + getFullState/getDeltaComponents

## Binary Protocol

Custom compact binary over WebSocket. Opcodes:
- Client→Server: Action (variable payload for 14 action types), Ping
- Server→Client: Welcome, Pong, WorldDelta, EntityFullState, Chunk, InventorySync, ContainerOpen, DialogueOpen
- Component bitmask delta compression — only changed components sent
- RLE chunk compression for terrain
- Chunk streaming: only viewport chunks on connect, stream as player moves

## World Generation

Perlin noise, auto-scales with `MAP_SIZE / 128` ratio. Noise frequencies, spawn zones all proportional. Spawn density per-tile is constant. Currently MAP_SIZE=128.

NPCs spawned: Hermit (near spawn), Trader (near spawn), Wanderer (far, roams with critter AI).

## Building Layer vs Entities

Static structures (WoodenWall) → building tile layer (`map.setBuilding()`), synced via chunk/tile deltas.
Interactive placeables (Door, Campfire, StorageChest) → entities with components (health, statusEffects).
Doors use `StatusEffect.Open` bit for open/closed state, toggle occupancy on interact.

## Telemetry

`server/src/telemetry.ts` — per-phase CPU timing (circular buffer, rolling averages), network bytes by connection type.
`server/src/dashboard.ts` — ANSI dashboard rendering, refreshes every second.
