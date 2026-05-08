---
title: Desktop
sidebar_position: 1
---

# Desktop controls

Companions Online plays click-to-move, like an old isometric RPG —
your mouse drives almost everything, and the keyboard handles
inventory, chat and quickslots. There is no WASD movement; click
the tile you want to walk to.

## Mouse

| Action | What it does |
| --- | --- |
| Left-click a tile or entity | Walks there. If the target is an enemy, attacks; a tree or rock, harvests; a chest or door, interacts; a ground item, picks up. The click resolves by what's actually on the tile. |
| Right-click | Uses whatever is in your hand: a consumable on yourself, a placeable as a build preview at the cursor, raw food at an adjacent campfire to cook. |
| Hover (placement mode) | Shows a translucent ghost of the building or entity you're about to place. Right-click confirms. |
| Left-click the quickbar | Selects that quickslot directly. |

The hit test is sprite-first — if a creature, NPC or item is drawn
on a tile, clicking the tile clicks the thing on it, not the
ground underneath.

## Keyboard

| Key | What it does |
| --- | --- |
| **I** | Toggle inventory. |
| **Enter** | Open chat. Press Enter again to send; messages starting with `/` are server commands (see [Server commands](../server-commands)). |
| **1**–**9** | Select a quickslot and equip its item to your hand. |
| **Esc** | Backs out of the current thing: closes the inventory, cancels placement mode, deselects the quickslot, or — if nothing's open — opens the in-game settings menu. |

## Chat input

When chat is open, the usual editing keys work — printable
characters type, **Backspace** deletes, **Enter** sends, **Esc**
cancels without sending. Messages are capped at 200 characters.

<!-- TODO screenshot: inventory panel open with quickbar visible -->

<!-- TODO screenshot: hover-preview placement ghost on a grass tile -->
