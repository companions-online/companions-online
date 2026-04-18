---
name: LLM Teleportation Insight
description: LLM players experience constant teleportation — only emit events not inferrable from state snapshots
type: feedback
---

LLM players experience the game as "constant teleportation." Every MCP tool response is a full state snapshot (`<map>`, `<entities>`, `<self>`). Between tool calls, they see nothing.

Events should only cover things NOT inferrable from the snapshot: damage causality, ephemeral chat, action interruption reasons, per-hit combat detail, per-yield harvest progression. Entity enter/leave, creature flee, entity spawn/despawn are all visible in the snapshot diff — no events needed for those.

**Why:** Medium/low priority events (`player_entered`, `entity_spawned`, etc.) are redundant because every response includes a full entity list. The LLM never "watches" entities move in real-time.

**How to apply:** When adding new event types, ask "can the LLM figure this out from the state snapshot alone?" If yes, don't add the event.

**Exception:** Two medium events kept for continuity preservation — `creature_fleeing` and `creature_died` — because they bridge behavioral cause-and-effect chains (I attacked → it fled; wolf fought deer → deer dead).
