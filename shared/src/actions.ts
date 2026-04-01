/** What an entity is currently doing (server state, synced to clients) */
export const enum ActionType {
  Idle        = 0x00,
  Walking     = 0x01,
  Interacting = 0x02,
  Building    = 0x03,
  Harvesting  = 0x04,
  Dead        = 0x05,
  PickingUp   = 0x06,
  Crafting    = 0x07,
  Attacking   = 0x08,
}

/** What the client sends as player intent */
export const enum ClientAction {
  Cancel   = 0x00,
  MoveTo   = 0x01,
  Interact = 0x02,
  Build    = 0x03,
  Pickup   = 0x04,
  Equip    = 0x05,
  Unequip  = 0x06,
  Drop     = 0x07,
  Craft      = 0x08,
  Harvest    = 0x09,
  UseItemAt  = 0x0A,
  Attack          = 0x0B,
  Transfer        = 0x0C,
  DialogueSelect  = 0x0D,
  Trade           = 0x0E,
}
