# Docs vs Implementation Status

`plans/` contains working docs + the original design seed documents. Implementation has evolved significantly. **Always trust the code over docs.**

## Divergences

| Doc | Area | What changed |
|-----|------|-------------|
| `entity-blueprints-draft.md` | Blueprint IDs | Renumbered into ranges: creatures 0-19, resources 20-29, tools 30-39, weapons 40-49, armor 50-59, consumables 60-69, placeables 70-79, world 80-89, NPCs 90-99, special 100+ |
| `entity-blueprints-draft.md` | HillRock | Removed entirely. Terrain.Rock is mineable directly |
| `entity-blueprints-draft.md` | Stats | Rebalanced. Check blueprints.ts for current values |
| `entity-blueprints-draft.md` | Placeables | Added equipSlot:'hand' + stackable:true. WoodenWall, WoodenFloor, StoneFloor all go to building tile layer (via `blueprintToBuilding()`). WoodenFloor / StoneFloor are walkable — first non-blocking building tiles — and bridge river terrain. |
| `network-protocol-draft.md` | Opcodes | Added: Welcome, InventorySync, ContainerOpen, DialogueOpen. Client-side prediction removed |
| `network-protocol-draft.md` | Components | Removed Ownership/Appearance. Added BlueprintId |
| `action-taxonomy.md` | Actions | All 17 implemented: MoveTo, Cancel, Pickup, Equip, Unequip, Drop, Craft, Harvest, UseItemAt, Attack, Interact, Transfer, DialogueSelect, Trade, UseConsumable, Say |
| `action-taxonomy.md` | Queries | Not protocol queries — client reads from synced state |
| `mcp-spec-draft.md` | Events | Evolved to 18 types (3 priority tiers), "teleportation model" cuts snapshot-inferrable events |
| `mcp-spec-draft.md` | Medium/Low events | player_entered/left, entity_spawned/despawned removed. creature_fleeing + creature_died kept for continuity |
| `mcp-spec-draft.md` | Event generation | Emitted at authoritative source (handlers/systems), not from delta reconstruction |
| `mcp-spec-draft.md` | Inactivity timeout | Removed — MCP clients stay connected indefinitely. Long-session survival: Node HTTP `requestTimeout`/`headersTimeout` disabled + per-session 15s `McpServer.server.ping()` keepalive |
| `mcp-spec-draft.md` | Action blocking | 30s (600 tick) safety valve timeout. Instant actions resolve in 1 tick |
| `mcp-spec-draft.md` | Transport | Hono + @modelcontextprotocol/sdk WebStandardStreamableHTTPServerTransport, one McpServer per session |
| `mcp-spec-draft.md` | Player identity | MCP sessions don't auto-spawn — client must call `identify(name)` first. All other tools reject pre-identify with `isError: true`. 21 tools total (17 action + 4 query). Name validation shares `validateName` with `/nick` |

## What to trust
1. **Code** — always authoritative
2. **memory/** — orientation docs (this directory), updated per conversation
3. **plans/** — working docs + design seeds, may be outdated
