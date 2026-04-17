import { CANVAS_W, CANVAS_H, GAME_X, GAME_Y, GAME_W, GAME_H, TILE_W, TILE_H, PX_PER_Z } from './platform/config.js';
import { tileToScreen } from '@shared/coordinates.js';
import type { Scene } from './scene.js';
import { drawHud } from './ui/hud.js';

/**
 * RAF loop: tick entities, drain dirty chunks, draw terrain + Y-sorted
 * sprites (entities + walls) + HUD. One frame per requestAnimationFrame.
 */
export function createRenderer(canvas: HTMLCanvasElement, scene: Scene) {
  const gl = scene.gl;
  let lastTime = 0;

  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  gl.viewport(0, 0, CANVAS_W, CANVAS_H);

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0.067, 0.067, 0.067, 1.0); // #111

  const resolution: [number, number] = [CANVAS_W, CANVAS_H];

  function frame(now: number) {
    const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    scene.time = now;

    // Rebuild chunks that were dirtied by chunk arrival / tile deltas /
    // eviction since last frame. Runs before draw so the GPU sees a
    // consistent snapshot.
    scene.processDirtyChunks();

    for (const e of scene.entities.values()) {
      e.tick?.(e, dt, scene);
    }

    // Camera follows the player entity once it arrives from the server;
    // otherwise stays at its initial SPAWN position. Pass ground z so the
    // viewport translates up/down with the player's hill height.
    if (scene.myEntityId !== null) {
      const me = scene.entities.get(scene.myEntityId);
      if (me) scene.camera.follow(me.visualX, me.visualY, scene.getGroundZ(me.visualX, me.visualY));
    }

    const [offsetX, offsetY] = scene.camera.getOffset();

    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(GAME_X, CANVAS_H - GAME_Y - GAME_H, GAME_W, GAME_H);

    scene.terrainRenderer.render(
      resolution,
      [offsetX, offsetY],
      scene.terrainTexture.texture,
      scene.maskTexture.texture,
      scene.time,
    );

    // Sprite pass — Y-sorted. Entities + walls from every live chunk.
    // Pre-populate screenY with elevation applied so the sort matches what
    // the draw path will render (walls bake elevation into screenY at build
    // time too — keeping both sides consistent is what makes Y-sort work).
    const drawList: { screenY: number; draw: () => void }[] = [];
    for (const e of scene.entities.values()) {
      const scr = tileToScreen(e.visualX, e.visualY, TILE_W, TILE_H);
      const z = scene.getGroundZ(e.visualX, e.visualY);
      e.screenY = scr.screenY - z * PX_PER_Z;
      drawList.push({
        screenY: e.screenY,
        draw: () => e.draw?.(e, scene.spriteRenderer, gl, offsetX, offsetY, scene),
      });
    }
    for (const walls of scene.wallDrawablesByChunk.values()) {
      for (const w of walls) {
        drawList.push({
          screenY: w.screenY,
          draw: () => w.draw(scene.spriteRenderer, gl, offsetX, offsetY),
        });
      }
    }

    if (drawList.length > 0) {
      scene.spriteRenderer.begin(resolution);
      drawList.sort((a, b) => a.screenY - b.screenY);
      for (const d of drawList) d.draw();
      scene.spriteRenderer.end();
    }

    gl.disable(gl.SCISSOR_TEST);
    drawHud(gl);

    requestAnimationFrame(frame);
  }

  return {
    start() {
      requestAnimationFrame(frame);
    },
  };
}
