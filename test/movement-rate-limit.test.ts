/**
 * Regression test for the movement super-speed exploit (WASD slide /
 * adjacent click-spam). Before the unified cooldown, every MoveTo created a
 * fresh MovementState with cooldownRemaining=0, and 1-tile paths destroyed
 * the moveState before the cooldown could persist — so re-issuing MoveTo
 * every tick let the player step at TICK_RATE (20 tiles/sec) instead of
 * `speed` (3 tiles/sec for the player).
 *
 * The unified entity cooldown survives the moveState's lifecycle and rate-
 * limits step commits regardless of how often setMoveTarget is called.
 */

import { describe, it, expect } from 'vitest';
import { ClientAction } from '@shared/actions.js';
import { TICK_RATE } from '@shared/constants.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { createTestWorld, addTestPlayer } from './e2e/helpers.js';

describe('Movement rate limit (unified cooldown)', () => {
  it('re-issuing 1-tile MoveTo every tick advances at speed, not at TICK_RATE', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 50, 50);

    const speed = getBlueprint(BlueprintType.Player)!.speed!;
    const stepTicks = Math.max(1, Math.round(TICK_RATE / speed));
    const ticks = 200;

    let lastX = 50;
    for (let i = 0; i < ticks; i++) {
      // Re-issue MoveTo to the tile one east of current position every tick.
      // This is the WASD-cycle / click-spam shape that exploits the old
      // per-state cooldown.
      const pos = world.entities.position.get(player)!;
      world.setAction(player, {
        action: ClientAction.MoveTo,
        tileX: pos.tileX + 1,
        tileY: pos.tileY,
      });
      world.runTick();
      lastX = world.entities.position.get(player)!.tileX;
    }

    const tilesAdvanced = lastX - 50;
    // At speed=3, stepTicks=7, expect ~28 tiles in 200 ticks. Allow ±1 for
    // the off-by-one near the start tick.
    const expected = Math.floor(ticks / stepTicks);
    expect(tilesAdvanced).toBeGreaterThanOrEqual(expected - 1);
    expect(tilesAdvanced).toBeLessThanOrEqual(expected + 1);
    // Critically: nowhere near TICK_RATE — that would be the bug.
    expect(tilesAdvanced).toBeLessThan(ticks / 2);
  });
});
