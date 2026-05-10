# Observer Mode

A passive viewer with no in-world entity. Server-side seam, independent
of how the world is hosted — observer can run against either a
networked or a standalone-embedded world. Today's only consumer is the
menu backdrop (running against a standalone world); that's an
implementation choice, not a coupling.

## Server side

`world.addObserver(connection, focusX, focusY)` registers a passive
viewer. Returns a negative id, separate from the positive entityId
space, so observers and players can never collide.

Per-tick broadcast is shared with players via `streamToTarget(centerX,
centerY, …)`. `broadcastEvent`, `setEntityMeta`, and `handleSay`
(`server/src/world-actions.ts`) iterate observers in parallel to
players, range-tested against `slot.focusX/focusY`. Observer is
invisible to other players for free — it has no entity in
`world.entities`, so it never enters another player's `entered` set,
never appears in nameplate broadcasts, can't be targeted by combat /
pickup / interact. No special-case code anywhere.

## Client side

When `scene.myEntityId === null`:
- Camera follow falls back to `scene.observerFocus: {tileX, tileY}`
  (float tile coords, mirror of `visualX/visualY`).
- Chunk eviction keys off the focus tile.
- Lighting center uses the focus tile (or 0,0 if neither set).
- HP bars + nameplates draw normally — the "skip self" check is keyed
  on `myEntityId`, which is null, so nothing is skipped.

`onWelcome(0, seed)` is the observer-channel sentinel — `entityId=0`
keeps `myEntityId` null.

## Autopilot (`controls/observer-camera.ts`)

Drives the menu backdrop's panning view:
- Mulberry32 RNG seeded from `Date.now()` (or a test seed) — direction
  picks are reproducible.
- 8-direction random walk over float tile coords (`@shared/direction`'s
  `DX`/`DY` arrays).
- Segments of `random[3000..5000] ms`, then re-roll direction.
- Edge buffer (default 16 tiles): clamp + force `pickDirTowardCenter`
  + re-roll the segment timer when about to leave the band.
- `pushFocus()`: every frame writes the float `posX/posY` straight
  into `scene.observerFocus` (smooth camera, mirroring the player
  path's `entity.visualX/visualY`); only calls server
  `setObserverFocus(tx, ty)` when the *rounded* tile changes — keeps
  chunk-streaming churn proportional to motion, not RAF rate.
  Rounding the camera focus instead of the server push caused per-axis
  Math.round boundaries to fire at staggered times during diagonal
  motion → continuous screen-zigzag (NE-tile motion = pure-right on
  screen, but staggered .5 crossings turned that into ↘↗↘↗ jumps).
- Renderer drives `tick(now)` once per frame via
  `scene.observerCamera?.tick(now)`.
- `stop()` available for replacement by manual controls.

## Current consumer

The menu backdrop. `main.ts` boots an observer via
`bootStandaloneObserver` (see `standalone.md`). Observer mode here
happens to be running against a standalone-embedded world, but only
because that's the simplest way to populate a backdrop without a
remote.

## Future seams

- **Networked observer** — `?observe=1` on the `/ws` upgrade. Server-
  side `addObserver` is already in place; needs a route handler that
  calls it instead of `addPlayer`. Out of scope today.
- **Manual god-view controls** — WASD pan, follow-this-entity. Plug
  into the same `setObserverFocus` API; the autopilot exposes `stop()`
  for swap. Drop in alongside the autopilot when needed.

## Testing

- `test/e2e/observer.test.ts` (10) — `HeadlessConnection`:
  registration + initial chunks, entered/range gating, invisibility to
  players, broadcast event range, focus-change chunk streaming,
  removeObserver, chat in/out of range, nameplate sync.
- `test/client-gl/observer.test.ts` (3) — `onWelcome(0, ...)` keeps
  `myEntityId` null, `setObserverFocus` mutates state,
  `processDirtyChunks` runs cleanly when only `observerFocus` is set.
- `test/client-gl/observer-camera.test.ts` (7) — autopilot with a
  fixed seed: first-tick state, segment-based motion, throttled
  `setFocus`, edge-buffer toward-center bias, clamp invariant,
  direction change after segment timer, `stop()`.
