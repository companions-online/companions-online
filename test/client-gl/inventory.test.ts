import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { Terrain } from '@shared/terrain.js';
import { CHUNK_SIZE } from '@shared/constants.js';
import { resolveAction } from '@shared/action-resolver.js';
import { createTestScene } from './harness.js';
import { buildCursorContext } from '@client-webgl/controls/cursor-context.js';
import type { FakeConnection } from './fake-connection.js';

function fillChunkTerrain(
  conn: FakeConnection,
  chunkX: number,
  chunkY: number,
  terrain: Terrain,
): void {
  const t = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(terrain);
  const b = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const m = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  conn.deliver({ type: 'chunk', data: { chunkX, chunkY, terrain: t, buildings: b, buildingMeta: m } });
}

describe('inventorySync', () => {
  it('populates scene.inventory', async () => {
    const { scene, conn } = await createTestScene();
    expect(scene.inventory).toEqual([]);
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, equippedSlot: 0 },
        { itemId: 2, blueprintId: BlueprintType.FishingRod, quantity: 1, equippedSlot: 1 },
      ],
    });
    expect(scene.inventory).toHaveLength(2);
    expect(scene.inventory[1].blueprintId).toBe(BlueprintType.FishingRod);
    expect(scene.inventory[1].equippedSlot).toBe(1);
  });

  it('replaces inventory entirely on each sync', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, equippedSlot: 0 }],
    });
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 3, blueprintId: BlueprintType.Rock, quantity: 2, equippedSlot: 0 }],
    });
    expect(scene.inventory).toHaveLength(1);
    expect(scene.inventory[0].blueprintId).toBe(BlueprintType.Rock);
  });
});

describe('fishing rod → Harvest on water', () => {
  it('click on water with nothing equipped → no action', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.Water);
    const ctx = buildCursorContext(scene, 5, 5)!;
    expect(resolveAction(ctx)).toBeNull();
  });

  it('click on water with fishing rod equipped → Harvest', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.Water);
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 42, blueprintId: BlueprintType.FishingRod, quantity: 1, equippedSlot: 1 },
      ],
    });
    const ctx = buildCursorContext(scene, 5, 5)!;
    const action = resolveAction(ctx)!;
    expect(action.action).toBe(ClientAction.Harvest);
  });

  it('fishing rod in backpack (not equipped) → no action on water', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.Water);
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 42, blueprintId: BlueprintType.FishingRod, quantity: 1, equippedSlot: 0 },
      ],
    });
    const ctx = buildCursorContext(scene, 5, 5)!;
    expect(resolveAction(ctx)).toBeNull();
  });
});

describe('containerOpen / dialogueOpen / chatMessage', () => {
  it('containerOpen sets a container overlay carrying entity id + items', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'containerOpen',
      containerEntityId: 123,
      items: [
        { itemId: 7, blueprintId: BlueprintType.Wood, quantity: 10, equippedSlot: 0 },
      ],
    });
    expect(scene.overlay.kind).toBe('container');
    if (scene.overlay.kind !== 'container') throw new Error('unreachable');
    expect(scene.overlay.entityId).toBe(123);
    expect(scene.overlay.items).toHaveLength(1);
    expect(scene.overlay.items[0].blueprintId).toBe(BlueprintType.Wood);
  });

  it('dialogueOpen sets a dialogue overlay carrying npc id + blob', async () => {
    const { scene, conn } = await createTestScene();
    const dialogue = { greeting: 'hi', options: [] };
    conn.deliver({ type: 'dialogueOpen', npcEntityId: 55, dialogue });
    expect(scene.overlay.kind).toBe('dialogue');
    if (scene.overlay.kind !== 'dialogue') throw new Error('unreachable');
    expect(scene.overlay.npcId).toBe(55);
    expect(scene.overlay.dialogue).toBe(dialogue);
  });

  it('chatMessage appends with a timestamp', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({ type: 'chatMessage', senderEntityId: 10, message: 'hello' });
    conn.deliver({ type: 'chatMessage', senderEntityId: 11, message: 'world' });
    expect(scene.chatLog).toHaveLength(2);
    expect(scene.chatLog[0].senderEntityId).toBe(10);
    expect(scene.chatLog[0].message).toBe('hello');
    expect(typeof scene.chatLog[0].receivedAt).toBe('number');
    expect(scene.chatLog[1].message).toBe('world');
  });

  it('chatMessage rolls older entries out at cap', async () => {
    const { scene, conn } = await createTestScene();
    for (let i = 0; i < 60; i++) {
      conn.deliver({ type: 'chatMessage', senderEntityId: 1, message: `m${i}` });
    }
    expect(scene.chatLog).toHaveLength(50);
    // Oldest surviving entry is m10; newest is m59.
    expect(scene.chatLog[0].message).toBe('m10');
    expect(scene.chatLog[scene.chatLog.length - 1].message).toBe('m59');
  });
});

describe('inventory UI state', () => {
  it('gridOrder assigns slot indices on first sync', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, equippedSlot: 0 },
        { itemId: 2, blueprintId: BlueprintType.Rock, quantity: 3, equippedSlot: 0 },
      ],
    });
    expect(scene.gridOrder.get(1)).toBe(0);
    expect(scene.gridOrder.get(2)).toBe(1);
  });

  it('gridOrder preserves positions across syncs', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, equippedSlot: 0 },
        { itemId: 2, blueprintId: BlueprintType.Rock, quantity: 3, equippedSlot: 0 },
        { itemId: 3, blueprintId: BlueprintType.Hide, quantity: 2, equippedSlot: 0 },
      ],
    });
    // Item 2 removed; item 3 still present; new item 4 should take slot 1 (freed).
    conn.deliver({
      type: 'inventorySync',
      items: [
        { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, equippedSlot: 0 },
        { itemId: 3, blueprintId: BlueprintType.Hide, quantity: 2, equippedSlot: 0 },
        { itemId: 4, blueprintId: BlueprintType.RawMeat, quantity: 1, equippedSlot: 0 },
      ],
    });
    expect(scene.gridOrder.has(2)).toBe(false);
    expect(scene.gridOrder.get(1)).toBe(0);
    expect(scene.gridOrder.get(3)).toBe(2);
    expect(scene.gridOrder.get(4)).toBe(1);
  });

  it('heldStack cleared when its source itemId disappears', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 1, blueprintId: BlueprintType.Wood, quantity: 5, equippedSlot: 0 }],
    });
    scene.heldStack = { itemId: 1, blueprintId: BlueprintType.Wood, quantity: 2, source: 'inventory' };
    conn.deliver({ type: 'inventorySync', items: [] });
    expect(scene.heldStack).toBeNull();
  });
});
