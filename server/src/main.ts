import { WebSocketServer } from 'ws';
import { TICK_RATE, MAP_SIZE } from '@shared/constants.js';
import { encodePong, decodeClientMessage } from '@shared/protocol/codec.js';
import { GameLoop } from './ecs/game-loop.js';
import { createDefaultWorld } from './game-world.js';
import { WebSocketConnection } from './connections/ws-connection.js';
import type { TelemetrySnapshot } from './telemetry.js';

const PORT = 3001;
const WORLD_SEED = parseInt(process.env.SEED ?? '', 10) || 42;
const TICK_BUDGET_MS = 1000 / TICK_RATE;

// --- Create world ---
console.log(`[server] generating world (seed=${WORLD_SEED})...`);
const world = createDefaultWorld(WORLD_SEED);
console.log(`[server] world ready: ${world.entities.getEntityCount()} entities`);

const telemetry = world.telemetry;

// --- Dashboard rendering ---

const PHASE_ORDER = ['actions', 'critterAI', 'harvest', 'respawns', 'movement', 'combat', 'pickups', 'broadcast', 'cleanup'];
const LINE = '\u2500'.repeat(53);

let lastRenderTime = performance.now();

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${(m % 60).toString().padStart(2, '0')}m`;
  return `${m}m${(s % 60).toString().padStart(2, '0')}s`;
}

function formatBytes(bytes: number, elapsed: number): string {
  if (elapsed <= 0) return '  \u2014';
  const perSec = bytes / elapsed;
  if (perSec >= 1024 * 1024) return `${(perSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (perSec >= 1024) return `${(perSec / 1024).toFixed(1)} KB/s`;
  return `${Math.round(perSec)} B/s`;
}

function renderDashboard(snap: TelemetrySnapshot): void {
  const now = performance.now();
  const elapsedSec = (now - lastRenderTime) / 1000;

  const tickMs = snap.tickAvgUs / 1000;
  const budgetPct = TICK_BUDGET_MS > 0 ? (tickMs / TICK_BUDGET_MS) * 100 : 0;

  const lines: string[] = [];
  lines.push('');
  lines.push(` Companions Online \u2014 tick ${snap.tick} (${TICK_RATE}Hz)       uptime ${formatUptime(snap.uptimeMs)}`);
  lines.push(LINE);
  lines.push(` TICK BUDGET   ${tickMs.toFixed(1)}ms / ${TICK_BUDGET_MS}ms  (${budgetPct.toFixed(0)}%)`);
  lines.push(LINE);
  lines.push(` Phase            avg \u00b5s      %`);

  // Build phase lookup from snapshot
  const phaseMap = new Map(snap.phases.map(p => [p.name, p]));
  for (const name of PHASE_ORDER) {
    const p = phaseMap.get(name);
    const us = p ? p.avgUs : 0;
    const pct = p ? p.pct : 0;
    lines.push(` ${name.padEnd(16)} ${us.toFixed(0).padStart(8)}   ${pct.toFixed(1).padStart(5)}%`);
  }

  lines.push(LINE);
  lines.push(` NETWORK          \u25bc recv        \u25b2 sent       conns`);

  // Always show ws row; add others from snapshot
  const netMap = new Map(snap.network.map(n => [n.type, n]));
  for (const type of ['ws', 'mcp']) {
    const n = netMap.get(type);
    if (n) {
      const recv = formatBytes(n.recvBytes, elapsedSec);
      const sent = formatBytes(n.sentBytes, elapsedSec);
      lines.push(` ${type.padEnd(12)} ${recv.padStart(10)}    ${sent.padStart(10)}       ${String(n.conns).padStart(3)}`);
    } else {
      lines.push(` ${type.padEnd(12)}       \u2014           \u2014         0`);
    }
  }

  lines.push(LINE);
  lines.push(` WORLD   entities: ${snap.entityCount}   players: ${snap.playerCount}   critters: ${snap.entityCount - snap.playerCount}`);
  lines.push('');

  // Cursor home + write, pad lines to clear remnants
  const cols = process.stdout.columns || 80;
  const out = '\x1b[H' + lines.map(l => l.padEnd(cols)).join('\n');
  process.stdout.write(out);

  lastRenderTime = now;
}

// --- Game loop ---
const loop = new GameLoop(TICK_RATE);

let wsConnectionCount = 0;

loop.start((tick, _dt) => {
  telemetry.setConnectionCount('ws', wsConnectionCount);
  world.runTick();

  if (tick % TICK_RATE === 0) {
    const snap = telemetry.snapshot();
    renderDashboard(snap);
    telemetry.resetNetworkCounters();
  }
});

// Clear screen when loop starts
process.stdout.write('\x1b[2J\x1b[H');

// --- WebSocket server ---
const wss = new WebSocketServer({ port: PORT });

wss.on('listening', () => {
  // Shown once before dashboard takes over
});

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
