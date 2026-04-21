import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import {
  handleCookingClick,
  isCookingActive,
} from '@client-webgl/ui/cooking-highlight.js';
import { createTestScene } from './harness.js';
import type { Scene } from '@client-webgl/scene.js';
import type { FakeConnection } from './fake-connection.js';

/** Seed a player + raw-meat quickslot + a campfire entity at the given
 *  tile. Player stands at (5,5) by default. */
async function setupCookScene(
  campfireTile: { tileX: number; tileY: number },
  playerTile = { tileX: 5, tileY: 5 },
): Promise<{ scene: Scene; conn: FakeConnection }> {
  const { scene, conn } = await createTestScene();
  conn.deliver({ type: 'welcome', entityId: 1, seed: 1 });
  conn.deliver({
    type: 'entityFullState',
    data: {
      entityId: 1,
      components: {
        position: playerTile,
        blueprint: { blueprintId: BlueprintType.Player, variant: 0 },
        health: { currentHp: 100, maxHp: 100 },
      },
    },
  });
  conn.deliver({
    type: 'entityFullState',
    data: {
      entityId: 99,
      components: {
        position: campfireTile,
        blueprint: { blueprintId: BlueprintType.Campfire, variant: 0 },
        statusEffects: { effects: 0 },
      },
    },
  });
  conn.deliver({
    type: 'inventorySync',
    items: [{ itemId: 11, blueprintId: BlueprintType.RawMeat, quantity: 3, equippedSlot: 0 }],
  });
  scene.quickSlots[0] = 11;
  scene.selectedQuickSlot = 0;
  return { scene, conn };
}

describe('cooking mode', () => {
  it('active when raw meat is the selected quickslot', async () => {
    const { scene } = await setupCookScene({ tileX: 6, tileY: 5 });
    expect(isCookingActive(scene)).toBe(true);
  });

  it('inactive when inventory is open', async () => {
    const { scene } = await setupCookScene({ tileX: 6, tileY: 5 });
    scene.inventoryOpen = true;
    expect(isCookingActive(scene)).toBe(false);
  });

  it('right-click on an adjacent campfire sends UseItemAt', async () => {
    const { scene, conn } = await setupCookScene({ tileX: 6, tileY: 5 });
    conn.sent.length = 0;
    const consumed = handleCookingClick(scene, conn, 6, 5);
    expect(consumed).toBe(true);
    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({
      action: ClientAction.UseItemAt, itemId: 11, tileX: 6, tileY: 5,
    });
  });

  it('right-click on a distant campfire consumes the event but sends nothing', async () => {
    const { scene, conn } = await setupCookScene({ tileX: 10, tileY: 10 });
    conn.sent.length = 0;
    const consumed = handleCookingClick(scene, conn, 10, 10);
    expect(consumed).toBe(true);
    expect(conn.sent).toHaveLength(0);
  });

  it('right-click on a non-campfire tile falls through (returns false)', async () => {
    const { scene, conn } = await setupCookScene({ tileX: 6, tileY: 5 });
    conn.sent.length = 0;
    const consumed = handleCookingClick(scene, conn, 50, 50);
    expect(consumed).toBe(false);
    expect(conn.sent).toHaveLength(0);
  });

  it('inactive when cooking mode is off', async () => {
    const { scene, conn } = await setupCookScene({ tileX: 6, tileY: 5 });
    scene.selectedQuickSlot = null;
    const consumed = handleCookingClick(scene, conn, 6, 5);
    expect(consumed).toBe(false);
  });
});
