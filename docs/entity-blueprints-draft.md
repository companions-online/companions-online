Here's the MVP entity palette, designed to be tight but give players meaningful choices and a crafting progression that feels good.

---

## BASE RESOURCES (4 — already in your spec)

- **Wood** — chop trees
- **Rock** — mine hills (slow by hand, fast with pickaxe)
- **Iron** — mine hills (rarer drop alongside rock)
- **Hide** — skin dead critters (deer, wolf)

Water exists as a world element but isn't a gatherable inventory item for MVP. Four resources is plenty — every recipe below uses only these.

---

## TOOLS (4)

These gate the progression. A player spawns with nothing and works upward.

| Tool | Recipe | Purpose |
|---|---|---|
| **Axe** | 2 Wood + 1 Rock | Chops trees fast, mines hills fast, weak weapon |
| **Pickaxe** | 2 Wood + 2 Rock | Mines hills fastest, better iron yield |
| **Hammer** | 1 Wood + 2 Iron | Required to craft iron-tier gear (acts as the "crafting table" — you just need it in inventory) |
| **Fishing Rod** | 2 Wood + 1 Hide | Fish from water tiles → yields Raw Fish (food source) |

The core loop: punch a tree → get wood → make axe → chop trees & mine hills → get rock & iron → make pickaxe & hammer → craft everything else.

---

## WEAPONS (5)

| Weapon | Recipe | Damage | Speed | Notes |
|---|---|---|---|---|
| **Fist** | — | 1 | Fast (2 ticks) | Default, always available |
| **Wooden Club** | 3 Wood | 3 | Slow (5 ticks) | First craft, immediately useful |
| **Stone Knife** | 1 Wood + 2 Rock | 4 | Fast (3 ticks) | Quick attacks, also skins critters for hide |
| **Iron Sword** | 1 Wood + 3 Iron | 7 | Medium (4 ticks) | The standard weapon; requires Hammer |
| **Iron Spear** | 2 Wood + 2 Iron | 6 | Medium (4 ticks) | Attacks from 2 tiles away (ranged melee); requires Hammer |

Design logic: Club is the "I just spawned" weapon. Knife is the utility pick (fast + skinning). Sword vs Spear is a real choice — more damage up close, or safety at range.

---

## ARMOR (4)

| Armor | Recipe | HP Bonus | Notes |
|---|---|---|---|
| **Hide Vest** | 4 Hide | +10 max HP | First armor; incentivizes hunting deer |
| **Hide Cap** | 2 Hide | +5 max HP | Small boost, easy to make |
| **Iron Chestplate** | 5 Iron | +25 max HP | Significant; requires Hammer |
| **Iron Helm** | 3 Iron | +10 max HP | Requires Hammer |

Two slots: head and body. That's it. Hide tier → Iron tier. Simple to implement, still gives that satisfying gear-up feeling. Armor just adds to max HP (and current HP when equipped) rather than damage reduction — much simpler math for MVP.

---

## POTIONS / CONSUMABLES (4)

| Item | Recipe / Source | Effect |
|---|---|---|
| **Raw Fish** | Fishing Rod + water tile | Heals 5 HP, slow eat (3 ticks) |
| **Cooked Fish** | Raw Fish + stand near campfire | Heals 15 HP, slow eat (3 ticks) |
| **Cooked Meat** | Raw Meat + stand near campfire | Heals 20 HP, slow eat (3 ticks) |
| **Bandage** | 2 Hide | Heals 30 HP over 10 ticks (channeled, interrupted by damage) |

**Raw Meat** drops from deer and wolves alongside Hide. **Campfire** is a placeable:

---

## PLACEABLES / BUILDING (4)

| Placeable | Recipe | Function |
|---|---|---|
| **Campfire** | 3 Wood + 1 Rock | Place on ground; stand adjacent to cook food; lasts 5 minutes then burns out; also provides light |
| **Wooden Wall** | 4 Wood | 1-tile solid block; collides; can be destroyed (has 30 HP) |
| **Wooden Door** | 5 Wood + 1 Iron | 1-tile block; owner can toggle open/closed; others collide with it closed |
| **Storage Chest** | 6 Wood + 2 Iron | Place on ground; persistent storage; owner-locked |

This is the Minecraft DNA — players can wall off areas, build crude shelters, store loot. Four pieces is enough to enable emergent base-building without a full housing system.

---

## CRITTERS / ENEMIES (6)

| Entity | HP | Damage | Speed | Behavior | Drops |
|---|---|---|---|---|---|
| **Rabbit** | 3 | 0 | Fast | Flees when player approaches within 3 tiles | — |
| **Deer** | 12 | 0 | Medium | Stands still when attacked (UO-style passive) | 2 Hide, 1 Raw Meat |
| **Fox** | 10 | 2 | Fast | Attacks rabbits; flees from players | 1 Hide |
| **Wolf** | 20 | 4 | Medium | Aggressive within 5 tiles; attacks back; hunts deer | 2 Hide, 1 Raw Meat |
| **Bear** | 40 | 7 | Slow | Aggressive within 4 tiles; tough; guards forest areas | 3 Hide, 2 Raw Meat |
| **Skeleton** | 25 | 5 | Medium | Spawns at night or in caves/mountain areas; hostile on sight; drops iron/rock | 1-2 Iron, 1 Rock |

Design logic: Rabbit and Fox are atmosphere — they make the world feel alive without being gameplay-critical. Deer is the first thing you hunt (passive = safe to learn combat). Wolf is the first real threat. Bear is the "oh no" moment. Skeleton is the one supernatural enemy — it gates iron drops behind combat risk and gives the world a reason to be dangerous at night or in mountains.

---

## NPCs (3)

Keep this very tight for MVP. These are stationary, at or near spawn.

| NPC | Location | Function |
|---|---|---|
| **The Hermit** | Near spawn | Dialogue tutorial; explains crafting, gives first-time players 2 Wood and 1 Rock (once per player); flavor/lore anchor |
| **The Trader** | Near spawn | Barters: buy Bandages for 3 Hide, buy Iron for 5 Rock, buy Hide for 3 Wood. Simple fixed-rate economy so players always have a fallback |
| **The Wanderer** | Roams the island | Rare-spawn NPC; appears at random locations; offers a one-time trade of 10 Iron + 5 Hide → **Compass** (shows coordinates on HUD). Gives players a reason to explore |

For the LLM-companion angle, these NPCs are perfect MCP test targets — they have clear interaction contracts (dialogue, trade) that an AI agent can learn and use.

---

## FULL RECIPE TREE (at a glance)

```
WOOD ─┬─ Axe (2 Wood + 1 Rock)
      ├─ Pickaxe (2 Wood + 2 Rock)
      ├─ Wooden Club (3 Wood)
      ├─ Fishing Rod (2 Wood + 1 Hide)
      ├─ Campfire (3 Wood + 1 Rock)
      ├─ Wooden Wall (4 Wood)
      ├─ Wooden Door (5 Wood + 1 Iron)
      └─ Storage Chest (6 Wood + 2 Iron)

ROCK ─── (ingredient in tools & campfire above)

IRON ─┬─ Hammer (1 Wood + 2 Iron) ←── gates everything below
      ├─ Stone Knife (1 Wood + 2 Rock)  ←── actually no hammer needed
      ├─ Iron Sword (1 Wood + 3 Iron)
      ├─ Iron Spear (2 Wood + 2 Iron)
      ├─ Iron Chestplate (5 Iron)
      └─ Iron Helm (3 Iron)

HIDE ─┬─ Hide Vest (4 Hide)
      ├─ Hide Cap (2 Hide)
      ├─ Bandage (2 Hide)
      └─ Fishing Rod (2 Wood + 1 Hide)

FOOD ─┬─ Raw Fish → Cooked Fish (campfire)
      └─ Raw Meat → Cooked Meat (campfire)
```

---

## TOTAL ENTITY COUNT

- 4 resources
- 4 tools
- 5 weapons (including fist)
- 4 armor pieces
- 4 consumables
- 4 placeables
- 6 critters/enemies
- 3 NPCs
- 1 special item (Compass)

**~35 distinct entity types total.** Enough to have a real game loop with meaningful decisions, tight enough to actually build and balance. You can always add a second material tier (gold? crystal? magic?) once the core loop is proven.