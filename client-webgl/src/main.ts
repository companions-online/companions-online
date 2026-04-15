import { createScene } from './scene.js';
import { createRenderer } from './renderer.js';
import { checkGLError } from './platform/gl-utils.js';
import { attachMouseControls } from './controls/mouse.js';
import { connect } from './network/connection.js';
import { wireSceneToConnection } from './network/wire-scene.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) {
  document.body.innerHTML = '<p style="color:#fff;font-family:monospace;padding:2rem">WebGL2 unavailable in this browser.</p>';
  throw new Error('WebGL2 context unavailable');
}

const scene = await createScene(gl);
checkGLError(gl, 'after scene init');

const conn = connect();
wireSceneToConnection(scene, conn);
attachMouseControls(canvas, scene, conn);

const renderer = createRenderer(canvas, scene);
renderer.start();

// Debug hook: scene + connection on window for headless / devtools probing.
(window as unknown as { __scene: typeof scene; __conn: typeof conn }).__scene = scene;
(window as unknown as { __scene: typeof scene; __conn: typeof conn }).__conn = conn;
