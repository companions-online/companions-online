# WebGL Client Overview

## What this is

The browser game client. Renders an isometric 2D world from authoritative
server state streamed over WebSocket. Parallel to `cli/` (same backend,
same protocol, different frontend — CLI is the reference implementation
for anything the webgl client is missing). No shared UI code between
them; they only share `shared/src/`.

## Boot flow

```
index.html loads /dist/main.js
  → main.ts: canvas + WebGL2 context
  → createScene(gl)            — boots renderers + loads sprite + static assets + widget palette
  → bootStandaloneObserver(scene, seed)   — always: in-tab GameWorld + GameLoop +
                                            StandaloneObserverConnection + autopilot camera
                                            (menu backdrop; see observer-mode.md)
  → connRef = new ConnectionRef(observerConn)   — swappable wrapper used by all controls
  → wireSceneToConnection(scene, connRef)
  → loadMenuLogo(gl) + createMenuController(...) + attachMenuInput(canvas, scene, menu)
  → attachMouseControls(canvas, scene, connRef) + attachKeyboardControls(canvas, connRef, scene)
  → scene.overlay = { kind: 'menu', screen: 'landing' }
  → renderer.start()           — RAF loop
```

Single HTML entry. The menu mounts on top of a live observer-mode
world regardless of how the page was served. `window.GAME_SERVER_HOST`
is read only to autofill the menu's Join Game host field — it does
**not** gate which mode is available; the player can always pick
**New Game** for in-tab singleplayer. Game-start happens through the
menu: **New Game** tears down the observer and runs
`bootStandalone(scene, chosenSeed)` on the same scene; **Join Game**
runs `connectTo(url)`, swaps `connRef` to the resulting WS connection,
and applies `/nick` + `/avatar` if the user changed defaults. Detail:
`memory/client-webgl/menu.md`.

Networked path: the scene starts empty; chunks + entities fill in as
the server streams them. Standalone path: same wire model, same
`Scene.on*()` mutators, but the server lives in the same browser tab
and bypasses the binary protocol via `StandaloneConnection` /
`StandaloneObserverConnection`. Full orientation:
`memory/client-webgl/standalone.md`.

## How the bundle is served

The same `client-webgl/build.ts` output is consumed in two places:

- **Game server** (`server/src/app.ts`) — catch-all static handler
  serves `client-webgl/` from the repo. `index.html` injects
  `window.GAME_SERVER_HOST = window.location.host` so the menu's Join
  Game field autofills. Running on a non-default `PORT` for a second
  session Just Works.
- **Docs site** — `user-guide/scripts/copy-assets.mjs` copies the
  bundle into `user-guide/static/game/`. Docusaurus's
  `GameEmbed.tsx` loads `/game/main.js` directly; no
  `GAME_SERVER_HOST` injected (the Join field starts empty).

Dev loops:
- `npm run dev` — game server. Serves `client-webgl/index.html` for
  networked play.
- `npm run dev:client-gl` — esbuild watch only (no dev server); use
  alongside the game server so the bundle rebuilds on change.

## Where to look next

In decreasing order of how often you'll re-read:

1. **[architecture.md](architecture.md)** — scene model, chunk-sparse
   rendering, entity factories, interp, controls. The one to re-read
   often.
2. **[file-map.md](file-map.md)** — terse file-by-file guide for
   navigation.
3. **[gotchas.md](gotchas.md)** — non-obvious design decisions and
   pitfalls.
4. **[testing.md](testing.md)** — `test/client-gl/` harness and what's
   covered.

Phase-by-phase design history lives in
`plans/plans/webgl-client-network-integration.md` — useful context but
not required reading.
