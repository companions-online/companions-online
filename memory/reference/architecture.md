# Architecture

## Monorepo Layout

```
shared/src/     Shared types, constants, protocol codec, pathfinding, world gen, inventory logic
server/src/     Game server: GameWorld, ECS, systems, connections, MCP, telemetry, NPC dialogues
client/src/     Web client (esbuild, placeholder — CLI is primary client)
cli/            CLI game client: state, rendering, input, panels, connection handler (6 modules)
scripts/        Dev tools: map viewer, map stats, MCP CLI test tool
test/           Unit tests + test/e2e/ for behavioral E2E tests
plans/          Working docs + design seed documents (may be outdated — code is authoritative)
memory/         These orientation docs
```

## Server Stack

Hono HTTP server on port 3001, serving three concerns on one port:

```
POST/GET/DELETE /mcp  →  MCP Streamable HTTP (LLM players)
GET /ws               →  WebSocket upgrade (human/CLI players)
GET /*                →  static files (web client)
```

Dependencies: `hono`, `@hono/node-server`, `ws`, `@modelcontextprotocol/sdk`, `zod`

## Core Abstraction: GameWorld

`server/src/game-world.ts` — ALL mutable game state in one class. No module-level globals anywhere.

```
GameWorld implements SystemState {
  map: WorldMap              // terrain, buildings (tile layers with dirty tracking)
  entities: EntityManager    // ECS components
  occupancy: OccupancyGrid   // tile → entityId (Uint16Array)
  inventoryMgr: InventoryManager
  players: Map<entityId, PlayerSlot>
  observers: Map<observerId, ObserverSlot>  // negative-id keyed; passive viewers
  telemetry: Telemetry       // per-phase CPU timing + network bytes

  // System state Maps
  moveStates, harvestStates, combatStates, consumableStates, critterStates
  treeResources, respawnQueue, playerRespawnTimers

  // Pending async actions (walk-to-then-do): pickup, interact, transfer,
  // trade, dialogue_select, use_item_at — one queue, one resolver
  pendingActions

  addPlayer(connection: PlayerConnection): entityId
  removePlayer(entityId)
  addObserver(connection, focusX, focusY): observerId   // see Observer Mode
  removeObserver(observerId)
  setObserverFocus(observerId, focusX, focusY)
  setAction(entityId, action)  // queues pendingAction; runTick's action phase calls processAction(this, ...) from world-actions.ts
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
  onChatMessage(entityId, senderEntityId, message)
  onGameEvent(entityId, event: GameEvent)         // point-to-point (MCP first-person)
  onBroadcastEvent(entityId, event: GameEvent)    // spectator-range (WS visuals)
  onEntityMeta(entityId, targetEntityId, key, value)
}
```

Five implementations (three server-side, two in `client-webgl/src/network/standalone-connection.ts` for the in-tab build):
- **WebSocketConnection** (`server/src/connections/ws-connection.ts`) — binary protocol encoding. `onGameEvent` is a no-op (point-to-point events are MCP-only); `onBroadcastEvent` translates to `WireEvent` via `WIRE_EVENT_MAP`, queues in `pendingEvents`, flushes one `ServerOpcode.GameEvents` batch per tick after `WorldDelta`.
- **HeadlessConnection** (`server/src/connections/headless-connection.ts`) — test spy. Captures point-to-point events into `gameEvents[]` and broadcasts into `broadcastEvents[]` separately. Used by both player and observer tests (observer-channel events arrive with `entityId=0`).
- **McpConnection** (`server/src/connections/mcp-connection.ts`) — MCP player, holds live GameWorldView ref + EventBuffer, action blocking via onTick. `onBroadcastEvent` is a no-op — MCP narration stays first-person.
- **StandaloneConnection** (`client-webgl/src/network/standalone-connection.ts`) — in-tab player bridge. Implements both `PlayerConnection` (server-facing) and the client's `Connection` interface (client-facing). Forwards GameWorld callbacks straight into `scene.on*()` — bypasses the binary protocol. `bootStandalone(scene, seed)` factory.
- **StandaloneObserverConnection** (same file) — in-tab observer bridge. Narrower surface: no `send`, no inventory/container/dialogue routing. `bootStandaloneObserver(scene, seed)` factory wires it up with the autopilot camera.

## Event System

`server/src/events.ts` — 18 event types across 3 priority tiers (Critical/High/Medium). EventBuffer with priority-based decay and age-out.

Events emitted at authoritative sources: GameWorld handlers emit via **two channels**:

- `emitEvent(entityId, event)` — point-to-point to the subject. MCP consumes these for first-person narration (`"You hit X for 5 dmg"`). WS ignores (no-op today).
- `broadcastEvent(tileX, tileY, event)` — delivers to every player within `INTEREST_RANGE` of the event tile. Used for visual-impact events (hit landed, yield popped, entity died) so spectators' clients can render animations. MCP ignores broadcasts to avoid double-emission in its narration buffer.

The two channels are separate `PlayerConnection` methods (`onGameEvent` / `onBroadcastEvent`) so the MCP/WS consumer asymmetry is explicit per connection type. Migrating an emit site to broadcast is **additive** — keep the existing `emitEvent` call for MCP narration and add a `broadcastEvent` call for spectator visuals.

Wire format: `ServerOpcode.GameEvents = 0x37` carries a batched `WireEvent[]`. `WireEventType` is a numeric subset of `GameEventType` — only visual events cross the wire (combat hit dealt, harvest yield, craft complete, entity died). MCP-only events (`action_interrupted`, `creature_aggro`, `trade_complete`) stay off the wire. Mapping in `server/src/connections/wire-event-map.ts` (`WIRE_EVENT_MAP` + `toWireEvent`).

Design principle: only emit events NOT inferrable from state snapshots (damage causality, ephemeral chat, action interruption reasons). LLM experience is "constant teleportation" — full snapshot per response.

## MCP Layer

**McpConnection** — thin PlayerConnection impl. Holds live `GameWorldView` reference for on-demand reads (no delta accumulation). EventBuffer for game events. Action blocking: `awaitAction()` returns Promise, resolved by `onTick` when player's currentAction returns to Idle/Dead or 30s timeout. `sessionId` field set by `app.ts` on session init; used by `identify` to upgrade the session's entityId after spawning.

**mcp/tools.ts** — 21 tools (17 action + 4 query). `identify` is the only tool that runs pre-spawn; every other tool is wrapped by the `guarded(...)` helper that returns `NOT_IDENTIFIED` with `isError: true` when `conn.entityId === 0`. Action tools call `world.setAction()` + `await conn.awaitAction()`, then format the response using the shape matching what actually changed (see below). Query tools return immediately. Error returns use the CallToolResult `isError: true` field per MCP spec.

**mcp/session.ts** — session lifecycle. One McpServer + transport + McpConnection per session. `McpSession.entityId` starts at `0` (sentinel for "not identified"); `setSessionEntity` promotes it when `identify` spawns the player. `keepaliveTimer` holds a per-session `setInterval` that issues `server.server.ping()` every 15s (`.unref()`'d so it doesn't keep the process alive). `destroySession` clears the timer, resolves any pending action, and calls `removePlayer` only if `entityId !== 0`. Sessions persist until explicit DELETE or transport close.

**mcp/formatters.ts** — pure section functions (`formatSelf`, `formatMap`, `formatEntities`, `formatTerrain`, `formatEvents`, `formatInventory`, `formatRecipes`, `formatContainer`, `formatDialogue`) composed by a single `formatEnvelope(conn, actionText, shape)` function. `ResponseShape` is a 9-variant union (`full`, `full_inv`, `self_inv`, `transfer`, `dialogue`, `container`, `social`, `meta`, `rejected`) — each action tool picks the shape that reflects what its action actually changed. Pathfound actions (`harvest`, `pickup`) pick between compact (`self_inv`) and full (`full_inv`) by comparing player position pre/post. `interact` branches on side effects (dialogue/container/world). Cuts token usage on instant inventory-only actions and surfaces container/dialogue state directly in action responses. **Empty-section omission**: `formatEvents` returns `''` when the event buffer is empty, and `formatEnvelope` filters empty parts before joining — so `<events></events>` never ships as a stub. Any future formatter can opt into the same omit-when-empty rule by returning `''`.

**Identify + keepalive contract.** New MCP sessions stay entity-less until the client calls `identify(name)`. Pre-identify tool calls return an `isError` text block steering to identify. Node HTTP timeouts (`requestTimeout`, `headersTimeout`) are disabled in `main.ts` to keep long-lived SSE streams alive; a 15s MCP-native `ping()` interval per session produces real bytes on the standalone SSE stream so upstream proxies / harness liveness checks don't tear the stream down either. Background in `plans/plans/mcp-server-keepalive.md`.

**Action rejection channel.** Invalid actions (walk into wall, pickup non-item, craft without materials, etc.) route through `rejectAction(world, eid, reason)` (exported from `server/src/world-actions.ts`) → `PlayerConnection.onActionRejected` rather than silently returning. `reason` is a discriminated union defined in `server/src/action-rejection.ts` (`RejectionReason`); `formatRejection(r)` renders it to LLM-readable text at the MCP boundary, same pattern as `GameEvent` / `formatEventText`. `McpConnection` resolves `awaitAction` immediately with `{ status: 'rejected', reason }`, and `mcp/tools.ts::doAction` returns `text(formatEnvelope(..., ResponseShape.Rejected), { isError: true })` with a `[rejected: ...]` prefix in the action tag. **Rejected envelopes are minimal** — only `<action>` plus `<events>` if any fired. No `<self>` / `<map>` / `<entities>` / `<terrain>` / `<inventory>` snapshot replay; the LLM calls `get_surroundings` if it wants fresh state. Decision rationale: full-envelope on rejection doubled tokens of correction steps to repeat info the model already had from the last success. `WebSocketConnection` no-ops (WS renders its own collision feedback); `HeadlessConnection` captures into `rejections[]` for tests. Add new variants to the union when new rejection sites appear — no catch-all variant.

**Path-aware obstacle hints on movement rejections.** `tile_blocked` and `no_path` carry an optional `obstacles?: ObstacleSpan[]` populated by `diagnoseBlockage` (`server/src/path-diagnose.ts`), called from `setMoveTarget`'s three Err branches. The diagnoser runs a *permissive* `findPath` that drops the two recipe-bypassable obstacle classes — unbridged water/river and closed `WoodenDoor` occupancy — from the blocker predicate, then walks the resulting path classifying contiguous water runs (capped at 4 tiles per span) and closed doors (capped at 3, each carrying its `entityId`). `formatRejection` renders `"; water blocks at (a,b), (c,d) — build a wooden floor to cross"` and `"; closed wooden door#NNN at (x,y) — interact to open"` after the base message. Walls / fences / rock / non-door entities stay unenriched (no in-game bypass mechanic to point at). Permissive search runs only on the failure path, so the success path takes zero extra cost. If permissive also fails (rock-walled pocket etc.), `obstacles` is `[]` and the bare message ships unchanged. Same diagnosis fires for every walk-to-act handler that funnels through `setMoveTarget` (move_to / pickup / interact / transfer / trade / dialogue_select / use_item_at).

**ActionResult: helpers fail with structured reasons, handlers are shims.** Every mutating system helper that can reject (`setMoveTarget`, `startAttack`, `startHarvest`, `startConsume`, and the six `inventoryMgr.{equip,unequip,drop,craft,transferToContainer,transferFromContainer}`) returns `ActionResult = { ok: true } | { ok: false; reason: RejectionReason }` — defined alongside the union in `action-rejection.ts` with `Ok`, `OkValue<T>`, `Err(reason)` constructors (and `ActionResultOf<T>` for the `drop` case that carries the dropped item data). Validation (bounds, walkable, occupancy, target-exists, distance, weight, material, no-path) lives inside the helper; handlers pattern-match on the result and forward the reason via `rejectAction`. This kills the earlier "pre-validate in handler, re-validate in helper" duplication and eliminates the silent-failure class where a `void`/`false`-returning helper disagreed with a pre-check. (Transfer / DialogueSelect / Trade no longer use the `requireAdjacentTarget` preamble — they go through the unified pending-action queue, which resolves adjacency on arrival.)

**`setMoveTarget` mode: `'exact'` vs `'near'`.** Two call intents must coexist: player `move_to(x,y)` means "go exactly to that tile — if it's blocked, tell me", while pickup / interact / attack-chase / pending-action dispatch mean "go near that tile — route to an adjacent walkable cell if the goal itself is blocked". `setMoveTarget(eid, x, y, world, mode)` takes `'exact'` (rejects a blocked goal tile with `tile_blocked`) or `'near'` (default; relies on `findPath`'s internal blocked-goal → adjacent-walkable fallback). `handleMoveTo` uses `'exact'`; every other caller uses the default. The `'near'` fallback is what makes `use_item_at(woodFloor, riverX, riverY)` from 5 tiles away work — the river tile itself isn't walkable, so the player routes to a walkable shore tile within range 2 and places from there.

**Unified `pendingActions` queue.** Six actions need "walk to a target, then perform an effect" — pickup, interact, transfer, trade, dialogue_select, use_item_at. They share one map (`world.pendingActions`) and one resolver (`runPendingActions` in `server/src/pending-actions.ts`), running in the tick phase right after movement. Each handler dispatches via `scheduleOrExecute(world, eid, slot, kind, target, arrivalRange, executeFn)`: if the actor is already in range, run the effect synchronously (zero-tick completion preserves MCP `awaitAction`'s same-tick resolve); otherwise call `setMoveTarget('near')` and queue a `PendingAction`. The closure re-validates on arrival so a moving target / depleted inventory / dialogue option that vanished produces the right rejection. Resolver responsibilities: detect arrival, target loss (entity destroyed → `target_missing`), path failure (movement gave up → retry once, surface `no_path` if still unreachable), and entity re-aim (re-`setMoveTarget` whenever a mobile target's tile coord changes). Cancellation: `cancelConflictingStates` clears the entry on any new action and emits `action_interrupted` only when the new action's kind differs (same-kind re-issue is treated as a re-aim and stays quiet). Replaced two parallel `pendingPickups` / `pendingInteracts` maps that ignored `setMoveTarget`'s `Err` and silently dropped no-path failures — the unified path makes every walk-to-act failure surface a structured rejection.

## Harness + Eval

`harness/` holds three interchangeable LLM harness variants and an eval system that scores them on behavioral checkpoints.

**Variants** (all share `bootstrap.ts` for env/MCP/decider/memory/logger setup; `decider.ts` is the LLM abstraction with `decide() → { message, usage }`):
- `compact.ts` — rolling action window + last-perception snapshot rebuilt every turn into a 3-message prompt (system + assistant + tool). Self-contained: fold of the old `state.ts` + `prompt-builder.ts`.
- `baseline.ts` — accumulates the full message history (every assistant + tool + reasoning_details) and pings `user: "continue"` after each tool result. No truncation.
- `shortened.ts` — full history but turns older than the most recent 2 are collapsed via `compactOldTurns(messages, 2)` to a single `assistant` message composed verbatim of the assistant's inline content + `<thinking>` reasoning + `<tool>(<args>) → <action-tag>; events:[…said…, …died…]`. No truncation on any of the three components.

Each variant exports `run<Variant>(opts: RunVariantOpts): Promise<VariantResult>` and a CLI shim. `RunVariantOpts.onTurnComplete(step, usage)` lets the eval-runner observe tokens and short-circuit (`return 'stop'` → `stopReason: 'host_stop'`).

**Eval system** (`harness/eval/`):
- `match.ts` — `matches(checkpoint, event)` shallow-equals `checkpoint.match` against `event.details`.
- `scoreboard.ts` — `Scoreboard` attaches a `world.setEventObserver(...)` (added in `game-world.ts` — single observer, fires for both `emitEvent` and `broadcastEvent` channels). Resolves AI eid via `world.players.keys()` snapshot diff at first `'emit'` channel callback. Only first-person `'emit'` events count toward score.
- `eval-runner.ts` — orchestrates: `createDefaultWorld(seed)` (overridable via `worldFactory` for tests) + `createApp` + `serve` on ephemeral port + `GameLoop`. Sets `process.env.MCP_URL` so the harness connects to it. Runs the chosen variant with `maxSteps: maxTurns`. Stop reasons: `all_checkpoints` (early), `max_tokens`, `max_turns`, `aborted`, `error`. Writes `harness/eval/runs/<runId>.json`.
- `cli.ts` — `tsx harness/eval/cli.ts <llm-config-name> <eval-config-path>`; exit code = `score === total ? 0 : 1`.
- `configs/<name>.json` — eval definitions (harness variant, world seed, max turns/tokens, list of checkpoints).

Sample checkpoints (see `configs/survival-basics.json`): `harvest_yield {resourceName:"Wood"}`, `craft_complete {itemName:"Axe"}`, `entity_died {entityName:"Deer"}`, `item_cooked {outputName:"Cooked Meat"}`.

## SystemState Interface

`server/src/system-state.ts` — subset of GameWorld that system functions accept. Unit tests can create plain objects satisfying it without needing full GameWorld. Exposes `players` for efficient critter AI (iterates players, not all entities).

## Tick Loop Order

```
0. Process player respawns (dead → alive after 5s timer)
1. Process pending player actions (switch dispatch → 17 handler methods)
2. Critter AI (wander / flee / aggro decisions) → returns CritterBehaviorChange[]
3. World pulse — resource respawns (trees) + creature respawns (night skeleton spawner) + creature lifecycle (skeleton sun damage, returns deaths → processEntityDeath(killerEntityId=0))
4. Movement (A* pathfinding, occupancy collision, wait-and-repath; clearMoveTarget fires Idle on path end / unreachable)
5. Pending actions resolver — single queue covering pickup, interact, transfer, trade, dialogue_select, use_item_at. Detects arrival, target-loss, path failure, entity re-aim.
6. Harvest — pathfinding→channel transition (arrival flip) + channel tick + yield
7. Consumables — channel tick + heal
8. Combat (damage, death detection) → returns CombatResult { deaths, hits }
9. Broadcast (per-player visibility diff + chunk streaming + tile deltas) via PlayerConnection
10. Cleanup (clear dirty/destroyed + dirty tiles)
```

20Hz tick rate (50ms budget).

**Why arrival-triggered resolvers sit together right after movement**: both
the unified pending-actions resolver and harvest's pathfinding→channel flip
check `hasMoveTarget` to see whether the player has actually finished walking.
Before this order, harvest ran *before* movement, so on the arrival tick it saw
a still-pending move target, skipped the transition, and let `clearMoveTarget`
flip the player to `Idle`. The MCP tool then saw `Idle` on broadcast and
resolved as complete — with no yield. Placing harvest after movement lets the
flip happen atomically in the same tick as arrival, so the MCP player sees
`Harvesting` and keeps awaiting. The pending-actions resolver lives at the
same phase boundary for the same reason.

## Action System (17 actions)

Action dispatch lives in `server/src/world-actions.ts` — a flat sibling file to `game-world.ts`. `processAction(world, eid, slot, action)` is the switch/dispatch; individual `handle*` functions are module-private; `rejectAction` and `executeInteract` are the only other exports. Every handler is a free function taking `world: GameWorld` (matching `systems/*`). `game-world.ts` holds the state + tick orchestration; the action layer calls back into it via the now-public `emitEvent` / `broadcastEvent` / `makeEvent` / `bpName` methods.

`processAction` uses a switch/dispatch to handlers:
- **World**: MoveTo, Cancel, Attack, Harvest, Pickup, UseItemAt, Interact, Say
- **Inventory**: Equip, Unequip, Drop, UseConsumable, Craft, Transfer
- **NPC**: DialogueSelect, Trade

Say is instant and does NOT cancel other actions (can chat while harvesting).

Harvest has a server-side yield cap (`MAX_HARVEST_YIELDS` in `shared/constants.ts`, currently 5) — applies to all connection types. Prevents unbounded action duration on non-depleting targets (rock/water) and gives LLMs predictable pacing. For trees, natural depletion (5 wood) still wins on the same tick; for rocks/fish the cap terminates the channel.

## ECS

- `ComponentStore<T>` — generic Map<entityId, T> with auto-dirty on set()
- All 7 stores share one dirty Map (bitmask per entity)
- `EntityManager` — create/destroy + component stores + getFullState/getDeltaComponents

## Binary Protocol

Custom compact binary over WebSocket. Opcodes:
- Client→Server: Action (variable payload for 17 action types), Ping
- Server→Client: Welcome, Pong, WorldDelta, EntityFullState, Chunk, InventorySync, ContainerOpen, DialogueOpen, ChatMessage, EnvironmentSync, EntityMeta, GameEvents
- Component bitmask delta compression — only changed components sent
- RLE chunk compression for terrain
- Chunk streaming: only viewport chunks on connect, stream as player moves
- Environment section inside WorldDelta (gameMinute u16, weather u8) — emitted on keyframe-hour crossings, weather change, or forced resync after `setTickOffset`
- `GameEvents` batches discrete notifications (`WireEventType` — CombatHitDealt / HarvestYield / CraftComplete / EntityDied / PlayerHealed today). Flushed per-tick after WorldDelta so referenced entity ids are in-scope client-side. Separate channel from state replication — see Event System above.

## World Generation

Perlin noise, auto-scales with `MAP_SIZE / 128` ratio. Noise frequencies, spawn zones all proportional. Spawn density per-tile is constant. Currently MAP_SIZE=128.

NPCs spawned: Hermit (near spawn), Trader (near spawn), Wanderer (far, roams with critter AI).

## Entity Spawn Primitives

`server/src/entity-spawn.ts` — single source of truth for "what components does an entity have". Two helpers, both taking `SystemState`:

- **`spawnCreatureEntity(world, bp, x, y, overrides?)`** — full creature/structure shape: position, direction, waypoint, action, health (from `bp.maxHp`), blueprint+variant, statusEffects (`Placed` for placeable+Tree, else 0), speed, occupancy. Optional `CreatureOverrides` lets the load path supply saved values for direction/waypoint/action/health/statusEffects/speed and a pre-supplied `id` (passed to `entities.createWithId`). The helper carries the **Open-bit occupancy gate**: if the resolved `statusEffects` has `StatusEffect.Open` set, the entity is NOT registered in the occupancy grid — open doors are walk-through, and a saved open door must reload that way (otherwise it phases back into a blocker). Fresh spawns never have the Open bit so the gate is a no-op for them.
- **`spawnGroundItem(world, bp, x, y, id?)`** — position + blueprint only. No statusEffects component, no occupancy. The absence of `StatusEffect.Placed` is what distinguishes ground items from placed structures (per `status-effects.ts::isPlaced`).

Two classifiers:

- **`isGroundItemBlueprint(bp)`** — worldgen / `/spawn` classifier. Returns true for resource/item categories (excluding Tree). Placeables → false (worldgen places them as installed structures; `/spawn` rejects placeable category). Used by `createDefaultWorld` and `createNewWorld`'s spawn loop.
- **`shouldRestoreAsGround(bp, statusEffects)`** — load classifier. Pickup-categorical (resource/item/placeable, not Tree) AND no Placed bit → ground. Placeables saved without Placed (dropped from inventory) reload as ground items; same blueprints saved with Placed (installed via `UseItemAt`) reload as structures. Used by `loadWorld`.

The same primitives back: fresh worldgen (`createDefaultWorld` / `createNewWorld`), tree respawn (`systems/resources.ts`), night skeleton spawn (`systems/creature-lifecycle.ts`), `/spawn` server command, save-load restore (`loadWorld`), inventory drop (`world-actions.ts::handleDrop`), and creature death loot drops + player death equipped drops (`game-world.ts`).

The `world-actions.ts::handleUseItemAt` placement path is intentionally NOT routed through these — it has bespoke shape (sets `Placed` always, conditionally creates a chest inventory, gates occupancy on `bp.collides`, removes the source item) and isn't drift-prone in practice.

## Building Layer vs Entities

Static structures (WoodenWall, WoodenFloor, StoneFloor) → building tile layer (`map.setBuilding()`), synced via chunk/tile deltas. `blueprintToBuilding()` in `shared/src/blueprints.ts` is the single source of truth: a non-null return routes the placement through the building-tile branch in `handleUseItemAt`. Walls block movement; floors are walkable and can bridge rivers (see `isWalkable` / `isPlaceable` below).
Interactive placeables (Door, Campfire, StorageChest) → entities with components (statusEffects, optional health). Placed vs ground-item is keyed on the `StatusEffect.Placed` bit — `isPlaced(se)` in `shared/src/status-effects.ts` is the canonical check used by the MCP formatter, WebGL cursor/click routing, and CLI render. `handleUseItemAt` sets the bit on placement; `spawnCreatureEntity` sets it at worldgen for `category === 'placeable'` entities and Trees; `handleDrop` + `spawnGroundItem` leave it off. Persistence round-trips the bit inside the existing statusEffects byte.

## Terrain Predicates (walk / place / light)

`shared/src/terrain.ts` exposes three predicates, each answering a different question about a tile:

- **`isWalkable(terrain, building)`** — can an entity stand on and traverse this tile? Water and rock are never walkable; walls and fences block; river is only walkable when bridged by a WoodenFloor/StoneFloor; everything else walkable. Used by pathfinding, movement, AI, and every server-side reachability check.
- **`isPlaceable(terrain, currentBuilding, newBuilding | null)`** — can `newBuilding` be placed on this tile (or an entity if `null`)? Two-mode predicate. **Entity placement** (`newBuilding === null` — Door / Chest / Campfire): legal anywhere a player can stand, i.e. delegates to `isWalkable(terrain, current)`. Floors are fine (furnish-the-house case); walls/fences are not; water/rock are not; bridged river is fine. **Building-tile placement** (`newBuilding !== null` — Wall / WoodenFloor / StoneFloor): no stacking (`current` must be `None`); water/rock never placeable; river only placeable when the new building is a floor (bridging). Called from `handleUseItemAt`'s pre-check in place of the old `isWalkable`-based check, because walls-on-grass and floors-on-river are both valid but can't both be expressed as "currently walkable" — and floors-with-furniture is a third case that the entity branch handles by reusing `isWalkable`.
- **`isLightPassing(terrain, building)`** — does the shadowcaster's ray pass through this tile? Walls/fences block; water/rock block (preserves pre-split behavior); river, floors, grass/dirt/sand pass. Used by `client-webgl/src/lighting/lighting.ts` shadowcast blocker. Split out so rivers can be non-walkable while still transmitting light.

The three are thin pure functions over the same `(terrain, building)` pair; the WorldMap class exposes one-argument wrappers (`map.isWalkable(x, y)`, etc.).

## Player Death + Respawn

Players don't get destroyed on death. Instead: `ActionType.Dead` set, equipped items dropped as ground entities, occupancy cleared, 100-tick respawn timer. On respawn: teleport to spawn, HP restored, action set to Idle.

Server-side AI cleanup on death: `clearAiTargetsOn(deadEntityId)` iterates `critterStates` + `combatStates` and clears targets pointing at the dead entity. Called from both `handlePlayerDeath` (player entity persists, so critter-ai's `entities.exists()` check wouldn't catch it) and `processEntityDeath` (upfront cleanup is immediate rather than waiting for next-tick scan). `critter-ai.ts` also skips Dead players when scanning for nearest aggro target, so a revived player won't be re-aggroed.

Client-side death visuals: see `memory/client-webgl/architecture.md::Death visuals` — smoke puff spawned on both `EntityDied` wire event (creatures) and `currentAction → Dead` transition (player entity persists). Respawn position deltas snap instead of lerping.

## Observer Mode

A passive viewer with no in-world entity. Implemented as a parallel
collection (`observers: Map<observerId, ObserverSlot>`, ids negative
to never collide with positive entityIds) that rides the same
broadcast plumbing as players. `addObserver(connection, focusX, focusY)`
streams the initial chunks around the focus and fires
`onInitialState(0, this)` (entityId 0 = observer-channel sentinel).

The per-tick broadcast loop in `game-world.ts::broadcastTick` extracts
a `streamToTarget(centerX, centerY, knownEntities, sentChunks, ...,
connection)` helper that builds one viewer's `TickDelta` against any
interest center. Two short loops then drive it once per slot:

```
for (eid, slot) in players:
  pos = entities.position.get(eid)
  delta = streamToTarget(pos.tileX, pos.tileY, slot.known/sent..., slot.connection)
  slot.connection.onTick(eid, this, delta)

for slot in observers:
  delta = streamToTarget(slot.focusX, slot.focusY, slot.known/sent..., slot.connection)
  slot.connection.onTick(0, this, delta)
```

`broadcastEvent`, `setEntityMeta`, and `world-actions.ts::handleSay`
all gained parallel observer loops range-tested against
`slot.focusX/focusY` so observers receive nearby visual events,
nameplate updates, and chat. Point-to-point `emitEvent` deliberately
does NOT reach observers — it's first-person narration to the subject,
and observers have no entity to be the subject of.

What observers don't get (by construction): no `onInventoryChanged`
(no inventory), no `onContainerOpen`/`onDialogueOpen` (no actions to
trigger them), no `onActionRejected` (can't act). Standalone observer
connection no-ops these to satisfy the `PlayerConnection` interface.

Observer entity-id space is negative; observer is invisible to other
players because it has no entity in `world.entities` at all (so it
never enters another player's `entered` set, doesn't appear in
nameplate broadcasts, doesn't occupy a tile). Free invariant from the
data layout.

Today's only consumer is the standalone build's background world
(`bootStandaloneObserver` in `client-webgl/src/network/standalone-connection.ts`),
which adds one observer at SPAWN and runs an autopilot camera that
calls `setObserverFocus` whenever the rounded focus tile changes.
Future consumers (godview debug tooling, networked spectator mode)
plug into the same `addObserver`/`setObserverFocus` API. Coverage in
`test/e2e/observer.test.ts` (10 cases).

## Telemetry

`server/src/telemetry.ts` — per-phase CPU timing (circular buffer, rolling averages), network bytes by connection type.
`server/src/dashboard.ts` — ANSI dashboard rendering, refreshes every second.
