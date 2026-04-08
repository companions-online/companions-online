import { CANVAS_W, CANVAS_H, GAME_X, GAME_Y, GAME_W, GAME_H, HUD_RIGHT_W, HUD_TOP_H, HUD_BOTTOM_H } from './config.js';
import { createScene } from './scene.js';
import { renderScene } from './render-scene.js';
import { spawnDeer } from './deer-demo.js';

export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const scene = createScene(42);
  let lastTime = 0;

  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  // Load deer sprite — entities appear once loaded
  const spriteSheet = new Image();
  spriteSheet.src = '/assets/deer.png';
  spriteSheet.onload = () => {
    spawnDeer(scene, 6, spriteSheet);
  };

  function frame(now: number) {
    const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    scene.time = now;

    // Update entities
    for (const e of scene.entities) e.update(dt);

    // Camera follows first entity if any
    if (scene.entities.length > 0) {
      scene.camera.follow(scene.entities[0].interpTileX(), scene.entities[0].interpTileY());
    }

    // Render terrain + entities
    renderScene(ctx, scene, CANVAS_W, CANVAS_H, {
      x: GAME_X, y: GAME_Y, w: GAME_W, h: GAME_H,
    });

    // HUD placeholder outlines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(GAME_X, 0, CANVAS_W - HUD_RIGHT_W, HUD_TOP_H);
    ctx.strokeRect(GAME_X, CANVAS_H - HUD_BOTTOM_H, CANVAS_W - HUD_RIGHT_W, HUD_BOTTOM_H);
    ctx.strokeRect(CANVAS_W - HUD_RIGHT_W, 0, HUD_RIGHT_W, CANVAS_H);

    requestAnimationFrame(frame);
  }

  return {
    start() {
      requestAnimationFrame(frame);
    },
  };
}
