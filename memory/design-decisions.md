# Design Decisions

## Architecture

**GameWorld encapsulates all state** — no module-level mutable globals anywhere. Systems are pure functions that take `world: SystemState`. This enables multiple isolated worlds (for E2E tests) in the same process.

**PlayerConnection (not "sink")** — user explicitly chose "Connection" over other names. Interface has 8 methods: onInitialState, onInventoryChanged, onTick, onChunkNeeded, onContainerOpen, onDialogueOpen, onChatMessage, onGameEvent. GameWorld never encodes wire format.

**SystemState interface** — lightweight subset of GameWorld. Unit tests create plain objects satisfying it without full GameWorld. GameWorld implements it. Avoids coupling test code to the full class. Includes `players` map so critter AI can iterate players directly (O(critters×players) not O(critters×entities)).

**processAction as switch/dispatch** — each of the 17 action types has its own private handler method. `cancelConflictingStates()` handles pre-action cleanup. Say is handled before cancellation (doesn't interrupt other actions).

**Hono server on one port** — MCP Streamable HTTP + WebSocket + static files all served from port 3001. Hono app created via factory function (`createApp(world)`) for testability.

## MCP Design

**Events emitted at authoritative source** — NOT reverse-engineered from deltas. GameWorld handlers emit directly via `onGameEvent`. System functions return enriched data (CombatResult with hits, HarvestEvent[], ConsumeEvent[], CritterBehaviorChange[]). GameWorld translates system returns to events.

**LLM "teleportation" model** — LLM players experience constant teleportation between tool calls. Every response is a full snapshot. Only emit events NOT inferrable from snapshots: damage causality, ephemeral chat, action interruption reasons. Snapshot-inferrable info (entity positions, who's nearby) comes from `<map>` and `<entities>` sections.

**Two continuity-preservation events** — `creature_fleeing` and `creature_died` kept at Medium priority despite being somewhat inferrable, because they bridge behavioral cause-and-effect chains.

**Action blocking model** — MCP action tools block via Promise. `awaitAction()` creates Promise, `onTick` resolves it when player's currentAction returns to Idle/Dead. Tick 1: if Idle → instant action (equip/craft/etc), resolve immediately. Subsequent ticks: wait for completion. 600-tick (30s) safety valve timeout.

**One McpServer per session** — tool handlers close over session-specific state (conn, entityId). Sessions stored in Map, persist until explicit DELETE. No inactivity timeout (user decision).

**McpConnection holds live GameWorldView ref** — reads entity state, terrain, inventory on demand. No delta accumulation needed (unlike WebSocket). EventBuffer for game events. Dialogue/container state cached from one-shot callbacks (not readable from world ref).

**Text formatters as pure functions** — take McpConnection, produce XML-tagged text. Reuse shared/src/ascii.ts chars. Token-efficient compact format. Item IDs prefixed with `#` in inventory/container for tool call references.

**MCP CLI test tool** — `scripts/mcp.ts` persists session in `.session` file. Auto-reconnects on stale session. Lists tools with no args, executes with `tool key=value` syntax.

## Building Layer vs Entities

**WoodenWall → building tile layer**. Static structures use `map.setBuilding()`. Synced via chunk streaming + tile deltas. No entity overhead.

**Door, Campfire, StorageChest → entities**. These have interactive behavior. Ground item detection: `!comp.statusEffects` distinguishes ground items from placed entities.

**Campfire has collides: true** — needed for cooking (server finds campfire via `occupancy.get(tileX, tileY)`).

## Game Mechanics

**No HillRock entity** — Terrain.Rock tiles are mineable directly.

**UseItemAt unifies cooking + placing** — Equip item → target tile → server resolves.

**UseConsumable is channeled, single-use** — unlike harvest (repeats), consumables complete once.

**Player death** — doesn't destroy the entity. Sets `ActionType.Dead`, drops equipped items, schedules respawn in 100 ticks.

**Fist as default weapon** — Player base damage=1, attackSpeed=2.

## Pathfinding & Movement

**maxSearchNodes=1000, reject if not found** — keep the limit fixed regardless of map size.

**Wait-and-repath** — blocked by entity → wait 10 ticks → re-path.

**Alternating diagonal cost** — 1, 2, 1, 2... (UO/d20 approach).

## World Generation

**Auto-scaling with MAP_SIZE** — `scale = MAP_SIZE / 128`. All noise frequencies divide by scale.

**NPC placement** — Hermit 8-15 tiles from spawn, Trader 10-20, Wanderer 30-45×scale.

## CLI

**Modular split** — 6 files. WebSocket connects to `/ws` path.

**Chat mode** — [t] enters typing mode, Enter sends, Esc cancels.

## Testing

**Load-bearing tests only** — test integrated behavior and side effects, not trivial property setting. E2E event tests verify full pipeline. MCP E2E tests start real Hono server, connect via SDK client, call tools, verify response format.

**E2E tests use GameWorld directly** — `createTestWorld()` + `addTestPlayer()` + `world.setAction()` + `world.runTicks(n)`.

**MCP E2E tests use real HTTP** — Hono server on random port, MCP SDK Client + StreamableHTTPClientTransport.
