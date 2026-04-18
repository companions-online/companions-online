import { describe, it, expect } from 'vitest';
import { shadowcast } from '@client-webgl/lighting/shadowcast.js';

/** Collect visible (x, y) coords given a blocker grid. */
function run(
  blockers: ReadonlySet<string>,
  originX: number,
  originY: number,
  radius: number,
): Set<string> {
  const visible = new Set<string>();
  shadowcast({
    originX,
    originY,
    radius,
    blocks: (x, y) => blockers.has(`${x},${y}`),
    visit: (x, y) => { visible.add(`${x},${y}`); },
  });
  return visible;
}

describe('shadowcast', () => {
  it('visits origin even when isolated', () => {
    const blockers = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        blockers.add(`${dx},${dy}`);
      }
    }
    const visible = run(blockers, 0, 0, 3);
    expect(visible.has('0,0')).toBe(true);
  });

  it('lights every tile within radius with no blockers', () => {
    const visible = run(new Set(), 0, 0, 2);
    // All (dx, dy) with dx²+dy² <= 4 should be visible (13 tiles).
    expect(visible.has('0,0')).toBe(true);
    expect(visible.has('2,0')).toBe(true);
    expect(visible.has('-2,0')).toBe(true);
    expect(visible.has('0,2')).toBe(true);
    expect(visible.has('0,-2')).toBe(true);
    expect(visible.has('1,1')).toBe(true);
    expect(visible.has('-1,-1')).toBe(true);
  });

  it('blocks light behind a wall', () => {
    // Wall immediately east of origin — tile 2 tiles east should be dark,
    // tile due south of origin unaffected.
    const blockers = new Set(['1,0']);
    const visible = run(blockers, 0, 0, 4);
    // Origin and wall itself are lit.
    expect(visible.has('0,0')).toBe(true);
    expect(visible.has('1,0')).toBe(true);
    // Directly behind wall — dark.
    expect(visible.has('2,0')).toBe(false);
    expect(visible.has('3,0')).toBe(false);
    // South direction unaffected.
    expect(visible.has('0,1')).toBe(true);
    expect(visible.has('0,2')).toBe(true);
  });

  it('light wraps around a corner gap', () => {
    // A one-tile wall at (1,0); tiles diagonally past it should still be lit
    // since the Bresenham line avoids the wall.
    const blockers = new Set(['1,0']);
    const visible = run(blockers, 0, 0, 5);
    // (2, 2) — diagonal line passes via (1, 1), which is open.
    expect(visible.has('2,2')).toBe(true);
  });

  it('clamps to radius', () => {
    const visible = run(new Set(), 0, 0, 2);
    expect(visible.has('3,0')).toBe(false);
    expect(visible.has('0,3')).toBe(false);
  });

  it('lights the target tile itself even if it blocks', () => {
    // A wall 2 tiles away should be visible (hit directly) even though
    // tiles behind it are dark.
    const blockers = new Set(['2,0']);
    const visible = run(blockers, 0, 0, 4);
    expect(visible.has('2,0')).toBe(true);
    expect(visible.has('3,0')).toBe(false);
    expect(visible.has('4,0')).toBe(false);
  });
});
