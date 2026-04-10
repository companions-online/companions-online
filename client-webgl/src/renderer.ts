import { CANVAS_W, CANVAS_H } from './platform/config.js';
import type { Scene } from './scene.js';

/**
 * Wire a scene to the RAF loop: update all entities, follow the first one,
 * then draw terrain + sprites. Returns an object with a `start()` method for
 * main.ts to call once everything is loaded.
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

    for (const e of scene.entities) e.update(dt);

    if (scene.entities.length > 0) {
      scene.camera.follow(scene.entities[0].interpTileX(), scene.entities[0].interpTileY());
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

    // Sprite pass — Y-sorted so deer in front of each other layer correctly.
    if (scene.entities.length > 0) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.deerTexture);
      scene.spriteRenderer.begin(resolution);
      const sorted = scene.entities.slice().sort((a, b) => a.screenY() - b.screenY());
      for (const e of sorted) {
        e.draw(scene.spriteRenderer, offsetX, offsetY);
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
