# Docs vs Implementation Status

`docs/` contains the original design seed documents. Implementation has evolved significantly. **Always trust the code over docs.**

## Divergences

| Doc | Area | What changed |
|-----|------|-------------|
| `entity-blueprints-draft.md` | Blueprint IDs | Renumbered into ranges: creatures 0-19, resources 20-29, tools 30-39, weapons 40-49, armor 50-59, consumables 60-69, placeables 70-79, world 80-89, NPCs 90-99, special 100+ |
| `entity-blueprints-draft.md` | HillRock | Removed entirely. Terrain.Rock is mineable directly — no entity needed |
| `entity-blueprints-draft.md` | Stats | Rebalanced from docs. Player HP=100, creature stats adjusted. Check blueprints.ts for current values |
| `entity-blueprints-draft.md` | Placeables | Added equipSlot:'hand' + stackable:true. WoodenWall goes to building tile layer, door/campfire/chest stay as entities |
| `network-protocol-draft.md` | Opcodes | Added: Welcome, InventorySync, ContainerOpen, DialogueOpen. Client-side prediction removed (server-authoritative) |
| `network-protocol-draft.md` | Components | Removed Ownership/Appearance. Added BlueprintId. Client derives appearance from BlueprintId |
| `action-taxonomy.md` | Actions | Implemented: MoveTo, Cancel, Pickup, Equip, Unequip, Drop, Craft, Harvest, UseItemAt, Attack, Interact, Transfer, DialogueSelect, Trade. NOT yet: UseConsumable, Say |
| `action-taxonomy.md` | Queries | GET_INVENTORY etc not implemented as protocol queries — client reads from synced state |
| `action-taxonomy.md` | NPCs | Hermit/Trader/Wanderer implemented with dialogue trees and barter trades |

## What to trust
1. **Code** — always authoritative
2. **memory/** — orientation docs (this directory), updated per conversation
3. **docs/** — design seeds only, may be outdated
