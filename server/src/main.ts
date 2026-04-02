import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { TICK_RATE } from '@shared/constants.js';
import { GameLoop } from './ecs/game-loop.js';
import { createDefaultWorld } from './game-world.js';
import { renderDashboard } from './dashboard.js';
import { createApp } from './app.js';
import { getSessionCount } from './mcp-session.js';

const PORT = parseInt(process.env.PORT ?? '', 10) || 3001;
const WORLD_SEED = parseInt(process.env.SEED ?? '', 10) || 42;

// --- Create world ---
console.log(`[server] generating world (seed=${WORLD_SEED})...`);
const world = createDefaultWorld(WORLD_SEED);
console.log(`[server] world ready: ${world.entities.getEntityCount()} entities`);

const telemetry = world.telemetry;

// --- Create Hono app ---
const { app, wsUpgrade, getWsConnectionCount } = createApp(world, telemetry);

// --- Game loop ---
const loop = new GameLoop(TICK_RATE);

loop.start((tick, _dt) => {
  telemetry.setConnectionCount('ws', getWsConnectionCount());
  telemetry.setConnectionCount('mcp', getSessionCount());
  world.runTick();

  if (tick % TICK_RATE === 0) {
    renderDashboard(telemetry.snapshot());
    telemetry.resetNetworkCounters();
  }
});

process.stdout.write('\x1b[2J\x1b[H');

// --- Start HTTP server ---
const httpServer = serve({ fetch: app.fetch, port: PORT });

// --- Attach WebSocket server ---
const wss = new WebSocketServer({ server: httpServer as import('http').Server, path: '/ws' });
wss.on('connection', (ws) => wsUpgrade(ws));
