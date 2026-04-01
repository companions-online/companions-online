# Docs vs Implementation Status

`docs/` contains the original design seed documents. Implementation has evolved significantly. **Always trust the code over docs.**

## Divergences

| Doc | Area | What changed |
|-----|------|-------------|
| `entity-blueprints-draft.md` | Blueprint IDs | Renumbered into ranges: creatures 0-19, resources 20-29, tools 30-39, weapons 40-49, armor 50-59, consumables 60-69, placeables 70-79, world 80-89, NPCs 90-99, special 100+ |
| `entity-blueprints-draft.md` | HillRock | Removed entirely. Terrain.Rock is mineable directly — no entity needed |
| `entity-blueprints-draft.md` | Stats | Rebalanced from docs. Player HP=100 (not in docs), creature stats adjusted. Check blueprints.ts for current values |
| `entity-blueprints-draft.md` | Placeables | Added equipSlot:'hand' + stackable:true (not in original spec) |
| `network-protocol-draft.md` | Opcodes | Added: Welcome (0x30), InventorySync (0x31). Client-side prediction removed (server-authoritative, no reconciliation) |
| `network-protocol-draft.md` | Components | Removed Ownership (bit 7) and Appearance (bit 5). Added BlueprintId (bit 5). Client derives appearance from BlueprintId |
| `action-taxonomy.md` | Actions | Implemented subset: MoveTo, Cancel, Pickup, Equip, Unequip, Drop, Craft, Harvest, UseItemAt, Attack. NOT yet: Interact, DialogueSelect, Trade, Say, UseConsumable, Transfer |
| `client-auto-action.md` | Auto-action | Implemented for: empty→MoveTo, item→Pickup, tree→Harvest, rock terrain→Harvest, water+rod→Harvest, creature→Attack. NOT yet: NPC→Interact, chest→Interact, door→Interact |
| `action-taxonomy.md` | Queries | GET_INVENTORY etc are spec'd but not implemented as protocol queries — client reads from synced state |

## Docs not yet referenced in implementation
- `2d-asset-generation.md` — asset pipeline (not started)
- `human-only-todo.md` — human tasks
- `client-auto-action.md` — partially implemented via action-resolver.ts

## What to trust
1. **Code** — always authoritative
2. **memory/** — orientation docs (this directory), updated per conversation
3. **docs/** — design seeds only, may be outdated
