import { describe, it, expect, beforeEach } from 'vitest';
import { createTestWorld, addTestPlayer } from './helpers.js';
import { GameWorld } from '../../server/src/game-world.js';
import { ClientAction } from '../../shared/src/actions.js';
import { BlueprintType } from '../../shared/src/blueprints.js';
import type { GameEventType } from '../../server/src/events.js';

describe('broadcastEvent scope', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = createTestWorld();
  });

  it('combat_hit_dealt broadcasts to the attacker and nearby spectators, not far-away players', () => {
    const { entityId: attackerId, connection: attackerConn } = addTestPlayer(world, 10, 10);
    const { connection: nearConn } = addTestPlayer(world, 15, 10);       // 5 tiles away (in range)
    const { connection: farConn }  = addTestPlayer(world, 100, 10);      // 90 tiles away (out of range)

    const deerEid = world.entities.create();
    world.entities.position.set(deerEid, { tileX: 11, tileY: 10 });
    world.entities.blueprint.set(deerEid, { blueprintId: BlueprintType.Deer, variant: 0 });
    world.entities.health.set(deerEid, { currentHp: 3, maxHp: 12 });
    world.entities.currentAction.set(deerEid, { actionType: 0 });
    world.occupancy.set(11, 10, deerEid);

    world.setAction(attackerId, { action: ClientAction.Attack, entityId: deerEid });
    world.runTicks(20);

    const broadcastType: GameEventType = 'combat_hit_dealt';
    expect(attackerConn.broadcastEvents.some(e => e.type === broadcastType)).toBe(true);
    expect(nearConn.broadcastEvents.some(e => e.type === broadcastType)).toBe(true);
    expect(farConn.broadcastEvents.some(e => e.type === broadcastType)).toBe(false);
  });

  it('entity_died broadcasts to everyone in range of the death position', () => {
    const { entityId: attackerId, connection: attackerConn } = addTestPlayer(world, 10, 10);
    const { connection: nearConn } = addTestPlayer(world, 12, 12);
    const { connection: farConn }  = addTestPlayer(world, 200, 200);

    const deerEid = world.entities.create();
    world.entities.position.set(deerEid, { tileX: 11, tileY: 10 });
    world.entities.blueprint.set(deerEid, { blueprintId: BlueprintType.Deer, variant: 0 });
    world.entities.health.set(deerEid, { currentHp: 1, maxHp: 12 });
    world.entities.currentAction.set(deerEid, { actionType: 0 });
    world.occupancy.set(11, 10, deerEid);

    world.setAction(attackerId, { action: ClientAction.Attack, entityId: deerEid });
    world.runTicks(20);

    expect(attackerConn.broadcastEvents.some(e => e.type === 'entity_died')).toBe(true);
    expect(nearConn.broadcastEvents.some(e => e.type === 'entity_died')).toBe(true);
    expect(farConn.broadcastEvents.some(e => e.type === 'entity_died')).toBe(false);
  });

  it('MCP-only point-to-point events (combat_hit_received) do not appear on the broadcast channel', () => {
    const { connection: targetConn } = addTestPlayer(world, 10, 10);

    const wolfEid = world.entities.create();
    world.entities.position.set(wolfEid, { tileX: 11, tileY: 10 });
    world.entities.blueprint.set(wolfEid, { blueprintId: BlueprintType.Wolf, variant: 0 });
    world.entities.health.set(wolfEid, { currentHp: 20, maxHp: 20 });
    world.entities.currentAction.set(wolfEid, { actionType: 0 });
    world.entities.statusEffects.set(wolfEid, { effects: 0 });
    world.entities.speed.set(wolfEid, 4);
    world.occupancy.set(11, 10, wolfEid);
    world.critterStates.set(wolfEid, { idleTicksRemaining: 0, rng: 42, behavior: 'wander' });

    world.runTicks(40);

    // Target received the hit via point-to-point (gameEvents), NOT via broadcast.
    expect(targetConn.gameEvents.some(e => e.type === 'combat_hit_received')).toBe(true);
    expect(targetConn.broadcastEvents.some(e => e.type === 'combat_hit_received')).toBe(false);
  });
});
