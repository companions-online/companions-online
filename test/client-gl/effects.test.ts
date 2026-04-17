import { describe, it, expect, vi } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { createTestScene } from './harness.js';
import type { Effect } from '@client-webgl/effects/effect.js';
import type { SyncedInventoryItem } from '@shared/protocol/codec.js';

function dummyEffect(startTime: number, duration: number): Effect & { disposed: boolean } {
  return {
    kind: 'damage',
    startTime,
    duration,
    done: false,
    disposed: false,
    tick() {},
    draw() {},
    dispose() { this.disposed = true; },
  };
}

describe('EffectManager', () => {
  it('removes and disposes effects past their duration', async () => {
    const { scene } = await createTestScene();
    const effect = dummyEffect(1000, 500);
    scene.effects.spawn(effect);
    expect(scene.effects.active).toHaveLength(1);

    // Tick while still within duration — stays alive.
    scene.time = 1400;
    scene.effects.tick(scene);
    expect(scene.effects.active).toHaveLength(1);
    expect(effect.disposed).toBe(false);

    // Tick past duration — removed and disposed.
    scene.time = 1600;
    scene.effects.tick(scene);
    expect(scene.effects.active).toHaveLength(0);
    expect(effect.disposed).toBe(true);
  });

  it('calls tick on active effects each frame', async () => {
    const { scene } = await createTestScene();
    const effect = dummyEffect(0, 5000);
    effect.tick = vi.fn();
    scene.effects.spawn(effect);

    scene.time = 100;
    scene.effects.tick(scene);
    expect(effect.tick).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Helpers: spawn entity with health, deliver HP delta via worldDelta
// ---------------------------------------------------------------------------

function spawnCreatureWithHealth(
  conn: { deliver(msg: unknown): void },
  entityId: number,
  currentHp: number,
  maxHp: number,
) {
  conn.deliver({
    type: 'entityFullState',
    data: {
      entityId,
      components: {
        position: { tileX: 5, tileY: 5 },
        blueprint: { blueprintId: BlueprintType.Deer, variant: 0 },
        health: { currentHp, maxHp },
      },
    },
  });
}

function deliverHealthUpdate(
  conn: { deliver(msg: unknown): void },
  entityId: number,
  currentHp: number,
  maxHp: number,
) {
  conn.deliver({
    type: 'worldDelta',
    data: {
      tick: 1,
      entityUpdates: [{
        entityId,
        components: { health: { currentHp, maxHp } },
      }],
      entityRemovals: [],
      tileUpdates: [],
    },
  });
}

// ---------------------------------------------------------------------------
// Damage numbers
// ---------------------------------------------------------------------------

describe('Damage numbers', () => {
  it('spawns a damage effect when HP decreases', async () => {
    const { scene, conn } = await createTestScene();
    spawnCreatureWithHealth(conn, 7, 100, 100);
    deliverHealthUpdate(conn, 7, 80, 100);

    expect(scene.effects.active).toHaveLength(1);
    expect(scene.effects.active[0].kind).toBe('damage');
  });

  it('does not spawn when HP stays the same', async () => {
    const { scene, conn } = await createTestScene();
    spawnCreatureWithHealth(conn, 7, 100, 100);
    deliverHealthUpdate(conn, 7, 100, 100);

    expect(scene.effects.active).toHaveLength(0);
  });

  it('does not spawn when HP increases (heal)', async () => {
    const { scene, conn } = await createTestScene();
    spawnCreatureWithHealth(conn, 7, 50, 100);
    deliverHealthUpdate(conn, 7, 75, 100);

    expect(scene.effects.active).toHaveLength(0);
  });

  it('does not spawn on first full-state arrival (no prior HP)', async () => {
    const { scene, conn } = await createTestScene();
    // entityFullState with health — no prior entity, so no delta.
    spawnCreatureWithHealth(conn, 7, 80, 100);

    expect(scene.effects.active).toHaveLength(0);
  });

  it('does not spawn when update has no health component', async () => {
    const { scene, conn } = await createTestScene();
    spawnCreatureWithHealth(conn, 7, 100, 100);
    // Position-only update — no health field.
    conn.deliver({
      type: 'worldDelta',
      data: {
        tick: 1,
        entityUpdates: [{
          entityId: 7,
          components: { position: { tileX: 6, tileY: 5 } },
        }],
        entityRemovals: [],
        tileUpdates: [],
      },
    });

    expect(scene.effects.active).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pickup text
// ---------------------------------------------------------------------------

function spawnPlayer(
  conn: { deliver(msg: unknown): void },
  entityId: number,
) {
  conn.deliver({ type: 'welcome', entityId, seed: 1 });
  conn.deliver({
    type: 'entityFullState',
    data: {
      entityId,
      components: {
        position: { tileX: 5, tileY: 5 },
        blueprint: { blueprintId: BlueprintType.Player, variant: 0 },
        health: { currentHp: 100, maxHp: 100 },
      },
    },
  });
}

function inv(blueprintId: number, quantity: number, itemId = 1): SyncedInventoryItem {
  return { itemId, blueprintId, quantity, equippedSlot: 0 };
}

describe('Pickup text', () => {
  it('spawns pickup effect on first inventory sync from empty', async () => {
    const { scene, conn } = await createTestScene();
    spawnPlayer(conn, 1);
    conn.deliver({
      type: 'inventorySync',
      items: [inv(BlueprintType.Wood, 3)],
    });

    expect(scene.effects.active).toHaveLength(1);
    expect(scene.effects.active[0].kind).toBe('pickup');
  });

  it('spawns on quantity increase', async () => {
    const { scene, conn } = await createTestScene();
    spawnPlayer(conn, 1);
    conn.deliver({ type: 'inventorySync', items: [inv(BlueprintType.Wood, 3)] });
    scene.effects.active.length = 0; // clear the first-sync effect

    conn.deliver({ type: 'inventorySync', items: [inv(BlueprintType.Wood, 5)] });
    expect(scene.effects.active).toHaveLength(1);
    expect(scene.effects.active[0].kind).toBe('pickup');
  });

  it('does not spawn on quantity decrease', async () => {
    const { scene, conn } = await createTestScene();
    spawnPlayer(conn, 1);
    conn.deliver({ type: 'inventorySync', items: [inv(BlueprintType.Wood, 5)] });
    scene.effects.active.length = 0;

    conn.deliver({ type: 'inventorySync', items: [inv(BlueprintType.Wood, 2)] });
    expect(scene.effects.active).toHaveLength(0);
  });

  it('does not spawn on item removal', async () => {
    const { scene, conn } = await createTestScene();
    spawnPlayer(conn, 1);
    conn.deliver({ type: 'inventorySync', items: [inv(BlueprintType.Wood, 5)] });
    scene.effects.active.length = 0;

    conn.deliver({ type: 'inventorySync', items: [] });
    expect(scene.effects.active).toHaveLength(0);
  });

  it('does not spawn before welcome (no player entity)', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'inventorySync', items: [inv(BlueprintType.Wood, 3)] });
    expect(scene.effects.active).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Chat bubbles
// ---------------------------------------------------------------------------

describe('Chat bubbles', () => {
  it('spawns a chat bubble on chat message', async () => {
    const { scene, conn } = await createTestScene();
    // Need the sender entity to exist so the bubble anchors.
    spawnCreatureWithHealth(conn, 10, 50, 50);
    conn.deliver({ type: 'chatMessage', senderEntityId: 10, message: 'hello' });

    expect(scene.effects.active).toHaveLength(1);
    expect(scene.effects.active[0].kind).toBe('chat');
  });

  it('two messages from same sender stack', async () => {
    const { scene, conn } = await createTestScene();
    spawnCreatureWithHealth(conn, 10, 50, 50);
    conn.deliver({ type: 'chatMessage', senderEntityId: 10, message: 'first' });
    conn.deliver({ type: 'chatMessage', senderEntityId: 10, message: 'second' });

    expect(scene.effects.active).toHaveLength(2);
    // Both are chat kind from the same sender.
    expect(scene.effects.active.every(e => e.kind === 'chat')).toBe(true);
  });

  it('expires early when sender entity is removed', async () => {
    const { scene, conn } = await createTestScene();
    spawnCreatureWithHealth(conn, 10, 50, 50);
    conn.deliver({ type: 'chatMessage', senderEntityId: 10, message: 'bye' });
    expect(scene.effects.active).toHaveLength(1);

    // Tick once so the bubble anchors to the entity.
    scene.time = 100;
    scene.effects.tick(scene);
    expect(scene.effects.active).toHaveLength(1);

    // Remove the sender entity.
    conn.deliver({
      type: 'worldDelta',
      data: { tick: 2, entityUpdates: [], entityRemovals: [10], tileUpdates: [] },
    });

    // Tick again — bubble should detect entity removal and expire.
    scene.time = 200;
    scene.effects.tick(scene);
    expect(scene.effects.active).toHaveLength(0);
  });
});
