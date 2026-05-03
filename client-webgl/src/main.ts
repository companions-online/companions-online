import { createScene } from './scene.js';
import { createRenderer } from './renderer.js';
import { checkGLError } from './platform/gl-utils.js';
import { attachMouseControls } from './controls/mouse.js';
import { attachKeyboardControls } from './controls/keyboard.js';
import { connect } from './network/connection.js';
import { wireSceneToConnection } from './network/wire-scene.js';
import { bootStandaloneObserver } from './network/standalone-connection.js';
import type { Connection } from './network/connection.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) {
  document.body.innerHTML = '<p style="color:#fff;font-family:monospace;padding:2rem">WebGL2 unavailable in this browser.</p>';
  throw new Error('WebGL2 context unavailable');
}

const scene = await createScene(gl);
checkGLError(gl, 'after scene init');

// Mode select: networked when the served HTML injected window.GAME_SERVER_HOST
// (game-server build), standalone otherwise (esbuild-served standalone build).
// Concrete value-driven UX — cross-origin connect, menu defaults — lands with
// the menu work; today this is just a presence-check toggle.
const host = (window as unknown as { GAME_SERVER_HOST?: string }).GAME_SERVER_HOST;

let conn: Connection;
let standaloneRefs: ReturnType<typeof bootStandaloneObserver> | null = null;
if (host !== undefined) {
  conn = connect();
} else {
  const seedParam = new URLSearchParams(window.location.search).get('seed');
  const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : 42;
  // Standalone boots into observer mode — autopilot camera pans the world
  // with no player avatar. The upcoming main menu will sit on top of this;
  // its "Play" button will later swap in a player connection on the same
  // world (or a fresh one with the user's chosen seed).
  standaloneRefs = bootStandaloneObserver(scene, seed);
  conn = standaloneRefs.conn;
}

// wireSceneToConnection only routes WS-decoded messages into scene mutators;
// in standalone mode StandaloneConnection.onMessage is a no-op (the bridge
// calls scene.on* directly), so wiring it is harmless.
wireSceneToConnection(scene, conn);

attachMouseControls(canvas, scene, conn);
const keyboard = attachKeyboardControls(canvas, conn, scene);

const renderer = createRenderer(canvas, scene, keyboard);
renderer.start();

// Focus the canvas so it receives keyboard events immediately.
canvas.focus();

// Debug hooks: scene + connection on window for headless / devtools probing.
// Standalone mode also exposes the in-tab world for poking server state.
const debugWindow = window as unknown as {
  __scene: typeof scene;
  __conn: typeof conn;
  __world?: NonNullable<typeof standaloneRefs>['world'];
};
debugWindow.__scene = scene;
debugWindow.__conn = conn;
if (standaloneRefs) debugWindow.__world = standaloneRefs.world;
