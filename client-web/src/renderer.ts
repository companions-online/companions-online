import { tileToScreen } from '@shared/coordinates.js';
import { SPAWN_X, SPAWN_Y } from '@shared/constants.js';
import { TILE_W, TILE_H, CANVAS_W, CANVAS_H, GAME_X, GAME_Y, GAME_W, GAME_H, HUD_RIGHT_W, HUD_TOP_H, HUD_BOTTOM_H } from './config.js';
import { Camera } from './camera.js';
import { generateGrassTiles, tileVariant } from './texture.js';
import { createDeerHerd } from './deer-demo.js';

export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const camera = new Camera(SPAWN_X, SPAWN_Y);
  const grassTiles = generateGrassTiles();
  const deer = createDeerHerd(6);
  let lastTime = 0;

  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;

  function frame(now: number) {
    const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
    lastTime = now;

    // Update simulation
    deer.update(dt);
    camera.follow(deer.player.interpTileX(), deer.player.interpTileY());

    // Clear
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw game area (clipped)
    const { offsetX, offsetY } = camera.getOffset();
    const bounds = camera.getVisibleBounds();

    ctx.save();
    ctx.beginPath();
    ctx.rect(GAME_X, GAME_Y, GAME_W, GAME_H);
    ctx.clip();

    for (let ty = bounds.minTileY; ty <= bounds.maxTileY; ty++) {
      for (let tx = bounds.minTileX; tx <= bounds.maxTileX; tx++) {
        const screen = tileToScreen(tx, ty, TILE_W, TILE_H);
        const sx = screen.screenX + offsetX;
        const sy = screen.screenY + offsetY;
        const vi = tileVariant(tx, ty, grassTiles.length);
        ctx.drawImage(grassTiles[vi], sx, sy);
      }
    }

    deer.draw(ctx, offsetX, offsetY);

    ctx.restore();

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
