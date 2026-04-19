// Top-level test harness: build a fully-wired scene + fake connection,
// ready to receive server messages and be asserted against. Tests usually
// only need createTestScene(); the lower-level factories (mock-gl,
// fake-sprite-registry, fake-connection) are still exported for tests that
// want custom wiring.

import { createScene, type Scene } from '@client-webgl/scene.js';
import { wireSceneToConnection } from '@client-webgl/network/wire-scene.js';
import type { TextSurfaceFactory } from '@client-webgl/effects/text-surface.js';
import type { EffectSprites, EffectSheet } from '@client-webgl/effects/effect-sprites.js';
import { createMockGL } from './mock-gl.js';
import { createFakeSpriteRegistry, type FakeRegistryOptions } from './fake-sprite-registry.js';
import { createFakeStaticAssets } from './fake-static-assets.js';
import { createFakeConnection, type FakeConnection } from './fake-connection.js';

export function createFakeTextSurfaceFactory(): TextSurfaceFactory {
  return {
    create(opts) {
      return {
        texture: 0 as unknown as WebGLTexture,
        width: opts.text.length * 6,
        height: opts.fontPx,
      };
    },
    release() {},
  };
}

function fakeSheet(cols: number, rows: number, frameCount: number): EffectSheet {
  const frameW = 32;
  const frameH = 32;
  return {
    texture: 0 as unknown as WebGLTexture,
    sheetW: frameW * cols,
    sheetH: frameH * rows,
    frameW,
    frameH,
    cols,
    rows,
    frameCount,
  };
}

export function createFakeEffectSprites(): EffectSprites {
  return {
    smoke:        fakeSheet(3, 3, 9),
    attack:       fakeSheet(3, 3, 6),
    harvestCraft: fakeSheet(3, 3, 7),
    hpBarFg: 0 as unknown as WebGLTexture,
    hpBarBg: 0 as unknown as WebGLTexture,
  };
}

export interface TestSceneOptions {
  spriteRegistry?: FakeRegistryOptions;
}

export interface TestScene {
  scene: Scene;
  conn: FakeConnection;
}

/**
 * Build a scene wired to a fake in-memory connection. The caller drives
 * the scene by delivering messages via `conn.deliver(msg)` and inspects
 * results on `scene.*` or outbound actions on `conn.sent`.
 */
export async function createTestScene(opts: TestSceneOptions = {}): Promise<TestScene> {
  const gl = createMockGL();
  const spriteRegistry = createFakeSpriteRegistry(opts.spriteRegistry);
  const staticAssets = createFakeStaticAssets();
  const textSurfaceFactory = createFakeTextSurfaceFactory();
  const effectSprites = createFakeEffectSprites();
  const scene = await createScene(gl, { spriteRegistry, staticAssets, textSurfaceFactory, effectSprites });
  const conn = createFakeConnection();
  wireSceneToConnection(scene, conn);
  return { scene, conn };
}

export { createMockGL } from './mock-gl.js';
export { createFakeSpriteRegistry } from './fake-sprite-registry.js';
export { createFakeConnection } from './fake-connection.js';
export type { FakeConnection } from './fake-connection.js';
