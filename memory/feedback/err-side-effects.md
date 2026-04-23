---
name: Err-side-effects
description: State-changing helpers must leave world state untouched when they return Err — validate first, mutate after every can-fail branch is cleared
type: feedback
---

State-changing helpers (`setMoveTarget`, `startAttack`, `startHarvest`,
`startConsume`, `inventoryMgr.{equip,unequip,drop,craft,transferToContainer,
transferFromContainer}`, and anything you add that follows this shape)
**must leave world state untouched when they return `Err`**. Callers
should be able to treat them as predicates with free rollback: `if (r.ok)
commit-was-already-done else no-footprints`.

**Why:** This is the property that makes `startAttack` usable as a
reachability probe from `runCritterAI`'s wander→aggro transition. If the
probe had side effects on `Err`, every wandering critter near a
walled-in player would get its state silently corrupted once per tick.
The original `startAttack` violated this: it did `clearMoveTarget`
*before* the reachability check, so a failed probe wiped the old wander
move without replacing it — leaving the critter frozen in Walking state
with no `moveState`. Root cause of the "wolf walking in place for 2-3
seconds" bug captured in a world dump on 2026-04-22.

**How to apply:** Do all validations (bounds, walkable, target-exists,
distance, weight, material, no-path) + all pathfinding + all can-fail
lookups **first**. Only mutate after every can-fail branch has been
cleared. If a helper has to provisionally mutate to test something,
either snapshot-and-restore (ugly) or refactor the check into a pure
predicate that doesn't mutate.

Notable exception: setMoveTarget itself — it atomically overwrites the
previous moveState on success, and does nothing on failure. That's the
contract `startAttack`'s non-adjacent branch relies on, and why its
`clearMoveTarget` was removed from the prologue.
