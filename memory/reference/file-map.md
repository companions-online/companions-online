# File Map

## shared/src/
```
index.ts                 Barrel re-export of everything
constants.ts             TICK_RATE=20, MAP_SIZE=128, CHUNK_SIZE=16, VIEW/INTEREST_RANGE, SPAWN, TICKS_PER_GAME_MINUTE/HOUR, GAME_MINUTES_PER_DAY, TICKS_PER_GAME_DAY
lighting.ts              Day/night keyframes, ambientTint, gameMinuteFromTick/gameHourFromTick, KEYFRAME_HOURS, TWILIGHT_TICK_OFFSET
actions.ts               ActionType enum (Idle..Consuming), ClientAction enum (Cancel..Say, 17 total)
blueprints.ts            Blueprint interface + ~35 types, blueprintToBuilding() mapping (+ optional lightRadius, lightColor on Blueprint; Campfire sets both)
recipes.ts               17 crafting recipes (tools, weapons, armor, placeables, bandage)
inventory.ts             InventoryItem/Inventory types, pure helpers (getWeight, canCraft, equipSlot conversions)
loot-tables.ts           Drop tables per creature (deer→hide+meat, skeleton→iron+rock, etc.)
pathfinding.ts           A* with 8-dir movement, alternating diagonal cost, no corner cutting
action-resolver.ts       resolveAction (auto-detect MoveTo/Pickup/Harvest/Attack/Interact) + describeAction
ascii.ts                 terrainChar, buildingChar, blueprintChar (with door open/closed), tileChar
components.ts            ComponentBit enum (7 synced components), wire data interfaces
coordinates.ts           tileToScreen / screenToTile isometric helpers
direction.ts             Direction enum (8-dir), DX/DY arrays, isDiagonal
terrain.ts               Terrain/Building enums (Wall, Floor, Fence — no Door), isWalkable
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
main.ts                  Entry: createDefaultWorld + Hono server + GameLoop (~40 lines)
app.ts                   Hono app factory: MCP routes + WS upgrade + static serving
game-world.ts            GameWorld class — all state, runTick, player lifecycle, action dispatch, event emission (emitEvent point-to-point + broadcastEvent to nearby for visuals), clearAiTargetsOn(deadEntityId) for player/creature death AI cleanup; weather + tickOffset + effectiveTick getter; env section emission on keyframe crossings
system-state.ts          SystemState interface + MovementState/HarvestState/CombatState/ConsumableState/CritterState
player-connection.ts     PlayerConnection interface (10 methods incl onGameEvent point-to-point + onBroadcastEvent spectator-range) + TickDelta + GameWorldView
events.ts                18 GameEvent types, EventPriority, EventBuffer with priority decay + age-out. Details for combat_hit_dealt / harvest_yield / craft_complete carry actor id (attackerEntityId / harvesterEntityId / crafterEntityId) so broadcast wire events can identify the actor.
occupancy.ts             OccupancyGrid (Uint16Array tile→entityId)
inventory-manager.ts     InventoryManager class (add/remove/equip/craft/drop/transfer)
telemetry.ts             Telemetry class (per-phase timing, network bytes, rolling averages)
dashboard.ts             ANSI telemetry dashboard rendering; shows in-game time HH:MM in header
world-persistence.ts     saveWorld/loadWorld/createNewWorld; tickOffset on meta, createNewWorld seeds TWILIGHT_TICK_OFFSET
npc-dialogues.ts         Static dialogue trees + trade offers for Hermit, Trader, Wanderer
server-commands.ts       Slash-command registry + dispatcher; built-in /nick /name → handleNick
mcp-tools.ts             21 MCP tool registrations (identify + 16 action + 4 query); all but identify wrapped by guarded(...) that rejects pre-identify with isError:true
mcp-session.ts           MCP session lifecycle (create/destroy/lookup, session Map); per-session 15s ping keepalive timer; setSessionEntity promotes entityId after identify
mcp-formatters.ts        Text formatters: self, map, entities, terrain, events, inventory, recipes, container, envelopes
ecs/component-store.ts   ComponentStore<T> — generic Map with auto-dirty
ecs/entity-manager.ts    EntityManager — entity lifecycle, 7 component stores, dirty/destroyed tracking
ecs/game-loop.ts         GameLoop — setTimeout with drift compensation
systems/movement.ts      A* path-following, occupancy collision, wait-and-repath
systems/harvest.ts       Channeled gathering, auto-pathfind to adjacent, tree depletion → returns HarvestEvent[]
systems/consumable.ts    Channeled healing, single-use, interruptible → returns ConsumeEvent[]
systems/combat.ts        Attack system — pathfind+swing+damage, auto-follow → returns CombatResult { deaths, hits }. startAttack + per-swing sets attacker direction via dirFromTo so swing animation faces target.
systems/critter-ai.ts    Wander/flee/aggro/passive behaviors → returns CritterBehaviorChange[]. Skips Dead players when scanning for nearest aggro target.
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
persistence.test.ts      Save/load round-trip + tickOffset + new-world twilight seed
client-gl/shadowcast.test.ts  Per-target raycast + blocker behavior + wall occlusion
client-gl/scene.test.ts       Scene mutators + factory dispatch + capacity + onGameEvent dispatch + smoke-puff spawn (via EntityDied + Dead-transition paths) + Dead→Idle snap
client-gl/effects.test.ts     Damage number + pickup text + chat bubble lifecycle
```
