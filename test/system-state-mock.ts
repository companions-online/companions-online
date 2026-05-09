/**
 * Test helpers for the bare SystemState mocks used by per-system tests
 * (pathfinding, movement-edge-cases, harvest, critter-ai).
 *
 * The unified action cooldown introduced `cooldowns` + `setCooldown` +
 * `clearCooldown` on SystemState. Tests that hand-roll a mock instead of
 * using `GameWorld` need this shape, plus a tick helper to simulate the
 * top-of-`runTick` decrement (since they call `runMovement` / `runHarvest`
 * directly, bypassing `GameWorld.runTick`).
 */

/** Attach the cooldown trio to a bare mock. Returns the same object. */
export function attachCooldowns<T extends object>(w: T): T & {
  cooldowns: Map<number, number>;
  setCooldown(eid: number, ticks: number): void;
  clearCooldown(eid: number): void;
} {
  const cooldowns = new Map<number, number>();
  return Object.assign(w, {
    cooldowns,
    setCooldown(eid: number, ticks: number) {
      const cur = cooldowns.get(eid) ?? 0;
      if (ticks > cur) cooldowns.set(eid, ticks);
    },
    clearCooldown(eid: number) {
      cooldowns.delete(eid);
    },
  });
}

/** Mirror the top-of-tick decrement loop in `GameWorld.runTick`. Tests that
 *  drive a system tick-by-tick must call this before each system step so
 *  cooldowns elapse. */
export function tickCooldowns(world: { cooldowns: Map<number, number> }): void {
  for (const [eid, ticks] of world.cooldowns) {
    if (ticks <= 1) world.cooldowns.delete(eid);
    else world.cooldowns.set(eid, ticks - 1);
  }
}
