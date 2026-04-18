---
name: Event Emission at Source
description: Emit game events at the authoritative source (handlers/systems), not by reconstructing from deltas
type: feedback
---

Emit events directly where things happen (GameWorld handlers, system function returns), not by reverse-engineering from `PlayerConnection` callback deltas.

**Why:** Delta reconstruction is lossy, ambiguous (can't distinguish craft from pickup from an inventory change), and complex. The authoritative source has full context (recipe ID, trade details, attacker identity).

**How to apply:** New events go in the handler/system that causes them. For system functions (combat, harvest, consumable, critter-ai), enrich return types to carry event data — `GameWorld` translates to `GameEvent` and dispatches via `onGameEvent`. For `GameWorld` handlers, emit directly via `slot.connection.onGameEvent`.
