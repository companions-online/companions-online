import { describe, it, expect } from 'vitest';
import { startObserverCamera } from '../../client-webgl/src/controls/observer-camera.js';
import { MAP_SIZE } from '../../shared/src/constants.js';
import type { Scene } from '../../client-webgl/src/scene.js';

/** Minimal scene stub — autopilot only writes observerFocus, so no other
 *  scene plumbing is needed. Cast through unknown to satisfy the full
 *  Scene interface in the test signature. */
function stubScene(): Pick<Scene, 'observerFocus'> {
  return { observerFocus: null };
}

describe('observer-camera autopilot', () => {
  it('updates scene.observerFocus on the first tick', () => {
    const scene = stubScene();
    const focusCalls: { x: number; y: number }[] = [];
    startObserverCamera(
      scene as Scene,
      (x, y) => focusCalls.push({ x, y }),
      64, 64,
      { seed: 1 },
    ).tick(0);
    expect(scene.observerFocus).toEqual({ tileX: 64, tileY: 64 });
    // First tick fires setFocus once with the start tile.
    expect(focusCalls).toEqual([{ x: 64, y: 64 }]);
  });

  it('advances the focus along the chosen direction over time', () => {
    const scene = stubScene();
    const cam = startObserverCamera(
      scene as Scene,
      () => {},
      64, 64,
      { seed: 1, speedTilesPerSec: 4, minSegmentMs: 10000, maxSegmentMs: 10000 },
    );
    cam.tick(0);
    const start = scene.observerFocus!;
    // 1 second at 4 tiles/sec → ≥ 4 tiles displaced (Chebyshev), well under
    // the 10s segment boundary so no direction change.
    cam.tick(1000);
    const after = scene.observerFocus!;
    const dx = after.tileX - start.tileX;
    const dy = after.tileY - start.tileY;
    expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeGreaterThanOrEqual(3);
  });

  it('throttles setFocus to rounded-tile transitions, not every frame', () => {
    const scene = stubScene();
    const focusCalls: { x: number; y: number }[] = [];
    const cam = startObserverCamera(
      scene as Scene,
      (x, y) => focusCalls.push({ x, y }),
      64, 64,
      { seed: 1, speedTilesPerSec: 1, minSegmentMs: 10000, maxSegmentMs: 10000 },
    );
    cam.tick(0);          // initial setFocus
    const initialCalls = focusCalls.length;
    // Six 50ms frames at 1 tile/sec total displacement = 0.3 tiles → no
    // rounded-tile change → no extra setFocus.
    for (let i = 1; i <= 6; i++) cam.tick(i * 50);
    expect(focusCalls.length).toBe(initialCalls);
    // One more big jump pushes past a rounded tile boundary.
    cam.tick(1500);
    expect(focusCalls.length).toBeGreaterThan(initialCalls);
  });

  it('biases direction toward map center when entering the edge buffer', () => {
    const scene = stubScene();
    const cam = startObserverCamera(
      scene as Scene,
      () => {},
      // Start near top-left corner inside the buffer band so the very
      // first non-initial tick triggers the toward-center pick.
      4, 4,
      { seed: 1, speedTilesPerSec: 1, edgeBuffer: 16, minSegmentMs: 10000, maxSegmentMs: 10000 },
    );
    cam.tick(0);
    cam.tick(100); // pickDirTowardCenter fires; clamps to (16,16)
    cam.tick(2000); // 1.9s additional travel toward center
    const f = scene.observerFocus!;
    // After traveling toward center, both axes should have moved to or
    // past the edge buffer in the inward direction.
    expect(f.tileX).toBeGreaterThanOrEqual(16);
    expect(f.tileY).toBeGreaterThanOrEqual(16);
  });

  it('clamps inside the edge buffer (never crosses the band)', () => {
    const scene = stubScene();
    const cam = startObserverCamera(
      scene as Scene,
      () => {},
      MAP_SIZE - 4, MAP_SIZE - 4,
      { seed: 1, speedTilesPerSec: 50, edgeBuffer: 16, minSegmentMs: 10000, maxSegmentMs: 10000 },
    );
    // Drive several frames; even if the autopilot picks an outward direction,
    // the clamp + re-roll keeps focus inside [edgeBuffer, MAP_SIZE-edgeBuffer].
    for (let i = 0; i <= 20; i++) cam.tick(i * 100);
    const f = scene.observerFocus!;
    expect(f.tileX).toBeGreaterThanOrEqual(16);
    expect(f.tileX).toBeLessThanOrEqual(MAP_SIZE - 16);
    expect(f.tileY).toBeGreaterThanOrEqual(16);
    expect(f.tileY).toBeLessThanOrEqual(MAP_SIZE - 16);
  });

  it('changes direction after the segment timer elapses', () => {
    const scene = stubScene();
    const cam = startObserverCamera(
      scene as Scene,
      () => {},
      64, 64,
      { seed: 7, speedTilesPerSec: 2, minSegmentMs: 1000, maxSegmentMs: 1000 },
    );
    cam.tick(0);
    cam.tick(500);
    const mid = scene.observerFocus!;
    // Vector traveled in the first segment.
    const v1x = mid.tileX - 64;
    const v1y = mid.tileY - 64;

    cam.tick(1500); // past the 1000ms segment boundary
    cam.tick(2000);
    const after = scene.observerFocus!;
    const v2x = after.tileX - mid.tileX;
    const v2y = after.tileY - mid.tileY;

    // Different direction → vectors should not be parallel-positive in both
    // components. Permissive: assert at least one axis differs in sign or
    // the magnitudes diverge (excluding the degenerate same-direction case).
    const sameDir = Math.sign(v1x) === Math.sign(v2x) && Math.sign(v1y) === Math.sign(v2y);
    expect(sameDir).toBe(false);
  });

  it('stop() halts further updates', () => {
    const scene = stubScene();
    const cam = startObserverCamera(
      scene as Scene,
      () => {},
      64, 64,
      { seed: 1, speedTilesPerSec: 4, minSegmentMs: 10000, maxSegmentMs: 10000 },
    );
    cam.tick(0);
    cam.tick(500);
    const beforeStop = scene.observerFocus!;
    cam.stop();
    cam.tick(2000);
    expect(scene.observerFocus).toEqual(beforeStop);
  });
});
