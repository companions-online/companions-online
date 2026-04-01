# File Map

## shared/src/
```
index.ts                 Barrel re-export of everything
constants.ts             TICK_RATE=20, MAP_SIZE=512, CHUNK_SIZE=16, VIEW/INTEREST_RANGE, SPAWN
actions.ts               ActionType enum (Idle..Attacking), ClientAction enum (Cancel..Attack)
blueprints.ts            Blueprint interface + ~35 types (creatures, items, tools, weapons, armor, consumables, placeables, NPCs)
recipes.ts               17 crafting recipes (tools, weapons, armor, placeables, bandage)
inventory.ts             InventoryItem/Inventory types, pure helpers (getWeight, canCraft, equipSlot conversions)
loot-tables.ts           Drop tables per creature (deer→hide+meat, skeleton→iron+rock, etc.)
pathfinding.ts           A* with 8-dir movement, alternating diagonal cost, no corner cutting
action-resolver.ts       resolveAction (auto-detect MoveTo/Pickup/Harvest/Attack) + describeAction (status bar labels)
ascii.ts                 terrainChar, buildingChar, blueprintChar, tileChar (covering priority: entity>building>ground)
components.ts            ComponentBit enum (7 synced components), wire data interfaces
coordinates.ts           tileToScreen / screenToTile isometric helpers
direction.ts             Direction enum (8-dir), DX/DY arrays, isDiagonal
terrain.ts               Terrain/Building enums, isWalkable
status-effects.ts        StatusEffect bitmask (Poisoned, Slowed, Hasted, Stunned)
protocol/opcodes.ts      Client/Server opcodes, DeltaSectionTag, TileFieldBit
protocol/codec.ts        BufferWriter/Reader, encode/decode for all message types, DecodedAction union
protocol/index.ts        Barrel re-export
world/noise.ts           Seeded 2D Perlin noise (PerlinNoise class)
world/world-map.ts       WorldMap class (flat Uint8Array terrain/buildings, chunk extraction)
world/world-gen.ts       generateWorld(seed) — auto-scaling Perlin island, trees, critters, bears, skeletons
world/index.ts           Barrel re-export
```

## server/src/
```
main.ts                  Thin entry: createDefaultWorld + GameLoop + WebSocket server (~60 lines)
game-world.ts            GameWorld class — all state, runTick, player lifecycle, action processing
system-state.ts          SystemState interface + MovementState/HarvestState/CombatState/CritterState types
player-connection.ts     PlayerConnection interface + TickDelta + GameWorldView
occupancy.ts             OccupancyGrid (Uint16Array tile→entityId)
inventory-manager.ts     InventoryManager class (add/remove/equip/craft/drop with weight+stacking)
ecs/component-store.ts   ComponentStore<T> — generic Map with auto-dirty
ecs/entity-manager.ts    EntityManager — entity lifecycle, 7 component stores, dirty/destroyed tracking
ecs/game-loop.ts         GameLoop — setTimeout with drift compensation
systems/movement.ts      A* path-following, occupancy collision, wait-and-repath
systems/harvest.ts       Channeled gathering (tree/rock/fish), auto-pathfind to adjacent, tree depletion
systems/combat.ts        Attack system — pathfind+swing+damage, auto-follow fleeing targets
systems/critter-ai.ts    Wander/flee/aggro/passive behaviors, notifyCritterAttacked hook
systems/resources.ts     Tree resource pools (5 wood), respawn queue (30s delay)
connections/ws-connection.ts      WebSocket PlayerConnection (binary encoding)
connections/headless-connection.ts HeadlessConnection (test spy, captures events)
```

## cli/
```
client.ts       Interactive terminal game client (WS, ANSI rendering, keyboard, inventory/crafting panels, debug panel)
view-map.ts     Static fullscreen ASCII map viewer (npm run cli:map [seed])
```

## client/ (web — placeholder, CLI is primary)
```
index.html      Canvas entry
dev.ts          esbuild dev server with @shared alias
build.ts        esbuild production build
src/main.ts     Placeholder canvas render
```

## test/
```
ecs.test.ts              EntityManager lifecycle, component get/set, dirty tracking
protocol.test.ts         Round-trip encode/decode for all message types (24 tests)
world.test.ts            Perlin noise, WorldMap, world gen invariants, ASCII mapping, RLE
pathfinding.test.ts      A* correctness (8 tests) + occupancy collision (5 tests)
critter-ai.test.ts       Wander, target selection, non-critter filtering (5 tests)
harvest.test.ts          Harvest channel, tree depletion, rock mining, pathfind-to-tree (9 tests)
inventory.test.ts        Add/remove/stack/weight/equip/craft + protocol round-trips (22 tests)
e2e/helpers.ts           createTestWorld, addTestPlayer, placeTree, placeGroundItem
e2e/gather-craft.test.ts Full gameplay: harvest→craft→equip→drop→pickup→place (8 tests)
e2e/combat.test.ts       Attack→damage→death→loot, weapon damage, wolf fights back, flee, aggro (8 tests)
```
