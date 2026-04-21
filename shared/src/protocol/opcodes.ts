/** Client → Server opcodes */
export const enum ClientOpcode {
  Action = 0x01,
  Ping   = 0x02,
}

/** Server → Client opcodes */
export const enum ServerOpcode {
  Pong            = 0x02,
  WorldDelta      = 0x10,
  EntityFullState = 0x11,
  Chunk           = 0x20,
  Welcome         = 0x30,
  InventorySync   = 0x31,
  ContainerOpen   = 0x32,
  DialogueOpen    = 0x33,
  ChatMessage     = 0x34,
  EnvironmentSync = 0x35,
  EntityMeta      = 0x36,
  GameEvents      = 0x37,
}

/** Discrete-happening notifications delivered in a GameEvents batch. Numeric
 *  subset of the server-side GameEventType string union; MCP-only events
 *  (trades, consume, action_interrupted, etc.) do not appear on the wire. */
export const enum WireEventType {
  CombatHitDealt = 0x01,
  HarvestYield   = 0x02,
  CraftComplete  = 0x03,
  EntityDied     = 0x04,
  PlayerHealed   = 0x05,
}

/** Section tags within a WorldDelta message */
export const enum DeltaSectionTag {
  End            = 0x00,
  EntityUpdates  = 0x01,
  EntityRemovals = 0x02,
  TileUpdates    = 0x03,
  Environment    = 0x04,
}

/** Bit indices for tile fields in tile delta bitmask */
export const enum TileFieldBit {
  Terrain      = 0,
  Building     = 1,
  BuildingMeta = 2,
}
