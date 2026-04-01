# Architecture

## Monorepo Layout

```
shared/src/     Shared types, constants, protocol codec, pathfinding, world gen, inventory logic
server/src/     Game server: GameWorld, ECS, systems, connections
client/src/     Web client (esbuild, placeholder — CLI is primary client)
cli/            CLI tools: client.ts (interactive game), view-map.ts (static map viewer)
test/           Unit tests + test/e2e/ for behavioral E2E tests
docs/           Design seed documents (may be outdated — code is authoritative)
memory/         These orientation docs
```

## Core Abstraction: GameWorld

`server/src/game-world.ts` — ALL mutable game state in one class. No module-level globals anywhere.

```
GameWorld implements SystemState {
  map: WorldMap              // terrain, buildings
  entities: EntityManager    // ECS components
  occupancy: OccupancyGrid   // tile → entityId (Uint16Array)
  inventoryMgr: InventoryManager
  players: Map<entityId, PlayerSlot>

  // System state Maps (moved from module-level)
  moveStates, harvestStates, combatStates, critterStates
  treeResources, respawnQueue

  addPlayer(connection: PlayerConnection): entityId
  removePlayer(entityId)
  setAction(entityId, action)
  runTick() / runTicks(n)
}
```

Multiple GameWorld instances can coexist (tests create isolated worlds).

`createDefaultWorld(seed)` — factory that generates terrain, spawns entities, inits AI.

## PlayerConnection Interface

`server/src/player-connection.ts` — abstract I/O boundary. GameWorld calls these; never encodes wire format itself.

```
interface PlayerConnection {
  onInitialState(entityId, world)
  onInventoryChanged(entityId, world)
  onTick(entityId, world, delta: TickDelta)
}
```

Three implementations:
- **WebSocketConnection** (`connections/ws-connection.ts`) — binary protocol encoding
- **HeadlessConnection** (`connections/headless-connection.ts`) — test spy, captures events
- **MCP Connection** — future, pull-based

## SystemState Interface

`server/src/system-state.ts` — subset of GameWorld that system functions accept. Unit tests can create plain objects satisfying it without needing full GameWorld.

## Tick Loop Order

```
1. Process pending player actions
2. Critter AI (wander / flee / aggro decisions)
3. Run harvest (channeled gathering, yields on timer)
4. Run respawns (depleted trees respawn after 30s)
5. Run movement (A* pathfinding, occupancy collision, wait-and-repath)
6. Run combat (damage, death detection, auto-follow fleeing targets)
7. Process deaths → loot drops (ground item entities)
8. Resolve pending pickups (walk-to-item then auto-pickup)
9. Per-player visibility diff → broadcast via PlayerConnection
10. Clear dirty/destroyed
```

20Hz tick rate (50ms budget).

## ECS

- `ComponentStore<T>` — generic Map<entityId, T> with auto-dirty on set()
- All 7 stores share one dirty Map (bitmask per entity)
- `EntityManager` — create/destroy + component stores + getFullState/getDeltaComponents

## Binary Protocol

Custom compact binary over WebSocket. Opcodes:
- Client→Server: Action (variable payload), Ping
- Server→Client: Welcome, Pong, WorldDelta, EntityFullState, Chunk, InventorySync
- Component bitmask delta compression — only changed components sent
- RLE chunk compression for terrain

## World Generation

Perlin noise, auto-scales with `MAP_SIZE / 128` ratio. Noise frequencies, spawn zones all proportional. Spawn density per-tile is constant (more tiles = more entities). Currently MAP_SIZE=512.
