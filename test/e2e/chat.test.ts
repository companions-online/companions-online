import { describe, it, expect } from 'vitest';
import { createTestWorld, addTestPlayer, placeTree } from './helpers.js';
import { ClientAction } from '@shared/actions.js';

describe('E2E: Chat', () => {
  it('player says message, nearby player receives it', () => {
    const world = createTestWorld();
    const { entityId: p1, connection: c1 } = addTestPlayer(world, 10, 10);
    const { entityId: p2, connection: c2 } = addTestPlayer(world, 12, 10);
    world.entities.clearDirty();

    world.setAction(p1, { action: ClientAction.Say, message: 'hello world' });
    world.runTicks(1);

    const chatEvents1 = c1.events.filter(e => e.type === 'chatMessage');
    expect(chatEvents1.length).toBe(1);
    expect(chatEvents1[0].chatMessage).toBe('hello world');
    expect(chatEvents1[0].senderEntityId).toBe(p1);

    const chatEvents2 = c2.events.filter(e => e.type === 'chatMessage');
    expect(chatEvents2.length).toBe(1);
    expect(chatEvents2[0].chatMessage).toBe('hello world');
    expect(chatEvents2[0].senderEntityId).toBe(p1);
  });

  it('player says message, far player does not receive it', () => {
    const world = createTestWorld();
    const { entityId: p1 } = addTestPlayer(world, 10, 10);
    const { connection: c3 } = addTestPlayer(world, 60, 60); // far away
    world.entities.clearDirty();

    world.setAction(p1, { action: ClientAction.Say, message: 'hello' });
    world.runTicks(1);

    const chatEvents = c3.events.filter(e => e.type === 'chatMessage');
    expect(chatEvents.length).toBe(0);
  });

  it('say does not cancel harvesting', () => {
    const world = createTestWorld();
    const { entityId: p1 } = addTestPlayer(world, 10, 10);
    const treeEid = placeTree(world, 11, 10);
    world.entities.clearDirty();

    // Start harvesting the tree
    world.setAction(p1, { action: ClientAction.Harvest, tileX: 11, tileY: 10 });
    world.runTicks(1);

    // Verify harvest is active
    const actionBefore = world.entities.currentAction.get(p1);
    expect(actionBefore?.actionType).toBe(0x04); // ActionType.Harvesting

    // Say something while harvesting
    world.setAction(p1, { action: ClientAction.Say, message: 'still chopping' });
    world.runTicks(1);

    // Verify harvest is still active
    const actionAfter = world.entities.currentAction.get(p1);
    expect(actionAfter?.actionType).toBe(0x04); // ActionType.Harvesting
  });

  it('message is truncated to 200 characters', () => {
    const world = createTestWorld();
    const { entityId: p1 } = addTestPlayer(world, 10, 10);
    const { connection: c2 } = addTestPlayer(world, 12, 10);
    world.entities.clearDirty();

    const longMessage = 'a'.repeat(300);
    world.setAction(p1, { action: ClientAction.Say, message: longMessage });
    world.runTicks(1);

    const chatEvents = c2.events.filter(e => e.type === 'chatMessage');
    expect(chatEvents.length).toBe(1);
    expect(chatEvents[0].chatMessage!.length).toBe(200);
  });
});
