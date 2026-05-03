# Standalone + Observer Mode

How the standalone build and observer mode plug together. Backstops
the main menu (`memory/client-webgl/menu.md`).

## Mode toggle

`main.ts` always boots an observer-mode world via
`bootStandaloneObserver` to back the menu's live pan, regardless of
mode. `window.GAME_SERVER_HOST` is consulted only to autofill the
menu's create-join "Remote Host" field on initial entry. The networked
`connect()` is no longer called at boot — the menu's Join World handler
runs `connectTo(url)` (with timeout + categorized errors) and swaps
the `ConnectionRef` from observer to the resulting WS connection.

## In-tab transport (`network/standalone-connection.ts`)

Two PlayerConnection peers, both implementing both halves of the seam
(server-facing `PlayerConnection` + client-facing `Connection`):

- **`StandaloneConnection`** — player bridge. `myEntityId` captured from
  the first `onInitialState`. `send(action)` calls
  `world.setAction(myEntityId, action)`. Mechanical forwarding of every
  `on*()` callback into `scene.on*()`. Companion factory
  `bootStandalone(scene, seed)` does `createDefaultWorld + addPlayer +
  GameLoop`. Available for the menu's future "Play" path; **not used by
  current main.ts**.
- **`StandaloneObserverConnection`** — observer bridge. `send` is a
  no-op (observers can't act). Narrower surface: `onInventoryChanged`,
  `onContainerOpen`, `onDialogueOpen`, `onActionRejected`, point-to-point
  `onGameEvent` are all no-ops. `onChatMessage` IS forwarded so chat
  bubbles render in observer mode. Companion factory
  `bootStandaloneObserver(scene, seed)` does `createDefaultWorld +
  addObserver + GameLoop + startObserverCamera`. **This is what
  standalone mode boots into today.**

The bridge classes live in the client tree (not server) because they
import client `Scene` mutators by reference — putting them server-side
would create a server→client dep, which is the wrong direction.
Imports are mediated by the `@server/*` esbuild alias added in
`build-shared.ts`.

## Observer wiring

Server side (one paragraph; full detail in
`memory/reference/architecture.md::Observer Mode`):
`world.addObserver(conn, focusX, focusY)` returns a negative id, streams
initial chunks, fires `onInitialState(0, world)` (entityId=0 sentinel).
Per tick the broadcast loop runs `streamToTarget` against the focus
point — same code path as players, different center. `broadcastEvent`,
`setEntityMeta`, and `handleSay` iterate observers in addition to
players for nearby visual events / nameplate updates / chat.

Client side: `scene.myEntityId === null` makes the renderer/lighting/
eviction fall back to `scene.observerFocus`. The autopilot
(`controls/observer-camera.ts`) is the driver:
- Mulberry32 RNG seeded from `Date.now()` (or test seed) — direction
  picks are reproducible.
- 8-direction random walk over float tile coords (`@shared/direction`'s
  `DX`/`DY` arrays).
- Segments of `random[3000..5000] ms`, then re-roll direction.
- Edge buffer (default 16 tiles): when about to leave the band, clamp
  + force `pickDirTowardCenter` and re-roll the segment timer.
- `pushFocus()`: every frame writes the float `posX/posY` straight
  into `scene.observerFocus` (smooth camera follow, mirroring the
  player path's `entity.visualX/visualY`); only calls the server
  `setObserverFocus(tx, ty)` when the *rounded* tile changes, keeping
  chunk-streaming churn proportional to motion, not RAF rate.
  Rounding the camera focus instead of the server push caused per-axis
  Math.round boundaries to fire at staggered times during diagonal
  motion → continuous screen-zigzag (NE-tile motion = pure-right on
  screen, but staggered .5 crossings turned that into ↘↗↘↗ jumps).
- Renderer drives `tick(now)` once per frame via
  `scene.observerCamera?.tick(now)`.

## What's invisible to other players

Free invariant from the data layout: observer has no entity in
`world.entities`, so it never enters another player's `entered` set,
doesn't appear in `setEntityMeta` broadcasts, doesn't occupy a tile,
can't be targeted by combat / pickup / interact. No special-case code
needed.

## Testing

`test/e2e/observer.test.ts` — 10 cases via `HeadlessConnection`:
registration + initial chunks, entered/range gating, invisibility to
players, broadcast event range, focus-change chunk streaming,
removeObserver, chat in/out of range (the `Say` extension), nameplate
sync.

`test/client-gl/observer.test.ts` — 3 cases: `onWelcome(0, ...)` keeps
`myEntityId` null, `setObserverFocus` mutates state,
`processDirtyChunks` runs cleanly when only `observerFocus` is set.

`test/client-gl/observer-camera.test.ts` — 7 cases driving the
autopilot with a fixed seed: first-tick state, segment-based motion,
throttled `setFocus`, edge-buffer toward-center bias, clamp invariant,
direction change after segment timer, `stop()`.

## Future-facing notes

- Networked observer (`?observe=1` on `/ws` upgrade) — out of scope
  today; the server-side `addObserver` + observer connection are the
  ready seams when it lands.
- Manual god-view controls (WASD pan, follow-this-entity) — drop in
  alongside the autopilot using the same `setObserverFocus` API; the
  autopilot exposes `stop()` for swap.

## Menu glue (landed)

`main.ts` keeps an `observerRefs: StandaloneObserverRefs | null` and a
`playerRefs / networkedConn` slot. **Start World** calls
`tearDownStandaloneObserver(refs, scene)` + `scene.reset()` +
`bootStandalone(scene, chosenSeed)` and `connRef.swap(playerRefs.conn)`.
**Join World** does the same teardown after `connectTo(url)` resolves
and swaps to the networked WS conn. `applyCharacterChoices(values)`
sends `/nick` + `/avatar` only when the user changed defaults. See
`memory/client-webgl/menu.md` for the full state machine.
