# Inventory / Crafting Panel + Quickbar + Placement Mode

Mouse-driven, Minecraft-style drag-and-drop UI rendered in the HUD pass.
Lives in `client-webgl/src/ui/inventory-panel.ts`, `ui/quickslot.ts`,
`ui/placement.ts`, and `ui/cooking-highlight.ts`. Opened with `I`, closed
with `I` / Esc. Auto-pops when a chest is opened.

## Layout

Centered in the **game viewport** (not the canvas) — `PANEL_X = GAME_X +
(GAME_W - PANEL_W) / 2`, same for Y — so it doesn't drift under the
right-hand HUD chrome. Sections:

1. Player (left) — name, HP bar, weight, three armor equipment slot
   widgets **top-down: head / body / boot**. Hand is deliberately absent
   — it's driven by the quickbar instead.
2. Inventory grid (center) — **9×3 cells** (27 slots), slot positions
   held in `scene.gridOrder: Map<itemId, slotIndex>`. Order is
   client-local; reapplied per `InventorySync`, lost on reload. Items
   bound to a quickslot are hidden from the grid.
3. Quickbar (below grid) — 9 cells labeled 1..9. Session-only client
   state. Binding an item here moves its display out of the grid; the
   selected slot draws with a bright background.
4. Right column — recipes when no chest is open, container items when
   one is. Recipes are filtered to currently-craftable
   (`visibleRecipes(scene)`); the empty-list case shows
   "(gather more resources)".

Cell icons are blits via `SpriteRenderer.drawSprite` against the sheet
returned by `scene.spriteRegistry.resolve(blueprintId, 0)`. UV selection
mirrors the world renderer's `static-entity.ts` dispatch:
animation-grid → `1/cols × 1/rows`; Door (special-cased by id) →
`0.5 × 0.5`; everything else → whole image (`0..1`). Quantity badges are
`TextSurfaceFactory` with a per-quantity cache.

## Drag-and-drop state machine

Held stack lives on `scene.heldStack: { itemId, blueprintId, quantity,
source: 'inventory' | 'container' } | null`. The `source` is the
origin's inventory; needed to route Transfer direction when dropping
across panels. Cursor position from `scene.cursorScreenX/Y` (updated by
`mouse.ts` mousemove); the OS cursor is hidden via
`canvas.style.cursor = 'none'` while held.

| State | Click | Target | Outcome |
|-------|-------|--------|---------|
| empty | left | grid w/ item | pick up whole stack |
| empty | right | grid w/ item | pick up `ceil(qty/2)` (visual split — source draws as `qty - heldQty`) |
| empty | shift+left | equippable, no chest | toggle Equip/Unequip (whole stack) |
| empty | shift+left | inventory item, chest open | Transfer player→chest (whole) |
| empty | shift+left | container item | Transfer chest→player (whole) |
| held | left | empty grid cell | local reorder (`gridOrder.set`) |
| held | left | grid w/ same item | return-to-source (server already merged by blueprintId) |
| held | left | grid w/ different item | swap — held becomes displaced item; partial-held + different = no-op |
| held | left | matching equip slot | Equip with quantity |
| held | left | container cell | Transfer player→chest (or chest→player if held came from container), with quantity |
| any  | left | outside panel | Close (held: Drop, or Transfer-back if from chest) |
| any  | I / Esc | — | Close (held: same as above) |

The keyboard close (`i` / Esc) and the click-outside dismiss share one
helper: `closeInventory(scene, conn)` exported from
`client-webgl/src/ui/inventory-panel.ts`. It returns held stacks to
their source container (if `heldStack.source === 'container'`), drops
to world otherwise, clears `scene.armedAction`, and sets `scene.overlay
= { kind: 'none' }`.

Server-relevant outcomes (Equip/Unequip/Drop/Transfer/Craft) are sent
immediately; the next `InventorySync` re-hydrates everything. Pure
local-only outcomes (grid reorder, cursor pickup, return-to-source)
never touch the wire.

## Wire protocol — optional `quantity`

`Drop`, `Transfer`, and `Equip` actions take an optional `quantity` in
`shared/src/protocol/codec.ts`. Encoded as a `u8` with `0` = "whole
stack" so the field is backwards-compatible. Defaults: omit ⇒ whole
stack everywhere (this changed `Transfer`'s historical 1-at-a-time
default — the matching `transferToContainer/FromContainer` server
helpers in `inventory-manager.ts` now respect quantity, defaulting to
the whole stack).

`InventoryManager.equip(eid, itemId, quantity?)` does an in-place split
when `quantity < stack.quantity`: it slices off `quantity` units into a
new inventory entry marked `equippedSlot`, leaving the remainder
unequipped on the source stack.

## Optimistic decrements (the flicker fix)

`scene.pendingItemDecrements: Map<itemId, { quantity, timestamp }>`
holds in-flight removals so the source slot stays visually empty
between click and server `InventorySync`. Every Drop / Transfer /
partial-Equip calls `markPendingDecrement(scene, itemId, qty)` before
clearing `heldStack`. The grid + container draw paths subtract the
pending qty when computing `shownQty`. Cleared wholesale on every
`InventorySync`; entries past `PENDING_DECREMENT_TTL_MS` (1s) auto-GC
in the draw path so a server-side rejection self-heals instead of
stranding the slot.

## In-game HUD quickbar

A compact 9-cell quickbar sits at the bottom of the **game viewport**
(inside the scissor region, above the HUD chrome) whenever the
inventory panel is closed. Same cell-draw helper as the in-panel
quickbar — `drawQuickbarCells(gl, sprites, factory, scene, solids, opts)` —
with smaller cells (`44 px`) and a tighter gap (`4 px`). The selected
slot uses `solids.cellSelected` (the same bright tan as in the panel).

Layout constants in `inventory-panel.ts`:
- `HUD_QUICKBAR_CELL = 44`, `HUD_QUICKBAR_GAP = 4`.
- Horizontally centered in the game viewport: `GAME_X + (GAME_W - W) / 2`.
- `y = GAME_Y + GAME_H - CELL - 8` — pinned to the bottom of the game area.

Gate: `drawHud` calls `drawQuickbarHud` only when
`!isInventoryShowing(scene.overlay)`. When the panel is open (the
`'inventory'` or `'container'` overlay variant), the panel's own
quickbar row takes over (no double-draw).

Keys `1..9` are accepted **in both states** (panel open or closed) —
they always drive `selectQuickSlot` / `selectedQuickSlot`, so the player
can swap hand items while browsing inventory.

The HUD quickbar is also clickable. `hudQuickbarCellRect(slotIndex)`
exposes per-cell canvas-pixel rects; `hitTestHudQuickbar(canvasX,
canvasY)` returns the slot index under a point or `null` (rejects gaps).
`controls/mouse.ts` runs the hit-test on left-click before the
world-click pipeline so a tap on a HUD cell calls `selectQuickSlot`
without ever triggering MoveTo. The HUD button bar (`ui/hud-buttons.ts`)
sits beside the quickbar at the bottom-right of the play area; see that
module for the action / inventory / settings buttons and the
`scene.armedAction` sticky tap-to-act flow.

## Quickbar selection (keys 1..9)

`scene.quickSlots: (number | null)[]` (length 9) and
`scene.selectedQuickSlot: number | null` live in `scene.ts`. Pressing
`1`..`9` calls `selectQuickSlot(scene, conn, idx)` in
`ui/quickslot.ts`:

- Empty slot → `Unequip(hand)` if hand was occupied; `selectedQuickSlot = null`.
- Equippable (hand slot) → `Equip({ itemId })`; selection updates.
- Non-equippable (bandage / cooked food / …) → no `Equip`, but if
  something equippable is still in hand from a prior selection,
  `Unequip(hand)` fires; selection updates.
- Same slot → no-op (debounce key repeat).

Selection is cleared on Esc (`clearQuickSlotSelection`) — also unequips
hand when the cleared selection was equippable. `InventorySync` prunes
any quickslot binding whose itemId disappeared and clears the selection
if that slot went empty.

## Context-sensitive world controls

`selectedMode(scene)` (in `ui/quickslot.ts`) classifies what the selected
quickslot does in the world:

| Mode | When | Right-click | Left-click |
|------|------|-------------|------------|
| `placement` | placeable + `equipSlot === 'hand'` | `UseItemAt` at hover tile | fall through → `resolveAction` |
| `cook` | RawMeat / RawFish | `UseItemAt` on adjacent campfire (silent no-op if not adjacent) | fall through → `resolveAction` |
| `consumable` | `bp.consumeHeal !== undefined` | `UseConsumable(itemId)` on self | fall through → `resolveAction` |
| `tool` | other `equipSlot === 'hand'` items | no-op | fall through (weapons auto-selected by `resolveAction`) |
| `none` | empty selection | no-op | fall through |

`mouse.ts::mousedown` dispatches right-clicks via this table before the
sprite-first hit-test; left-clicks stay on the legacy resolveAction path.
Critically, **placement left-click is NOT consumed** — the player can
still MoveTo / Attack while a placeable ghost is up.

## Placement mode

Active iff inventory closed AND `selectedMode === 'placement'`.
`mouse.ts` mousemove updates `scene.placementHoverTile` via
`scene.camera.tileAt`. The renderer draws the placeable's sprite at half
alpha at the hover tile (game-space scissor region, after effects).
**Right-click** sends `UseItemAt(itemId, tileX, tileY)`; left-click is
pass-through. Esc clears quickslot selection (which unequips hand),
doubling as "cancel placement." Validity (walkable / unblocked) stays
server-side; rejected placements bounce back without harm.

## Cooking-target highlight

Active iff inventory closed AND `selectedMode === 'cook'`. The **adjacent**
campfire (Chebyshev ≤ 1) is tinted red via the sprite shader's `u_tint`
uniform — a single in-place tint, no second draw. The check
`shouldTintCampfire(scene, entity)` in `ui/cooking-highlight.ts` is
consulted by `entities/static-entity.ts::drawAnimatedStatic` immediately
before the campfire's `drawSprite` call; the uniform is reset after so
later sprites aren't tinted.

Distant campfires get **no** visual treatment by design — only what the
player can act on right now stands out.

Right-click on the adjacent campfire tile (same Chebyshev ≤ 1, matching
server's `game-world.ts::handleUseItemAt` check) sends
`UseItemAt(rawItemId, tileX, tileY)`. Clicks on farther campfires
silently no-op; the player walks adjacent first.

## Container

`onContainerOpen` sets `scene.overlay = { kind: 'container', entityId,
items }`. The container variant is itself "inventory-showing" (per
`isInventoryShowing` in `overlay.ts`) so the inventory panel renders
with the chest items pinned to the right column. Closing via I/Esc
sets `scene.overlay = { kind: 'none' }` — the variant data drops with
the variant, no stale-fields tracking. Server's view lingers until the
player moves away.

## Files

```
client-webgl/src/ui/inventory-panel.ts   layout, draw, hit-test, click dispatch, quickbar drag, markPendingDecrement
client-webgl/src/ui/quickslot.ts         selectQuickSlot, clearQuickSlotSelection, selectedItem, selectedMode
client-webgl/src/ui/placement.ts         isPlacementActive, updatePlacementHover, handlePlacementClick (right=place, left=pass-through), drawPlacementGhost
client-webgl/src/ui/cooking-highlight.ts isCookingActive, shouldTintCampfire (consulted by static-entity.ts), handleCookingClick
client-webgl/src/ui/hud.ts               draws the HUD quickbar when panel closed; draws panel + heldCursor when open
client-webgl/src/entities/sprite-renderer.ts  setTint(r,g,b,a) — generic red-tint / color-tint hook used by cook highlight
client-webgl/src/entities/shaders.ts     sprite FS now mixes rgb with u_tint.rgb by u_tint.a after the lightmap multiply
client-webgl/src/scene.ts                holds heldStack, gridOrder, quickSlots, selectedQuickSlot, pendingItemDecrements, placementHoverTile, overlay (replaces inventoryOpen + container/dialogue fields), cursorScreenX/Y
client-webgl/src/overlay.ts              Overlay union (none | inventory | container | dialogue | menu) + helpers (isInventoryShowing, isInputCaptured, getContainer)
client-webgl/src/controls/keyboard.ts    'I' opens; 'Esc' clears quickslot selection (then placement-fallback); 1..9 → selectQuickSlot
client-webgl/src/controls/mouse.ts       right-click table (consumable/place/cook), left-click falls through to resolveAction
client-webgl/src/renderer.ts             placement-ghost pass + cooking-highlight pass (both unlit, after effects)
test/client-gl/inventory-ui.test.ts      hit-test + click dispatch + container + pending-decrement + quickbar drag + boot slot
test/client-gl/quickslot.test.ts         selectQuickSlot semantics, mode classification, inventorySync pruning
test/client-gl/placement.test.ts         placement right-click places, left-click falls through
test/client-gl/cooking.test.ts           adjacent-campfire right-click → UseItemAt, distant silent no-op
test/client-gl/consumable.test.ts        selectedMode 'consumable' + UseConsumable payload
```

## Shared: boot equip slot

`shared/src/blueprints.ts::EquipSlot` is `'hand' | 'body' | 'head' |
'boot'`. `shared/src/inventory.ts` exports `EQUIP_SLOT_BOOT = 4` plus
the `equipSlotToNumber` / `numberToEquipSlot` switch branches. Wire
protocol (`Equip` / `Unequip` / `SyncedInventoryItem.equippedSlot`) is
u8 with no range gate — no codec change needed. No boot item blueprints
exist yet; the slot accepts drops but stays empty until a future blueprint
adds one.

## Out of scope (deferred)

- Actual boot item blueprints (hide boots, iron boots) — slot is wired
  but no items yet.
- Persisting `quickSlots` / `gridOrder` across sessions — would require
  localStorage or a wire field.
- Pathfind-to-cook (server-side `pendingCook` resolver). Today a far
  right-click in cook mode is a silent no-op; user walks adjacent first.
- Tinting the placement ghost red/green by validity — needs a color-tint
  uniform on the sprite shader.
- Generic "icon UV" hint on the manifest — Door is currently the only
  multi-frame static placeable, hardcoded by id. Add the field if a
  third one shows up.
- Ground piles — implementation of the
  `plans/plans/ground-piles.md` plan is independent of this UI.
