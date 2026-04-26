# WebGL Client File Map

Everything under `client-webgl/src/`. Ordered by role, not alphabetically.

## Bootstrap + loop
```
main.ts                  Bootstrap: createScene → connect → wireSceneToConnection → attachMouseControls → renderer.start.
scene.ts                 Scene interface + createScene + chunk rebuild/eviction + lighting manager + onEnvironmentSync mutator + all on* mutators incl onGameEvent (action-anim + smoke-puff spawns).
renderer.ts              RAF loop: drain dirty chunks, tick entities, scene.lighting.update(), terrain + Y-sorted sprite passes (lit), drawEntityOverlays (HP bar + nameplate, unlit), effects pass (unlit), HUD.
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
entities/static-entity.ts    Placeable/item/resource factory. Three draw paths: door (2×2 facing+open), animated (sheet.animation → ticked walkFrame, col/row UV slice), single-frame.
entities/sprite-registry.ts  Load sprite sheets at boot. resolve(bpId, variant) → SpriteSheetRef (frameW/H = src slice, renderW/H = frameW * scale, scaled foot, optional animation block). Unknown-entity fallback.
entities/sprite-manifest.ts  Per-blueprint sheet metadata (name, frameW/H, footX/Y, optional scale + animation { cols, rows, frameCount, fps }). Keyed off shared BlueprintType.
entities/sprite-renderer.ts  Sprite GL program + drawSprite quad draws (bound once, invoked by entity draw fns). begin(res, lightmap?) / setSpriteTile / setLit for lighting integration.
entities/shaders.ts          Sprite VS/FS source strings. FS samples u_lightmap via u_spriteTileXY when u_lit=1.
```

## Terrain (chunk-sparse)
```
terrain/elevation.ts         buildElevationGridChunk(seed, worldMap, cx, cy) + getTileCornersLocal. Regenerated per chunk rebuild, not persisted.
terrain/terrain-instances.ts buildChunkTerrainData — base (256) + overlay + side + top-redraw instances for one chunk. Reads 1-tile border. Strides: 48 base / 52 overlay / 44 side / 48 top. Floor tiles (WoodenFloor/StoneFloor) lift their base-diamond top corners by FLOOR_LIFT_Z * PX_PER_Z, emit up to 2 side quads (SE/SW faces; shared interior edges suppressed), and emit 1 top-redraw instance (copy of the lifted base) for the post-overlay pass.
terrain/terrain-renderer.ts  GL terrain renderer. uploadInstances() full-replaces four buffers on any chunk change. Four-pass render: base → overlay → floor top-redraw (base program, topBuffer) → side (dedicated side program). Binds lightmap to TEXTURE2; passes lightmap uniforms to every pass.
terrain/texture.ts           generateRawTerrainTiles — procedural tile textures (OffscreenCanvas).
terrain/texture-arrays.ts    buildTerrainTextureArray / buildMaskTextureArray — upload to texture arrays.
terrain/blend-masks.ts       generateBlendMasks — blendomatic masks (CPU-only, static).
terrain/terrain-blend.ts     gatherInfluences + pickAdjacentMaskId + pickDiagonalMaskIds (blendomatic math). TERRAIN_NO_OVERLAY flags floors so they never contribute an overlay onto neighbors (hard edges).
terrain/shaders.ts           Terrain base + overlay + side VS/FS source strings. TILE_SIDE_VS uses rectangular corner UVs (all v=0.5, u varies 0→1) for a vertical-stripe slice of the top texture. TILE_SIDE_FS is opaque and applies SIDE_SHADE = 0.82 darkening. FS multiplies final RGB by u_lightmap sample at v_tileXY.
```

## Lighting
```
lighting/lighting.ts         LightingManager — per-frame RGB lightmap (ambient + shadowcast point lights), uploaded as GL texture. Advances gameMinute locally between server syncs.
lighting/shadowcast.ts       Per-target Bresenham raycast with blocker predicate (!worldMap.isLightPassing + collides-entities). Split from isWalkable so rivers are non-walkable but still transmit light. Strictly correct wall occlusion.
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

## Effects
```
effects/effect.ts            EffectManager + Effect interface. EffectKind: 'damage' | 'pickup' | 'chat' | 'sprite-anim'. Tick+draw in unlit pass.
effects/sprite-anim.ts       createSpriteAnim — generic one-shot sheet animation Effect. Playable by explicit frameSequence + totalDurationMs; optional scale + alpha multipliers; optional followEntityId to re-anchor each tick.
effects/effect-sprites.ts    loadEffectSprites — boots smoke / attack / harvest-craft sheets + HP-bar solid-color 1×1 textures. Injected via CreateSceneOptions.effectSprites for tests.
effects/damage-number.ts     createDamageNumber — red number floats up on HP decrease (largeFont for self).
effects/pickup-text.ts       createPickupText — green "+N item" floats up on pickup.
effects/chat-bubble.ts       createChatBubble — speech bubble fading out.
effects/text-surface.ts      TextSurfaceFactory — rasterized text textures, cached.
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
test/client-gl/shadowcast.test.ts       Per-target raycast + blocker behavior, wall occlusion, target-lit-when-blocker.
test/lighting.test.ts                   ambientTint keyframes + gameMinuteFromTick arithmetic.
test/e2e/environment.test.ts            Env section emission on keyframe crossings + tickOffset force-resync + effectiveTick math.
test/persistence.test.ts                Save/load round-trips tickOffset + new-world seeds twilight + legacy-save compat.
```

## Assets + HTML
```
client-webgl/index.html      <canvas id="game"> + <script type="module" src="/dist/main.js">.
client-webgl/assets/         deer, player, tree-0/1/2, door, unknown-entity PNGs; smoke-anim / attack-anim / harvest-craft-anim effect sheets.
client-webgl/build.ts        esbuild one-shot build.
client-webgl/dev.ts          esbuild --watch. No dev server — game server serves built bundle.
```
