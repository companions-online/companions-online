---
title: Tool reference
sidebar_position: 3
---

# Tool reference

The MCP server exposes 22 tools: one identification tool, 17 action
tools that change world state, and 4 read-only query tools.

Every tool except `identify` is gated by the identify contract — a
call before `identify` returns `[error] not identified` with
`isError: true`.

## Response envelope

Every successful action returns a text envelope built from a
subset of these sections:

| Section | When it appears |
| --- | --- |
| `<self>` | Position, HP, equipped items, current state. |
| `<map>` | ASCII view (~17×17), `@` is the player. |
| `<entities>` | Threats / creatures / players / NPCs / items / structures. |
| `<terrain>` | Mineable tiles (rock/water) within range. |
| `<inventory>` | When the action changed inventory. |
| `<events>` | Recent ticks (combat hits, harvest yields, etc.). |
| `<recipes>` | On `get_recipes`. |
| `<container>` | On `interact` with a chest. |
| `<dialogue>` | On `interact` with an NPC. |

The exact mix per tool is the **response shape**. Fast-path tools
that only changed inventory (e.g. `equip`) return just `<self>` +
`<inventory>` + `<events>` to save tokens.

## Identification

### `identify(name)`

Register the player. Must be the first tool call on a new session.

| Param | Type | Notes |
| --- | --- | --- |
| `name` | string | 1–16 chars; letters, digits, `_`, `-`. |

Returns the full envelope, with the player spawned at the world's
spawn point.

## Action tools

Each action call **blocks** until completion, rejection, or 30 s
timeout. The response envelope reflects the post-action state.

### `move_to(x, y)`

Walk to a tile. Pathfinds; rejects with structured `tile_blocked`
or `no_path` if unreachable. Movement rejections include
**obstacle hints** (e.g. "water blocks at (a,b) — build a wooden
floor to cross"). _Shape: full._

### `attack(entity_id)`

Attack an entity. Auto-pathfinds and chases. Blocks until the
target or the player dies. _Shape: full._

### `harvest(x, y)`

Harvest a resource tile (tree, rock, water for fish). Blocks until
the resource depletes, the inventory fills, or the server harvest
cap (5 yields) hits. _Shape: full or self+inventory depending on
whether the player walked first._

### `pickup(entity_id)`

Pick up a ground item. Auto-pathfinds. _Shape: full or
self+inventory depending on movement._

### `interact(entity_id)`

Interact with an entity. Auto-pathfinds. Behavior depends on
target:

- Door → toggles open/closed.
- Chest → opens its container; envelope includes `<container>`.
- NPC → opens dialogue; envelope includes `<dialogue>`.

_Shape: container / dialogue / full depending on side effect._

### `use_consumable(item_id)`

Use a consumable from inventory on yourself. _Shape:
self+inventory._

### `equip(item_id)`

Equip an inventory item to its slot. _Shape: self+inventory._

### `unequip(slot)`

Unequip from `'hand'`, `'body'`, or `'head'`. _Shape:
self+inventory._

### `drop(item_id)`

Drop an inventory item on the ground. _Shape: self+inventory._

### `craft(recipe_id)`

Craft a recipe by id (see `get_recipes`). _Shape: self+inventory._

### `use_item_at(item_id, x, y)`

Use the equipped item at a tile — places a building, places an
entity, or cooks at an adjacent campfire. Auto-pathfinds; the
"near" mode places from a walkable tile within reach if the
target itself isn't walkable (river bridging). _Shape: full for
placeables, self+inventory for cooking._

### `transfer(item_id, container_id, direction)`

Move an item to (`'to'`) or from (`'from'`) the currently-open
container. Requires a prior `interact` on the chest. _Shape:
transfer (compact)._

### `dialogue_select(npc_entity_id, option_id)`

Choose an option in an open NPC dialogue. _Shape: dialogue._

### `trade(npc_entity_id, trade_id)`

Execute a trade with an NPC. _Shape: self+inventory._

### `say(message)`

Send a chat message to nearby players. Doesn't interrupt other
actions — you can `say` while harvesting. _Shape: social._

### `wait(seconds)`

Pause without acting; the world keeps ticking. Range 0.1–30 s.
Useful for pacing or observation. _Shape: full._

### `server_command(command, parameter)`

Run a server command (currently `nick`/`name`). _Shape: meta
(compact)._

## Query tools

Queries don't tick the world or change state; they read current
data. Free to call.

### `get_surroundings()`

Look around. Returns the full envelope without acting.

### `get_inventory()`

Full inventory listing with item ids, equipment slots, and weight.

### `get_recipes()`

Recipes the player has materials for, with recipe ids for
`craft()`.

### `get_container()`

Contents of the currently-open container (set by a prior
`interact` on a chest).

## The rejection contract

Invalid actions don't fail silently — they return through a
structured rejection envelope with `isError: true`:

```
<action>[rejected: <reason>] Move to (50,40)</action>
<events>...</events>
```

Reasons are typed (`tile_blocked`, `no_path`, `out_of_range`,
`target_missing`, `inventory_full`, `not_in_inventory`,
`missing_material`, `not_adjacent`, `not_walkable`, …) and rendered
to text by `formatRejection`. Movement rejections additionally
include obstacle hints pointing at bypassable obstacles (water
that could be bridged, closed doors that could be opened) so the
model can correct.

Rejection envelopes are **minimal by design** — only `<action>`
plus `<events>` if any fired. There's no full snapshot replay,
because the model already had the previous envelope. If it wants
fresh state, it calls `get_surroundings`.
