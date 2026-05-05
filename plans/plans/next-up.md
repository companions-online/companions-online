
Usability:
* increase max weight carriable by player to 100; max weight in chest to 250
* remove "q" as debug, the current action command in upper-left should always be visible


Mobile support

* bottom-right button menu:  [default right-click action] [Inventory] [Settings]
^^ default right-click action is when a thing is selected in inventory -eg cooked meat- to heal; it should display the action itself. Eg for building, place wooden wall, which then places wherever the user left clicks/taps
* quickslot items clickable -> switches quickslot item

Remaining assets:
* wooden wall, floor tile sprites
* NPCs + new variants for player



---

user guide sections:

> getting started
* crafting guide
* building guide
> running server
> running LLMs
* harness
* prompts
* MCP server
> contribute
---


Next, we want to develop a combined landing page - user guide - online instant play, using docusaurus
* Goes into user-guide/    ; npm run build:guide  builds it


Sections:
* Landing: full-screen, no sidebar; middle: client-webgl/assets/game-logo.png,  below it: play now button
** on clicking "play now", it turns the entire logo + button into a canvas, dynamically loads the .js, starts the game



Product update:
-companions-online.github.io   <- docs page
--about, play instantly, crafting guide, building guide
--MCP / I'm an AI <- instant prompt-drop, how to connect, how to play
--contribution guide
--license

game:
-splash page  -> create single player game, join game somewhere
--game bottom: settings, inventory
--first game launch -> tutorial-ish: welcome to companions online, how to start

-soundtracks dir


-elsyian github repo rewrite
-elsyianmoe github reg + org setup

--license thinkthrough  => AGPL





World refresh update:
next stage of game design:
* in-house elements to build/craft: internal decor (fireplace, table, chair, etc)
* palm trees

* environmental effects: rain / sunshine
** rain doesn't fall inside of buildings


* bow/arrows / projectiles
* new biome: desert  (< -scorpions, always stay in desert biome)

* town generator: find an empty place, put 3-4 houses in there


---
bug: can't place a chest on wooden floor?
mcp: multiple pickups / quantity for craft

----
product:
* logo
* music into S3 bucket
* bottom buttons: inventory / options
* main menu: world select / create world + get API key
* website rest: mcp prompt
* stand-alone demo maybe

------
companion economy:
characters:
** peon -builds buildings
* merchant / trader -trades items
* hunter -goes out & hunts animals
* princess -high&mighty




* health+: when user heals, we currently have a short animation that plays -additionally, we want to show a green "+5" bubbling up -similar to damage, but no star background
* and we want both health + damage displays to be smaller -about half of current size




---
* piles for the ground


---
* quantize environment lighting -each hour? so it's visible
----


-when doing AABB sprite selection on click, look at alpha on the clicked area, and pass through click to the next one, if there are no active pixels there

---


* MCP map legend is currently static; we want a map legend which shows the characters & their meanings that are
  shown on the map; for example, by collecting the characters printed out along with their descriptions
** dynamically-generated legend, to show all the things currently on the map






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
* MCP disconnect issue: this is documented in plans/plans/mcp-server-keepalive.md  <- and we want the fix 1 & 2 of these implemented
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

----
-inventory pickup fx should start at the top of character
----
Inventory system upgrade:
* currently, there is no way for the player in client-gl to use an item -eat meat, apply bandage, cook meat.
*  we want to have minecraft-like "quick slots" (1-9) where players can equip items. This is purely client-side; when user presses a quick slot button (1-9), it automatically sends the equip command server-side.

Details:
* on the inventory view, this is displayed below the inventory section, user can drag&drop items there. Currently selected one is highlighted
* from the left section, remove "hand"; instead: new player-armor type: boot; and the display order is top-down: head / body / boot
* make the inventory section be 9x3, and below the quickmenu 1-9 with spacing
* dragging & dropping an item to the quick slot -> attaches there (and stores it client side)
* when a ground-usable item is selected, new convention: left click still moves/actions, right click is _depending on the selected item_ places/uses. for building, use the existing highlight system, but left click moves, right click places it; for cooking, highlight the cook-places (eg campfire) to use it with, left click moves/actions, right click places ;  for medkits, selecting a quickslot (bandage), then right click uses the medkit.
Review the relevant source code, and ask any questions that's useful for implementation.

---
* slow attacks (and harvesting) down, by factor of 1.5-2

---
-missing sprites for skeleton / etc
-during night, spawn skeletons around player; when the sun comes up, they die

---
pathfinding vs closed doors; pathfinding vs water
-and no trees should be spawned in water

----
-water should not be walkable [??]
----
Specific issue:
* when attempting to scale up the map (MAP_SIZE => eg 2048), world-gen makes everything larger as well -rivers larger, fields larger, forests larger, etc. We want to maintain the current density of stuff, but make it possible to run an infinitely large map -and entities / environment / trees etc to be generated at current density.


----
----
harness:

 we're going to make a bunch of smallish changes:
  * harness: npx harness human *does not takes* a model .conf, but _does_ takes a variant, so we
  flip it out: npx harness compact human    <- uses the compact variant, starts human UI.
  Explicitly: if model-config === "human" -> launch ui.
  * rename "truncated" variant to "shortened"
  * ctrl+c on eval, or exit of any kind -> print out input + output token usage totals
  * shortened variant: compactOldTurn -> all chatMessages are marked from assistant (not user);
  compactTurnLine: extracted messages (chatresponse or thinking) are _never_ truncated, added as-is;
  additionally, extract reasoning, and add that back into message as well;
  ---



* human harness to use strategies/variants
* Y coords on map (w/ max width clamping)
* player's name on entity rendering
* player's name in say
* assistant-says

---
also did: pathway -> water -> hints where to build a bridge;
in general, being intelligent about error handling is Very Good -> improves eval scores

---
** player entities -> show names in MCP response
* skill.md update


--------
For next step, we want to turn this into an actual product:
* we've developed a prototype around standalone mode in ../standalone/standalone -this will get integrated into the main game client. Essentially, it pulls in the server components necessary to run the game alone, without connecting to any server explicitly
* client-gl will be able to run in stand-alone mode (default), or server running mode (GAME_SERVER_HOST js global is defined)
* client will start in a main menu; with logo (assets/game-logo) on top, below it buttons for main menu; bottom left: companions-online.github.io    ; bottom right: build 123
* while the user is in main menu, a new game-world (default seed) is spin up, and entered in observer mode: camera moves around: 3-5 sec in one of 8 directions, then direction change, repeatedly (unless hit edge points, in which case, forcibly towards the middle of the world) (this is the current observer view as implemented)


* Main menu is determined by whether it runs in standalone, or server running mode:
** in standalone mode, game menu is:  [New Game]  [Join Game]   [Settings]
** server mode, it is only:   [Join Game]   [Settings]
* after this, we have a new game screen. This will be divided into upper: world/server section, and lower: player section
** Upper section: in new game -> World Seed: [42]   <- clicking on the box drops in cursor to edit it
**** In join game:  Remote Host: [https://...]   <- accepts domain, or specific URL; if GAME_SERVER_HOST is set, autofill this out; next to it a paste icon, clicking on it pastes clipboard directly
** Lower section: Character
**** Name: [Player]   <- editable
**** Avatar:  list variants of player sprite (currently only catgirl), with highlight on the selected one
** bottom button:  [Start World]   or   [Join World] depending on whether new/join in-menu
** in Start world -> starts up the game-world instance with specified seed, starts the game
** in Join world -> displays a popup Connecting to [host]...     then either Connection Error:\n [error string]\n [Retry] [Back]  or joins the game directly


-----
