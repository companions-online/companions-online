---
name: Collaboration
description: How the user works — steered build, plan→approve→implement, code preferences, corrections
type: user
---

# Collaboration

## Style
- **Steered build**: user drives direction, Claude implements. "You drive, I review."
- **Plan → approve → implement**: always enter planning mode for non-trivial work. User reviews plans and frequently modifies them before approving — skipping planning leads to wasted work.
- **Discussion mode**: user sometimes wants to discuss design tradeoffs before planning. Respect "enter discussion mode" — don't jump to code.
- **Chunk breakdown**: for large features, break into independently verifiable phases (A → B → C → D). User wants to see the breakdown before starting.
- **Layer-by-layer implementation**: within a phase, build bottom-up. Each layer typechecks independently before moving to the next.

## Code preferences
- **Auto-scaling over hardcoded** — prefer parameters that derive from a base (e.g., `MAP_SIZE/128` ratio) over per-size constants.
- **Keep it simple** — user corrects overengineering. Don't add abstractions unless needed.
- **CLI-first (historically)** — terminal CLI was primary; WebGL client is now active, web client placeholder retired.
- **E2E tests for behavioral flows** — values tests that exercise the real game loop (`GameWorld.runTicks`) over isolated unit tests.
- **Don't maintain test counts in docs** — they go stale; keep only what actually steers behavior.

## Naming
- **"PlayerConnection"** (not "PlayerSink", "PlayerAdapter", "PlayerPort", or "PlayerBridge"). User chose "Connection" as most intuitive.

## Design decisions captured
- **Pathfinding search limit stays at 1000** regardless of map size — reject rather than search longer.
- **Door, Campfire, StorageChest remain entities** (not building tiles) because they have interactive behavior. Only static structures (walls) go to the building tile layer.

## Past corrections
- Don't always approach harvest targets from the north — sort adjacent tiles by distance to player.
- Esc should navigate up in CLI panels (crafting → inventory → map).
- Status bar should show the resolved action name, not generic "act".
- When fleeing, critters need a cooldown between flee segments (10 ticks).
- Pickup should auto-pathfind if target is >1 tile away.
- Placeables need `equipSlot:'hand'` to be usable with UseItemAt.
- All items should be stackable (tools, weapons, armor, placeables — `maxStack:10`).
