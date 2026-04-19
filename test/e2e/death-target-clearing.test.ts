import { describe, it, expect, beforeEach } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { GameWorld } from '../../server/src/game-world.js';
import { BlueprintType } from '../../shared/src/blueprints.js';
import { ActionType } from '../../shared/src/actions.js';

describe('AI target clearing on death', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = createTestWorld();
  });

  it('wolf drops its target when the player it was attacking dies', () => {
    const { entityId: playerId } = addTestPlayer(world, 10, 10);
    // Low HP so the wolf kills them quickly.
    world.entities.health.set(playerId, { currentHp: 2, maxHp: 100 });

    const wolfEid = world.entities.create();
    world.entities.position.set(wolfEid, { tileX: 11, tileY: 10 });
    world.entities.blueprint.set(wolfEid, { blueprintId: BlueprintType.Wolf, variant: 0 });
    world.entities.health.set(wolfEid, { currentHp: 20, maxHp: 20 });
    world.entities.currentAction.set(wolfEid, { actionType: ActionType.Idle });
    world.entities.statusEffects.set(wolfEid, { effects: 0 });
    world.entities.speed.set(wolfEid, 4);
    world.occupancy.set(11, 10, wolfEid);
    world.critterStates.set(wolfEid, { idleTicksRemaining: 0, rng: 42, behavior: 'wander' });

    // Run long enough for the wolf to aggro, kill, and the cleanup to happen.
    world.runTicks(60);

    expect(world.entities.currentAction.get(playerId)?.actionType).toBe(ActionType.Dead);

    const wolfState = world.critterStates.get(wolfEid);
    expect(wolfState?.behavior).toBe('wander');
    expect(wolfState?.targetEntityId).toBeUndefined();

    expect(world.combatStates.has(wolfEid)).toBe(false);
  });
});
