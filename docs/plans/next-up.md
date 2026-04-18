* quantize environment lighting -each hour? so it's visible


----


-when doing AABB sprite selection on click, look at alpha on the clicked area, and pass through click to the next one, if there are no active pixels there
-inventory pickup fx should start at the top of character
---

-improving MCP harness:
* in mcp status -add current hour (time, day/twilight/sunset/night -based on current time)
** don't return everything on every query -only return the changed parts
***** equip, unequip, craft -> returns action, inventory, events
***** inventory -> returns inventory (+events) only
***** get_recipes -> returns recipes + events only
***** say -> action, events

* MCP map legend is currently static; we want a map legend which shows the characters & their meanings that are
  shown on the map; for example, by collecting the characters printed out along with their descriptions
** dynamically-generated legend, to show all the things currently on the map

** player entities -> show names

* skill.md update



* environmental effects: sunshine, rain
** rain doesn't fall inside of buildings

-Inventory management, and crafting system

-building / using subsystem: click / apply


-missing sprites for rabbit / etc

-healthbar (for player / other entities when damaged)

-death: play puff of smoke animation; enemies resume idle / next target search; print "you died, respawn in 5 seconds" on console; then respawn;  respawn teleports player, no moving animation

-town generator: find an empty place, put 3-4 houses in there

-cemetary: skeletons

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
