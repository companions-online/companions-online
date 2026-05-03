# WebGL Client Overview

## What this is

The browser game client. Renders an isometric 2D world from authoritative
server state streamed over WebSocket. Parallel to `cli/` (same backend,
same protocol, different frontend — CLI is the reference implementation
for anything the webgl client is missing). No shared UI code between
them; they only share `shared/src/`.

## Boot flow

```
index{,-standalone}.html loads /dist/main.js
  → main.ts: canvas + WebGL2 context
  → createScene(gl)           — boots renderers + loads sprite + static assets
  → conn = (window.GAME_SERVER_HOST defined)
       ? connect()                          — ws://location.host/ws
       : bootStandaloneObserver(scene, seed)  — in-tab GameWorld + GameLoop +
                                              StandaloneObserverConnection +
                                              autopilot camera
  → wireSceneToConnection(scene, conn)  — WS-only switch; no-op for standalone
  → attachMouseControls + attachKeyboardControls
  → renderer.start()          — RAF loop
```

Networked path: the scene starts empty; chunks + entities fill in as
the server streams them. Standalone path: same wire model, same
`Scene.on*()` mutators, but the server lives in the same browser tab
and bypasses the binary protocol via `StandaloneConnection` /
`StandaloneObserverConnection`. Today the standalone build boots into
observer mode (no player avatar, autopilot camera) — the upcoming
main menu will sit on top of this.

## Same-origin serving + standalone serving

**Networked**: the game server's Hono instance (`server/src/app.ts`)
has a catch-all static handler that serves `client-webgl/` from the
repo. `index.html` injects `window.GAME_SERVER_HOST = window.location.host`
so `main.ts` picks the WS path. Running on `PORT=3002` (e.g.) for a
second session Just Works.

**Standalone**: `client-webgl/dev-standalone.ts` runs esbuild's serve
mode against `client-webgl/` on a separate port (default 3002),
serving `index-standalone.html` (no `GAME_SERVER_HOST` injected).
`main.ts` falls through to the standalone boot.

Dev loops:
- `npm run dev` — game server. Serves `client-webgl/index.html` →
  networked play.
- `npm run dev:client-gl` — esbuild watch only (no dev server); use
  alongside the game server so the bundle rebuilds on change.
- `npm run dev:standalone` — esbuild serve, no game server. Serves
  `client-webgl/index-standalone.html` → standalone observer mode.

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
`docs/plans/webgl-client-network-integration.md` — useful context but
not required reading.
