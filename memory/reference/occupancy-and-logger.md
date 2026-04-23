# OccupancyGrid + WorldLogger

## OccupancyGrid — semantics

**`OccupancyGrid` = the single blocker entity on each tile.** Tracked:
players, critters, NPCs, placed interactive entities (doors, chests,
campfires), trees. **Not tracked**: ground items, corpses, and
building-layer walls (walls live in `WorldMap.building`; ground items +
corpses are walk-through, not grid-indexed).

### Ownership-enforced API

- `set(x, y, eid)` — asserts the tile is empty or already self-owned.
- `clear(x, y, eid)` — asserts `eid` currently owns the tile; no-op if empty.
- `move(fromX, fromY, toX, toY, eid)` — clears `from` only if self-owned;
  sets `to` only if empty or self-owned.

Violations are reported via the `onViolation` callback (wired to
`world.log.error` in `GameWorld`'s ctor). No throws — violations surface as
structured log entries that tests / dashboards can inspect.

### Why the invariant matters

The "door phasing" bug (closed door becomes walk-through after 2-3 cycles)
came from `toggleDoor` blindly `occupancy.set`-ing on close, overwriting a
walker's slot; the walker's next `occupancy.move` then zeroed the tile,
leaving `statusEffects=closed + occupancy=0`. Pathfinder then routed
through. Fix: close-branch refuses when another entity owns the tile
(`tile_blocked/entity` rejection), and `move` no longer blindly clears.

### No occupancy on ground-item pickup

Prior code called `occupancy.clear` on pickup — a no-op at best (ground
items are never registered), a latent footgun at worst. Now deleted in
both the instant-pickup (`world-actions.ts::handlePickup`) and arrival-
triggered (`game-world.ts` pickup resolver) paths.

## WorldLogger

Per-world structured logger. `GameWorld` holds one via `world.log`.
Three levels: `info`, `warn`, `error`, plus `assert(cond, msg, data)`
that logs an error on failure and returns the cond.

- **File mode** (`createFileLogger(path)`): appends JSONL to
  `data/worlds/<worldId>/server.log`. Used by `createNewWorld`/`loadWorld`.
- **Memory mode** (`createMemoryLogger()`): retains all entries in
  `log.entries`. Used by tests — `expectCleanLog(world)` in
  `test/e2e/helpers.ts` asserts `warnCount + errorCount === 0`.
- Default when no logger passed: memory (safe for ad-hoc tests).

### What gets logged

Sparse. Info: world create, world loaded, world saved, player joined,
player disconnected. Warn/error: invariant violations (e.g. occupancy
ownership) — only when something is provably wrong.

### Shutdown

`main.ts` awaits `world.log.close()` before `process.exit` on both TTY
(`q`/Ctrl-C) and signal (SIGINT/SIGTERM) paths, so the file stream flushes.

## Companion debug tool: `d` key → world dump

Pressing `d` in the server dashboard invokes `dumpWorld(world, worldDir)`
from `server/src/world-dump.ts`, which writes a pretty-printed JSON of
the entire server-side state tree to
`data/worlds/<id>/<ISO-timestamp>-dump.json`. Use alongside `server.log`
for debugging — logs show *when*, dumps show *what state existed at that
moment*. See `file-map.md` for the dumper's coverage and skiplist.
