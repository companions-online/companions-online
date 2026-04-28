# Server Commands + Entity Meta

Console-style slash-commands (`/nick elsyian`) and the generic
observer-visible-metadata layer they were built on top of.

## The shape of the feature

- Players type `/<command> <parameter>` in chat. The client sends a
  `ClientAction.ServerCommand { command, parameter }` instead of a
  normal `Say`.
- The server dispatches through a small registry. `/nick` (alias
  `/name`) sets the player's display name.
- Names sync to nearby observers and render as nameplates above other
  players' characters (own plate hidden).
- MCP players get an equivalent `server_command` tool.

## Why "entity meta" is its own layer, not a new ECS component

Existing ECS components (`Position`, `Health`, `Blueprint`, …) are
fixed-size ints packed through a bitmask delta. A variable-length
string component would distort that pattern. Meta is also sparse,
rarely changes, and is read on render/UI/query — not in tick-dense
code. So it lives in its own channel:

- **Components** = dense, fixed-size, read every tick.
- **Meta** = sparse, variable-length string, rarely changes, ride-along
  message.

If you find yourself wanting to add `PlayerName` as a
`ComponentBit.PlayerName`, that's a smell — it belongs as a
`MetaKey.<Something>` instead.

## Wire protocol

### Client → server
- `ClientAction.ServerCommand = 0x11` with payload:
  - `u8` command-name length + UTF-8 bytes (identifier-sized)
  - `u16` parameter length + UTF-8 bytes (can be prose / multi-word)

### Server → client
- `ServerOpcode.EntityMeta = 0x36` with payload:
  - `u16` entity id
  - `u8` meta key (`MetaKey` enum)
  - `u16` value length + UTF-8 bytes
  - **Empty value = "clear this key"** (sentinel).

Opcode was intentionally bumped from 0x35 → 0x36 during
implementation; leave 0x35 free.

### Error feedback
No new opcode. Failures reuse `ChatMessage` with
`senderEntityId = 0`, a reserved **system sentinel**. Clients render
these as `[system] …` in orange. Used for invalid-nick and
unknown-command replies.

## Server flow

```
client → ServerCommand → GameWorld.processAction
                           ↓ early-return branch (no cancel)
                         handleServerCommand
                           ↓
                         dispatchServerCommand (server-commands.ts)
                           ↓                 ↓
                         handleNick        [unknown: system chat error]
                           ↓ validates
                         world.setEntityMeta(eid, MetaKey.Name, nick)
                           ↓
             for each player in INTEREST_RANGE (incl. self):
               connection.onEntityMeta(..., key, value)    [sync]
               emitEvent(observer, 'entity_meta_changed')  [for LLMs]
```

Key behaviors:
- `ServerCommand`, like `Say`, **early-returns** from `processAction`
  before `cancelConflictingStates` — running `/nick` doesn't interrupt
  a harvest.
- `setEntityMeta` **no-ops** when the value is unchanged — avoids
  duplicate broadcasts / events when someone sets the same nick twice.
- Empty string `''` clears the key.
- On `removePlayer`, the whole meta dict for that entity is dropped.

## Default name

`GameWorld.addPlayer` sets **no name**. Each caller decides how to name
its player:

- **WS branch** (`app.ts:wsUpgrade`) sets `MetaKey.Name = 'Player'` via
  `world.setEntityMeta` immediately after `addPlayer`. Goes through the
  broadcast path so nearby players receive an `EntityMeta` packet.
- **Test helper** (`test/e2e/helpers.ts::addTestPlayer`) sets `'Player'`
  the same way, then clears spawn-time event buffers so tests see a
  clean slate.
- **MCP identify** tool (`mcp/tools.ts`) sets the client-supplied name
  after validating it via the shared `validateName` helper.

Reason for the flip: previously `addPlayer` used direct
`entityMeta.set(...)` to avoid broadcast noise, but that quietly
regressed the nametag-visibility feature — existing WS players never
received an `EntityMeta` packet for new players (compounded by a
pre-emptive `knownEntities.add` loop that defeated the
`broadcastTick`-entered path). Moving the default-name mutation to a
proper `setEntityMeta` call emits the broadcast, and removing the
pre-seed loop lets the entered path fire normally — so new entities
show up with their nameplate from the moment they enter visibility.

Consequence: the first `/nick` on a WS player sets
`oldValue = "Player"` as before. MCP players get no default name —
they pick one via `identify(name)`.

## identify tool (MCP)

Callable exactly once per session. Skips the `guarded(...)` wrapper
that rejects every other tool when `conn.entityId === 0`. Validates
`name` with `validateName` (shared with `/nick`), calls
`world.addPlayer(conn)` to spawn, `world.setEntityMeta(...)` to name
(broadcasts), and `setSessionEntity(sessionId, entityId)` to promote
the tracked session. Second call while identified returns `[error]
already identified as "<name>"; use server_command(nick) to rename`
with `isError: true`. Reasons to reject re-identify rather than allow
silent re-spawn: it's not idempotent (would leak the old entity), and
the intent is almost always "rename".

## Visibility / replay rules

Names are not in tick deltas. They sync through three paths:

1. **On player join** (`ws-connection.onInitialState`) — for each
   entity in range, after its `EntityFullState`, the connection calls
   `sendMetaFor(eid, world)` which iterates that entity's meta dict
   and emits one `EntityMeta` per entry.
2. **On `delta.entered`** (`ws-connection.onTick`) — same
   `sendMetaFor` pass, so an entity sliding into visibility carries
   its meta with it.
3. **On change** (`GameWorld.setEntityMeta`) — broadcast to every
   player currently within `INTEREST_RANGE` of the changing entity,
   self included.

If you add a new meta-producing entity type (e.g. named NPCs), the
same paths cover it automatically — no new wiring.

## Event emission

`GameEvent` type `entity_meta_changed` with details:
```ts
{ entityId; key: MetaKey; oldValue?: string; newValue: string }
```
Priority `Medium`. Emitted by `setEntityMeta` to every observer in
range (including self). MCP's `formatEvents` renders it; for
`MetaKey.Name` specifically: `"<oldValue> changed name to <newValue>"`
with a fallback of `"player#<eid> changed name to …"` when
`oldValue` is absent.

WS clients no-op `onGameEvent`; only MCP consumes events today.

## Command registry

`server/src/server-commands.ts` is the only place to add or look up
commands:

```ts
registerServerCommand(['nick', 'name'], handleNick);

type ServerCommandHandler =
  (world: GameWorld, eid: number, slot: PlayerSlot, parameter: string)
    => { ok: true } | { ok: false; error: string };
```

- Aliases share one handler.
- The meta layer does not validate — **each handler** validates its
  own input shape (length, charset, range, permissions, etc.) and
  returns a structured result.
- Handlers run instantly on the current tick; don't do async work.

Current built-ins: `nick`, `name`, `spawn`, `time`.

### `/spawn <name>` — dev/god

Resolves `parameter` to a blueprint by display name (case-insensitive,
whitespace-collapsed via `getBlueprintByName` in `shared/src/blueprints.ts`),
finds the first open tile within Chebyshev-radius 6 via
`GameWorld.findOpenTileNear`, and spawns it. Creatures go through
`GameWorld.spawnCreatureEntity` + `initCritterForEntity` so AI kicks in on
the next tick; items go through `GameWorld.spawnGroundItem`. Out-of-scope
targets (`Player`, `Tree`, NPC category, placeable category) return an
`{ok:false}` with a guidance message — placeables specifically point back
at `UseItemAt`. Ungated god command — add an auth check before multiplayer.

### `/time <preset|HH|HH:MM>` — dev/god

Shifts `world.tickOffset` so the current effective in-game time matches
the request. Presets: `day`/`noon` → 12:00, `night`/`midnight` → 0:00,
`dawn`/`sunrise` → 5:00, `twilight`/`dusk`/`sunset` → 19:00. Also accepts
`HH` (0–23) and `HH:MM`. Uses existing `world.setTickOffset`, which resets
`_lastEnvEmitHour = -1` so the next `broadcastTick` emits a fresh
`Environment` section and WS clients snap immediately. Ungated god command.

The `validateName(raw)` helper (also in `server-commands.ts`) is shared
with the MCP `identify` tool — same rules (1–16 chars, `[A-Za-z0-9_-]`,
trim-surrounding-whitespace, same error messages). Use it for any
future command or tool that takes a display name.

### Adding a new command (typical shape)

```ts
const handleWho: ServerCommandHandler = (world, eid) => {
  // … read world state, maybe emit events / chat / meta …
  return { ok: true };
};
registerServerCommand(['who'], handleWho);
```

That's it. WS + MCP pick it up automatically via the dispatcher.

## Adding a new meta key

One enum entry:
```ts
// shared/src/entity-meta.ts
export const enum MetaKey {
  Name = 0,
  Title = 1,   // ← new
}
```
Optionally extend `metaKeyLabel` for human-readable logs. Then call
`world.setEntityMeta(eid, MetaKey.Title, value)` from whatever handler
you want. No wire-format change, no new opcode.

Client side reads `scene.entityMeta.get(eid)?.get(MetaKey.Title)`.
If you want it to render above the entity, add a draw path similar to
`drawNameplates`.

## MCP surface

Two tools touch identity:

- **`identify { name }`** — one-shot spawn + name; required before any
  other tool. See the "identify tool" section above.
- **`server_command { command: string; parameter: string }`** —
  post-identify only (guard rejects pre-identify with `isError: true`).
  Does **not** route through `setAction` + `awaitAction`; it calls
  `dispatchServerCommand` directly so the tool response can surface
  the `{ok, error}` result synchronously. On success it wraps
  `formatEnvelope(..., ResponseShape.Meta)`; on failure it returns
  `[error] …` with `isError: true`. WS clients still go through
  `setAction` to preserve action-queue ordering with their normal
  command loop.

`formatSelf` prepends `name:"<name>"` when set. For WS players the
default `'Player'` is set on spawn; for MCP players the name is set
by `identify`, so pre-identify `formatSelf` would omit the prefix —
but MCP tools all reject pre-identify, so that branch isn't reachable
by the LLM in practice.

## Client-webgl

### Scene state
- `scene.entityMeta: Map<number, Map<MetaKey, string>>` — sparse;
  empty-value deliveries delete keys (and empty the inner map).
- `scene.nameplateCache: Map<string, TextSurface>` — keyed by
  **display name**, not by entity id. Multiple entities sharing a
  name share the same surface. Old entries are never evicted; names
  rarely change and the memory cost is tiny.
- `onEntityRemoval` prunes that entity's meta.

### Chat input → command parsing
`controls/keyboard.ts` on Enter: if `chatBuffer` starts with `/`,
split on the first whitespace — first word is the command, rest
(with its internal spaces preserved) is the parameter. Otherwise send
as Say.

### Nameplate rendering
`drawNameplates` pass in `renderer.ts` runs after the Y-sorted sprite
pass, before effects. For each entity with a `MetaKey.Name` entry,
get-or-create the cached `TextSurface`, blit above the sprite. **The
local player's own id (`scene.myEntityId`) is skipped** — self doesn't
need a nameplate. Pre-welcome, `myEntityId === null` so nothing is
skipped, which is fine because own entity isn't in `entityMeta` yet.

### Chat log prefix
`ui/hud.ts` `senderName(scene, eid)` checks
`entityMeta.get(eid)?.get(MetaKey.Name)` first, falls back to
blueprint name. Sender id `0` renders as an orange `[system]` line
with no `name:` prefix.

### Known sharpness issue
Nameplates rasterize at game-pass resolution
(`CANVAS_W / GAME_ZOOM`), so texels get 2× upscaled by the viewport
and bilinear-smeared. The cheap fix is to raster at
`fontPx * GAME_ZOOM` and draw at the logical width/height; a fuller
fix is to move world-anchored text to a native-resolution HUD pass
with projected screen coords. Not done yet; captured here so the next
person doesn't have to re-derive it.

## Testing

- **`test/protocol.test.ts`** — ServerCommand round-trip + EntityMeta
  round-trip (incl. UTF-8 + empty-clear).
- **`test/e2e/server-commands.test.ts`** — full server behavior
  (valid/invalid nick, aliases, visibility range filter, no-op on
  same value, event emission with oldValue, Say sender-name pickup,
  cleanup on removePlayer).
- **`test/client-gl/naming.test.ts`** — scene mutator correctness,
  empty-clear, entity-removal prune, keyboard slash-parsing for
  plain/`/nick foo`/no-param/multi-word.
- **`test/e2e/mcp-e2e.test.ts`** — identify lifecycle (reject-before,
  spawn+name, double-identify error, invalid-name rejection, nametag
  broadcast to nearby players), `server_command` tool surface (success
  flows through, invalid nick returns `[error]` with `isError: true`),
  tool count (21).
- **`test/mcp-keepalive.test.ts`** — per-session ping cadence, cleanup
  on `destroySession`, rejection-swallowing, no-timer-without-server.
- **`test/events.test.ts`** — `EVENT_PRIORITY` maps all 19 event
  types (entity_meta_changed included).

## Files at a glance

- `shared/src/entity-meta.ts` — `MetaKey` enum, `metaKeyLabel`.
- `shared/src/actions.ts` — `ClientAction.ServerCommand = 0x11`.
- `shared/src/protocol/opcodes.ts` — `ServerOpcode.EntityMeta = 0x36`.
- `shared/src/protocol/codec.ts` — encode/decode for ServerCommand
  action and EntityMeta message.
- `server/src/server-commands.ts` — dispatcher + built-in handlers;
  exported `validateName` helper shared with the MCP `identify` tool.
- `server/src/game-world.ts` — `entityMeta` map,
  `setEntityMeta`/`getEntityMeta`, `handleServerCommand`, Say senderName
  reads from meta. `addPlayer` does **not** seed a default name —
  callers do it via `setEntityMeta` so it broadcasts.
- `server/src/connections/ws-connection.ts` — `onEntityMeta` +
  `sendMetaFor` replay on initial state / `delta.entered`.
- `server/src/connections/{headless,mcp}-connection.ts` — capture /
  stub.
- `server/src/mcp/tools.ts` — `identify` tool, `server_command` tool,
  `guarded(...)` wrapper that enforces pre-identify rejection for every
  other tool.
- `server/src/mcp/session.ts` — `setSessionEntity` used by `identify`
  to upgrade the session once the player is spawned.
- `server/src/mcp/formatters.ts` — `<self>` includes name; `<events>`
  renders `entity_meta_changed`.
- `server/src/events.ts` — `entity_meta_changed` event type.
- `client-webgl/src/scene.ts` — `entityMeta`, `nameplateCache`,
  `onEntityMeta`, removal prune.
- `client-webgl/src/network/wire-scene.ts` — route `entityMeta` msg.
- `client-webgl/src/controls/keyboard.ts` — slash parsing.
- `client-webgl/src/renderer.ts` — `drawNameplates` (self skipped).
- `client-webgl/src/ui/hud.ts` — chat-log name prefix; system line.
