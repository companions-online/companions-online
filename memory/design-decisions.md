# Design Decisions

## Architecture

**GameWorld encapsulates all state** — no module-level mutable globals anywhere. Systems are pure functions that take `world: SystemState`. This enables multiple isolated worlds (for E2E tests) in the same process.

**PlayerConnection (not "sink")** — user explicitly chose "Connection" over other names. Interface has 7 methods: onInitialState, onInventoryChanged, onTick, onChunkNeeded, onContainerOpen, onDialogueOpen, onChatMessage. GameWorld never encodes wire format.

**SystemState interface** — lightweight subset of GameWorld. Unit tests create plain objects satisfying it without full GameWorld. GameWorld implements it. Avoids coupling test code to the full class. Includes `players` map so critter AI can iterate players directly (O(critters×players) not O(critters×entities)).

**processAction as switch/dispatch** — each of the 17 action types has its own private handler method. `cancelConflictingStates()` handles pre-action cleanup. Say is handled before cancellation (doesn't interrupt other actions).

## Building Layer vs Entities

**WoodenWall → building tile layer**. Static structures use `map.setBuilding()`. Synced via chunk streaming + tile deltas. No entity overhead — a 10x10 building is 100 bytes of tile data, not 100 entities.

**Door, Campfire, StorageChest → entities**. These have interactive behavior (toggle, cooking, storage) that needs entity state. User explicitly chose this split.

**Ground item detection** — placed entities get `statusEffects` component on placement. Ground items (from Drop) only have position+blueprintId. `!comp.statusEffects` distinguishes them reliably. Used by action resolver to decide Pickup vs Interact.

**Campfire has collides: true** — needed for cooking (server finds campfire via `occupancy.get(tileX, tileY)`). Also means pathfinding routes around it.

**Building.Door removed from terrain.ts** — doors are entities, not building tiles. The Building enum only has Wall, Floor, Fence.

## Game Mechanics

**No HillRock entity** — Terrain.Rock tiles are mineable directly. The harvest system checks terrain type when no entity is found at the target.

**Placeables are stackable + equippable** — All placeables have `stackable: true, maxStack: 10, equipSlot: 'hand'`. Same for tools, weapons, armor. RawMeat/RawFish also have `equipSlot: 'hand'` so they can be equipped and used at campfire via UseItemAt.

**UseItemAt unifies cooking + placing** — Equip item in hand → target tile → [u] key. Server resolves: RawFish/RawMeat at campfire → cook. Placeable category → spawn world entity or set building tile.

**UseConsumable is channeled, single-use** — unlike harvest (which repeats), consumables complete once then stop. Bandage: 30HP over 10 ticks. Food: 15-20HP over 3 ticks. Interrupted by any other action.

**Say doesn't cancel other actions** — you can chat while harvesting, attacking, etc. Handled before `cancelConflictingStates` in processAction.

**Player death** — doesn't destroy the entity (unlike critters). Sets `ActionType.Dead`, drops equipped items as ground entities, clears occupancy, schedules respawn in 100 ticks (5s). Actions blocked while dead. Guard against re-death (wolf re-aggro on corpse resetting respawn timer).

**Fist as default weapon** — Player base damage=1, attackSpeed=2 ticks. Weapons override both via blueprint weaponDamage/weaponSpeed.

## Pathfinding & Movement

**maxSearchNodes=1000, reject if not found** — user decision: players click nearby, don't need cross-map pathfinding. Keep the limit fixed regardless of map size.

**Wait-and-repath for dynamic collision** — When movement is blocked by another entity, wait up to 10 ticks (WAIT_PATIENCE), then re-path with A*.

**Alternating diagonal cost** — 1, 2, 1, 2... per diagonal step (UO/d20 approach, ~6% error from √2).

## World Generation

**Auto-scaling with MAP_SIZE** — `scale = MAP_SIZE / 128`. All noise frequencies divide by scale. Spawn density per-tile stays constant.

**NPC placement** — Hermit 8-15 tiles from spawn, Trader 10-20 tiles, Wanderer 30-45×scale tiles. Each tries 50 random positions in their distance band. Wanderer gets critter AI config (wander, long idles, speed 1).

## Chunk Streaming

**Viewport-only on connect** — only sends chunks within INTEREST_RANGE of player (25 vs 1024 for full map). Streams new chunks as player moves.

**Tile deltas** — dirty tiles tracked in WorldMap. Broadcast to players who have the affected chunk.

## CLI

**Modular split** — 6 files: client.ts (entry), state.ts (shared state + type helpers), connection.ts (message handling), render.ts (viewport + status), panels.ts (inventory/crafting/container/dialogue), input.ts (keyboard + actions).

**Type helpers** — `getHp()`, `getBpId()`, `getEffects()`, `getActionType()` eliminate `as any` casts for variant component types.

**Chat mode** — [t] enters typing mode, printable chars build message, Enter sends Say, Esc cancels. Recent messages overlaid on map for 5 seconds.

## Testing

**E2E tests use GameWorld directly** — `createTestWorld()` + `addTestPlayer()` + `world.setAction()` + `world.runTicks(n)`. No WebSocket needed. HeadlessConnection captures events for assertion.

**Unit tests use SystemState mock objects** — Plain objects with the needed Maps, not full GameWorld. Must include `players: new Map()` and `consumableStates: new Map()`.
