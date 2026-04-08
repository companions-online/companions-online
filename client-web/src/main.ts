import { createRenderer } from './renderer.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
renderer.start();
