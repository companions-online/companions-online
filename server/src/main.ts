import { WebSocketServer } from 'ws';
import { TICK_RATE, MAP_SIZE } from '@shared/constants.js';
import { encodePong, decodeClientMessage } from '@shared/protocol/codec.js';
import { GameLoop } from './ecs/game-loop.js';
import { createDefaultWorld } from './game-world.js';
import { WebSocketConnection } from './connections/ws-connection.js';

const PORT = 3001;
const WORLD_SEED = parseInt(process.env.SEED ?? '', 10) || 44;

// --- Create world ---
console.log(`[server] generating world (seed=${WORLD_SEED})...`);
const world = createDefaultWorld(WORLD_SEED);
console.log(`[server] world ready: ${world.entities.getEntityCount()} entities`);

// --- Game loop ---
const loop = new GameLoop(TICK_RATE);

loop.start((tick, _dt) => {
  world.runTick();

  if (tick % TICK_RATE === 0) {
    console.log(`[server] tick=${tick} entities=${world.entities.getEntityCount()} players=${world.players.size}`);
  }
});

// --- WebSocket server ---
const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log(`[server] listening on ws://localhost:${PORT} (${TICK_RATE}Hz, ${MAP_SIZE}x${MAP_SIZE}, seed=${WORLD_SEED})`);
});

wss.on('connection', (ws) => {
  const conn = new WebSocketConnection(ws);
  const entityId = world.addPlayer(conn);

  console.log(`[server] client connected as entity #${entityId} (total: ${world.players.size})`);

  ws.on('message', (data) => {
    try {
      const raw = data instanceof ArrayBuffer ? data : (data as Buffer).buffer.slice((data as Buffer).byteOffset, (data as Buffer).byteOffset + (data as Buffer).byteLength);
      const buf = raw as ArrayBuffer;
      const msg = decodeClientMessage(buf);
      if (msg.type === 'action') {
        world.setAction(entityId, msg.data);
      } else if (msg.type === 'ping') {
        ws.send(encodePong(msg.clientTime));
      }
    } catch (e) {
      console.error('[server] bad message:', e);
    }
  });

  ws.on('close', () => {
    world.removePlayer(entityId);
    console.log(`[server] client #${entityId} disconnected (total: ${world.players.size})`);
  });
});
