
Inventory + currently, there is no way for the player in client-gl to use an item -eat meat, apply bandage,     cook meat. enter game design mode -think minecraft/ultima online-what would be a good UX to           implement this? 
^^ minecraft quick-menu
---
pathfinding vs closed doors; pathfinding vs water
-water should not be walkable
-and no trees should be spawned in water

---
* slow attacks (and harvesting) down, by factor of 1.5-2

* piles for the ground


---
* quantize environment lighting -each hour? so it's visible
----


-when doing AABB sprite selection on click, look at alpha on the clicked area, and pass through click to the next one, if there are no active pixels there
-inventory pickup fx should start at the top of character
---


* MCP map legend is currently static; we want a map legend which shows the characters & their meanings that are
  shown on the map; for example, by collecting the characters printed out along with their descriptions
** dynamically-generated legend, to show all the things currently on the map

** player entities -> show names in MCP response

* skill.md update



* environmental effects: sunshine, rain
** rain doesn't fall inside of buildings


-missing sprites for skeleton / etc
-during night, spawn skeletons around player; when the sun comes up, they die


-town generator: find an empty place, put 3-4 houses in there


-in-house elements to build/craft


-----
Done:

-authorization and authentication

---

-lightning system:
** sprites cast various amount of lighting (eg fireplace / etc)
** environmental lightning: depending on time of day, it cycles around
* time passing / overall world time

---


 in assets/import/campfire.png , we have a new campfire pic; if you look at it, this is a 9-frame animation. we want to: 1, develop static entities to have animations (and appropiately slice it up, and play back); and 2, develop both static, and animated creature-entity's scaling -ie being able to scale eg fox to be smaller.
 One note: currently, there is a scaling-ish already implemented -if you look at sprite registry/manifest -> frameW / frameH projects wood/rock/etc into smaller -not sure where else this is hooked up; basically, we want to have scaling instead/additionally.
 Do discovery before planning mode.

---
-improving MCP harness:
* in mcp status -add current hour (time, day/twilight/sunset/night -based on current time)
** don't return everything on every query -only return the changed parts
***** equip, unequip, craft -> returns action, inventory, events
***** inventory -> returns inventory (+events) only
***** get_recipes -> returns recipes + events only
***** say -> action, events


----
---
we want to formalize a login/identify for both websocket, and MCP user later; for now: when an MCP connects, we don't want to create a new player immediately, but wait for (new MCP function)
identify(name)
function call; once called, server sets MCP player's name, and spawns them; returns the full env schema

Additionally, issues:
* MCP players do not have a nametag by default?
* MCP disconnect issue: this is documented in docs/plans/mcp-server-keepalive.md  <- and we want the fix 1 & 2 of these implemented
* quirks bugfix:
** MCP harvest "If you are **not adjacent** to the tile, the first call just pathfinds to it and returns without yielding anything. Call harvest a **second time** at the same coords to actually gather."  <- this should do the harvest immediately, and yield it? investigate


------


Game effects:
* in client-webgl/assets/smoke-anim.png  there is a 9-frame 3x3 smoke animation, which goes for dieing: whenever an animal / player / creature dies, we want to play this puff of smoke. The animation frames are smoke intensity descending ( 9/8/7  6/5/4 3/2/1); we want to go 6->9->1 so a smoke puffs wherever that creature was
* when the user dies, currently it looks as if it's "moving" back to spawn position -it should instead puff the smoke, disappear the player character, wait until respawn, *teleport back to spawn*.
* when a player dies, wolves/etc attacking them should stop attacking, and lose it as a target -return to idle, or attack someone else

* whenever a player performs an action -harvest, craft, attack etc:
** they should always face the thing they are harvesting/attacking/etc (server-initiated turn action); 
** this should show up to other players as well, and it should play a small animation: client-webgl/assets/harvest-craft-anim.png  -7frame, 3x3 animation      -and attack-anim.png -6frame 3x3 animation

^^+ game events
----
Inventory:
* on pressing "I", it brings up the inventory, centered in the game area, with 3 sections: left: player's basic/meta: name, HP, weight, etc;  middle section: all the items the user is carrying, inside a minecraft-like squares, using the item's picture only + quantity (with a number on top of it ); right: things the player can currently craft; it displays the resulting item's picture, and displays what it consumes, again picture of the item + white number on it marking quantity; clicking on any craft recepie crafts the item.
* see scripts/dist/minecraft-inventory.png for inventory + quantity view.

Ideation mode: we want to cover the cases where: user equips item, user drops item, and when equipped eg a wall/floor, user places it on the world (this is a different, build action). What would be intuitive actions for this that can we do in canvas/gl?

----
-Inventory management, and crafting system
-building / using subsystem: click / apply
-healthbar (for player / other entities when damaged)

-death: play puff of smoke animation; enemies resume idle / next target search; print "you died, respawn in 5 seconds" on console; then respawn;  respawn teleports player, no moving animation
