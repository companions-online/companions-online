# Lighting

## What this is

Day/night cycle + tinted point lights, all driven by an authoritative
server clock. Composed per-frame on the client into a small RGB
lightmap texture that both the terrain and sprite shaders sample.

## Time-of-day pipeline

Server: `gameMinuteFromTick(world.effectiveTick)` where
`effectiveTick = currentTick + tickOffset`. Raw `currentTick` is still
used for respawn timers, event ages, and `meta.tick` — only the
time-of-day path reads the offset.

- `shared/src/constants.ts` — `TICKS_PER_GAME_MINUTE=12`,
  `TICKS_PER_GAME_HOUR=720`, `GAME_MINUTES_PER_DAY=1440`. 6 real sec =
  10 in-game min (100× speed); full day = 14.4 real min.
- `shared/src/lighting.ts` — keyframes (0:00/4:00/5:00/6:00/18:00/19:00/
  20:00 — flat night, mid-sunrise, full day, mid-sunset), linear interp
  via `ambientTint(gameMinute)`. Also exports `KEYFRAME_HOURS` and
  `TWILIGHT_TICK_OFFSET = 19 * TICKS_PER_GAME_HOUR` (mid-sunset default
  for new worlds).

Persistence: `WorldMeta.tickOffset?` on `meta.json`; `createNewWorld`
seeds it to `TWILIGHT_TICK_OFFSET`, `loadWorld` restores, `saveWorld`
writes back. Optional for backward compat with pre-lighting saves.

## Protocol

Two additions to the wire:
- **`ServerOpcode.EnvironmentSync = 0x35`** — sent once on welcome
  with `(gameMinute: u16, weather: u8, serverTick: u32)`.
- **`DeltaSectionTag.Environment = 0x04`** inside `WorldDelta` —
  `(gameMinute: u16, weather: u8)`. Emitted by `broadcastTick` only on
  keyframe-hour crossings, on `weather` changes, OR when
  `_lastEnvEmitHour === -1` (forced resync: first broadcast after boot
  AND after `setTickOffset`).

Client doesn't advance time from `serverTick` — it stores `gameMinute`
at `performance.now()` and extrapolates locally using
`REAL_MS_PER_GAME_MINUTE`. Drift is corrected on each server sync.

## Point lights

Declarative on the blueprint: `lightRadius?: number`,
`lightColor?: [r,g,b]`. Campfire ships with
`lightRadius: 6, lightColor: [1.0, 0.65, 0.3]`. Server never reads
these — purely client-side rendering concern today. Lives on shared
so future AI (wolves avoiding campfires) can read them.

## Client composition

`client-webgl/src/lighting/lighting.ts` — `LightingManager.update()`
runs once per frame before terrain and sprite passes:

1. Advance local `gameMinute` via wall-clock.
2. Fill the window `Uint8ClampedArray` with ambient RGB.
3. Build blocker set: `!worldMap.isWalkable(x,y) ||
   (entity with collides && !Open)`.
4. For each entity with `blueprint.lightRadius > 0` inside the window:
   run `shadowcast(origin, radius, blocks, visit)`; in `visit`, add
   `color * falloff (1 - distSq/r²)` to the pixel.
5. Upload via `texSubImage2D` to a `size × size` RGB8 2D texture
   (size = `2·INTEREST_RANGE + 16` = 80 tiles, ~19 KB), `LINEAR`
   filter, `CLAMP_TO_EDGE`. Window origin re-anchors when the player
   drifts more than 8 tiles from its center.

`client-webgl/src/lighting/shadowcast.ts` — per-target Bresenham raycast,
not recursive FOV. O(radius³) but cheap at radius 6. Strictly correct
blocking (no around-corner bleed). The light's origin and endpoint
tiles are always lit regardless of `blocks`.

## Shader integration

All three lit shaders multiply final RGB by a lightmap sample taken at
the world-tile position, with `+0.5` for texel centers.

- **Terrain base + overlay** (`terrain/shaders.ts`) — per-instance
  `a_tileXY: vec2` (slot 6). Stride bumped: base 40 → 48, overlay 44 →
  52. `buildChunkTerrainData` writes `(tx, ty)` per instance. FS
  samples `texture(u_lightmap, (v_tileXY - origin + 0.5) / size).rgb`.
- **Sprites** (`entities/shaders.ts`) — per-draw uniform
  `u_spriteTileXY`. Each draw path calls `sprites.setSpriteTile(x, y)`
  before `drawSprite()`. Creature/static/wall/door draw paths all
  updated.
- **Effects stay unlit** (`effects/effect.ts`) — calls
  `sprites.begin(resolution)` *without* the lightmap arg, which sets
  `u_lit = 0` and the FS short-circuits the multiply. Keeps damage
  numbers, chat bubbles, pickup text at full brightness.

## Wall-sprite seam fix

`buildings/wall-texture.ts` uses `Math.floor(topY)` on both face
predicates. Without this, the `isInsideDiamond` predicate (pixel-
center +0.5 offset) and the face predicate (raw float) disagree at
`row 31` columns 31 and 33 — 1-px transparent holes along each wall's
top-of-face line that revealed the lit floor behind. The `Math.floor`
starts the face one row earlier so the two regions overlap
seamlessly.

## Debug hooks

- Dashboard header shows `time HH:MM` computed from
  `gameMinuteFromTick(world.effectiveTick)` — updated each second.
- `window.__scene.lighting` exposes `currentGameMinute(now)`,
  `originX/Y`, `serverTick`, `weather` for puppeteer / devtools.
- `world.setTickOffset(n)` (server-side, no UI yet) shifts the clock
  and forces a client resync on the next broadcast.

## What the client doesn't do

- No directional face lighting — walls are uniformly lit from their
  tile's lightmap sample, same on all faces.
- No light flicker / animation — campfires light a static radius.
- No shadow-caster for moving entities — only static blockers
  (walls + collides placeables + closed doors).
- No HDR / bloom — additive clamped at 255.

## Testing

- `test/lighting.test.ts` — keyframe math, ambient interpolation.
- `test/client-gl/shadowcast.test.ts` — blocker predicate, wall-behind
  occlusion, corner-wrap, target-lit-when-blocker.
- `test/e2e/environment.test.ts` — keyframe emission, weather re-emit,
  `setTickOffset` forces emit, `effectiveTick` math.
- `test/persistence.test.ts` — createNewWorld seeds offset, round-trip,
  legacy-save compat.

Shader / pixel correctness belongs in puppeteer. Mock-GL can't verify
rendering — it proxies every call to a no-op.
