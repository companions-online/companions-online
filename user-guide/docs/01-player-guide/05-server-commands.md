---
title: Server commands
sidebar_position: 5
---

# Server commands

Server commands are typed in chat. Press **Enter** to open the chat
input, type a message starting with `/`, and press Enter again to
send. Anything that doesn't begin with `/` is a normal chat
message visible to other players.

If you type a command that doesn't exist (or get the arguments
wrong) the server replies in your chat with an `[system]` line —
no harm done.

## Available commands

### `/nick <name>` — set your display name

Aliases: `/nick`, `/name`.

Sets the name that appears above your character to other players.
Names are limited in length and can't be empty. Setting a name
doesn't interrupt whatever you're doing — you can `/nick` mid-fight
without dropping your attack.

```
/nick Elsy
```

### `/avatar <variant>` — change appearance

Picks an appearance variant for your character sprite. The
argument is an integer index (`0` and up); the available range
depends on what the build ships with. If you ask for a variant
that doesn't exist, the server says so.

```
/avatar 0
```

### `/spawn <name>` — drop a creature or item near you

Spawns a single creature or ground item on a free tile within 6
tiles of your position. Useful for testing builds, demos, or
seeing how the AI reacts to specific creatures.

A few categories are blocked: you can't `/spawn` another player,
an NPC, a tree, or a placeable (those have to be crafted and
placed normally).

```
/spawn wolf
/spawn iron
/spawn raw meat
```

Names are matched against the blueprint's display name,
case-insensitive.

### `/time <preset|HH|HH:MM>` — set the world clock

Jumps the in-world time to whatever you ask for. Affects every
player on the server.

Presets:

| Preset | Time |
| --- | --- |
| `day`, `noon` | 12:00 |
| `night`, `midnight` | 0:00 |
| `dawn`, `sunrise` | 5:00 |
| `twilight`, `dusk`, `sunset` | 19:00 |

You can also pass an hour (`/time 14`) or `HH:MM` (`/time 18:30`).

```
/time night
/time 6:00
```

<!-- TODO screenshot: chat input mid-typing /nick -->
