import { describe, it, expect } from 'vitest';
import { ClientAction } from '../../shared/src/actions.js';
import { MetaKey } from '../../shared/src/entity-meta.js';
import { createTestWorld, addTestPlayer } from './helpers.js';

describe('server commands', () => {
  describe('/nick', () => {
    it('accepts a valid nick and stores it in entityMeta', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'elsyian',
      });
      world.runTick();

      expect(world.getEntityMeta(entityId, MetaKey.Name)).toBe('elsyian');
      // Self gets onEntityMeta too.
      const metaEvents = connection.events.filter(e => e.type === 'entityMeta');
      expect(metaEvents).toHaveLength(1);
      expect(metaEvents[0].targetEntityId).toBe(entityId);
      expect(metaEvents[0].metaKey).toBe(MetaKey.Name);
      expect(metaEvents[0].metaValue).toBe('elsyian');
    });

    it('aliases /name to /nick', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'name', parameter: 'ely',
      });
      world.runTick();

      expect(world.getEntityMeta(entityId, MetaKey.Name)).toBe('ely');
    });

    it('trims surrounding whitespace', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: '  foo  ',
      });
      world.runTick();

      expect(world.getEntityMeta(entityId, MetaKey.Name)).toBe('foo');
    });

    it('rejects nick with disallowed chars via system chat', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'has space',
      });
      world.runTick();

      expect(world.getEntityMeta(entityId, MetaKey.Name)).toBe('Player');
      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat?.chatMessage).toMatch(/letters, digits/);
    });

    it('rejects too-long nick', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'a'.repeat(17),
      });
      world.runTick();

      expect(world.getEntityMeta(entityId, MetaKey.Name)).toBe('Player');
      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat?.chatMessage).toMatch(/1-16 characters/);
    });

    it('rejects empty nick', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: '',
      });
      world.runTick();

      expect(world.getEntityMeta(entityId, MetaKey.Name)).toBe('Player');
      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat).toBeDefined();
    });
  });

  describe('unknown command', () => {
    it('sends a system chat error and does not crash', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'frobnicate', parameter: 'x',
      });
      world.runTick();

      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat?.chatMessage).toMatch(/unknown command/);
    });
  });

  describe('visibility', () => {
    it('broadcasts entity_meta to nearby players, not to far ones', () => {
      const world = createTestWorld();
      const a = addTestPlayer(world, 10, 10);
      const near = addTestPlayer(world, 12, 12);
      const far = addTestPlayer(world, 100, 100);

      world.setAction(a.entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'ely',
      });
      world.runTick();

      expect(near.connection.events.some(e => e.type === 'entityMeta' && e.targetEntityId === a.entityId))
        .toBe(true);
      expect(far.connection.events.some(e => e.type === 'entityMeta' && e.targetEntityId === a.entityId))
        .toBe(false);
    });

    it('no-op when setting the same value (no duplicate events)', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'foo',
      });
      world.runTick();

      const countAfterFirst = connection.events.filter(e => e.type === 'entityMeta').length;

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'foo',
      });
      world.runTick();

      expect(connection.events.filter(e => e.type === 'entityMeta').length).toBe(countAfterFirst);
    });
  });

  describe('event emission', () => {
    it('fires entity_meta_changed for the renamer and observers', () => {
      const world = createTestWorld();
      const a = addTestPlayer(world, 10, 10);
      const near = addTestPlayer(world, 12, 12);

      world.setAction(a.entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'first',
      });
      world.runTick();

      const selfEvt = a.connection.gameEvents.find(e => e.type === 'entity_meta_changed');
      expect(selfEvt).toBeDefined();
      if (selfEvt?.type === 'entity_meta_changed') {
        expect(selfEvt.details.entityId).toBe(a.entityId);
        expect(selfEvt.details.newValue).toBe('first');
        expect(selfEvt.details.oldValue).toBe('Player');
      }

      const nearEvt = near.connection.gameEvents.find(e => e.type === 'entity_meta_changed');
      expect(nearEvt).toBeDefined();
    });

    it('includes oldValue on subsequent changes', () => {
      const world = createTestWorld();
      const a = addTestPlayer(world, 10, 10);

      world.setAction(a.entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'first',
      });
      world.runTick();

      // Clear previously captured events to isolate the second rename.
      a.connection.gameEvents.length = 0;

      world.setAction(a.entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'second',
      });
      world.runTick();

      const evt = a.connection.gameEvents.find(e => e.type === 'entity_meta_changed');
      if (evt?.type === 'entity_meta_changed') {
        expect(evt.details.oldValue).toBe('first');
        expect(evt.details.newValue).toBe('second');
      }
    });
  });

  describe('Say integration', () => {
    it('uses the player name as senderName when set', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'narrator',
      });
      world.runTick();
      connection.gameEvents.length = 0;

      world.setAction(entityId, { action: ClientAction.Say, message: 'hi' });
      world.runTick();

      const sayEvt = connection.gameEvents.find(e => e.type === 'player_say');
      if (sayEvt?.type === 'player_say') {
        expect(sayEvt.details.senderName).toBe('narrator');
      }
    });
  });

  describe('player cleanup', () => {
    it('removes meta when the player is removed', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'nick', parameter: 'temp',
      });
      world.runTick();
      expect(world.getEntityMeta(entityId, MetaKey.Name)).toBe('temp');

      world.removePlayer(entityId);
      expect(world.getEntityMeta(entityId, MetaKey.Name)).toBeUndefined();
    });
  });
});
