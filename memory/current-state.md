# Current State (2026-03-31)

## Completed
- Scaffolding (esbuild, tsx, vitest, monorepo)
- Shared foundations (types, enums, constants, direction, terrain, coordinates)
- Binary protocol codec (all message types, round-trip tested)
- World generation (Perlin island, auto-scaling with MAP_SIZE)
- Server ECS (ComponentStore, EntityManager, GameLoop)
- A* pathfinding (8-dir, diagonal cost alternation, no corner cutting)
- Occupancy grid + collision (wait-and-repath pattern)
- CLI client (terminal rendering, cursor, keyboard, panels)
- CLI map viewer (fullscreen ASCII static view)
- Inventory system (add/remove/stack/weight/equip/unequip/drop)
- Crafting (17 recipes, material+tool validation)
- Harvest system (tree/rock/fish, channeled repeating, auto-pathfind to adjacent)
- Tree depletion + respawn (5 wood per tree, 30s respawn)
- UseItemAt (cooking at campfire, placing buildings)
- Combat (attack action, weapon damage/speed, auto-follow fleeing targets)
- Death + loot drops (per-creature drop tables, probabilistic drops)
- Critter AI behaviors (wander/flee/aggro/passive per blueprint)
- Bear + Skeleton spawns in world gen
- GameWorld refactor (all state encapsulated, no module globals)
- PlayerConnection abstraction (WebSocket + Headless implementations)
- E2E test scaffold (GameWorld.runTicks, HeadlessConnection, test helpers)
- 4x map size (512, auto-scaling world gen parameters)

## Test Status
122 tests, 9 test files, all passing. ~2s total runtime.

## Known Issues
- Large maps (1024+) crawl — O(entities×clients) broadcast, O(critters×entities) AI
- All chunks sent on connect (slow initial load on large maps)
- Large maps feel empty (uniform spawn density thins out)

## Queued Work (approved plan exists but not yet implemented)

### Scalability (3 items)
1. **Terrain density**: Noise-driven clustering (critter herds, dense vs sparse areas) instead of uniform random
2. **Chunk streaming**: Send only viewport chunks on connect, stream as player moves. Add sentChunks tracking + onChunkNeeded to PlayerConnection
3. **Telemetry dashboard**: Per-phase CPU timing in runTick, bytes UL/DL by connection type, ANSI dashboard replacing console.log

### Phase D: World Interaction (not yet planned in detail)
- Placeables: Campfire burn timer, door toggle, storage chest
- Container system (chest ↔ player inventory transfer)
- NPC dialogue trees + barter trades (Hermit, Trader, Wanderer)

### MCP Client (future)
- PlayerConnection implementation for LLM players
- Pull-based: accumulate state, serve on tool call
- Uses shared ASCII map view for orientation
