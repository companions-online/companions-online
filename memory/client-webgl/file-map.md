# WebGL Client File Map

Everything under `client-webgl/src/`. Ordered by role, not alphabetically.

## Bootstrap + loop
```
main.ts                  Bootstrap: createScene → bootStandaloneObserver (always, as menu backdrop) → ConnectionRef wraps observer conn → wireSceneToConnection → loadMenuLogo + createMenuController + attachMenuInput + attachMouseControls + attachKeyboardControls → scene.overlay='menu/landing' → renderer.start. Owns startWorld(values) + joinWorld(values) handlers that tear down the active world (observer / in-tab player / networked) and swap connRef before applying /nick + /avatar.
scene.ts                 Scene interface + createScene + chunk rebuild/eviction + lighting manager + onEnvironmentSync + all on* mutators. Holds widgetPalette + menuLogo + menu controller refs. scene.reset() drops chunks/entities/inventory/chat/effects/nameplate-cache so menu-driven game-start can repopulate from a fresh world.
overlay.ts               Discriminated union for modal UI (none / inventory / container / dialogue / menu{landing|settings|create-join|connecting|connect-error}) + helpers (isInventoryShowing, isInputCaptured, getContainer). Menu screens carry per-variant data: create-join carries mode + values (CreateJoinValues = name|avatar|seed|host); connecting/connect-error carry host (and message) so transitions round-trip user input.
renderer.ts              RAF loop: tick observer-camera (if any), drain dirty chunks, tick entities, scene.lighting.update(), terrain + Y-sorted sprite passes (lit), drawEntityOverlays (HP bar + nameplate, unlit), effects pass (unlit), HUD, menu pass (when scene.overlay.kind === 'menu'). Camera follows player position OR scene.observerFocus when no player.
build-defines.d.ts       Declares `__BUILD_VERSION__` (esbuild define populated by build-shared::readBuildNumber from .build-number). menu-main.ts reads it via typeof guard so vitest imports without the define don't blow up.
```

## Network
```
network/connection.ts            WebSocket wrapper for same-origin auto-connect. encodeAction out, decodeServerMessage in. ?latency=N URL param. Unused at boot since menu lands first; reserved for any future skip-menu fast path.
network/connect-to.ts            connectTo(url, {timeoutMs?, latencyMs?}) — explicit-URL connect for the menu's Join World. Promise resolves on Welcome. Buffers pre-welcome chunks (server's addPlayer streams onChunkNeeded before onInitialState's encodeWelcome) and any post-welcome traffic until the caller installs onMessage; replays in arrival order. ConnectError = bad-url | refused | timeout | closed-pre-welcome | wrong-protocol; formatConnectError → user-visible string.
network/connection-ref.ts        ConnectionRef implements Connection — swappable proxy. send/onMessage/close/isOpen forward to a target connection that can be replaced via swap(next). Re-installs the latest onMessage handler on the new target so wireSceneToConnection's dispatch survives observer→player and observer→networked transitions without re-attaching listeners.
network/host-normalizer.ts       normalizeHost(input) → {url} | {error}. Local-host heuristic (localhost/127.x/::1/*.local → ws://, else wss://); explicit scheme always wins; explicit non-/ paths preserved literally; otherwise appends /ws.
network/wire-scene.ts            Decoded message → scene mutator dispatch. Networked path only; standalone bypasses (StandaloneConnection.onMessage is a no-op).
network/standalone-connection.ts Virtual-network peer of the WS connection. StandaloneConnection (player bridge: PlayerConnection ↔ Connection ↔ in-tab GameWorld) + StandaloneObserverConnection (observer bridge: no inventory, no actions, no player entity). StandaloneObserverRefs interface + tearDownStandaloneObserver(refs, scene) helper used by menu-driven game-start. bootStandalone + bootStandaloneObserver factories spin up GameWorld + GameLoop + connection + addPlayer/addObserver.
```

## Controls
```
controls/mouse.ts            mousedown → cursor-context → resolveAction → connection.send. Turn prediction on MoveTo. World input gated by isInputCaptured(scene.overlay).
controls/cursor-context.ts   Build shared ActionContext from scene state (worldMap + entities + inventory).
controls/keyboard.ts         Keyboard handler — chat input mode, debug, inventory toggle, Esc routing. Mutates scene.overlay for inventory open/close. Early-returns when scene.overlay.kind === 'menu' so menu-input owns input while the main menu is up.
controls/observer-camera.ts  Autopilot driver for observer mode. 8-dir random walk over float tile coords; 3-5s segments; edge buffer biases turns toward map center. Writes float coords to scene.observerFocus for smooth camera follow; pushes server setObserverFocus only on rounded-tile transitions. Mulberry32 RNG, seedable for tests.
controls/menu-input.ts       DOM event bridge for the menu. mousemove/mousedown/mouseup/keydown forward to the menu controller when scene.overlay.kind === 'menu'. Always attached at boot — the overlay-kind gate makes attach/detach unnecessary.
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
ui/hud.ts                    Chat log + input + debug overlay + inventory panel + always-visible quickbar. Quickbar hides whenever any overlay (inventory / container / dialogue / menu) is up via !isInputCaptured(scene.overlay).
ui/inventory-panel.ts        Drag-and-drop inventory + crafting + chest UI. See memory/client-webgl/inventory-panel.md for the cursor-held mechanics.
ui/quickslot.ts              9-slot quickbar selection (1..9 keys), context-sensitive right-click mode (placement/cook/consumable). selectQuickSlot + clearQuickSlotSelection.
ui/placement.ts              Placement-mode ghost sprite + UseItemAt click handling. updatePlacementHover / handlePlacementClick / isPlacementActive.
ui/cooking-highlight.ts      Adjacent-campfire tint + click handling for raw meat/fish.

# Menu (orientation: memory/client-webgl/menu.md)
ui/widget-palette.ts         Pre-baked 1×1 solid-color textures used by the menu/widget kit (bg, bgHover, bgPressed, border, inputBg, dim, accent, textSecondary). Mirrors effect-sprites' hpBar pattern.
ui/widgets.ts                Closure-factory widget kit: makeButton, makeTextInput (TextInputWidget extends Widget with getValue/setValue), makeLabel, makeDivider, makeImage, makeBackdropDim, makeSelectableTile. Widget interface (bounds, draw, hitTest, optional onMouseDown/Up/Key/setFocus, dispose). KeyEvent shape. TextInput Enter bubbles when no onSubmit wired so screen-level defaultAction fires; Esc always bubbles.
ui/logo.ts                   loadMenuLogo(gl) — one-shot loader for /assets/game-logo.png.
ui/menu.ts                   Menu orchestrator — createMenuController. Owns active screen widgets, focus, mouse + key dispatch, screen rebuild on signature change. Defines MenuContext (passed to screens — goTo/close/openUrl/startWorld/joinWorld/focusWidget) and ScreenBuild (factory return: widgets + optional defaultAction/escapeAction/initialFocus).
ui/menu-main.ts              Landing screen. Logo + 3-button stack (New Game / Join Game / Settings) + footer link bottom-left + build NNN bottom-right.
ui/menu-settings.ts          Placeholder. Title + Back. Empty per milestone scope.
ui/menu-create-join.ts       Unified create/join screen. Mode-aware upper section (Seed input for 'new' / Host input + Paste for 'join'); Character lower section (Name input + Avatar tiles); bottom bar with Back + Start World/Join World. Per-keystroke patches go to scene.overlay.values without rebuilding (signature ignores values). Paste handler: clipboard.readText → setValue, on denial focusWidget(hostInput). defaultCreateJoinValues(servedHost) seeds initial entry.
ui/menu-connect.ts           Connecting + connect-error screens for the Join World flow. Connecting: title + host label, no Enter/Esc default. Connect-error: title + message + host + [Back][Retry]; Enter retries, Esc backs.
ui/avatar-selector.ts        buildAvatarTiles({x,y,selected,onSelect,spriteRegistry}). KNOWN_VARIANTS is the source of truth for valid variant ids; tile renders south-facing idle frame from the player walk-cycle sheet.
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
test/client-gl/widgets.test.ts          Widget kit — Button click semantics (armed/disarmed), TextInput edit + bubble-Enter / bubble-Esc, surface cache + dispose, Image / Divider / BackdropDim smoke.
test/client-gl/host-normalizer.test.ts  Host input → ws/wss URL normalization. Schemes, ports, paths, local-host heuristic, malformed input.
test/lighting.test.ts                   ambientTint keyframes + gameMinuteFromTick arithmetic.
test/e2e/environment.test.ts            Env section emission on keyframe crossings + tickOffset force-resync + effectiveTick math.
test/persistence.test.ts                Save/load round-trips tickOffset + new-world seeds twilight + legacy-save compat.
```

## Assets + HTML + build
```
client-webgl/index.html             Networked-mode entry. Inline script sets window.GAME_SERVER_HOST = window.location.host so the menu autofills the Join Game host field.
client-webgl/index-standalone.html  Standalone-mode entry. No GAME_SERVER_HOST → menu's host field starts empty.
client-webgl/assets/                deer, player, tree-0/1/2, door, unknown-entity PNGs; smoke-anim / attack-anim / harvest-craft-anim / healing-anim effect sheets; game-logo.png for the main menu.
client-webgl/build-shared.ts        Shared esbuild plumbing — makeAliasPlugin resolving @shared/*, @server/*, @client-webgl/*. Also exports readBuildNumber(clientWebglDir) for the __BUILD_VERSION__ define.
client-webgl/build.ts               esbuild one-shot build. Defines __BUILD_VERSION__ from .build-number.
client-webgl/dev.ts                 esbuild --watch. No dev server — game server (npm run dev) serves the built bundle. Defines __BUILD_VERSION__.
client-webgl/dev-standalone.ts      esbuild watch + serve mode (default :3002, servedir = client-webgl/). Used by `npm run dev:standalone` for offline iteration. Defines __BUILD_VERSION__.
.build-number                       Repo-root counter. Vitest global setup increments on every test run; build scripts read it as the production build version.
```
