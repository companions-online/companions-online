



-----
❯ okay, scalability issues:
* on larger maps, the density of interesting stuff gets proportionally reduced -ie whereas in small map, on a 20x20 territory featured hills, trees, rivers, on a large (eg 512x512) map, there are very large, very empty territories



Phase D: World Interaction
- Campfire, Wooden Wall, Door, Storage Chest 
- Container system (chest ↔ player transfer) 
- Door toggle (open/closed collision)        
- NPC dialogue trees + barter trades         
- CLI: container view, NPC dialogue          


UseConsumable (bandage channeling, food healing) and Say (chat broadcast)



Done:



---

| The placeable→building-layer conversion (UseItemAt writing to map.setBuilding() instead of creating entities) is a separate follow-up that will use this infrastructure.
Write test: reusing the empty test area, test bot has 3 wooden walls, places them in a line => should receive the terrain update; walking around it should be *around* instead of walking through (path-finding marks it as non-traversable)




