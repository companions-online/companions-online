/**
 * cancelConsume must clear the unified cooldown. Without this, cancelling
 * a Bandage (consumeTicks=10, ~500ms) mid-channel would leave the player
 * frozen for the rest of the channel before any next action could commit.
 *
 * This is the explicit user-spec point: consume's cd represents the
 * in-flight channel (no commit yet), so cancelling drops it.
 */

import { describe, it, expect } from 'vitest';
import { ClientAction } from '@shared/actions.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { TICK_RATE } from '@shared/constants.js';
import { createTestWorld, addTestPlayer } from './e2e/helpers.js';

describe('Consume cancel clears cooldown', () => {
  it('cancelling a Bandage mid-channel drops cd and lets movement step immediately', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);

    world.entities.health.set(player, { currentHp: 50, maxHp: 100 });
    world.inventoryMgr.addItem(player, BlueprintType.Bandage, 1);
    const inv = world.inventoryMgr.get(player)!;
    const bandage = inv.items.find(i => i.blueprintId === BlueprintType.Bandage)!;

    // Start the bandage channel. Consume cd is consumeTicks - 1 = 9.
    world.setAction(player, { action: ClientAction.UseConsumable, itemId: bandage.itemId });
    world.runTick();
    expect(world.consumableStates.has(player)).toBe(true);
    expect(world.cooldowns.get(player) ?? 0).toBeGreaterThan(0);

    // 3 ticks in: cd should be ~5 (started at 9, decremented 3 times after
    // the start tick). Plenty of cd left.
    world.runTicks(3);
    const cdMidChannel = world.cooldowns.get(player) ?? 0;
    expect(cdMidChannel).toBeGreaterThan(0);

    // Switch to MoveTo. cancelConflictingStates calls cancelConsume, which
    // (per the new spec) clears cd. The consumable state is gone too.
    world.setAction(player, {
      action: ClientAction.MoveTo,
      tileX: 12,
      tileY: 10,
    });
    world.runTick();

    expect(world.consumableStates.has(player)).toBe(false);
    // cd may have been re-armed by the movement step that just landed.
    // What matters is that the player actually moved — i.e. movement was
    // not gated by the bandage's residue. Player should now be at (11, 10)
    // (one step toward (12, 10)).
    const speed = getBlueprint(BlueprintType.Player)!.speed!;
    const stepTicks = Math.max(1, Math.round(TICK_RATE / speed));
    const cdAfterStep = world.cooldowns.get(player) ?? 0;
    // The freshly-written cd is the step-pacing residue, bounded by stepTicks.
    expect(cdAfterStep).toBeLessThanOrEqual(stepTicks);
    // And critically, far less than the bandage's ~5-tick residue would have left.
    expect(cdAfterStep).toBeLessThan(cdMidChannel + stepTicks);
    // The HP didn't change — heal never committed.
    expect(world.entities.health.get(player)!.currentHp).toBe(50);
    // The bandage is still in inventory — we didn't consume it.
    const invAfter = world.inventoryMgr.get(player)!;
    expect(invAfter.items.find(i => i.blueprintId === BlueprintType.Bandage)).toBeDefined();
  });
});
