---
title: Controls
sidebar_position: 1
---

# Controls

Companions Online plays click-to-move on desktop, tap-to-move on
mobile. One gesture drives almost everything: click or tap the
tile you want to walk to, the thing you want to attack, the chest
you want to open, or the empty grass you want to drop a wall on.

## Mouse and touch

A left-click on desktop or a tap on mobile resolves by what's on
the target:

| Target | What happens |
| --- | --- |
| Bare tile | Walks there. |
| Enemy | Attacks. (Auto-equips the best weapon you're carrying.) |
| Tree, rock, plant | Harvests. (Auto-equips the right tool.) |
| Chest, door | Interacts. |
| Item on the ground | Picks up. (Pathfinds to it if it's not adjacent.) |
| HUD quickslot | Selects that slot and equips its item to your hand. |

## Using what's in your hand

Selecting a quickslot changes what the next click / tap does:

| Held item | Click / tap on… | Result |
| --- | --- | --- |
| Placeable (wall, floor, campfire, door, chest…) | Any tile | Drops it there. A translucent ghost follows your cursor so you can see exactly where it'll land. |
| Raw food | Adjacent campfire | Cooks it. |
| Bandage / cooked food / other consumable | Anywhere — or re-press the quickslot | Uses it on yourself. |
| Tool or weapon | — | No special use; the tool is auto-picked when you click a matching target. |

If a placement or cook click misses (off the map, blocked tile, no
adjacent campfire), it bounces back without harm. Press **Esc** or
re-press the same quickslot number to cancel and put your hand
back to empty.

<!-- TODO screenshot: hover-preview placement ghost on a grass tile -->

## HUD

The bottom of the screen has the always-visible quickbar (slots
1–9) and two buttons in the bottom-right:

- **Inventory** — opens your bag. Same as pressing **I**.
- **Settings** — opens the in-game menu. Same as pressing **Esc**
  with nothing else open.

<!-- TODO screenshot: inventory panel open with quickbar visible -->

## Keyboard (desktop)

| Key | What it does |
| --- | --- |
| **I** | Toggle inventory. |
| **Enter** | Open chat. Press Enter again to send; messages starting with `/` are server commands (see [Server commands](./server-commands)). |
| **1**–**9** | Select a quickslot and equip its item to your hand. Re-pressing a consumable slot uses it again. |
| **Esc** | Backs out of the current thing: closes the inventory, cancels a placement preview, deselects the quickslot, or — if nothing's open — opens the in-game settings menu. |

### Right-click

Right-click is kept as a power-user shorthand for desktop muscle
memory: with a placeable selected it places at the cursor; with a
consumable selected it eats; with raw food selected it cooks at an
adjacent campfire.

### Chat input

When chat is open, the usual editing keys work — printable
characters type, **Backspace** deletes, **Enter** sends, **Esc**
cancels without sending. Messages are capped at 200 characters.

## Touch / mobile

Every gesture above works as a tap. The HUD's Inventory and
Settings buttons cover the keyboard shortcuts you can't press on
a phone, and re-tapping a quickslot uses or cancels it the same
way **1**–**9** do on desktop.

Pinch-to-zoom and long-press gestures are not wired up yet; if you
need those, play on a laptop for now.
