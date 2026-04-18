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

Every player spawns with `MetaKey.Name = 'Player'`, set by direct
`entityMeta.set(eid, new Map([[MetaKey.Name, 'Player']]))` in
`addPlayer` — **not** via `setEntityMeta`. Reason: that path would
emit an `entity_meta_changed` event and an `onEntityMeta` broadcast
for every spawn, which is noise. Instead, the default name rides along
on the initial `EntityFullState` via `ws-connection.sendMetaFor`.

Consequence: the first `/nick` sets `oldValue = "Player"` (not
`undefined`). Downstream code and tests should expect this.

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

Current built-ins: `nick`, `name`.

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

One tool: `server_command { command: string; parameter: string }`.

Unlike other action tools it **does not** route through
`setAction` + `awaitAction`. It calls `dispatchServerCommand` directly
so the tool response can surface the `{ok, error}` result
synchronously. On success it wraps `formatActionResponse`; on failure
it prefixes `[error] …`. WS clients still go through `setAction` to
preserve action-queue ordering with their normal command loop.

`formatSelf` prepends `name:"<name>"` when set (always set, given the
default).

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
- **`test/e2e/mcp-e2e.test.ts`** — `server_command` tool surface
  (success flows through, invalid nick returns `[error]`, tool count).
- **`test/events.test.ts`** — `EVENT_PRIORITY` maps all 19 event
  types (entity_meta_changed included).

## Files at a glance

- `shared/src/entity-meta.ts` — `MetaKey` enum, `metaKeyLabel`.
- `shared/src/actions.ts` — `ClientAction.ServerCommand = 0x11`.
- `shared/src/protocol/opcodes.ts` — `ServerOpcode.EntityMeta = 0x36`.
- `shared/src/protocol/codec.ts` — encode/decode for ServerCommand
  action and EntityMeta message.
- `server/src/server-commands.ts` — dispatcher + built-in handlers.
- `server/src/game-world.ts` — `entityMeta` map,
  `setEntityMeta`/`getEntityMeta`, `handleServerCommand`, default-name
  seed in `addPlayer`, Say senderName reads from meta.
- `server/src/connections/ws-connection.ts` — `onEntityMeta` +
  `sendMetaFor` replay on initial state / `delta.entered`.
- `server/src/connections/{headless,mcp}-connection.ts` — capture /
  stub.
- `server/src/mcp-tools.ts` — `server_command` tool.
- `server/src/mcp-formatters.ts` — `<self>` includes name; `<events>`
  renders `entity_meta_changed`.
- `server/src/events.ts` — `entity_meta_changed` event type.
- `client-webgl/src/scene.ts` — `entityMeta`, `nameplateCache`,
  `onEntityMeta`, removal prune.
- `client-webgl/src/network/wire-scene.ts` — route `entityMeta` msg.
- `client-webgl/src/controls/keyboard.ts` — slash parsing.
- `client-webgl/src/renderer.ts` — `drawNameplates` (self skipped).
- `client-webgl/src/ui/hud.ts` — chat-log name prefix; system line.
