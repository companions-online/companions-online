---
name: Test setup helpers can hide bugs in the flow they bypass
description: When a test helper direct-mutates state to set up a scenario, it skips the production flow — and any bug in that flow becomes invisible to every test that uses the helper
type: feedback
---

When a test helper direct-mutates entity stores / world state to set up a scenario, the production flow that *normally* produces that state is no longer covered. If the helper is the only path used to reach a given starting state, the production flow is **uncovered by every downstream test that uses it**.

**Why:** `test/e2e/building.test.ts` had `placeChest(world, x, y)` and `placeDoor(world, x, y)` helpers that built the entity directly via `entities.create()` + component sets + `occupancy.set()`. Every chest/door downstream test (interact, transfer, toggle, pathfinding) used these helpers. Result: a real bug in `doPlace` (`isPlaceable` rejected entity placement on a floor → chests + doors couldn't be placed inside a house) shipped without a single failing test, because no test ever sent `UseItemAt(StorageChest, …)` through the dispatcher. The bug was reported by hand-testing through the WebGL client.

**How to apply:**
- When you write a setup helper that direct-mutates, treat it as a deliberate *bypass* of the production path. Add a comment in the helper saying so (`// Bypasses doPlace — direct-creates the entity for downstream tests.`).
- For every flow you bypass, make sure at least **one** test exercises the production path end-to-end with the same mechanism downstream tests use. E.g. one test that calls `setAction(UseItemAt, ...)` and asserts the resulting entity exists; downstream tests can then use the cheap direct-create helper.
- Bias toward the production flow when the cost is low: a 3-line `setAction + runTicks` block isn't much heavier than a 6-line direct-create helper, and it covers the dispatcher / pending-actions / ActionResult pipeline for free.
- When reviewing code, treat "this test sets up state via direct store writes" as a yellow flag — it's fine, but ask "is anything covering the path that would normally produce this state?"

The pattern of setup-by-mutation is itself fine; the failure mode is *exclusive* setup-by-mutation with no production-flow coverage anywhere.
