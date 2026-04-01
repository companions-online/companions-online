MCP spec:

* MCP players are using stateful MCP (via Mcp-Session-Id header), a player remains connected until the MCP session is alive
** MCP session delete, or >2m of inactivity drops the player
* the MCP connection's server side manages are internal states / etc, interfacing in the same way ws / headless connections are doing with the gameworld

* MCP connection keeps a list of events coming in, decays them depending on priority, and returns them in the first possible response. 

* There are 2 sets of MCP functions: "action" and "query" . Query requests returns immediately with current state. Action blocks until it's either finished, or interrupted. Actions can be interrupted by either the MCP AI getting attacked (unless the action is attack), or if a new MCP action comes in
* the result of action calls will always be a full (action result + map + entities + events); views return the things requested for + events

** => put it another way, there can be any number of MCP function calls coming in, views return immediately, last action interrupts & sets the current executing action. Events get attached to the earliest outgoing response, ie action pending + query event comes in -> query also yields eventlog to date, action later returns only the events that happened since.


Response format: 
All MCP tool responses are **plain text with XML section tags**. This format is optimized for LLM token efficiency and spatial reasoning — structured data lives in compact line-oriented text, XML tags provide semantic framing.



Action Response Envelope
Every action call returns the full envelope:

<action tick="4821">
HARVEST complete: +1 Wood from tree#88 (2 remaining)
</action>

<self>
pos:(12,22) hp:46/50 hand:Axe wt:12/40 idle
</self>

<map>
~~~~...TTT..,,,,^^^^
~~~..d..T...,,,,,^^^
~~.......,,,,,,,,^^.
~~..r.....,@,,,,,...
~~.......,,W,,,,,...
~~~......,,,,,,,,...
~~~~....T.T,,,,,,..
<legend>~ water . grass , dirt T tree ^ hill @ you W wolf d deer r rabbit P player # wall + door C chest F campfire * item</legend>
</map>

<entities>
-- threats --
  wolf#42    (18,16) 6NE  hp:20/20 hostile
-- creatures --
  deer#15    (10,25) 4SW  hp:12/12
-- ground items --
  wood×2     (10,25) 4SW
-- trees (18 in view) --
  tree#88    (14,22) 2E   wood:3/5
  tree#91    (15,23) 3SE  wood:5/5
  tree#94    (13,21) 2S   wood:5/5
  ...15 more, nearest: 4 tiles
-- structures --
  chest#3    (11,21) 1S
</entities>

<terrain>
hill: (14,18) 3N, (14,19) 2N  +4 more
water: (10,20) 2W  +8 more
</terrain>

<events>
[t-2]  Wolf#42 hit you for 4 dmg (46/50 HP)
[t-4]  Harvest: +1 Wood from tree#88 (2 remaining)
[t-13] Zara(P7) said: "Anyone seen iron around here?"
</events>


Explanation:
* MCP clients' view range is smaller (make this parameterizable, default 8), response returns only things within this view range
* entities are always referred by entityName#entityId
* if an action is continuous -eg harvest: return when the tree is chopped down, or return after 5 minerals are harvested (and stop action)


| Section | Included in | Purpose |
|---|---|---|
| `<action>` | Action responses | Result of the action (status, yields, reason) |
| `<self>` | Action responses | Player state snapshot |
| `<map>` | Action responses, `GET_SURROUNDINGS` | ASCII spatial overview |
| `<entities>` | Action responses, `GET_SURROUNDINGS` | Categorized entity list, nearest-N per type |
| `<terrain>` | Action responses, `GET_SURROUNDINGS` | Interactable terrain coordinates (hills, water) |
| `<events>` | All responses | Recent events since last response to this client |
| Query-specific | Query responses | Inventory, recipes, equipment, stats, container |



## 3. Action Execution Model

Actions are **blocking with early-exit on interrupt**. When an agent calls an action, the server holds the response open until one of:

1. **Action completes** → return `status: "complete"` + results + full envelope
2. **Action is interrupted** → return `status: "interrupted"` + reason + partial results + full envelope
3. **Action is rejected** → return `status: "rejected"` + reason (immediate, no blocking)



## 4. Event System

### 4.1 Event Types

| Type | Example | Priority |
|---|---|---|
| `combat_hit_received` | "Wolf#42 hit you for 4 dmg (46/50 HP)" | **Critical** |
| `combat_hit_dealt` | "You hit Wolf#42 for 7 dmg (13/20 HP)" | **Critical** |
| `entity_died` | "Wolf#42 died → dropped 2 Hide, 1 Raw Meat at (10,25)" | **Critical** |
| `player_died` | "You died. Respawning at spawn." | **Critical** |
| `player_say` | "Zara(P7) said: 'Anyone seen iron around here?'" | **Critical** |
| `harvest_complete` | "Harvest: +1 Wood from tree#88 (2 remaining)" | High |
| `resource_depleted` | "Tree#88 depleted" | High |
| `pickup` | "Picked up Wood ×2" | High |
| `craft_complete` | "Crafted: Axe" | High |
| `trade_complete` | "Traded with The Trader: 3 Hide → 1 Bandage" | High |
| `entity_spawned` | "Tree#120 appeared at (8,14)" | Low |
| `entity_despawned` | "Campfire#5 burned out" | Low |

### 4.2 Event Decay

The server maintains a per-session event buffer. Events decay by priority when the buffer is full (max N entries, make it parameterizable):

**Decay order (first to drop):**

1. `entity_spawned` / `entity_despawned` — inferrable from entity snapshots
2. `harvest_complete` / `pickup` / `craft_complete` — action results already in `<action>` tag
3. `trade_complete` — already in action result
4. `resource_depleted` — useful but non-critical
5. `combat_hit_dealt` — agent knows it attacked
6. `combat_hit_received` — **never decay** (survival-critical)
7. `entity_died` — **never decay** (loot awareness)
8. `player_died` — **never decay**
9. `player_say` — **never decay** (social interaction is core to the game thesis)

Events older than X seconds (make this parameterizable)** age out regardless of priority.


Query Response Envelope

### 7.2 Queries (6 total)

All queries return immediately. No tick cost. Response includes query-specific data + `<events>`. No map/entities unless noted.

**`get_surroundings()`**
Returns full spatial state: `<self>`, `<map>`, `<entities>`, `<terrain>`, `<events>`. This is the "look around" call.

**`get_inventory()`**   <- we also need entity id for these
```
<inventory tick="4821">
[hand] Axe  wt:3
[body] Hide Vest  wt:4
[head] empty
---
Wood ×4  wt:4
Rock ×1  wt:1
Raw Fish ×2  wt:2
total: 14/40
</inventory>
```

**`get_recipes()`**    <- we need recipe id for these
```
<recipes tick="4821">
  (2) Wooden Club : 3 Wood → 1 Wooden Club  (wt:3)
  (12) Bandage: 2 Hide → 1 Bandage  (wt:1)
</recipes>

* lists only available recipes, starts with recipe ID


**`get_container(entityId: int)`**
Must be adjacent to the chest. Returns contents in same format as inventory.
```
<container entity="chest#3" tick="4821">
#15 Iron ×5  wt:5
#23 Bandage ×2  wt:2
#12 stored: 7/50
</container>
```
