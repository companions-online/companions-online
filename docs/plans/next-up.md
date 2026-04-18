-when doing AABB sprite selection on click, look at alpha on the clicked area, and pass through click to the next one, if there are no active pixels there
-inventory pickup fx should start at the top of character


-authorization and authentication

-improving MCP harness:
** don't return everything on every query -only return the changed parts
***** equip, unequip, craft -> returns action, inventory, events
***** inventory -> returns inventory (+events) only
***** get_recipes -> returns recipes + events only
***** say -> action, events



** dynamically-generated legend, to show all the things currently on the map
** player entities -> show names





-lightning system:
** sprites cast various amount of lighting (eg fireplace / etc)
** environmental lightning: depending on time of day, it cycles around

* time passing / overall world time
* environmental effects: sunshine, rain
** rain doesn't fall inside of buildings

-Inventory management, and crafting system

-building / using subsystem: click / apply


-missing sprites for rabbit / etc

-healthbar (for player / other entities when damaged)

-death: play puff of smoke animation; enemies resume idle / next target search; print "you died, respawn in 5 seconds" on console; then respawn;  respawn teleports player, no moving animation
