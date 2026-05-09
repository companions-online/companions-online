---
title: Crafting
sidebar_position: 3
---

# Crafting

Crafting turns gathered materials into the gear you actually need
— tools to gather faster, weapons to fight better, armor to survive
hits, and the placeable structures that make a base a base.

## How it works

Open your inventory with **I**. The recipes panel lists everything
you can make and the materials each one needs. Recipes you have
the materials for are highlighted; the rest are grey but still
visible so you know what to gather toward. Click a recipe to craft
one — the materials disappear from your inventory and the result
lands in an empty slot.

Some recipes also need a **tool** in your inventory. The tool isn't
consumed; it's just a gate. For example, anything iron requires a
Hammer, which means you have to craft a Hammer before you can
craft an Iron Sword.

Items in this game stack to 10, including tools and weapons, so a
single inventory row can hold ten axes if for some reason you want
ten axes.

## Recipes

### Tools

| Item | Materials | Notes |
| --- | --- | --- |
| <img src="/img/recipes/axe.png" className="recipe-icon" alt="" /> Axe | 2 Wood, 1 Rock | Faster tree harvesting. |
| <img src="/img/recipes/pickaxe.png" className="recipe-icon" alt="" /> Pickaxe | 2 Wood, 2 Rock | Faster rock harvesting. |
| <img src="/img/recipes/hammer.png" className="recipe-icon" alt="" /> Hammer | 1 Wood, 2 Iron | Required to craft iron items. |
| <img src="/img/recipes/fishing-rod.png" className="recipe-icon" alt="" /> Fishing Rod | 2 Wood, 1 Hide | Use on water tiles to catch fish. |

### Weapons

| Item | Materials | Notes |
| --- | --- | --- |
| <img src="/img/recipes/wooden-club.png" className="recipe-icon" alt="" /> Wooden Club | 3 Wood | Day-one weapon. |
| <img src="/img/recipes/stone-knife.png" className="recipe-icon" alt="" /> Stone Knife | 1 Wood, 2 Rock | Slight upgrade. |
| <img src="/img/recipes/iron-sword.png" className="recipe-icon" alt="" /> Iron Sword | 1 Wood, 3 Iron | Requires Hammer. |
| <img src="/img/recipes/iron-spear.png" className="recipe-icon" alt="" /> Iron Spear | 2 Wood, 2 Iron | Requires Hammer. |

### Armor

| Item | Materials | Notes |
| --- | --- | --- |
| <img src="/img/recipes/hide-vest.png" className="recipe-icon" alt="" /> Hide Vest | 4 Hide | Body slot. |
| <img src="/img/recipes/hide-cap.png" className="recipe-icon" alt="" /> Hide Cap | 2 Hide | Head slot. |
| <img src="/img/recipes/iron-chestplate.png" className="recipe-icon" alt="" /> Iron Chestplate | 5 Iron | Body slot. Requires Hammer. |
| <img src="/img/recipes/iron-helm.png" className="recipe-icon" alt="" /> Iron Helm | 3 Iron | Head slot. Requires Hammer. |

### Consumables

| Item | Materials | Notes |
| --- | --- | --- |
| <img src="/img/recipes/bandage.png" className="recipe-icon" alt="" /> Bandage | 2 Hide | Heals on use. |

### Placeables

| Item | Materials | Notes |
| --- | --- | --- |
| <img src="/img/recipes/campfire.png" className="recipe-icon" alt="" /> Campfire | 3 Wood, 1 Rock | Light + cooking. See [Building](./building). |
| <img src="/img/recipes/wooden-wall.png" className="recipe-icon" alt="" /> Wooden Wall | 4 Wood | Tile-layer building. Blocks movement. |
| <img src="/img/recipes/wooden-door.png" className="recipe-icon" alt="" /> Wooden Door | 5 Wood, 1 Iron | Entity. Open/close with interact. |
| <img src="/img/recipes/storage-chest.png" className="recipe-icon" alt="" /> Storage Chest | 6 Wood, 2 Iron | Entity. Stores items. |
| <img src="/img/recipes/wooden-floor.png" className="recipe-icon" alt="" /> Wooden Floor | 1 Wood | Tile-layer. Walkable; bridges water. |
| <img src="/img/recipes/stone-floor.png" className="recipe-icon" alt="" /> Stone Floor | 2 Rock | Tile-layer. Walkable; bridges water. |

## Cooking

Cooking isn't a recipe in the inventory panel — it happens at a
**Campfire**. Equip the raw food, stand next to a campfire, and
click or tap the campfire (`use_item_at` on the campfire tile, for
LLM players). The raw item is consumed and a cooked one lands in
your inventory.

| Output | Inputs | Notes |
| --- | --- | --- |
| <img src="/img/recipes/cooked-meat.png" className="recipe-icon" alt="" /> Cooked Meat | <img src="/img/recipes/raw-meat.png" className="recipe-icon" alt="" />Raw Meat + <img src="/img/recipes/campfire.png" className="recipe-icon" alt="" />Campfire | Heals more than raw. |
| <img src="/img/recipes/cooked-fish.png" className="recipe-icon" alt="" /> Cooked Fish | <img src="/img/recipes/raw-fish.png" className="recipe-icon" alt="" />Raw Fish + <img src="/img/recipes/campfire.png" className="recipe-icon" alt="" />Campfire | Heals more than raw. |

Raw Meat drops from killing critters (Deer, Wolf, Bear); Raw Fish
comes from harvesting water tiles with a Fishing Rod.

## A typical first crafting chain

The shortest path from spawn to "set for the night" is:

1. Chop two trees → 10 Wood, plus a couple of rocks lying around.
2. Craft an **Axe** (2 Wood + 1 Rock). Now you chop faster.
3. Chop another tree, mine a rock pile → enough for a **Campfire**
   and a **Wooden Club**.
4. Place the campfire. Equip the club. You're ready for sundown.

Day two, once you've farmed a few skeletons for Iron, the chain
continues: Hammer → Iron Sword → Iron Helm → Iron Chestplate.

<!-- TODO screenshot: crafting/recipes panel open, Iron Sword recipe highlighted with materials -->
