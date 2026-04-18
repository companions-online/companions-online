# WebGL Client File Map

Everything under `client-webgl/src/`. Ordered by role, not alphabetically.

## Bootstrap + loop
```
main.ts                  Bootstrap: createScene → connect → wireSceneToConnection → attachMouseControls → renderer.start.
scene.ts                 Scene interface + createScene + chunk rebuild/eviction + all on* mutators.
renderer.ts              RAF loop: drain dirty chunks, tick entities, terrain + Y-sorted sprite passes, HUD.
```

## Network
```
network/connection.ts    WebSocket wrapper. encodeAction out, decodeServerMessage in. ?latency=N URL param.
network/wire-scene.ts    Decoded message → scene mutator dispatch. Used by main.ts and tests.
```

## Controls
```
controls/mouse.ts        mousedown → cursor-context → resolveAction → connection.send. Turn prediction on MoveTo.
controls/cursor-context.ts  Build shared ActionContext from scene state (worldMap + entities + inventory).
```

## Entities
```
entities/client-entity.ts    ClientEntity interface — extends EntityComponents + visual state (visualX/Y, lerpFromX/Y, checkpointMs, spriteSheet, walkFrame).
entities/from-network.ts     createEntityFromNetwork (factory dispatch by blueprint category) + applyComponentsToEntity (delta merge + lerp checkpoint).
entities/creature-entity.ts  Creature/NPC factory. Tick: lerp visualX/Y, advance walk frame. Draw: 8-dir walk-cycle sheet.
entities/static-entity.ts    Placeable/item/resource factory. Door draws 2×2 sheet + reads worldMap for facing.
entities/sprite-registry.ts  Load sprite sheets at boot. resolve(bpId, variant) → SpriteSheetRef. Unknown-entity fallback.
entities/sprite-manifest.ts  Per-blueprint sheet metadata (name, frameW/H, footX/Y). Keyed off shared BlueprintType.
entities/sprite-renderer.ts  Sprite GL program + drawSprite quad draws (bound once, invoked by entity draw fns).
entities/shaders.ts          Sprite VS/FS source strings.
```

## Terrain (chunk-sparse)
```
terrain/elevation.ts         buildElevationGridChunk(seed, worldMap, cx, cy) + getTileCornersLocal. Regenerated per chunk rebuild, not persisted.
terrain/terrain-instances.ts buildChunkTerrainData — base (256) + overlay instances for one chunk. Reads 1-tile border.
terrain/terrain-renderer.ts  GL terrain renderer. uploadInstances() full-replaces both buffers on any chunk change.
terrain/texture.ts           generateRawTerrainTiles — procedural tile textures (OffscreenCanvas).
terrain/texture-arrays.ts    buildTerrainTextureArray / buildMaskTextureArray — upload to texture arrays.
terrain/blend-masks.ts       generateBlendMasks — blendomatic masks (CPU-only, static).
terrain/terrain-blend.ts     gatherInfluences + pickAdjacentMaskId + pickDiagonalMaskIds (blendomatic math).
terrain/shaders.ts           Terrain base + overlay VS/FS source strings.
```

## Buildings
```
buildings/wall-sprites.ts    buildWallDrawablesForChunk — per-chunk wall drawables (shape from adjacency).
buildings/wall-texture.ts    generateWallTextures — procedural wall face textures, static at boot.
```

## Platform
```
platform/camera.ts           Iso follow camera. getOffset + tileAt (screen-to-tile inverse).
platform/config.ts           Render constants: TILE_W/H, GAME_X/Y/W/H, TERRAIN_VARIANT_COUNTS, WATER_ANIM_*.
platform/gl-utils.ts         createImageTexture, linkProgram, createBuffer, createTextureArray, uploadBitmapLayer, checkGLError.
```

## UI
```
ui/hud.ts                    Stub — no UI yet (Phase 9 holds state, UI is a later pass).
```

## Tests
```
test/client-gl/harness.ts               createTestScene — builds fully-wired scene with fakes.
test/client-gl/mock-gl.ts               Proxy-based WebGL2RenderingContext stub.
test/client-gl/fake-sprite-registry.ts  Synthetic registry — no PNGs, no Image decoding.
test/client-gl/fake-static-assets.ts    Stub terrain/mask/wall texture arrays + shaped layerIndex.
test/client-gl/fake-connection.ts       In-memory Connection. deliver(msg) inbound, sent[] outbound.
test/client-gl/scene.test.ts            Scene mutators, entity factory dispatch, capacity.
test/client-gl/interpolation.test.ts    Lerp math + re-checkpointing + walk frame animation.
test/client-gl/controls.test.ts         cursor-context + resolveAction integration + attachMouseControls end-to-end.
test/client-gl/inventory.test.ts        inventorySync + fishing-rod-on-water + container/dialogue/chat.
```

## Assets + HTML
```
client-webgl/index.html      <canvas id="game"> + <script type="module" src="/dist/main.js">.
client-webgl/assets/         deer, player, tree-0/1/2, door, unknown-entity PNGs.
client-webgl/build.ts        esbuild one-shot build.
client-webgl/dev.ts          esbuild --watch. No dev server — game server serves built bundle.
```
