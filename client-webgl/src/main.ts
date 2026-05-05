import { createScene } from './scene.js';
import { createRenderer } from './renderer.js';
import { checkGLError } from './platform/gl-utils.js';
import { attachMouseControls } from './controls/mouse.js';
import { attachKeyboardControls } from './controls/keyboard.js';
import { attachMenuInput } from './controls/menu-input.js';
import { connect } from './network/connection.js';
import { connectTo, formatConnectError, type ConnectError } from './network/connect-to.js';
import { normalizeHost } from './network/host-normalizer.js';
import { wireSceneToConnection } from './network/wire-scene.js';
import {
  bootStandaloneObserver, bootStandalone, tearDownStandaloneObserver,
  type StandaloneObserverRefs,
} from './network/standalone-connection.js';
import { ConnectionRef } from './network/connection-ref.js';
import type { Connection } from './network/connection.js';
import { loadMenuLogo } from './ui/logo.js';
import { createMenuController } from './ui/menu.js';
import { CANVAS_W, CANVAS_H } from './platform/config.js';
import { ClientAction } from '@shared/actions.js';
import type { CreateJoinValues } from './overlay.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false });
if (!gl) {
  document.body.innerHTML = '<p style="color:#fff;font-family:monospace;padding:2rem">WebGL2 unavailable in this browser.</p>';
  throw new Error('WebGL2 context unavailable');
}

const scene = await createScene(gl);
checkGLError(gl, 'after scene init');

// window.GAME_SERVER_HOST is injected by the game server's static
// handler when the HTML is served from /. We use it solely to autofill
// the Join Game host field — boot flow is identical (observer world
// under the menu) and the menu always shows New + Join + Settings.
const host = (window as unknown as { GAME_SERVER_HOST?: string }).GAME_SERVER_HOST;
const servedHost = host ?? null;
// connect() (the same-origin auto-connect) is no longer called from
// boot — every path goes through the menu's Join World. Kept as a
// future entry point if a fast-path skip-menu boot is ever wanted.
void connect;

const seedParam = new URLSearchParams(window.location.search).get('seed');
const initialSeed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : 42;

// Boot the observer-mode world that backs the menu screen. `observerRefs`
// is mutable so onStartWorld / onJoinWorld can swap it for a fresh
// player-mode boot at game start.
let observerRefs: StandaloneObserverRefs | null = bootStandaloneObserver(scene, initialSeed);
// Hold any in-tab player-mode world started via "Start World" so a
// subsequent "Start World" click (post-game menu reopen, future feature)
// can shut it down before booting the next world.
let playerRefs: ReturnType<typeof bootStandalone> | null = null;
// Networked connection from a successful "Join World", held so future
// flow (re-join, leave-game) can close it. Mutually exclusive with
// playerRefs — at most one player-side world is live at a time.
let networkedConn: Connection | null = null;

// All listeners attach to a single ConnectionRef; swap() routes future
// send() calls to the new underlying connection without re-attaching.
const connRef = new ConnectionRef(observerRefs.conn);

// wireSceneToConnection registers exactly one onMessage handler against
// connRef. ConnectionRef forwards it through to the active target on
// every swap, so the dispatch survives observer→player transitions.
wireSceneToConnection(scene, connRef);

scene.menuLogo = await loadMenuLogo(gl);

/** Send a server command via the active connection. Used to apply the
 *  menu's name + avatar choices once a fresh game world has spawned a
 *  player. Default name "Player" / variant 0 are skipped — they match
 *  the server-side defaults already applied at addPlayer time. */
function applyCharacterChoices(values: CreateJoinValues): void {
  if (values.name && values.name !== 'Player') {
    connRef.send({
      action: ClientAction.ServerCommand,
      command: 'nick',
      parameter: values.name,
    });
  }
  if (values.avatar !== 0) {
    connRef.send({
      action: ClientAction.ServerCommand,
      command: 'avatar',
      parameter: String(values.avatar),
    });
  }
}

/** Tear down whatever world currently backs the scene (observer / in-tab
 *  player / networked) so a new boot can replace it. Scene-level reset
 *  is the caller's responsibility — kept separate so the policy of
 *  "what scene state to clear" lives in one place (scene.reset). */
function tearDownActive(): void {
  if (observerRefs) {
    tearDownStandaloneObserver(observerRefs, scene);
    observerRefs = null;
  }
  if (playerRefs) {
    playerRefs.loop.stop();
    playerRefs.conn.close();
    playerRefs = null;
  }
  if (networkedConn) {
    networkedConn.close();
    networkedConn = null;
  }
}

function startWorld(values: CreateJoinValues): void {
  tearDownActive();
  scene.reset();

  const chosenSeed = Number.isFinite(Number(values.seed)) ? Number(values.seed) : initialSeed;
  playerRefs = bootStandalone(scene, chosenSeed);
  connRef.swap(playerRefs.conn);

  applyCharacterChoices(values);

  scene.overlay = { kind: 'none' };
}

/** Inverse of startWorld / joinWorld: tear down whichever world is live,
 *  re-boot the observer backdrop, and send the user back to the landing
 *  screen. Wired as `onDisconnect` on the menu controller; fired by the
 *  in-game settings screen's "Disconnect" button. */
function disconnect(): void {
  tearDownActive();
  scene.reset();
  observerRefs = bootStandaloneObserver(scene, initialSeed);
  connRef.swap(observerRefs.conn);
  scene.overlay = { kind: 'menu', screen: 'landing' };
}

async function joinWorld(values: CreateJoinValues): Promise<void> {
  const normalized = normalizeHost(values.host);
  if ('error' in normalized) {
    scene.overlay = {
      kind: 'menu', screen: 'connect-error',
      host: values.host || '(empty)',
      message: normalized.error,
      values,
    };
    return;
  }
  const url = normalized.url;

  // Move to the connecting screen so the user sees feedback while
  // connectTo awaits. The transition happens before we tear down the
  // current world so a connection failure can leave the observer
  // backdrop intact (the user goes back to create-join, observer pan
  // continues underneath the menu).
  scene.overlay = { kind: 'menu', screen: 'connecting', host: url, values };

  let newConn: Connection;
  try {
    newConn = await connectTo(url);
  } catch (rawErr) {
    const err = rawErr as ConnectError;
    scene.overlay = {
      kind: 'menu', screen: 'connect-error',
      host: url,
      message: formatConnectError(err),
      values,
    };
    return;
  }

  // Connection established + welcome received. Now it's safe to swap
  // the observer for the real connection: tearDown stops the in-tab
  // world, scene.reset wipes its replicated state, and connRef.swap
  // re-installs the dispatch handler on newConn — which immediately
  // replays the buffered welcome through it, populating myEntityId /
  // seed / starter chunks the same way the same-origin connect path
  // would have.
  tearDownActive();
  scene.reset();
  networkedConn = newConn;
  connRef.swap(newConn);

  applyCharacterChoices(values);

  scene.overlay = { kind: 'none' };
}

scene.menu = createMenuController({
  scene,
  palette: scene.widgetPalette,
  logo: scene.menuLogo,
  spriteRenderer: scene.spriteRenderer,
  factory: scene.textSurfaceFactory,
  servedHost,
  resolution: () => [CANVAS_W, CANVAS_H] as const,
  onStartWorld: startWorld,
  onJoinWorld: (values) => { void joinWorld(values); },
  onDisconnect: disconnect,
});

attachMouseControls(canvas, scene, connRef);
const keyboard = attachKeyboardControls(canvas, connRef, scene);
attachMenuInput(canvas, scene, scene.menu);

scene.overlay = { kind: 'menu', screen: 'landing' };

const renderer = createRenderer(canvas, scene, keyboard);
renderer.start();
canvas.focus();

// Debug hooks: scene + connection + the in-tab observer world on window
// for headless / devtools probing. The world ref points at whatever world
// is currently mounted (observer until Start World fires; player after).
const debugWindow = window as unknown as {
  __scene: typeof scene;
  __conn: typeof connRef;
  __world: () => unknown;
};
debugWindow.__scene = scene;
debugWindow.__conn = connRef;
debugWindow.__world = () => playerRefs?.world ?? observerRefs?.world ?? null;
