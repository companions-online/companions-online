/** Bitmask values for active status effects */
export const enum StatusEffect {
  Poisoned = 1 << 0,
  Slowed   = 1 << 1,
  Hasted   = 1 << 2,
  Stunned  = 1 << 3,
  Open     = 1 << 4,
  /** Set on any entity that represents a placed structure (via UseItemAt or
   *  worldgen). Absence means the entity is a ground item — distinguishes
   *  dropped-from-inventory placeables from installed ones. */
  Placed   = 1 << 5,
}

/** True iff `se` has the Placed bit. Canonical check for placed-structure vs
 *  ground-item classifiers (MCP formatter, cursor context, renderer). */
export function isPlaced(se?: { effects: number }): boolean {
  return ((se?.effects ?? 0) & StatusEffect.Placed) !== 0;
}
