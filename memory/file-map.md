# File Map

## shared/src/
```
index.ts                 Barrel re-export of everything
constants.ts             TICK_RATE=20, MAP_SIZE=128, CHUNK_SIZE=16, VIEW/INTEREST_RANGE, SPAWN
actions.ts               ActionType enum (Idle..Attacking..Dead), ClientAction enum (Cancel..Trade)
blueprints.ts            Blueprint interface + ~35 types, blueprintToBuilding() mapping
recipes.ts               17 crafting recipes (tools, weapons, armor, placeables, bandage)
inventory.ts             InventoryItem/Inventory types, pure helpers (getWeight, canCraft, equipSlot conversions)
loot-tables.ts           Drop tables per creature (deer→hide+meat, skeleton→iron+rock, etc.)
pathfinding.ts           A* with 8-dir movement, alternating diagonal cost, no corner cutting
action-resolver.ts       resolveAction (auto-detect MoveTo/Pickup/Harvest/Attack/Interact) + describeAction
ascii.ts                 terrainChar, buildingChar, blueprintChar (with door open/closed), tileChar
components.ts            ComponentBit enum (7 synced components), wire data interfaces
coordinates.ts           tileToScreen / screenToTile isometric helpers
direction.ts             Direction enum (8-dir), DX/DY arrays, isDiagonal
terrain.ts               Terrain/Building enums, isWalkable (Building.Door removed — doors are entities)
status-effects.ts        StatusEffect bitmask (Poisoned, Slowed, Hasted, Stunned, Open)
protocol/opcodes.ts      Client/Server opcodes, DeltaSectionTag, TileFieldBit
protocol/codec.ts        BufferWriter/Reader, encode/decode for all message types, DecodedAction union
protocol/index.ts        Barrel re-export
world/noise.ts           Seeded 2D Perlin noise (PerlinNoise class)
world/world-map.ts       WorldMap class (flat Uint8Array terrain/buildings, chunk extraction, dirty tracking)
world/world-gen.ts       generateWorld(seed) — auto-scaling Perlin island, trees, critters, NPCs
world/index.ts           Barrel re-export
```

## server/src/
```
main.ts                  Thin entry: createDefaultWorld + GameLoop + WebSocket server (~65 lines)
game-world.ts            GameWorld class — all state, runTick, player lifecycle, action dispatch
system-state.ts          SystemState interface + MovementState/HarvestState/CombatState/CritterState types
player-connection.ts     PlayerConnection interface + TickDelta + GameWorldView
occupancy.ts             OccupancyGrid (Uint16Array tile→entityId)
inventory-manager.ts     InventoryManager class (add/remove/equip/craft/drop/transfer)
telemetry.ts             Telemetry class (per-phase timing, network bytes, rolling averages)
dashboard.ts             ANSI telemetry dashboard rendering
npc-dialogues.ts         Static dialogue trees + trade offers for Hermit, Trader, Wanderer
ecs/component-store.ts   ComponentStore<T> — generic Map with auto-dirty
ecs/entity-manager.ts    EntityManager — entity lifecycle, 7 component stores, dirty/destroyed tracking
ecs/game-loop.ts         GameLoop — setTimeout with drift compensation
systems/movement.ts      A* path-following, occupancy collision, wait-and-repath
systems/harvest.ts       Channeled gathering (tree/rock/fish), auto-pathfind to adjacent, tree depletion
systems/combat.ts        Attack system — pathfind+swing+damage, auto-follow fleeing targets
systems/critter-ai.ts    Wander/flee/aggro/passive behaviors, Wanderer NPC roaming
systems/resources.ts     Tree resource pools (5 wood), respawn queue (30s delay)
connections/ws-connection.ts      WebSocket PlayerConnection (binary encoding, byte counting)
connections/headless-connection.ts HeadlessConnection (test spy, captures events)
```

## cli/
```
client.ts       Entry point: WebSocket connect, wire modules
state.ts        Shared mutable state object, type helpers for component extraction
connection.ts   Server message handler (switch dispatch, state updates)
render.ts       Main render function, viewport, status bar, cursor context
panels.ts       Panel renderers (inventory, crafting, container, dialogue)
input.ts        Keyboard handler, mode-specific dispatch, action execution
```

## scripts/
```
view-map.ts     Static fullscreen ASCII map viewer (npm run cli:map [seed])
map-stats.ts    Terrain/entity/elevation statistical analysis (npm run cli:stats [seed])
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
protocol.test.ts         Round-trip encode/decode for all message types
world.test.ts            Perlin noise, WorldMap, world gen invariants, ASCII mapping, RLE
pathfinding.test.ts      A* correctness + occupancy collision
critter-ai.test.ts       Wander, target selection, non-critter filtering
harvest.test.ts          Harvest channel, tree depletion, rock mining, pathfind-to-tree
inventory.test.ts        Add/remove/stack/weight/equip/craft + protocol round-trips
e2e/helpers.ts           createTestWorld, addTestPlayer, placeTree, placeGroundItem
e2e/gather-craft.test.ts Full gameplay: harvest→craft→equip→drop→pickup→place
e2e/combat.test.ts       Attack→damage→death→loot, weapon damage, flee, aggro, player death+respawn
e2e/building.test.ts     Wall placement, door toggle, pathfinding, container transfer
e2e/npc.test.ts          NPC dialogue, trade, Hermit first-time gift
```
