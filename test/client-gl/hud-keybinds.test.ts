import { describe, it, expect } from 'vitest';
import { BlueprintType } from '@shared/blueprints.js';
import { ClientAction } from '@shared/actions.js';
import { createTestScene } from './harness.js';
import { attachKeyboardControls } from '@client-webgl/controls/keyboard.js';

function makeFakeCanvas(): { canvas: HTMLCanvasElement; fire: (key: string) => void } {
  let listener: ((ev: KeyboardEvent) => void) | null = null;
  const canvas = {
    addEventListener: (type: string, fn: (ev: KeyboardEvent) => void) => {
      if (type === 'keydown') listener = fn;
    },
  } as unknown as HTMLCanvasElement;
  const fire = (key: string) => {
    if (!listener) throw new Error('keydown listener not attached');
    listener({
      key,
      preventDefault: () => {},
      ctrlKey: false, altKey: false, metaKey: false,
    } as unknown as KeyboardEvent);
  };
  return { canvas, fire };
}

describe('quickslot keybind: 1..9 while inventory panel is open', () => {
  it('fires selectQuickSlot (Equip) when panel is open', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 12, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 12;
    scene.overlay = { kind: 'inventory' };

    const { canvas, fire } = makeFakeCanvas();
    attachKeyboardControls(canvas, conn, scene);
    fire('1');

    expect(conn.sent).toHaveLength(1);
    expect(conn.sent[0]).toEqual({ action: ClientAction.Equip, itemId: 12 });
    expect(scene.selectedQuickSlot).toBe(0);
  });

  it('still works after the panel closes', async () => {
    const { scene, conn } = await createTestScene();
    conn.deliver({
      type: 'inventorySync',
      items: [{ itemId: 12, blueprintId: BlueprintType.Axe, quantity: 1, equippedSlot: 0 }],
    });
    scene.quickSlots[0] = 12;

    const { canvas, fire } = makeFakeCanvas();
    attachKeyboardControls(canvas, conn, scene);
    fire('1');
    expect(conn.sent).toHaveLength(1);
    expect(scene.selectedQuickSlot).toBe(0);
  });
});
