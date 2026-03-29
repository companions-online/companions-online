/** Bitmask values for active status effects */
export const enum StatusEffect {
  Poisoned = 1 << 0,
  Slowed   = 1 << 1,
  Hasted   = 1 << 2,
  Stunned  = 1 << 3,
}
