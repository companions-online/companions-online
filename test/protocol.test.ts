import { describe, it, expect } from 'vitest';
import {
  ClientAction, ActionType, Direction,
  encodeAction, encodePing, encodePong, encodeWelcome,
  encodeWorldDelta, encodeEntityFullState, encodeChunk, encodeEntityMeta,
  decodeClientMessage, decodeServerMessage,
  rleEncode, rleDecode,
  BufferReader,
  WAYPOINT_NONE,
  MetaKey,
} from '@shared/index.js';

// ---- Action messages ----

describe('ACTION messages', () => {
  it('round-trips Cancel', () => {
    const buf = encodeAction({ action: ClientAction.Cancel });
    expect(buf.byteLength).toBe(2);
    const msg = decodeClientMessage(buf);
    expect(msg.type).toBe('action');
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.Cancel);
    }
  });

  it('round-trips MoveTo', () => {
    const buf = encodeAction({ action: ClientAction.MoveTo, tileX: 20, tileY: 15 });
    expect(buf.byteLength).toBe(6);
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.MoveTo);
      expect((msg.data as any).tileX).toBe(20);
      expect((msg.data as any).tileY).toBe(15);
    }
  });

  it('round-trips Interact', () => {
    const buf = encodeAction({ action: ClientAction.Interact, entityId: 42 });
    expect(buf.byteLength).toBe(4);
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.Interact);
      expect((msg.data as any).entityId).toBe(42);
    }
  });

  it('round-trips Build', () => {
    const buf = encodeAction({ action: ClientAction.Build, buildingType: 1, tileX: 30, tileY: 22 });
    expect(buf.byteLength).toBe(7);
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.Build);
      expect((msg.data as any).buildingType).toBe(1);
      expect((msg.data as any).tileX).toBe(30);
      expect((msg.data as any).tileY).toBe(22);
    }
  });

  it('round-trips ServerCommand', () => {
    const buf = encodeAction({ action: ClientAction.ServerCommand, command: 'nick', parameter: 'elsyian' });
    const msg = decodeClientMessage(buf);
    expect(msg.type).toBe('action');
    if (msg.type === 'action') {
      expect(msg.data.action).toBe(ClientAction.ServerCommand);
      expect((msg.data as any).command).toBe('nick');
      expect((msg.data as any).parameter).toBe('elsyian');
    }
  });

  it('round-trips ServerCommand with empty parameter', () => {
    const buf = encodeAction({ action: ClientAction.ServerCommand, command: 'who', parameter: '' });
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect((msg.data as any).command).toBe('who');
      expect((msg.data as any).parameter).toBe('');
    }
  });

  it('round-trips ServerCommand with whitespace-containing parameter', () => {
    const buf = encodeAction({ action: ClientAction.ServerCommand, command: 'say', parameter: 'hello world how are you' });
    const msg = decodeClientMessage(buf);
    if (msg.type === 'action') {
      expect((msg.data as any).parameter).toBe('hello world how are you');
    }
  });
});

// ---- EntityMeta ----

describe('EntityMeta', () => {
  it('round-trips a name value', () => {
    const buf = encodeEntityMeta(42, MetaKey.Name, 'elsyian');
    const msg = decodeServerMessage(buf);
    expect(msg).toEqual({ type: 'entityMeta', entityId: 42, key: MetaKey.Name, value: 'elsyian' });
  });

  it('round-trips an empty value (clear key)', () => {
    const buf = encodeEntityMeta(42, MetaKey.Name, '');
    const msg = decodeServerMessage(buf);
    expect(msg).toEqual({ type: 'entityMeta', entityId: 42, key: MetaKey.Name, value: '' });
  });

  it('round-trips UTF-8 multi-byte characters', () => {
    const buf = encodeEntityMeta(7, MetaKey.Name, 'héllo');
    const msg = decodeServerMessage(buf);
    if (msg.type === 'entityMeta') {
      expect(msg.value).toBe('héllo');
    }
  });
});

// ---- Ping/Pong ----

describe('WELCOME', () => {
  it('round-trips Welcome', () => {
    const buf = encodeWelcome(42, 12345);
    expect(buf.byteLength).toBe(7);
    const msg = decodeServerMessage(buf);
    expect(msg).toEqual({ type: 'welcome', entityId: 42, seed: 12345 });
  });
});

describe('PING/PONG', () => {
  it('round-trips Ping', () => {
    const buf = encodePing(123456789);
    expect(buf.byteLength).toBe(5);
    const msg = decodeClientMessage(buf);
    expect(msg).toEqual({ type: 'ping', clientTime: 123456789 });
  });

  it('round-trips Pong', () => {
    const buf = encodePong(987654321);
    expect(buf.byteLength).toBe(5);
    const msg = decodeServerMessage(buf);
    expect(msg).toEqual({ type: 'pong', clientTime: 987654321 });
  });
});

// ---- WorldDelta ----

describe('WorldDelta', () => {
  it('round-trips entity updates with multiple components', () => {
    const buf = encodeWorldDelta(
      100,
      [{
        entityId: 42,
        components: {
          position: { tileX: 8, tileY: 10 },
          direction: { dir: Direction.E },
          nextWaypoint: { tileX: 8, tileY: 12 },
          currentAction: { actionType: ActionType.Walking },
        },
      }],
      [],
      [],
    );
    const msg = decodeServerMessage(buf);
    expect(msg.type).toBe('worldDelta');
    if (msg.type === 'worldDelta') {
      const d = msg.data;
      expect(d.tick).toBe(100);
      expect(d.entityUpdates).toHaveLength(1);
      const eu = d.entityUpdates[0];
      expect(eu.entityId).toBe(42);
      expect(eu.components.position).toEqual({ tileX: 8, tileY: 10 });
      expect(eu.components.direction).toEqual({ dir: Direction.E });
      expect(eu.components.nextWaypoint).toEqual({ tileX: 8, tileY: 12 });
      expect(eu.components.currentAction).toEqual({ actionType: ActionType.Walking });
    }
  });

  it('round-trips entity removals', () => {
    const buf = encodeWorldDelta(200, [], [10, 20, 30], []);
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.entityRemovals).toEqual([10, 20, 30]);
    }
  });

  it('round-trips tile updates', () => {
    const buf = encodeWorldDelta(300, [], [], [
      { tileX: 30, tileY: 22, building: 1 },
      { tileX: 5, tileY: 5, terrain: 3, buildingMeta: 0b00100010 },
    ]);
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.tileUpdates).toHaveLength(2);
      expect(msg.data.tileUpdates[0]).toEqual({ tileX: 30, tileY: 22, building: 1 });
      expect(msg.data.tileUpdates[1]).toEqual({ tileX: 5, tileY: 5, terrain: 3, buildingMeta: 0b00100010 });
    }
  });

  it('round-trips empty delta', () => {
    const buf = encodeWorldDelta(0, [], [], []);
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.tick).toBe(0);
      expect(msg.data.entityUpdates).toEqual([]);
      expect(msg.data.entityRemovals).toEqual([]);
      expect(msg.data.tileUpdates).toEqual([]);
    }
  });

  it('round-trips mixed sections', () => {
    const buf = encodeWorldDelta(
      500,
      [{ entityId: 1, components: { health: { currentHp: 50, maxHp: 100 } } }],
      [99],
      [{ tileX: 10, tileY: 10, terrain: 0 }],
    );
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.entityUpdates).toHaveLength(1);
      expect(msg.data.entityRemovals).toEqual([99]);
      expect(msg.data.tileUpdates).toHaveLength(1);
    }
  });
});

// ---- EntityFullState ----

describe('EntityFullState', () => {
  it('round-trips all components with speed', () => {
    const buf = encodeEntityFullState(
      42,
      {
        position: { tileX: 5, tileY: 10 },
        direction: { dir: Direction.SE },
        nextWaypoint: { tileX: 8, tileY: 10 },
        currentAction: { actionType: ActionType.Walking },
        health: { currentHp: 80, maxHp: 100 },
        blueprint: { blueprintId: 0, variant: 0 },
        statusEffects: { effects: 0 },
      },
      48, // speed
    );
    const msg = decodeServerMessage(buf);
    expect(msg.type).toBe('entityFullState');
    if (msg.type === 'entityFullState') {
      const d = msg.data;
      expect(d.entityId).toBe(42);
      expect(d.speed).toBe(48);
      expect(d.components.position).toEqual({ tileX: 5, tileY: 10 });
      expect(d.components.direction).toEqual({ dir: Direction.SE });
      expect(d.components.nextWaypoint).toEqual({ tileX: 8, tileY: 10 });
      expect(d.components.currentAction).toEqual({ actionType: ActionType.Walking });
      expect(d.components.health).toEqual({ currentHp: 80, maxHp: 100 });
      expect(d.components.blueprint).toEqual({ blueprintId: 0, variant: 0 });
      expect(d.components.statusEffects).toEqual({ effects: 0 });
    }
  });

  it('round-trips without speed', () => {
    const buf = encodeEntityFullState(7, {
      position: { tileX: 0, tileY: 0 },
      blueprint: { blueprintId: 10, variant: 2 },
    });
    const msg = decodeServerMessage(buf);
    if (msg.type === 'entityFullState') {
      expect(msg.data.entityId).toBe(7);
      expect(msg.data.speed).toBeUndefined();
      expect(msg.data.components.position).toEqual({ tileX: 0, tileY: 0 });
      expect(msg.data.components.blueprint).toEqual({ blueprintId: 10, variant: 2 });
    }
  });
});

// ---- CurrentAction variants ----

describe('CurrentAction payload variants', () => {
  it('Idle: no payload', () => {
    const buf = encodeWorldDelta(1, [{
      entityId: 1,
      components: { currentAction: { actionType: ActionType.Idle } },
    }], [], []);
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.entityUpdates[0].components.currentAction).toEqual({ actionType: ActionType.Idle });
    }
  });

  it('Interacting: target entity', () => {
    const buf = encodeWorldDelta(1, [{
      entityId: 1,
      components: { currentAction: { actionType: ActionType.Interacting, targetEntity: 55 } },
    }], [], []);
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.entityUpdates[0].components.currentAction).toEqual({
        actionType: ActionType.Interacting,
        targetEntity: 55,
      });
    }
  });

  it('Building: target tile', () => {
    const buf = encodeWorldDelta(1, [{
      entityId: 1,
      components: { currentAction: { actionType: ActionType.Building, targetTileX: 10, targetTileY: 20 } },
    }], [], []);
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.entityUpdates[0].components.currentAction).toEqual({
        actionType: ActionType.Building,
        targetTileX: 10,
        targetTileY: 20,
      });
    }
  });

  it('Harvesting: target entity', () => {
    const buf = encodeWorldDelta(1, [{
      entityId: 1,
      components: { currentAction: { actionType: ActionType.Harvesting, targetEntity: 77 } },
    }], [], []);
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.entityUpdates[0].components.currentAction).toEqual({
        actionType: ActionType.Harvesting,
        targetEntity: 77,
      });
    }
  });

  it('Dead: no payload', () => {
    const buf = encodeWorldDelta(1, [{
      entityId: 1,
      components: { currentAction: { actionType: ActionType.Dead } },
    }], [], []);
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.entityUpdates[0].components.currentAction).toEqual({ actionType: ActionType.Dead });
    }
  });
});

// ---- WAYPOINT_NONE sentinel ----

describe('WAYPOINT_NONE sentinel', () => {
  it('round-trips 0xFFFF,0xFFFF as stationary', () => {
    const buf = encodeWorldDelta(1, [{
      entityId: 1,
      components: { nextWaypoint: { tileX: WAYPOINT_NONE, tileY: WAYPOINT_NONE } },
    }], [], []);
    const msg = decodeServerMessage(buf);
    if (msg.type === 'worldDelta') {
      expect(msg.data.entityUpdates[0].components.nextWaypoint).toEqual({
        tileX: WAYPOINT_NONE,
        tileY: WAYPOINT_NONE,
      });
    }
  });
});

// ---- Chunk (RLE) ----

describe('Chunk', () => {
  it('round-trips terrain chunk data', () => {
    const terrain = new Uint8Array(256).fill(0); // all grass
    terrain[0] = 4; // water at (0,0)
    terrain[255] = 2; // rock at (15,15)
    const buildings = new Uint8Array(256).fill(0);
    const meta = new Uint8Array(256).fill(0);

    const buf = encodeChunk(3, 5, terrain, buildings, meta);
    const msg = decodeServerMessage(buf);
    expect(msg.type).toBe('chunk');
    if (msg.type === 'chunk') {
      expect(msg.data.chunkX).toBe(3);
      expect(msg.data.chunkY).toBe(5);
      expect(msg.data.terrain).toEqual(terrain);
      expect(msg.data.buildings).toEqual(buildings);
      expect(msg.data.buildingMeta).toEqual(meta);
    }
  });
});

// ---- RLE edge cases ----

describe('RLE', () => {
  it('all same value', () => {
    const data = new Uint8Array(256).fill(7);
    const encoded = rleEncode(data);
    const r = new BufferReader(encoded.buffer);
    const decoded = rleDecode(r);
    expect(decoded).toEqual(data);
  });

  it('all different values', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i % 256;
    const encoded = rleEncode(data);
    const r = new BufferReader(encoded.buffer);
    const decoded = rleDecode(r);
    expect(decoded).toEqual(data);
  });

  it('max run length 255', () => {
    // 256 of the same value requires two runs: 255 + 1
    const data = new Uint8Array(256).fill(3);
    const encoded = rleEncode(data);
    // Should be: [255, 3, 1, 3, 0]
    expect(encoded[0]).toBe(255);
    expect(encoded[1]).toBe(3);
    expect(encoded[2]).toBe(1);
    expect(encoded[3]).toBe(3);
    expect(encoded[4]).toBe(0);
    const r = new BufferReader(encoded.buffer);
    const decoded = rleDecode(r);
    expect(decoded).toEqual(data);
  });
});
