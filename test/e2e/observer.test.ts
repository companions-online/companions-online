import { describe, it, expect } from 'vitest';
import { ClientAction } from '../../shared/src/actions.js';
import { MetaKey } from '../../shared/src/entity-meta.js';
import { INTEREST_RANGE } from '../../shared/src/constants.js';
import { HeadlessConnection } from '../../server/src/connections/headless-connection.js';
import { createTestWorld, addTestPlayer, placeTree, expectCleanLog } from './helpers.js';

describe('GameWorld observer mode', () => {
  it('addObserver registers a slot, streams initial chunks, fires onInitialState', () => {
    const world = createTestWorld();
    const conn = new HeadlessConnection();
    const oid = world.addObserver(conn, 64, 64);

    expect(oid).toBeLessThan(0); // observer ids live in negative space
    expect(world.observers.size).toBe(1);
    const slot = world.observers.get(oid)!;
    expect(slot.focusX).toBe(64);
    expect(slot.focusY).toBe(64);
    // Initial chunks for INTEREST_RANGE around (64,64) at CHUNK_SIZE=16 →
    // at least the tile's own chunk plus its neighbors.
    expect(slot.sentChunks.size).toBeGreaterThan(0);
    // entityId=0 is the observer-channel sentinel.
    expect(conn.events.find(e => e.type === 'init')?.entityId).toBe(0);
    expectCleanLog(world);
  });

  it('first tick delivers nearby entities via the entered channel', () => {
    const world = createTestWorld();
    const conn = new HeadlessConnection();
    world.addObserver(conn, 64, 64);
    const treeEid = placeTree(world, 64, 64);

    world.runTick();

    const tick = conn.events.find(e => e.type === 'tick');
    expect(tick).toBeDefined();
    expect(tick!.data!.entered).toContain(treeEid);
  });

  it('does not deliver entities outside INTEREST_RANGE of focus', () => {
    const world = createTestWorld();
    const conn = new HeadlessConnection();
    world.addObserver(conn, 120, 120);
    placeTree(world, 5, 5); // very far from focus

    world.runTick();

    const tick = conn.events.find(e => e.type === 'tick');
    // Either no tick at all (empty delta) or the entered list excludes the tree.
    if (tick) expect(tick.data!.entered.length).toBe(0);
  });

  it('observer is invisible to other players (no entity to enter their view)', () => {
    const world = createTestWorld();
    const { connection: playerConn } = addTestPlayer(world, 64, 64);
    world.addObserver(new HeadlessConnection(), 64, 64);
    const baselineEvents = playerConn.events.length;

    world.runTick();

    // The player's own tick may fire (e.g. for environment) but no observer
    // entity should ever land in `entered` — observers have no entity.
    for (const ev of playerConn.events.slice(baselineEvents)) {
      if (ev.type !== 'tick' || !ev.data) continue;
      for (const entered of ev.data.entered) {
        expect(entered).toBeGreaterThan(0); // entities are positive-id only
      }
    }
  });

  it('broadcastEvent is range-gated by observer focus', () => {
    const world = createTestWorld();
    const nearConn = new HeadlessConnection();
    const farConn = new HeadlessConnection();
    world.addObserver(nearConn, 60, 60);
    world.addObserver(farConn, 200, 200);

    // Hand-fire a broadcast at (60,60); near observer is in range, far isn't.
    const event = world.makeEvent('entity_died', {
      entityId: 999, entityName: 'Test', tileX: 60, tileY: 60,
      killerEntityId: 0, killerName: undefined,
    });
    world.broadcastEvent(60, 60, event);

    expect(nearConn.broadcastEvents.some(e => e.type === 'entity_died')).toBe(true);
    expect(farConn.broadcastEvents.some(e => e.type === 'entity_died')).toBe(false);
  });

  it('setObserverFocus streams chunks for the new focus on next tick', () => {
    const world = createTestWorld();
    const conn = new HeadlessConnection();
    const oid = world.addObserver(conn, 16, 16); // top-left area
    const slot = world.observers.get(oid)!;
    const initialChunks = new Set(slot.sentChunks);

    world.setObserverFocus(oid, 100, 100); // far away
    world.runTick();

    // New chunks added; initial ones still present (we only ever grow this
    // set today — eviction lives client-side).
    expect(slot.sentChunks.size).toBeGreaterThan(initialChunks.size);
    for (const k of initialChunks) expect(slot.sentChunks.has(k)).toBe(true);
  });

  it('removeObserver stops further deliveries', () => {
    const world = createTestWorld();
    const conn = new HeadlessConnection();
    const oid = world.addObserver(conn, 64, 64);
    placeTree(world, 64, 64);
    world.runTick();
    const before = conn.events.length;

    world.removeObserver(oid);
    expect(world.observers.size).toBe(0);

    placeTree(world, 65, 64);
    world.runTick();
    expect(conn.events.length).toBe(before);
  });

  it('Say chat messages deliver to observers in range', () => {
    const world = createTestWorld();
    const { entityId: speaker } = addTestPlayer(world, 64, 64);
    const obsConn = new HeadlessConnection();
    world.addObserver(obsConn, 64, 64);

    world.setAction(speaker, { action: ClientAction.Say, message: 'hello' });
    world.runTick();

    const chat = obsConn.events.find(e => e.type === 'chatMessage');
    expect(chat).toBeDefined();
    expect(chat!.chatMessage).toBe('hello');
    expect(chat!.senderEntityId).toBe(speaker);
  });

  it('Say chat does not reach observers outside INTEREST_RANGE', () => {
    const world = createTestWorld();
    const { entityId: speaker } = addTestPlayer(world, 64, 64);
    const farObs = new HeadlessConnection();
    world.addObserver(farObs, 64 + INTEREST_RANGE + 5, 64);

    world.setAction(speaker, { action: ClientAction.Say, message: 'hello' });
    world.runTick();

    expect(farObs.events.find(e => e.type === 'chatMessage')).toBeUndefined();
  });

  it('setEntityMeta broadcasts nameplate changes to observers in range', () => {
    const world = createTestWorld();
    const { entityId: player } = addTestPlayer(world, 64, 64);
    const conn = new HeadlessConnection();
    world.addObserver(conn, 64, 64);

    world.setEntityMeta(player, MetaKey.Name, 'Alice');

    const meta = conn.events.find(
      e => e.type === 'entityMeta'
        && e.targetEntityId === player
        && e.metaValue === 'Alice',
    );
    expect(meta).toBeDefined();
  });
});
