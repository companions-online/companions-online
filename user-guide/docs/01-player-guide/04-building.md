---
title: Building
sidebar_position: 4
---

# Building

Once you've crafted a few placeables, you can put them down in the
world. Building uses the same right-click-to-use gesture as
consumables: equip the placeable, hover over the tile you want,
right-click to confirm.

## Two kinds of placement

Things you place fall into one of two categories:

- **Building tiles** — Wooden Wall, Wooden Floor, Stone Floor.
  These become part of the terrain. Walls block movement and
  light; floors are walkable and don't block anything.
- **Entities** — Wooden Door, Storage Chest, Campfire. These are
  real objects in the world with their own behavior. A door
  opens and closes; a chest holds items; a campfire glows and
  cooks.

You don't have to think about the distinction at the moment of
placement — the game places each thing the right way automatically.
It only matters later, when you want to *interact* with what
you've built.

## How to place

1. Equip the placeable to your hand (click the quickslot or press
   **1**–**9**).
2. Move the mouse over the target tile. A translucent ghost shows
   where it will land and whether the spot is valid (red ghost =
   illegal placement).
3. Right-click to place. The item is consumed from your inventory
   and the structure appears.

You can place a tile or two away from yourself — you don't have
to be standing on the target. If the tile is unwalkable (e.g. a
river square you're bridging), the game routes you to a nearby
walkable tile and you place from there.

## Floors over water

A Wooden Floor or Stone Floor placed on a river tile works as a
bridge. Once it's down, you and anyone else can walk across. This
is the only way to cross rivers without going around.

Walls behave the opposite way — they're placed on dry, walkable
ground, and once placed they block movement until you destroy
them.

## Doors

Doors only make sense built into a wall. Place a door tile in the
gap of a wall row; players (and friendly companions) can then
**interact** with it (left-click while standing next to it) to
open and close it.

- **Closed** doors block movement, like walls. Light still passes.
- **Open** doors are walk-through.

You can't close a door if someone is standing on its tile.

## Storage chests

A Storage Chest is a placed entity that holds items. Walk up to
it and left-click to open its panel; drag items between your
inventory and the chest. Chests don't have a per-player lock
right now — anything left in one is community storage.

## Campfires

A campfire lights a 6-tile radius and prevents skeleton spawns
inside that radius. It also cooks raw food: stand adjacent, equip
Raw Meat or Raw Fish, right-click the campfire.

## Putting it together

A serviceable first-night base looks like this: a 3×3 footprint of
Wooden Walls with a Wooden Door on the south edge, a Wooden Floor
inside, a Storage Chest in the corner, and a Campfire just outside
the door. The walls keep skeletons out, the campfire stops them
from spawning nearby, and the chest gives you a place to dump
materials between expeditions.

<!-- TODO screenshot: small built shelter — 4 walls, a door, a wooden floor bridging a river, with the player inside -->
