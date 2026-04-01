# Current State

## Completed — All Core Game Logic Done
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
- Bear + Skeleton + NPC spawns in world gen (Hermit near spawn, Trader near spawn, Wanderer roams)
- GameWorld refactor (all state encapsulated, processAction as switch/dispatch with handler methods)
- PlayerConnection abstraction (WebSocket + Headless + future MCP)
- Chunk streaming (viewport-only on connect, stream as player moves)
- Tile delta system (building changes propagated to nearby players)
- Building layer for walls (static tiles, not entities)
- Door toggle (entity-based, StatusEffect.Open, occupancy toggle)
- Container system (chest placement with inventory, Transfer action, ContainerOpen opcode)
- NPC dialogue + barter (Hermit/Trader/Wanderer, DialogueOpen opcode, Trade action, Hermit first-time gift)
- Say/chat (broadcast within INTEREST_RANGE, ChatMessage opcode, CLI chat mode with [t]alk)
- Auto-action resolver (context-sensitive cursor: pickup/harvest/attack/interact/move)
- Telemetry dashboard (per-phase CPU timing, network bytes, ANSI dashboard in separate module)
- E2E test scaffold (GameWorld.runTicks, HeadlessConnection, test helpers)
- Code debt round: CLI split into 6 modules, processAction refactored to dispatch, codec dedup, dashboard extracted, type helpers, Building.Door removed

**All 17 actions from the action taxonomy are implemented.**

## 144 Tests across 13 files — all passing

## Known Issues
- Rock terrain threshold (0.65) too high for MAP_SIZE=128 — zero rock tiles on most seeds. Fix: lower to ~0.50
- Large maps (1024+) still crawl on broadcastTick — O(entities×clients) visibility diff
- All critter AI runs globally even for critters far from all players

## Queued Work

### Scalability (next priority)
1. **Rock terrain fix**: Lower elevation threshold so rock/iron resources actually spawn
2. **Broadcast optimization**: Spatial index for visibility diff (currently O(entities×clients))
3. **Critter alive zones**: Only run AI for critters near players

### MCP Client (main remaining feature)
- Pull-based PlayerConnection implementation for LLM players
- Accumulate state, serve on tool call
- Uses shared ASCII map view for orientation

### Future
- 2D asset pipeline (web client)
- Campfire burn timer
- More NPC types
