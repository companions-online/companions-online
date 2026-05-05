# Main Menu

Canvas-native menu drawn on top of a live observer-mode world. Both
standalone and game-server-served boots mount it; the only mode-driven
difference is whether the host field is autofilled from
`window.GAME_SERVER_HOST`.

## Boot flow

`main.ts` always boots an observer world via `bootStandaloneObserver`
(menu backdrop with autopilot pan), wires controls + scene to a
`ConnectionRef`, opens `scene.overlay = {kind:'menu', screen:'landing'}`.
The networked `connect()` and the in-tab `bootStandalone()` are both
deferred to menu-driven game-start (Start World / Join World). On
success, the active world is torn down and replaced atomically — see
the "Game-start orchestration" section below.

## Files

- `ui/widget-palette.ts` — pre-baked 1×1 solid-color textures (bg,
  bgHover, bgPressed, border, inputBg, dim, accent, textSecondary).
  HP-bar pattern (`createSolidColorTexture` + drawSprite) kept
  consistent with `effects/effect-sprites.ts`.
- `ui/widgets.ts` — closure factories: `makeButton`, `makeTextInput`,
  `makeLabel`, `makeDivider`, `makeImage`, `makeBackdropDim`,
  `makeSelectableTile`, `makeToggle` (focusable on/off; click + Space +
  Enter all flip; closure-local state, no persistence). `Widget`
  interface (bounds, draw, hitTest, optional onMouseDown/Up/Key/setFocus,
  dispose).
- `ui/logo.ts` — one-shot `loadMenuLogo(gl)` for `assets/game-logo.png`.
- `ui/menu.ts` — orchestrator (`createMenuController`). Owns the active
  screen widgets, focus, mouse + key dispatch, screen rebuild on
  signature change. Defines `MenuContext` (passed to screens) and
  `ScreenBuild` (returned from screens).
- `ui/menu-main.ts` — landing screen. Three-button stack
  (`New Game | Join Game | Settings`); footer link
  bottom-left, `build NNN` bottom-right.
- `ui/menu-settings.ts` — context-aware screen. Always: title + **Music**
  toggle (`makeToggle`, pure UI placeholder — no persistence, no audio
  playback wired yet). Then a button row that depends on the overlay's
  `context`:
    - `'main-menu'` (entered from landing) → single **Back** button.
      Enter and Esc both fire Back.
    - `'in-game'` (entered via Esc during play) → **Back to Game** +
      **Disconnect**. Esc fires Back to Game; Enter is intentionally
      unwired (no accidental Disconnect on a stray Enter). Disconnect
      routes via `MenuContext.disconnect()`.
- `ui/menu-create-join.ts` — unified create/join screen. Mode-aware
  upper section (Seed input for `'new'`; Host input + Paste button for
  `'join'`); Character lower section (Name input + Avatar tiles);
  bottom bar with Back + Start World / Join World.
- `ui/menu-connect.ts` — connecting + connect-error screens for the
  Join World flow.
- `ui/avatar-selector.ts` — `buildAvatarTiles(opts)`. `KNOWN_VARIANTS`
  is the single source of truth for variant ids; tiles render the
  south-facing idle frame from the player walk-cycle sheet via
  `spriteRegistry.resolve(BlueprintType.Player, variant)`.
- `controls/menu-input.ts` — DOM event bridge. mousemove / mousedown /
  mouseup / keydown forward to the controller when
  `scene.overlay.kind === 'menu'`. `controls/keyboard.ts` early-returns
  on the same condition; `controls/mouse.ts` already gates via
  `isInputCaptured(scene.overlay)`.
- `network/connection-ref.ts` — `ConnectionRef implements Connection`.
  Forwards send/onMessage/close to a swappable target. Lets all 30+
  `connection.send` callsites stay attached at boot while the
  underlying connection is replaced at game-start.
- `network/host-normalizer.ts` — `normalizeHost(input)`. Local-host
  heuristic (localhost / 127.x / ::1 / *.local → ws://, else wss://);
  explicit scheme always wins; explicit non-`/` paths preserved
  literally; otherwise appends `/ws`.
- `network/connect-to.ts` — `connectTo(url, {timeoutMs})`. Promise
  resolves on Welcome; pre-welcome chunks (and post-welcome traffic
  before `onMessage` is wired) are buffered in arrival order and
  replayed when the handler installs. `ConnectError` discriminated
  union: `bad-url | refused | timeout | closed-pre-welcome |
  wrong-protocol`. `formatConnectError` maps to user-visible strings.

## Overlay state machine

`Overlay` (`overlay.ts`) carries the full menu state. Per-screen
variants:

- `{kind:'menu', screen:'landing'}` — start point.
- `{kind:'menu', screen:'settings', context: 'main-menu' | 'in-game'}` —
  context distinguishes entry point. Included in the menu controller's
  signature (`menu:settings:${context}`) so a context flip rebuilds the
  button row.
- `{kind:'menu', screen:'create-join', mode, values}` — values is
  `{name, avatar, seed, host}` carried so subsequent transitions
  (connecting, connect-error, back) round-trip user edits.
- `{kind:'menu', screen:'connecting', host, values}` — transient.
- `{kind:'menu', screen:'connect-error', host, message, values}` —
  Back returns to create-join with values intact; Retry re-issues
  joinWorld.

The menu controller's screen signature ignores `values` (per-keystroke
patches don't trigger rebuilds — focus survives). It DOES include
`mode` (create-join `'new'` ≠ `'join'`), `host`, and `message` since
those drive visible content.

## Editing pattern (create-join)

TextInputs hold their own value internally during editing; `onChange`
writes patches into `scene.overlay.values` via `goTo`. Click handlers
(Back, Start/Join) read `scene.overlay.values` at submit time, not the
closed-over `values` from screen build time. The signature-stable
goTo keeps the active widget tree mounted across keystrokes — focus
+ caret state survive every patch.

## Game-start orchestration (`main.ts`)

`startWorld(values)`:
1. `tearDownActive()` — stops observer / prior in-tab player / prior
   networked conn (whichever is live).
2. `scene.reset()` — drops chunks, entities, inventory, chat, effects,
   nameplate cache. Static GPU assets (palette, logo, terrain texture
   array) stay.
3. `bootStandalone(scene, chosenSeed)`.
4. `connRef.swap(playerRefs.conn)` — re-installs the dispatch handler
   on the new target.
5. `applyCharacterChoices(values)` — sends `/nick` only if name ≠
   `'Player'`, `/avatar` only if variant ≠ 0.
6. `scene.overlay = {kind:'none'}` — dismisses the menu.

`joinWorld(values)` is async:
1. `normalizeHost(values.host)` — on error, jumps directly to
   `connect-error` (observer pan continues underneath).
2. Transition to `connecting` so the user sees feedback.
3. `await connectTo(url)`. Failure → `connect-error` with
   `formatConnectError(err)`; observer pan still alive underneath, so
   Retry from the error screen replays the same flow seamlessly.
4. Success → `tearDownActive()`, `scene.reset()`, `connRef.swap(newConn)` —
   the swap immediately replays buffered welcome through the dispatch.
   Then `applyCharacterChoices(values)` and dismiss.

## Disconnect orchestration (`main.ts`)

Inverse of `startWorld` / `joinWorld`. Fired by the in-game settings
screen's **Disconnect** button via `MenuContext.disconnect()`, which is
plumbed through `CreateMenuOpts.onDisconnect` to `main.ts::disconnect()`:

1. `tearDownActive()` — stops whichever world is live (in-tab player or
   networked conn).
2. `scene.reset()` — wipes replicated state.
3. `bootStandaloneObserver(scene, initialSeed)` — re-mounts the observer
   backdrop; `observerRefs` is reassigned. Reusing `initialSeed` keeps
   post-disconnect identical to boot-time observer.
4. `connRef.swap(observerRefs.conn)` — dispatch routes through observer
   bridge again.
5. `scene.overlay = { kind: 'menu', screen: 'landing' }` — back at the
   landing screen with autopilot pan running underneath.

`MenuContext` exposes `disconnect()` alongside `startWorld` /
`joinWorld`. Reserved for the in-game flow only — main-menu Settings
never calls it (no button to press).

## In-game entry (Esc)

`controls/keyboard.ts` has an Esc fallthrough at the bottom of the
keydown handler: when `scene.overlay.kind === 'none'` (no inventory,
no quickslot selection, no placement mode — those branches early-return
on Esc and take priority), Esc sets
`overlay = {kind:'menu', screen:'settings', context:'in-game'}`.

The handler calls `ev.stopImmediatePropagation()` after the mutation.
Both `attachKeyboardControls` and `attachMenuInput` register keydown
listeners on the same canvas; without stop-prop, the menu-input listener
would see the just-mutated overlay (`kind === 'menu'`) and dispatch the
same Esc to the menu controller's `escapeAction` (= Back to Game) in the
same tick — closing the menu we just opened.

## Server `/avatar` command

Avatar selection wires through the existing `BlueprintData.variant`
component, not a new MetaKey. `/avatar <n>` validates `n` against
`getBlueprint(player.blueprintId).variantCount` (default 1) and calls
`entities.blueprint.set(eid, {blueprintId, variant})` — the
ComponentStore's auto-dirty marks the entity for the next WorldDelta.
New avatars: bump `variantCount` in `shared/src/blueprints.ts` for the
Player entry, ship `player-<n>.png`, add an entry to `KNOWN_VARIANTS`
in `avatar-selector.ts`.

## Build version

`__BUILD_VERSION__` is an esbuild `define` populated by
`build-shared.ts::readBuildNumber(clientWebglDir)` reading
`<repo>/.build-number`. The vitest global setup
(`scripts/vitest-global-setup.ts`) bumps that file on every test run, so
production builds pick up whatever the most recent test left.
`menu-main.ts` reads via `typeof __BUILD_VERSION__ !== 'undefined'` so
test imports of menu code don't blow up when the define is absent.

## Keyboard semantics

The menu's `onKey` handler offers focused-widget consumption first,
then screen-level defaults:

- TextInput consumes printable / Backspace; Enter consumes only when
  `onSubmit` is wired (the menu doesn't wire it — Enter bubbles to the
  screen default). Esc always bubbles.
- Screen-level `defaultAction` fires on Enter, `escapeAction` on Esc.
  Per-screen wiring:
  - landing: neither (user picks a button)
  - settings (main-menu): Enter and Esc both fire Back
  - settings (in-game): Esc fires Back to Game; Enter unwired
  - create-join: Enter → Start/Join World; Esc → Back to landing
  - connecting: neither (read-only; 8s timeout bounds it)
  - connect-error: Enter → Retry; Esc → Back to create-join

`focusWidget(target)` on `MenuContext` is the controller-aware focus
setter — used by the create-join paste handler to focus the host input
when `navigator.clipboard.readText()` is denied.

## Tests

- `test/client-gl/widgets.test.ts` — Button click semantics, TextInput
  editing + bubble-Enter / bubble-Esc, surface cache + dispose, plus
  Image / Divider / BackdropDim smoke.
- `test/client-gl/host-normalizer.test.ts` — schemes, ports, paths,
  local-host heuristic, malformed input.
- `test/e2e/server-commands.test.ts` — `/avatar` validation
  (`variant 0` round-trips, out-of-range / non-numeric / negative
  rejection).
