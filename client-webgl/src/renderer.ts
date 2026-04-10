import { CANVAS_W, CANVAS_H } from './platform/config.js';
import type { Scene } from './scene.js';

/**
 * Wire a scene to the RAF loop: tick all entities, follow myEntityId (or the
 * first entity as a fallback), then draw terrain + Y-sorted sprites. Returns an
 * object with a `start()` method for main.ts to call once everything is loaded.
 */
export function createRenderer(canvas: HTMLCanvasElement, scene: Scene) {
  const gl = scene.gl;
  let lastTime = 0;

  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  gl.viewport(0, 0, CANVAS_W, CANVAS_H);

  // Configure once — disabled depth test, no face culling, clear to dark gray
  // so any unrendered area is obviously different from the terrain.
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.067, 0.067, 0.067, 1.0); // #111

  const resolution: [number, number] = [CANVAS_W, CANVAS_H];

  function frame(now: number) {
    const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    scene.time = now;

    for (const e of scene.entities.values()) {
      e.tick?.(e, dt, scene);
    }

    // Camera follow: prefer myEntityId, fall back to the first entity in
    // iteration order if it's null or its entity is gone.
    const me = scene.myEntityId !== null ? scene.entities.get(scene.myEntityId) : undefined;
    if (me) {
      scene.camera.follow(me.visualX, me.visualY);
    } else {
      const first = scene.entities.values().next().value;
      if (first) scene.camera.follow(first.visualX, first.visualY);
    }

    const [offsetX, offsetY] = scene.camera.getOffset();

    gl.clear(gl.COLOR_BUFFER_BIT);

    // Terrain pass (base + overlay). `scene.time` drives the water/river
    // animation frame uniform inside TerrainRenderer.
    scene.terrainRenderer.render(
      resolution,
      [offsetX, offsetY],
      scene.terrainTexture.texture,
      scene.maskTexture.texture,
      scene.time,
    );

    // Sprite pass — Y-sorted so entities in front of each other layer correctly.
    // Each entity's draw callback is responsible for binding its own texture.
    if (scene.entities.size > 0) {
      scene.spriteRenderer.begin(resolution);
      const sorted = Array.from(scene.entities.values()).sort((a, b) => a.screenY - b.screenY);
      for (const e of sorted) {
        e.draw?.(e, scene.spriteRenderer, gl, offsetX, offsetY);
      }
      scene.spriteRenderer.end();
    }

    requestAnimationFrame(frame);
  }

  return {
    start() {
      requestAnimationFrame(frame);
    },
  };
}
