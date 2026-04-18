---
name: Prefer generic layers over one-off plumbing
description: When a new piece of per-entity or per-player data shows up, reach for the existing generic layer (entity meta, command registry) instead of threading a bespoke field through the whole stack.
type: feedback
---

When a feature needs to attach a new observer-visible string to an entity,
or a new `/command` to the chat input — **use the existing generic layer,
don't thread a bespoke field through every file.**

**Why:** On the /nick task the first design threaded a dedicated `name`
field through `PlayerSlot`, a new `onEntityName` callback, a new
`encodeEntityName` opcode, a scene `entityNames` map, etc. The user
pushed back: "I'm not keen on making just 'name' as special wired
through all over. What if we make this an entity-meta…?" Folding it into
a generic `MetaKey` + `EntityMeta` opcode + registry-based command
dispatcher halved the surface area and unlocked `title`, `sign_text`,
`owner`, `pet_nickname`, etc. for a one-line enum addition each.

**How to apply:**
- New per-entity rarely-changing string → a new `MetaKey` enum entry in
  `shared/src/entity-meta.ts` + `world.setEntityMeta(...)` in a handler.
  No new opcode, no new connection method, no new scene field.
- New `/command` → `registerServerCommand([aliases], handler)` in
  `server/src/server-commands.ts`. No new `ClientAction`, no new MCP
  tool.
- When considering a bespoke field, first ask: is this variable-length
  string data? sparse? rarely changes? observer-visible? If yes,
  it's entity meta — not an ECS component, not its own message type.
