# WebGL Client Testing

## Layout

```
test/client-gl/
  harness.ts               createTestScene — the usual entry point
  mock-gl.ts               Proxy-based WebGL2RenderingContext stub
  fake-sprite-registry.ts  Synthetic registry (no PNGs)
  fake-static-assets.ts    Stub terrain/mask/wall texture arrays
  fake-connection.ts       In-memory Connection
  scene.test.ts            Scene mutators, entity factory, capacity
  interpolation.test.ts    Lerp math, re-checkpointing, walk anim
  controls.test.ts         cursor-context + resolveAction + attachMouseControls E2E
  inventory.test.ts        inventorySync + fishing-rod + container/dialogue/chat
```

Run: `npx vitest run test/client-gl/`. All ~30 tests complete in
<100 ms total. No browser, no DOM — happy-dom/jsdom is not a dep.

## Why vitest is enough for most things

The client's logic is almost entirely JS state mutation — GL is a
thin output layer at the edge. The mock GL reduces GL to identity
no-ops, the fakes swap out IO (WebSocket, Image, fetch), and the
harness wires everything through the **real** scene + wire-scene +
controls code. That's enough to cover message dispatch, entity
lifecycle, interp math, chunk capacity/eviction logic, cursor-context
building, resolveAction integration, and turn prediction.

Puppeteer stays in the kit for:
- Shader / rendering correctness regressions
- Visual layout (HUD when it lands, Y-sort edge cases)
- Anything that genuinely needs a GPU

## Harness — `createTestScene(opts?)`

```ts
const { scene, conn } = await createTestScene();

// Drive inbound — any DecodedServerMessage works.
conn.deliver({ type: 'welcome', entityId: 42, seed: 1337 });

// Outbound actions are captured, newest last.
expect(conn.sent).toEqual([...]);
```

Under the hood: mock GL, fake sprite registry (known blueprints +
fallback), fake static assets (stubbed texture arrays with shaped
`layerIndex`), fake connection wired via the real `wireSceneToConnection`.

`opts.spriteRegistry.known`/`override` let a test customize sprite
resolution if needed. Most tests don't bother — the defaults cover
Player / Deer / Tree / WoodenDoor + fallback.

## Fakes

- **mock-gl.ts** — `new Proxy({}, handler)`. Uppercase props
  (`gl.TEXTURE_2D`, `gl.FLOAT`, etc.) return a stable number each
  (via a constants map). Method calls are no-op functions returning
  a fresh handle. `getUniformLocation` returns a number — fine,
  since tests don't dereference it.

- **fake-sprite-registry.ts** — `resolve(bpId, variant)` returns a
  synthetic `SpriteSheetRef` with creature-shaped dimensions
  (92×92 frames, 8 rows × 7 cols) for known ids and a 64×64 fallback
  sheet otherwise.

- **fake-static-assets.ts** — returns
  `{ terrainTexture, maskTexture, wallTextures }` with stub textures
  and a `layerIndex` built in the same shape production generates
  (per terrain × frame count × variant count).

- **fake-connection.ts** —
  `{ isOpen, onMessage, send, close, deliver, sent, clearSent }`.
  `deliver(msg)` invokes the registered handler directly;
  `send(action)` captures into `sent[]`. No codec round-trip.

## Typical test pattern

```ts
import { createTestScene } from './harness.js';

it('does the thing', async () => {
  const { scene, conn } = await createTestScene();

  // Optionally: populate chunks, welcome + spawn player, etc.
  fillChunkTerrain(conn, 0, 0, Terrain.Grass);
  conn.deliver({ type: 'welcome', entityId: 1, seed: 1 });

  // Drive the scenario.
  conn.deliver({ type: 'worldDelta', data: {...} });

  // Assert.
  expect(scene.entities.get(1)!.visualX).toBeCloseTo(5.5, 2);
});
```

`controls.test.ts` has the pattern for invoking
`attachMouseControls` against a fake canvas + synthetic MouseEvent.
`interpolation.test.ts` has the pattern for manually driving
`scene.time` and ticking an entity.

## Adding a test

1. Pick the right file. If none fit, add a new `*.test.ts` under
   `test/client-gl/`.
2. Import from `./harness.js` — `createTestScene` covers 90 % of
   cases.
3. If you need a specific starting state (chunks, entities,
   inventory), compose it by delivering messages. Helper functions
   like `fillChunkTerrain` and `spawnPlayer` in the existing files
   are worth reusing; promote to a shared helper only when three
   tests want them.
4. Keep assertions close to observable state — `scene.entities`,
   `scene.chatLog`, `conn.sent`. Don't reach into private-ish scene
   internals; if a test wants something not exposed, that's a hint
   to expose it.

## Integration tests with a real server

Not built yet — would be the "Path B" variant from the design
discussion: spin up `GameWorld` in-process, use a
`TestPlayerConnection` that captures decoded events instead of
encoding them, pipe them into `FakeConnection.deliver`. When the
first test wants real tick mechanics (combat / pathfinding / etc),
that's the moment. ~60 lines of straightforward copy-paste from
`server/src/connections/ws-connection.ts`.

## What's *not* covered by vitest

- Actual pixels on screen. Shaders, visual layout, Y-sort correctness
  under hilly terrain, wall occlusion edge cases — puppeteer
  against `npm run dev`.
- WebSocket binary codec round-trip specifically. Codec has its own
  test file (`test/protocol.test.ts`); client tests use decoded
  messages directly.
- Browser API quirks (Image decoding, OffscreenCanvas). The
  production path uses them; tests stub them via the fakes.
