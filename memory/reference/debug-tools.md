# Debug tools

Forensics tooling for "the server is doing something weird" moments. All of
these pair: server writes structured output via `d` key / `world.log`, then
you query offline.

## `d` key → world dump

Dashboard keybind. Writes
`data/worlds/<id>/<ISO-timestamp>-dump.json` — full reflective JSON of
`GameWorld` state (entities, components, all system-state Maps, players,
pending-pickups, pending-interacts, etc.). See
`server/src/world-dump.ts` for what's covered and what's skipped.

New fields on `GameWorld` / `PlayerSlot` / system-state Maps appear in
dumps automatically — no registration needed.

## `scripts/world-dump-view.ts`

CLI viewer for the dumps. Designed for fast "what the hell is that entity
doing?" investigation without rewriting `JSON.parse` + Map-unwrap
boilerplate every time.

```
npx tsx scripts/world-dump-view.ts <path> [command] [args]
```

`<path>` accepts either a `*-dump.json` file or a world directory (picks
the most recent dump automatically).

### Commands

| Command | Example | What it shows |
|---|---|---|
| `overview` (default) | `world-dump-view.ts <dir>` | Seed, tick, players, entity counts by blueprint, critter behavior tally, stuck-state scan |
| `stuck` | `world-dump-view.ts <dir> stuck` | Scan for currentAction-vs-ownership violations (Walking without moveState, Harvesting without harvestState, Attacking without combatState, Consuming without consumableState). First-line diagnostic for "stuck animation" bugs |
| `near <x> <y> [r=6]` | `near 72 71 8` | All entities within Chebyshev r of a tile, sorted by distance. Includes blueprint name + current action |
| `entity <eid>` | `entity 206` | Full component snapshot + all state-map rows that reference the eid + inventory (if any). Augments numeric enums with names (actionType → "Walking") |
| `find <bp>` | `find Wolf` or `find 4` | All positions + actions for a blueprint (by enum name, case-insensitive, or numeric id) |
| `state <mapName> [eid]` | `state moveStates 206` | Raw row from a top-level state Map. Without `eid`, lists all rows |
| `keys` | `keys` | Top-level dump keys with size tags (`__map(N)`, `__componentStore(N)`, etc.). Use to explore the dump shape |

### Writing new commands

If you find yourself writing the same ad-hoc query more than once, add
it as a command. The script is self-contained — the `DumpView` class and
`unwrap()` helper absorb the `__map` / `__componentStore` / `__set`
marker format, and `bpName()` / `actionName()` give you human-readable
enum lookups. Each command is 5-20 lines.

### Worked example: the walking-in-place wolf (2026-04-22)

1. `overview <worldDir>` immediately flagged 3 stuck critters:
   ```
   stuck-state invariant scan (3 violations):
     206 Wolf @77,76: Walking but no moveState
     264 Skeleton @79,62: Walking but no moveState
     265 Skeleton @79,63: Walking but no moveState
   ```
2. `entity 206` showed the wolf in `behavior: 'aggro'` but with no
   `moveStates` or `combatStates` row — `currentAction=Walking` and
   `nextWaypoint={77,74}` were stale.
3. `near 72 71 8` confirmed the player was walled in (campfires + doors
   clustered around spawn).
4. Root-caused to `startAttack` doing destroy-before-construct
   `clearMoveTarget` before its reachability probe.

The whole investigation took maybe 5 minutes with the tool, versus
writing a one-off `tsx -e 'fs.readFileSync(...)'` each step.

## `world.log` → `data/worlds/<id>/server.log`

JSONL, one entry per line:
`{"level":"info","msg":"player joined","ts":...,"data":{...}}`. Emitted
sparingly (world create/load/save, player join/disconnect, occupancy
invariant violations). See `memory/reference/occupancy-and-logger.md`.

`grep '"level":"error"' data/worlds/<id>/server.log` surfaces any
structured assertion failure since the world started.

## Test-mode counterpart

In-memory logger (`createMemoryLogger()`) retains entries in
`world.log.entries`. `expectCleanLog(world)` helper in
`test/e2e/helpers.ts` fails the test with a formatted dump if any warn
or error landed during the test's runTicks. Use when writing scenarios
that should not provoke any invariant violations.
