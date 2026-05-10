# Standalone Build

The in-browser singleplayer build: the WebGL client bundles `GameWorld`
+ `GameLoop` and runs them in the same browser tab, with no backend
required. **Standalone is a play mode the player picks from the menu**,
not a deployment shape gated on serving conditions — the user can
always select **New Game** and play offline, even if the page was
served by the game server.

`window.GAME_SERVER_HOST` only autofills the menu's Join Game host
field. It does **not** gate standalone.

## What makes it possible

The server tree (`server/src/*`) is bundled into the browser via the
`@server/*` esbuild alias in `client-webgl/build-shared.ts`. Without
that alias the client couldn't import `createDefaultWorld` /
`GameLoop` / `addPlayer`.

The bridge classes that connect an in-tab `GameWorld` to the client's
`Scene` live in `client-webgl/src/network/standalone-connection.ts` —
in the client tree, not server, because they import `Scene` mutators
by reference. Server-side bridges would be a wrong-direction
dependency.

## The two bridges

Both implement `PlayerConnection` (server-facing) and `Connection`
(client-facing) — joining both halves of the seam in one object.

- **`StandaloneConnection`** — singleplayer player bridge. `myEntityId`
  captured from the first `onInitialState`. `send(action)` →
  `world.setAction(myEntityId, action)`. Each `on*()` callback forwards
  into `scene.on*()`. Factory `bootStandalone(scene, seed)` runs
  `createDefaultWorld(seed)` + `addPlayer` + new `GameLoop`. Invoked
  by the menu's **New Game** path.
- **`StandaloneObserverConnection`** — observer bridge. `send` is a
  no-op (observers can't act). Narrower forwarding surface:
  `onInventoryChanged` / `onContainerOpen` / `onDialogueOpen` /
  `onActionRejected` / point-to-point `onGameEvent` are all no-ops;
  `onChatMessage` IS forwarded so chat bubbles render. Factory
  `bootStandaloneObserver(scene, seed)` runs `createDefaultWorld` +
  `addObserver` + `GameLoop` + `startObserverCamera`. Used as the
  menu's live backdrop. (Observer mode itself is independent of
  standalone — see `observer-mode.md`.)

## Lifecycle inside `main.ts`

`main.ts` holds two slots:
- `observerRefs: StandaloneObserverRefs | null` — the menu-backdrop
  observer.
- `playerRefs / networkedConn` — whichever connection is live during
  gameplay.

At boot: `bootStandaloneObserver` populates `observerRefs`; menu opens
on landing.

**New Game** path:
1. `tearDownStandaloneObserver(refs, scene)` — stops the GameLoop +
   autopilot, drops the connection.
2. `scene.reset()` — clears chunks / entities / inventory / chat /
   effects / nameplate cache.
3. `bootStandalone(scene, chosenSeed)` — singleplayer world.
4. `connRef.swap(playerRefs.conn)` — every existing `connection.send`
   callsite stays attached via the proxy.

**Disconnect** (in-game settings): inverse of New Game — teardown the
active world, `scene.reset()`, re-`bootStandaloneObserver(initialSeed)`,
swap back, open the landing menu.

## Where it ships

The same bundle is consumed in two places:
- **Game server**'s static handler (`server/src/app.ts`) — serves
  `client-webgl/` directly; `index.html` injects `GAME_SERVER_HOST`
  so the menu's Join Game field autofills.
- **Docs site** — `user-guide/scripts/copy-assets.mjs` copies the
  built `main.js` into `user-guide/static/game/`. `GameEmbed.tsx`
  loads `/game/main.js` and provides the canvas. No `GAME_SERVER_HOST`
  injected; the menu's Join Game host field starts empty, but
  standalone is the natural path on a docs page.

Production builds come from `client-webgl/build.ts`. There is no
dedicated standalone HTML page or dev server — one bundle handles
both deployment shapes.

## Tests

The standalone bridges aren't directly unit-tested; the seams they sit
on (`Scene.on*()`, `PlayerConnection`) are covered by their respective
test suites in `test/client-gl/` and `test/e2e/`.
