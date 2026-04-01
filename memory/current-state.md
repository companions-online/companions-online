# Current State

## Completed
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
- Combat (attack action, weapon damage/speed, auto-follow fleeing targets)
- Death + loot drops (per-creature drop tables, probabilistic drops)
- Player death + respawn (5s dead state, drop equipped items, respawn at spawn)
- Critter AI behaviors (wander/flee/aggro/passive per blueprint, optimized to iterate players)
- Bear + Skeleton + NPC spawns in world gen
- GameWorld refactor (all state encapsulated, processAction as switch/dispatch)
- PlayerConnection abstraction (WebSocket + Headless + future MCP)
- Chunk streaming (viewport-only on connect, stream as player moves)
- Tile delta system (building changes propagated to nearby players)
- Building layer for walls (static tiles, not entities)
- Door toggle (entity-based, StatusEffect.Open, occupancy toggle)
- Container system (chest placement, Transfer action, ContainerOpen opcode)
- NPC dialogue + barter (Hermit/Trader/Wanderer, DialogueOpen opcode, Trade action)
- Auto-action resolver (context-sensitive cursor: pickup/harvest/attack/interact/move)
- Telemetry dashboard (per-phase CPU timing, network bytes, ANSI dashboard)
- E2E test scaffold (GameWorld.runTicks, HeadlessConnection, test helpers)

## Known Issues
- Rock terrain threshold (0.65) too high for MAP_SIZE=128 — zero rock tiles on most seeds
- Large maps (1024+) still crawl on broadcastTick — O(entities×clients) visibility diff
- All critter AI runs globally even for critters far from all players

## Queued Work

### Scalability
1. **Terrain density**: Lower rock threshold OR noise-driven clustering
2. **Broadcast optimization**: Spatial index for visibility diff (currently O(entities×clients))
3. **Critter alive zones**: Only run AI for critters near players

### Deferred Features
- UseConsumable action (bandage channeling, food healing)
- Say action (chat broadcast to interest range)
- MCP client (pull-based PlayerConnection for LLM players)
- 2D asset pipeline (web client)
