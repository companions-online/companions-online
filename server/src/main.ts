import { WebSocketServer } from 'ws';
import { TICK_RATE, MAP_SIZE, SPAWN_X, SPAWN_Y } from '@shared/constants.js';

const PORT = 3001;

const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  console.log(`[server] listening on ws://localhost:${PORT} (${TICK_RATE}Hz, ${MAP_SIZE}x${MAP_SIZE} map, spawn ${SPAWN_X},${SPAWN_Y})`);
});

wss.on('connection', (ws) => {
  console.log(`[server] client connected (total: ${wss.clients.size})`);

  ws.on('close', () => {
    console.log(`[server] client disconnected (total: ${wss.clients.size})`);
  });
});
