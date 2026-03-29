# Network Protocol Specification

Isometric multiplayer game. ECS architecture. WebSocket binary protocol.

---

## Architecture Overview

The server is the single source of truth for all game state. Clients are thin renderers with no game logic, no pathfinding, and no prediction. The player's own character is treated identically to every other entity — the client learns what it is doing from the server, same as everyone else.

```
CLIENT                              SERVER
  │                                    │
  │  Click tile (20, 15)               │
  │  ──── ACTION (3-7 bytes) ────────► │
  │                                    │  Validate, pathfind,
  │                                    │  update ECS components,
  │                                    │  mark dirty
  │                                    │
  │  ◄──── DELTA (20-100 bytes) ────── │  Next tick: broadcast
  │                                    │  changes to all clients
  │  Update local state, animate       │
  │                                    │
```

State flows one direction: server → client. The only data flowing client → server is raw player intent ("I clicked here"). There are no ACKs, no sequence numbers, no reconciliation.

### Immediate Cosmetic Feedback

When the player clicks, the client may immediately show cosmetic-only feedback (tile highlight, cursor change, click sound) before the server responds. This is purely visual and carries no game state. The character does not begin moving until the server includes the action in a delta.

---

## ECS Components

### Network-Synced Components

These components are transmitted over the wire via delta snapshots. Each is assigned a fixed bit index in the component bitmask.

```
Bit 0: Position
Bit 1: Direction
Bit 2: NextWaypoint
Bit 3: CurrentAction
Bit 4: Health
Bit 5: Appearance
Bit 6: StatusEffects
Bit 7: Ownership
```

**Position** (bit 0, 4 bytes)

Tile coordinates on the world grid.

```
tile_x: uint16
tile_y: uint16
```

No sub-tile precision. Entities occupy discrete tiles. Smooth sub-tile rendering during movement is computed client-side by interpolating between the current position and the next waypoint (see Movement).

**Direction** (bit 1, 1 byte)

Facing direction in isometric space. 8 cardinal/diagonal directions.

```
dir: uint8 (0-7)

    7  0  1
     \ | /
  6 ── · ── 2
     / | \
    5  4  3
```

Updated by the server whenever the entity changes heading (direction change along a path, turning to face an interaction target, etc.).

**NextWaypoint** (bit 2, 4 bytes)

The tile the entity is currently walking toward. Defines the current movement leg.

```
tile_x: uint16
tile_y: uint16
```

Sentinel value `(0xFFFF, 0xFFFF)` means no waypoint (entity is stationary). See the Movement section for how this drives client-side rendering.

**CurrentAction** (bit 3, 1-7 bytes)

What the entity is doing right now.

```
action_type: uint8
action_payload: 0-6 bytes (depends on action_type)
```

Action types:

```
0x00  IDLE          no payload
0x01  WALKING       no payload (direction and waypoint are separate components)
0x02  INTERACTING   target_entity_id: uint16
0x03  BUILDING      target_tile_x: uint16, target_tile_y: uint16
0x04  HARVESTING    target_entity_id: uint16
0x05  DEAD          no payload
```

Extensible. New action types can be added without changing the protocol framing.

**Health** (bit 4, 4 bytes)

```
current_hp: uint16
max_hp:     uint16
```

**Appearance** (bit 5, 3 bytes)

Visual presentation. Does not affect gameplay.

```
sprite_id: uint16
anim_state: uint8     (idle, walk, work, attack, etc.)
```

**StatusEffects** (bit 6, 2 bytes)

Active status effects as a bitmask.

```
effects: uint16

Bit 0: poisoned
Bit 1: slowed
Bit 2: hasted
Bit 3: stunned
...up to 16 effects
```

**Ownership** (bit 7, 1 byte)

Which player controls this entity (0 = unowned / world entity).

```
player_id: uint8
```

### Client-Only Components (Not Synced)

These exist only in the client's local ECS for rendering purposes.

```
RenderPosition    float x, y for smooth sub-tile interpolation
AnimationTimer    per-entity animation frame counter
ClickIndicator    cosmetic destination marker
SpriteCache       resolved texture reference
```

### Server-Only Components (Not Synced)

These exist only in the server's ECS for simulation.

```
Path              full A* waypoint list (only NextWaypoint is synced)
DirtyFlags        bitmask of changed components + tick of last change
ClientVisibility  per-client: which entities are in each client's viewport
PathETA           estimated tick when entity reaches current NextWaypoint
```

---

## Movement & Pathfinding

### Server Side

All pathfinding runs exclusively on the server. When a player clicks a destination tile, the server:

1. Receives the ACTION message (MOVE_TO target tile).
2. Validates the target (is it walkable? is a path reachable?).
3. Runs A* from the entity's current position to the target.
4. Stores the full path in the server-only `Path` component.
5. Sets the first direction change (or final destination if a straight line) as `NextWaypoint`.
6. Sets `Direction` to the heading of the first path leg.
7. Sets `CurrentAction` to WALKING.
8. Marks Position, Direction, NextWaypoint, CurrentAction as dirty.

On subsequent ticks, the server's movement system advances the entity along its path:

```
each tick:
  for each entity with (Position, Path, Speed, Walking):
      advance position along path by (speed × tick_dt)
      
      if entity reached current NextWaypoint:
          if path has more segments:
              set NextWaypoint to next direction-change point along path
              set Direction to new heading
              mark dirty: Position, Direction, NextWaypoint
          else:
              entity has arrived at destination
              set NextWaypoint to NONE
              set CurrentAction to IDLE
              mark dirty: Position, Direction, NextWaypoint, CurrentAction
```

Delta updates for a moving entity are sent **only at direction changes and arrival**, not every tick. While an entity walks in a straight line toward its NextWaypoint, it generates zero network traffic.

### Client Side

The client has no pathfinding and no game logic. Movement rendering is a single lerp:

```
each frame:
  for each entity:
      if entity.next_waypoint is NONE:
          render at entity.position (tile-snapped)
      else:
          elapsed = current_time - entity.leg_start_time
          leg_distance = distance(entity.leg_start_pos, entity.next_waypoint)
          progress = clamp(elapsed × entity.speed / leg_distance, 0.0, 1.0)
          render_pos = lerp(entity.leg_start_pos, entity.next_waypoint, progress)
          render at render_pos
          
          if progress >= 1.0:
              entity.position = entity.next_waypoint
              entity.next_waypoint = NONE   // stop, wait for next server update
```

When a delta arrives with a new NextWaypoint, the client sets `leg_start_pos` to the authoritative Position from that same delta and `leg_start_time` to now. The entity begins moving toward the new waypoint.

If the next server update arrives late (entity reached its waypoint and stopped for a few frames), there is a brief stutter at turns. This is acceptable for the game's pace. If it becomes noticeable, the protocol can be extended to include a lookahead waypoint (see Future Extensions).

### Speed

Entity movement speed is part of the entity's server state but is not a frequently-changing component. It can be included in the full-state message on entity creation and re-sent in a delta only when it actually changes (e.g., haste/slow status effect applied). On the wire:

```
Speed (1 byte):
  value: uint8     // tiles per second × 16 (fixed-point, 0.0625 resolution)
```

The client stores speed locally per entity and uses it for the lerp calculation.

---

## Wire Protocol

### Transport

WebSocket over TCP. Binary frames (not text). No Socket.IO — raw WebSocket with a compact binary message format.

### Message Framing

Every message starts with a 1-byte opcode.

```
┌──────────┬────────────────┐
│ opcode   │ payload        │
│ uint8    │ variable       │
└──────────┴────────────────┘
```

### Client → Server Messages

**ACTION (0x01)**

Player intent. Sent when the player clicks.

```
┌──────────┬─────────────┬──────────────────────────┐
│ 0x01     │ action_type │ action_target             │
│ 1 byte   │ uint8       │ 0-4 bytes                 │
└──────────┴─────────────┴──────────────────────────┘
```

Action payloads:

```
MOVE_TO (0x01):       target_tile_x: uint16, target_tile_y: uint16    4 bytes
INTERACT (0x02):      target_entity_id: uint16                        2 bytes
BUILD (0x03):         building_type: uint8, tile_x: uint16,
                      tile_y: uint16                                  5 bytes
CANCEL (0x00):        (no payload)                                    0 bytes
```

Total message size: 2–7 bytes. Sent at human click speed (1–5 per second).

**PING (0x02)**

RTT measurement. Sent every ~1 second.

```
┌──────────┬──────────────┐
│ 0x02     │ client_time  │
│ 1 byte   │ uint32       │
└──────────┴──────────────┘
5 bytes.
```

### Server → Client Messages

**PONG (0x02)**

Echoes the client's ping timestamp.

```
┌──────────┬──────────────┐
│ 0x02     │ client_time  │
│ 1 byte   │ uint32       │
└──────────┴──────────────┘
5 bytes.
```

**WORLD DELTA (0x10)**

Periodic game state update. Sent every tick (10–20 Hz), but only includes entities and tiles that changed since the previous delta sent to this client.

```
┌──────────┬──────────┬──────────────────────────────────────────────┐
│ 0x10     │ tick     │ sections...                                  │
│ 1 byte   │ uint16   │ variable                                     │
└──────────┴──────────┴──────────────────────────────────────────────┘
```

Sections are a sequence of tagged blocks terminated by `0x00`:

```
Section tag 0x01: Entity Updates
Section tag 0x02: Entity Removals
Section tag 0x03: Tile Updates
Section tag 0x00: End of delta
```

**Entity Update Section (tag 0x01)**

```
┌──────────┬───────────┬───────────────────────────────────────┐
│ 0x01     │ count     │ entity_delta[]                        │
│ 1 byte   │ uint8     │ variable                              │
└──────────┴───────────┴───────────────────────────────────────┘
```

Each entity delta:

```
┌─────────────┬────────────────────┬──────────────────────────┐
│ entity_id   │ component_bitmask  │ component_data[]         │
│ uint16      │ uint8              │ only flagged components  │
└─────────────┴────────────────────┴──────────────────────────┘
```

`component_bitmask` has one bit per component (see bit assignments above). Component data follows in bit order — lowest bit first. Only components whose bit is set are present.

Example — entity #42 changed Position, Direction, NextWaypoint, and CurrentAction (bits 0, 1, 2, 3 = bitmask `0b00001111` = `0x0F`):

```
Bytes:  00 2A  0F  00 08  00 0A  02  00 08  00 0C  01
        ─────  ──  ─────────────  ──  ─────────────  ──
        id=42  mask pos(8,10)    dir  waypoint(8,12) action=WALKING
        2 B    1 B  4 bytes      1 B   4 bytes       1 byte
                                                     = 13 bytes total
```

**Entity Removal Section (tag 0x02)**

Entity left the client's viewport or was destroyed.

```
┌──────────┬───────────┬─────────────────────────┐
│ 0x02     │ count     │ entity_ids[]             │
│ 1 byte   │ uint8     │ count × uint16           │
└──────────┴───────────┴─────────────────────────┘
```

**Tile Update Section (tag 0x03)**

One or more tiles changed (building placed, terrain modified).

```
┌──────────┬───────────┬──────────────────────────┐
│ 0x03     │ count     │ tile_delta[]              │
│ 1 byte   │ uint8     │ variable                  │
└──────────┴───────────┴──────────────────────────┘
```

Each tile delta:

```
┌──────────┬──────────┬────────────────┬──────────────────────┐
│ tile_x   │ tile_y   │ field_bitmask  │ changed fields       │
│ uint16   │ uint16   │ uint8          │ only flagged fields   │
└──────────┴──────────┴────────────────┴──────────────────────┘
```

Tile field bits:

```
Bit 0: terrain       uint8
Bit 1: building      uint8
Bit 2: building_meta uint8 (rotation, variant, open/closed)
```

Example — wall placed at tile (30, 22):

```
Bytes:  00 1E  00 16  02  01
        ─────  ─────  ──  ──
        x=30   y=22  mask  building=WALL
        2 B    2 B   1 B   1 byte
                           = 6 bytes total
```

**ENTITY FULL STATE (0x11)**

Sent when an entity first enters the client's viewport, or on initial connection. Contains all networked components for that entity.

```
┌──────────┬─────────────┬────────────────────┬──────────────────┐
│ 0x11     │ entity_id   │ component_bitmask  │ all components   │
│ 1 byte   │ uint16      │ uint8              │ variable         │
└──────────┴─────────────┴────────────────────┴──────────────────┘
```

Identical format to an entity delta, except the bitmask has all present components flagged (not just changed ones). This gives the client a complete picture of the entity.

Also includes Speed (uint8) appended after the standard components when the entity has a movement speed.

**CHUNK (0x20)**

Terrain chunk data. Sent when a map chunk enters the client's visible range, or on initial connection.

```
┌──────────┬──────────┬──────────┬────────────────────────────────┐
│ 0x20     │ chunk_x  │ chunk_y  │ tile_data (RLE compressed)     │
│ 1 byte   │ uint8    │ uint8    │ variable                       │
└──────────┴──────────┴──────────┴────────────────────────────────┘
```

Chunks are 16×16 tiles. Tile data is three separate RLE-compressed channels concatenated: terrain (256 values), building (256 values), building_meta (256 values). Each channel is RLE encoded independently as `[count, value, count, value, ...]` sequences, each terminated by a count of 0.

---

## Map System

### Tile Representation

Each tile on the map contains:

```
terrain:       uint8    grass=0, dirt=1, rock=2, sand=3, water=4, river=5, ...
building:      uint8    none=0, wall=1, floor=2, door=3, fence=4, ...
building_meta: uint8    rotation (bits 0-1), variant (bits 2-4), state (bits 5-7)
```

Walkability is derived from terrain and building, not stored separately:

```
walkable = terrain not in (WATER, DEEP_WATER, ROCK_CLIFF)
           AND building in (NONE, FLOOR, OPEN_DOOR)
```

### Chunking

The world is divided into 16×16 tile chunks. The server tracks which chunks each client has loaded and sends new chunks as the client's viewport moves.

```
Map dimensions:      variable (e.g. 1024 × 1024 tiles)
Chunk size:          16 × 16 tiles
Chunk grid:          64 × 64 chunks (for a 1024² map)
Chunk raw size:      768 bytes (256 tiles × 3 bytes)
Chunk compressed:    ~50-200 bytes (RLE, typical natural terrain)
```

### Initial Load

On connect, the server sends chunks in the player's vicinity (e.g., 5×5 = 25 chunks). Approximately 2–5 KB compressed. Additional chunks are sent as the viewport moves.

### Live Tile Updates

When a tile changes (building placed, terrain modified), the server includes a tile delta in the next WORLD DELTA packet. Clients update their local chunk cache.

When a tile change affects walkability (wall placed on a walkable tile, door opened/closed), the server also handles consequences for entities whose paths pass through that tile — recalculating their paths and sending updated NextWaypoint / CurrentAction components in the same delta.

---

## Server Tick Loop

```
each tick (every 50ms at 20 Hz):
    1. Read all pending client ACTION messages
    2. Validate and apply actions:
       - MOVE_TO: pathfind, set Path + NextWaypoint + Direction + CurrentAction
       - INTERACT: check range, set CurrentAction
       - BUILD: check resources/legality, modify tile, set CurrentAction
       - CANCEL: clear Path, set NextWaypoint=NONE, set CurrentAction=IDLE
    3. Run movement system:
       - Advance entities along paths
       - At direction changes: update Position, Direction, NextWaypoint
       - At arrival: update Position, CurrentAction=IDLE, NextWaypoint=NONE
    4. Run game systems (health, harvesting, building progress, etc.)
    5. Build per-client delta:
       - Determine visibility (which entities/chunks each client can see)
       - For each client: collect dirty entities within their view
       - Encode delta using component bitmask format
       - Send WORLD DELTA packet
    6. Clear dirty flags
```

---

## Bandwidth Estimates

Assumptions: 50 players, 10–20 Hz tick rate, ~200 visible entities per client.

### Client → Server

```
Actions:         1-5 per second × 2-7 bytes       = 10-35 bytes/sec
Pings:           1 per second × 5 bytes            = 5 bytes/sec
Total upstream:  ~15-40 bytes/sec per client
```

### Server → Client

```
Moving entities (direction changes):
  ~5-15 updates/sec × ~13-19 bytes                = 100-250 bytes/sec

Stationary entity changes (health, status, etc.):
  ~1-5 updates/sec × ~5-8 bytes                   = 10-40 bytes/sec

Tile updates:
  ~0-2 per second × ~6 bytes                      = 0-12 bytes/sec

Delta framing overhead:
  1 opcode + 2 tick + section tags + end markers   = ~6-10 bytes/tick
  At 20 Hz: 120-200 bytes/sec

Total downstream: ~250-500 bytes/sec per client steady state
```

New chunk loads (viewport moving): ~100-200 bytes per chunk, burst.

---

## Complete Example: Player Clicks to Move

```
t=0ms      Player clicks tile (20, 15)
           Client shows cosmetic click indicator on tile (20, 15)
           Client sends: [0x01, 0x01, 0x00, 0x14, 0x00, 0x0F]
                          op   MOVE   tile_x=20    tile_y=15
                          (6 bytes)

t=50ms     Server receives ACTION
           Server validates: tile (20,15) is walkable and reachable
           Server runs A* from entity's position (5,10) to (20,15)
           Path result: (5,10)→(8,10)→(8,12)→(9,13)→(10,13)→...→(20,15)
           Server stores full path in Path component (server-only)
           Server sets:
             Position     = (5, 10)    (current, unchanged)
             Direction    = EAST (2)
             NextWaypoint = (8, 10)    (first direction change)
             CurrentAction = WALKING
           Server marks dirty: Direction, NextWaypoint, CurrentAction

t=65ms     Next server tick. Entity #42 included in delta:
           [entity_id=42, bitmask=0b00001110, dir=2, wp=(8,10), action=WALKING]
           (No Position sent — it hasn't changed yet)

t=115ms    Client receives delta
           Client removes click indicator
           Client sets entity #42:
             leg_start_pos = entity.position (5, 10)
             next_waypoint = (8, 10)
             direction = EAST
             leg_start_time = now
           Client begins rendering entity walking east

t=115ms+   Client renders entity smoothly lerping from (5,10) toward (8,10)
           No further network traffic while entity walks this straight segment

t=865ms    Server: entity #42 reaches (8, 10) in server simulation
           Server advances path, sets:
             Position     = (8, 10)
             Direction    = SOUTH (4)
             NextWaypoint = (8, 12)
           Server marks dirty: Position, Direction, NextWaypoint

t=915ms    Client receives delta with new position, direction, waypoint
           Client sets leg_start_pos = (8, 10), next_waypoint = (8, 12)
           Client begins rendering entity walking south
           (no stutter if delta arrived before client's local lerp reached (8,10))

           ...continues at each direction change...

t=5200ms   Server: entity #42 reaches final destination (20, 15)
           Server sets:
             Position      = (20, 15)
             Direction     = EAST (2)   (last heading)
             NextWaypoint  = NONE
             CurrentAction = IDLE
           Server marks dirty: Position, Direction, NextWaypoint, CurrentAction

t=5250ms   Client receives delta
           Client stops movement, renders entity standing at (20, 15)
```

---

## Future Extensions

These are not part of the current protocol but are natural extensions if needed.

**Lookahead waypoint.** Add a `WaypointAfter` component (bit 8) to eliminate stuttering at turns. The server sends the next-next waypoint so the client can continue through direction changes without waiting for the server.

**Sub-tile position.** Add `sub_x: uint8, sub_y: uint8` to the Position component for smoother rendering. Currently unnecessary because the client computes sub-tile position via lerp.

**Entity priority / update frequency.** The server could update distant or less important entities at a lower rate than nearby ones to save bandwidth.

**Batched building placement.** A RECT_UPDATE tile opcode for placing multi-tile structures in a single message.

**WebTransport migration.** Replace WebSocket with WebTransport to gain unreliable datagrams for position updates and multiplexed streams. Protocol format stays the same; only the transport changes.