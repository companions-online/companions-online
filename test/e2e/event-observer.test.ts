import { describe, it, expect, beforeEach } from 'vitest';
import { createTestWorld, addTestPlayer, placeTree } from './helpers.js';
import { GameWorld } from '../../server/src/game-world.js';
import { ClientAction } from '../../shared/src/actions.js';
import { BlueprintType } from '../../shared/src/blueprints.js';
import type { GameEvent } from '../../server/src/events.js';

describe('GameWorld.setEventObserver', () => {
  let world: GameWorld;

  beforeEach(() => {
    world = createTestWorld();
  });

  it('fires for both emit and broadcast channels on harvest', () => {
    const observed: { eid: number; type: string; channel: 'emit' | 'broadcast' }[] = [];
    world.setEventObserver((eid, ev, channel) => {
      observed.push({ eid, type: ev.type, channel });
    });

    const { entityId: harvester } = addTestPlayer(world, 10, 10);
    // Add a second player nearby to receive the broadcast.
    const { entityId: bystander } = addTestPlayer(world, 12, 10);

    world.inventoryMgr.addItem(harvester, BlueprintType.Axe, 1);
    const inv = world.inventoryMgr.get(harvester)!;
    const axe = inv.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    world.inventoryMgr.equip(harvester, axe.itemId);

    placeTree(world, 11, 10);

    world.setAction(harvester, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    world.runTicks(200);

    const yields = observed.filter(e => e.type === 'harvest_yield');
    // emit (harvester sees yield first-person)
    expect(yields.some(e => e.channel === 'emit' && e.eid === harvester)).toBe(true);
    // broadcast (bystander gets the same yield via spectator channel)
    expect(yields.some(e => e.channel === 'broadcast' && e.eid === bystander)).toBe(true);
  });

  it('observer that throws does not break the tick loop', () => {
    world.setEventObserver(() => { throw new Error('boom'); });

    const { entityId } = addTestPlayer(world, 10, 10);
    world.inventoryMgr.addItem(entityId, BlueprintType.Axe, 1);
    const inv = world.inventoryMgr.get(entityId)!;
    const axe = inv.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    world.inventoryMgr.equip(entityId, axe.itemId);
    placeTree(world, 11, 10);

    world.setAction(entityId, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    expect(() => world.runTicks(200)).not.toThrow();
  });

  it('default observer is a no-op (no setObserver call required)', () => {
    const { entityId } = addTestPlayer(world, 10, 10);
    world.inventoryMgr.addItem(entityId, BlueprintType.Axe, 1);
    const inv = world.inventoryMgr.get(entityId)!;
    const axe = inv.items.find(i => i.blueprintId === BlueprintType.Axe)!;
    world.inventoryMgr.equip(entityId, axe.itemId);
    placeTree(world, 11, 10);

    world.setAction(entityId, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    expect(() => world.runTicks(200)).not.toThrow();
  });
});
