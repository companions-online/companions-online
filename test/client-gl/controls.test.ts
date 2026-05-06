import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { Direction } from '@shared/direction.js';
import { Terrain, Building } from '@shared/terrain.js';
import { StatusEffect } from '@shared/status-effects.js';
import { CHUNK_SIZE } from '@shared/constants.js';
import { resolveAction } from '@shared/action-resolver.js';
import { createTestScene } from './harness.js';
import { buildCursorContext } from '@client-webgl/controls/cursor-context.js';
import { attachMouseControls } from '@client-webgl/controls/mouse.js';
import { hudQuickbarCellRect } from '@client-webgl/ui/inventory-panel.js';
import type { Scene } from '@client-webgl/scene.js';
import type { FakeConnection } from './fake-connection.js';

/** Fill one chunk with a uniform terrain so the worldMap's isWalkable
 *  logic has something to answer with. */
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

function spawnPlayer(
  scene: Scene,
  conn: FakeConnection,
  id: number,
  tileX: number,
  tileY: number,
): void {
  conn.deliver({ type: 'welcome', entityId: id, seed: 1 });
  conn.deliver({
    type: 'entityFullState',
    data: {
      entityId: id,
      components: {
        position: { tileX, tileY },
        blueprint: { blueprintId: BlueprintType.Player, variant: 0 },
      },
    },
  });
}

describe('buildCursorContext', () => {
  it('returns null for out-of-bounds tiles', async () => {
    const { scene } = await createTestScene();
    expect(buildCursorContext(scene, -1, 5)).toBeNull();
    expect(buildCursorContext(scene, 5, 99999)).toBeNull();
  });

  it('reports walkable grass + no entity', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.Grass);
    const ctx = buildCursorContext(scene, 5, 5);
    expect(ctx).not.toBeNull();
    expect(ctx!.isWalkable).toBe(true);
    expect(ctx!.terrainType).toBe(Terrain.Grass);
    expect(ctx!.entityAtTarget).toBeUndefined();
  });

  it('reports water tile as non-walkable', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.Water);
    const ctx = buildCursorContext(scene, 3, 3);
    expect(ctx!.isWalkable).toBe(false);
    expect(ctx!.terrainType).toBe(Terrain.Water);
  });

  it('finds an entity at a tile (skipping self)', async () => {
    const { scene, conn } = await createTestScene();
    spawnPlayer(scene, conn, 100, 4, 4);
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 50,
        components: {
          position: { tileX: 7, tileY: 7 },
          blueprint: { blueprintId: BlueprintType.Tree, variant: 0 },
          statusEffects: { effects: StatusEffect.Placed },
        },
      },
    });
    const treeCtx = buildCursorContext(scene, 7, 7)!;
    expect(treeCtx.entityAtTarget).toEqual({
      entityId: 50,
      blueprintId: BlueprintType.Tree,
      isGroundItem: false,
    });
    // self is skipped
    const selfCtx = buildCursorContext(scene, 4, 4)!;
    expect(selfCtx.entityAtTarget).toBeUndefined();
  });

  it('flags entities with no statusEffects as ground items', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 7,
        components: {
          position: { tileX: 2, tileY: 2 },
          blueprint: { blueprintId: BlueprintType.Wood, variant: 0 },
        },
      },
    });
    const ctx = buildCursorContext(scene, 2, 2)!;
    expect(ctx.entityAtTarget?.isGroundItem).toBe(true);
  });
});

describe('resolveAction against cursor context', () => {
  it('click on tree → Harvest', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.Grass);
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 50,
        components: {
          position: { tileX: 7, tileY: 7 },
          blueprint: { blueprintId: BlueprintType.Tree, variant: 0 },
          statusEffects: { effects: StatusEffect.Placed },
        },
      },
    });
    const ctx = buildCursorContext(scene, 7, 7)!;
    const action = resolveAction(ctx)!;
    expect(action.action).toBe(ClientAction.Harvest);
  });

  it('click on empty walkable tile → MoveTo', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.Grass);
    const ctx = buildCursorContext(scene, 6, 8)!;
    const action = resolveAction(ctx)!;
    expect(action.action).toBe(ClientAction.MoveTo);
  });

  it('click on deer → Attack', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.Grass);
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 77,
        components: {
          position: { tileX: 10, tileY: 10 },
          blueprint: { blueprintId: BlueprintType.Deer, variant: 0 },
          statusEffects: { effects: 0 },
        },
      },
    });
    const ctx = buildCursorContext(scene, 10, 10)!;
    const action = resolveAction(ctx)!;
    expect(action.action).toBe(ClientAction.Attack);
  });

  it('click on river (un-bridged, no rod) → null', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.River);
    const ctx = buildCursorContext(scene, 6, 6)!;
    expect(resolveAction(ctx)).toBeNull();
  });

  it('click on river with fishing rod → Harvest (fish)', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.River);
    spawnPlayer(scene, conn, 100, 1, 1);
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 1, blueprintId: BlueprintType.FishingRod, quantity: 1, equippedSlot: 1 }],
    });
    const ctx = buildCursorContext(scene, 6, 6)!;
    const action = resolveAction(ctx)!;
    expect(action.action).toBe(ClientAction.Harvest);
  });

  it('click on bridged river (river + WoodenFloor) → MoveTo', async () => {
    const { scene, conn } = await createTestScene();
    // River chunk with a WoodenFloor building at tile (6, 6).
    const t = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(Terrain.River);
    const b = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const m = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    b[6 * CHUNK_SIZE + 6] = Building.WoodenFloor;
    conn.deliver({ type: 'chunk', data: { chunkX: 0, chunkY: 0, terrain: t, buildings: b, buildingMeta: m } });
    const ctx = buildCursorContext(scene, 6, 6)!;
    expect(ctx.isWalkable).toBe(true);
    expect(ctx.terrainType).toBe(Terrain.River);
    const action = resolveAction(ctx)!;
    expect(action.action).toBe(ClientAction.MoveTo);
  });

  it('click on door → Interact', async () => {
    const { scene, conn } = await createTestScene();
    fillChunkTerrain(conn, 0, 0, Terrain.Grass);
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 20,
        components: {
          position: { tileX: 5, tileY: 5 },
          blueprint: { blueprintId: BlueprintType.WoodenDoor, variant: 0 },
          statusEffects: { effects: StatusEffect.Placed },
        },
      },
    });
    const ctx = buildCursorContext(scene, 5, 5)!;
    const action = resolveAction(ctx)!;
    expect(action.action).toBe(ClientAction.Interact);
  });
});

// Exercise attachMouseControls end-to-end: build a fake canvas that captures
// its mousedown listener, invoke it with a synthetic MouseEvent, and check
// both the outbound action and the local turn prediction.
describe('attachMouseControls → action dispatch', () => {
  async function setup(playerX: number, playerY: number): Promise<{
    scene: Scene;
    conn: FakeConnection;
    fireClick: (canvasX: number, canvasY: number) => void;
  }> {
    const { scene, conn } = await createTestScene();
    // Populate enough chunks for both player and click targets.
    for (let cy = 0; cy < 6; cy++) {
      for (let cx = 0; cx < 6; cx++) fillChunkTerrain(conn, cx, cy, Terrain.Grass);
    }
    spawnPlayer(scene, conn, 1, playerX, playerY);
    // The RAF loop isn't running in tests, so camera.follow() never fires.
    // Position it manually so tileAt() maps click pixels onto tiles near
    // the player.
    scene.camera.follow(playerX, playerY);

    let listener: ((ev: MouseEvent) => void) | null = null;
    const canvas = {
      width: 1024,
      height: 768,
      addEventListener: (type: string, fn: (ev: MouseEvent) => void) => {
        if (type === 'mousedown') listener = fn;
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1024, height: 768, right: 1024, bottom: 768 }),
    } as unknown as HTMLCanvasElement;

    attachMouseControls(canvas, scene, conn);
    expect(listener).not.toBeNull();

    function fireClick(canvasX: number, canvasY: number) {
      const ev = { clientX: canvasX, clientY: canvasY } as unknown as MouseEvent;
      listener!(ev);
    }
    return { scene, conn, fireClick };
  }

  it('clicking a walkable tile sends MoveTo and predicts direction', async () => {
    const { scene, conn, fireClick } = await setup(32, 32);
    // Click a canvas point that resolves to a tile east of the player.
    // camera.tileAt inverts the iso projection; to avoid doing that math we
    // directly construct a ctx + resolveAction path in the tileAt path by
    // aiming the click at the canvas center (which renders the player's
    // tile) plus a one-tile east offset (TILE_W on the iso x axis ≈ +32 px).
    // Simpler: use the scene.camera.tileAt to discover the canvas pixels
    // that map to a specific tile, then click those pixels.
    // Find a canvas point that maps to tile (33, 32):
    let targetPx: { x: number; y: number } | null = null;
    for (let py = 0; py < 768 && !targetPx; py += 4) {
      for (let px = 0; px < 1024 && !targetPx; px += 4) {
        const t = scene.camera.tileAt(px, py);
        if (t && t.tx === 33 && t.ty === 32) targetPx = { x: px, y: py };
      }
    }
    expect(targetPx).not.toBeNull();
    fireClick(targetPx!.x, targetPx!.y);

    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0].action).toBe(ClientAction.MoveTo);
    const sent = conn.sent[0] as { tileX: number; tileY: number };
    expect(sent.tileX).toBe(33);
    expect(sent.tileY).toBe(32);

    // Turn prediction: player (at 32, 32) now faces east.
    const me = scene.entities.get(1)!;
    expect(me.direction?.dir).toBe(Direction.E);
  });

  it('clicking a tree sends Harvest and does not rotate the player', async () => {
    const { scene, conn, fireClick } = await setup(32, 32);
    // Place a tree at (35, 32).
    conn.deliver({
      type: 'entityFullState',
      data: {
        entityId: 99,
        components: {
          position: { tileX: 35, tileY: 32 },
          blueprint: { blueprintId: BlueprintType.Tree, variant: 0 },
          statusEffects: { effects: 0 },
        },
      },
    });

    const me = scene.entities.get(1)!;
    const dirBefore = me.direction?.dir;

    let targetPx: { x: number; y: number } | null = null;
    for (let py = 0; py < 768 && !targetPx; py += 4) {
      for (let px = 0; px < 1024 && !targetPx; px += 4) {
        const t = scene.camera.tileAt(px, py);
        if (t && t.tx === 35 && t.ty === 32) targetPx = { x: px, y: py };
      }
    }
    expect(targetPx).not.toBeNull();
    fireClick(targetPx!.x, targetPx!.y);

    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0].action).toBe(ClientAction.Harvest);
    // No MoveTo → no turn prediction.
    expect(me.direction?.dir).toBe(dirBefore);
  });

  it('left-click on a HUD quickbar cell selects the slot, no MoveTo', async () => {
    const { scene, conn, fireClick } = await setup(32, 32);
    // Bind an axe to slot 0.
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 7, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 7;
    const sentBefore = conn.sent.length;

    const r = hudQuickbarCellRect(0);
    fireClick(r.x + 4, r.y + 4);

    expect(scene.selectedQuickSlot).toBe(0);
    const newSent = conn.sent.slice(sentBefore);
    expect(newSent).toHaveLength(1);
    expect(newSent[0]).toEqual({ action: ClientAction.Equip, itemId: 7 });
  });
});
