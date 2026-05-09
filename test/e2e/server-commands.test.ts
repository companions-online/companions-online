import { describe, it, expect } from 'vitest';
import { ClientAction } from '../../shared/src/actions.js';
import { MetaKey } from '../../shared/src/entity-meta.js';
import { BlueprintType } from '../../shared/src/blueprints.js';
import { Terrain } from '../../shared/src/terrain.js';
import { gameMinuteFromTick } from '../../shared/src/lighting.js';
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

  describe('/spawn', () => {
    function runSpawn(world: ReturnType<typeof createTestWorld>, eid: number, name: string) {
      world.setAction(eid, { action: ClientAction.ServerCommand, command: 'spawn', parameter: name });
      world.runTick();
    }

    it('spawns a creature within 6 tiles of the player with AI + health', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 50, 50);
      const before = new Set(world.entities.getAllEntities());

      runSpawn(world, entityId, 'wolf');

      const newEids = [...world.entities.getAllEntities()].filter(e => !before.has(e));
      expect(newEids).toHaveLength(1);
      const wolfEid = newEids[0];

      const bp = world.entities.blueprint.get(wolfEid);
      expect(bp?.blueprintId).toBe(BlueprintType.Wolf);

      const pos = world.entities.position.get(wolfEid)!;
      expect(Math.max(Math.abs(pos.tileX - 50), Math.abs(pos.tileY - 50))).toBeLessThanOrEqual(6);

      expect(world.critterStates.has(wolfEid)).toBe(true);
      expect(world.entities.health.get(wolfEid)?.currentHp).toBe(20);
      expect(world.entities.statusEffects.get(wolfEid)).toBeDefined();
      expect(world.occupancy.get(pos.tileX, pos.tileY)).toBe(wolfEid);
    });

    it('spawns a ground item with no statusEffects component', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 50, 50);
      const before = new Set(world.entities.getAllEntities());

      runSpawn(world, entityId, 'iron sword');

      const newEids = [...world.entities.getAllEntities()].filter(e => !before.has(e));
      expect(newEids).toHaveLength(1);
      const itemEid = newEids[0];

      expect(world.entities.blueprint.get(itemEid)?.blueprintId).toBe(BlueprintType.IronSword);
      expect(world.entities.statusEffects.get(itemEid)).toBeUndefined();
      const pos = world.entities.position.get(itemEid)!;
      expect(Math.max(Math.abs(pos.tileX - 50), Math.abs(pos.tileY - 50))).toBeLessThanOrEqual(6);
    });

    it('is case-insensitive (Wolf, WOLF, wolf all work)', () => {
      for (const name of ['Wolf', 'WOLF', 'wolf']) {
        const world = createTestWorld();
        const { entityId } = addTestPlayer(world, 50, 50);
        const before = new Set(world.entities.getAllEntities());
        runSpawn(world, entityId, name);
        const added = [...world.entities.getAllEntities()].filter(e => !before.has(e));
        expect(added).toHaveLength(1);
      }
    });

    it('rejects an unknown blueprint name via system chat', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 50, 50);
      runSpawn(world, entityId, 'dragon');
      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat?.chatMessage).toMatch(/unknown blueprint/);
    });

    it('rejects Player / Tree / NPCs / placeables', () => {
      for (const name of ['Player', 'Tree', 'The Hermit', 'Campfire']) {
        const world = createTestWorld();
        const { entityId, connection } = addTestPlayer(world, 50, 50);
        const before = new Set(world.entities.getAllEntities());
        runSpawn(world, entityId, name);
        const added = [...world.entities.getAllEntities()].filter(e => !before.has(e));
        expect(added).toHaveLength(0);
        const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
        expect(chat).toBeDefined();
      }
    });

    it('errors when no open tile is available within 6', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 50, 50);
      // Flood the 13x13 square around the player with water (unwalkable),
      // except the player's own tile (which is occupied anyway).
      for (let y = 44; y <= 56; y++) {
        for (let x = 44; x <= 56; x++) {
          if (x === 50 && y === 50) continue;
          world.map.setTerrain(x, y, Terrain.Water);
        }
      }
      const before = new Set(world.entities.getAllEntities());

      runSpawn(world, entityId, 'wolf');

      const added = [...world.entities.getAllEntities()].filter(e => !before.has(e));
      expect(added).toHaveLength(0);
      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat?.chatMessage).toMatch(/no open tile/);
    });
  });

  describe('/avatar', () => {
    it('accepts variant 0 (the default) without changing state', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 10, 10);
      const before = world.entities.blueprint.get(entityId);
      expect(before?.variant).toBe(0);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'avatar', parameter: '0',
      });
      world.runTick();

      expect(world.entities.blueprint.get(entityId)?.variant).toBe(0);
    });

    it('accepts a known avatar name', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'avatar', parameter: 'nomad',
      });
      world.runTick();

      expect(world.entities.blueprint.get(entityId)?.variant).toBe(1);
    });

    it('rejects out-of-range variant via system chat', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'avatar', parameter: '99',
      });
      world.runTick();

      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat?.chatMessage).toMatch(/variant must be/);
    });

    it('rejects unknown name via system chat', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'avatar', parameter: 'wizard',
      });
      world.runTick();

      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat?.chatMessage).toMatch(/usage/);
    });

    it('rejects negative variant', () => {
      // Negative numbers fail the digits-only regex at the parameter parse
      // step (the leading minus isn't a digit), so the error is "usage"
      // rather than "out of range". Either form is fine — just validate
      // the command doesn't accept it.
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 10, 10);

      world.setAction(entityId, {
        action: ClientAction.ServerCommand, command: 'avatar', parameter: '-1',
      });
      world.runTick();

      expect(world.entities.blueprint.get(entityId)?.variant).toBe(0);
      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat).toBeDefined();
    });
  });

  describe('/time', () => {
    function runTime(world: ReturnType<typeof createTestWorld>, eid: number, spec: string) {
      world.setAction(eid, { action: ClientAction.ServerCommand, command: 'time', parameter: spec });
      world.runTick();
    }

    it('sets effective time to the requested preset', () => {
      const cases: [string, number][] = [
        ['day', 12 * 60],
        ['night', 0],
        ['dawn', 5 * 60],
        ['sunset', 19 * 60],
        ['noon', 12 * 60],
        ['midnight', 0],
      ];
      for (const [spec, expectedMinute] of cases) {
        const world = createTestWorld();
        const { entityId } = addTestPlayer(world, 50, 50);
        runTime(world, entityId, spec);
        expect(gameMinuteFromTick(world.effectiveTick)).toBe(expectedMinute);
      }
    });

    it('accepts HH:MM and lands exactly on the target minute', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 50, 50);
      runTime(world, entityId, '13:30');
      expect(gameMinuteFromTick(world.effectiveTick)).toBe(13 * 60 + 30);
    });

    it('accepts bare HH as H:00', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 50, 50);
      runTime(world, entityId, '7');
      expect(gameMinuteFromTick(world.effectiveTick)).toBe(7 * 60);
    });

    it('round-trips day → night without drift', () => {
      const world = createTestWorld();
      const { entityId } = addTestPlayer(world, 50, 50);
      runTime(world, entityId, 'day');
      expect(gameMinuteFromTick(world.effectiveTick)).toBe(12 * 60);
      runTime(world, entityId, 'night');
      expect(gameMinuteFromTick(world.effectiveTick)).toBe(0);
    });

    it('rejects an invalid spec via system chat', () => {
      const world = createTestWorld();
      const { entityId, connection } = addTestPlayer(world, 50, 50);
      const offsetBefore = world.tickOffset;
      runTime(world, entityId, '99:99');
      expect(world.tickOffset).toBe(offsetBefore);
      const chat = connection.events.find(e => e.type === 'chatMessage' && e.senderEntityId === 0);
      expect(chat?.chatMessage).toMatch(/usage/);
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
