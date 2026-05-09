/**
 * Cross-action gating test. The unified cooldown means that switching from
 * one time-taking action to another preserves rate residue across the
 * switch. Concretely: a harvest mid-channel writes cd=tickCost, and
 * switching to Attack on a different target cancels the harvest but does
 * not clear cd — so the first swing has to wait for the harvest's residual
 * cooldown to elapse before it can land.
 */

import { describe, it, expect } from 'vitest';
import { ClientAction } from '@shared/actions.js';
import { BlueprintType } from '@shared/blueprints.js';
import { createTestWorld, addTestPlayer, placeTree } from './e2e/helpers.js';
import { spawnCreatureEntity } from '../server/src/entity-spawn.js';

describe('Cross-action cooldown gating', () => {
  it('attack mid-harvest waits for the harvest cooldown residue before swinging', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);
    placeTree(world, 11, 10);
    // Spawn a deer two tiles south of the player. Far enough that the
    // attack chase will need movement steps.
    const deer = spawnCreatureEntity(world, BlueprintType.Deer, 10, 12);
    const initialDeerHp = world.entities.health.get(deer)!.currentHp;

    // Equip nothing — bare-handed tree harvest is the slowest channel
    // (10 × ACTION_BASE_TICKS = 20 ticks until first yield), giving us a
    // generous cooldown window to assert against.
    world.setAction(player, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    world.runTick(); // start harvest, cd written

    // Burn a few channel ticks so cd is mid-flight when we switch.
    world.runTicks(5);

    const cdBeforeSwitch = world.cooldowns.get(player) ?? 0;
    expect(cdBeforeSwitch).toBeGreaterThan(0);

    // Switch to attacking the deer. cancelConflictingStates cancels the
    // harvest but does NOT clear cd.
    world.setAction(player, { action: ClientAction.Attack, entityId: deer });
    world.runTick();

    // Combat state is registered immediately.
    expect(world.combatStates.has(player)).toBe(true);
    // Harvest state is gone.
    expect(world.harvestStates.has(player)).toBe(false);
    // No swing has landed yet — the cd residue from the harvest is still
    // ticking down (and the player isn't even adjacent to the deer yet).
    expect(world.entities.health.get(deer)!.currentHp).toBe(initialDeerHp);
  });
});
