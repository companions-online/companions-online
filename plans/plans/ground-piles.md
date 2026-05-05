# Ground Piles

## Motivation

Dropping, looting, and killing critters today spawns **one entity per unit** of
item. Drop 10 wood → 10 separate ground entities on the same tile. Kill a bear
with `{Hide, quantity: 3}` → 3 separate Hide entities
(`shared/src/loot-tables.ts`, spawn loop at
`server/src/game-world.ts:819-832`). The client pays for each one in entity
sync traffic, the ground looks like a stack of flickering duplicates, and
pickup requires N interactions to clear a tile.

## Current state (what's in the code today)

- `handleDrop` (`server/src/game-world.ts:602-614`) spawns one entity at the
  player's tile with only `blueprintId` + `position` on it. No quantity.
- `BlueprintData` component (`shared/src/components.ts:45-48`) carries only
  `blueprintId` + `variant`. There is no `quantity` anywhere on a world
  entity.
- `handlePickup` (`server/src/game-world.ts:560-585`) hardcodes qty = 1 into
  `inventoryMgr.addItem(...)` and destroys the ground entity.
- `OccupancyGrid` (`server/src/occupancy.ts`) is one-entity-per-tile, but
  ground items **bypass it** — they're never registered. So "is there already
  a pile here?" has no cheap lookup today.
- `inventory-manager.ts:20-46` already implements stack-merge into existing
  inventory stacks up to `bp.maxStack`. That logic is the template we'll
  mirror on the ground.

## Target behavior

- A tile holds at most **one pile per `blueprintId`**, up to `bp.maxStack`.
  Additional overflow spawns additional piles on the same tile (same-tile,
  different entities — ground items already ignore occupancy, so this is
  legal).
- Dropping stacks: if the player's tile has a same-blueprint pile with room,
  merge into it; overflow spawns a new pile.
- Picking up: drain up to `bp.maxStack - already-in-inventory` into the
  player's inventory (merging with any existing inventory stack of the same
  item per the existing `addItem` logic), leave the remainder on the ground
  as a pile with the reduced quantity.
- Loot drops emit **one pile per `LootDrop`**, not `drop.quantity` separate
  entities. A Bear's `{Hide, quantity: 3}` becomes one ground entity with
  `quantity: 3`.
- Client renders a quantity badge on ground entities, styled identically to
  the inventory grid badge (white number + shadow, bottom-right of the
  sprite).

## Implementation sketch

### Wire / component shape

Add `quantity: number` to `BlueprintData`:

```ts
// shared/src/components.ts
export interface BlueprintData {
  blueprintId: number;
  variant: number;
  quantity: number;   // NEW — default 1; serialized on ground items + loot
}
```

`quantity` defaults to 1 so creatures, NPCs, and placeables (which never
stack) just carry 1. Ground items and loot piles populate it truthfully.
The component codec already varints it cheaply; one extra byte per
ground-item delta is the cost.

### Server-side pile index

Add a side index on `GameWorld` keyed by tile:

```ts
// server/src/game-world.ts
private groundPilesByTile = new Map<number, number[]>();  // tileKey → entityIds
```

Helpers:

- `getPileAt(tileX, tileY, blueprintId): entityId | null` — scans the
  (small) array for a matching-blueprint pile with room. O(N) on N piles
  per tile; N is tiny in practice.
- `addToPile(entityId, delta)` — bumps `BlueprintData.quantity`, marks
  component dirty.
- `registerPile(entityId, tile)` / `unregisterPile(entityId, tile)` —
  maintain the index on spawn / destroy.

Keyed on `tileY * MAP_SIZE + tileX` (same scheme used elsewhere).

### Drop (`handleDrop`)

```
const { blueprintId, quantity } = inventoryMgr.drop(...);  // quantity now partial
let remaining = quantity;
while (remaining > 0) {
  const existing = getPileAt(tileX, tileY, blueprintId);
  if (existing) {
    const room = bp.maxStack - existing.quantity;
    const move = Math.min(room, remaining);
    addToPile(existing, move);
    remaining -= move;
    if (remaining > 0) {
      // pile full — fall through to spawn a new one on the next loop iter
    }
  } else {
    const qty = Math.min(remaining, bp.maxStack);
    spawnGroundPile(tileX, tileY, blueprintId, qty);
    remaining -= qty;
  }
}
```

### Pickup (`handlePickup`)

```
const pile = entities.get(entityId);
const bp = getBlueprint(pile.blueprint.blueprintId);
const existingInInventory = inventoryMgr.countOf(playerId, bp.blueprintId);
const room = bp.maxStack - existingInInventory;  // TODO: across multiple stacks
const take = Math.min(pile.quantity, room);
if (take > 0) {
  inventoryMgr.addItem(playerId, bp.blueprintId, take);
  pile.quantity -= take;
  if (pile.quantity === 0) destroy(pile);
  else markComponentDirty(pile, 'blueprint');
}
```

"Inventory room" needs a helper that respects the existing per-slot
stacking — `inventoryMgr.canAccept(bp, quantity)` — so a player with
three half-full wood stacks (max 99) still fills them before refusing.

### Loot spawn (`server/src/game-world.ts:819-832`)

Replace the `for (q = 0; q < drop.quantity; q++)` loop with a single
call that spawns a pile at `drop.quantity` (clamped by `maxStack`, same
overflow logic as drop). Non-stackable loot (rare; most things are
stackable now per collaboration memory) falls back to N separate entities.

### Client

- Static entity draw (`client-webgl/src/entities/static-entity.ts`) gains a
  quantity-badge path: if `blueprint.quantity > 1`, render the same badge
  used in the inventory grid on top of the sprite. Reuse
  `TextSurfaceFactory` for the text, cache per-quantity surfaces on the
  entity (invalidate when quantity changes).
- CLI gets the same treatment in its render path — single line, "Wood x7"
  instead of seven separate Wood tiles — but that's a follow-up; the
  server change is what unblocks the client work.

## Migration + tests

- The `quantity` field defaults to 1 in the codec, so old saves / loot
  tables that don't write it still decode correctly.
- Persistence (`test/persistence.test.ts`) round-trip should include a
  ground pile with quantity > 1.
- New E2E test: drop 10 wood on one tile → one ground entity,
  quantity = 10; pick up → inventory gets 10, ground entity gone.
- Loot test: kill critter with `{Hide, quantity: 3}` → one ground entity,
  quantity = 3.
- Overflow test: drop 150 wood (maxStack 99) → two piles on the same
  tile, quantities 99 + 51.

## Out of scope

- Per-tile pile limits (how many same-tile piles before we refuse). Leave
  uncapped for now; occupancy is irrelevant for ground items today.
- Weight-on-ground rules. Piles don't weigh; the player's carry weight
  only cares about inventory.
- Partial pickup UI (e.g. "pick up 5 of 10"). The existing
  `ClientAction.Pickup` just takes as much as fits, same as today.
