# Inventory / Crafting Panel + Placement Mode

Mouse-driven, Minecraft-style drag-and-drop UI rendered in the HUD pass.
Lives in `client-webgl/src/ui/inventory-panel.ts` plus
`client-webgl/src/ui/placement.ts`. Opened with `I`, closed with `I` /
Esc. Auto-pops when a chest is opened.

## Layout

Centered in the **game viewport** (not the canvas) — `PANEL_X = GAME_X +
(GAME_W - PANEL_W) / 2`, same for Y — so it doesn't drift under the
right-hand HUD chrome. Three columns:

1. Player — name, HP bar, weight, three equipment slot widgets
   (hand / body / head).
2. Inventory grid — 6×5 cells, slot positions held in
   `scene.gridOrder: Map<itemId, slotIndex>`. Order is client-local;
   reapplied per `InventorySync`, lost on reload.
3. Right column — recipes when no chest is open, container items when
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
| held | left | outside panel | Drop with quantity |
| held | I / Esc | — | Drop (or Transfer-back if from chest) at player tile, then close |

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

## Placement mode

Active iff inventory closed AND a placeable (`bp.category === 'placeable'`)
is hand-equipped. `mouse.ts` mousemove updates
`scene.placementHoverTile` via `scene.camera.tileAt`. The renderer
draws the placeable's sprite at half alpha at the hover tile (in the
game-space scissor region, after effects). Left-click sends
`UseItemAt(itemId, tileX, tileY)`; right-click clears the hover for one
frame ("cancel"); Esc unequips the hand slot via the keyboard
controller. Validity (walkable / unblocked) is left to the server —
mismatched placements bounce back without harm.

## Container

`scene.containerEntityId !== null` triggers two behaviors: the right
column draws container items (with same icon + quantity badge as the
grid), and the panel auto-opens (`onContainerOpen` sets
`inventoryOpen = true`). Closing the panel via I/Esc clears
`containerEntityId / containerItems` on the client; server's view
lingers until the player moves away.

## Files

```
client-webgl/src/ui/inventory-panel.ts   layout, draw, hit-test, click dispatch, ghost-cursor draw, markPendingDecrement
client-webgl/src/ui/placement.ts         isPlacementActive, updatePlacementHover, handlePlacementClick, drawPlacementGhost
client-webgl/src/ui/hud.ts               calls drawInventoryPanel + drawHeldCursor when scene.inventoryOpen
client-webgl/src/scene.ts                holds heldStack, gridOrder, pendingItemDecrements, placementHoverTile, inventoryOpen, cursorScreenX/Y
client-webgl/src/controls/keyboard.ts    'I' opens; 'Esc' closes (drops held); placement-active 'Esc' unequips hand
client-webgl/src/controls/mouse.ts       routes panel hits, placement clicks; mousemove → cursor + placement hover
client-webgl/src/renderer.ts             game-space placement-ghost pass; canvas.style.cursor sync to heldStack
test/client-gl/inventory-ui.test.ts      hit-test + click dispatch + container + pending-decrement
test/client-gl/placement.test.ts         placement-mode action dispatch
```

## Out of scope (deferred)

- Generic "icon UV" hint on the manifest — Door is currently the only
  multi-frame static placeable, hardcoded by id. Add the field if a
  third one shows up.
- Tinting the placement ghost red/green by validity — needs a color-tint
  uniform on the sprite shader.
- Persisting `gridOrder` across sessions — would require a wire field
  on `SyncedInventoryItem`.
- Ground piles — implementation of the
  `docs/plans/ground-piles.md` plan is independent of this UI.
