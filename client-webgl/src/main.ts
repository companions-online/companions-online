import { createScene } from './scene.js';
import { createRenderer } from './renderer.js';
import { checkGLError } from './platform/gl-utils.js';
import { attachMouseControls } from './controls/mouse.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) {
  document.body.innerHTML = '<p style="color:#fff;font-family:monospace;padding:2rem">WebGL2 unavailable in this browser.</p>';
  throw new Error('WebGL2 context unavailable');
}

const scene = await createScene(gl, 42);
checkGLError(gl, 'after scene init');

attachMouseControls(canvas, scene);

const renderer = createRenderer(canvas, scene);
renderer.start();
