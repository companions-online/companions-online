// Polyfill browser canvas APIs before any client-web imports
import { createCanvas, loadImage } from 'canvas';

(globalThis as any).OffscreenCanvas = class OffscreenCanvas {
  constructor(width: number, height: number) {
    return createCanvas(width, height) as any;
  }
};

import { createScene } from '../client-web/src/scene.js';
import { renderScene } from '../client-web/src/render-scene.js';
import { spawnDeer } from '../client-web/src/deer-demo.js';
import { CANVAS_W, CANVAS_H, GAME_X, GAME_Y, GAME_W, GAME_H } from '../client-web/src/config.js';
import fs from 'fs';
import path from 'path';

const outputPath = process.argv[2]
  ?? path.resolve(import.meta.dirname!, 'dist/frame.png');

// Load deer sprite from filesystem
const deerSprite = await loadImage(
  path.resolve(import.meta.dirname!, '../client-web/assets/deer.png'),
);

const scene = createScene(42);
spawnDeer(scene, 6, deerSprite as unknown as CanvasImageSource);

const canvas = createCanvas(CANVAS_W, CANVAS_H);
renderScene(canvas.getContext('2d') as unknown as CanvasRenderingContext2D, scene, CANVAS_W, CANVAS_H);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));
console.log(`Rendered to ${outputPath}`);
