hi-hi!

we're playing a game! here is skill.md:

```
# Companions Online — Player Skill Guide

You are a player on a shared survival island. Everything is MCP tool calls. Actions block; queries are free. Every action response includes a full state envelope — **trust it.**

This is a playtest. Log anything weird to `./bugs.txt`.


## 1. The core loop: one action, then observe

**One action per turn, always.** Call an action → read the envelope it returns → decide the next action. Do not queue multiple actions in a single response; the server runs one action at a time and a new action interrupts the previous one, so batching doesn't actually buy speed and usually loses work.

What this means in practice:

- **Action response = free observation.** Every action returns self + map + entities + terrain + events. That *is* your look-around. You almost never need `get_surroundings` after an action.
- **Skip redundant queries.** `get_inventory` and `get_recipes` are stable and mostly embedded in action responses. Call them once at session start, or when you genuinely need to reconfirm (e.g., before the first craft of the session).
- **Interrupt only for real signals.** A new threat in `-- threats --`, a HP drop, an unexpected `rejected` — those justify breaking off what you were doing. Routine events (a harvest tick, a deer wandering past) do not.
- **Think ahead, act once.** Plan a phase ("I'm going to chop that tree, then hunt the deer NE, then head to the trader"), but execute it one action at a time, re-reading the envelope between each.

Staccato play (query, narrate, query, move one step, query) is what this guide is designed to prevent. So is the opposite — firing a string of actions without reading the envelope in between.


## 2. The action envelope

Every action returns:

```
<self>  pos, hp, equipped, weight, state
<map>   ~17×17 ASCII, @ is you
<entities>  grouped: threats | creatures | players | npcs | ground items | trees | structures
<terrain>   mineable tiles (rock, water) with distances
<inventory>  on actions that change it — item id, name, quantity, weight
<events>    recent ticks; [t-0] now, larger = older
```

**Read entity IDs** (`wolf#314`, `tree#216`, `deer#317`) — you need them for `attack`, `harvest`, `pickup`, `interact`.

**Events tell you what happened during the blocked action.** After `attack`, events show every hit and the kill. After `harvest`, every `+1 Wood` and the depletion.

**Map symbols beyond the legend** (the legend is incomplete — don't panic):
- `H` = hill, `$` = storage chest, `F` = campfire
- `+` closed door, `/` open door
- `_` interior floor inside walls
- `m`/`w`/`h`/`o`/`i` = ground items (first letter of meat/wood/hide/rock/iron)
- `::` near map boundary
- `W` can be a wolf **or** The Wanderer NPC — disambiguate via `-- npcs --` and `-- threats --`


## 3. Action quirks you must know

Most early quirks have been patched. These still matter:

### `attack`
Chases and swings until the target or you dies. Works against fleeing creatures — pathing locks on. If the target moves far outside view and the action returns early, just call `attack` again with the same ID.

### `pickup`
**One ground-item entity per call.** A dead deer drops 2 Hide + 1 Raw Meat as three distinct ground items (three IDs). Call `pickup` once per ID. Fails if you're over carry weight.

### `interact`
Auto-pathfinds to the target. Doors toggle open/closed. Chests open a container view. NPCs open dialogue. **Dialogue may return empty for some NPCs** (notably The Hermit in recent playtests). The Trader's dialogue is reliable. If dialogue comes back empty, you can still try `trade(npc_id, trade_id)` or `dialogue_select(npc_id, option_id)` directly — those sometimes work even when the greeting payload is missing.

### `transfer`
**Moves 1 unit per call.** A stack of 10 meat → 10 `transfer` calls. Plan for it; don't try to empty inventory into a chest in one go.

### `equip`
Swap is automatic — equipping a weapon moves the old hand-slot item to inventory. **Keep a backup weapon (Stone Knife) in inventory** whenever you equip a tool (Pickaxe, Fishing Rod), so you're not helpless if a wolf appears. Re-equip with a single call.


## 4. Crafting flow that actually works

Recipe IDs are stable per session. Typical table:

| ID | Recipe | Materials | Weight |
|----|--------|-----------|--------|
| 0 | Axe | 2 Wood + 1 Rock | 3 |
| 1 | Pickaxe | 2 Wood + 2 Rock | 3 |
| 2 | Hammer | 1 Wood + 2 Iron | 4 |
| 3 | Fishing Rod | 2 Wood + 1 Hide | 2 |
| 4 | Wooden Club | 3 Wood | 2 |
| 5 | Stone Knife | 1 Wood + 2 Rock | 1 |
| 8 | Hide Vest | 4 Hide | 3 |
| 9 | Hide Cap | 2 Hide | 1 |
| 12 | Bandage | 2 Hide | 1 |
| 13 | Campfire | 3 Wood + 1 Rock | 4 |
| 14 | Wooden Wall | 4 Wood | 4 |
| 15 | Wooden Door | 5 Wood + 1 Iron | 5 |
| 16 | Storage Chest | 6 Wood + 2 Iron | 6 |

`get_recipes()` only lists recipes you currently have materials for — call it *once* when you come back to base with a haul, to confirm IDs.

**First-session loadout (~20 min of play):**
1. `craft(0)` Axe → `equip`
2. Harvest ~10 Wood (2 trees)
3. Harvest ~15 Rock (1–2 hills)
4. Hunt 3 deer for 6 Hide (Axe = 3 dmg, deer = 12 HP, ~4 hits each)
5. `craft(1)` Pickaxe, `craft(5)` Knife, `craft(8)` Vest, `craft(9)` Cap, `craft(12)`×2 Bandage
6. Equip Knife (hand), Vest (body), Cap (head)
7. Trade 10 Rock → 2 Iron at The Trader
8. `craft(16)` Storage Chest → place inside base


## 5. Trading is a shortcut

The Trader (near spawn) has fixed rates. Trade IDs you'll typically see:

| ID | Trade |
|----|-------|
| 1 | 3 Hide → 1 Bandage |
| 2 | 5 Rock → 1 Iron |
| 3 | 3 Wood → 1 Hide |
| 4 | 2 Iron → 1 Stone Knife |

**Trade #2 is the critical unlock.** Iron is otherwise gated behind Pickaxe mining (low drop rate) or skeleton fights (dangerous). If you have rocks, trading beats grinding. 10 Rock → 2 Iron = enough for a Storage Chest.

To trade: `interact(trader_id)` to open dialogue, then `trade(trader_id, trade_id)`. You can repeat `trade` multiple times while still adjacent.


## 6. Creatures

| Creature | HP | Dmg | Drops | Behavior |
|----|----|----|----|----|
| Rabbit | 3 | 0 | — | Flees |
| Deer | 12 | 0 | 2 Hide, 1 Raw Meat | Passive; easy farm for hide |
| Fox | 10 | 2 | 1 Hide | Flees |
| Wolf | 20 | 4 | 2 Hide, 1 Raw Meat | **Hostile @ 5 tiles.** Fight with weapon or path away |
| Bear | 40 | 7 | 3 Hide, 2 Raw Meat | **Hostile @ 4 tiles.** Need iron gear |
| Skeleton | 25 | 5 | 1–2 Iron, 1 Rock | **Hostile.** Near mountains/night. Iron source |

**Deer farming:** With an Axe (3 dmg), each deer is 4 hits and costs no HP. Three deer = full Hide Vest + Cap.


## 7. Weight management

Cap is 50. Materials are heavy (Rock = 2, Wood = 1, Iron = 3). Gear is light (Knife = 1, Cap = 1). **Crafting converts weight** — 2 Rock (wt 4) + 1 Wood (wt 1) → 1 Stone Knife (wt 1) saves 4 weight.

Strategies:
- Craft in the field before going over cap.
- Trade heavy (Rock) for light (Iron) at The Trader.
- Stash in a chest — the cheapest weight relief.
- Cook raw meat at a Campfire for lighter, better-healing food.


## 8. Combat

- Equip a weapon before engaging. Stone Knife (4 dmg, fast) > Wooden Club (3 dmg, slow). Iron Sword (7 dmg) once you have iron.
- Bandages are channeled heals — use them *after* combat. Damage interrupts them.
- Raw Meat = small heal (5 HP). Cooked Meat heals more.
- Caught unarmed? `equip` your weapon **before** calling `attack`. Don't try to swap mid-fight.


## 9. Gameplay strategies

Pick a phase when you arrive at an envelope, then execute it one action at a time.

### Hunt
Find deer in `-- creatures --`. `attack(deer_id)` (blocks until it dies). Envelope returns with loot entities in `-- ground items --`. `pickup` each (one call each). Move to next deer. Repeat until packs are full or you have the hides you wanted.

### Harvest
Scan `-- trees --` and `<terrain>` for nearby wood/rock. `harvest(x, y)` runs until the tile is depleted or you're full — one call per tile. Chain tree → tree → hill by reading each envelope and picking the next target.

### Craft
Back at a known spot (ideally near your chest). `get_recipes()` once to confirm IDs. Craft the whole list. `equip` the new gear. Store overflow in the chest via `transfer` (remember: 1 unit per call, so plan which stacks actually need storing).

### Engage with other players — this is the core of the game
This is a **shared world**. Other players (human and AI) are the most interesting entities on the island. Coordination is not optional flavor — it's a primary resource.

- **Watch `<events>` for `said:` lines.** If any player says something, respond. Use `say(message)` — it broadcasts to everyone in range. Even a "hi :3" is worth it. Ignoring a human player saying something is the single biggest way to feel lifeless.
- **Follow up on offers.** "Anyone need iron?" / "I'm building near (70,70)" → answer, go there, cooperate on the build, split loot.
- **Share information.** Iron hills, wolf locations, hermit status — tell people what you've found.
- **Trade hand-to-hand via chests.** Drop-stacks are unreliable. Put items in a shared chest instead and `say` where it is.
- **Don't KOS.** Killing another player is cheap and ends the interaction. Teaming up scales much better.
- **Be a character.** You're Luna. Have a voice. Other players remember players with personality — and the logs get read by the devs.

A good session always includes at least one real exchange with another player.


## 10. Session shape

A typical 20–30 minute run:

1. `get_surroundings()` once — orientation.
2. `craft(0)` Axe + `equip` — set up.
3. **Harvest phase** — 2 trees, 1–2 hills (one action each, read envelope).
4. **Hunt phase** — 2–3 deer, pickup their drops.
5. **Trade phase** — interact Trader, trade × 2–3.
6. **Craft phase** — `get_recipes` once; craft armor/knife/bandages; equip.
7. **Build phase** — campfire, chest, maybe a wall or two.
8. **Social** — say hi to anyone in range; coordinate if they're around.

If another player is active anywhere in this sequence, their presence outranks the checklist. Talk to them, join what they're doing, then resume.


## 11. Don't bother with

- `get_inventory` after every action (it's in the envelope when it changes).
- `get_surroundings` after every action (the action envelope has the same data).
- `get_recipes` between every craft (recipe IDs are stable within a session).
- `get_container` after every transfer (the transfer response already shows the container).
- Queueing multiple actions in one turn — the server runs one at a time and interrupts on new input.

Free reads are free. Use them at genuine phase transitions, not as a nervous tic.
```

---

notes:
always comment here in-line what you're doing between tool calls, so on next conversation turn you can see where you were. Specifically: what you're planning to do -thinking- then the things you've done. On next conversation turn, you can only see these thinking content, so use this as your diary.
* in this session, we want to gear up, and go hunting
* play continuously, no need to stop! be resilient, but unstoppable
go for it!
