Good, let me revise the whole thing cleanly with your feedback integrated.

---

## REVISED ACTION TAXONOMY (v2)

---

### Actions (Player-Initiated Verbs)

**14 actions total** (revised from v1):

| # | Action | Signature | Duration | Notes |
|---|---|---|---|---|
| 1 | `MOVE_TO` | `(x, y)` | Variable | Pathfind + step per tick; cancel by any other action |
| 2 | `STOP` | `()` | Instant | Cancel current action, stand still |
| 3 | `ATTACK` | `(entityId)` | Repeating | Pathfind into range → swing per weapon speed ticks |
| 4 | `HARVEST` | `(tileX, tileY)` | Channeled, repeating | Context-sensitive on tile + equipped item (see below) |
| 5 | `PICKUP` | `(entityId)` | Instant on arrival | Pathfind to ground item → add to inventory; rejected if over carry weight |
| 6 | `CRAFT` | `(recipeId)` | Instant | Validate materials + tool reqs → consume → produce; rejected if over weight |
| 7 | `PLACE` | `(itemId, tileX, tileY)` | Instant | Remove from inventory → create world entity with collision |
| 8 | `USE_ITEM_AT` | `(itemId, tileX, tileY)` | Instant | Cookable + campfire adjacency; converts item in-place |
| 9 | `INTERACT` | `(entityId)` | Instant on arrival | Context-sensitive: opens chest, toggles door, starts NPC dialogue |
| 10 | `EQUIP` | `(itemId)` | Instant | Move to slot (hand/body/head); swaps if occupied |
| 11 | `UNEQUIP` | `(slot)` | Instant | Move back to inventory; rejected if over weight |
| 12 | `DROP` | `(itemId)` | Instant | Remove from inventory → spawn ground entity at feet |
| 13 | `USE_CONSUMABLE` | `(itemId)` | Channeled | Bandage: 10 ticks; Food: 3 ticks |
| 14 | `SAY` | `(message: string)` | Instant | Broadcast text to all entities within interest range (32 tiles); stored in action history for MCP clients |

---

### Query Functions (Read-Only, No Game Tick Cost)

These don't consume an action slot — they're pure reads that both the web client and MCP agents can call at any time.

| # | Query | Signature | Returns |
|---|---|---|---|
| 1 | `GET_INVENTORY` | `()` | Array of `{ itemId, blueprintId, name, weight, quantity, equippedSlot? }` + `currentWeight` + `maxWeight` |
| 2 | `GET_RECIPES` | `()` | Array of `{ recipeId, inputs: [{ blueprintId, quantity }], output: { blueprintId, quantity }, requiresTool?: blueprintId, canCraft: boolean }` — `canCraft` is pre-computed from current inventory |
| 3 | `GET_SURROUNDINGS` | `()` | Entities + tiles within view range (24×24); this is what the client renders from; MCP agents poll this |
| 4 | `GET_EQUIPMENT` | `()` | `{ hand: item \| null, body: item \| null, head: item \| null }` |
| 5 | `GET_STATS` | `()` | `{ hp, maxHp, attackSpeed, damage, currentWeight, maxWeight, position }` |
| 6 | `GET_CONTAINER` | `(entityId)` | Contents of a chest you're adjacent to; same shape as inventory |

---

### HARVEST — Unified Context Table

Single verb, server resolves behavior from what you clicked and what's in your hand:

| Target Tile | Equipped Item | Yield | Tick Cost | Notes |
|---|---|---|---|---|
| Tree | Nothing | 1 Wood | 10 ticks (500ms) | Slow punch-chop |
| Tree | Axe | 1 Wood | 4 ticks (200ms) | Fast chop |
| Hill/Rock | Nothing | 1 Rock | 10 ticks (500ms) | Slow hand-mine |
| Hill/Rock | Axe | 1 Rock | 6 ticks (300ms) | Decent |
| Hill/Rock | Pickaxe | 1 Rock (+ 30% chance 1 Iron) | 4 ticks (200ms) | Best; iron chance |
| Water | Fishing Rod | 1 Raw Fish | Random 8-20 ticks | Must be adjacent to water |
| Water | Anything else | — | — | Rejected |

Trees have a resource pool (e.g. 5 Wood) and disappear when depleted, respawning elsewhere after a timer. Hills are infinite. Water is infinite.

All HARVEST actions auto-pathfind to an adjacent tile first, then begin the channeled cycle. Each cycle yields one unit. The channel repeats until the player cancels (clicks elsewhere) or the resource is depleted.

---

### INTERACT — Unified Context Table

Single verb, server resolves behavior from what was clicked:

| Target Entity | Behavior | Details |
|---|---|---|
| **Chest** | Opens container view | Player sees chest contents; can transfer items in either direction (see below) |
| **Door** | Toggles open/closed | Flips collision state; anyone can operate any door |
| **Campfire** | No special interaction | Cooking is done via `USE_ITEM_AT`; campfire is just a proximity check |
| **NPC** | Opens dialogue/barter | Server sends dialogue tree + trade offers (see below) |
| **Skinnable corpse** | Skins the creature | Yields Hide + Raw Meat; requires Stone Knife in hand; otherwise just loot drops |

Actually — let me reconsider skinning. Simpler approach: **critters just drop their loot as ground items when they die.** No corpse, no skinning step. The Stone Knife's skinning benefit can be that it gives +1 bonus Hide on kill (passive bonus when it's the killing weapon). Keeps the action count down.

---

### CHEST ↔ INVENTORY TRANSFER

When a player `INTERACT`s with a chest and is adjacent, the server enters a **container session**. This isn't a mode or a special state — it's just that two new actions become valid while adjacent:

| Action | Signature | Behavior |
|---|---|---|
| `TRANSFER_TO_CONTAINER` | `(itemId, entityId)` | Move item from player inventory → chest; chest has max capacity (weight or slot count) |
| `TRANSFER_FROM_CONTAINER` | `(itemId, entityId)` | Move item from chest → player inventory; rejected if over carry weight |

These are **sub-actions of the container session**, not top-level verbs. They only work when:
- Player is adjacent to the chest entity
- The chest entity exists and is a chest

If the player moves away, the session implicitly ends. No explicit close action needed.

For the web client: opening a chest shows a split UI — your inventory on the left, chest contents on the right. Click an item on either side to move it to the other. Standard stuff.

For MCP: the agent calls `GET_CONTAINER(entityId)` to see what's in the chest, then calls the transfer actions.

So the revised **total action count is 16** (14 + 2 transfer sub-actions). Or you can model the transfers as:

```
TRANSFER(itemId, fromContainerId, toContainerId)
```

Where `"player"` is the player's own inventory and any entityId is a chest. That's cleaner — **one action, bidirectional**. Back to 15 total.

---

### NPC DIALOGUE & BARTER

NPCs are simple state machines. No free-text parsing (the NPCs are server-controlled, not LLM-controlled — the LLM is the *player*, not the NPC).

**Dialogue structure:**

```typescript
interface NPCDialogue {
  npcId: string;
  greeting: string;           // "Welcome, traveler."
  options: DialogueOption[];
}

interface DialogueOption {
  id: string;
  label: string;              // "What do you have for trade?"
  type: 'talk' | 'trade';
  response?: string;          // for 'talk': NPC says this
  trades?: TradeOffer[];       // for 'trade': list of barters
}

interface TradeOffer {
  tradeId: string;
  gives: { blueprintId: string, quantity: number };
  wants: { blueprintId: string, quantity: number };
}
```

When a player `INTERACT`s with an NPC, the server sends the `NPCDialogue` payload. The client renders it as a simple menu. The player picks an option.

**New actions for NPC interaction:**

| Action | Signature | Behavior |
|---|---|---|
| `DIALOGUE_SELECT` | `(npcEntityId, optionId)` | Pick a dialogue option; server responds with text or opens trade view |
| `TRADE` | `(npcEntityId, tradeId)` | Execute a barter; server validates player has the `wants` items, swaps them for `gives` items |

These only work while adjacent to the NPC. Moving away ends the conversation implicitly.

**The three MVPs NPCs concretely:**

**The Hermit** (tutorial):
```
greeting: "Ah, another soul washed ashore. Take these — you'll need them."
options:
  - "Tell me about this place" → talk → lore blurb
  - "I need supplies" → trade →
      [First time only: free 2 Wood + 1 Rock, flagged per-player]
```

**The Trader** (economy fallback):
```
greeting: "Buyin' or sellin'?"
options:
  - "Show me your wares" → trade →
      3 Hide → 1 Bandage
      5 Rock → 1 Iron  
      3 Wood → 1 Hide
      2 Iron → 1 Stone Knife
```

**The Wanderer** (exploration reward):
```
greeting: "You've come far. I have something for those who prove their worth."
options:
  - "What do you want?" → trade →
      10 Iron + 5 Hide → 1 Compass
  - "Where are you headed?" → talk → random hint about resource locations
```

---

### REVISED COMPLETE VERB TABLE

```
── World Actions ──────────────────────
MOVE_TO(x, y)
STOP()
ATTACK(entityId)
HARVEST(tileX, tileY)
PICKUP(entityId)
PLACE(itemId, tileX, tileY)
USE_ITEM_AT(itemId, tileX, tileY)
INTERACT(entityId)
SAY(message)

── Inventory Actions ──────────────────
EQUIP(itemId)
UNEQUIP(slot)
DROP(itemId)
USE_CONSUMABLE(itemId)
CRAFT(recipeId)
TRANSFER(itemId, fromContainer, toContainer)

── NPC Actions ────────────────────────
DIALOGUE_SELECT(npcEntityId, optionId)
TRADE(npcEntityId, tradeId)

── Queries (no tick cost) ─────────────
GET_INVENTORY()
GET_RECIPES()
GET_SURROUNDINGS()
GET_EQUIPMENT()
GET_STATS()
GET_CONTAINER(entityId)
```

**17 actions + 6 queries = 23 total interface points.** That's the full game surface area for both human players and MCP agents. Every interaction in the game maps to one of these, and nothing exists outside of them.

---

### SPEED / TICK CALIBRATION NOTE

With your formula `ticksPerStep = Math.round(TICK_RATE / speed)` and Player speed=3 at TICK_RATE=20:

- Player movement: **7 ticks per step = 350ms per tile**
- Walking across the full 128-tile map diagonally would take roughly 90 seconds, which feels right

For action speeds, I'd recommend expressing them in raw ticks rather than going through the speed formula, since actions aren't "movement" — they're fixed-duration channels. All harvest/attack costs below are **base ticks**; the server multiplies them by `ACTION_BASE_TICKS` (in `shared/src/constants.ts`, currently `2`) at resolution. Flip the constant to retune the whole cadence.

```
Fist attack:           2 base ticks  × ACTION_BASE_TICKS
Stone Knife attack:    3 base ticks  × ACTION_BASE_TICKS
Iron Sword attack:     4 base ticks  × ACTION_BASE_TICKS
Wooden Club attack:    5 base ticks  × ACTION_BASE_TICKS
Iron Spear attack:     4 base ticks  × ACTION_BASE_TICKS
Eat food:              3 ticks  (not scaled)
Bandage channel:      10 ticks  (not scaled)
Harvest (fast):        4 base ticks  × ACTION_BASE_TICKS per resource unit
Harvest (slow):       10 base ticks  × ACTION_BASE_TICKS per resource unit
```

At `ACTION_BASE_TICKS = 1` these read as the original snappy timings; at `2` combat has more breathing room between swings (roughly 1 iron-sword swing per second) while still feeling responsive.