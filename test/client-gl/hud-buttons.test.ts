import { describe, it, expect } from 'vitest';
import {
  hitTestHudButton,
  handleHudButtonClick,
  hudButtonRect,
} from '@client-webgl/ui/hud-buttons.js';
import { createTestScene } from './harness.js';

describe('HUD button hit-test', () => {
  it('returns the matching id for a point inside each button', async () => {
    const { scene } = await createTestScene();
    for (const id of ['inventory', 'settings'] as const) {
      const r = hudButtonRect(id);
      expect(hitTestHudButton(r.x + 1, r.y + 1, scene)).toBe(id);
      expect(hitTestHudButton(r.x + r.w - 1, r.y + r.h - 1, scene)).toBe(id);
    }
  });

  it('returns null in the gap between buttons', async () => {
    const { scene } = await createTestScene();
    const i = hudButtonRect('inventory');
    const s = hudButtonRect('settings');
    const gapX = (i.x + i.w + s.x) / 2;
    expect(hitTestHudButton(gapX, i.y + 4, scene)).toBeNull();
  });

  it('returns null outside the button row vertically', async () => {
    const { scene } = await createTestScene();
    const r = hudButtonRect('settings');
    expect(hitTestHudButton(r.x + 4, r.y - 1, scene)).toBeNull();
    expect(hitTestHudButton(r.x + 4, r.y + r.h, scene)).toBeNull();
  });
});

describe('HUD button dispatch', () => {
  it('inventory button opens the inventory overlay', async () => {
    const { scene, conn } = await createTestScene();
    handleHudButtonClick(scene, conn, 'inventory');
    expect(scene.overlay).toEqual({ kind: 'inventory' });
  });

  it('settings button opens the in-game settings menu', async () => {
    const { scene, conn } = await createTestScene();
    handleHudButtonClick(scene, conn, 'settings');
    expect(scene.overlay).toEqual({ kind: 'menu', screen: 'settings', context: 'in-game' });
  });
});
