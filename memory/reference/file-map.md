# File Map

## shared/src/
```
index.ts                 Barrel re-export of everything
constants.ts             TICK_RATE=20, MAP_SIZE=128, CHUNK_SIZE=16, VIEW/INTEREST_RANGE, SPAWN, TICKS_PER_GAME_MINUTE/HOUR, GAME_MINUTES_PER_DAY, TICKS_PER_GAME_DAY
lighting.ts              Day/night keyframes, ambientTint, gameMinuteFromTick/gameHourFromTick, KEYFRAME_HOURS, TWILIGHT_TICK_OFFSET
actions.ts               ActionType enum (Idle..Consuming), ClientAction enum (Cancel..Say, 17 total)
blueprints.ts            Blueprint interface + ~37 types, blueprintToBuilding() maps WoodenWall→Wall, WoodenFloor→WoodenFloor, StoneFloor→StoneFloor (+ optional lightRadius, lightColor on Blueprint; Campfire sets both)
recipes.ts               17 crafting recipes (tools, weapons, armor, placeables, bandage)
inventory.ts             InventoryItem/Inventory types, pure helpers (getWeight, canCraft, equipSlot conversions)
loot-tables.ts           Drop tables per creature (deer→hide+meat, skeleton→iron+rock, etc.)
pathfinding.ts           A* with 8-dir movement, alternating diagonal cost, no corner cutting
action-resolver.ts       resolveAction (auto-detect MoveTo/Pickup/Harvest/Attack/Interact) + describeAction
ascii.ts                 terrainChar, buildingChar, blueprintChar (with door open/closed), tileChar
components.ts            ComponentBit enum (7 synced components), wire data interfaces
coordinates.ts           tileToScreen / screenToTile isometric helpers
direction.ts             Direction enum (8-dir), DX/DY arrays, isDiagonal
terrain.ts               Terrain/Building enums (Wall, WoodenFloor, StoneFloor, Fence — no Door); isWalkable (river walkable only when bridged by floor); isPlaceable (terrain, current, newBuilding|null) for handleUseItemAt pre-check; isLightPassing for shadowcast
status-effects.ts        StatusEffect bitmask (Poisoned, Slowed, Hasted, Stunned, Open, Placed) + isPlaced(se) helper
protocol/opcodes.ts      Client/Server opcodes incl ContainerOpen, DialogueOpen, ChatMessage, EntityMeta=0x36, EnvironmentSync, GameEvents=0x37; DeltaSectionTag.Environment; WireEventType enum (numeric subset of GameEventType for the wire)
protocol/codec.ts        BufferWriter/Reader, encode/decode for all message types incl ServerCommand action, EntityMeta msg, GameEvents batch (encodeGameEvents/decodeGameEvents + WireEvent discriminated union), DecodedAction union
entity-meta.ts           MetaKey enum (Name=0) + metaKeyLabel — observer-visible string metadata
protocol/index.ts        Barrel re-export
world/noise.ts           Seeded 2D Perlin noise (PerlinNoise class)
world/world-map.ts       WorldMap class (flat Uint8Array terrain/buildings, chunk extraction, dirty tracking)
world/world-gen.ts       generateWorld(seed) — auto-scaling Perlin island, trees, critters, NPCs
world/index.ts           Barrel re-export
```

## server/src/
```
main.ts                  Entry: createNewWorld/loadWorld + Hono server + GameLoop. Dashboard keys s/p/q/d (d = dumpWorld). Warns at boot when stdin isn't a TTY so dashboard keys won't work (e.g. under concurrently).
app.ts                   Hono app factory: MCP routes + WS upgrade + static serving
game-world.ts            GameWorld class — state container + runTick orchestration + player lifecycle + event emission (public emitEvent point-to-point + broadcastEvent to nearby + makeEvent + bpName). processEntityDeath + handlePlayerDeath + clearAiTargetsOn + spawnCreatureEntity/spawnGroundItem live here; action dispatch moved to world-actions.ts. Weather + tickOffset + effectiveTick getter; env section emission on keyframe crossings.
world-actions.ts         Player action dispatch layer — processAction (switch), cancelConflictingStates, rejectAction, all 17 handle* (MoveTo..ServerCommand), executeInteract, toggleDoor. Free functions taking world: GameWorld (same shape as systems/*). Handlers are thin shims over ActionResult-returning helpers; walk-to-act handlers (Pickup, Interact, Transfer, Trade, DialogueSelect, UseItemAt) dispatch via scheduleOrExecute from pending-actions.ts.
pending-actions.ts       Unified walk-to-then-act queue. PendingAction type, scheduleOrExecute dispatch helper, runPendingActions resolver (post-movement tick phase). Detects arrival, target-loss (target_missing), path failure (no_path on retry), and entity re-aim. Replaces the prior parallel pendingPickups + pendingInteracts maps; extends the same shape to transfer, trade, dialogue_select, and use_item_at (placement + cooking).
action-rejection.ts      RejectionReason discriminated union + formatRejection renderer + ActionResult / ActionResultOf<T> types with Ok/OkValue/Err constructors. ObstacleSpan (water | door) hangs off tile_blocked / no_path so movement rejections carry route-aware hints.
action-helpers.ts        requireAdjacentTarget(actorId, targetId, world, opts?) — vestigial. Was the shared target_missing | wrong_target_kind | not_adjacent preamble for Transfer / DialogueSelect / Trade before they migrated to scheduleOrExecute. No live callers; kept until next cleanup pass.
path-diagnose.ts         diagnoseBlockage — runs a permissive findPath that drops unbridged-water + closed-WoodenDoor occupancy from the blocker predicate, then walks the resulting path to emit ObstacleSpans (water grouped, doors per-tile). Called from setMoveTarget's three Err branches; returns [] when the permissive search also fails.
system-state.ts          SystemState interface + MovementState/HarvestState/CombatState/ConsumableState/CritterState
player-connection.ts     PlayerConnection interface (10 methods incl onGameEvent point-to-point + onBroadcastEvent spectator-range) + TickDelta + GameWorldView
events.ts                18 GameEvent types, EventPriority, EventBuffer with priority decay + age-out. Details for combat_hit_dealt / harvest_yield / craft_complete carry actor id (attackerEntityId / harvesterEntityId / crafterEntityId) so broadcast wire events can identify the actor.
occupancy.ts             OccupancyGrid — single-blocker per tile (players, critters, NPCs, placed entities, trees). Not tracked: ground items, corpses, building-layer walls. Ownership-enforced API: set/clear/move assert tile owner matches; violations routed to onViolation (wired to world.log.error) without throwing.
world-logger.ts          Per-world WorldLogger (info/warn/error + assert). createFileLogger writes JSONL to data/worlds/<id>/server.log; createMemoryLogger retains entries for tests (expectCleanLog helper asserts zero warn+error).
world-dump.ts            Reflective world-state dumper for the `d` debug key. serializeWorld/dumpWorld handle Map/Set/TypedArray/ComponentStore/Date/circular. SKIP_KEYS (connection/telemetry/log) + SKIP_PATHS (map.terrain/buildings/buildingMeta). EntityManager serialized only at world.entities; elsewhere collapsed to __ref.
inventory-manager.ts     InventoryManager class (add/remove/equip/craft/drop/transfer)
telemetry.ts             Telemetry class (per-phase timing, network bytes, rolling averages)
dashboard.ts             ANSI telemetry dashboard rendering; shows in-game time HH:MM in header
world-persistence.ts     saveWorld/loadWorld/createNewWorld; tickOffset on meta, createNewWorld seeds TWILIGHT_TICK_OFFSET
npc-dialogues.ts         Static dialogue trees + trade offers for Hermit, Trader, Wanderer
server-commands.ts       Slash-command registry + dispatcher; built-in /nick /name → handleNick
mcp/tools.ts             21 MCP tool registrations (identify + 16 action + 4 query); all but identify wrapped by guarded(...) that rejects pre-identify with isError:true. Rejections route through ResponseShape.Rejected (action+events only) — no snapshot replay.
mcp/session.ts           MCP session lifecycle (create/destroy/lookup, session Map); per-session 15s ping keepalive timer; setSessionEntity promotes entityId after identify
mcp/formatters.ts        Text formatters: self, map, entities, terrain, events, inventory, recipes, container, envelopes. formatEvents returns '' on empty buffer (omitted by formatEnvelope's part-filter); ResponseShape adds Rejected (events-only).
mcp/config.ts            MCP-side rendering config (e.g. mapLinePrefix).
ecs/component-store.ts   ComponentStore<T> — generic Map with auto-dirty
ecs/entity-manager.ts    EntityManager — entity lifecycle, 7 component stores, dirty/destroyed tracking
ecs/game-loop.ts         GameLoop — setTimeout with drift compensation
systems/movement.ts      A* path-following, occupancy collision, wait-and-repath. setMoveTarget returns ActionResult; takes mode: 'exact' | 'near' ('exact' rejects blocked goal; 'near' routes to adjacent walkable via findPath fallback). clearMoveTarget resets currentAction=Idle + nextWaypoint=NONE when a moveState is actually deleted (single "entity stopped moving" primitive; arriveIdle was collapsed into it).
systems/harvest.ts       Channeled gathering, auto-pathfind to adjacent, tree depletion → returns HarvestEvent[]
systems/consumable.ts    Channeled healing, single-use, interruptible → returns ConsumeEvent[]
systems/combat.ts        Attack system — pathfind+swing+damage, auto-follow → returns CombatResult { deaths, hits }. startAttack + per-swing sets attacker direction via dirFromTo so swing animation faces target. startAttack is side-effect-free on Err: the non-adjacent branch relies on setMoveTarget's atomic-on-Ok / no-op-on-Err contract; only the adjacent branch calls clearMoveTarget. critter-ai reuses startAttack as its reachability probe.
systems/critter-ai.ts    Wander/flee/aggro/passive behaviors → returns CritterBehaviorChange[]. Skips Dead players when scanning for nearest aggro target. Wander→aggro transition commits only when startAttack returns Ok (reachability gate); failure sets CritterState.aggroProbeCooldown (DEFAULT = 20 ticks) to throttle the next probe. executeAggro drops back to wander if startAttack starts failing mid-chase. notifyCritterAttacked applies the same gate so unreachable attackers don't lock a critter into aggro.
systems/harvest.ts       (see above) — faceHarvestTarget helper sets harvester direction when entering Harvesting state so harvest-craft anim plays toward the target.
systems/resources.ts     Tree resource pools (5 wood), respawn queue (30s delay). Exports runResourceRespawns (renamed from runRespawns as part of the worldPulse split).
systems/creature-lifecycle.ts   Night skeleton spawner + sunrise decay. runCreatureRespawns rolls 1/720 per tick at night and spawns a skeleton 10–20 tiles from any player on an unlit, walkable, unoccupied tile (AABB light check, no shadowcast). runCreatureLifecycle pulses 4 damage every 25 ticks on all living Skeletons during daylight; returned deaths route through processEntityDeath with killerEntityId=0.
connections/ws-connection.ts      WebSocket PlayerConnection (binary encoding, byte counting); sends EnvironmentSync on welcome + environment delta section in onTick. onGameEvent no-op (point-to-point is MCP-only); onBroadcastEvent translates via WIRE_EVENT_MAP and flushes a GameEvents batch per tick after WorldDelta.
connections/headless-connection.ts HeadlessConnection (test spy, captures events + gameEvents[] for point-to-point + broadcastEvents[] for broadcasts)
connections/mcp-connection.ts     MCP PlayerConnection (live world ref, EventBuffer, action blocking via awaitAction/onTick)
```

## cli/
```
client.ts       Entry point: WebSocket connect to /ws, wire modules (~30 lines)
state.ts        Shared mutable state object, type helpers (getHp, getBpId, getEffects, getActionType)
connection.ts   Server message handler (switch dispatch, state updates, chat log)
render.ts       Main render function, viewport, status bar, cursor context, chat overlay
panels.ts       Panel renderers (inventory, crafting, container, dialogue)
input.ts        Keyboard handler, mode-specific dispatch, chat input mode, action execution
```

## scripts/
```
view-map.ts     Static fullscreen ASCII map viewer (npm run cli:map [seed])
map-stats.ts    Terrain/entity/elevation statistical analysis (npm run cli:stats [seed])
mcp.ts          MCP CLI test tool (npm run cli:mcp [tool] [key=value ...]), session persistence in .session
death-debug.ts  Death debugging helper
world-dump-view.ts  Forensic viewer for dashboard-`d` dumps. Commands: overview, stuck, near <x> <y> [r], entity <eid>, find <bp>, state <mapName> [eid], keys. Takes either a dump file or a world dir (picks latest). See `memory/reference/debug-tools.md`.
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
events.test.ts           EventBuffer priority decay, age-out, critical overflow
e2e/helpers.ts           createTestWorld, addTestPlayer, placeTree, placeGroundItem
e2e/gather-craft.test.ts Full gameplay: harvest→craft→equip→drop→pickup→place
e2e/combat.test.ts       Attack→damage→death→loot, weapon damage, flee, aggro, player death+respawn
e2e/building.test.ts     Wall placement, door toggle, pathfinding, container transfer
e2e/npc.test.ts          NPC dialogue, trade, Hermit first-time gift
e2e/consumable.test.ts   Bandage/food healing, interruption, HP cap
e2e/chat.test.ts         Say broadcast, range filtering, non-interruption
e2e/events.test.ts       Event emission from all 18 event types through real game actions
e2e/broadcast-events.test.ts Spectator-range broadcastEvent scope — attacker + near spectator see CombatHitDealt / EntityDied; far-away player doesn't; point-to-point events don't leak onto broadcast channel.
e2e/death-target-clearing.test.ts Wolf drops target when the player it's attacking dies (behavior → wander, combat state cleared).
e2e/environment.test.ts  Env sync emission cadence + tickOffset behavior + effectiveTick math
e2e/mcp-e2e.test.ts      Real server E2E: MCP client → HTTP → tools → game → response format; identify lifecycle; nametag broadcast
mcp-keepalive.test.ts    Per-session ping cadence, cleanup on destroy, rejection swallow (unit-level)
lighting.test.ts         Keyframe interpolation + gameMinute math
persistence.test.ts      Save/load round-trip + tickOffset carrying
world-logger.test.ts     Memory logger: capture + warn/error counts + assert pass/fail
world-dump.test.ts       serializeWorld round-trip + skips + TypedArray stub + disk write + reflection of new fields + ref collapsing
client-gl/shadowcast.test.ts  Per-target raycast + blocker behavior + wall occlusion
client-gl/scene.test.ts       Scene mutators + factory dispatch + capacity + onGameEvent dispatch + smoke-puff spawn (via EntityDied + Dead-transition paths) + Dead→Idle snap
client-gl/effects.test.ts     Damage number + pickup text + chat bubble lifecycle
e2e/event-observer.test.ts    GameWorld.setEventObserver fires for emit + broadcast channels; observer-throws don't break runTicks
movement-edge-cases.test.ts   Regression file for movement/pathfinding/combat-chase: move_to rejection plumbing (wall / door-entity / no_path); critter-stuck-animation + aggro-give-up; door close guard (3 tests covering occupancy-phasing repro); walled-in-player wolf stays in wander + Walking-without-moveState invariant; pickup boxed-in + item-boxed-in = no_path. Corner-diagonal clip-through + river-walkability open as design items — not tracked here.
pending-actions.test.ts       Coverage for the unified pendingActions queue. Base cases: pickup, interact (door/chest), transfer, dialogue_select, trade, use_item_at on walkable tile, use_item_at on river (river-floor case), cooking, plus already-adjacent zero-tick fast path. Interrupt cases: target destroyed mid-walk → target_missing, path becomes unreachable mid-walk → no_path, new action mid-walk → action_interrupted event, player dies mid-walk → entry cleared, mobile entity target moves → resolver re-aims, inventory fills mid-walk → inventory_full on arrival.
```

## harness/
```
bootstrap.ts             Shared setup: loadEnv + config + prompt + MCP connect + decider + memory + logger
compact.ts               Rolling-window harness (system + assistant + tool, 3 messages/turn) + CLI; folds in old state/prompt-builder
baseline.ts              Full-history harness, "continue" ping after each tool, no truncation + CLI
shortened.ts             Full-history harness, but turns older than last 2 collapse to one assistant message (inline content + <thinking> reasoning + tool summary, all verbatim); exports compactOldTurns/extractActionTag
decider.ts               Decider interface + OpenRouterDecider (returns { message, usage })
openrouter.ts            ChatResponse + TokenUsage types + thin fetch wrapper
mcp-client.ts            ReconnectingMcpClient with backoff
tools.ts                 createDispatcher (merges MCP + harness tools, OpenAI-format conversion)
harness-tools.ts         Local harness tools (currently: memory_update)
memory-file.ts           Per-session markdown file (one per sessionId)
logger.ts                JSONL session log + stdout
human-harness.ts         Human-driven decider (terminal UI) for debugging variants
human-ui.ts              Terminal UI primitives for human-harness
env.ts                   loadEnv (.env loading)
config/<name>.json       LLM config (model + extra OpenRouter body fields + actionWindowSize)
config/prompt.md         System / first-user prompt split on \n---\n
```

## harness/eval/
```
match.ts                 matches(checkpoint, event): shallow-eq on event.details
scoreboard.ts            Scoreboard: setEventObserver attach + AI-eid resolution + checkpoint hits
eval-runner.ts           runEval: spin up world+app+loop on ephemeral port + run variant + per-run JSON result
cli.ts                   tsx harness/eval/cli.ts <llm-config> <eval-config-path>
configs/<name>.json      Eval config (harness variant, worldSeed, maxTurns, maxTokens, checkpoints[])
runs/<runId>.json        Per-run output (score, hits, turns, tokens, stopReason)
test/match.test.ts       matches() unit tests
test/scoreboard.test.ts  AI-eid resolution + emit/broadcast filtering on real harvest
test/eval-runner.test.ts End-to-end: stub decider drives identify+harvest, plus max_turns/max_tokens stop
```
