import { createScene } from './scene.js';
import { createRenderer } from './renderer.js';
import { checkGLError } from './platform/gl-utils.js';
import { attachMouseControls } from './controls/mouse.js';
import { connect } from './network/connection.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) {
  document.body.innerHTML = '<p style="color:#fff;font-family:monospace;padding:2rem">WebGL2 unavailable in this browser.</p>';
  throw new Error('WebGL2 context unavailable');
}

const scene = await createScene(gl);
checkGLError(gl, 'after scene init');

const conn = connect();

attachMouseControls(canvas, scene, conn);

const renderer = createRenderer(canvas, scene);
renderer.start();

// Network dispatch: route every decoded server message into the matching
// scene mutator. Scene state is fully driven by the server from here on.
conn.onMessage((msg) => {
  switch (msg.type) {
    case 'welcome':         scene.onWelcome(msg.entityId, msg.seed); break;
    case 'chunk':           scene.onChunk(msg.data); break;
    case 'entityFullState': scene.onEntityFull(msg.data); break;
    case 'worldDelta':
      for (const eu of msg.data.entityUpdates) scene.onEntityUpdate(eu);
      for (const id of msg.data.entityRemovals) scene.onEntityRemoval(id);
      for (const tu of msg.data.tileUpdates) scene.onTileUpdate(tu);
      break;
    // Phase 9: inventorySync, containerOpen, dialogueOpen, chatMessage.
  }
});

// Debug hook: scene + connection on window for headless / devtools probing.
(window as unknown as { __scene: typeof scene; __conn: typeof conn }).__scene = scene;
(window as unknown as { __scene: typeof scene; __conn: typeof conn }).__conn = conn;
