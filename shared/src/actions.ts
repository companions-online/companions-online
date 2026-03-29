/** What an entity is currently doing (server state, synced to clients) */
export const enum ActionType {
  Idle        = 0x00,
  Walking     = 0x01,
  Interacting = 0x02,
  Building    = 0x03,
  Harvesting  = 0x04,
  Dead        = 0x05,
}

/** What the client sends as player intent */
export const enum ClientAction {
  Cancel   = 0x00,
  MoveTo   = 0x01,
  Interact = 0x02,
  Build    = 0x03,
}
