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
  → createScene(gl)           — boots renderers + loads sprite + static assets
  → connect()                 — opens ws://location.host/ws
  → wireSceneToConnection     — routes decoded messages into scene.on*()
  → attachMouseControls       — click → resolveAction → send
  → renderer.start()          — RAF loop
```

No client-side world-gen, no local entity simulation — everything
replicated. The scene starts empty; chunks + entities fill in as the
server streams them.

## Same-origin serving

The game server's Hono instance (`server/src/app.ts`) has a catch-all
static handler that serves `client-webgl/` from the repo. The client
connects to `ws://${location.host}/ws` — no `?host=` override, no
separate dev port. Running on `PORT=3002` (e.g.) for a second session
Just Works.

Dev loop: `npm run dev` runs `dev:server` + `dev:client-gl` concurrently.
`dev:client-gl` is `esbuild --watch` writing to `client-webgl/dist/`;
the game server serves it.

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
