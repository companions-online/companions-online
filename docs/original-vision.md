Companions Online Proto

The purpose of this project is to determine feasibility of an MMO-like game, which allows mixed player-LLM interaction in a shared world.
The world: Ultima online-like, isometric 2d, with a minecraft twist that people can build things here
The system breaks down into:
* A server, which runs the game loop, maintains the world
* a web client, using websocket connection
* an MCP client, using a set of MCP functions where an AI can do exactly all the things the player can do.

Typescript server, typescript client

Control: the user navigates/uses things by clicking on an isometric representation interface. Clicking somewhere else cancels the previous action. This means, for every player, we only need to know what action they are currently performing, and transit that to all clients (along with occasoinaly sync), to calculate predictively where the user is.

Network-web: websockets, decoupled from game representation, binary protocol. Users' view is (parameterize this) 24x24 neighbour of their current position. "Interest" range of receiving information is (parameterize this) 32x32

Pathfinding: when users click to move somewhere, only the end position is transmitted; we calc both client & server-side (shared library?) the path towards it.
Core game then uses fixed timestep (parameterize this) 20hz tick to make step-by-step moves; client ditto and interpolates the result. 
Server then follows it up with deltas for all entities within interest range.

** The world
* dynamically generated using PerlinNoise: (parameterize this) 128x128 grassy island, surrounded by water, with several streams, and rivers flowing through this.   Rocky mountains sometimes, and large plains.
* basic critter types: deer, rabbit, fox, wolf
** critters move around, and sometimes idle (moving around: select random next location-to-move-to within it's interest range)
** critters can be attacked, have health; deer&rabbit stays put when attacked;  fox&wolf attacks back

* trees on grassy zones, with varying density (dense forests etc). Trees are colliding, can't be traversed -but should never be so close to eachother that they can't be moved around
** trees can be chopped down by Axe, which yields Planks

* hills can be mined by hand (slowly), or with Axe (quickly), which yields Rocks, and Iron

Overall mechanics:
* all players share the same spawn point (+-N distance around it). Players & entities collide with eachother, they don't clip (if spawn would clip, move it away). Pathfinding looks at all colliders in determining best path.
* stats per entity: HP, max HP.  Attack speed (measured in cycles), and damage is calculated by wielded weapon (default: fist)

ECS:
* Entity/mass-entity based system; each inherit a unique entity ID; common properties: location, direction (8 directions), ...etc
* Each entity has network-sync'd components, and non-network-sync'd components
* Implements a quadtree, so we can do distance-based lookups (for example, for which player to notify about events)


** Network protocol
Binary network protocol with valve-like delta compression, server-authoritative positions; interacts with pathfinding, see network-protocol-draft.md   -this is highly draft, and undergoes several revisions

* diagonal movement cost - gametick cycle issue: " Alternating Diagonal Cost (the UO / d20 approach)
The most common practical solution. Diagonal moves alternate between costing 1 and 2 ticks (or movement points). The sequence 1, 2, 1, 2... averages to 1.5 per diagonal step, which approximates √2 ≈ 1.414 with only ~6% error. This is what D&D 3.5e's optional movement rule does, and what several tile-based MMOs use.
In practice you track a single bit of state per entity — "was the last diagonal cheap or expensive?" — and flip it each diagonal step."


Code:

Layout:
./client   -all client code
./server   -all server code
./shared   -all shared code

./docs/protocol.md   -final protocol code

MCP: TBD, but broadly: this is 100% pull-based, and LLM clients need to know the history up to the point they're informed
* we maintain a buffer of previous actions taken (compressed only on movements -no need for every direction, just "player moved to here next waypoint is ths"), and LLM's perception will be assembled from history/present state + map + etc
