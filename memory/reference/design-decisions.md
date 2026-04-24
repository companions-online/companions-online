# Design Decisions

## Architecture

**GameWorld encapsulates all state** — no module-level mutable globals anywhere. Systems are pure functions that take `world: SystemState`. This enables multiple isolated worlds (for E2E tests) in the same process.

**PlayerConnection (not "sink")** — user explicitly chose "Connection" over other names. Interface has 8 methods: onInitialState, onInventoryChanged, onTick, onChunkNeeded, onContainerOpen, onDialogueOpen, onChatMessage, onGameEvent. GameWorld never encodes wire format.

**SystemState interface** — lightweight subset of GameWorld. Unit tests create plain objects satisfying it without full GameWorld. GameWorld implements it. Avoids coupling test code to the full class. Includes `players` map so critter AI can iterate players directly (O(critters×players) not O(critters×entities)).

**processAction as switch/dispatch** — each of the 17 action types has its own handler function in `server/src/world-actions.ts`. `cancelConflictingStates` handles pre-action cleanup. Say is handled before cancellation (doesn't interrupt other actions).

**ActionResult over throw, over boolean/void.** Mutating helpers that can fail (`setMoveTarget`, `startAttack`, `startHarvest`, `startConsume`, `inventoryMgr.*`) return `ActionResult = {ok:true} | {ok:false; reason: RejectionReason}`. Chosen over exceptions because rejections are *expected control flow* for LLM clients (one in ~10 tool calls) — try/catch at every dispatcher branch would be noise. Chosen over `void`/`boolean` returns because TS can't flag a silently-ignored failure on a `void` helper, which is exactly how the pre-refactor `setMoveTarget` lost `no_path` and door-blocked rejections. Validation lives in the helper; handlers are 3–8 line shims that forward `r.reason` via `rejectAction`. Pre-validation in handlers is gone — the earlier duplication ("handler pre-checks, then helper re-checks") was the source of drift.

**`world-actions.ts` as a flat sibling, not a folder.** Action dispatch was extracted from `game-world.ts` into one file at the same level — no `actions/` folder. Folders are for encapsulation (subsystems with internal helpers, like `mcp/` would be) or for grouping >5 things. World-action code is small, imported by tests and MCP and the tick loop directly; flat `world-<concern>.ts` prefix-as-convention (the same shape as `mcp-tools.ts`, `mcp-formatters.ts`, `mcp-session.ts`) fits better. A future `world-tick.ts` pass is queued for the same reason. `game-world.ts` stays as the state container + tick orchestrator; `world-actions.ts` holds dispatch + handlers + `rejectAction` + `executeInteract` + `toggleDoor`.

**`setMoveTarget` mode: `'exact'` vs `'near'`.** Player `move_to(x,y)` wants "go exactly there; if it's blocked, surface why" — it's an intent, not a hint. Pickup / interact / attack-chase want "go close enough to that tile to do something with it" — the goal tile is often *meant* to be occupied (item, door, target). One function with a `mode` param serves both; `'exact'` rejects a blocked destination, `'near'` lets `findPath`'s blocked-goal → adjacent-walkable fallback take over. Default is `'near'` because there are more chase callers than explicit-move callers.

**`clearMoveTarget` is the single "entity stopped moving" primitive.** Mirrors the (now-removed) `arriveIdle` — when a moveState is actually deleted, it resets `currentAction=Idle` and `nextWaypoint=WAYPOINT_NONE`. No-op when no moveState existed, so it doesn't clobber `Harvesting`/`Attacking`/`Consuming` on non-movers. Every path that used to pair `arriveIdle(eid) + moveStates.delete(eid)` collapses to one call. The prior split encoded the stuck-walking bug: `cancelCombat` / `notifyCritterAttacked` / `startAttack` called `clearMoveTarget` but left stale `currentAction=Walking` + stale waypoint behind. Clients kept rendering the walk animation toward a target no system owned.

**Reachability gates live inside `startAttack`, not a separate probe.** `startAttack` calls `setMoveTarget` for the non-adjacent case and propagates its `Err`; critter-ai's wander→aggro transition calls `startAttack` once per tick as the reachability gate and commits `behavior = 'aggro'` only on `Ok`. This works because `setMoveTarget` is atomic on success and no-op on `Err`, so a failing probe leaves no footprints. A separate `isReachable(from, to)` predicate would duplicate pathfinding; the `startAttack` probe reuses it. The `aggroProbeCooldown` (20 ticks) throttles the probe for wandering critters near a walled-in player so we don't pathfind every tick against an unreachable target.

**State-changing helpers are side-effect-free on `Err`.** The load-bearing property behind the aggro-reachability gate: `setMoveTarget`, `startAttack`, `startHarvest`, `startConsume`, and the `inventoryMgr.*` mutators leave all world state untouched when they return `Err`. Callers can probe (`if (r.ok) commit else rollback-free`). The prior `startAttack` did `clearMoveTarget` before the reachability check, which was destroy-before-construct: a failed probe wiped the old wander move without replacing it, leaving the critter frozen in Walking state. Rule: do the validations + pathing / weight check / preconditions first; only mutate after every can-fail branch is cleared. Any new helper that takes a partial action — and there will be more — follows the same shape.

**Tick phase order: move→resolve→channel→resolve-damage→observe** — actions → critterAI → respawns → **movement** → **pickups+interacts** → **harvest** → consumables → combat → broadcast → cleanup. All three arrival-triggered resolvers (pickups, interacts, harvest's pathfinding→channel transition) sit together right after movement so `hasMoveTarget` reflects post-move state. The previous layout ran harvest *before* movement, which left the distance-harvest case racing: movement's `clearMoveTarget` would flip `currentAction=Idle` at phase 5 and the MCP tool would resolve before harvest (phase 3 of the *next* tick) could promote to `Harvesting`. Moving harvest after movement makes that flip happen atomically within one tick. Combat stays last among resolution phases so damage/death is the "final word" before broadcast.

**Hono server on one port** — MCP Streamable HTTP + WebSocket + static files all served from port 3001. Hono app created via factory function (`createApp(world)`) for testability.

## MCP Design

**Events emitted at authoritative source** — NOT reverse-engineered from deltas. GameWorld handlers emit directly via `onGameEvent`. System functions return enriched data (CombatResult with hits, HarvestEvent[], ConsumeEvent[], CritterBehaviorChange[]). GameWorld translates system returns to events.

**LLM "teleportation" model** — LLM players experience constant teleportation between tool calls. Every response is a full snapshot. Only emit events NOT inferrable from snapshots: damage causality, ephemeral chat, action interruption reasons. Snapshot-inferrable info (entity positions, who's nearby) comes from `<map>` and `<entities>` sections.

**Two continuity-preservation events** — `creature_fleeing` and `creature_died` kept at Medium priority despite being somewhat inferrable, because they bridge behavioral cause-and-effect chains.

**Action blocking model** — MCP action tools block via Promise. `awaitAction()` creates Promise, `onTick` resolves it when player's currentAction returns to Idle/Dead. Tick 1: if Idle → instant action (equip/craft/etc), resolve immediately. Subsequent ticks: wait for completion. 600-tick (30s) safety valve timeout.

**One McpServer per session** — tool handlers close over session-specific state (conn, entityId). Sessions stored in Map, persist until explicit DELETE. No inactivity timeout (user decision).

**Identify before play** — MCP sessions don't auto-spawn a player. Session + player identity are decoupled: new clients must call `identify(name)` first; every other tool rejects with `isError: true` until then. Reasons: (1) sets up the future login/auth surface for both WS and MCP, (2) gives every MCP player a deliberate name instead of a shared default, (3) the name lands via `setEntityMeta` (broadcasts + emits `entity_meta_changed`) so nearby players see it immediately. Double-identify returns an error pointing to `server_command(nick)` for rename; the tool is intentionally not idempotent so callers don't try to use it as a re-spawn.

**`addPlayer` does not set a default name** — each caller (`app.ts` WS branch, `test/e2e/helpers.ts` via `addTestPlayer`, `identify` tool) sets the name explicitly via `setEntityMeta`. Previously `addPlayer` mutated `entityMeta` directly with no broadcast; that meant existing nearby WS players never received an `EntityMeta` packet for the new player, because the pre-emptive `knownEntities.add` loop in `addPlayer` also suppressed the `broadcastTick` "entered" path that would have triggered `sendMetaFor`. Both defects removed together — the default-name mutation is gone and the pre-seed loop is gone.

**MCP keepalive: Node timeout + per-session ping** — Node's default `requestTimeout=300000ms` killed the long-lived GET-SSE stream at exactly the observed 5-minute drop mark. Two-part fix: (1) set `requestTimeout=headersTimeout=0` on the http.Server in `main.ts`, (2) start a 15s `setInterval` in `createSession` that calls `McpServer.server.ping()` — a proper MCP spec `PingRequest` that writes real bytes to the standalone SSE stream. The ping interval is `.unref()`'d so it doesn't keep the Node process alive. Rejected approaches: SSE `: keepalive` comments (SDK doesn't expose the stream controller), `closeStandaloneSSEStream` polling pattern (requires `eventStore` wiring, more moving parts), generic `notifications/message` (pollutes client log handlers).

**McpConnection holds live GameWorldView ref** — reads entity state, terrain, inventory on demand. No delta accumulation needed (unlike WebSocket). EventBuffer for game events. Dialogue/container state cached from one-shot callbacks (not readable from world ref).

**Text formatters as pure functions** — take McpConnection, produce XML-tagged text. Reuse shared/src/ascii.ts chars. Token-efficient compact format. Item IDs prefixed with `#` in inventory/container for tool call references.

**MCP CLI test tool** — `scripts/mcp.ts` persists session in `.session` file. Auto-reconnects on stale session. Lists tools with no args, executes with `tool key=value` syntax.

## Building Layer vs Entities

**WoodenWall, WoodenFloor, StoneFloor → building tile layer**. Static structures use `map.setBuilding()`. Synced via chunk streaming + tile deltas. No entity overhead. Classification comes from `blueprintToBuilding()` in `shared/src/blueprints.ts`: a non-null return → building-tile placement, null → entity placement. WoodenFloor / StoneFloor are the first walkable buildings — they can be placed on river terrain to bridge it (but not on water or rock; see `isPlaceable` below).

**Door, Campfire, StorageChest → entities**. These have interactive behavior. Ground-item vs placed-structure is discriminated by the `StatusEffect.Placed` bit (set at spawn by `handleUseItemAt` and the worldgen `spawnCreatureEntity` path for `category === 'placeable'` + Tree). Use `isPlaced(statusEffects)` from `shared/src/status-effects.ts` — never rely on "has the statusEffects component at all" (that convention predated the bit and was quietly broken by worldgen + persistence).

**Campfire has collides: true** — needed for cooking (server finds campfire via `occupancy.get(tileX, tileY)`).

**Three terrain predicates instead of one overloaded `isWalkable`** — `shared/src/terrain.ts` exports `isWalkable`, `isPlaceable`, `isLightPassing`. Previously one function answered all three questions, which broke when we needed rivers to be non-walkable (movement) but still light-transmitting (shadowcast) and bridgeable by floors (placement). Splitting keeps each decision independent: movement callers never accidentally let rivers be placeable, shadowcast never accidentally blocks at rivers. `isPlaceable` takes `newBuilding: Building | null` rather than a `BlueprintType` to avoid pulling blueprints.ts into terrain.ts (circular import).

**Floors render as a raised slab, not a flat tile** — a flat diamond under a floor read as sunken/painted-on. In `client-webgl/src/terrain/terrain-instances.ts`, floor tiles lift their top-diamond corners by `FLOOR_LIFT_Z = 0.25` (≈4 px at `PX_PER_Z = 16`). The shared per-chunk elevation grid is NOT modified — the lift applies only when the floor's own instance is written, so grass neighbors don't tilt. Up to two SE/SW side quads per floor fill the slab profile; interior edges shared with another floor are suppressed. Side faces sample a horizontal slice (`v = 0.5`) of the floor's top texture — horizontal plank/mortar pattern reads as vertical stripes on the side — times `SIDE_SHADE = 0.82` for depth AO. The back (NE/NW) faces are omitted because the top occludes them in iso projection.

**Floor top redraws after the overlay pass** — grass tiles adjacent to a floor-on-water have their shared corners pulled to `SHORE_HEIGHT` by the elevation flatten pass, tilting the grass diamond upward in screen space. The water overlay painted on that tilted grass (pass order: base → overlay → …) extends into the screen-Y band where the floor's lifted top sits, biting into it. Fix: emit a top-redraw instance per floor tile (same data as the base instance, lifted corners) into a separate buffer, draw it with the base program AFTER the overlay pass. Overdraws any bite. Four-pass order: base → overlay → floor-top-redraw → side.

**Floors opt out of terrain blending** — `TERRAIN_NO_OVERLAY` in `client-webgl/src/terrain/terrain-blend.ts` flags WoodenFloor / StoneFloor. `gatherInfluences()` skips these as influence sources, so the neighboring grass tile never gets a floor-overlay with a soft alpha mask. The floor's own tile diamond renders strictly inside its diamond outline — man-made flooring should meet the ground at a hard seam, not fade into it. Natural terrain transitions (grass↔rock etc.) keep their usual soft blend.

**Bridge-click falls through to `isWalkable`** — `shared/src/action-resolver.ts`'s water/river branch used to `return null` unconditionally when no fishing rod was equipped, which made bridged-river tiles unclickable. It now returns `Harvest` only when the rod is equipped; otherwise the caller falls through to the `!isWalkable` check, which correctly admits bridged river tiles (walkable via the floor) and rejects raw river / water.

## Game Mechanics

**No HillRock entity** — Terrain.Rock tiles are mineable directly.

**UseItemAt unifies cooking + placing** — Equip item → target tile → server resolves.

**UseConsumable is channeled, single-use** — unlike harvest (repeats), consumables complete once.

**Player death** — doesn't destroy the entity. Sets `ActionType.Dead`, drops equipped items, schedules respawn in 100 ticks.

**Fist as default weapon** — Player base damage=1, attackSpeed=2 (base).

**`ACTION_BASE_TICKS` dial** — global multiplier in `shared/src/constants.ts` applied via `Math.round(X * ACTION_BASE_TICKS)` at every harvest `tickCost` resolution (`systems/harvest.ts`) and attack-speed resolution (`systems/combat.ts`). Blueprint `weaponSpeed` / creature `attackSpeed` and the harvest-system literals are **base** values (what you'd feel at `ACTION_BASE_TICKS = 1`). One-line tuning for the combat/harvest cadence without touching data. Tests import the constant and compute budgets from it, so flipping the dial keeps the suite green.

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

## Lighting

**Time-of-day derived, not stored.** `gameMinute = gameMinuteFromTick(currentTick + tickOffset)`. Shared-code derivation means client and server compute the same value from the same inputs. Only `tickOffset` (init + runtime shifts) is persisted — not `gameMinute`.

**`effectiveTick` split from `currentTick`.** `currentTick` stays a monotonic "real ticks elapsed" counter — consumed by respawn timers, event ages, save `meta.tick`. `effectiveTick = currentTick + tickOffset` feeds ONLY the time-of-day formula.

**Env delta cadence.** `broadcastTick` emits an Environment section only on keyframe-hour crossings (4/5/6/18/19/20) or on `weather` change — day/night flat spans stay silent. Client extrapolates `gameMinute` locally via wall-clock between syncs. `setTickOffset` resets `_lastEnvEmitHour = -1` to force an immediate resync.

**New worlds start at twilight.** `createNewWorld` seeds `tickOffset = 19 * TICKS_PER_GAME_HOUR` (mid-sunset). Immediate visual interest; no 2-minute wait for the first keyframe.

**Point-light emission on shared Blueprint.** `lightRadius` / `lightColor` live on `Blueprint` even though the server ignores them today — so future server-side AI (wolves fearing campfires) can read them without a schema migration.

**Per-target raycast over recursive shadowcasting.** Simpler (~40 lines), strictly correct (no around-corner bleed), cheap at radius 6 (~O(r³) = ~1300 ops per light, negligible).

**Lightmap window, not whole map.** `80×80` tile-resolution RGB8 texture around the player, re-origins on >8-tile drift. ~19 KB; full-replace per frame. `LINEAR` filter gives smooth gradients at tile edges without losing the tile-grid feel.

**Walls + collides are lit but block.** The blocker predicate stops light from passing *through* them, but the endpoint tile is always visited — so a wall adjacent to a campfire glows. Required the wall-sprite face-top `Math.floor` fix to prevent 1-px seams leaking lit floor through rasterization holes.

**Effects stay unlit.** Damage numbers, chat bubbles, pickup text use `spriteRenderer.begin(res)` without the lightmap arg → `u_lit = 0`, FS short-circuits the multiply. They're UI-ish and should read as foreground.
