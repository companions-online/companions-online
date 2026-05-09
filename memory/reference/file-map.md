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
game-world.ts            GameWorld class — state container + runTick orchestration + player lifecycle + observer lifecycle (addObserver/removeObserver/setObserverFocus + ObserverSlot) + event emission (public emitEvent point-to-point + broadcastEvent to nearby + makeEvent + bpName). processEntityDeath + handlePlayerDeath + clearAiTargetsOn live here; entity-spawn primitives extracted to entity-spawn.ts; action dispatch moved to world-actions.ts. broadcastTick uses streamToTarget(centerX,centerY,...) helper shared between player + observer loops; broadcastEvent + setEntityMeta also iterate observers in range. Weather + tickOffset + effectiveTick getter; env section emission on keyframe crossings. Hosts world.cooldowns + setCooldown/clearCooldown helpers; runTick decrements cd at the top before any system runs; cleanup at removePlayer / handlePlayerDeath / end-of-tick destroyed sweep.
entity-spawn.ts          Single source of truth for entity component shape. spawnCreatureEntity (full creature/structure shape, optional saved-value overrides for the load path, Open-bit gate so open doors don't acquire occupancy on reload) + spawnGroundItem (position+blueprint only) + isGroundItemBlueprint (worldgen classifier) + shouldRestoreAsGround (load classifier — Placed-bit-aware). Takes SystemState so systems/* can call it. Replaces the prior inline copies in createNewWorld, loadWorld, runResourceRespawns (which used to set effects:0 on respawned trees — bug fixed via the helper), and creature-lifecycle's spawnSkeleton.
world-actions.ts         Player action dispatch layer — processAction (switch), cancelConflictingStates, rejectAction, all 17 handle* (MoveTo..ServerCommand), executeInteract, toggleDoor. Free functions taking world: GameWorld (same shape as systems/*). Handlers are thin shims over ActionResult-returning helpers; walk-to-act handlers (Pickup, Interact, Transfer, Trade, DialogueSelect, UseItemAt) dispatch via scheduleOrExecute from pending-actions.ts. handleSay also delivers chat to observers in range (alongside players). handleCancel clears world.cooldowns (explicit cancel = no rate residue).
pending-actions.ts       Unified walk-to-then-act queue. PendingAction type, scheduleOrExecute dispatch helper, runPendingActions resolver (post-movement tick phase). Detects arrival, target-loss (target_missing), path failure (no_path on retry), and entity re-aim. Replaces the prior parallel pendingPickups + pendingInteracts maps; extends the same shape to transfer, trade, dialogue_select, and use_item_at (placement + cooking).
action-rejection.ts      RejectionReason discriminated union + formatRejection renderer + ActionResult / ActionResultOf<T> types with Ok/OkValue/Err constructors. ObstacleSpan (water | door) hangs off tile_blocked / no_path so movement rejections carry route-aware hints.
action-helpers.ts        requireAdjacentTarget(actorId, targetId, world, opts?) — vestigial. Was the shared target_missing | wrong_target_kind | not_adjacent preamble for Transfer / DialogueSelect / Trade before they migrated to scheduleOrExecute. No live callers; kept until next cleanup pass.
path-diagnose.ts         diagnoseBlockage — runs a permissive findPath that drops unbridged-water + closed-WoodenDoor occupancy from the blocker predicate, then walks the resulting path to emit ObstacleSpans (water grouped, doors per-tile). Called from setMoveTarget's three Err branches; returns [] when the permissive search also fails.
system-state.ts          SystemState interface (incl. cooldowns Map + setCooldown/clearCooldown helpers) + MovementState/HarvestState/CombatState/ConsumableState/CritterState. Per-state timer fields (cooldownRemaining / ticksRemaining) removed — pacing lives on world.cooldowns.
player-connection.ts     PlayerConnection interface (10 methods incl onGameEvent point-to-point + onBroadcastEvent spectator-range) + TickDelta + GameWorldView
events.ts                18 GameEvent types, EventPriority, EventBuffer with priority decay + age-out. Details for combat_hit_dealt / harvest_yield / craft_complete carry actor id (attackerEntityId / harvesterEntityId / crafterEntityId) so broadcast wire events can identify the actor.
occupancy.ts             OccupancyGrid — single-blocker per tile (players, critters, NPCs, placed entities, trees). Not tracked: ground items, corpses, building-layer walls. Ownership-enforced API: set/clear/move assert tile owner matches; violations routed to onViolation (wired to world.log.error) without throwing.
world-logger.ts          WorldLogger interface + BaseLogger + createMemoryLogger (memory variant retains entries for tests; expectCleanLog helper asserts zero warn+error). File logger lives in world-logger-file.ts so this module stays free of node:fs/path imports.
world-logger-file.ts     createFileLogger — JSONL to data/worlds/<id>/server.log. Split out from world-logger.ts so callers that don't write logs (browser-bundled or otherwise) don't transitively pull node:fs/path.
world-dump.ts            Reflective world-state dumper for the `d` debug key. serializeWorld/dumpWorld handle Map/Set/TypedArray/ComponentStore/Date/circular. SKIP_KEYS (connection/telemetry/log) + SKIP_PATHS (map.terrain/buildings/buildingMeta). EntityManager serialized only at world.entities; elsewhere collapsed to __ref.
inventory-manager.ts     InventoryManager class (add/remove/equip/craft/drop/transfer)
telemetry.ts             Telemetry class (per-phase timing, network bytes, rolling averages)
dashboard.ts             ANSI telemetry dashboard rendering; shows in-game time HH:MM in header
world-persistence.ts     saveWorld/loadWorld/createNewWorld; tickOffset on meta, createNewWorld seeds MORNING_TICK_OFFSET. Entity restore is a Placed-bit-aware classifier-dispatch over entity-spawn.ts — ground items reload as position+blueprint only (no statusEffects, no occupancy); placeables saved with Placed reload as installed structures; saved without (dropped from inventory) reload as ground items.
npc-dialogues.ts         Static dialogue trees + trade offers for Hermit, Trader, Wanderer
server-commands.ts       Slash-command registry + dispatcher; built-in /nick /name → handleNick
mcp/tools.ts             21 MCP tool registrations (identify + 16 action + 4 query); all but identify wrapped by guarded(...) that rejects pre-identify with isError:true. Rejections route through ResponseShape.Rejected (action+events only) — no snapshot replay.
mcp/session.ts           MCP session lifecycle (create/destroy/lookup, session Map); per-session 15s ping keepalive timer; setSessionEntity promotes entityId after identify
mcp/formatters.ts        Text formatters: self, map, entities, terrain, events, inventory, recipes, container, envelopes. formatEvents returns '' on empty buffer (omitted by formatEnvelope's part-filter); ResponseShape adds Rejected (events-only).
mcp/config.ts            MCP-side rendering config (e.g. mapLinePrefix).
ecs/component-store.ts   ComponentStore<T> — generic Map with auto-dirty
ecs/entity-manager.ts    EntityManager — entity lifecycle, 7 component stores, dirty/destroyed tracking
ecs/game-loop.ts         GameLoop — setTimeout with drift compensation
systems/movement.ts      A* path-following, occupancy collision, wait-and-repath. setMoveTarget returns ActionResult; takes mode: 'exact' | 'near' ('exact' rejects blocked goal; 'near' routes to adjacent walkable via findPath fallback). clearMoveTarget resets currentAction=Idle + nextWaypoint=NONE when a moveState is actually deleted (single "entity stopped moving" primitive; arriveIdle was collapsed into it). Step pacing reads/writes world.cooldowns (post-step write of stepTicks; survives moveState destruction — closes the WASD/click-spam exploit).
systems/harvest.ts       Channeled gathering, auto-pathfind to adjacent, tree depletion → returns HarvestEvent[]. First-yield (adjacent-immediate / pathfinding→active transition) writes world.cooldowns at tickCost-1 ("pre-commit channel" — start tick already counts); per-yield writes tickCost. cancelHarvest clears cd in the channel phase (cd is harvest's own residue → switching to movement/combat is responsive) and preserves it in the pathfinding phase (cd is movement-step residue → preserving stops Harvest(far)↔MoveTo step-rate exploits).
systems/consumable.ts    Channeled healing, single-use, interruptible → returns ConsumeEvent[]. startConsume writes world.cooldowns at consumeTicks-1; cancelConsume clears cd (in-flight channel, no commit).
systems/combat.ts        Attack system — pathfind+swing+damage, auto-follow → returns CombatResult { deaths, hits }. startAttack + per-swing sets attacker direction via dirFromTo so swing animation faces target. startAttack is side-effect-free on Err: the non-adjacent branch relies on setMoveTarget's atomic-on-Ok / no-op-on-Err contract; only the adjacent branch calls clearMoveTarget. critter-ai reuses startAttack as its reachability probe. Swing pacing on world.cooldowns (per-swing write of attackSpeed); first swing is free (startAttack does not write cd) but is still gated by any residual cd from a movement step on the arrival tick.
systems/critter-ai.ts    Wander/flee/aggro/passive behaviors → returns CritterBehaviorChange[]. Skips Dead players when scanning for nearest aggro target. Wander→aggro transition commits only when startAttack returns Ok (reachability gate); failure sets CritterState.aggroProbeCooldown (DEFAULT = 20 ticks) to throttle the next probe. executeAggro drops back to wander if startAttack starts failing mid-chase. notifyCritterAttacked applies the same gate so unreachable attackers don't lock a critter into aggro.
systems/harvest.ts       (see above) — faceHarvestTarget helper sets harvester direction when entering Harvesting state so harvest-craft anim plays toward the target.
systems/resources.ts     Tree resource pools (5 wood), respawn queue (30s delay). Exports runResourceRespawns (renamed from runRespawns as part of the worldPulse split). Spawns respawned trees via entity-spawn.ts::spawnCreatureEntity so they pick up the canonical Placed bit (prior inline create set effects:0, misclassifying respawned trees as ground items downstream — fixed).
systems/creature-lifecycle.ts   Night skeleton spawner + sunrise decay. runCreatureRespawns rolls 1/720 per tick at night and spawns a skeleton 10–20 tiles from any player on an unlit, walkable, unoccupied tile (AABB light check, no shadowcast). runCreatureLifecycle pulses 4 damage every 25 ticks on all living Skeletons during daylight; returned deaths route through processEntityDeath with killerEntityId=0.
connections/ws-connection.ts      WebSocket PlayerConnection (binary encoding, byte counting); sends EnvironmentSync on welcome + environment delta section in onTick. onGameEvent no-op (point-to-point is MCP-only); onBroadcastEvent translates via toWireEvent (from wire-event-map.ts) and flushes a GameEvents batch per tick after WorldDelta.
connections/wire-event-map.ts     WIRE_EVENT_MAP + toWireEvent — server GameEvent → wire WireEvent translator. Extracted from ws-connection.ts so any PlayerConnection that needs to deliver visual events to the client's onGameEvent dispatch can share one mapping.
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
movement-rate-limit.test.ts   Regression for the WASD/click-spam exploit — re-issue MoveTo every tick, assert advance scales with speed not TICK_RATE.
cooldown-cross-action.test.ts Harvest mid-channel → switch to Attack: combat registers immediately, no swing lands until cd elapses.
cooldown-consume-cancel.test.ts  Bandage mid-channel → MoveTo: cd cleared, movement steps without waiting.
system-state-mock.ts          Test helper: attachCooldowns + tickCooldowns for bare-mock SystemState in per-system tests (pathfinding/harvest/movement-edge-cases/critter-ai).
pending-actions.test.ts       Coverage for the unified pendingActions queue. Base cases: pickup, interact (door/chest), transfer, dialogue_select, trade, use_item_at on walkable tile, use_item_at on river (river-floor case), cooking, plus already-adjacent zero-tick fast path. Interrupt cases: target destroyed mid-walk → target_missing, path becomes unreachable mid-walk → no_path, new action mid-walk → action_interrupted event, player dies mid-walk → entry cleared, mobile entity target moves → resolver re-aims, inventory fills mid-walk → inventory_full on arrival.
```

## harness/cli/
```
harness.ts               `npx harness <variant> <model> [prompt]` — single-character free-running play; `human` model swaps in HumanDecider + TTY UI
eval.ts                  `npx eval <eval-config> <model>` — boot ephemeral server + score against checkpoints
characters.ts            `npx characters` — multi-character CLI: load roster + mount dashboard + run all concurrently
run-cli.ts               Shared SIGINT/abort plumbing + UsageAccumulator init + final tokens/cost line for harness + eval entries (NOT used by characters — that registers SIGINT itself to avoid stacking handlers)
```

## harness/variants/
```
baseline.ts              Full-history harness, "continue" ping after each tool, no truncation
compact.ts               Rolling-window harness (system + assistant + tool, 3 messages/turn); folds in old state/prompt-builder
shortened.ts             Full-history harness, but turns older than last 2 collapse to one assistant message (inline content + <thinking> reasoning + tool summary, all verbatim); exports compactOldTurns/extractActionTag
```

## harness/helpers/
```
runner.ts                The single per-turn loop (runHarness). Owns abort/maxSteps gates, decider call, dispatcher call, all log lines, TurnCompleteCtx-shaped onTurnComplete hook, UsageAccumulator (incl costUsd) + RateTracker push.
bootstrap.ts             Shared setup: loadEnv + config (configName from disk OR inline `config: ModelConfig`) + prompt resolve (CHARACTERS_DIR before CONFIG_DIR) + MCP connect + decider + memory + logger. `quiet?: boolean` propagates to createLogger.
decider.ts               Decider interface + OpenRouterDecider (returns { message, usage }). Injects `usage: { include: true }` after the model-body spread so OpenRouter returns billed dollar cost.
openrouter.ts            ChatResponse + TokenUsage types (incl optional `cost?: number`) + thin fetch wrapper
mcp-client.ts            ReconnectingMcpClient with backoff
dispatcher.ts            createDispatcher (merges MCP + harness tools, OpenAI-format conversion). Tags results `kind: 'mcp' | 'harness'`.
harness-tools.ts         Local harness tools (currently: memory_update)
scratchpad.ts            Per-session markdown file (one per sessionId), LLM-facing as `memory_update`
logger.ts                JSONL session log + stdout. `createLogger(sessionId, { quiet })` — quiet no-ops stdout but keeps event JSONL writes (used by multi-character TUI).
rate-tracker.ts          Pure trailing-window completion-token tracker. createRateTracker → { push(completion, tMs?), rate(windowMs=10_000, nowMs?) }. Pushed once per turn from the runner; the multi-character dashboard reads `rate(10_000)` for live tps.
characters-config.ts     loadCharactersConfig(path?) → Character[]. Validates `harness/characters/config.json` shape: prompt + harness∈{baseline|compact|shortened} + inlined `model: ModelConfig`.
run-characters.ts        Orchestrator. `createCharacterRows(chars)` builds row state synchronously (so callers can mount a dashboard before the runners start). `runCharacters(chars, rows, opts?)` fans out via Promise.allSettled — each character gets its own bootstrap + sessionId + MCP client + UsageAccumulator + RateTracker, all wired into the same row.
characters-dashboard.ts  Live ANSI TUI for the multi-character CLI. setInterval ~250ms, raw \x1b[H redraw. Reads CharacterRow[] directly. printFinalSummary writes one summary line per character after dashboard tear-down.
human-decider.ts         Human-driven decider (terminal UI) for debugging variants
human-ui.ts              Terminal UI primitives for human-decider
config.ts                loadConfig<T>(name, kind, dir?) — discriminator-typed JSON loader for model/eval configs
env.ts                   loadEnv (.env loading)
paths.ts                 HARNESS_ROOT (from import.meta.url) + LOGS_DIR + CONFIG_DIR + CHARACTERS_DIR + log/memory/run path helpers
```

## harness/config/
```
<name>.json              LLM model config (type:"model", model, temperature?, reasoning?, actionWindowSize?, ...openrouter passthrough)
prompt.md                Default system / first-user prompt split on \n---\n
survival-basics-*.json   Eval configs (type:"eval")
```

## harness/characters/
```
config.json              Roster: array of { prompt, harness, model } — prompt resolves to <name>.md here, model is inlined ModelConfig
princess.md              Per-character prompt (system / first-user split on \n---\n). Resolved before harness/config when promptName is set.
hunter.md                ditto
peon.md                  ditto
```

## harness/eval/
```
match.ts                 matches(checkpoint, event): shallow-eq on event.details
scoreboard.ts            Scoreboard: setEventObserver attach + AI-eid resolution + checkpoint hits
eval-runner.ts           runEval: spin up world+app+loop on ephemeral port + run variant + per-run JSON result. onTurnComplete uses the new TurnCompleteCtx shape.
```

## harness/test/
```
helpers/rate-tracker.test.ts        Windowed rate calc, empty/one/old-entry edge cases
helpers/characters-config.test.ts   Happy path + each validation failure (missing field, bad harness, model.type wrong)
helpers/run-characters.test.ts      Orchestrator integration with ScriptedDecider per character against startTestMcpServer
helpers/{mcp-server,openrouter-mock,noop-logger}.ts  Test infra (in-process MCP, replay-based OpenRouter mock, silent logger)
variants/{baseline,compact-prompt,compact-state,shortened}.test.ts  Per-variant message-shape tests
eval/{match,scoreboard,eval-runner}.test.ts        Eval-side tests
human-decider.test.ts               TTY UI behaviors
helpers/scratchpad.test.ts          Memory file round-trip
fixtures/                           openrouter response fixtures + config/{test-model.json,prompt.md}
```

## harness/logs/ (gitignored)
```
<sessionId>-log.jsonl    Per-session JSONL event stream
<sessionId>-memory.md    Per-session scratchpad (LLM-facing as `memory`)
<sessionId>-run.json     Eval-only: score + hits + turns + tokens + stopReason
```
