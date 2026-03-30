How Clicks Map to Actions
The client needs to figure out intent from a click. The logic:

Player clicks on tile/entity:
  
  1. Is it a ground tile with nothing on it?
       → MOVE_TO(x, y)
  
  2. Is it a tree tile?
       → HARVEST(x, y)   [auto-pathfinds to adjacent]
  
  3. Is it a hill/mountain tile?
       → HARVEST(x, y)   [auto-pathfinds to adjacent]
  
  4. Is it a water tile AND player has fishing rod equipped?
       → FISH(x, y)
  
  5. Is it a hostile/neutral creature?
       → ATTACK(entityId)
  
  6. Is it a ground item (dropped loot)?
       → PICKUP(entityId)
  
  7. Is it an NPC, chest, or door?
       → INTERACT(entityId)
  
  8. Is it another player?
       → ATTACK(entityId)  [if PvP enabled]
       → or MOVE_TO adjacent [if PvP disabled]
  
  9. Is player in "place mode" (selected a placeable from inventory)?
       → PLACE(itemId, x, y)
  
  10. Is player in "use mode" (selected a cookable from inventory)?
       → USE_ITEM_AT(itemId, x, y)

Modes 9 and 10 are the only modal states — the player has selected something from inventory and is now clicking a world target. Clicking ground or pressing escape cancels the mode and goes back to default click behavior.
