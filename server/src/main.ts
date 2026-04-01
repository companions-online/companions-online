import { WebSocketServer } from 'ws';
import { TICK_RATE } from '@shared/constants.js';
import { encodePong, decodeClientMessage } from '@shared/protocol/codec.js';
import { GameLoop } from './ecs/game-loop.js';
import { createDefaultWorld } from './game-world.js';
import { WebSocketConnection } from './connections/ws-connection.js';
import { renderDashboard } from './dashboard.js';

const PORT = 3001;
const WORLD_SEED = parseInt(process.env.SEED ?? '', 10) || 42;

// --- Create world ---
console.log(`[server] generating world (seed=${WORLD_SEED})...`);
const world = createDefaultWorld(WORLD_SEED);
console.log(`[server] world ready: ${world.entities.getEntityCount()} entities`);

const telemetry = world.telemetry;

// --- Game loop ---
const loop = new GameLoop(TICK_RATE);

let wsConnectionCount = 0;

loop.start((tick, _dt) => {
  telemetry.setConnectionCount('ws', wsConnectionCount);
  world.runTick();

  if (tick % TICK_RATE === 0) {
    renderDashboard(telemetry.snapshot());
    telemetry.resetNetworkCounters();
  }
});

// Clear screen when loop starts
process.stdout.write('\x1b[2J\x1b[H');

// --- WebSocket server ---
const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {});

wss.on('connection', (ws) => {
  wsConnectionCount++;
  const conn = new WebSocketConnection(ws, telemetry);
  const entityId = world.addPlayer(conn);

  ws.on('message', (data) => {
    try {
      const raw = data instanceof ArrayBuffer ? data : (data as Buffer).buffer.slice((data as Buffer).byteOffset, (data as Buffer).byteOffset + (data as Buffer).byteLength);
      const buf = raw as ArrayBuffer;
      telemetry.recordBytesReceived('ws', buf.byteLength);
      const msg = decodeClientMessage(buf);
      if (msg.type === 'action') {
        world.setAction(entityId, msg.data);
      } else if (msg.type === 'ping') {
        ws.send(encodePong(msg.clientTime));
      }
    } catch (_e) {
      // bad message — silently discard
    }
  });

  ws.on('close', () => {
    wsConnectionCount--;
    world.removePlayer(entityId);
  });
});
