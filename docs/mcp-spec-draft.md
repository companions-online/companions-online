MCP spec:

* MCP players are using stateful MCP (via Mcp-Session-Id header), a player remains connected until the MCP session is alive
** MCP session delete, or >2m of inactivity drops the player
* the MCP connection's server side manages are internal states / etc, interfacing in the same way ws / headless connections are doing with the gameworld

* MCP connection keeps a list of events coming in, decays them depending on priority, and returns them in the first possible response. 

* There are 2 sets of MCP functions: "action" and "query" . Query requests returns immediately with current state. Action blocks until it's either finished, or interrupted. Actions can be interrupted by either the MCP AI getting attacked (unless the action is attack), or if a new MCP action comes in
* the result of action calls will always be a full (action result + map + entities + events); views return the things requested for + events

** => put it another way, there can be any number of MCP function calls coming in, views return immediately, last action interrupts & sets the current executing action. Events get attached to the earliest outgoing response, ie action pending + query event comes in -> query also yields eventlog to date, action later returns only the events that happened since.

* MCP clients' 

Response format: plain text, in the following format:

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

<legend> ~ water . grass , dirt T tree ^ hill</legend>
</map>

<entities>
   name#entityId  (x,y) distance   attributes
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
