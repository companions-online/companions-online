# Design Decisions

## Architecture

**GameWorld encapsulates all state** — no module-level mutable globals anywhere. Systems are pure functions that take `world: SystemState`. This enables multiple isolated worlds (for E2E tests) in the same process. The refactor moved ~15 module-level Maps/variables into GameWorld.

**PlayerConnection (not "sink")** — user explicitly chose "Connection" over "Sink", "Adapter", "Port", "Bridge", "Transport". Interface has 3 methods: onInitialState, onInventoryChanged, onTick. GameWorld never encodes wire format.

**SystemState interface** — lightweight subset of GameWorld. Unit tests create plain objects satisfying it without full GameWorld. GameWorld implements it. Avoids coupling test code to the full class.

## Game Mechanics

**No HillRock entity** — Terrain.Rock tiles are mineable directly. Originally had BlueprintType.HillRock but removed it — spawning hundreds of entities for infinite resources was wasteful. The harvest system checks terrain type when no entity is found at the target.

**Placeables are stackable + equippable** — All placeables (Campfire, WoodenWall, WoodenDoor, StorageChest) have `stackable: true, maxStack: 10, equipSlot: 'hand'`. Same for tools, weapons, armor. User explicitly requested this.

**UseItemAt unifies cooking + placing** — Equip item in hand → target tile → u key. Server resolves: RawFish/RawMeat at campfire → cook. Placeable category → spawn world entity. Single action, two behaviors.

**Fist as default weapon** — Player base damage=1, attackSpeed=2 ticks. Weapons override both via blueprint weaponDamage/weaponSpeed.

## Pathfinding & Movement

**maxSearchNodes=1000, reject if not found** — user decision: players click nearby, don't need cross-map pathfinding. Keep the limit fixed regardless of map size.

**Wait-and-repath for dynamic collision** — When movement is blocked by another entity, wait up to 10 ticks (WAIT_PATIENCE), then re-path with A* (blocker is in occupancy grid). Handles convergence, head-on, and chain cases.

**Alternating diagonal cost** — 1, 2, 1, 2... per diagonal step (UO/d20 approach, ~6% error from √2). Tracked per-entity as `diagonalCheap` boolean.

## World Generation

**Auto-scaling with MAP_SIZE** — `scale = MAP_SIZE / 128`. All noise frequencies divide by scale. Critter/skeleton clear zones multiply by scale. Spawn density per-tile stays constant (more tiles = more entities proportionally). Spawn clear zone around player stays fixed at 5 tiles.

**Flee cooldown** — 10 ticks between flee segments to prevent critters from appearing to teleport. Bug was: executeFlee had zero delay between reaching destination and picking next flee target.

**Loot drops as individual entities** — Each quantity unit spawns a separate ground entity. `processEntityDeath` loops `drop.quantity` times. Simpler than tracking quantity on ground items.

## CLI

**Speculative action label** — Status bar shows `[enter]chop` / `[enter]mine` / `[enter]attack Bear` etc. Computed each render via `resolveAction` + `describeAction`. User explicitly requested this.

**Esc navigates up** — Crafting→Inventory→Map. Bare escape (`\x1b` length 1) vs arrow sequences (`\x1b[A` length 3).

**Harvest progress** — Status bar shows `+N ItemName` accumulator. Tracks via inventory diff on InventorySync while player action is Harvesting. Clears 1.5s after harvest ends.

**Health always visible** — `HP:80/100` in status bar. Combat shows target: `Attacking Bear (20/40 HP)`.

## Testing

**E2E tests use GameWorld directly** — `createTestWorld()` + `addTestPlayer()` + `world.setAction()` + `world.runTicks(n)`. No WebSocket needed. HeadlessConnection captures events for assertion.

**Unit tests use SystemState mock objects** — Plain objects with the needed Maps, not full GameWorld. Zero migration cost when GameWorld changes.
