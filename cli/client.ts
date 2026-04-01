import WebSocket from 'ws';
import { dbg } from './state.js';
import { handleServerMessage } from './connection.js';
import { render } from './render.js';
import { setupInput } from './input.js';

// --- Connect ---
const host = process.argv[2] || 'localhost:3001';
const ws = new WebSocket(`ws://${host}`);
ws.binaryType = 'arraybuffer';

ws.on('open', () => {
  dbg('-- connected --');
  render();
});

ws.on('message', (data) => {
  handleServerMessage(data as ArrayBuffer | Buffer, render);
});

ws.on('close', () => {
  console.log('Disconnected.');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

// Wire up keyboard input
setupInput(ws, render);
