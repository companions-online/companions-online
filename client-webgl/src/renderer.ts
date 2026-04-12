import { CANVAS_W, CANVAS_H, GAME_X, GAME_Y, GAME_W, GAME_H, TILE_W, TILE_H } from './platform/config.js';
import { tileToScreen } from '@shared/coordinates.js';
import type { Scene } from './scene.js';
import { drawHud } from './ui/hud.js';

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

    // Game pass — restrict drawing to the game viewport via scissor test so
    // terrain + sprites don't bleed into the HUD chrome regions. gl.scissor
    // uses bottom-left origin, so flip Y from our top-left GAME_Y.
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(GAME_X, CANVAS_H - GAME_Y - GAME_H, GAME_W, GAME_H);

    // Terrain pass (base + overlay). `scene.time` drives the water/river
    // animation frame uniform inside TerrainRenderer.
    scene.terrainRenderer.render(
      resolution,
      [offsetX, offsetY],
      scene.terrainTexture.texture,
      scene.maskTexture.texture,
      scene.time,
    );

    // Sprite pass — Y-sorted: merge entities + wall drawables so walls properly
    // occlude entities behind them. Pre-compute entity screenY for sorting.
    const drawCount = scene.entities.size + scene.wallDrawables.length;
    if (drawCount > 0) {
      scene.spriteRenderer.begin(resolution);

      const drawList: { screenY: number; draw: () => void }[] = [];

      for (const e of scene.entities.values()) {
        const scr = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
        e.screenY = scr.screenY;
        drawList.push({
          screenY: e.screenY,
          draw: () => e.draw?.(e, scene.spriteRenderer, gl, offsetX, offsetY),
        });
      }

      for (const w of scene.wallDrawables) {
        drawList.push({
          screenY: w.screenY,
          draw: () => w.draw(scene.spriteRenderer, gl, offsetX, offsetY),
        });
      }

      drawList.sort((a, b) => a.screenY - b.screenY);
      for (const d of drawList) d.draw();

      scene.spriteRenderer.end();
    }

    gl.disable(gl.SCISSOR_TEST);

    // HUD pass — currently a no-op stub; future inventory/minimap/action bar
    // draws into the chrome regions outside the game viewport.
    drawHud(gl);

    requestAnimationFrame(frame);
  }

  return {
    start() {
      requestAnimationFrame(frame);
    },
  };
}
