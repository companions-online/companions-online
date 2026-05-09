/**
 * Cross-action gating for the unified cooldown.
 *
 * Two cases — one validates UX responsiveness, one closes a movement-rate
 * exploit that the responsive path would otherwise open up:
 *
 * 1. Channel-phase harvest cancel clears the entity cooldown, so switching
 *    to a different action (combat / movement) is immediately responsive.
 *    Without this, a player canceling a tree harvest mid-channel would see
 *    the avatar jog in place for up to ~1s of leftover tickCost residue.
 *
 * 2. Pathfinding-phase harvest cancel preserves the cooldown, because
 *    during walk-to-target the cooldown on the entity is the runMovement
 *    post-step residue, not harvest's own. Clearing it would let the
 *    Harvest(far) ↔ MoveTo alternation step at ~10 tiles/sec instead of
 *    the player's `speed` (~3 tiles/sec) — pure macro exploit.
 */

import { describe, it, expect } from 'vitest';
import { ClientAction } from '@shared/actions.js';
import { TICK_RATE } from '@shared/constants.js';
import { BlueprintType, getBlueprint } from '@shared/blueprints.js';
import { createTestWorld, addTestPlayer, placeTree } from './e2e/helpers.js';
import { spawnCreatureEntity } from '../server/src/entity-spawn.js';

describe('Cross-action cooldown gating', () => {
  it('channel-phase harvest cancel clears cd → first swing on adjacent target lands immediately', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 10, 10);
    placeTree(world, 11, 10);
    // Deer placed adjacent to the player so the swing isn't gated by chase
    // — the only thing that could gate it is leftover harvest cd.
    const deer = spawnCreatureEntity(world, BlueprintType.Deer, 10, 11);
    const initialDeerHp = world.entities.health.get(deer)!.currentHp;

    // Start a bare-handed tree harvest. Adjacent → channel phase from tick 1.
    world.setAction(player, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    world.runTick();
    expect(world.harvestStates.get(player)?.pathfinding).toBe(false);
    expect((world.cooldowns.get(player) ?? 0)).toBeGreaterThan(0);

    // Sit a few ticks in the channel so cd has decremented to a clearly
    // non-zero mid-value.
    world.runTicks(3);

    // Switch to attacking the adjacent deer. cancelHarvest fires; channel
    // phase, so cd is cleared. startAttack registers combat state without
    // writing cd. runCombat sees adjacent + cd=0 → swing this same tick.
    world.setAction(player, { action: ClientAction.Attack, entityId: deer });
    world.runTick();

    expect(world.combatStates.has(player)).toBe(true);
    expect(world.harvestStates.has(player)).toBe(false);
    // Damage actually landed — the harvest cd residue did not block the swing.
    expect(world.entities.health.get(deer)!.currentHp).toBeLessThan(initialDeerHp);
  });

  it('pathfinding-phase harvest cancel preserves cd → step rate stays bounded under Harvest↔MoveTo alternation', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 50, 50);
    // Tree far enough away that startHarvest enters the pathfinding phase.
    placeTree(world, 60, 50);

    const speed = getBlueprint(BlueprintType.Player)!.speed!;
    const stepTicks = Math.max(1, Math.round(TICK_RATE / speed));
    const ticks = 60;

    // Hostile alternation: every odd tick send Harvest(far), every even
    // tick send MoveTo east. Each MoveTo cancels the harvest. If
    // cancelHarvest cleared cd unconditionally, this would step every
    // other tick (~10 tiles/sec); with the pathfinding guard the residue
    // from runMovement's post-step write survives the cancel and the
    // step rate stays at 1 / stepTicks.
    for (let i = 0; i < ticks; i++) {
      const pos = world.entities.position.get(player)!;
      if (i % 2 === 0) {
        world.setAction(player, { action: ClientAction.Harvest, tileX: 60, tileY: 50 });
      } else {
        world.setAction(player, {
          action: ClientAction.MoveTo,
          tileX: pos.tileX + 1,
          tileY: pos.tileY,
        });
      }
      world.runTick();
    }

    const tilesAdvanced = world.entities.position.get(player)!.tileX - 50;
    const expected = Math.floor(ticks / stepTicks);
    // Allow ±2 of slack — startup cost of the first cycle, off-by-one near
    // the rate boundary, etc.
    expect(tilesAdvanced).toBeLessThanOrEqual(expected + 2);
    // Critically: nowhere near ticks/2 (the exploit ceiling).
    expect(tilesAdvanced).toBeLessThan(ticks / 2);
  });
});
