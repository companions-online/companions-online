# Bend-Only Waypoint Sync (deferred)

## Status

Deferred. During client-webgl network integration we keep the current per-tile
position sync so the client migration doesn't depend on a server-side
refactor. Revisit after the client is stably receiving + interpolating
per-tile updates.

## Motivation

Today `server/src/systems/movement.ts` writes `position` to the component
store **every tile** an entity steps (movement.ts:116). The delta system
marks it dirty each time, so a 10-tile straight run produces 10 entity
updates on the wire. At 20Hz with many entities this is the dominant cost
in the per-player diff.

`nextWaypoint` today is set to the **final move target** (movement.ts:35,
movement.ts:133), which makes it useless as a client interpolation hint —
you can't interp from current tile toward a tile 20 squares away when the
path bends through walls.

## Target behavior

- Server internal pathing state is unchanged: `MovementState.path[]` +
  `pathIndex` still advance one tile per step so occupancy, wait-and-repath,
  and collision stay correct.
- The **synced** `position` component only marks dirty at:
  - path start (first tile of a leg)
  - direction changes along the path (a "bend")
  - path end (arrival / cancel)
- `nextWaypoint` is redefined as **the next bend tile** (or the final tile
  if the remainder of the path is collinear), not the final target.
- Along a 10-tile straight run the client gets exactly one component
  update: `position = start`, `nextWaypoint = end-of-leg`. It lerps
  `visualX/Y` from `position` toward `nextWaypoint` at `blueprint.speed`
  tiles/sec. When it arrives, the next server update kicks off the next
  leg.

## Implementation sketch

### 1. `ComponentStore.setQuiet(eid, data)`

Adds a sibling to `set()` that writes the value without touching the shared
dirty bitmask. `movement.ts` uses `setQuiet` for collinear per-tile steps
and `set` at leg boundaries.

Audit required: confirm no current consumer reads `position` via a route
that expects per-tile dirty ticks. The delta-build path in GameWorld is
the only reader we expect.

### 2. `findNextBend(path, fromIndex): {x, y}`

Walks `path` from `fromIndex` forward until the `(dx, dy)` between
consecutive tiles changes, returns the last collinear tile. Used to set
`nextWaypoint` at each leg start.

### 3. Movement tick rewrite

```
if this tile is collinear with previous step:
  world.entities.position.setQuiet(eid, next)
  // direction is unchanged — do nothing, or setQuiet
else:  // bend or first step or last step
  world.entities.position.set(eid, next)
  world.entities.direction.set(eid, newDir)
  world.entities.nextWaypoint.set(eid, findNextBend(path, pathIndex))
```

Arrival still writes `currentAction=Idle` and
`nextWaypoint={WAYPOINT_NONE, WAYPOINT_NONE}` via regular `set`.

### 4. Diagonal cooldown

Unchanged. Internal `cooldownRemaining` still gates per-tile advancement;
it's orthogonal to the sync coalescing.

### 5. Client adjustment

The client's interpolation is already designed around
`position → nextWaypoint` lerp (see the main integration plan). In the
per-tile-sync phase it will just re-checkpoint every tile, which is
correct but wasteful. After this change it re-checkpoints only at bends,
and the lerp naturally covers the straight run.

No further client changes required beyond what ships in the integration
plan.

## Risks / open questions

- `setQuiet` must not leak into logic that depends on dirty (currently
  none, but worth a grep before landing).
- Interest-range entry: when a distant entity enters a client's interest
  range mid-leg, the client needs a **full** state push (not a delta).
  That path already exists (`EntityFullState` in the delta-build). Verify
  `nextWaypoint` carries the current leg's bend, not stale state, in the
  full-state push.
- Replay / test fixtures that assert per-tile position dirties may need
  updating.
